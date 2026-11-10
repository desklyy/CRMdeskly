"use client";

import React, { useEffect, useState } from "react";
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
import { Activity, ArrowUpRight, TrendingUp, Users, Wallet, Target } from "lucide-react";
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

export interface MonthlyPoint {
  month: string;
  pipeline: number;
  won: number;
}

export interface FunnelPoint {
  stage: string;
  deals: number;
  value: number;
}

interface DashboardViewProps {
  kpis: DashboardKPIs;
  monthlySeries: MonthlyPoint[];
  funnelSeries: FunnelPoint[];
  initialActivities: ActivityRow[];
  profileNames: Record<string, string>;
}

const EVENT_LABELS: Record<string, string> = {
  company_created: "Empresa creada",
  contact_created: "Contacto creado",
  deal_created: "Negocio creado",
  variable_updated: "Variable actualizada",
  lead_ingested: "Lead captado",
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
  monthlySeries,
  funnelSeries,
  initialActivities,
  profileNames,
}: DashboardViewProps) {
  const { subscribe } = useRealtime();
  const [activities, setActivities] = useState<ActivityRow[]>(initialActivities);

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

      {/* Charts + Live Timeline */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Monthly Evolution */}
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
            <div className="mb-5">
              <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                Evolución mensual (Pipeline creado vs Ganado)
              </h2>
              <p className="text-xs text-[#64748B]">Últimos 6 meses (€)</p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748B" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="pipeline"
                    name="Pipeline (€)"
                    stroke="#0F172A"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="won"
                    name="Ganado (€)"
                    stroke="#1658F5"
                    strokeWidth={2}
                    dot={{ r: 3 }}
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
