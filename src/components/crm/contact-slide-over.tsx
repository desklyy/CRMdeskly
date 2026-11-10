"use client";

import React, { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { InlineField } from "@/components/crm/inline-field";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { ActivityMiniList } from "@/components/crm/activity-mini-list";
import {
  QuestionnaireFeedbackArea,
  SendQuestionnaireButton,
  useSendQuestionnaire,
} from "@/components/crm/questionnaire-sender";
import {
  CONTACT_DEPARTMENTS,
  CONTACT_LEAD_STATUSES,
} from "@/lib/crm/contacts";
import {
  deleteContactAction,
  getContactActivitiesAction,
  updateContactCustomFieldAction,
  updateContactFieldAction,
} from "@/app/(crm)/actions/crm-entities";
import type { CustomFieldDefinition } from "@/lib/crm/custom-fields";
import type { Database, Json, LeadStatus, UserRole } from "@/types/database";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;
type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

interface ContactSlideOverProps {
  contact: ContactRow | null;
  onClose: () => void;
  definitions: CustomFieldDefinition[];
  companies: CompanySlim[];
  profiles: ProfileSlim[];
  currentUserRole: UserRole;
  onContactUpdated: (updated: ContactRow) => void;
  onContactDeleted: (contactId: string) => void;
  onDefinitionCreated: (def: CustomFieldDefinition) => void;
  onDefinitionUpdated: (def: CustomFieldDefinition) => void;
}

const LEAD_SOURCES = [
  { value: "typeform", label: "Typeform" },
  { value: "web", label: "Web" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "referral", label: "Recomendación" },
  { value: "outbound", label: "Outbound" },
];

const OTHER_DEPT_SENTINEL = "__other__";

export function ContactSlideOver({
  contact,
  onClose,
  definitions,
  companies,
  profiles,
  currentUserRole,
  onContactUpdated,
  onContactDeleted,
  onDefinitionCreated,
  onDefinitionUpdated,
}: ContactSlideOverProps) {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [editingOtherDept, setEditingOtherDept] = useState(false);
  const [customDeptDraft, setCustomDeptDraft] = useState("");
  const [deptSavedFlash, setDeptSavedFlash] = useState(false);

  const questionnaire = useSendQuestionnaire({
    entityType: "contact",
    entityId: contact?.id ?? "",
    recipients: contact ? [contact] : [],
    preferredContactId: contact?.id ?? null,
    companyId: contact?.company_id ?? null,
    onSent: () => {
      if (contact) {
        void getContactActivitiesAction(contact.id).then(setActivities);
      }
    },
  });

  useEffect(() => {
    if (!contact) return;
    const isPreset =
      !contact.department ||
      (CONTACT_DEPARTMENTS as readonly string[]).includes(contact.department);
    setEditingOtherDept(!isPreset);
    setCustomDeptDraft(!isPreset ? contact.department ?? "" : "");

    let active = true;
    void getContactActivitiesAction(contact.id).then((res) => {
      if (active) setActivities(res);
    });
    return () => {
      active = false;
    };
  }, [contact]);

  if (!contact) return null;

  async function saveCore(patch: Database["public"]["Tables"]["contacts"]["Update"]) {
    if (!contact) return;
    const res = await updateContactFieldAction(contact.id, patch);
    if (res.data) {
      onContactUpdated(res.data);
    }
  }

  async function saveCustom(key: string, value: Json) {
    if (!contact) return;
    const res = await updateContactCustomFieldAction(contact.id, key, value);
    if (res.data) {
      onContactUpdated(res.data);
    }
  }

  async function handleDepartmentSelect(val: string) {
    if (val === OTHER_DEPT_SENTINEL) {
      setEditingOtherDept(true);
      setCustomDeptDraft("");
      return;
    }
    setEditingOtherDept(false);
    setCustomDeptDraft("");
    await saveCore({ department: val || null });
    setDeptSavedFlash(true);
    setTimeout(() => setDeptSavedFlash(false), 1200);
  }

  async function saveCustomDepartment() {
    if (!contact) return;
    const trimmed = customDeptDraft.trim();
    if (!trimmed) return;
    if (trimmed === contact.department) return;
    await saveCore({ department: trimmed });
    setDeptSavedFlash(true);
    setTimeout(() => setDeptSavedFlash(false), 1200);
  }

  async function handleDelete() {
    if (!contact || currentUserRole !== "admin") return;
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    if (!window.confirm(`¿Eliminar el contacto "${fullName}"?`)) return;
    setDeleting(true);
    try {
      const res = await deleteContactAction(contact.id);
      if (res.ok) {
        onContactDeleted(contact.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const ownerOptions = profiles.map((p) => ({ value: p.id, label: p.full_name }));
  const leadStatusOptions = CONTACT_LEAD_STATUSES.map((s) => ({ value: s, label: s }));
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");

  const currentDeptIsPreset =
    contact.department &&
    (CONTACT_DEPARTMENTS as readonly string[]).includes(contact.department);
  const deptSelectValue = editingOtherDept
    ? OTHER_DEPT_SENTINEL
    : currentDeptIsPreset
      ? contact.department!
      : "";

  return (
    <SlideOver
      open={Boolean(contact)}
      onClose={onClose}
      title={fullName}
      subtitle={`${contact.email ?? contact.job_title ?? "Contacto"} · ${contact.lead_status}`}
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
              title="Eliminar contacto (solo Admin)"
              className="text-[#64748B] hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </>
      }
    >
      <QuestionnaireFeedbackArea state={questionnaire} />
      <div className="space-y-6">
        {/* Identidad */}
        <div className="space-y-1.5">
          <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
            Datos del contacto
          </h3>
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-1.5">
            <InlineField
              label="Nombre"
              value={contact.first_name}
              onSave={async (val) => {
                if (val) await saveCore({ first_name: val });
              }}
            />
            <InlineField
              label="Apellidos"
              value={contact.last_name}
              onSave={(val) => saveCore({ last_name: val })}
            />
            <InlineField
              label="Email"
              value={contact.email}
              onSave={(val) => saveCore({ email: val?.toLowerCase() ?? null })}
            />
            <InlineField
              label="Teléfono"
              value={contact.phone}
              onSave={(val) => saveCore({ phone: val })}
            />
            <InlineField
              label="Cargo"
              value={contact.job_title}
              onSave={(val) => saveCore({ job_title: val })}
            />

            {/* Departamento (select base + Otro editable) */}
            <div className="group grid grid-cols-[140px_1fr] items-start gap-3 rounded-[4px] px-2 py-1.5 transition-colors hover:bg-[#F8FAFC]">
              <span className="pt-1 text-xs font-medium text-[#64748B]">
                Departamento
              </span>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <select
                    value={deptSelectValue}
                    onChange={(e) => void handleDepartmentSelect(e.target.value)}
                    className={`h-7 w-full rounded-[4px] border border-transparent bg-transparent px-1.5 text-sm transition-colors hover:border-[#E2E8F0] focus:border-[#1658F5] focus:bg-white focus:outline-none ${
                      deptSelectValue ? "text-[#0F172A]" : "text-[#64748B]"
                    }`}
                  >
                    <option value="">Sin definir</option>
                    {CONTACT_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                    <option value={OTHER_DEPT_SENTINEL}>Otro (especificar)...</option>
                  </select>
                  {deptSavedFlash && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  )}
                </div>

                {editingOtherDept && (
                  <input
                    type="text"
                    value={customDeptDraft}
                    onChange={(e) => setCustomDeptDraft(e.target.value)}
                    onBlur={() => void saveCustomDepartment()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveCustomDepartment();
                      }
                    }}
                    placeholder="Escribe el departamento..."
                    className="h-7 w-full rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-sm text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
                  />
                )}
              </div>
            </div>

            <InlineField
              label="LinkedIn"
              type="url"
              value={contact.linkedin_url}
              placeholder="https://linkedin.com/in/..."
              onSave={(val) => saveCore({ linkedin_url: val })}
            />
          </div>
        </div>

        {/* Empresa y Origen */}
        <div className="space-y-1.5">
          <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
            Relación comercial
          </h3>
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-1.5">
            <InlineField
              label="Estado del lead"
              type="select"
              value={contact.lead_status}
              options={leadStatusOptions}
              onSave={async (val) => {
                if (val) await saveCore({ lead_status: val as LeadStatus });
              }}
            />
            <InlineField
              label="Empresa"
              type="select"
              value={contact.company_id}
              options={companyOptions}
              onSave={(val) => saveCore({ company_id: val })}
            />
            <InlineField
              label="Origen del lead"
              type="select"
              value={contact.lead_source}
              options={LEAD_SOURCES}
              onSave={(val) => saveCore({ lead_source: val })}
            />
            <InlineField
              label="Propietario"
              type="select"
              value={contact.owner_id}
              options={ownerOptions}
              onSave={(val) => saveCore({ owner_id: val })}
            />
          </div>
        </div>

        {/* Variables personalizadas */}
        <CustomFieldsPanel
          entityType="contact"
          definitions={definitions}
          values={contact.custom_fields}
          onUpdateField={saveCustom}
          onDefinitionCreated={onDefinitionCreated}
          onDefinitionUpdated={onDefinitionUpdated}
        />

        {/* Timeline */}
        <ActivityMiniList activities={activities} />
      </div>
    </SlideOver>
  );
}
