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
    .from("deals")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
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
    .from("deals")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["deals"]["Update"] = {
    last_activity_at: now,
  };

  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.amount === "number") patch.amount = body.amount;
  if (typeof body.priority === "string") {
    patch.priority = body.priority as Database["public"]["Tables"]["deals"]["Row"]["priority"];
  }
  if ("company_id" in body) patch.company_id = (body.company_id as string | null) ?? null;
  if ("primary_contact_id" in body) {
    patch.primary_contact_id = (body.primary_contact_id as string | null) ?? null;
  }
  if ("owner_id" in body) patch.owner_id = (body.owner_id as string | null) ?? null;
  if ("next_action" in body) patch.next_action = (body.next_action as string | null) ?? null;
  if ("next_action_date" in body) {
    patch.next_action_date = (body.next_action_date as string | null) ?? null;
  }
  if ("expected_close_date" in body) {
    patch.expected_close_date = (body.expected_close_date as string | null) ?? null;
  }
  if ("lost_reason" in body) patch.lost_reason = (body.lost_reason as string | null) ?? null;

  let stageChanged = false;
  let nextStageName: string | null = null;

  if (typeof body.stage_id === "string" && body.stage_id !== existing.stage_id) {
    const { data: stage } = await admin
      .from("pipeline_stages")
      .select("*")
      .eq("id", body.stage_id)
      .maybeSingle();

    if (!stage) {
      return NextResponse.json({ error: "Invalid stage_id" }, { status: 400 });
    }

    patch.pipeline_id = stage.pipeline_id;
    patch.stage_id = stage.id;
    patch.stage_changed_at = now;
    patch.status = stage.is_won_stage
      ? "won"
      : stage.is_lost_stage
        ? "lost"
        : "open";
    patch.closed_at = patch.status === "open" ? null : existing.closed_at ?? now;
    stageChanged = true;
    nextStageName = stage.name;
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
    .from("deals")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "deal",
    entityId: id,
    companyId: data.company_id,
    contactId: data.primary_contact_id,
    dealId: id,
    eventType: stageChanged ? "stage_changed" : "variable_updated",
    metadata: stageChanged
      ? {
          from_stage_id: existing.stage_id,
          to_stage_id: data.stage_id,
          to_stage_name: nextStageName,
          agent: auth.agent.name,
        }
      : { fields: Object.keys(patch), agent: auth.agent.name },
  });

  return NextResponse.json({ data });
}

