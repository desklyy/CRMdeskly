"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/types/database";

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

const EVENT_LABELS: Record<string, string> = {
  company_created: "Empresa creada",
  contact_created: "Contacto creado",
  variable_updated: "Variable actualizada",
  lead_ingested: "Lead captado",
  stage_changed: "Cambio de etapa",
  quote_sent: "Presupuesto enviado",
  email_received: "Email recibido",
  email_sent: "Email enviado",
  meeting_scheduled: "Reunión agendada",
  meeting_updated: "Reunión actualizada",
  meeting_cancelled: "Reunión cancelada",
  call_summary: "Resumen de llamada",
  meeting_summary: "Resumen de reunión",
};

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
                  {Object.keys(act.metadata ?? {}).length > 0 && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                      {JSON.stringify(act.metadata)}
                    </p>
                  )}
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

