"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, Trash2, Users } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineField } from "@/components/crm/inline-field";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import {
  OperationalProjectPanel,
  type CompanyDealSummary,
} from "@/components/crm/operational-project-panel";
import { ActivityMiniList } from "@/components/crm/activity-mini-list";
import {
  QuestionnaireFeedbackArea,
  SendQuestionnaireButton,
  useSendQuestionnaire,
} from "@/components/crm/questionnaire-sender";
import {
  deleteCompanyAction,
  getCompanyRelationsAction,
  updateCompanyCustomFieldAction,
  updateCompanyFieldAction,
} from "@/app/(crm)/actions/crm-entities";
import { formatCurrencyEUR, type CustomFieldDefinition } from "@/lib/crm/custom-fields";
import type { Database, Json, UserRole } from "@/types/database";

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;
type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];
type ContactSlim = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "first_name" | "last_name" | "email" | "job_title"
>;

interface CompanySlideOverProps {
  company: CompanyRow | null;
  onClose: () => void;
  definitions: CustomFieldDefinition[];
  profiles: ProfileSlim[];
  currentUserRole: UserRole;
  onCompanyUpdated: (updated: CompanyRow) => void;
  onCompanyDeleted: (companyId: string) => void;
  onDefinitionCreated: (def: CustomFieldDefinition) => void;
  onDefinitionUpdated: (def: CustomFieldDefinition) => void;
}

const COMPANY_SIZES = [
  { value: "1-10", label: "1-10 empleados" },
  { value: "11-50", label: "11-50 empleados" },
  { value: "51-200", label: "51-200 empleados" },
  { value: "200+", label: "200+ empleados" },
];

type CompanyTabKey = "resumen" | "proyecto" | "relaciones" | "actividad";

