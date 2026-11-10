import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildBillingSnapshot, type BillingSnapshot } from "@/lib/crm/quotes";
import { renderQuotePdfBuffer } from "@/lib/pdf/quote-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (quoteErr || !quote) {
    return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
  }

  const [itemsRes, dealRes, companyRes, contactRes] = await Promise.all([
    supabase
      .from("quote_items")
      .select("*")
      .eq("quote_id", quote.id)
      .order("item_order", { ascending: true }),
    supabase.from("deals").select("title").eq("id", quote.deal_id).maybeSingle(),
    quote.company_id && !quote.billing_snapshot
      ? supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    quote.contact_id && !quote.billing_snapshot
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

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quote.quote_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
