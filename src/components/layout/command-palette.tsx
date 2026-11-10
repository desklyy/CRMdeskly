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
];

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
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ companies: [], contacts: [], deals: [] });
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
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
    }, 180);

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

  const hasRemoteResults =
    results.companies.length > 0 ||
    results.contacts.length > 0 ||
    results.deals.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#0F172A]/35 pt-[16vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[4px] border border-[#E2E8F0] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Buscador global Deskly CRM" shouldFilter={!hasRemoteResults} className="w-full">
          <div className="flex items-center border-b border-[#E2E8F0] px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-[#64748B]" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar empresas, contactos, negocios o acciones..."
              className="h-11 w-full bg-transparent text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none"
            />
            <kbd className="rounded-[2px] border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-semibold text-[#64748B]">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-xs text-slate-500">
              {searching ? "Buscando en el CRM..." : "No se encontraron resultados."}
            </Command.Empty>

            {results.companies.length > 0 && (
              <Command.Group
                heading="Empresas"
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.companies.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`company-${c.id}-${c.name}`}
                    onSelect={() => navigateTo(`/companies?id=${c.id}`)}
                    className="mt-0.5 flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                  >
                    <span className="flex items-center gap-2.5">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      <span>{c.name}</span>
                    </span>
                    <span className="text-xs text-slate-400">{c.domain ?? ""}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {results.contacts.length > 0 && (
              <Command.Group
                heading="Contactos"
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.contacts.map((c) => {
                  const full = [c.first_name, c.last_name].filter(Boolean).join(" ");
                  return (
                    <Command.Item
                      key={c.id}
                      value={`contact-${c.id}-${full}`}
                      onSelect={() => navigateTo(`/contacts?id=${c.id}`)}
                      className="mt-0.5 flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                    >
                      <span className="flex items-center gap-2.5">
                        <Users className="h-4 w-4 text-slate-500" />
                        <span>{full}</span>
                      </span>
                      <span className="text-xs text-slate-400">{c.email ?? ""}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {results.deals.length > 0 && (
              <Command.Group
                heading="Negocios"
                className="px-2 py-1 text-[11px] font-medium text-slate-400"
              >
                {results.deals.map((d) => (
                  <Command.Item
                    key={d.id}
                    value={`deal-${d.id}-${d.title}`}
                    onSelect={() => navigateTo(`/pipelines?deal=${d.id}`)}
                    className="mt-0.5 flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                  >
                    <span className="flex items-center gap-2.5">
                      <Briefcase className="h-4 w-4 text-slate-500" />
                      <span>{d.title}</span>
                    </span>
                    <span className="text-xs font-medium text-emerald-600">
                      {formatCurrencyEUR(d.amount)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading="Acciones rápidas"
              className="px-2 py-1 text-[11px] font-medium text-slate-400"
            >
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Command.Item
                    key={action.href}
                    value={`${action.label} ${action.keywords}`}
                    onSelect={() => navigateTo(action.href)}
                    className="mt-0.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                  >
                    <Icon className="h-4 w-4 text-slate-500" />
                    <span>{action.label}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group
              heading="Navegación"
              className="px-2 py-1 text-[11px] font-medium text-slate-400"
            >
              {ROUTES.map((route) => {
                const Icon = route.icon;
                return (
                  <Command.Item
                    key={route.href}
                    value={`${route.label} ${route.keywords}`}
                    onSelect={() => navigateTo(route.href)}
                    className="mt-0.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 aria-selected:bg-slate-100 aria-selected:text-slate-950"
                  >
                    <Icon className="h-4 w-4 text-slate-500" />
                    <span>{route.label}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
