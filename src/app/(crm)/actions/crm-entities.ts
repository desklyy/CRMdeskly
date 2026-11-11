"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/crm/activities";
import { toSnakeCaseKey } from "@/lib/crm/custom-fields";
import type {
  CustomFieldType,
  Database,
  EntityType,
  Json,
  LeadStatus,
} from "@/types/database";

type CompanyUpdate = Database["public"]["Tables"]["companies"]["Update"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Sesión no iniciada");
  }

  return { supabase, user };
}

export async function getActiveProfilesAction(): Promise<
  Pick<ProfileRow, "id" | "full_name" | "avatar_initials" | "role" | "email">[]
> {
  const { supabase } = await requireAuthenticatedUser();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_initials, role, email")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCustomFieldDefinitionsAction(entityType?: EntityType) {
  const { supabase } = await requireAuthenticatedUser();
  let query = supabase
    .from("custom_field_definitions")
    .select("*")
    .eq("is_active", true)
    .order("field_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCustomFieldAction(input: {
  entity_type: EntityType;
  label: string;
  key?: string;
  description?: string;
  section?: string;
  field_type: CustomFieldType;
  options?: string[];
  is_required?: boolean;
}) {
  const { supabase, user } = await requireAuthenticatedUser();
  const label = input.label.trim();
  if (!label) {
    return { error: "El nombre de la propiedad es obligatorio." };
  }

  const key = toSnakeCaseKey(input.key?.trim() || label);
  const section = input.section?.trim() || "Propiedades personalizadas";
  const normalizedOptions =
    input.field_type === "select" || input.field_type === "multi_select"
      ? Array.from(
          new Set((input.options ?? []).map((opt) => opt.trim()).filter(Boolean))
        ).map((opt) => ({ value: opt, label: opt }))
      : [];

  const { data: maxOrderRow } = await supabase
    .from("custom_field_definitions")
    .select("field_order")
    .eq("entity_type", input.entity_type)
    .order("field_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxOrderRow?.field_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      entity_type: input.entity_type,
      key,
      label,
      description: input.description?.trim() || null,
      section,
      field_type: input.field_type,
      options: normalizedOptions as Json,
      is_required: Boolean(input.is_required),
      field_order: nextOrder,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `Ya existe una propiedad con la clave "${key}".` };
    }
    return { error: error.message };
  }

  revalidateTag("crm-schema");
  revalidatePath("/companies");
  revalidatePath("/contacts");
  revalidatePath("/pipelines");

  return { data };
}

export async function appendCustomFieldOptionAction(fieldId: string, optionLabel: string) {
  const { supabase } = await requireAuthenticatedUser();
  const clean = optionLabel.trim();
  if (!clean) {
    return { error: "La opción no puede estar vacía." };
  }

  const { data, error } = await supabase.rpc("append_custom_field_option", {
    p_field_id: fieldId,
    p_new_option: { value: clean, label: clean },
  });

  if (error) {
    return { error: error.message };
  }

  revalidateTag("crm-schema");
  return { data };
}

// ---------------------------------------------------------------------------
// EMPRESAS
// ---------------------------------------------------------------------------

export async function listCompaniesAction(filters?: {
  search?: string;
  industry?: string;
  ownerId?: string;
}) {
  const { supabase } = await requireAuthenticatedUser();
  let query = supabase
    .from("companies")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (filters?.industry) {
    query = query.eq("industry", filters.industry);
  }
  if (filters?.ownerId) {
    query = query.eq("owner_id", filters.ownerId);
  }
  if (filters?.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%,tax_id.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCompanyAction(input: {
  name: string;
  domain?: string;
  website?: string;
  tax_id?: string;
  industry?: string;
  company_size?: string;
  owner_id?: string | null;
}) {
  const { supabase, user } = await requireAuthenticatedUser();
  const name = input.name.trim();
  if (!name) {
    return { error: "El nombre de la empresa es obligatorio." };
  }

  const domain = input.domain?.trim().toLowerCase() || null;

  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      domain,
      website: input.website?.trim() || null,
      tax_id: input.tax_id?.trim() || null,
      industry: input.industry?.trim() || null,
      company_size: input.company_size?.trim() || null,
      owner_id: input.owner_id ?? user.id,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `Ya existe una empresa con el dominio "${domain}".` };
    }
    return { error: error.message };
  }

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "company",
    entityId: data.id,
    companyId: data.id,
    eventType: "company_created",
    metadata: { name: data.name },
  });

  revalidatePath("/companies");
  return { data };
}

