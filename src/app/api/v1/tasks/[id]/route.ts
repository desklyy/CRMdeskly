import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiV1, logAgentActivity } from "@/lib/api/v1-auth";
import type { Database, DealPriority, TaskStatus, TaskType } from "@/types/database";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

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
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
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
  const { data: current } = await admin
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const patch: TaskUpdate = {};
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (typeof body.task_type === "string") {
    patch.task_type = body.task_type as TaskType;
  }
  if (typeof body.priority === "string") {
    patch.priority = body.priority as DealPriority;
  }
  if (typeof body.status === "string") {
    patch.status = body.status as TaskStatus;
    if (body.status === "completed" && current.status !== "completed") {
      patch.completed_at = new Date().toISOString();
    } else if (body.status !== "completed" && current.status === "completed") {
      patch.completed_at = null;
    }
  }
  if (body.due_date === null || typeof body.due_date === "string") {
    patch.due_date = body.due_date;
  }
  if (body.assigned_to === null || typeof body.assigned_to === "string") {
    patch.assigned_to = body.assigned_to;
  }

  const { data, error } = await admin
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update task" },
      { status: 500 }
    );
  }

  if (patch.status === "completed" && current.status !== "completed") {
    await logAgentActivity({
      apiKeyId: auth.agent.apiKeyId,
      entityType: "task",
      entityId: data.id,
      companyId: data.company_id,
      contactId: data.contact_id,
      dealId: data.deal_id,
      eventType: "task_completed",
      metadata: { title: data.title },
    });
  }

  return NextResponse.json({ data });
}

