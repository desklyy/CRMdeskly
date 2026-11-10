import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  logAgentActivity,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";
import { calculateQuoteTotals, type QuoteItemInput } from "@/lib/crm/quotes";
import type { QuoteStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 25, 50);
  const dealId = sp.get("deal_id")?.trim();
  const status = sp.get("status")?.trim();

  const admin = createAdminClient();
  let query = admin
    .from("quotes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dealId) query = query.eq("deal_id", dealId);
  if (status) query = query.eq("status", status as QuoteStatus);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count, limit, offset);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as {
    deal_id?: string;
    valid_until?: string | null;
    terms?: string | null;
    items?: QuoteItemInput[];
  } | null;

  if (!body?.deal_id || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "deal_id and non-empty items array are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: deal } = await admin
    .from("deals")
    .select("id, company_id, primary_contact_id")
    .eq("id", body.deal_id)
    .maybeSingle();

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const year = new Date().getFullYear();
  const prefix = `DESK-${year}-`;
  const { data: lastQuote } = await admin
    .from("quotes")
    .select("quote_number")
    .like("quote_number", `${prefix}%`)
    .order("quote_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (lastQuote?.quote_number) {
    const tail = Number(lastQuote.quote_number.replace(prefix, ""));
    if (!Number.isNaN(tail)) seq = tail + 1;
  }
  const quoteNumber = `${prefix}${String(seq).padStart(4, "0")}`;

  const totals = calculateQuoteTotals(body.items);

  const { data: quote, error: qErr } = await admin
    .from("quotes")
    .insert({
      quote_number: quoteNumber,
      deal_id: deal.id,
      company_id: deal.company_id,
      contact_id: deal.primary_contact_id,
      status: "draft",
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      tax_total: totals.tax_total,
      total_amount: totals.total_amount,
      valid_until: body.valid_until ?? null,
      terms: body.terms ?? null,
    })
    .select("*")
    .single();

  if (qErr || !quote) {
    return NextResponse.json(
      { error: qErr?.message ?? "Could not create quote" },
      { status: 400 }
    );
  }

  const { data: insertedItems } = await admin
    .from("quote_items")
    .insert(
      totals.items.map((item) => ({
        quote_id: quote.id,
        item_order: item.item_order,
        concept: item.concept,
        description: item.description ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        line_total: item.line_total,
      }))
    )
    .select("*")
    .order("item_order", { ascending: true });

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "quote",
    entityId: quote.id,
    companyId: quote.company_id,
    contactId: quote.contact_id,
    dealId: quote.deal_id,
    eventType: "quote_created",
    metadata: {
      quote_number: quote.quote_number,
      total_amount: quote.total_amount,
      agent: auth.agent.name,
    },
  });

  return NextResponse.json(
    { data: { ...quote, items: insertedItems ?? [] } },
    { status: 201 }
  );
}
