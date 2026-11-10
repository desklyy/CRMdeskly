"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ContactSlideOver } from "@/components/crm/contact-slide-over";
import { NewPropertyModal } from "@/components/crm/new-property-modal";
import { useRealtime } from "@/components/providers/realtime-provider";
import {
  CONTACT_DEPARTMENTS,
  CONTACT_LEAD_STATUSES,
  LEAD_STATUS_BADGE,
} from "@/lib/crm/contacts";
import { createContactAction } from "@/app/(crm)/actions/crm-entities";
import type { CustomFieldDefinition } from "@/lib/crm/custom-fields";
import type { Database, LeadStatus, UserRole } from "@/types/database";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;

interface ContactsViewProps {
  initialContacts: ContactRow[];
  initialDefinitions: CustomFieldDefinition[];
  companies: CompanySlim[];
  profiles: ProfileSlim[];
  currentUserRole: UserRole;
}

const OTHER_DEPT_SENTINEL = "__other__";

export function ContactsView({
  initialContacts,
  initialDefinitions,
  companies,
  profiles,
  currentUserRole,
}: ContactsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { subscribe } = useRealtime();

  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>(initialDefinitions);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState(searchParams.get("companyId") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"));
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [newPropOpen, setNewPropOpen] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [departmentChoice, setDepartmentChoice] = useState("");
  const [customDepartment, setCustomDepartment] = useState("");
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("Nuevo");
  const [companyId, setCompanyId] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const idParam = searchParams.get("id");
    const companyParam = searchParams.get("companyId");
    if (idParam) setSelectedId(idParam);
    if (companyParam !== null) setCompanyFilter(companyParam);
    if (searchParams.get("new") === "1") setNewOpen(true);
  }, [searchParams]);

  useEffect(() => {
    return subscribe("custom_field_definitions", (payload) => {
      const record = (payload.new ?? payload.old) as CustomFieldDefinition | undefined;
      if (!record || record.entity_type !== "contact") return;

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

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies]
  );

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const sources = useMemo(
    () =>
      Array.from(
        new Set(contacts.map((c) => c.lead_source).filter((v): v is string => Boolean(v)))
      ).sort(),
    [contacts]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (statusFilter && c.lead_status !== statusFilter) return false;
      if (sourceFilter && c.lead_source !== sourceFilter) return false;
      if (companyFilter && c.company_id !== companyFilter) return false;
      if (!q) return true;
      const full = `${c.first_name} ${c.last_name ?? ""}`.toLowerCase();
      return (
        full.includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.toLowerCase().includes(q) ?? false) ||
        (c.job_title?.toLowerCase().includes(q) ?? false) ||
        (c.department?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contacts, search, statusFilter, sourceFilter, companyFilter]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  function openContact(id: string) {
    setSelectedId(id);
    router.replace(`/contacts?id=${id}`, { scroll: false });
  }

  function closeSlideOver() {
    setSelectedId(null);
    router.replace("/contacts", { scroll: false });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    const resolvedDepartment =
      departmentChoice === OTHER_DEPT_SENTINEL
        ? customDepartment.trim()
        : departmentChoice;

    if (departmentChoice === OTHER_DEPT_SENTINEL && !resolvedDepartment) {
      setCreateError("Especifica el nombre del departamento.");
      return;
    }

    setCreating(true);
    try {
      const res = await createContactAction({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        job_title: jobTitle,
        department: resolvedDepartment || undefined,
        lead_status: leadStatus,
        company_id: companyId || null,
        lead_source: leadSource,
      });

      if (res.error || !res.data) {
        setCreateError(res.error ?? "No se pudo crear el contacto.");
        return;
      }

      setContacts((prev) => [res.data, ...prev]);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setJobTitle("");
      setDepartmentChoice("");
      setCustomDepartment("");
      setLeadStatus("Nuevo");
      setCompanyId("");
      setLeadSource("");
      setNewOpen(false);
      openContact(res.data.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#0F172A]">
            Contactos
          </h1>
          <p className="text-xs text-[#64748B]">
            {filtered.length} de {contacts.length} contactos · Deduplicación por email
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setNewPropOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            + Nueva propiedad
          </Button>
          <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo contacto
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[#E2E8F0] bg-white p-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#64748B]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, teléfono, cargo o departamento..."
            className="h-8 border-[#E2E8F0] pl-8 text-xs"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#334155] focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {CONTACT_LEAD_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="h-8 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#334155] focus:outline-none"
        >
          <option value="">Todas las empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-8 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#334155] focus:outline-none"
        >
          <option value="">Todos los orígenes</option>
          {sources.map((src) => (
            <option key={src} value={src}>
              {src}
            </option>
          ))}
        </select>
      </div>

      {/* Dense Table */}
      <div className="overflow-hidden rounded-[4px] border border-[#E2E8F0] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Empresa</th>
              <th className="px-4 py-2.5">Departamento</th>
              <th className="px-4 py-2.5">Cargo</th>
              <th className="px-4 py-2.5">Propietario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-xs text-[#64748B]">
                  <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  No hay contactos que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filtered.map((contact) => {
                const owner = contact.owner_id ? profileMap.get(contact.owner_id) : null;
                const companyName = contact.company_id
                  ? companyMap.get(contact.company_id)
                  : null;
                const fullName = [contact.first_name, contact.last_name]
                  .filter(Boolean)
                  .join(" ");
                const statusVariant =
                  LEAD_STATUS_BADGE[contact.lead_status] ?? "default";

                return (
                  <tr
                    key={contact.id}
                    onClick={() => openContact(contact.id)}
                    className="cursor-pointer transition-colors hover:bg-[#F8FAFC]"
                  >
                    <td className="px-4 py-2.5 font-semibold text-[#0F172A]">
                      {fullName}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <Badge variant={statusVariant}>{contact.lead_status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#334155]">
                      {contact.email ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#334155]">
                      {companyName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#334155]">
                      {contact.department ? <Badge>{contact.department}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#334155]">
                      {contact.job_title ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#334155]">
                      {owner ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-[#1658F5] text-[10px] font-bold text-white">
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
            className="w-full max-w-lg rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold tracking-[-0.02em] text-[#0F172A]">
                Nuevo contacto
              </h2>
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#F8FAFC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="mb-3 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Nombre *</label>
                  <Input
                    required
                    autoFocus
                    placeholder="Laura"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Apellidos</label>
                  <Input
                    placeholder="Martínez"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Email</label>
                  <Input
                    type="email"
                    placeholder="laura@empresa.es"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Teléfono</label>
                  <Input
                    placeholder="+34 600 000 000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Cargo</label>
                  <Input
                    placeholder="Director/a"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">
                    Departamento
                  </label>
                  <select
                    value={departmentChoice}
                    onChange={(e) => setDepartmentChoice(e.target.value)}
                    className="flex h-9 w-full rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-sm text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    {CONTACT_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                    <option value={OTHER_DEPT_SENTINEL}>Otro (escribir)...</option>
                  </select>
                </div>
              </div>

              {departmentChoice === OTHER_DEPT_SENTINEL && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">
                    Especifica departamento *
                  </label>
                  <Input
                    required
                    placeholder="Ej. Producto, Legal, I+D..."
                    value={customDepartment}
                    onChange={(e) => setCustomDepartment(e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">
                    Estado del lead
                  </label>
                  <select
                    value={leadStatus}
                    onChange={(e) => setLeadStatus(e.target.value as LeadStatus)}
                    className="flex h-9 w-full rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-sm text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
                  >
                    {CONTACT_LEAD_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Origen</label>
                  <Input
                    placeholder="outbound, linkedin..."
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#0F172A]">Empresa</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="flex h-9 w-full rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-sm text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
                >
                  <option value="">Sin empresa asignada</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Guardando..." : "Crear contacto"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide-over 360 */}
      <ContactSlideOver
        contact={selectedContact}
        onClose={closeSlideOver}
        definitions={definitions}
        companies={companies}
        profiles={profiles}
        currentUserRole={currentUserRole}
        onContactUpdated={(updated) =>
          setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        }
        onContactDeleted={(id) =>
          setContacts((prev) => prev.filter((c) => c.id !== id))
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

      {/* New Property Modal */}
      <NewPropertyModal
        open={newPropOpen}
        onClose={() => setNewPropOpen(false)}
        entityType="contact"
        onCreated={(def) =>
          setDefinitions((prev) =>
            prev.some((d) => d.id === def.id) ? prev : [...prev, def]
          )
        }
      />
    </div>
  );
}
