import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  logAgentActivity,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 25, 50);
  const search = sp.get("search")?.trim();
  const domain = sp.get("domain")?.trim().toLowerCase();

  const admin = createAdminClient();
  let query = admin
    .from("companies")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (domain) {
    query = query.eq("domain", domain);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,domain.ilike.%${search}%,tax_id.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count, limit, offset);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("companies")
    .insert({
      name: body.name.trim(),
      domain: typeof body.domain === "string" ? body.domain.trim().toLowerCase() || null : null,
      website: typeof body.website === "string" ? body.website.trim() || null : null,
      tax_id: typeof body.tax_id === "string" ? body.tax_id.trim() || null : null,
      billing_address: typeof body.billing_address === "string" ? body.billing_address.trim() || null : null,
      billing_city: typeof body.billing_city === "string" ? body.billing_city.trim() || null : null,
      billing_postal_code:
        typeof body.billing_postal_code === "string" ? body.billing_postal_code.trim() || null : null,
      country: typeof body.country === "string" ? body.country.trim() || "ES" : "ES",
      industry: typeof body.industry === "string" ? body.industry.trim() || null : null,
      company_size: typeof body.company_size === "string" ? body.company_size.trim() || null : null,
      linkedin_url: typeof body.linkedin_url === "string" ? body.linkedin_url.trim() || null : null,
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
      { error: error?.message ?? "Could not create company" },
      { status: 400 }
    );
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "company",
    entityId: data.id,
    companyId: data.id,
    eventType: "company_created",
    metadata: { name: data.name, agent: auth.agent.name },
  });

  return NextResponse.json({ data }, { status: 201 });
}

