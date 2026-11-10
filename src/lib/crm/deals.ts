import type { Database } from "@/types/database";

export type DealRow = Database["public"]["Tables"]["deals"]["Row"];
export type PipelineRow = Database["public"]["Tables"]["pipelines"]["Row"];
export type StageRow = Database["public"]["Tables"]["pipeline_stages"]["Row"];

/**
 * Calcula una posición fraccional entre dos tarjetas adyacentes para actualizar
 * una única fila por movimiento sin cascadas Realtime.
 */
export function computeFractionalPosition(
  prevPosition: number | null,
  nextPosition: number | null
): number {
  if (prevPosition === null && nextPosition === null) {
    return 1000;
  }
  if (prevPosition === null && nextPosition !== null) {
    return nextPosition / 2;
  }
  if (prevPosition !== null && nextPosition === null) {
    return prevPosition + 1000;
  }
  return ((prevPosition as number) + (nextPosition as number)) / 2;
}

/**
 * Determina si un negocio abierto supera el umbral de estancamiento configurado
 * en su etapa o en el pipeline global.
 */
export function isDealStale(
  deal: Pick<DealRow, "status" | "stage_changed_at" | "last_activity_at">,
  stage: Pick<StageRow, "stale_days_override"> | undefined,
  pipeline: Pick<PipelineRow, "stale_days_default"> | undefined
): { stale: boolean; daysIdle: number; thresholdDays: number } {
  const thresholdDays = stage?.stale_days_override ?? pipeline?.stale_days_default ?? 7;

  if (deal.status !== "open") {
    return { stale: false, daysIdle: 0, thresholdDays };
  }

  const stageMs = new Date(deal.stage_changed_at).getTime();
  const activityMs = new Date(deal.last_activity_at).getTime();
  const latestMs = Math.max(stageMs, activityMs);
  const daysIdle = Math.floor((Date.now() - latestMs) / (1000 * 60 * 60 * 24));

  return {
    stale: daysIdle >= thresholdDays,
    daysIdle: Math.max(0, daysIdle),
    thresholdDays,
  };
}

export const PRIORITY_META: Record<
  DealRow["priority"],
  { label: string; variant: "default" | "warning" | "destructive" }
> = {
  low: { label: "Baja", variant: "default" },
  medium: { label: "Media", variant: "default" },
  high: { label: "Alta", variant: "warning" },
  urgent: { label: "Urgente", variant: "destructive" },
};

export const LOST_REASONS = [
  "Precio / Presupuesto",
  "Timing / No es prioridad ahora",
  "Eligió competidor",
  "Sin respuesta / Ghosting",
  "Alcance fuera de encaje",
  "Otro",
] as const;

