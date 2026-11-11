import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  logAgentActivity,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";
import type { DealPriority, TaskStatus, TaskType } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 25, 50);
  const status = sp.get("status")?.trim() as TaskStatus | null;
  const assignedTo = sp.get("assigned_to")?.trim();
  const dealId = sp.get("deal_id")?.trim();
  const companyId = sp.get("company_id")?.trim();
  const contactId = sp.get("contact_id")?.trim();

  const admin = createAdminClient();
  let query = admin
    .from("tasks")
    .select("*", { count: "exact" })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);
  if (dealId) query = query.eq("deal_id", dealId);
  if (companyId) query = query.eq("company_id", companyId);
  if (contactId) query = query.eq("contact_id", contactId);

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
  const dealId = typeof body.deal_id === "string" ? body.deal_id : null;
  let companyId = typeof body.company_id === "string" ? body.company_id : null;
  let contactId = typeof body.contact_id === "string" ? body.contact_id : null;

  if (dealId && (!companyId || !contactId)) {
    const { data: deal } = await admin
      .from("deals")
      .select("company_id, primary_contact_id")
      .eq("id", dealId)
      .maybeSingle();
    if (deal) {
      companyId = companyId ?? deal.company_id;
      contactId = contactId ?? deal.primary_contact_id;
    }
  }

  const validTypes: TaskType[] = [
    "call",
    "email",
    "meeting",
    "quote",
    "technical",
    "follow_up",
    "other",
  ];
  const validPriorities: DealPriority[] = ["low", "medium", "high", "urgent"];

  const taskType =
    typeof body.task_type === "string" && validTypes.includes(body.task_type as TaskType)
      ? (body.task_type as TaskType)
      : "follow_up";
  const priority =
    typeof body.priority === "string" &&
    validPriorities.includes(body.priority as DealPriority)
      ? (body.priority as DealPriority)
      : "medium";

  const { data, error } = await admin
    .from("tasks")
    .insert({
      title: body.title.trim(),
      task_type: taskType,
      status: "pending",
      priority,
      due_date: typeof body.due_date === "string" ? body.due_date : null,
      deal_id: dealId,
      company_id: companyId,
      contact_id: contactId,
      assigned_to: typeof body.assigned_to === "string" ? body.assigned_to : null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create task" },
      { status: 500 }
    );
  }

  await logAgentActivity({
    apiKeyId: auth.agent.apiKeyId,
    entityType: "task",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.contact_id,
    dealId: data.deal_id,
    eventType: "task_created",
    metadata: { title: data.title, task_type: data.task_type },
  });

  return NextResponse.json({ data }, { status: 201 });
}

