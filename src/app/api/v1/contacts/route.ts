import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  logAgentActivity,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";
import type { Json, LeadStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 25, 50);
  const search = sp.get("search")?.trim();
  const email = sp.get("email")?.trim().toLowerCase();
  const companyId = sp.get("company_id")?.trim();
  const leadStatus = sp.get("lead_status")?.trim() as LeadStatus | null;
  const department = sp.get("department")?.trim();

  const admin = createAdminClient();
  let query = admin
    .from("contacts")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (email) query = query.eq("email", email);
  if (companyId) query = query.eq("company_id", companyId);
  if (leadStatus) query = query.eq("lead_status", leadStatus);
  if (department) query = query.eq("department", department);
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,department.ilike.%${search}%`
    );
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count, limit, offset);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.first_name !== "string" || !body.first_name.trim()) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .insert({
      company_id: typeof body.company_id === "string" ? body.company_id : null,
      first_name: body.first_name.trim(),
      last_name: typeof body.last_name === "string" ? body.last_name.trim() || null : null,
      email: typeof body.email === "string" ? body.email.trim().toLowerCase() || null : null,
      phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
      job_title: typeof body.job_title === "string" ? body.job_title.trim() || null : null,
      department: typeof body.department === "string" ? body.department.trim() || null : null,
      lead_status:
        typeof body.lead_status === "string" ? (body.lead_status.trim() as LeadStatus) : "Nuevo",
      linkedin_url: typeof body.linkedin_url === "string" ? body.linkedin_url.trim() || null : null,
      lead_source: typeof body.lead_source === "string" ? body.lead_source.trim() || null : null,
      owner_id: typeof body.owner_id === "string" ? body.owner_id : null,
      custom_fields:
        body.custom_fields && typeof body.custom_fields === "object" && !Array.isArray(body.custom_fields)
          ? (body.custom_fields as Record<string, Json>)
          : {},
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create contact" },
      { status: 400 }
    );
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "contact",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.id,
    eventType: "contact_created",
    metadata: {
      full_name: [data.first_name, data.last_name].filter(Boolean).join(" "),
      agent: auth.agent.name,
    },
  });

  return NextResponse.json({ data }, { status: 201 });
}

