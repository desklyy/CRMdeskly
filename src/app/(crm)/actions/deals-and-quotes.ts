"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/supabase/auth-guard";
import type { createClient } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/crm/activities";
import { buildBillingSnapshot, calculateQuoteTotals, type QuoteItemInput } from "@/lib/crm/quotes";
import type { Database, Json, QuoteStatus } from "@/types/database";

type DealUpdate = Database["public"]["Tables"]["deals"]["Update"];
type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type CustomFieldDefinitionRow =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"];
type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteItemRow = Database["public"]["Tables"]["quote_items"]["Row"];
type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];
type EmailRow = Database["public"]["Tables"]["emails"]["Row"];
type CalendarLinkRow = Database["public"]["Tables"]["calendar_event_links"]["Row"];

async function requireUser() {
  return requireActiveUser();
}

export async function createDealAction(input: {
  title: string;
  amount?: number;
  pipeline_id: string;
  stage_id: string;
  company_id?: string | null;
  primary_contact_id?: string | null;
  priority?: Database["public"]["Tables"]["deals"]["Row"]["priority"];
  expected_close_date?: string | null;
}) {
  const { supabase, user } = await requireUser();
  const title = input.title.trim();
  if (!title) return { error: "El título del negocio es obligatorio." };

  const { data: maxPosRow } = await supabase
    .from("deals")
    .select("position")
    .eq("pipeline_id", input.pipeline_id)
    .eq("stage_id", input.stage_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPos = (maxPosRow?.position ?? 0) + 1000;

  const { data, error } = await supabase
    .from("deals")
    .insert({
      title,
      amount: Number(input.amount) || 0,
      pipeline_id: input.pipeline_id,
      stage_id: input.stage_id,
      position: nextPos,
      company_id: input.company_id || null,
      primary_contact_id: input.primary_contact_id || null,
      owner_id: user.id,
      priority: input.priority ?? "medium",
      expected_close_date: input.expected_close_date || null,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  if (input.primary_contact_id) {
    await supabase.from("deal_contacts").upsert({
      deal_id: data.id,
      contact_id: input.primary_contact_id,
      role_in_deal: "Contacto Principal",
    });
  }

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "deal",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.primary_contact_id,
    dealId: data.id,
    eventType: "deal_created",
    metadata: { title: data.title, amount: data.amount },
  });

  revalidatePath("/pipelines");
  return { data };
}

export async function moveDealAction(input: {
  dealId: string;
  targetStageId: string;
  position: number;
  lostReason?: string | null;
}) {
  const { supabase, user } = await requireUser();

  const [dealRes, stageRes] = await Promise.all([
    supabase.from("deals").select("*").eq("id", input.dealId).single(),
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("id", input.targetStageId)
      .single(),
  ]);

  if (dealRes.error || !dealRes.data) {
    return { error: dealRes.error?.message ?? "Negocio no encontrado" };
  }
  if (stageRes.error || !stageRes.data) {
    return { error: stageRes.error?.message ?? "Etapa no encontrada" };
  }

  const deal = dealRes.data;
  const stage = stageRes.data;
  const stageChanged = deal.stage_id !== stage.id;
  const now = new Date().toISOString();

  const nextStatus: DealUpdate["status"] = stage.is_won_stage
    ? "won"
    : stage.is_lost_stage
      ? "lost"
      : "open";

  const patch: DealUpdate = {
    pipeline_id: stage.pipeline_id,
    stage_id: stage.id,
    position: input.position,
    status: nextStatus,
    closed_at: nextStatus === "open" ? null : deal.closed_at ?? now,
    lost_reason:
      nextStatus === "lost"
        ? input.lostReason?.trim() || deal.lost_reason || null
        : null,
    last_activity_at: now,
    ...(stageChanged ? { stage_changed_at: now } : {}),
  };

  const { data: updated, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", input.dealId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  if (stageChanged) {
    await logUserActivity({
      supabase,
      actorId: user.id,
      entityType: "deal",
      entityId: updated.id,
      companyId: updated.company_id,
      contactId: updated.primary_contact_id,
      dealId: updated.id,
      eventType: "stage_changed",
      metadata: {
        from_stage_id: deal.stage_id,
        to_stage_id: stage.id,
        to_stage_name: stage.name,
        status: nextStatus,
        ...(input.lostReason ? { lost_reason: input.lostReason } : {}),
      },
    });
  }

  revalidatePath("/pipelines");
  return { data: updated };
}

export async function updateDealFieldAction(dealId: string, patch: DealUpdate) {
  const { supabase, user } = await requireUser();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("deals")
    .update({ ...patch, last_activity_at: now })
    .eq("id", dealId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "deal",
    entityId: dealId,
    companyId: data.company_id,
    contactId: data.primary_contact_id,
    dealId,
    eventType: "variable_updated",
    metadata: { fields: Object.keys(patch) },
  });

  revalidatePath("/pipelines");
  return { data };
}

