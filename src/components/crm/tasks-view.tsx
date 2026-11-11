"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Kanban,
  List,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRealtime } from "@/components/providers/realtime-provider";
import {
  createTaskAction,
  deleteTaskAction,
  getOlderCompletedTasksAction,
  updateTaskAction,
} from "@/app/(crm)/actions/tasks";
import {
  addDaysIso,
  formatTaskDueLabel,
  getTaskUrgencyBucket,
  TASK_PRIORITY_META,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  TASK_TYPE_OPTIONS,
  type TaskRow,
  type TaskUrgencyBucket,
} from "@/lib/crm/tasks";
import type { Database, DealPriority, TaskStatus, TaskType } from "@/types/database";

type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role"
>;
type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ContactSlim = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "first_name" | "last_name" | "company_id"
>;
type DealSlim = Pick<
  Database["public"]["Tables"]["deals"]["Row"],
  "id" | "title" | "company_id" | "status"
>;

interface TasksViewProps {
  currentUserId: string;
  initialTasks: TaskRow[];
  olderCompletedCount: number;
  completedCutoffIso: string;
  profiles: ProfileSlim[];
  companies: CompanySlim[];
  contacts: ContactSlim[];
  deals: DealSlim[];
}

type ScopeTab = "mine" | "team" | "completed";
type ViewMode = "list" | "board";

const BUCKET_META: Record<
  TaskUrgencyBucket,
  { title: string; borderAccent: string; textClass: string }
> = {
  overdue: {
    title: "Vencidas",
    borderAccent: "border-l-[3px] border-l-red-600",
    textClass: "text-red-700",
  },
  today: {
    title: "Para hoy",
    borderAccent: "border-l-[3px] border-l-[#1658F5]",
    textClass: "text-[#1658F5]",
  },
  upcoming: {
    title: "Próximos días",
    borderAccent: "border-l-[3px] border-l-slate-300",
    textClass: "text-[#0F172A]",
  },
  nodate: {
    title: "Sin fecha programada",
    borderAccent: "border-l-[3px] border-l-slate-200",
    textClass: "text-[#64748B]",
  },
};

const BUCKET_ORDER: TaskUrgencyBucket[] = ["overdue", "today", "upcoming", "nodate"];

