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

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
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

export async function getCompanyRelationsAction(companyId: string): Promise<{
  contacts: Pick<ContactRow, "id" | "first_name" | "last_name" | "email" | "job_title">[];
  activities: ActivityRow[];
}> {
  const { supabase } = await requireAuthenticatedUser();
  const [contactsRes, activitiesRes] = await Promise.all([
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
  ]);

  return {
    contacts: contactsRes.data ?? [],
    activities: activitiesRes.data ?? [],
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
  companies: Pick<CompanyRow, "id" | "name" | "domain">[];
  contacts: Pick<ContactRow, "id" | "first_name" | "last_name" | "email">[];
  deals: { id: string; title: string; amount: number; status: string }[];
}

export async function globalSearchAction(query: string): Promise<GlobalSearchResult> {
  const term = query.trim();
  if (!term) {
    return { companies: [], contacts: [], deals: [] };
  }

  const { supabase } = await requireAuthenticatedUser();

  const [companiesRes, contactsRes, dealsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, domain")
      .or(`name.ilike.%${term}%,domain.ilike.%${term}%,tax_id.ilike.%${term}%`)
      .limit(5),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(5),
    supabase
      .from("deals")
      .select("id, title, amount, status")
      .ilike("title", `%${term}%`)
      .limit(5),
  ]);

  return {
    companies: companiesRes.data ?? [],
    contacts: contactsRes.data ?? [],
    deals: dealsRes.data ?? [],
  };
}