export async function updateDealCustomFieldAction(
  dealId: string,
  key: string,
  value: Json
) {
  const { supabase, user } = await requireUser();
  const { data: current, error: fetchError } = await supabase
    .from("deals")
    .select("custom_fields, company_id, primary_contact_id")
    .eq("id", dealId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Negocio no encontrado" };
  }

  const nextCustomFields: Record<string, Json> = {
    ...(current.custom_fields ?? {}),
    [key]: value,
  };

  const { data, error } = await supabase
    .from("deals")
    .update({
      custom_fields: nextCustomFields,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "deal",
    entityId: dealId,
    companyId: current.company_id,
    contactId: current.primary_contact_id,
    dealId,
    eventType: "variable_updated",
    metadata: { key, value },
  });

  revalidatePath("/pipelines");
  return { data };
}

export async function deleteDealAction(dealId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("deals").delete().eq("id", dealId);
  if (error) return { error: error.message };
  revalidatePath("/pipelines");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DETALLES DE DEAL (MULTI-CONTACTO, PRESUPUESTOS, EMAILS, REUNIONES, TIMELINE)
// ---------------------------------------------------------------------------

export interface DealContactJoined {
  contact_id: string;
  role_in_deal: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
}

export interface QuoteWithItems extends QuoteRow {
  items: QuoteItemRow[];
}

export async function getDealDetailsAction(dealId: string): Promise<{
  dealContacts: DealContactJoined[];
  quotes: QuoteWithItems[];
  emails: EmailRow[];
  calendarLinks: CalendarLinkRow[];
  activities: ActivityRow[];
  linkedCompany: Pick<
    CompanyRow,
    "id" | "name" | "domain" | "industry" | "company_size" | "custom_fields"
  > | null;
  companyDefinitions: CustomFieldDefinitionRow[];
}> {
  const { supabase } = await requireUser();

  const [dealRowRes, dcRes, quotesRes, emailsRes, calRes, actRes, companyDefsRes] =
    await Promise.all([
      supabase.from("deals").select("company_id").eq("id", dealId).maybeSingle(),
      supabase
        .from("deal_contacts")
        .select("contact_id, role_in_deal")
        .eq("deal_id", dealId),
      supabase
        .from("quotes")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }),
      supabase
        .from("emails")
        .select("*")
        .eq("deal_id", dealId)
        .order("sent_at", { ascending: false })
        .limit(20),
      supabase
        .from("calendar_event_links")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("activities")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("custom_field_definitions")
        .select("*")
        .eq("entity_type", "company")
        .eq("is_active", true)
        .order("field_order", { ascending: true }),
    ]);

  let linkedCompany: Pick<
    CompanyRow,
    "id" | "name" | "domain" | "industry" | "company_size" | "custom_fields"
  > | null = null;
  const companyId = dealRowRes.data?.company_id;
  if (companyId) {
    const { data: compData } = await supabase
      .from("companies")
      .select("id, name, domain, industry, company_size, custom_fields")
      .eq("id", companyId)
      .maybeSingle();
    if (compData) {
      linkedCompany = compData;
    }
  }

  const dcRows = dcRes.data ?? [];
  const contactIds = dcRows.map((r) => r.contact_id);
  let contactsMap = new Map<
    string,
    { first_name: string; last_name: string | null; email: string | null; job_title: string | null }
  >();

  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, job_title")
      .in("id", contactIds);

    contactsMap = new Map((contactsData ?? []).map((c) => [c.id, c]));
  }

  const dealContacts: DealContactJoined[] = dcRows.map((r) => {
    const c = contactsMap.get(r.contact_id);
    return {
      contact_id: r.contact_id,
      role_in_deal: r.role_in_deal,
      first_name: c?.first_name ?? "Contacto",
      last_name: c?.last_name ?? null,
      email: c?.email ?? null,
      job_title: c?.job_title ?? null,
    };
  });

  const quoteRows = quotesRes.data ?? [];
  const quoteIds = quoteRows.map((q) => q.id);
  const itemsByQuote = new Map<string, QuoteItemRow[]>();

  if (quoteIds.length > 0) {
    const { data: itemsData } = await supabase
      .from("quote_items")
      .select("*")
      .in("quote_id", quoteIds)
      .order("item_order", { ascending: true });

    for (const item of itemsData ?? []) {
      const list = itemsByQuote.get(item.quote_id) ?? [];
      list.push(item);
      itemsByQuote.set(item.quote_id, list);
    }
  }

  const quotes: QuoteWithItems[] = quoteRows.map((q) => ({
    ...q,
    items: itemsByQuote.get(q.id) ?? [],
  }));

  return {
    dealContacts,
    quotes,
    emails: emailsRes.data ?? [],
    calendarLinks: calRes.data ?? [],
    activities: actRes.data ?? [],
    linkedCompany,
    companyDefinitions: companyDefsRes.data ?? [],
  };
}