export async function updateCompanyFieldAction(
  companyId: string,
  patch: CompanyUpdate
) {
  const { supabase, user } = await requireAuthenticatedUser();
  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "company",
    entityId: companyId,
    companyId,
    eventType: "variable_updated",
    metadata: { fields: Object.keys(patch) },
  });

  revalidatePath("/companies");
  return { data };
}

export async function updateCompanyCustomFieldAction(
  companyId: string,
  key: string,
  value: Json
) {
  const { supabase, user } = await requireAuthenticatedUser();
  const { data: current, error: fetchError } = await supabase
    .from("companies")
    .select("custom_fields")
    .eq("id", companyId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Empresa no encontrada" };
  }

  const nextCustomFields: Record<string, Json> = {
    ...(current.custom_fields ?? {}),
    [key]: value,
  };

  const { data, error } = await supabase
    .from("companies")
    .update({ custom_fields: nextCustomFields })
    .eq("id", companyId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "company",
    entityId: companyId,
    companyId,
    eventType: "variable_updated",
    metadata: { key, value },
  });

  revalidatePath("/companies");
  return { data };
}

export async function deleteCompanyAction(companyId: string) {
  const { supabase } = await requireAuthenticatedUser();
  const { error } = await supabase.from("companies").delete().eq("id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/companies");
  return { ok: true };
}

export interface CompanyDealRelation {
  id: string;
  title: string;
  amount: number;
  status: "open" | "won" | "lost";
  stage_name: string | null;
  stage_color: string | null;
  lead_source: string | null;
  custom_fields: Record<string, Json>;
}

export async function getCompanyRelationsAction(companyId: string): Promise<{
  contacts: Pick<ContactRow, "id" | "first_name" | "last_name" | "email" | "job_title">[];
  activities: ActivityRow[];
  deals: CompanyDealRelation[];
}> {
  const { supabase } = await requireAuthenticatedUser();
  const [contactsRes, activitiesRes, dealsRes, stagesRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email, job_title")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("activities")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("deals")
      .select("id, title, amount, status, stage_id, lead_source, custom_fields")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase.from("pipeline_stages").select("id, name, color_code"),
  ]);

  const stageMap = new Map(
    (stagesRes.data ?? []).map((s) => [s.id, { name: s.name, color: s.color_code }])
  );

  const deals: CompanyDealRelation[] = (dealsRes.data ?? []).map((d) => {
    const st = stageMap.get(d.stage_id);
    return {
      id: d.id,
      title: d.title,
      amount: Number(d.amount ?? 0),
      status: d.status,
      stage_name: st?.name ?? null,
      stage_color: st?.color ?? null,
      lead_source: d.lead_source,
      custom_fields: (d.custom_fields ?? {}) as Record<string, Json>,
    };
  });

  return {
    contacts: contactsRes.data ?? [],
    activities: activitiesRes.data ?? [],
    deals,
  };
}

// ---------------------------------------------------------------------------
// CONTACTOS
// ---------------------------------------------------------------------------

