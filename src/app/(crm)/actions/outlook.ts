"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/crm/activities";
import { buildBillingSnapshot, type BillingSnapshot } from "@/lib/crm/quotes";
import { renderQuotePdfBuffer } from "@/lib/pdf/quote-pdf";
import {
  createOutlookEvent,
  deleteOutlookEvent,
  listCalendarView,
  OutlookAuthInvalidError,
  sendOutlookMail,
  updateOutlookEvent,
  type GraphEvent,
} from "@/lib/microsoft/graph";
import type { Database, Json } from "@/types/database";

type CalendarLinkRow = Database["public"]["Tables"]["calendar_event_links"]["Row"];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión no iniciada");
  return { supabase, user };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function sendDealEmailAction(input: {
  dealId: string;
  companyId: string | null;
  contactId: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  quoteId?: string | null;
}) {
  const { supabase, user } = await requireUser();
  const toEmail = input.toEmail.trim().toLowerCase();
  if (!toEmail || !input.subject.trim()) {
    return { error: "El destinatario y el asunto son obligatorios." };
  }

  if (!input.contactId) {
    return { error: "El negocio necesita un contacto principal para registrar el email." };
  }

  const { data: conn } = await supabase
    .from("oauth_connections")
    .select("microsoft_email, is_auth_invalid")
    .eq("user_id", user.id)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn) {
    return { error: "Conecta tu cuenta de Outlook en Settings > Integraciones primero." };
  }
  if (conn.is_auth_invalid) {
    return { error: "Conexión con Outlook pausada. Vuelve a autenticarte." };
  }

  const attachments: {
    name: string;
    contentType: string;
    contentBytesBase64: string;
  }[] = [];

  let quoteNumberForLog: string | null = null;
  let syncedBaseAmount: number | null = null;

  if (input.quoteId) {
    const { data: quote } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", input.quoteId)
      .single();

    if (!quote) return { error: "Presupuesto no encontrado." };

    const [itemsRes, dealRes, companyRes, contactRes] = await Promise.all([
      supabase
        .from("quote_items")
        .select("*")
        .eq("quote_id", quote.id)
        .order("item_order", { ascending: true }),
      supabase.from("deals").select("title").eq("id", quote.deal_id).single(),
      quote.company_id
        ? supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      quote.contact_id
        ? supabase.from("contacts").select("*").eq("id", quote.contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const billing = (quote.billing_snapshot ??
      buildBillingSnapshot(companyRes.data, contactRes.data)) as unknown as BillingSnapshot;

    const pdfBuffer = await renderQuotePdfBuffer({
      quote,
      items: itemsRes.data ?? [],
      dealTitle: dealRes.data?.title ?? "Presupuesto",
      billing,
    });

    attachments.push({
      name: `${quote.quote_number}.pdf`,
      contentType: "application/pdf",
      contentBytesBase64: pdfBuffer.toString("base64"),
    });

    const now = new Date().toISOString();
    await supabase
      .from("quotes")
      .update({
        status: "sent",
        billing_snapshot: billing as unknown as Record<string, Json>,
        sent_at: quote.sent_at ?? now,
      })
      .eq("id", quote.id);

    quoteNumberForLog = quote.quote_number;
    syncedBaseAmount =
      Math.round((quote.subtotal - quote.discount_total) * 100) / 100;
  }

  const htmlBody = input.bodyText
    .split("\n")
    .map((line) => `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "&nbsp;"}</p>`)
    .join("");

  try {
    await sendOutlookMail(user.id, {
      to: [toEmail],
      subject: input.subject.trim(),
      htmlBody,
      attachments,
    });
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return { error: err.message, authInvalid: true };
    }
    return {
      error: err instanceof Error ? err.message : "Error enviando correo por Outlook.",
    };
  }

  const now = new Date().toISOString();
  const syntheticGraphId = `crm-sent-${crypto.randomUUID()}`;
  const preview = stripHtml(htmlBody).slice(0, 500);

  const { data: emailRow } = await supabase
    .from("emails")
    .insert({
      ms_graph_id: syntheticGraphId,
      user_id: user.id,
      contact_id: input.contactId,
      deal_id: input.dealId,
      quote_id: input.quoteId ?? null,
      from_email: conn.microsoft_email,
      to_emails: [toEmail] as Json,
      subject: input.subject.trim(),
      body_preview: preview,
      direction: "outbound",
      has_attachments: attachments.length > 0,
      sent_at: now,
    })
    .select("*")
    .single();

  await supabase
    .from("deals")
    .update({
      last_activity_at: now,
      ...(syncedBaseAmount !== null ? { amount: syncedBaseAmount } : {}),
    })
    .eq("id", input.dealId);

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: quoteNumberForLog ? "quote" : "deal",
    entityId: input.quoteId ?? input.dealId,
    companyId: input.companyId,
    contactId: input.contactId,
    dealId: input.dealId,
    eventType: quoteNumberForLog ? "quote_sent" : "email_sent",
    metadata: {
      to_email: toEmail,
      subject: input.subject.trim(),
      ...(quoteNumberForLog ? { quote_number: quoteNumberForLog } : {}),
    },
  });

  revalidatePath("/pipelines");
  return { data: emailRow, syncedBaseAmount };
}

// ---------------------------------------------------------------------------
// CALENDARIO OUTLOOK DIRECTO
// ---------------------------------------------------------------------------

export interface EnrichedCalendarEvent extends GraphEvent {
  link: CalendarLinkRow | null;
}

