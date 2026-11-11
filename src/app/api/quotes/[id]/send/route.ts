import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { verifyActiveSession } from "@/lib/supabase/auth-guard";
import { buildBillingSnapshot, type BillingSnapshot } from "@/lib/crm/quotes";
import {
  recordOutboundEmailAndActivity,
  requireConnectedOutlook,
} from "@/lib/crm/outbound-mail";
import { buildQuoteEmailHtml } from "@/lib/email/templates";
import { OutlookAuthInvalidError, sendOutlookMail } from "@/lib/microsoft/graph";
import { renderQuotePdfBuffer } from "@/lib/pdf/quote-pdf";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await verifyActiveSession();
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { supabase, user } = session;

    const body = (await request.json().catch(() => null)) as
      | {
          toEmail?: string;
          includeSignature?: boolean;
          syncDealAmount?: boolean;
        }
      | null;

    const toEmail = body?.toEmail?.trim().toLowerCase() ?? "";
    if (!toEmail) {
      return NextResponse.json(
        { error: "El email del destinatario es obligatorio." },
        { status: 400 }
      );
    }

    const outlook = await requireConnectedOutlook(supabase, user.id);
    if ("error" in outlook) {
      return NextResponse.json({ error: outlook.error }, { status: 400 });
    }

    const { data: quote, error: quoteErr } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (quoteErr || !quote) {
      return NextResponse.json(
        { error: "Presupuesto no encontrado." },
        { status: 404 }
      );
    }

    const [itemsRes, dealRes, companyRes, profileSigRes] = await Promise.all([
      supabase
        .from("quote_items")
        .select("*")
        .eq("quote_id", quote.id)
        .order("item_order", { ascending: true }),
      supabase
        .from("deals")
        .select("id, title, company_id, primary_contact_id")
        .eq("id", quote.deal_id)
        .maybeSingle(),
      quote.company_id
        ? supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      body?.includeSignature !== false
        ? supabase
            .from("profiles")
            .select("email_signature")
            .eq("id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const resolvedContactId =
      quote.contact_id ?? dealRes.data?.primary_contact_id ?? null;

    if (!resolvedContactId) {
      return NextResponse.json(
        {
          error:
            "El negocio necesita un contacto principal para registrar el email.",
        },
        { status: 400 }
      );
    }

    const { data: contactRow } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", resolvedContactId)
      .maybeSingle();

    const billing = (quote.billing_snapshot ??
      buildBillingSnapshot(companyRes.data, contactRow)) as unknown as BillingSnapshot;

    const dealTitle = dealRes.data?.title ?? "Presupuesto";
    const pdfBuffer = await renderQuotePdfBuffer({
      quote,
      items: itemsRes.data ?? [],
      dealTitle,
      billing,
    });

    const personalSignature = profileSigRes.data?.email_signature ?? null;
    const { htmlBody, textPreview } = buildQuoteEmailHtml({
      firstName: contactRow?.first_name ?? null,
      quoteNumber: quote.quote_number,
      dealTitle,
      companyName: companyRes.data?.name ?? billing.company_name ?? null,
      items: itemsRes.data ?? [],
      subtotal: Number(quote.subtotal ?? 0),
      discountTotal: Number(quote.discount_total ?? 0),
      taxTotal: Number(quote.tax_total ?? 0),
      totalAmount: Number(quote.total_amount ?? 0),
      validUntil: quote.valid_until,
      terms: quote.terms,
      personalSignatureHtml: personalSignature,
    });

    const subject = `Presupuesto ${quote.quote_number}`;

    try {
      await sendOutlookMail(user.id, {
        to: [toEmail],
        subject,
        htmlBody,
        attachments: [
          {
            name: `${quote.quote_number}.pdf`,
            contentType: "application/pdf",
            contentBytesBase64: pdfBuffer.toString("base64"),
          },
        ],
      });
    } catch (err) {
      if (err instanceof OutlookAuthInvalidError) {
        return NextResponse.json(
          { error: err.message, authInvalid: true },
          { status: 401 }
        );
      }
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Error enviando presupuesto por Outlook.",
        },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    await supabase
      .from("quotes")
      .update({
        status: "sent",
        billing_snapshot: billing as unknown as Record<string, Json>,
        sent_at: quote.sent_at ?? now,
      })
      .eq("id", quote.id);

    const baseAmount =
      Math.round((Number(quote.subtotal ?? 0) - Number(quote.discount_total ?? 0)) * 100) /
      100;
    const syncedBaseAmount = body?.syncDealAmount !== false ? baseAmount : null;

    const emailRow = await recordOutboundEmailAndActivity({
      supabase,
      userId: user.id,
      microsoftEmail: outlook.microsoftEmail,
      toEmail,
      subject,
      preview: textPreview,
      hasAttachments: true,
      contactId: resolvedContactId,
      companyId: quote.company_id ?? dealRes.data?.company_id ?? null,
      dealId: quote.deal_id,
      quoteId: quote.id,
      syncedBaseAmount,
      activityEntityType: "quote",
      activityEntityId: quote.id,
      eventType: "quote_sent",
      extraMetadata: { quote_number: quote.quote_number },
    });

    revalidatePath("/pipelines");
    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      data: emailRow,
      syncedBaseAmount: baseAmount,
    });
  } catch (err) {
    console.error("[POST /api/quotes/[id]/send]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Error inesperado al generar o enviar el presupuesto.",
      },
      { status: 500 }
    );
  }
}