export async function listContactsAction(filters?: {
  search?: string;
  leadSource?: string;
  leadStatus?: LeadStatus;
  department?: string;
  companyId?: string;
  ownerId?: string;
}) {
  const { supabase } = await requireAuthenticatedUser();
  let query = supabase
    .from("contacts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (filters?.leadSource) {
    query = query.eq("lead_source", filters.leadSource);
  }
  if (filters?.leadStatus) {
    query = query.eq("lead_status", filters.leadStatus);
  }
  if (filters?.department) {
    query = query.eq("department", filters.department);
  }
  if (filters?.companyId) {
    query = query.eq("company_id", filters.companyId);
  }
  if (filters?.ownerId) {
    query = query.eq("owner_id", filters.ownerId);
  }
  if (filters?.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,department.ilike.%${term}%`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createContactAction(input: {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  department?: string;
  lead_status?: LeadStatus;
  lead_source?: string;
  company_id?: string | null;
  owner_id?: string | null;
}) {
  const { supabase, user } = await requireAuthenticatedUser();
  const firstName = input.first_name.trim();
  if (!firstName) {
    return { error: "El nombre del contacto es obligatorio." };
  }

  const email = input.email?.trim().toLowerCase() || null;

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      first_name: firstName,
      last_name: input.last_name?.trim() || null,
      email,
      phone: input.phone?.trim() || null,
      job_title: input.job_title?.trim() || null,
      department: input.department?.trim() || null,
      lead_status: input.lead_status ?? "Nuevo",
      lead_source: input.lead_source?.trim() || null,
      company_id: input.company_id || null,
      owner_id: input.owner_id ?? user.id,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `Ya existe un contacto con el email "${email}".` };
    }
    return { error: error.message };
  }

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "contact",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.id,
    eventType: "contact_created",
    metadata: {
      full_name: [data.first_name, data.last_name].filter(Boolean).join(" "),
    },
  });

  revalidatePath("/contacts");
  return { data };
}

export async function updateContactFieldAction(
  contactId: string,
  patch: ContactUpdate
) {
  const { supabase, user } = await requireAuthenticatedUser();
  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", contactId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "contact",
    entityId: contactId,
    companyId: data.company_id,
    contactId,
    eventType: "variable_updated",
    metadata: { fields: Object.keys(patch) },
  });

  revalidatePath("/contacts");
  return { data };
}

export async function updateContactCustomFieldAction(
  contactId: string,
  key: string,
  value: Json
) {
  const { supabase, user } = await requireAuthenticatedUser();
  const { data: current, error: fetchError } = await supabase
    .from("contacts")
    .select("custom_fields, company_id")
    .eq("id", contactId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Contacto no encontrado" };
  }

  const nextCustomFields: Record<string, Json> = {
    ...(current.custom_fields ?? {}),
    [key]: value,
  };

  const { data, error } = await supabase
    .from("contacts")
    .update({ custom_fields: nextCustomFields })
    .eq("id", contactId)
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "contact",
    entityId: contactId,
    companyId: current.company_id,
    contactId,
    eventType: "variable_updated",
    metadata: { key, value },
  });

  revalidatePath("/contacts");
  return { data };
}

export async function deleteContactAction(contactId: string) {
  const { supabase } = await requireAuthenticatedUser();
  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  return { ok: true };
}

export async function getContactActivitiesAction(contactId: string): Promise<ActivityRow[]> {
  const { supabase } = await requireAuthenticatedUser();
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(15);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// BÚSQUEDA GLOBAL CMD + K
// ---------------------------------------------------------------------------

export interface GlobalSearchResult {
  companies: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    tax_id: string | null;
  }[];
  contacts: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    job_title: string | null;
    company_name: string | null;
  }[];
  deals: {
    id: string;
    title: string;
    amount: number;
    status: string;
    company_name: string | null;
  }[];
}

function sanitizePostgrestToken(token: string): string {
  return token.replace(/[,()%*\\]/g, "").trim();
}

export async function globalSearchAction(query: string): Promise<GlobalSearchResult> {
  const { supabase } = await requireAuthenticatedUser();
  const term = query.trim();

  if (!term) {
    const [companiesRes, contactsRes, dealsRes] = await Promise.all([
      supabase
        .from("companies")
        .select("id, name, domain, industry, tax_id")
        .order("updated_at", { ascending: false })
        .limit(4),
      supabase
        .from("contacts")
        .select("id, first_name, last_name, email, phone, job_title, company_id")
        .order("updated_at", { ascending: false })
        .limit(4),
      supabase
        .from("deals")
        .select("id, title, amount, status, company_id")
        .order("updated_at", { ascending: false })
        .limit(4),
    ]);

    const companyIds = Array.from(
      new Set(
        [
          ...(contactsRes.data ?? []).map((c) => c.company_id),
          ...(dealsRes.data ?? []).map((d) => d.company_id),
        ].filter((id): id is string => Boolean(id))
      )
    );

    const companyNameMap = new Map<string, string>();
    if (companyIds.length > 0) {
      const { data: linkedCompanies } = await supabase
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      for (const comp of linkedCompanies ?? []) {
        companyNameMap.set(comp.id, comp.name);
      }
    }

    return {
      companies: companiesRes.data ?? [],
      contacts: (contactsRes.data ?? []).map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        job_title: c.job_title,
        company_name: c.company_id ? (companyNameMap.get(c.company_id) ?? null) : null,
      })),
      deals: (dealsRes.data ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        amount: d.amount,
        status: d.status,
        company_name: d.company_id ? (companyNameMap.get(d.company_id) ?? null) : null,
      })),
    };
  }

  const tokens = term
    .split(/\s+/)
    .map(sanitizePostgrestToken)
    .filter(Boolean)
    .slice(0, 4);

  if (tokens.length === 0) {
    return { companies: [], contacts: [], deals: [] };
  }

  let companiesQuery = supabase
    .from("companies")
    .select("id, name, domain, industry, tax_id");
  for (const tok of tokens) {
    companiesQuery = companiesQuery.or(
      `name.ilike.%${tok}%,domain.ilike.%${tok}%,website.ilike.%${tok}%,tax_id.ilike.%${tok}%,industry.ilike.%${tok}%,billing_city.ilike.%${tok}%`
    );
  }

  let contactsQuery = supabase
    .from("contacts")
    .select("id, first_name, last_name, email, phone, job_title, company_id");
  for (const tok of tokens) {
    contactsQuery = contactsQuery.or(
      `first_name.ilike.%${tok}%,last_name.ilike.%${tok}%,email.ilike.%${tok}%,phone.ilike.%${tok}%,job_title.ilike.%${tok}%,department.ilike.%${tok}%`
    );
  }

  let dealsQuery = supabase
    .from("deals")
    .select("id, title, amount, status, company_id");
  for (const tok of tokens) {
    dealsQuery = dealsQuery.or(
      `title.ilike.%${tok}%,next_action.ilike.%${tok}%,lost_reason.ilike.%${tok}%`
    );
  }

  const [companiesRes, contactsRes, dealsRes] = await Promise.all([
    companiesQuery.order("updated_at", { ascending: false }).limit(6),
    contactsQuery.order("updated_at", { ascending: false }).limit(6),
    dealsQuery.order("updated_at", { ascending: false }).limit(6),
  ]);

  const companies = companiesRes.data ?? [];
  const matchedCompanyIds = companies.map((c) => c.id);

  // Also surface contacts & deals belonging to matched companies when searching by company name
  let extraContacts: NonNullable<typeof contactsRes.data> = [];
  let extraDeals: NonNullable<typeof dealsRes.data> = [];
  if (matchedCompanyIds.length > 0) {
    const [compContactsRes, compDealsRes] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, first_name, last_name, email, phone, job_title, company_id")
        .in("company_id", matchedCompanyIds)
        .limit(4),
      supabase
        .from("deals")
        .select("id, title, amount, status, company_id")
        .in("company_id", matchedCompanyIds)
        .limit(4),
    ]);
    extraContacts = compContactsRes.data ?? [];
    extraDeals = compDealsRes.data ?? [];
  }

  const mergedContactsMap = new Map<string, (typeof extraContacts)[number]>();
  for (const c of [...(contactsRes.data ?? []), ...extraContacts]) {
    if (!mergedContactsMap.has(c.id)) mergedContactsMap.set(c.id, c);
  }
  const mergedContacts = Array.from(mergedContactsMap.values()).slice(0, 6);

  const mergedDealsMap = new Map<string, (typeof extraDeals)[number]>();
  for (const d of [...(dealsRes.data ?? []), ...extraDeals]) {
    if (!mergedDealsMap.has(d.id)) mergedDealsMap.set(d.id, d);
  }
  const mergedDeals = Array.from(mergedDealsMap.values()).slice(0, 6);

  const companyNameMap = new Map<string, string>(
    companies.map((c) => [c.id, c.name])
  );
  const missingCompanyIds = Array.from(
    new Set(
      [
        ...mergedContacts.map((c) => c.company_id),
        ...mergedDeals.map((d) => d.company_id),
      ]
        .filter((id): id is string => Boolean(id))
        .filter((id) => !companyNameMap.has(id))
    )
  );
  if (missingCompanyIds.length > 0) {
    const { data: missingCompanies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", missingCompanyIds);
    for (const comp of missingCompanies ?? []) {
      companyNameMap.set(comp.id, comp.name);
    }
  }

  return {
    companies,
    contacts: mergedContacts.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      job_title: c.job_title,
      company_name: c.company_id ? (companyNameMap.get(c.company_id) ?? null) : null,
    })),
    deals: mergedDeals.map((d) => ({
      id: d.id,
      title: d.title,
      amount: d.amount,
      status: d.status,
      company_name: d.company_id ? (companyNameMap.get(d.company_id) ?? null) : null,
    })),
  };
}

