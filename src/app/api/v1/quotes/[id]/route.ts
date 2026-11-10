import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiV1, logAgentActivity } from "@/lib/api/v1-auth";
import {
  buildBillingSnapshot,
  calculateQuoteTotals,
  type QuoteItemInput,
} from "@/lib/crm/quotes";
import type { Database, QuoteStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const { id } = await context.params;
  const admin = createAdminClient();
  const [quoteRes, itemsRes] = await Promise.all([
    admin.from("quotes").select("*").eq("id", id).maybeSingle(),
    admin
      .from("quote_items")
      .select("*")
      .eq("quote_id", id)
      .order("item_order", { ascending: true }),
  ]);

  if (quoteRes.error || !quoteRes.data) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      ...quoteRes.data,
      items: itemsRes.data ?? [],
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    status?: QuoteStatus;
    valid_until?: string | null;
    terms?: string | null;
    items?: QuoteItemInput[];
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const patch: Database["public"]["Tables"]["quotes"]["Update"] = {};
  if ("valid_until" in body) patch.valid_until = body.valid_until ?? null;
  if ("terms" in body) patch.terms = body.terms ?? null;

  if (Array.isArray(body.items) && body.items.length > 0) {
    const totals = calculateQuoteTotals(body.items);
    patch.subtotal = totals.subtotal;
    patch.discount_total = totals.discount_total;
    patch.tax_total = totals.tax_total;
    patch.total_amount = totals.total_amount;

    await admin.from("quote_items").delete().eq("quote_id", id);
    await admin.from("quote_items").insert(
      totals.items.map((item) => ({
        quote_id: id,
        item_order: item.item_order,
        concept: item.concept,
        description: item.description ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        line_total: item.line_total,
      }))
    );
  }

  if (body.status) {
    patch.status = body.status;
    if ((body.status === "sent" || body.status === "accepted") && !existing.billing_snapshot) {
      const [companyRes, contactRes] = await Promise.all([
        existing.company_id
          ? admin.from("companies").select("*").eq("id", existing.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        existing.contact_id
          ? admin.from("contacts").select("*").eq("id", existing.contact_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      patch.billing_snapshot = buildBillingSnapshot(companyRes.data, contactRes.data);
    }
    if (body.status === "sent" && !existing.sent_at) {
      patch.sent_at = new Date().toISOString();
    }
  }

  const { data: updated, error } = await admin
    .from("quotes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  const { data: items } = await admin
    .from("quote_items")
    .select("*")
    .eq("quote_id", id)
    .order("item_order", { ascending: true });

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "quote",
    entityId: id,
    companyId: updated.company_id,
    contactId: updated.contact_id,
    dealId: updated.deal_id,
    eventType: "quote_updated",
    metadata: {
      quote_number: updated.quote_number,
      status: updated.status,
      agent: auth.agent.name,
    },
  });

  return NextResponse.json({ data: { ...updated, items: items ?? [] } });
}
