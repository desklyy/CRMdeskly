"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRealtime } from "@/components/providers/realtime-provider";
import {
  createTaskAction,
  deleteTaskAction,
  getEntityTasksAction,
  updateTaskAction,
} from "@/app/(crm)/actions/tasks";
import {
  formatTaskDueLabel,
  getTaskUrgencyBucket,
  TASK_TYPE_LABELS,
  TASK_TYPE_OPTIONS,
  type TaskRow,
} from "@/lib/crm/tasks";
import type { Database, TaskStatus, TaskType } from "@/types/database";

type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials"
>;

interface EntityTasksPanelProps {
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  profiles?: ProfileSlim[];
}

export function EntityTasksPanel({
  dealId = null,
  companyId = null,
  contactId = null,
  profiles = [],
}: EntityTasksPanelProps) {
  const { subscribe } = useRealtime();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayIso);
  const [taskType, setTaskType] = useState<TaskType>("follow_up");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getEntityTasksAction({ dealId, companyId, contactId });
      setTasks(list);
    } finally {
      setLoading(false);
    }
  }, [dealId, companyId, contactId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    return subscribe("tasks", (payload) => {
      if (payload.eventType === "DELETE") {
        const oldRow = payload.old as { id?: string } | undefined;
        if (oldRow?.id) {
          setTasks((prev) => prev.filter((t) => t.id !== oldRow.id));
        }
        return;
      }

      const row = payload.new as TaskRow | undefined;
      if (!row?.id) return;

      const matches =
        (dealId && row.deal_id === dealId) ||
        (!dealId && companyId && row.company_id === companyId) ||
        (!dealId && !companyId && contactId && row.contact_id === contactId);

      if (!matches) return;

      setTasks((prev) => {
        const exists = prev.some((t) => t.id === row.id);
        return exists ? prev.map((t) => (t.id === row.id ? row : t)) : [row, ...prev];
      });
    });
  }, [subscribe, dealId, companyId, contactId]);

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await createTaskAction({
        title: trimmed,
        task_type: taskType,
        due_date: dueDate || null,
        assigned_to: assignedTo || null,
        deal_id: dealId,
        company_id: companyId,
        contact_id: contactId,
      });
      if (res.data) {
        setTasks((prev) =>
          prev.some((t) => t.id === res.data!.id) ? prev : [res.data!, ...prev]
        );
        setTitle("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(task: TaskRow) {
    const nextStatus: TaskStatus =
      task.status === "completed" ? "pending" : "completed";
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t))
    );
    const res = await updateTaskAction(task.id, { status: nextStatus });
    if (res.data) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.data! : t)));
    }
  }

  async function handleDelete(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await deleteTaskAction(taskId);
  }

  const pendingTasks = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress"
  );
  const [showOlderCompleted, setShowOlderCompleted] = useState(false);
  const cutoff30Ms = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const recentCompleted = completedTasks.filter((t) => {
    const ts = new Date(t.completed_at ?? t.updated_at).getTime();
    return Number.isNaN(ts) || ts >= cutoff30Ms;
  });
  const olderCompleted = completedTasks.filter((t) => {
    const ts = new Date(t.completed_at ?? t.updated_at).getTime();
    return !Number.isNaN(ts) && ts < cutoff30Ms;
  });
  const visibleCompleted = showOlderCompleted
    ? completedTasks
    : recentCompleted;

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleCreate}
        className="space-y-2.5 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#0F172A]">
            Añadir tarea vinculada
          </span>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1658F5] hover:underline"
          >
            Ver todas las tareas
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Ej. Enviar propuesta o llamar para confirmar..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 flex-1 bg-white text-xs"
          />
          <Button type="submit" size="sm" disabled={saving || !title.trim()}>
            <Plus className="h-3.5 w-3.5" />
            Añadir
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as TaskType)}
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-[11px] text-[#334155]"
          >
            {TASK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-[11px] text-[#334155]"
          />

          {profiles.length > 0 && (
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-[11px] text-[#334155]"
            >
              <option value="">Asignarme a mí</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </form>

      {loading ? (
        <p className="py-4 text-center text-xs text-[#64748B]">Cargando tareas...</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-[#CBD5E1] p-6 text-center text-xs text-[#64748B]">
          Sin tareas vinculadas todavía.
        </div>
      ) : (
        <div className="space-y-3">
          {pendingTasks.length > 0 && (
            <div className="divide-y divide-[#F1F5F9] rounded-[4px] border border-[#E2E8F0] bg-white">
              {pendingTasks.map((t) => {
                const bucket = getTaskUrgencyBucket(t.due_date, todayIso);
                const assignee = t.assigned_to ? profileMap.get(t.assigned_to) : null;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 text-xs ${
                      bucket === "overdue"
                        ? "border-l-[3px] border-l-red-600"
                        : bucket === "today"
                          ? "border-l-[3px] border-l-[#1658F5]"
                          : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => void handleToggle(t)}
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-[#CBD5E1] text-transparent hover:border-[#1658F5] hover:text-[#1658F5]"
                        title="Completar tarea"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <div className="min-w-0">
                        <p className="font-medium text-[#0F172A]">{t.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="default" className="text-[10px]">
                            {TASK_TYPE_LABELS[t.task_type]}
                          </Badge>
                          <span
                            className={`text-[11px] font-medium ${
                              bucket === "overdue"
                                ? "text-red-600"
                                : bucket === "today"
                                  ? "text-[#1658F5]"
                                  : "text-[#64748B]"
                            }`}
                          >
                            {formatTaskDueLabel(t.due_date, todayIso)}
                          </span>
                          {assignee && (
                            <span className="text-[11px] text-[#64748B]">
                              · {assignee.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleDelete(t.id)}
                      className="p-1 text-[#94A3B8] hover:text-red-600"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {completedTasks.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                  Completadas ({recentCompleted.length} últimos 30 días)
                </p>
                {olderCompleted.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowOlderCompleted((v) => !v)}
                    className="text-[11px] font-semibold text-[#1658F5] hover:underline"
                  >
                    {showOlderCompleted
                      ? "Ocultar anteriores"
                      : `Ver anteriores (+${olderCompleted.length})`}
                  </button>
                )}
              </div>
              {visibleCompleted.length > 0 && (
                <div className="divide-y divide-[#F1F5F9] rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC]">
                  {visibleCompleted.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => void handleToggle(t)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="Reabrir tarea"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-emerald-600 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="truncate text-[#64748B] line-through">
                          {t.title}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(t.id)}
                        className="p-1 text-[#94A3B8] hover:text-red-600"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