export async function addDealContactAction(
  dealId: string,
  contactId: string,
  roleInDeal: string
) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("deal_contacts").upsert({
    deal_id: dealId,
    contact_id: contactId,
    role_in_deal: roleInDeal.trim() || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function removeDealContactAction(dealId: string, contactId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("deal_contacts")
    .delete()
    .eq("deal_id", dealId)
    .eq("contact_id", contactId);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function logStructuredSummaryAction(input: {
  dealId: string;
  companyId: string | null;
  contactId: string | null;
  eventType: "call_summary" | "meeting_summary" | "internal_note";
  outcome: string;
  objections: string[];
  summaryOneLiner: string;
}) {
  const { supabase, user } = await requireUser();
  const summary = input.summaryOneLiner.trim().slice(0, 280);
  const effectiveOutcome =
    input.eventType === "internal_note"
      ? input.outcome.trim() || "Nota"
      : input.outcome.trim();
  if (!effectiveOutcome || !summary) {
    return { error: "El resultado y el resumen breve son obligatorios." };
  }

  await supabase
    .from("deals")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", input.dealId);

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "deal",
    entityId: input.dealId,
    companyId: input.companyId,
    contactId: input.contactId,
    dealId: input.dealId,
    eventType: input.eventType,
    metadata: {
      outcome: effectiveOutcome,
      objections: input.objections,
      summary_one_liner: summary,
    },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// PRESUPUESTOS (QUOTES)
// ---------------------------------------------------------------------------

async function generateNextQuoteNumber(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DESK-${year}-`;
  const { data } = await supabase
    .from("quotes")
    .select("quote_number")
    .like("quote_number", `${prefix}%`)
    .order("quote_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (data?.quote_number) {
    const tail = Number(data.quote_number.replace(prefix, ""));
    if (!Number.isNaN(tail)) seq = tail + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function saveQuoteAction(input: {
  quoteId?: string;
  dealId: string;
  companyId: string | null;
  contactId: string | null;
  validUntil: string | null;
  terms: string | null;
  items: QuoteItemInput[];
}) {
  const { supabase, user } = await requireUser();
  const validItems = input.items.filter((i) => i.concept.trim().length > 0);
  if (validItems.length === 0) {
    return { error: "Añade al menos una línea de concepto." };
  }

  const totals = calculateQuoteTotals(validItems);
  let quote: QuoteRow | null = null;

  if (input.quoteId) {
    const { data, error } = await supabase
      .from("quotes")
      .update({
        company_id: input.companyId,
        contact_id: input.contactId,
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
        total_amount: totals.total_amount,
        valid_until: input.validUntil || null,
        terms: input.terms?.trim() || null,
      })
      .eq("id", input.quoteId)
      .select("*")
      .single();

    if (error || !data) return { error: error?.message ?? "No se pudo actualizar el presupuesto" };
    quote = data;
    await supabase.from("quote_items").delete().eq("quote_id", quote.id);
  } else {
    const quoteNumber = await generateNextQuoteNumber(supabase);
    const { data, error } = await supabase
      .from("quotes")
      .insert({
        quote_number: quoteNumber,
        deal_id: input.dealId,
        company_id: input.companyId,
        contact_id: input.contactId,
        created_by: user.id,
        status: "draft",
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
        total_amount: totals.total_amount,
        valid_until: input.validUntil || null,
        terms: input.terms?.trim() || null,
      })
      .select("*")
      .single();

    if (error || !data) return { error: error?.message ?? "No se pudo crear el presupuesto" };
    quote = data;
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from("quote_items")
    .insert(
      totals.items.map((item) => ({
        quote_id: quote.id,
        item_order: item.item_order,
        concept: item.concept,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        line_total: item.line_total,
      }))
    )
    .select("*")
    .order("item_order", { ascending: true });

  if (itemsError) return { error: itemsError.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "quote",
    entityId: quote.id,
    companyId: quote.company_id,
    contactId: quote.contact_id,
    dealId: quote.deal_id,
    eventType: input.quoteId ? "quote_updated" : "quote_created",
    metadata: { quote_number: quote.quote_number, total_amount: quote.total_amount },
  });

  return { data: { ...quote, items: insertedItems ?? [] } as QuoteWithItems };
}

export async function updateQuoteStatusAction(input: {
  quoteId: string;
  status: QuoteStatus;
  syncDealAmount: boolean;
}) {
  const { supabase, user } = await requireUser();
  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", input.quoteId)
    .single();

  if (qErr || !quote) return { error: qErr?.message ?? "Presupuesto no encontrado" };

  let billingSnapshot = quote.billing_snapshot;
  let sentAt = quote.sent_at;

  if ((input.status === "sent" || input.status === "accepted") && !billingSnapshot) {
    const [companyRes, contactRes] = await Promise.all([
      quote.company_id
        ? supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      quote.contact_id
        ? supabase.from("contacts").select("*").eq("id", quote.contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    billingSnapshot = buildBillingSnapshot(companyRes.data, contactRes.data);
  }

  if (input.status === "sent" && !sentAt) {
    sentAt = new Date().toISOString();
  }

  const { data: updatedQuote, error } = await supabase
    .from("quotes")
    .update({
      status: input.status,
      billing_snapshot: billingSnapshot,
      sent_at: sentAt,
    })
    .eq("id", quote.id)
    .select("*")
    .single();

  if (error || !updatedQuote) return { error: error?.message ?? "Error actualizando presupuesto" };

  const netBase = Math.round((updatedQuote.subtotal - updatedQuote.discount_total) * 100) / 100;

  if (input.syncDealAmount && (input.status === "sent" || input.status === "accepted")) {
    await supabase
      .from("deals")
      .update({
        amount: netBase,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", updatedQuote.deal_id);
  }

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "quote",
    entityId: updatedQuote.id,
    companyId: updatedQuote.company_id,
    contactId: updatedQuote.contact_id,
    dealId: updatedQuote.deal_id,
    eventType: input.status === "sent" ? "quote_sent" : "quote_status_changed",
    metadata: {
      quote_number: updatedQuote.quote_number,
      status: input.status,
      synced_deal_amount: input.syncDealAmount ? netBase : null,
    },
  });

  revalidatePath("/pipelines");
  return { data: updatedQuote, syncedAmount: input.syncDealAmount ? netBase : null };
}

