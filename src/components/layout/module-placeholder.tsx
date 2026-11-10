import React from "react";
import { Badge } from "@/components/ui/badge";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  phase: string;
  highlights: string[];
}

export function ModulePlaceholder({
  title,
  description,
  phase,
  highlights,
}: ModulePlaceholderProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <Badge variant="dark">{phase}</Badge>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Alcance planificado en este módulo
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {highlights.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

