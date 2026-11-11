"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  TrendingUp,
  Users,
  Wallet,
  Target,
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

function buildEvolutionSeries(
  deals: EvolutionDealPoint[],
  mode: "monthly" | "daily",
  monthOffset: number
): {
  points: EvolutionChartBucket[];
  rangeLabel: string;
  totalPipeline: number;
  totalWon: number;
} {
  const now = new Date();
  const anchor = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);

  if (mode === "monthly") {
    const points: EvolutionChartBucket[] = [];
    let totalPipeline = 0;
    let totalWon = 0;

    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("es-ES", {
        month: "short",
        year: "2-digit",
      });

      const createdValue = deals
        .filter((deal) => deal.created_at.startsWith(key))
        .reduce((sum, deal) => sum + Number(deal.amount || 0), 0);

      const wonValue = deals
        .filter(
          (deal) =>
            deal.status === "won" &&
            (deal.closed_at ?? deal.created_at).startsWith(key)
        )
        .reduce((sum, deal) => sum + Number(deal.amount || 0), 0);

      totalPipeline += createdValue;
      totalWon += wonValue;
      points.push({ label, pipeline: createdValue, won: wonValue });
    }

    const first = points[0]?.label ?? "";
    const last = points[points.length - 1]?.label ?? "";
    return {
      points,
      rangeLabel: `${first} — ${last} (€)`,
      totalPipeline,
      totalWon,
    };
  }

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const createdByDay = new Map<string, number>();
  const wonByDay = new Map<string, number>();

  for (const deal of deals) {
    const createdDay = deal.created_at.slice(0, 10);
    if (createdDay.startsWith(monthPrefix)) {
      createdByDay.set(
        createdDay,
        (createdByDay.get(createdDay) ?? 0) + Number(deal.amount || 0)
      );
    }
    if (deal.status === "won") {
      const wonDay = (deal.closed_at ?? deal.created_at).slice(0, 10);
      if (wonDay.startsWith(monthPrefix)) {
        wonByDay.set(wonDay, (wonByDay.get(wonDay) ?? 0) + Number(deal.amount || 0));
      }
    }
  }

  const points: EvolutionChartBucket[] = [];
  let totalPipeline = 0;
  let totalWon = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, "0");
    const dayKey = `${monthPrefix}-${dayStr}`;
    const pipeline = createdByDay.get(dayKey) ?? 0;
    const won = wonByDay.get(dayKey) ?? 0;
    totalPipeline += pipeline;
    totalWon += won;
    points.push({ label: dayStr, pipeline, won });
  }

  const monthTitle = anchor.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  return {
    points,
    rangeLabel: `${monthTitle} · día a día (€)`,
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
  const [chartMode, setChartMode] = useState<"monthly" | "daily">("monthly");
  const [monthOffset, setMonthOffset] = useState(0);

  const evolution = useMemo(
    () => buildEvolutionSeries(evolutionDeals, chartMode, monthOffset),
    [evolutionDeals, chartMode, monthOffset]
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
          {/* Evolution Chart (Monthly or Daily + Left/Right Navigation) */}
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                  Evolución {chartMode === "monthly" ? "mensual" : "diaria"} (Pipeline creado vs Ganado)
                </h2>
                <p className="mt-0.5 text-xs capitalize text-[#64748B]">
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
                <div className="inline-flex rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
                  <button
                    type="button"
                    onClick={() => setChartMode("monthly")}
                    className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                      chartMode === "monthly"
                        ? "bg-[#1658F5] text-white"
                        : "text-[#64748B] hover:text-[#0F172A]"
                    }`}
                  >
                    Mensual
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("daily")}
                    className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                      chartMode === "daily"
                        ? "bg-[#1658F5] text-white"
                        : "text-[#64748B] hover:text-[#0F172A]"
                    }`}
                  >
                    Diaria
                  </button>
                </div>

                <div className="inline-flex items-center rounded-[4px] border border-[#E2E8F0] bg-white">
                  <button
                    type="button"
                    onClick={() => setMonthOffset((m) => m - 1)}
                    title={
                      chartMode === "monthly"
                        ? "Retroceder 1 mes"
                        : "Mes anterior"
                    }
                    className="flex h-7 w-7 items-center justify-center text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {monthOffset < 0 && (
                    <button
                      type="button"
                      onClick={() => setMonthOffset(0)}
                      className="border-x border-[#E2E8F0] px-2 text-[11px] font-semibold text-[#1658F5] hover:bg-[#F8FAFC]"
                    >
                      Hoy
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={monthOffset >= 0}
                    onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
                    title={
                      chartMode === "monthly" ? "Avanzar 1 mes" : "Mes siguiente"
                    }
                    className="flex h-7 w-7 items-center justify-center text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolution.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    interval={chartMode === "daily" ? 2 : 0}
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
                    dot={{ r: chartMode === "daily" ? 2 : 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="won"
                    name="Ganado (€)"
                    stroke="#1658F5"
                    strokeWidth={2}
                    dot={{ r: chartMode === "daily" ? 2 : 3 }}
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
