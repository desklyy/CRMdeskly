"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  TrendingUp,
  Users,
  Wallet,
  Target,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRealtime } from "@/components/providers/realtime-provider";
import { formatCurrencyEUR } from "@/lib/crm/custom-fields";
import type { Database } from "@/types/database";

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

export interface DashboardKPIs {
  leadsThisMonth: number;
  openPipelineValue: number;
  openDealsCount: number;
  winRatePct: number;
  averageTicket: number;
}

export interface EvolutionDealPoint {
  amount: number;
  status: "open" | "won" | "lost";
  created_at: string;
  closed_at: string | null;
}

export interface EvolutionChartBucket {
  label: string;
  pipeline: number;
  won: number;
}

export interface FunnelPoint {
  stage: string;
  deals: number;
  value: number;
}

export interface NextActionItem {
  dealId: string;
  dealTitle: string;
  companyName: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  amount: number;
}

interface DashboardViewProps {
  kpis: DashboardKPIs;
  evolutionDeals: EvolutionDealPoint[];
  funnelSeries: FunnelPoint[];
  nextActions: NextActionItem[];
  initialActivities: ActivityRow[];
  profileNames: Record<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SPAN_DAYS = 180;
const MIN_SPAN_DAYS = 7;
const MAX_SPAN_DAYS = 730;

function startOfDayUtcMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseIsoDayMs(iso: string): number {
  const day = iso.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return startOfDayUtcMs(new Date());
  return Date.UTC(y, m - 1, d);
}

function getIsoWeekStartMs(dayMs: number): number {
  const dt = new Date(dayMs);
  const day = dt.getUTCDay();
  const diffToMon = (day + 6) % 7;
  return dayMs - diffToMon * DAY_MS;
}

function formatShortDateEs(ms: number, includeYear = false): string {
  return new Date(ms).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

function buildFluidEvolutionSeries(
  deals: EvolutionDealPoint[],
  startMs: number,
  endMs: number
): {
  points: EvolutionChartBucket[];
  granularityLabel: "Por días" | "Por semanas" | "Por meses";
  rangeLabel: string;
  totalPipeline: number;
  totalWon: number;
} {
  const spanDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  const granularity: "day" | "week" | "month" =
    spanDays <= 45 ? "day" : spanDays <= 150 ? "week" : "month";

  const bucketStarts: { key: string; label: string; sortMs: number }[] = [];
  const bucketMap = new Map<string, { pipeline: number; won: number }>();

  if (granularity === "day") {
    const firstDay = startOfDayUtcMs(new Date(startMs));
    const lastDay = startOfDayUtcMs(new Date(endMs));
    for (let ms = firstDay; ms <= lastDay; ms += DAY_MS) {
      const key = new Date(ms).toISOString().slice(0, 10);
      const label = formatShortDateEs(ms);
      bucketStarts.push({ key, label, sortMs: ms });
      bucketMap.set(key, { pipeline: 0, won: 0 });
    }
  } else if (granularity === "week") {
    const firstWeek = getIsoWeekStartMs(startOfDayUtcMs(new Date(startMs)));
    const lastDay = startOfDayUtcMs(new Date(endMs));
    for (let ms = firstWeek; ms <= lastDay; ms += 7 * DAY_MS) {
      const key = new Date(ms).toISOString().slice(0, 10);
      const label = formatShortDateEs(ms);
      bucketStarts.push({ key, label, sortMs: ms });
      bucketMap.set(key, { pipeline: 0, won: 0 });
    }
  } else {
    const startDt = new Date(startMs);
    const endDt = new Date(endMs);
    let y = startDt.getUTCFullYear();
    let m = startDt.getUTCMonth();
    const endY = endDt.getUTCFullYear();
    const endM = endDt.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const ms = Date.UTC(y, m, 1);
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const label = new Date(ms).toLocaleDateString("es-ES", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      });
      bucketStarts.push({ key, label, sortMs: ms });
      bucketMap.set(key, { pipeline: 0, won: 0 });
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  }

  let totalPipeline = 0;
  let totalWon = 0;

  const getBucketKey = (dayMs: number): string => {
    if (granularity === "day") {
      return new Date(dayMs).toISOString().slice(0, 10);
    }
    if (granularity === "week") {
      return new Date(getIsoWeekStartMs(dayMs)).toISOString().slice(0, 10);
    }
    const dt = new Date(dayMs);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  for (const deal of deals) {
    const amt = Number(deal.amount || 0);
    const createdMs = parseIsoDayMs(deal.created_at);
    if (createdMs >= startMs && createdMs <= endMs) {
      const key = getBucketKey(createdMs);
      const b = bucketMap.get(key);
      if (b) b.pipeline += amt;
      totalPipeline += amt;
    }

    if (deal.status === "won") {
      const wonMs = parseIsoDayMs(deal.closed_at ?? deal.created_at);
      if (wonMs >= startMs && wonMs <= endMs) {
        const key = getBucketKey(wonMs);
        const b = bucketMap.get(key);
        if (b) b.won += amt;
        totalWon += amt;
      }
    }
  }

  const points: EvolutionChartBucket[] = bucketStarts.map((b) => {
    const vals = bucketMap.get(b.key) ?? { pipeline: 0, won: 0 };
    return {
      label: b.label,
      pipeline: Math.round(vals.pipeline * 100) / 100,
      won: Math.round(vals.won * 100) / 100,
    };
  });

  const granularityLabel =
    granularity === "day"
      ? "Por días"
      : granularity === "week"
        ? "Por semanas"
        : "Por meses";

  const rangeLabel = `${formatShortDateEs(startMs, true)} — ${formatShortDateEs(endMs, true)}`;

  return {
    points,
    granularityLabel,
    rangeLabel,
    totalPipeline,
    totalWon,
  };
}

const EVENT_LABELS: Record<string, string> = {
  company_created: "Empresa creada",
  contact_created: "Contacto creado",
  deal_created: "Negocio creado",
  variable_updated: "Variable actualizada",
  lead_ingested: "Lead captado",
  questionnaire_completed: "Cuestionario completado",
  stage_changed: "Cambio de etapa",
  quote_created: "Presupuesto creado",
  quote_updated: "Presupuesto actualizado",
  quote_sent: "Presupuesto enviado",
  quote_status_changed: "Estado presupuesto",
  email_received: "Email recibido",
  email_sent: "Email enviado",
  meeting_scheduled: "Reunión agendada",
  meeting_updated: "Reunión actualizada",
  meeting_cancelled: "Reunión cancelada",
  call_summary: "Resumen de llamada",
  meeting_summary: "Resumen de reunión",
  internal_note: "Nota interna",
};

const ACTOR_BADGE: Record<
  ActivityRow["actor_type"],
  { label: string; variant: "default" | "brand" | "success" | "warning" }
> = {
  user: { label: "Equipo", variant: "default" },
  ai_agent: { label: "Agente IA", variant: "brand" },
  webhook: { label: "Webhook", variant: "success" },
  system: { label: "Sistema", variant: "warning" },
};

export function DashboardView({
  kpis,
  evolutionDeals,
  funnelSeries,
  nextActions,
  initialActivities,
  profileNames,
}: DashboardViewProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { subscribe } = useRealtime();
  const [activities, setActivities] = useState<ActivityRow[]>(initialActivities);

  const todayMs = useMemo(() => startOfDayUtcMs(new Date()), []);
  const defaultWindow = useMemo(
    () => ({
      startMs: todayMs - (DEFAULT_SPAN_DAYS - 1) * DAY_MS,
      endMs: todayMs,
    }),
    [todayMs]
  );

  const minStartMs = useMemo(() => {
    let earliest = todayMs - 3 * 365 * DAY_MS;
    for (const deal of evolutionDeals) {
      const created = parseIsoDayMs(deal.created_at);
      if (created !== null && created - 30 * DAY_MS < earliest) {
        earliest = created - 30 * DAY_MS;
      }
    }
    return earliest;
  }, [evolutionDeals, todayMs]);

  const [windowRange, setWindowRange] = useState<{
    startMs: number;
    endMs: number;
  }>(() => defaultWindow);
  const [isDragging, setIsDragging] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    originStartMs: number;
    originEndMs: number;
  } | null>(null);

  const clampWindow = React.useCallback(
    (rawStart: number, rawEnd: number) => {
      const minSpanMs = MIN_SPAN_DAYS * DAY_MS;
      const maxSpanMs = MAX_SPAN_DAYS * DAY_MS;
      const span = Math.max(minSpanMs, Math.min(maxSpanMs, rawEnd - rawStart));

      let startMs = rawStart;
      let endMs = rawStart + span;

      if (endMs > todayMs) {
        endMs = todayMs;
        startMs = endMs - span;
      }
      if (startMs < minStartMs) {
        startMs = minStartMs;
        endMs = Math.min(todayMs, startMs + span);
      }
      return {
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
      };
    },
    [minStartMs, todayMs]
  );

  const zoomByFactor = React.useCallback(
    (factor: number, anchorRatio = 0.5) => {
      const clampedRatio = Math.max(0, Math.min(1, anchorRatio));
      setWindowRange((prev) => {
        const currentSpan = Math.max(DAY_MS, prev.endMs - prev.startMs);
        const targetSpan = Math.max(
          MIN_SPAN_DAYS * DAY_MS,
          Math.min(MAX_SPAN_DAYS * DAY_MS, currentSpan * factor)
        );
        const anchorMs = prev.startMs + currentSpan * clampedRatio;
        const nextStart = anchorMs - targetSpan * clampedRatio;
        const nextEnd = nextStart + targetSpan;
        return clampWindow(nextStart, nextEnd);
      });
    },
    [clampWindow]
  );

  const panByFraction = React.useCallback(
    (fraction: number) => {
      setWindowRange((prev) => {
        const span = Math.max(DAY_MS, prev.endMs - prev.startMs);
        const shiftMs = span * fraction;
        return clampWindow(prev.startMs + shiftMs, prev.endMs + shiftMs);
      });
    },
    [clampWindow]
  );

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setWindowRange((prev) => {
          const span = prev.endMs - prev.startMs;
          const shiftMs = (e.deltaX / Math.max(1, rect.width)) * span;
          return clampWindow(prev.startMs + shiftMs, prev.endMs + shiftMs);
        });
        return;
      }

