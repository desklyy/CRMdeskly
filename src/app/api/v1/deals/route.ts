import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  logAgentActivity,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";
import type { DealPriority, DealStatus, Json } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 25, 50);
  const pipelineId = sp.get("pipeline_id")?.trim();
  const stageId = sp.get("stage_id")?.trim();
  const status = sp.get("status")?.trim() as DealStatus | null;
  const companyId = sp.get("company_id")?.trim();

  const admin = createAdminClient();
  let query = admin
    .from("deals")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (pipelineId) query = query.eq("pipeline_id", pipelineId);
  if (stageId) query = query.eq("stage_id", stageId);
  if (status) query = query.eq("status", status);
  if (companyId) query = query.eq("company_id", companyId);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count, limit, offset);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  let pipelineId = typeof body.pipeline_id === "string" ? body.pipeline_id : null;
  let stageId = typeof body.stage_id === "string" ? body.stage_id : null;

  if (!pipelineId) {
    const { data: defPipe } = await admin
      .from("pipelines")
      .select("id")
      .eq("is_default", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    pipelineId = defPipe?.id ?? null;
  }

  if (!pipelineId) {
    return NextResponse.json({ error: "No active pipeline found" }, { status: 400 });
  }

  if (!stageId) {
    const { data: firstStage } = await admin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("is_active", true)
      .eq("is_won_stage", false)
      .eq("is_lost_stage", false)
      .order("stage_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    stageId = firstStage?.id ?? null;
  }

  if (!stageId) {
    return NextResponse.json({ error: "No valid stage_id found" }, { status: 400 });
  }

  const { data: maxPosRow } = await admin
    .from("deals")
    .select("position")
    .eq("pipeline_id", pipelineId)
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin
    .from("deals")
    .insert({
      title: body.title.trim(),
      amount: typeof body.amount === "number" ? body.amount : Number(body.amount) || 0,
      pipeline_id: pipelineId,
      stage_id: stageId,
      position: (maxPosRow?.position ?? 0) + 1000,
      company_id: typeof body.company_id === "string" ? body.company_id : null,
      primary_contact_id:
        typeof body.primary_contact_id === "string" ? body.primary_contact_id : null,
      owner_id: typeof body.owner_id === "string" ? body.owner_id : null,
      priority: (typeof body.priority === "string" ? body.priority : "medium") as DealPriority,
      lead_source: typeof body.lead_source === "string" ? body.lead_source.trim() || null : null,
      next_action: typeof body.next_action === "string" ? body.next_action.trim() || null : null,
      next_action_date:
        typeof body.next_action_date === "string" ? body.next_action_date : null,
      expected_close_date:
        typeof body.expected_close_date === "string" ? body.expected_close_date : null,
      custom_fields:
        body.custom_fields && typeof body.custom_fields === "object" && !Array.isArray(body.custom_fields)
          ? (body.custom_fields as Record<string, Json>)
          : {},
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create deal" },
      { status: 400 }
    );
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "deal",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.primary_contact_id,
    dealId: data.id,
    eventType: "deal_created",
    metadata: { title: data.title, amount: data.amount, agent: auth.agent.name },
  });

  return NextResponse.json({ data }, { status: 201 });
}