export function CompanySlideOver({
  company,
  onClose,
  definitions,
  profiles,
  currentUserRole,
  onCompanyUpdated,
  onCompanyDeleted,
  onDefinitionCreated,
  onDefinitionUpdated,
}: CompanySlideOverProps) {
  const [tab, setTab] = useState<CompanyTabKey>("resumen");
  const [contacts, setContacts] = useState<ContactSlim[]>([]);
  const [deals, setDeals] = useState<CompanyDealSummary[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [deleting, setDeleting] = useState(false);

  const companyId = company?.id ?? null;

  const questionnaire = useSendQuestionnaire({
    entityType: "company",
    entityId: companyId ?? "",
    recipients: contacts,
    companyId,
    onSent: () => {
      if (companyId) {
        void getCompanyRelationsAction(companyId).then((res) => {
          setContacts(res.contacts);
          setDeals(res.deals);
          setActivities(res.activities);
        });
      }
    },
  });

  useEffect(() => {
    if (!companyId) return;
    setTab("resumen");
    let active = true;
    void getCompanyRelationsAction(companyId).then((res) => {
      if (!active) return;
      setContacts(res.contacts);
      setDeals(res.deals);
      setActivities(res.activities);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  if (!company) return null;

  async function saveCore(patch: Database["public"]["Tables"]["companies"]["Update"]) {
    if (!company) return;
    const res = await updateCompanyFieldAction(company.id, patch);
    if (res.data) {
      onCompanyUpdated(res.data);
    }
  }

  async function saveCustom(key: string, value: Json) {
    if (!company) return;
    const res = await updateCompanyCustomFieldAction(company.id, key, value);
    if (res.data) {
      onCompanyUpdated(res.data);
    }
  }

  async function handleDelete() {
    if (!company || currentUserRole !== "admin") return;
    if (!window.confirm(`¿Eliminar la empresa "${company.name}"?`)) return;
    setDeleting(true);
    try {
      const res = await deleteCompanyAction(company.id);
      if (res.ok) {
        onCompanyDeleted(company.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  const ownerOptions = profiles.map((p) => ({
    value: p.id,
    label: p.full_name,
  }));

  const COMPANY_TABS: { key: CompanyTabKey; label: string }[] = [
    { key: "resumen", label: "Ficha" },
    { key: "proyecto", label: "Proyecto y Cuestionario" },
    { key: "relaciones", label: `Negocios y Contactos (${deals.length + contacts.length})` },
    { key: "actividad", label: `Actividad (${activities.length})` },
  ];

  return (
    <SlideOver
      open={Boolean(company)}
      onClose={onClose}
      title={company.name}
      subtitle={company.domain ?? company.website ?? "Empresa sin dominio"}
      headerActions={
        <>
          <SendQuestionnaireButton
            sending={questionnaire.sending}
            onClick={questionnaire.trigger}
          />
          {currentUserRole === "admin" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={deleting}
              onClick={() => void handleDelete()}
              title="Eliminar empresa (solo Admin)"
              className="text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </>
      }
    >
      <QuestionnaireFeedbackArea state={questionnaire} />
      <div className="mb-5 flex flex-wrap gap-1 border-b border-[#E2E8F0] pb-2">
        {COMPANY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-[4px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
        <div className="space-y-6">
          {/* Identidad y Web */}
          <div className="space-y-1.5">
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Identidad y Web
            </h3>
            <div className="rounded-md border border-slate-200 bg-white p-1.5">
              <InlineField
                label="Nombre"
                value={company.name}
                onSave={async (val) => {
                  if (val) await saveCore({ name: val });
                }}
              />
              <InlineField
                label="Dominio"
                value={company.domain}
                placeholder="empresa.es"
                onSave={(val) => saveCore({ domain: val?.toLowerCase() ?? null })}
              />
              <InlineField
                label="Web"
                type="url"
                value={company.website}
                placeholder="https://..."
                onSave={(val) => saveCore({ website: val })}
              />
              <InlineField
                label="LinkedIn"
                type="url"
                value={company.linkedin_url}
                placeholder="https://linkedin.com/company/..."
                onSave={(val) => saveCore({ linkedin_url: val })}
              />
              <InlineField
                label="Sector"
                value={company.industry}
                onSave={(val) => saveCore({ industry: val })}
              />
              <InlineField
                label="Tamaño"
                type="select"
                value={company.company_size}
                options={COMPANY_SIZES}
                onSave={(val) => saveCore({ company_size: val })}
              />
              <InlineField
                label="Propietario"
                type="select"
                value={company.owner_id}
                options={ownerOptions}
                onSave={(val) => saveCore({ owner_id: val })}
              />
            </div>
          </div>

          {/* Datos Fiscales */}
          <div className="space-y-1.5">
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Datos fiscales (Presupuestos)
            </h3>
            <div className="rounded-md border border-slate-200 bg-white p-1.5">
              <InlineField
                label="CIF / NIF"
                value={company.tax_id}
                onSave={(val) => saveCore({ tax_id: val })}
              />
              <InlineField
                label="Dirección fiscal"
                value={company.billing_address}
                onSave={(val) => saveCore({ billing_address: val })}
              />
              <InlineField
                label="Ciudad"
                value={company.billing_city}
                onSave={(val) => saveCore({ billing_city: val })}
              />
              <InlineField
                label="Código postal"
                value={company.billing_postal_code}
                onSave={(val) => saveCore({ billing_postal_code: val })}
              />
              <InlineField
                label="País"
                value={company.country}
                onSave={(val) => saveCore({ country: val })}
              />
            </div>
          </div>

          {/* Otras propiedades personalizadas fuera de Cuestionario Operativo */}
          <CustomFieldsPanel
            entityType="company"
            definitions={definitions}
            values={company.custom_fields}
            onUpdateField={saveCustom}
            onDefinitionCreated={onDefinitionCreated}
            onDefinitionUpdated={onDefinitionUpdated}
            excludeSections={["Cuestionario Operativo"]}
          />
        </div>
      )}

      {tab === "proyecto" && (
        <OperationalProjectPanel
          companyName={company.name}
          companyValues={company.custom_fields}
          companyDefinitions={definitions}
          onUpdateCompanyField={saveCustom}
          companyDeals={deals}
        />
      )}

      {tab === "relaciones" && (
        <div className="space-y-6">
          {/* Negocios / Proyectos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Briefcase className="h-3.5 w-3.5" />
                Negocios / Proyectos ({deals.length})
              </h3>
              <Link
                href="/pipelines"
                className="text-xs font-medium text-slate-600 hover:text-slate-950"
              >
                Ir a Pipelines →
              </Link>
            </div>
            {deals.length === 0 ? (
              <p className="text-xs text-slate-400">Sin negocios asociados.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                {deals.map((d) => (
                  <Link
                    key={d.id}
                    href={`/pipelines?deal=${d.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 hover:text-[#1658F5]">
                        {d.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {d.stage_name && (
                          <Badge variant="default">{d.stage_name}</Badge>
                        )}
                        <Badge
                          variant={
                            d.status === "won"
                              ? "success"
                              : d.status === "lost"
                                ? "destructive"
                                : "brand"
                          }
                        >
                          {d.status === "won"
                            ? "Ganado"
                            : d.status === "lost"
                              ? "Perdido"
                              : "Abierto"}
                        </Badge>
                      </div>
                    </div>
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatCurrencyEUR(d.amount)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Contactos vinculados */}
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Users className="h-3.5 w-3.5" />
                Contactos ({contacts.length})
              </h3>
              <Link
                href={`/contacts?companyId=${company.id}`}
                className="text-xs font-medium text-slate-600 hover:text-slate-950"
              >
                Ver todos →
              </Link>
            </div>
            {contacts.length === 0 ? (
              <p className="text-xs text-slate-400">Sin contactos asociados.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                {contacts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/contacts?id=${c.id}`}
                    className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                      </p>
                      <p className="text-slate-500">{c.job_title ?? c.email ?? "—"}</p>
                    </div>
                    <span className="text-slate-400">{c.email ?? ""}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "actividad" && <ActivityMiniList activities={activities} />}
    </SlideOver>
  );
}