export function TasksView({
  currentUserId,
  initialTasks,
  olderCompletedCount,
  completedCutoffIso,
  profiles,
  companies,
  contacts,
  deals,
}: TasksViewProps) {
  const searchParams = useSearchParams();
  const { subscribe } = useRealtime();
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tomorrowIso = useMemo(() => addDaysIso(todayIso, 1), [todayIso]);
  const nextWeekIso = useMemo(() => addDaysIso(todayIso, 7), [todayIso]);

  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [scope, setScope] = useState<ScopeTab>("mine");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [urgencyQuickFilter, setUrgencyQuickFilter] = useState<
    "" | "overdue" | "today" | "upcoming"
  >("");

  // Quick-add state
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<TaskType>("follow_up");
  const [newPriority, setNewPriority] = useState<DealPriority>("medium");
  const [newDueDate, setNewDueDate] = useState<string>(todayIso);
  const [newAssignee, setNewAssignee] = useState<string>(currentUserId);
  const [newDealId, setNewDealId] = useState<string>("");
  const [newCompanyId, setNewCompanyId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Inline title editing
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Older completed (>30 days) lazy pagination
  const [olderOffset, setOlderOffset] = useState(0);
  const [remainingOlderCount, setRemainingOlderCount] =
    useState(olderCompletedCount);
  const [loadingOlder, setLoadingOlder] = useState(false);

  async function handleLoadOlderCompleted() {
    setLoadingOlder(true);
    try {
      const res = await getOlderCompletedTasksAction({
        beforeIso: completedCutoffIso,
        offset: olderOffset,
        limit: 30,
      });
      if (res.tasks.length > 0) {
        setTasks((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const merged = [...prev];
          for (const t of res.tasks) {
            if (!existingIds.has(t.id)) merged.push(t);
          }
          return merged;
        });
      }
      const nextOffset = olderOffset + res.tasks.length;
      setOlderOffset(nextOffset);
      setRemainingOlderCount(Math.max(0, res.total - nextOffset));
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      quickInputRef.current?.focus();
    }
  }, [searchParams]);

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

      setTasks((prev) => {
        const exists = prev.some((t) => t.id === row.id);
        return exists ? prev.map((t) => (t.id === row.id ? row : t)) : [row, ...prev];
      });
    });
  }, [subscribe]);

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );
  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies]
  );
  const contactMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts]
  );
  const dealMap = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  const openDeals = useMemo(
    () => deals.filter((d) => d.status === "open"),
    [deals]
  );

  // Counters for the top summary cards (focused on current user when in "mine", else global)
  const metrics = useMemo(() => {
    const scopePool =
      scope === "team"
        ? tasks
        : tasks.filter((t) => t.assigned_to === currentUserId);
    const active = scopePool.filter(
      (t) => t.status === "pending" || t.status === "in_progress"
    );
    const completed = scopePool.filter((t) => t.status === "completed");

    let overdue = 0;
    let today = 0;
    let upcoming = 0;
    for (const t of active) {
      const b = getTaskUrgencyBucket(t.due_date, todayIso);
      if (b === "overdue") overdue++;
      else if (b === "today") today++;
      else upcoming++;
    }

    return {
      overdue,
      today,
      upcoming,
      completed: completed.length,
    };
  }, [tasks, scope, currentUserId, todayIso]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();

    return tasks
      .filter((t) => {
        if (scope === "completed") {
          if (t.status !== "completed" && t.status !== "cancelled") return false;
        } else {
          if (t.status !== "pending" && t.status !== "in_progress") return false;
          if (scope === "mine" && t.assigned_to !== currentUserId) return false;
        }

        if (typeFilter && t.task_type !== typeFilter) return false;
        if (scope === "team" && assigneeFilter && t.assigned_to !== assigneeFilter) {
          return false;
        }

        if (scope !== "completed" && urgencyQuickFilter) {
          const bucket = getTaskUrgencyBucket(t.due_date, todayIso);
          if (urgencyQuickFilter === "overdue" && bucket !== "overdue") return false;
          if (urgencyQuickFilter === "today" && bucket !== "today") return false;
          if (
            urgencyQuickFilter === "upcoming" &&
            bucket !== "upcoming" &&
            bucket !== "nodate"
          ) {
            return false;
          }
        }

        if (q) {
          const compName = t.company_id
            ? companyMap.get(t.company_id)?.name ?? ""
            : "";
          const dealTitle = t.deal_id ? dealMap.get(t.deal_id)?.title ?? "" : "";
          const cont = t.contact_id ? contactMap.get(t.contact_id) : undefined;
          const contName = cont
            ? [cont.first_name, cont.last_name].filter(Boolean).join(" ")
            : "";

          const matches =
            t.title.toLowerCase().includes(q) ||
            compName.toLowerCase().includes(q) ||
            dealTitle.toLowerCase().includes(q) ||
            contName.toLowerCase().includes(q);
          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (scope === "completed") {
          return (b.completed_at ?? b.updated_at).localeCompare(
            a.completed_at ?? a.updated_at
          );
        }
        if (a.due_date && b.due_date && a.due_date !== b.due_date) {
          return a.due_date.localeCompare(b.due_date);
        }
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [
    tasks,
    scope,
    currentUserId,
    typeFilter,
    assigneeFilter,
    urgencyQuickFilter,
    todayIso,
    search,
    companyMap,
    dealMap,
    contactMap,
  ]);

  const groupedByUrgency = useMemo(() => {
    const map: Record<TaskUrgencyBucket, TaskRow[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      nodate: [],
    };
    for (const t of filteredTasks) {
      map[getTaskUrgencyBucket(t.due_date, todayIso)].push(t);
    }
    return map;
  }, [filteredTasks, todayIso]);

  const boardColumns = useMemo(() => {
    const activePool = tasks.filter((t) => {
      if (scope === "mine" && t.assigned_to !== currentUserId) return false;
      if (typeFilter && t.task_type !== typeFilter) return false;
      if (scope === "team" && assigneeFilter && t.assigned_to !== assigneeFilter) {
        return false;
      }
      return true;
    });
    return {
      pending: activePool.filter((t) => t.status === "pending"),
      in_progress: activePool.filter((t) => t.status === "in_progress"),
      completed: activePool.filter((t) => t.status === "completed").slice(0, 20),
    };
  }, [tasks, scope, currentUserId, typeFilter, assigneeFilter]);

  async function handleQuickCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setFormError("Escribe qué hay que hacer.");
      return;
    }

    setFormError(null);
    setCreating(true);
    try {
      const selectedDeal = newDealId ? dealMap.get(newDealId) : undefined;
      const res = await createTaskAction({
        title: trimmed,
        task_type: newType,
        priority: newPriority,
        due_date: newDueDate || null,
        assigned_to: newAssignee || currentUserId,
        deal_id: newDealId || null,
        company_id: newCompanyId || selectedDeal?.company_id || null,
      });

      if (res.error) {
        setFormError(res.error);
        return;
      }

      if (res.data) {
        setTasks((prev) =>
          prev.some((t) => t.id === res.data!.id) ? prev : [res.data!, ...prev]
        );
        setNewTitle("");
        setNewDealId("");
        setNewCompanyId("");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleComplete(task: TaskRow) {
    const nextStatus: TaskStatus =
      task.status === "completed" ? "pending" : "completed";
    const optimisticAt =
      nextStatus === "completed" ? new Date().toISOString() : null;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: nextStatus, completed_at: optimisticAt }
          : t
      )
    );

    const res = await updateTaskAction(task.id, { status: nextStatus });
    if (res.data) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.data! : t)));
    } else if (res.error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    }
  }

  async function handleQuickPatch(
    task: TaskRow,
    patch: Parameters<typeof updateTaskAction>[1]
  ) {
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t))
    );
    const res = await updateTaskAction(task.id, patch);
    if (res.data) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.data! : t)));
    } else if (res.error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    }
  }

  async function handleSaveInlineTitle(task: TaskRow) {
    const trimmed = editingTitle.trim();
    setEditingTaskId(null);
    if (!trimmed || trimmed === task.title) return;
    await handleQuickPatch(task, { title: trimmed });
  }

  async function handleDelete(taskId: string) {
    const prev = tasks;
    setTasks((curr) => curr.filter((t) => t.id !== taskId));
    const res = await deleteTaskAction(taskId);
    if (!res.ok) {
      setTasks(prev);
    }
  }

  function renderTaskRow(task: TaskRow) {
    const isCompleted = task.status === "completed";
    const isInProgress = task.status === "in_progress";
    const bucket = getTaskUrgencyBucket(task.due_date, todayIso);
    const priorityMeta = TASK_PRIORITY_META[task.priority];
    const assignee = task.assigned_to ? profileMap.get(task.assigned_to) : null;
    const company = task.company_id ? companyMap.get(task.company_id) : null;
    const deal = task.deal_id ? dealMap.get(task.deal_id) : null;
    const contact = task.contact_id ? contactMap.get(task.contact_id) : null;

    return (
      <div
        key={task.id}
        className={`group flex flex-col gap-2.5 rounded-[4px] border border-[#E2E8F0] bg-white px-4 py-3 transition-colors hover:border-[#CBD5E1] sm:flex-row sm:items-center sm:justify-between ${!isCompleted && bucket === "overdue"
            ? "border-l-[3px] border-l-red-600"
            : !isCompleted && bucket === "today"
              ? "border-l-[3px] border-l-[#1658F5]"
              : ""
          }`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            onClick={() => void handleToggleComplete(task)}
            title={isCompleted ? "Reabrir tarea" : "Marcar como completada"}
            aria-label={isCompleted ? "Reabrir tarea" : "Completar tarea"}
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${isCompleted
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-[#CBD5E1] bg-white text-transparent hover:border-[#1658F5] hover:text-[#1658F5]"
              }`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>

          <div className="min-w-0 flex-1">
            {editingTaskId === task.id ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => void handleSaveInlineTitle(task)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSaveInlineTitle(task);
                  } else if (e.key === "Escape") {
                    setEditingTaskId(null);
                  }
                }}
                className="h-7 w-full rounded-[4px] border border-[#1658F5] bg-white px-2 text-sm font-medium text-[#0F172A] focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingTaskId(task.id);
                  setEditingTitle(task.title);
                }}
                title="Haz clic para editar el título"
                className={`text-left text-sm font-medium transition-colors hover:text-[#1658F5] ${isCompleted ? "text-[#94A3B8] line-through" : "text-[#0F172A]"
                  }`}
              >
                {task.title}
              </button>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="default" className="text-[10px]">
                {TASK_TYPE_LABELS[task.task_type]}
              </Badge>

              {(task.priority === "high" || task.priority === "urgent") && (
                <Badge variant={priorityMeta.badgeVariant} className="text-[10px]">
                  {priorityMeta.label}
                </Badge>
              )}

              {isInProgress && (
                <Badge variant="brand" className="text-[10px]">
                  En curso
                </Badge>
              )}

              {deal && (
                <Link
                  href={`/pipelines?deal=${deal.id}`}
                  className="inline-flex items-center gap-1 rounded-[3px] border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-medium text-[#1658F5] hover:border-[#1658F5]"
                >
                  {deal.title}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}

              {company && (
                <Link
                  href={`/companies?id=${company.id}`}
                  className="inline-flex items-center gap-1 rounded-[3px] border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-medium text-[#334155] hover:border-[#1658F5] hover:text-[#1658F5]"
                >
                  {company.name}
                </Link>
              )}

              {contact && (
                <Link
                  href={`/contacts?id=${contact.id}`}
                  className="inline-flex items-center gap-1 rounded-[3px] border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] text-[#64748B] hover:border-[#1658F5] hover:text-[#1658F5]"
                >
                  {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
          {!isCompleted && (
            <select
              value={task.status}
              onChange={(e) =>
                void handleQuickPatch(task, {
                  status: e.target.value as TaskStatus,
                })
              }
              title="Estado"
              className="h-7 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-2 text-[11px] font-medium text-[#334155] focus:border-[#1658F5] focus:outline-none"
            >
              <option value="pending">Pendiente</option>
              <option value="in_progress">En curso</option>
              <option value="completed">Completada</option>
            </select>
          )}

          {!isCompleted && bucket === "overdue" && (
            <button
              type="button"
              onClick={() => void handleQuickPatch(task, { due_date: todayIso })}
              className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-[11px] font-semibold text-[#1658F5] hover:border-[#1658F5]"
              title="Mover fecha a hoy"
            >
              Mover a hoy
            </button>
          )}

          <div className="flex items-center gap-1">
            <input
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) =>
                void handleQuickPatch(task, { due_date: e.target.value || null })
              }
              aria-label="Fecha límite"
              className={`h-7 rounded-[4px] border px-2 text-[11px] font-medium focus:border-[#1658F5] focus:outline-none ${!isCompleted && bucket === "overdue"
                  ? "border-red-200 bg-red-50/50 text-red-700"
                  : !isCompleted && bucket === "today"
                    ? "border-[#1658F5]/30 bg-[#1658F5]/5 text-[#1658F5]"
                    : "border-[#E2E8F0] bg-white text-[#64748B]"
                }`}
            />
          </div>

          <select
            value={task.assigned_to ?? ""}
            onChange={(e) =>
              void handleQuickPatch(task, {
                assigned_to: e.target.value || null,
              })
            }
            aria-label="Responsable"
            title={assignee ? `Responsable: ${assignee.full_name}` : "Sin asignar"}
            className="h-7 max-w-[130px] rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-[11px] text-[#334155] focus:border-[#1658F5] focus:outline-none"
          >
            <option value="">Sin asignar</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void handleDelete(task.id)}
            title="Eliminar tarea"
            aria-label="Eliminar tarea"
            className="rounded-[4px] p-1 text-[#94A3B8] opacity-70 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-[#0F172A]">
            Tareas
          </h1>
          <p className="text-xs text-[#64748B]">
            Seguimiento diario del equipo · Apunta en 1 línea y tacha al instante
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-[4px] border border-[#E2E8F0] bg-white p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${viewMode === "list"
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:text-[#0F172A]"
              }`}
          >
            <List className="h-3.5 w-3.5" />
            Lista por fecha
          </button>
          <button
            type="button"
            onClick={() => setViewMode("board")}
            className={`inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${viewMode === "board"
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:text-[#0F172A]"
              }`}
          >
            <Kanban className="h-3.5 w-3.5" />
            Tablero
          </button>
        </div>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            if (scope === "completed") setScope("mine");
            setUrgencyQuickFilter((prev) => (prev === "overdue" ? "" : "overdue"));
          }}
          className={`rounded-[4px] border bg-white p-4 text-left transition-colors ${urgencyQuickFilter === "overdue"
              ? "border-red-600 border-l-[3px]"
              : "border-[#E2E8F0] border-l-[3px] border-l-red-600 hover:border-[#CBD5E1]"
            }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Vencidas</span>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-[-0.02em] text-red-700">
            {metrics.overdue}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            if (scope === "completed") setScope("mine");
            setUrgencyQuickFilter((prev) => (prev === "today" ? "" : "today"));
          }}
          className={`rounded-[4px] border bg-white p-4 text-left transition-colors ${urgencyQuickFilter === "today"
              ? "border-[#1658F5] border-l-[3px]"
              : "border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] hover:border-[#CBD5E1]"
            }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Para hoy</span>
            <Calendar className="h-4 w-4 text-[#1658F5]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-[-0.02em] text-[#1658F5]">
            {metrics.today}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            if (scope === "completed") setScope("mine");
            setUrgencyQuickFilter((prev) => (prev === "upcoming" ? "" : "upcoming"));
          }}
          className={`rounded-[4px] border bg-white p-4 text-left transition-colors ${urgencyQuickFilter === "upcoming"
              ? "border-[#0F172A]"
              : "border-[#E2E8F0] hover:border-[#CBD5E1]"
            }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Próximas / Sin fecha</span>
            <Clock className="h-4 w-4 text-[#64748B]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            {metrics.upcoming}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setUrgencyQuickFilter("");
            setScope((prev) => (prev === "completed" ? "mine" : "completed"));
          }}
          className={`rounded-[4px] border bg-white p-4 text-left transition-colors ${scope === "completed"
              ? "border-emerald-600"
              : "border-[#E2E8F0] hover:border-[#CBD5E1]"
            }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Completadas</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-[-0.02em] text-emerald-700">
            {metrics.completed}
          </p>
        </button>
      </div>

      {/* Quick Create Bar */}
      <form
        onSubmit={handleQuickCreate}
        className="space-y-3 rounded-[4px] border border-[#E2E8F0] bg-white p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={quickInputRef}
            placeholder="Nueva tarea rápida... (ej. Llamar a Conthidra para revisar propuesta)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="h-9 flex-1 text-sm"
          />
          <Button type="submit" size="sm" disabled={creating} className="h-9 px-4">
            <Plus className="h-4 w-4" />
            {creating ? "Añadiendo..." : "Añadir tarea"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Quick date chips */}
          <div className="inline-flex items-center rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
            <button
              type="button"
              onClick={() => setNewDueDate(todayIso)}
              className={`rounded-[3px] px-2 py-1 text-[11px] font-semibold ${newDueDate === todayIso
                  ? "bg-[#1658F5] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setNewDueDate(tomorrowIso)}
              className={`rounded-[3px] px-2 py-1 text-[11px] font-semibold ${newDueDate === tomorrowIso
                  ? "bg-[#1658F5] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              Mañana
            </button>
            <button
              type="button"
              onClick={() => setNewDueDate(nextWeekIso)}
              className={`rounded-[3px] px-2 py-1 text-[11px] font-semibold ${newDueDate === nextWeekIso
                  ? "bg-[#1658F5] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              +7 días
            </button>
            <button
              type="button"
              onClick={() => setNewDueDate("")}
              className={`rounded-[3px] px-2 py-1 text-[11px] font-semibold ${newDueDate === ""
                  ? "bg-[#0F172A] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              Sin fecha
            </button>
          </div>

          <input
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            aria-label="Fecha personalizada"
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          />

          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as TaskType)}
            aria-label="Tipo de tarea"
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          >
            {TASK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Tipo: {opt.label}
              </option>
            ))}
          </select>

          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as DealPriority)}
            aria-label="Prioridad"
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          >
            <option value="low">Prioridad: Baja</option>
            <option value="medium">Prioridad: Media</option>
            <option value="high">Prioridad: Alta</option>
            <option value="urgent">Prioridad: Urgente</option>
          </select>

          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            aria-label="Asignar a"
            className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                Para: {p.full_name}
              </option>
            ))}
          </select>

          <select
            value={newDealId}
            onChange={(e) => {
              const dealId = e.target.value;
              setNewDealId(dealId);
              if (dealId) {
                const d = dealMap.get(dealId);
                if (d?.company_id) setNewCompanyId(d.company_id);
              }
            }}
            aria-label="Negocio vinculado"
            className="h-7 max-w-[200px] rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          >
            <option value="">Negocio (opcional)...</option>
            {openDeals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>

          <select
            value={newCompanyId}
            onChange={(e) => setNewCompanyId(e.target.value)}
            aria-label="Empresa vinculada"
            className="h-7 max-w-[180px] rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
          >
            <option value="">Empresa (opcional)...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {formError && <p className="text-xs text-red-600">{formError}</p>}
      </form>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[4px] border border-[#E2E8F0] bg-white p-0.5">
            {(
              [
                { key: "mine", label: "Mis tareas" },
                { key: "team", label: "Todo el equipo" },
                { key: "completed", label: "Completadas" },
              ] as { key: ScopeTab; label: string }[]
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setScope(item.key);
                  setUrgencyQuickFilter("");
                }}
                className={`rounded-[3px] px-3 py-1 text-xs font-semibold transition-colors ${scope === item.key
                    ? "bg-[#0F172A] text-white"
                    : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {urgencyQuickFilter && (
            <button
              type="button"
              onClick={() => setUrgencyQuickFilter("")}
              className="inline-flex items-center gap-1 rounded-[4px] border border-[#1658F5]/30 bg-[#1658F5]/5 px-2.5 py-1 text-xs font-semibold text-[#1658F5]"
            >
              Filtro:{" "}
              {urgencyQuickFilter === "overdue"
                ? "Vencidas"
                : urgencyQuickFilter === "today"
                  ? "Para hoy"
                  : "Próximas"}
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#64748B]" />
            <Input
              placeholder="Buscar tarea, empresa o negocio..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#334155]"
          >
            <option value="">Todos los tipos</option>
            {TASK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {scope === "team" && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-8 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#334155]"
            >
              <option value="">Todo el equipo</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Content: List View vs Board View */}
      {viewMode === "list" ? (
        scope === "completed" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B]">
              <span>
                {olderOffset > 0
                  ? `Mostrando últimos 30 días + ${olderOffset} anteriores`
                  : "Mostrando completadas en los últimos 30 días"}
              </span>
              {remainingOlderCount > 0 && (
                <button
                  type="button"
                  disabled={loadingOlder}
                  onClick={() => void handleLoadOlderCompleted()}
                  className="font-semibold text-[#1658F5] hover:underline disabled:opacity-50"
                >
                  {loadingOlder
                    ? "Cargando anteriores..."
                    : `Ver anteriores (+${remainingOlderCount})`}
                </button>
              )}
            </div>

            {filteredTasks.length === 0 ? (
              <div className="rounded-[4px] border border-dashed border-[#CBD5E1] bg-white p-10 text-center text-xs text-[#64748B]">
                No hay tareas completadas en los últimos 30 días.
                {remainingOlderCount > 0 && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loadingOlder}
                      onClick={() => void handleLoadOlderCompleted()}
                    >
                      {loadingOlder
                        ? "Cargando..."
                        : `Ver anteriores (${remainingOlderCount})`}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">{filteredTasks.map(renderTaskRow)}</div>
                {remainingOlderCount > 0 && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loadingOlder}
                      onClick={() => void handleLoadOlderCompleted()}
                    >
                      {loadingOlder
                        ? "Cargando anteriores..."
                        : `Ver anteriores (+${remainingOlderCount} de hace más de 30 días)`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-[4px] border border-dashed border-[#CBD5E1] bg-white p-10 text-center text-xs text-[#64748B]">
            No tienes tareas pendientes en esta vista. ¡Buen trabajo!
          </div>
        ) : (
          <div className="space-y-6">
            {BUCKET_ORDER.map((bucketKey) => {
              const items = groupedByUrgency[bucketKey];
              if (items.length === 0) return null;
              const meta = BUCKET_META[bucketKey];
              return (
                <section key={bucketKey} className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2
                      className={`text-xs font-bold uppercase tracking-wider ${meta.textClass}`}
                    >
                      {meta.title} ({items.length})
                    </h2>
                  </div>
                  <div className="space-y-2">{items.map(renderTaskRow)}</div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {(
            [
              { key: "pending", title: "Pendientes", items: boardColumns.pending },
              { key: "in_progress", title: "En curso", items: boardColumns.in_progress },
              { key: "completed", title: "Completadas", items: boardColumns.completed },
            ] as { key: TaskStatus; title: string; items: TaskRow[] }[]
          ).map((col) => (
            <div
              key={col.key}
              className="flex min-h-[420px] flex-col rounded-[4px] border border-[#E2E8F0] bg-white"
            >
              <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">
                  {col.title}
                </span>
                <Badge variant={col.key === "completed" ? "success" : "default"}>
                  {col.items.length}
                </Badge>
              </div>
              <div className="flex-1 space-y-2.5 bg-[#F8FAFC] p-3">
                {col.items.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#94A3B8]">
                    Sin tareas en {TASK_STATUS_LABELS[col.key].toLowerCase()}.
                  </p>
                ) : (
                  col.items.map((t) => {
                    const company = t.company_id ? companyMap.get(t.company_id) : null;
                    const deal = t.deal_id ? dealMap.get(t.deal_id) : null;
                    const assignee = t.assigned_to ? profileMap.get(t.assigned_to) : null;
                    const bucket = getTaskUrgencyBucket(t.due_date, todayIso);
                    return (
                      <div
                        key={t.id}
                        className={`rounded-[4px] border border-[#E2E8F0] bg-white p-3 ${t.status !== "completed" && bucket === "overdue"
                            ? "border-l-[3px] border-l-red-600"
                            : t.status !== "completed" && bucket === "today"
                              ? "border-l-[3px] border-l-[#1658F5]"
                              : ""
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-sm font-medium ${t.status === "completed"
                                ? "text-[#94A3B8] line-through"
                                : "text-[#0F172A]"
                              }`}
                          >
                            {t.title}
                          </p>
                          {assignee && (
                            <span
                              title={assignee.full_name}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-slate-900 text-[10px] font-bold text-white"
                            >
                              {assignee.avatar_initials}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="default" className="text-[10px]">
                            {TASK_TYPE_LABELS[t.task_type]}
                          </Badge>
                          <span
                            className={`text-[11px] font-medium ${t.status !== "completed" && bucket === "overdue"
                                ? "text-red-600"
                                : t.status !== "completed" && bucket === "today"
                                  ? "text-[#1658F5]"
                                  : "text-[#64748B]"
                              }`}
                          >
                            {formatTaskDueLabel(t.due_date, todayIso)}
                          </span>
                          {(deal || company) && (
                            <Link
                              href={
                                deal
                                  ? `/pipelines?deal=${deal.id}`
                                  : `/companies?id=${company!.id}`
                              }
                              className="truncate text-[11px] font-medium text-[#1658F5] hover:underline"
                            >
                              · {deal ? deal.title : company!.name}
                            </Link>
                          )}
                        </div>

                        <div className="mt-2.5 flex items-center justify-between border-t border-[#F1F5F9] pt-2">
                          <div className="flex items-center gap-1.5">
                            {t.status !== "in_progress" && t.status !== "completed" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleQuickPatch(t, { status: "in_progress" })
                                }
                                className="rounded-[3px] border border-[#E2E8F0] px-2 py-0.5 text-[11px] font-medium text-[#334155] hover:border-[#1658F5] hover:text-[#1658F5]"
                              >
                                Iniciar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleToggleComplete(t)}
                              className="inline-flex items-center gap-1 rounded-[3px] border border-[#E2E8F0] px-2 py-0.5 text-[11px] font-medium text-[#334155] hover:border-emerald-600 hover:text-emerald-700"
                            >
                              {t.status === "completed" ? (
                                <>
                                  <Circle className="h-3 w-3" /> Reabrir
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3" /> Completar
                                </>
                              )}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDelete(t.id)}
                            className="p-1 text-[#94A3B8] hover:text-red-600"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

