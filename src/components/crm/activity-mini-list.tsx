"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/types/database";

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

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

function formatActivityDetail(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  const summary =
    typeof metadata.summary_one_liner === "string"
      ? metadata.summary_one_liner
      : typeof metadata.subject === "string"
        ? metadata.subject
        : typeof metadata.title === "string"
          ? metadata.title
          : null;
  const outcome =
    typeof metadata.outcome === "string" && metadata.outcome !== "Nota"
      ? metadata.outcome
      : null;

  if (summary && outcome) return `${outcome} · ${summary}`;
  if (summary) return summary;
  return JSON.stringify(metadata);
}

export function ActivityMiniList({ activities }: { activities: ActivityRow[] }) {
  return (
    <div className="space-y-2 border-t border-slate-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Actividad reciente
      </h3>

      {activities.length === 0 ? (
        <p className="text-xs text-slate-400">Sin eventos registrados todavía.</p>
      ) : (
        <ul className="space-y-2">
          {activities.map((act) => {
            const label = EVENT_LABELS[act.event_type] ?? act.event_type;
            const dateStr = new Date(act.created_at).toLocaleString("es-ES", {
              dateStyle: "short",
              timeStyle: "short",
            });

            return (
              <li
                key={act.id}
                className="flex items-start justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-800">{label}</span>
                    <Badge variant="default" className="text-[10px]">
                      {act.actor_type}
                    </Badge>
                  </div>
                  {(() => {
                    const detail = formatActivityDetail(
                      act.metadata as Record<string, unknown> | null | undefined
                    );
                    if (!detail) return null;
                    return (
                      <p className="mt-0.5 break-words text-[11px] text-slate-600">
                        {detail}
                      </p>
                    );
                  })()}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{dateStr}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

