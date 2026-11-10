"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CompanySlideOver } from "@/components/crm/company-slide-over";
import { NewPropertyModal } from "@/components/crm/new-property-modal";
import { useRealtime } from "@/components/providers/realtime-provider";
import { createCompanyAction } from "@/app/(crm)/actions/crm-entities";
import type { CustomFieldDefinition } from "@/lib/crm/custom-fields";
import type { Database, UserRole } from "@/types/database";

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;

interface CompaniesViewProps {
  initialCompanies: CompanyRow[];
  initialDefinitions: CustomFieldDefinition[];
  profiles: ProfileSlim[];
  currentUserRole: UserRole;
}

export function CompaniesView({
  initialCompanies,
  initialDefinitions,
  profiles,
  currentUserRole,
}: CompaniesViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { subscribe } = useRealtime();

  const [companies, setCompanies] = useState<CompanyRow[]>(initialCompanies);
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>(initialDefinitions);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"));
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [newPropOpen, setNewPropOpen] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam) setSelectedId(idParam);
    if (searchParams.get("new") === "1") setNewOpen(true);
  }, [searchParams]);

  useEffect(() => {
    return subscribe("custom_field_definitions", (payload) => {
      const record = (payload.new ?? payload.old) as CustomFieldDefinition | undefined;
      if (!record || record.entity_type !== "company") return;

      if (payload.eventType === "DELETE") {
        setDefinitions((prev) => prev.filter((d) => d.id !== record.id));
        return;
      }

      setDefinitions((prev) => {
        const exists = prev.some((d) => d.id === record.id);
        if (!exists) return record.is_active ? [...prev, record] : prev;
        return prev
          .map((d) => (d.id === record.id ? record : d))
          .filter((d) => d.is_active);
      });
    });
  }, [subscribe]);

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const industries = useMemo(
    () =>
      Array.from(
        new Set(companies.map((c) => c.industry).filter((v): v is string => Boolean(v)))
      ).sort(),
    [companies]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (industryFilter && c.industry !== industryFilter) return false;
      if (ownerFilter && c.owner_id !== ownerFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.domain?.toLowerCase().includes(q) ?? false) ||
        (c.tax_id?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [companies, search, industryFilter, ownerFilter]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId]
  );

  function openCompany(id: string) {
    setSelectedId(id);
    router.replace(`/companies?id=${id}`, { scroll: false });
  }

  function closeSlideOver() {
    setSelectedId(null);
    router.replace("/companies", { scroll: false });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createCompanyAction({
        name: newName,
        domain: newDomain,
        tax_id: newTaxId,
        industry: newIndustry,
      });

      if (res.error || !res.data) {
        setCreateError(res.error ?? "No se pudo crear la empresa.");
        return;
      }

      setCompanies((prev) => [res.data, ...prev]);
      setNewName("");
      setNewDomain("");
      setNewTaxId("");
      setNewIndustry("");
      setNewOpen(false);
      openCompany(res.data.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">Empresas</h1>
          <p className="text-xs text-slate-500">
            {filtered.length} de {companies.length} empresas · Deduplicación por dominio
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setNewPropOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            + Nueva propiedad
          </Button>
          <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nueva empresa
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, dominio o CIF..."
            className="h-8 border-slate-200 pl-8 text-xs"
          />
        </div>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none"
        >
          <option value="">Todos los sectores</option>
          {industries.map((ind) => (
            <option key={ind} value={ind}>
              {ind}
            </option>
          ))}
        </select>

        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none"
        >
          <option value="">Todos los propietarios</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Dense Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Empresa</th>
              <th className="px-4 py-2.5">Dominio</th>
              <th className="px-4 py-2.5">CIF / NIF</th>
              <th className="px-4 py-2.5">Sector</th>
              <th className="px-4 py-2.5">Tamaño</th>
              <th className="px-4 py-2.5">Propietario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-xs text-slate-500">
                  <Building2 className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  No hay empresas que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filtered.map((company) => {
                const owner = company.owner_id ? profileMap.get(company.owner_id) : null;
                return (
                  <tr
                    key={company.id}
                    onClick={() => openCompany(company.id)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-950">
                      {company.name}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {company.domain ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                      {company.tax_id ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {company.industry ? <Badge>{company.industry}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {company.company_size ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {owner ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                            {owner.avatar_initials}
                          </span>
                          {owner.full_name}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Quick Create Modal */}
      {newOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
          onClick={() => setNewOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">Nueva empresa</h2>
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Nombre *</label>
                <Input
                  required
                  autoFocus
                  placeholder="Ej. Acme España S.L."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Dominio</label>
                  <Input
                    placeholder="acme.es"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">CIF / NIF</label>
                  <Input
                    placeholder="B12345678"
                    value={newTaxId}
                    onChange={(e) => setNewTaxId(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Sector</label>
                <Input
                  placeholder="Ej. SaaS, Retail, Consultoría"
                  value={newIndustry}
                  onChange={(e) => setNewIndustry(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Guardando..." : "Crear empresa"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide-over 360 */}
      <CompanySlideOver
        company={selectedCompany}
        onClose={closeSlideOver}
        definitions={definitions}
        profiles={profiles}
        currentUserRole={currentUserRole}
        onCompanyUpdated={(updated) =>
          setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        }
        onCompanyDeleted={(id) =>
          setCompanies((prev) => prev.filter((c) => c.id !== id))
        }
        onDefinitionCreated={(def) =>
          setDefinitions((prev) =>
            prev.some((d) => d.id === def.id) ? prev : [...prev, def]
          )
        }
        onDefinitionUpdated={(def) =>
          setDefinitions((prev) => prev.map((d) => (d.id === def.id ? def : d)))
        }
      />

      {/* New Property Modal from Table Header */}
      <NewPropertyModal
        open={newPropOpen}
        onClose={() => setNewPropOpen(false)}
        entityType="company"
        onCreated={(def) =>
          setDefinitions((prev) =>
            prev.some((d) => d.id === def.id) ? prev : [...prev, def]
          )
        }
      />
    </div>
  );
}