      if (e.deltaY === 0) return;
      const anchorRatio =
        rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      zoomByFactor(zoomFactor, anchorRatio);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [clampWindow, zoomByFactor]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const el = chartContainerRef.current;
      if (!drag?.active || !el) return;

      const width = Math.max(1, el.getBoundingClientRect().width);
      const span = drag.originEndMs - drag.originStartMs;
      const deltaX = e.clientX - drag.startX;
      const shiftMs = -(deltaX / width) * span;

      setWindowRange(
        clampWindow(drag.originStartMs + shiftMs, drag.originEndMs + shiftMs)
      );
    };

    const handlePointerUp = () => {
      if (!dragRef.current?.active) return;
      dragRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [clampWindow]);

  const evolution = useMemo(
    () =>
      buildFluidEvolutionSeries(
        evolutionDeals,
        windowRange.startMs,
        windowRange.endMs
      ),
    [evolutionDeals, windowRange]
  );

  const isDefaultWindow =
    Math.abs(windowRange.startMs - defaultWindow.startMs) < DAY_MS / 2 &&
    Math.abs(windowRange.endMs - defaultWindow.endMs) < DAY_MS / 2;

  const spanDays = Math.round(
    (windowRange.endMs - windowRange.startMs) / DAY_MS
  );

  useEffect(() => {
    return subscribe("activities", (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new as ActivityRow | undefined;
        if (!row?.id) return;
        setActivities((prev) => [row, ...prev.filter((a) => a.id !== row.id)].slice(0, 30));
      }
    });
  }, [subscribe]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            Dashboard
          </h1>
          <p className="text-xs text-[#64748B]">
            Resumen comercial de Deskly CRM y actividad del equipo e IA en vivo.
          </p>
        </div>
        <Link
          href="/pipelines"
          className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#1658F5] transition-colors hover:border-[#1658F5]"
        >
          Ir al Kanban
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Leads este mes</span>
            <Users className="h-4 w-4 text-[#1658F5]" />
          </div>
          <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            {kpis.leadsThisMonth}
          </p>
          <p className="mt-1 text-[11px] text-[#64748B]">Altas en contactos mes actual</p>
        </div>

        <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Pipeline abierto</span>
            <Wallet className="h-4 w-4 text-[#1658F5]" />
          </div>
          <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#1658F5]">
            {formatCurrencyEUR(kpis.openPipelineValue)}
          </p>
          <p className="mt-1 text-[11px] text-[#64748B]">
            {kpis.openDealsCount} negocios activos
          </p>
        </div>

        <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Tasa de cierre</span>
            <Target className="h-4 w-4 text-[#1658F5]" />
          </div>
          <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            {kpis.winRatePct.toFixed(1)}%
          </p>
          <p className="mt-1 text-[11px] text-[#64748B]">Ganados / cerrados totales</p>
        </div>

        <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
          <div className="flex items-center justify-between text-xs font-semibold text-[#64748B]">
            <span>Ticket medio</span>
            <TrendingUp className="h-4 w-4 text-[#1658F5]" />
          </div>
          <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            {formatCurrencyEUR(kpis.averageTicket)}
          </p>
          <p className="mt-1 text-[11px] text-[#64748B]">Media sobre negocios valorados</p>
        </div>
      </div>

      {/* Próximas acciones */}
      <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
              <CalendarClock className="h-4 w-4 text-[#1658F5]" />
              Próximas acciones pendientes
            </h2>
            <p className="text-xs text-[#64748B]">
              Negocios abiertos con seguimiento o fecha programada
            </p>
          </div>
          <Link
            href="/pipelines"
            className="text-xs font-semibold text-[#1658F5] hover:underline"
          >
            Ver todos en Pipelines →
          </Link>
        </div>

        {nextActions.length === 0 ? (
          <p className="text-xs text-[#64748B]">
            Sin acciones pendientes registradas. Añade una «Siguiente acción» dentro de cualquier negocio.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {nextActions.map((item) => {
              const isOverdue =
                Boolean(item.nextActionDate) && item.nextActionDate! < todayIso;
              const isToday = item.nextActionDate === todayIso;
              return (
                <Link
                  key={item.dealId}
                  href={`/pipelines?deal=${item.dealId}`}
                  className="flex flex-col justify-between rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 transition-colors hover:border-[#1658F5]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant={
                          isOverdue
                            ? "destructive"
                            : isToday
                              ? "warning"
                              : "default"
                        }
                        className="text-[10px]"
                      >
                        {item.nextActionDate
                          ? isOverdue
                            ? `Vencida · ${item.nextActionDate}`
                            : isToday
                              ? "Hoy"
                              : item.nextActionDate
                          : "Sin fecha"}
                      </Badge>
                      <span className="text-[11px] font-semibold text-emerald-700">
                        {formatCurrencyEUR(item.amount)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs font-semibold text-[#0F172A]">
                      {item.dealTitle}
                    </p>
                    {item.companyName && (
                      <p className="truncate text-[11px] text-[#64748B]">
                        {item.companyName}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] font-medium text-[#334155]">
                    {item.nextAction || "Seguimiento programado"}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Charts + Live Timeline */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Evolution Chart (Fluid Wheel Zoom + Drag Pan) */}
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                    Evolución comercial (Pipeline creado vs Ganado)
                  </h2>
                  <Badge variant="brand">{evolution.granularityLabel}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  {evolution.rangeLabel} · Pipeline:{" "}
                  <span className="font-semibold text-[#0F172A]">
                    {formatCurrencyEUR(evolution.totalPipeline)}
                  </span>{" "}
                  · Ganado:{" "}
                  <span className="font-semibold text-[#1658F5]">
                    {formatCurrencyEUR(evolution.totalWon)}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden text-[11px] text-[#94A3B8] sm:inline">
                  Rueda para zoom · Arrastra para moverte
                </span>

                <div className="inline-flex items-center rounded-[4px] border border-[#E2E8F0] bg-white">
                  <button
                    type="button"
                    disabled={spanDays <= MIN_SPAN_DAYS}
                    onClick={() => zoomByFactor(1 / 1.35, 0.5)}
                    title="Ampliar detalle (+)"
                    aria-label="Ampliar detalle"
                    className="flex h-7 w-7 items-center justify-center text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={spanDays >= MAX_SPAN_DAYS}
                    onClick={() => zoomByFactor(1.35, 0.5)}
                    title="Alejar rango (-)"
                    aria-label="Alejar rango"
                    className="flex h-7 w-7 items-center justify-center border-l border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="inline-flex items-center rounded-[4px] border border-[#E2E8F0] bg-white">
                  <button
                    type="button"
                    disabled={windowRange.startMs <= minStartMs}
                    onClick={() => panByFraction(-0.35)}
                    title="Mover ventana hacia atrás (izquierda)"
                    aria-label="Mover fechas hacia la izquierda"
                    className="flex h-7 w-7 items-center justify-center text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {!isDefaultWindow && (
                    <button
                      type="button"
                      onClick={() => setWindowRange(defaultWindow)}
                      title="Volver a últimos 6 meses hasta hoy"
                      className="inline-flex h-7 items-center gap-1 border-l border-[#E2E8F0] px-2 text-[11px] font-semibold text-[#1658F5] hover:bg-[#F8FAFC]"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Hoy
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={windowRange.endMs >= todayMs}
                    onClick={() => panByFraction(0.35)}
                    title="Mover ventana hacia adelante (derecha)"
                    aria-label="Mover fechas hacia la derecha"
                    className="flex h-7 w-7 items-center justify-center border-l border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div
              ref={chartContainerRef}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                dragRef.current = {
                  active: true,
                  startX: e.clientX,
                  originStartMs: windowRange.startMs,
                  originEndMs: windowRange.endMs,
                };
                setIsDragging(true);
              }}
              className={`h-64 w-full select-none touch-pan-y ${
                isDragging ? "cursor-grabbing" : "cursor-grab"
              }`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolution.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
                  <Tooltip
                    formatter={(value) => formatCurrencyEUR(Number(value ?? 0))}
                  />
                  <Line
                    type="monotone"
                    dataKey="pipeline"
                    name="Pipeline (€)"
                    stroke="#0F172A"
                    strokeWidth={2}
                    dot={evolution.points.length <= 35 ? { r: 2.5 } : false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="won"
                    name="Ganado (€)"
                    stroke="#1658F5"
                    strokeWidth={2}
                    dot={evolution.points.length <= 35 ? { r: 2.5 } : false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Conversion Funnel */}
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
            <div className="mb-5">
              <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                Embudo por etapa (Pipeline principal)
              </h2>
              <p className="text-xs text-[#64748B]">Número de negocios por etapa</p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "#64748B" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                  <Tooltip />
                  <Bar
                    dataKey="deals"
                    name="Negocios"
                    fill="#1658F5"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Live Global Timeline */}
        <aside className="flex h-[600px] flex-col rounded-[4px] border border-[#E2E8F0] bg-white">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
            <h2 className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
              <Activity className="h-4 w-4 text-[#1658F5]" />
              Timeline Global
            </h2>
            <Badge variant="brand">Realtime</Badge>
          </div>

          <div className="flex-1 divide-y divide-[#F1F5F9] overflow-y-auto px-6">
            {activities.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#64748B]">
                Sin actividad registrada todavía.
              </p>
            ) : (
              activities.map((act) => {
                const actorMeta = ACTOR_BADGE[act.actor_type];
                const actorName =
                  act.actor_type === "user" && act.actor_id
                    ? profileNames[act.actor_id] ?? "Usuario"
                    : actorMeta.label;
                const label = EVENT_LABELS[act.event_type] ?? act.event_type;
                const time = new Date(act.created_at).toLocaleString("es-ES", {
                  dateStyle: "short",
                  timeStyle: "short",
                });

                const entityHref =
                  act.deal_id
                    ? `/pipelines?deal=${act.deal_id}`
                    : act.contact_id
                      ? `/contacts?id=${act.contact_id}`
                      : act.company_id
                        ? `/companies?id=${act.company_id}`
                        : null;

                return (
                  <div key={act.id} className="py-3.5 text-xs leading-relaxed">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={actorMeta.variant} className="text-[10px]">
                          {actorName}
                        </Badge>
                        <span className="font-semibold text-[#0F172A]">{label}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-[#64748B]">{time}</span>
                    </div>

                    {Object.keys(act.metadata ?? {}).length > 0 && (
                      <p className="mt-1 truncate font-mono text-[11px] text-[#64748B]">
                        {JSON.stringify(act.metadata)}
                      </p>
                    )}

                    {entityHref && (
                      <Link
                        href={entityHref}
                        className="mt-1 inline-block text-[11px] font-semibold text-[#1658F5] hover:underline"
                      >
                        Abrir ficha →
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
