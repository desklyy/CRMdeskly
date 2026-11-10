import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiV1, logAgentActivity } from "@/lib/api/v1-auth";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const { id } = await context.params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  return NextResponse.json({ data });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const patch: Database["public"]["Tables"]["companies"]["Update"] = {};
  const allowedText = [
    "name",
    "domain",
    "website",
    "tax_id",
    "billing_address",
    "billing_city",
    "billing_postal_code",
    "country",
    "industry",
    "company_size",
    "linkedin_url",
    "owner_id",
  ] as const;

  for (const field of allowedText) {
    if (field in body) {
      const val = body[field];
      (patch as Record<string, unknown>)[field] =
        typeof val === "string" ? (field === "domain" ? val.trim().toLowerCase() : val.trim()) : null;
    }
  }

  if (
    body.custom_fields &&
    typeof body.custom_fields === "object" &&
    !Array.isArray(body.custom_fields)
  ) {
    patch.custom_fields = {
      ...(existing.custom_fields ?? {}),
      ...(body.custom_fields as Record<string, Json>),
    };
  }

  const { data, error } = await admin
    .from("companies")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "company",
    entityId: id,
    companyId: id,
    eventType: "variable_updated",
    metadata: { fields: Object.keys(patch), agent: auth.agent.name },
  });

  return NextResponse.json({ data });
}

