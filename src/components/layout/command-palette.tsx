"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Briefcase,
  Building2,
  Calendar,
  Kanban,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import {
  globalSearchAction,
  type GlobalSearchResult,
} from "@/app/(crm)/actions/crm-entities";
import { formatCurrencyEUR } from "@/lib/crm/custom-fields";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROUTES = [
  { href: "/", label: "Ir a Dashboard", icon: LayoutDashboard, keywords: "inicio kpis resumen" },
  { href: "/companies", label: "Ir a Empresas", icon: Building2, keywords: "cuentas clientes cif" },
  { href: "/contacts", label: "Ir a Contactos", icon: Users, keywords: "leads personas emails" },
  { href: "/pipelines", label: "Ir a Pipelines (Kanban)", icon: Kanban, keywords: "negocios deals embudo" },
  { href: "/calendar", label: "Ir a Calendario Outlook", icon: Calendar, keywords: "reuniones agenda citas" },
  { href: "/settings", label: "Ir a Settings", icon: Settings, keywords: "configuracion variables equipo api" },
];

const QUICK_ACTIONS = [
  { href: "/companies?new=1", label: "Crear nueva empresa", icon: Plus, keywords: "nueva empresa cuenta" },
  { href: "/contacts?new=1", label: "Crear nuevo contacto", icon: Plus, keywords: "nuevo contacto persona lead" },
  { href: "/pipelines?new=1", label: "Crear nuevo negocio", icon: Plus, keywords: "nuevo negocio deal oportunidad" },
];

const DEAL_STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  won: "Ganado",
  lost: "Perdido",
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesQuery(query: string, searchableText: string): boolean {
  const cleanQuery = normalizeText(query.trim());
  if (!cleanQuery) return true;
  const target = normalizeText(searchableText);
  return cleanQuery.split(/\s+/).every((token) => target.includes(token));
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult>({
    companies: [],
    contacts: [],
    deals: [],
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults({ companies: [], contacts: [], deals: [] });
      setSearching(false);
      return;
    }

    const trimmed = query.trim();
    let cancelled = false;
    setSearching(true);
    const delayMs = trimmed.length === 0 ? 0 : 140;

    const timer = setTimeout(() => {
      void globalSearchAction(trimmed)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {
          if (!cancelled) setResults({ companies: [], contacts: [], deals: [] });
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  if (!open) return null;

  function navigateTo(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const trimmedQuery = query.trim();
  const filteredActions = QUICK_ACTIONS.filter((a) =>
    matchesQuery(trimmedQuery, `${a.label} ${a.keywords}`)
  );
  const filteredRoutes = ROUTES.filter((r) =>
    matchesQuery(trimmedQuery, `${r.label} ${r.keywords}`)
  );

  const hasEntities =
    results.companies.length > 0 ||
    results.contacts.length > 0 ||
    results.deals.length > 0;
  const hasAnyItem =
    hasEntities || filteredActions.length > 0 || filteredRoutes.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#0F172A]/35 pt-[16vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[4px] border border-[#E2E8F0] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Buscador global Deskly CRM" shouldFilter={false} className="w-full">
          <div className="flex items-center border-b border-[#E2E8F0] px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-[#64748B]" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar empresas, contactos, negocios, CIF, email, teléfono o acciones..."
              className="h-11 w-full bg-transparent text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none"
            />
            {searching && (
              <span className="mr-2 text-[11px] text-[#94A3B8]">Buscando...</span>
            )}
            <kbd className="rounded-[2px] border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-semibold text-[#64748B]">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-96 overflow-y-auto p-2">
            {!hasAnyItem && (
              <div className="py-6 text-center text-xs text-slate-500">
                {searching
                  ? "Buscando en empresas, contactos y negocios..."
                  : "No se encontraron resultados."}
              </div>
            )}

            {results.companies.length > 0 && (
              <Command.Group
                heading={trimmedQuery ? "Empresas" : "Empresas recientes"}
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.companies.map((c) => {
                  const meta = [c.domain, c.industry, c.tax_id]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Command.Item
                      key={c.id}
                      value={`company-${c.id}`}
                      onSelect={() => navigateTo(`/companies?id=${c.id}`)}
                      className="mt-0.5 flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
                        <span className="truncate font-medium text-slate-900">
                          {c.name}
                        </span>
                      </span>
                      {meta && (
                        <span className="shrink-0 truncate text-xs text-slate-400">
                          {meta}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {results.contacts.length > 0 && (
              <Command.Group
                heading={trimmedQuery ? "Contactos" : "Contactos recientes"}
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.contacts.map((c) => {
                  const full = [c.first_name, c.last_name].filter(Boolean).join(" ");
                  const meta = [c.company_name, c.email ?? c.phone]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Command.Item
                      key={c.id}
                      value={`contact-${c.id}`}
                      onSelect={() => navigateTo(`/contacts?id=${c.id}`)}
                      className="mt-0.5 flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Users className="h-4 w-4 shrink-0 text-slate-500" />
                        <span className="truncate font-medium text-slate-900">
                          {full}
                        </span>
                        {c.job_title && (
                          <span className="hidden truncate text-xs text-slate-400 sm:inline">
                            {c.job_title}
                          </span>
                        )}
                      </span>
                      {meta && (
                        <span className="max-w-[240px] shrink-0 truncate text-xs text-slate-400">
                          {meta}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {results.deals.length > 0 && (
              <Command.Group
                heading={trimmedQuery ? "Negocios" : "Negocios recientes"}
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.deals.map((d) => (
                  <Command.Item
                    key={d.id}
                    value={`deal-${d.id}`}
                    onSelect={() => navigateTo(`/pipelines?deal=${d.id}`)}
                    className="mt-0.5 flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Briefcase className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="truncate font-medium text-slate-900">
                        {d.title}
                      </span>
                      {d.company_name && (
                        <span className="hidden truncate text-xs text-slate-400 sm:inline">
                          · {d.company_name}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <span className="text-slate-400">
                        {DEAL_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      <span className="font-medium text-emerald-600">
                        {formatCurrencyEUR(d.amount)}
                      </span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredActions.length > 0 && (
              <Command.Group
                heading="Acciones rápidas"
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {filteredActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Command.Item
                      key={action.href}
                      value={`action-${action.href}`}
                      onSelect={() => navigateTo(action.href)}
                      className="mt-0.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                    >
                      <Icon className="h-4 w-4 text-slate-500" />
                      <span>{action.label}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {filteredRoutes.length > 0 && (
              <Command.Group
                heading="Navegación"
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {filteredRoutes.map((route) => {
                  const Icon = route.icon;
                  return (
                    <Command.Item
                      key={route.href}
                      value={`route-${route.href}`}
                      onSelect={() => navigateTo(route.href)}
                      className="mt-0.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                    >
                      <Icon className="h-4 w-4 text-slate-500" />
                      <span>{route.label}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
