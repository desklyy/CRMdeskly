"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/supabase/auth-guard";
import { logUserActivity } from "@/lib/crm/activities";
import type { Database, DealPriority, TaskStatus, TaskType } from "@/types/database";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

export async function getEntityTasksAction(input: {
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
}) {
  const { supabase } = await requireActiveUser();

  let query = supabase
    .from("tasks")
    .select("*")
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (input.dealId) {
    query = query.eq("deal_id", input.dealId);
  } else if (input.companyId) {
    query = query.eq("company_id", input.companyId);
  } else if (input.contactId) {
    query = query.eq("contact_id", input.contactId);
  } else {
    return [];
  }

  const { data } = await query;
  return data ?? [];
}

export async function getOlderCompletedTasksAction(input: {
  beforeIso: string;
  offset?: number;
  limit?: number;
}) {
  const { supabase } = await requireActiveUser();
  const limit = Math.min(50, Math.max(1, input.limit ?? 30));
  const offset = Math.max(0, input.offset ?? 0);

  const { data, count, error } = await supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .in("status", ["completed", "cancelled"])
    .or(`completed_at.lt.${input.beforeIso},and(completed_at.is.null,updated_at.lt.${input.beforeIso})`)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return { tasks: [], total: 0, hasMore: false, error: error.message };
  }

  const list = data ?? [];
  const total = count ?? list.length;
  return {
    tasks: list,
    total,
    hasMore: offset + list.length < total,
  };
}

export async function createTaskAction(input: {
  title: string;
  task_type?: TaskType;
  priority?: DealPriority;
  due_date?: string | null;
  deal_id?: string | null;
  company_id?: string | null;
  contact_id?: string | null;
  assigned_to?: string | null;
}) {
  const { supabase, user } = await requireActiveUser();
  const title = input.title.trim();
  if (!title) {
    return { error: "El título de la tarea es obligatorio." };
  }

  let resolvedCompanyId = input.company_id || null;
  let resolvedContactId = input.contact_id || null;
  const resolvedDealId = input.deal_id || null;

  if (resolvedDealId && (!resolvedCompanyId || !resolvedContactId)) {
    const { data: deal } = await supabase
      .from("deals")
      .select("company_id, primary_contact_id")
      .eq("id", resolvedDealId)
      .maybeSingle();

    if (deal) {
      resolvedCompanyId = resolvedCompanyId ?? deal.company_id;
      resolvedContactId = resolvedContactId ?? deal.primary_contact_id;
    }
  }

  if (resolvedContactId && !resolvedCompanyId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("company_id")
      .eq("id", resolvedContactId)
      .maybeSingle();

    if (contact) {
      resolvedCompanyId = contact.company_id;
    }
  }

  const assignedTo = input.assigned_to || user.id;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      task_type: input.task_type ?? "follow_up",
      status: "pending",
      priority: input.priority ?? "medium",
      due_date: input.due_date || null,
      deal_id: resolvedDealId,
      company_id: resolvedCompanyId,
      contact_id: resolvedContactId,
      assigned_to: assignedTo,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "No se pudo crear la tarea." };
  }

  if (resolvedDealId) {
    await supabase
      .from("deals")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", resolvedDealId);
  }

  await logUserActivity({
    supabase,
    actorId: user.id,
    entityType: "task",
    entityId: data.id,
    companyId: data.company_id,
    contactId: data.contact_id,
    dealId: data.deal_id,
    eventType: "task_created",
    metadata: {
      title: data.title,
      task_type: data.task_type,
      due_date: data.due_date,
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath("/pipelines");
  revalidatePath("/companies");
  revalidatePath("/contacts");
  return { data };
}

export async function updateTaskAction(
  taskId: string,
  patch: {
    title?: string;
    task_type?: TaskType;
    status?: TaskStatus;
    priority?: DealPriority;
    due_date?: string | null;
    assigned_to?: string | null;
    deal_id?: string | null;
    company_id?: string | null;
    contact_id?: string | null;
  }
) {
  const { supabase, user } = await requireActiveUser();

  const { data: current, error: fetchErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchErr || !current) {
    return { error: "Tarea no encontrada." };
  }

  const updatePayload: TaskUpdate = { ...patch };

  if (typeof patch.title === "string") {
    const trimmed = patch.title.trim();
    if (!trimmed) return { error: "El título no puede estar vacío." };
    updatePayload.title = trimmed;
  }

  if (patch.status && patch.status !== current.status) {
    if (patch.status === "completed") {
      updatePayload.completed_at = new Date().toISOString();
    } else if (current.status === "completed") {
      updatePayload.completed_at = null;
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "No se pudo actualizar la tarea." };
  }

  if (patch.status === "completed" && current.status !== "completed") {
    if (data.deal_id) {
      await supabase
        .from("deals")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", data.deal_id);
    }

    await logUserActivity({
      supabase,
      actorId: user.id,
      entityType: "task",
      entityId: data.id,
      companyId: data.company_id,
      contactId: data.contact_id,
      dealId: data.deal_id,
      eventType: "task_completed",
      metadata: {
        title: data.title,
        task_type: data.task_type,
      },
    });
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath("/pipelines");
  return { data };
}

export async function deleteTaskAction(taskId: string) {
  const { supabase } = await requireActiveUser();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };

  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath("/pipelines");
  return { ok: true };
}