export async function getCalendarAgendaAction(startIso: string, endIso: string): Promise<{
  connected: boolean;
  authInvalid?: boolean;
  microsoftEmail?: string;
  events: EnrichedCalendarEvent[];
  error?: string;
}> {
  const { supabase, user } = await requireUser();

  const { data: conn } = await supabase
    .from("oauth_connections")
    .select("microsoft_email, is_auth_invalid")
    .eq("user_id", user.id)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn) {
    return { connected: false, events: [] };
  }

  if (conn.is_auth_invalid) {
    return {
      connected: true,
      authInvalid: true,
      microsoftEmail: conn.microsoft_email,
      events: [],
    };
  }

  try {
    const [events, linksRes] = await Promise.all([
      listCalendarView(user.id, startIso, endIso),
      supabase.from("calendar_event_links").select("*").eq("user_id", user.id),
    ]);

    const linkMap = new Map((linksRes.data ?? []).map((l) => [l.ms_event_id, l]));

    return {
      connected: true,
      microsoftEmail: conn.microsoft_email,
      events: events.map((ev) => ({
        ...ev,
        link: linkMap.get(ev.id) ?? null,
      })),
    };
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return {
        connected: true,
        authInvalid: true,
        microsoftEmail: conn.microsoft_email,
        events: [],
      };
    }
    return {
      connected: true,
      microsoftEmail: conn.microsoft_email,
      events: [],
      error: err instanceof Error ? err.message : "No se pudo leer Outlook Calendar.",
    };
  }
}

export async function createOutlookMeetingAction(input: {
  subject: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  isOnlineMeeting?: boolean;
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
}) {
  const { supabase, user } = await requireUser();
  if (!input.subject.trim()) {
    return { error: "El asunto de la reunión es obligatorio." };
  }

  try {
    const created = await createOutlookEvent(user.id, {
      subject: input.subject.trim(),
      startIso: input.startIso,
      endIso: input.endIso,
      attendeeEmails: input.attendeeEmails,
      isOnlineMeeting: input.isOnlineMeeting ?? true,
    });

    let linkRow: CalendarLinkRow | null = null;
    if (input.dealId || input.companyId || input.contactId) {
      const { data } = await supabase
        .from("calendar_event_links")
        .upsert(
          {
            ms_event_id: created.id,
            ical_uid: created.iCalUId ?? null,
            user_id: user.id,
            deal_id: input.dealId || null,
            company_id: input.companyId || null,
            contact_id: input.contactId || null,
          },
          { onConflict: "user_id,ms_event_id" }
        )
        .select("*")
        .single();
      linkRow = data;
    }

    if (input.dealId) {
      await supabase
        .from("deals")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", input.dealId);
    }

    await logUserActivity({
      supabase,
      actorId: user.id,
      entityType: "calendar_event",
      entityId: input.dealId ?? input.contactId ?? input.companyId ?? user.id,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      dealId: input.dealId ?? null,
      eventType: "meeting_scheduled",
      metadata: {
        subject: created.subject ?? input.subject.trim(),
        ms_event_id: created.id,
        ...(created.iCalUId ? { ical_uid: created.iCalUId } : {}),
      },
    });

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { data: { ...created, link: linkRow } as EnrichedCalendarEvent };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error creando reunión en Outlook.",
    };
  }
}

export async function updateOutlookMeetingAction(input: {
  msEventId: string;
  subject?: string;
  startIso?: string;
  endIso?: string;
}) {
  const { supabase, user } = await requireUser();
  try {
    const updated = await updateOutlookEvent(user.id, input.msEventId, {
      subject: input.subject,
      startIso: input.startIso,
      endIso: input.endIso,
    });

    const { data: link } = await supabase
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", user.id)
      .eq("ms_event_id", input.msEventId)
      .maybeSingle();

    if (link) {
      await logUserActivity({
        supabase,
        actorId: user.id,
        entityType: "calendar_event",
        entityId: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        companyId: link.company_id,
        contactId: link.contact_id,
        dealId: link.deal_id,
        eventType: "meeting_updated",
        metadata: {
          subject: updated.subject ?? input.subject ?? "Reunión",
          ms_event_id: input.msEventId,
          ...(link.ical_uid ? { ical_uid: link.ical_uid } : {}),
        },
      });
    }

    revalidatePath("/calendar");
    return { data: updated };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo actualizar la reunión.",
    };
  }
}

export async function deleteOutlookMeetingAction(msEventId: string) {
  const { supabase, user } = await requireUser();
  try {
    const { data: link } = await supabase
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", user.id)
      .eq("ms_event_id", msEventId)
      .maybeSingle();

    await deleteOutlookEvent(user.id, msEventId);

    if (link) {
      await supabase.from("calendar_event_links").delete().eq("id", link.id);
      await logUserActivity({
        supabase,
        actorId: user.id,
        entityType: "calendar_event",
        entityId: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        companyId: link.company_id,
        contactId: link.contact_id,
        dealId: link.deal_id,
        eventType: "meeting_cancelled",
        metadata: {
          ms_event_id: msEventId,
          ...(link.ical_uid ? { ical_uid: link.ical_uid } : {}),
        },
      });
    }

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo cancelar la reunión.",
    };
  }
}

export async function linkCalendarEventAction(input: {
  msEventId: string;
  icalUid?: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
}) {
  const { supabase, user } = await requireUser();

  if (!input.companyId && !input.contactId && !input.dealId) {
    await supabase
      .from("calendar_event_links")
      .delete()
      .eq("user_id", user.id)
      .eq("ms_event_id", input.msEventId);

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { data: null };
  }

  const { data, error } = await supabase
    .from("calendar_event_links")
    .upsert(
      {
        ms_event_id: input.msEventId,
        ical_uid: input.icalUid ?? null,
        user_id: user.id,
        company_id: input.companyId,
        contact_id: input.contactId,
        deal_id: input.dealId,
      },
      { onConflict: "user_id,ms_event_id" }
    )
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/calendar");
  revalidatePath("/pipelines");
  return { data };
}

