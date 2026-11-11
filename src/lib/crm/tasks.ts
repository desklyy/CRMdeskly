import type { Database, DealPriority, TaskStatus, TaskType } from "@/types/database";

export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "follow_up", label: "Seguimiento" },
  { value: "call", label: "Llamada" },
  { value: "email", label: "Email" },
  { value: "quote", label: "Presupuesto" },
  { value: "meeting", label: "Reunión" },
  { value: "technical", label: "Técnica" },
  { value: "other", label: "Otra" },
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  follow_up: "Seguimiento",
  call: "Llamada",
  email: "Email",
  quote: "Presupuesto",
  meeting: "Reunión",
  technical: "Técnica",
  other: "Otra",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};

export const TASK_PRIORITY_META: Record<
  DealPriority,
  { label: string; badgeVariant: "default" | "brand" | "warning" | "destructive" }
> = {
  low: { label: "Baja", badgeVariant: "default" },
  medium: { label: "Media", badgeVariant: "brand" },
  high: { label: "Alta", badgeVariant: "warning" },
  urgent: { label: "Urgente", badgeVariant: "destructive" },
};

export type TaskUrgencyBucket = "overdue" | "today" | "upcoming" | "nodate";

export function getTaskUrgencyBucket(
  dueDate: string | null,
  todayIso: string
): TaskUrgencyBucket {
  if (!dueDate) return "nodate";
  if (dueDate < todayIso) return "overdue";
  if (dueDate === todayIso) return "today";
  return "upcoming";
}

export function addDaysIso(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function formatTaskDueLabel(dueDate: string | null, todayIso: string): string {
  if (!dueDate) return "Sin fecha";
  if (dueDate === todayIso) return "Hoy";
  if (dueDate === addDaysIso(todayIso, 1)) return "Mañana";
  const [y, m, d] = dueDate.split("-");
  return `${d}/${m}/${y}`;
}

