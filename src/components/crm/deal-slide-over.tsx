"use client";

import React, { useEffect, useState } from "react";
import { Calendar, Mail, Plus, Trash2, Users } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InlineField } from "@/components/crm/inline-field";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { ActivityMiniList } from "@/components/crm/activity-mini-list";
import { QuoteBuilder } from "@/components/crm/quote-builder";
import {
  QuestionnaireFeedbackArea,
  SendQuestionnaireButton,
  useSendQuestionnaire,
  type QuestionnaireRecipientOption,
} from "@/components/crm/questionnaire-sender";
import { formatCurrencyEUR, type CustomFieldDefinition } from "@/lib/crm/custom-fields";
import { LOST_REASONS, type DealRow, type StageRow } from "@/lib/crm/deals";
import {
  addDealContactAction,
  deleteDealAction,
  getDealDetailsAction,
  logStructuredSummaryAction,
  moveDealAction,
  removeDealContactAction,
  updateDealCustomFieldAction,
  updateDealFieldAction,
  type DealContactJoined,
  type QuoteWithItems,
} from "@/app/(crm)/actions/deals-and-quotes";
import {
  createOutlookMeetingAction,
  getMyEmailSignatureAction,
  sendDealEmailAction,
} from "@/app/(crm)/actions/outlook";
import { sanitizeSignatureHtml } from "@/lib/email/templates";
import type { Database, Json, UserRole } from "@/types/database";

type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ContactSlim = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "first_name" | "last_name" | "email" | "company_id"
>;
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;
type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];
type EmailRow = Database["public"]["Tables"]["emails"]["Row"];
type CalendarLinkRow = Database["public"]["Tables"]["calendar_event_links"]["Row"];

type TabKey = "details" | "emails" | "meetings" | "quotes" | "timeline";

interface DealSlideOverProps {
  deal: DealRow | null;
  onClose: () => void;
  stages: StageRow[];
  companies: CompanySlim[];
  contacts: ContactSlim[];
  profiles: ProfileSlim[];
  definitions: CustomFieldDefinition[];
  currentUserRole: UserRole;
  onDealUpdated: (updated: DealRow) => void;
  onDealDeleted: (dealId: string) => void;
  onDefinitionCreated: (def: CustomFieldDefinition) => void;
  onDefinitionUpdated: (def: CustomFieldDefinition) => void;
}

const PRIORITY_OPTIONS = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

export function DealSlideOver({
  deal,
  onClose,
  stages,
  companies,
  contacts,
  profiles,
  definitions,
  currentUserRole,
  onDealUpdated,
  onDealDeleted,
  onDefinitionCreated,
  onDefinitionUpdated,
}: DealSlideOverProps) {
  const [tab, setTab] = useState<TabKey>("details");
  const [dealContacts, setDealContacts] = useState<DealContactJoined[]>([]);
  const [quotes, setQuotes] = useState<QuoteWithItems[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [calendarLinks, setCalendarLinks] = useState<CalendarLinkRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [newContactId, setNewContactId] = useState("");
  const [newContactRole, setNewContactRole] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [summaryType, setSummaryType] = useState<"call_summary" | "meeting_summary">(
    "call_summary"
  );
  const [summaryOutcome, setSummaryOutcome] = useState("Avanza a siguiente paso");
  const [summaryObjections, setSummaryObjections] = useState("");
  const [summaryOneLiner, setSummaryOneLiner] = useState("");
  const [savingSummary, setSavingSummary] = useState(false);

  // Outlook Email composer & on-demand body
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<string | null>(null);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [expandedBody, setExpandedBody] = useState<string | null>(null);
  const [loadingEmailBody, setLoadingEmailBody] = useState(false);
  const [mySignature, setMySignature] = useState<string | null>(null);
  const [includeEmailSignature, setIncludeEmailSignature] = useState(true);

  // Quick Outlook meeting scheduler
  const [meetingSubject, setMeetingSubject] = useState("");
  const [meetingDate, setMeetingDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [meetingStart, setMeetingStart] = useState("11:00");
  const [meetingEnd, setMeetingEnd] = useState("11:30");
  const [schedulingMeeting, setSchedulingMeeting] = useState(false);
  const [meetingFeedback, setMeetingFeedback] = useState<string | null>(null);

  const dealRecipients: QuestionnaireRecipientOption[] = React.useMemo(() => {
    if (!deal) return [];
    const seen = new Set<string>();
    const list: QuestionnaireRecipientOption[] = [];
    const pushIfNew = (c: QuestionnaireRecipientOption | undefined) => {
      if (!c || seen.has(c.id)) return;
      seen.add(c.id);
      list.push(c);
    };

    if (deal.primary_contact_id) {
      pushIfNew(contacts.find((c) => c.id === deal.primary_contact_id));
    }
    for (const dc of dealContacts) {
      pushIfNew({
        id: dc.contact_id,
        first_name: dc.first_name,
        last_name: dc.last_name,
        email: dc.email,
      });
    }
    if (deal.company_id) {
      for (const c of contacts) {
        if (c.company_id === deal.company_id) pushIfNew(c);
      }
    }
    return list;
  }, [deal, contacts, dealContacts]);

  const questionnaire = useSendQuestionnaire({
    entityType: "deal",
    entityId: deal?.id ?? "",
    recipients: dealRecipients,
    preferredContactId: deal?.primary_contact_id ?? null,
    companyId: deal?.company_id ?? null,
    dealId: deal?.id ?? null,
    onSent: ({ emailRow }) => {
      if (emailRow) {
        setEmails((prev) => [emailRow, ...prev]);
      }
      if (deal) {
        onDealUpdated({ ...deal, last_activity_at: new Date().toISOString() });
        void getDealDetailsAction(deal.id).then((res) => {
          setActivities(res.activities);
        });
      }
    },
  });

  useEffect(() => {
    if (!deal) return;
    setTab("details");
    setExpandedEmailId(null);
    setExpandedBody(null);
    setEmailFeedback(null);
    setMeetingFeedback(null);
    setIncludeEmailSignature(true);
    const primary = contacts.find((c) => c.id === deal.primary_contact_id);
    setEmailTo(primary?.email ?? "");
    setEmailSubject(`Sobre ${deal.title}`);
    setMeetingSubject(`Reunión: ${deal.title}`);
    let active = true;
    void getDealDetailsAction(deal.id).then((res) => {
      if (!active) return;
      setDealContacts(res.dealContacts);
      setQuotes(res.quotes);
      setEmails(res.emails);
      setCalendarLinks(res.calendarLinks);
      setActivities(res.activities);
    });
    void getMyEmailSignatureAction().then((sig) => {
      if (active) setMySignature(sig);
    });
    return () => {
      active = false;
    };
  }, [deal, contacts]);

  if (!deal) return null;

  const primaryContactEmail =
    contacts.find((c) => c.id === deal.primary_contact_id)?.email ??
    dealContacts.find((c) => Boolean(c.email))?.email ??
    null;

  async function saveCore(patch: Database["public"]["Tables"]["deals"]["Update"]) {
    if (!deal) return;
    const res = await updateDealFieldAction(deal.id, patch);
    if (res.data) onDealUpdated(res.data);
  }

  async function saveCustom(key: string, value: Json) {
    if (!deal) return;
    const res = await updateDealCustomFieldAction(deal.id, key, value);
    if (res.data) onDealUpdated(res.data);
  }

  async function handleStageChange(nextStageId: string) {
    if (!deal || nextStageId === deal.stage_id) return;
    const res = await moveDealAction({
      dealId: deal.id,
      targetStageId: nextStageId,
      position: deal.position,
    });
    if (res.data) onDealUpdated(res.data);
  }

  async function handleAddContact() {
    if (!deal || !newContactId) return;
    const res = await addDealContactAction(deal.id, newContactId, newContactRole);
    if (res.ok) {
      const details = await getDealDetailsAction(deal.id);
      setDealContacts(details.dealContacts);
      setNewContactId("");
      setNewContactRole("");
    }
  }

  async function handleRemoveContact(contactId: string) {
    if (!deal) return;
    const res = await removeDealContactAction(deal.id, contactId);
    if (res.ok) {
      setDealContacts((prev) => prev.filter((c) => c.contact_id !== contactId));
    }
  }

  async function handleLogSummary(e: React.FormEvent) {
    e.preventDefault();
    if (!deal) return;
    setSavingSummary(true);
    try {
      const objectionsList = summaryObjections
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await logStructuredSummaryAction({
        dealId: deal.id,
        companyId: deal.company_id,
        contactId: deal.primary_contact_id,
        eventType: summaryType,
        outcome: summaryOutcome,
        objections: objectionsList,
        summaryOneLiner,
      });

      if (res.ok) {
        setSummaryOneLiner("");
        setSummaryObjections("");
        const details = await getDealDetailsAction(deal.id);
        setActivities(details.activities);
      }
    } finally {
      setSavingSummary(false);
    }
  }

  async function handleDelete() {
    if (!deal || currentUserRole !== "admin") return;
    if (!window.confirm(`¿Eliminar el negocio "${deal.title}"?`)) return;
    setDeleting(true);
    try {
      const res = await deleteDealAction(deal.id);
      if (res.ok) {
        onDealDeleted(deal.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const contactOptions = contacts.map((c) => ({
    value: c.id,
    label: [c.first_name, c.last_name].filter(Boolean).join(" "),
  }));
  const ownerOptions = profiles.map((p) => ({ value: p.id, label: p.full_name }));

  const TABS: { key: TabKey; label: string }[] = [
    { key: "details", label: "Variables y Detalle" },
    { key: "emails", label: `Emails (${emails.length})` },
    { key: "meetings", label: `Reuniones (${calendarLinks.length})` },
    { key: "quotes", label: `Presupuestos (${quotes.length})` },
    { key: "timeline", label: `Timeline (${activities.length})` },
  ];

  return (
    <SlideOver
      open={Boolean(deal)}
      onClose={onClose}
      title={deal.title}
      subtitle={`${formatCurrencyEUR(deal.amount)} · Estado: ${deal.status.toUpperCase()}`}
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
              title="Eliminar negocio (solo Admin)"
              className="text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </>
      }
    >
      <QuestionnaireFeedbackArea state={questionnaire} />
      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-[#E2E8F0] pb-2">
        {TABS.map((t) => (
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

      {tab === "details" && (
        <div className="space-y-6">
          <div className="space-y-1.5">
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Variables del negocio
            </h3>
            <div className="rounded-md border border-slate-200 bg-white p-1.5">
              <InlineField
                label="Título"
                value={deal.title}
                onSave={async (val) => {
                  if (val) await saveCore({ title: val });
                }}
              />
              <InlineField
                label="Importe (€)"
                type="number"
                value={deal.amount}
                onSave={(val) => saveCore({ amount: Number(val) || 0 })}
              />
              <InlineField
                label="Etapa"
                type="select"
                value={deal.stage_id}
                options={stageOptions}
                onSave={async (val) => {
                  if (val) await handleStageChange(val);
                }}
              />
              <InlineField
                label="Prioridad"
                type="select"
                value={deal.priority}
                options={PRIORITY_OPTIONS}
                onSave={(val) =>
                  saveCore({
                    priority: (val as DealRow["priority"]) ?? "medium",
                  })
                }
              />
              <InlineField
                label="Empresa"
                type="select"
                value={deal.company_id}
                options={companyOptions}
                onSave={(val) => saveCore({ company_id: val })}
              />
              <InlineField
                label="Contacto principal"
                type="select"
                value={deal.primary_contact_id}
                options={contactOptions}
                onSave={(val) => saveCore({ primary_contact_id: val })}
              />
              <InlineField
                label="Propietario"
                type="select"
                value={deal.owner_id}
                options={ownerOptions}
                onSave={(val) => saveCore({ owner_id: val })}
              />
              <InlineField
                label="Siguiente acción"
                value={deal.next_action}
                placeholder="Ej. Enviar propuesta revisada"
                onSave={(val) => saveCore({ next_action: val })}
              />
              <div className="grid grid-cols-[140px_1fr] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50">
                <span className="text-xs font-medium text-slate-500">
                  Fecha sig. acción
                </span>
                <input
                  type="date"
                  value={deal.next_action_date ?? ""}
                  onChange={(e) =>
                    void saveCore({ next_action_date: e.target.value || null })
                  }
                  className="h-7 rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-[140px_1fr] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50">
                <span className="text-xs font-medium text-slate-500">
                  Cierre esperado
                </span>
                <input
                  type="date"
                  value={deal.expected_close_date ?? ""}
                  onChange={(e) =>
                    void saveCore({ expected_close_date: e.target.value || null })
                  }
                  className="h-7 rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
                />
              </div>
              {deal.status === "lost" && (
                <InlineField
                  label="Motivo pérdida"
                  type="select"
                  value={deal.lost_reason}
                  options={LOST_REASONS.map((r) => ({ value: r, label: r }))}
                  onSave={(val) => saveCore({ lost_reason: val })}
                />
              )}
            </div>
          </div>

          {/* Multi-contacto */}
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Contactos en el negocio ({dealContacts.length})
            </h3>

            {dealContacts.length > 0 && (
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                {dealContacts.map((dc) => (
                  <div
                    key={dc.contact_id}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {[dc.first_name, dc.last_name].filter(Boolean).join(" ")}
                      </p>
                      <p className="text-slate-500">
                        {dc.role_in_deal ?? "Participante"} · {dc.email ?? "sin email"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveContact(dc.contact_id)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newContactId}
                onChange={(e) => setNewContactId(e.target.value)}
                className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
              >
                <option value="">Añadir contacto...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Rol (Decisor, Técnico...)"
                value={newContactRole}
                onChange={(e) => setNewContactRole(e.target.value)}
                className="h-8 w-40 text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={handleAddContact}>
                <Plus className="h-3.5 w-3.5" />
                Asociar
              </Button>
            </div>
          </div>

          {/* Custom fields */}
          <CustomFieldsPanel
            entityType="deal"
            definitions={definitions}
            values={deal.custom_fields}
            onUpdateField={saveCustom}
            onDefinitionCreated={onDefinitionCreated}
            onDefinitionUpdated={onDefinitionUpdated}
          />
        </div>
      )}

      {tab === "quotes" && (
        <QuoteBuilder
          dealId={deal.id}
          companyId={deal.company_id}
          contactId={deal.primary_contact_id}
          contactEmail={primaryContactEmail}
          emailSignature={mySignature}
          quotes={quotes}
          onQuotesChanged={setQuotes}
          onDealAmountSynced={(newAmount) =>
            onDealUpdated({ ...deal, amount: newAmount })
          }
        />
      )}

      {tab === "emails" && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setEmailFeedback(null);
              setSendingEmail(true);
              try {
                const res = await sendDealEmailAction({
                  dealId: deal.id,
                  companyId: deal.company_id,
                  contactId: deal.primary_contact_id,
                  toEmail: emailTo,
                  subject: emailSubject,
                  bodyText: emailBody,
                  includeSignature: includeEmailSignature,
                });
                if (res.error) {
                  setEmailFeedback(res.error);
                  return;
                }
                if (res.data) {
                  setEmails((prev) => [res.data!, ...prev]);
                }
                setEmailBody("");
                setIncludeEmailSignature(true);
                setEmailFeedback("Email enviado por Outlook.");
              } finally {
                setSendingEmail(false);
              }
            }}
            className="space-y-2.5 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#334155]">
                <Mail className="h-3.5 w-3.5" />
                Enviar correo por Outlook
              </h3>
            </div>
            {emailFeedback && (
              <p className="text-xs text-[#0F172A]">{emailFeedback}</p>
            )}
            <Input
              required
              type="email"
              placeholder="Para: contacto@empresa.es"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              required
              placeholder="Asunto"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="h-8 text-xs"
            />
            <textarea
              required
              rows={3}
              placeholder="Escribe el mensaje..."
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              className="w-full rounded-[4px] border border-[#E2E8F0] bg-white p-2 text-xs text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
            />

            {mySignature && (
              <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-[#0F172A]">
                    <input
                      type="checkbox"
                      checked={includeEmailSignature}
                      onChange={(e) => setIncludeEmailSignature(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[#E2E8F0] accent-[#1658F5]"
                    />
                    <span>Firma personal incluida</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIncludeEmailSignature((v) => !v)}
                    className="text-[11px] font-semibold text-[#1658F5] hover:underline"
                  >
                    {includeEmailSignature ? "Quitar de este email" : "Volver a incluir"}
                  </button>
                </div>

                {includeEmailSignature && (
                  <div
                    className="mt-2 border-t border-[#E2E8F0] pt-2 text-[12px] leading-relaxed text-[#334155]"
                    dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtml(mySignature) }}
                  />
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={sendingEmail}>
                <Mail className="h-3.5 w-3.5" />
                {sendingEmail ? "Enviando..." : "Enviar email"}
              </Button>
            </div>
          </form>

          {emails.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
              No hay correos vinculados todavía.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {emails.map((em) => {
                const isExpanded = expandedEmailId === em.id;
                return (
                  <div key={em.id} className="p-3 text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        if (isExpanded) {
                          setExpandedEmailId(null);
                          return;
                        }
                        setExpandedEmailId(em.id);
                        setExpandedBody(null);
                        setLoadingEmailBody(true);
                        try {
                          const r = await fetch(`/api/emails/${em.id}/body`);
                          const payload = (await r.json()) as { content?: string };
                          setExpandedBody(payload.content ?? em.body_preview ?? "");
                        } finally {
                          setLoadingEmailBody(false);
                        }
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">
                          {em.subject ?? "(Sin asunto)"}
                        </span>
                        <Badge>{em.direction}</Badge>
                      </div>
                      <p className="mt-1 text-slate-500">{em.body_preview ?? ""}</p>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-2.5 text-slate-700">
                        {loadingEmailBody ? (
                          <span className="text-slate-400">
                            Cargando cuerpo completo desde Outlook...
                          </span>
                        ) : (
                          <div
                            className="prose prose-xs max-w-none break-words"
                            dangerouslySetInnerHTML={{
                              __html: expandedBody ?? em.body_preview ?? "",
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "meetings" && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setMeetingFeedback(null);
              setSchedulingMeeting(true);
              try {
                const res = await createOutlookMeetingAction({
                  subject: meetingSubject,
                  startIso: `${meetingDate}T${meetingStart}:00`,
                  endIso: `${meetingDate}T${meetingEnd}:00`,
                  attendeeEmails: primaryContactEmail ? [primaryContactEmail] : [],
                  isOnlineMeeting: true,
                  dealId: deal.id,
                  companyId: deal.company_id,
                  contactId: deal.primary_contact_id,
                });
                if (res.error) {
                  setMeetingFeedback(res.error);
                  return;
                }
                const details = await getDealDetailsAction(deal.id);
                setCalendarLinks(details.calendarLinks);
                setMeetingFeedback("Reunión agendada en Outlook con Teams.");
              } finally {
                setSchedulingMeeting(false);
              }
            }}
            className="space-y-2.5 rounded-md border border-slate-200 bg-slate-50/70 p-3.5"
          >
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <Calendar className="h-3.5 w-3.5" />
              Agendar reunión Outlook + Teams
            </h3>
            {meetingFeedback && (
              <p className="text-xs text-slate-700">{meetingFeedback}</p>
            )}
            <Input
              required
              placeholder="Asunto de la reunión"
              value={meetingSubject}
              onChange={(e) => setMeetingSubject(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="date"
                required
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="h-8 text-xs"
              />
              <Input
                type="time"
                required
                value={meetingStart}
                onChange={(e) => setMeetingStart(e.target.value)}
                className="h-8 text-xs"
              />
              <Input
                type="time"
                required
                value={meetingEnd}
                onChange={(e) => setMeetingEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Invitado: {primaryContactEmail ?? "sin email principal"}
              </span>
              <Button type="submit" size="sm" disabled={schedulingMeeting}>
                <Plus className="h-3.5 w-3.5" />
                {schedulingMeeting ? "Agendando..." : "Crear en Outlook"}
              </Button>
            </div>
          </form>

          {calendarLinks.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
              Sin reuniones vinculadas todavía.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {calendarLinks.map((cl) => (
                <div key={cl.id} className="p-3 font-mono text-xs text-slate-700">
                  Evento Outlook: {cl.ms_event_id}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-5">
          <form
            onSubmit={handleLogSummary}
            className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3.5"
          >
            <p className="text-xs font-semibold text-slate-900">
              Registrar resumen estructurado (máx. 280 caracteres)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={summaryType}
                onChange={(e) =>
                  setSummaryType(e.target.value as "call_summary" | "meeting_summary")
                }
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="call_summary">Llamada comercial</option>
                <option value="meeting_summary">Reunión / Demo</option>
              </select>
              <Input
                required
                placeholder="Resultado (ej. Pide presupuesto)"
                value={summaryOutcome}
                onChange={(e) => setSummaryOutcome(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Input
              placeholder="Objeciones separadas por coma (opcional)"
              value={summaryObjections}
              onChange={(e) => setSummaryObjections(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex items-center gap-2">
              <Input
                required
                maxLength={280}
                placeholder="Síntesis en 1 línea..."
                value={summaryOneLiner}
                onChange={(e) => setSummaryOneLiner(e.target.value)}
                className="h-8 flex-1 text-xs"
              />
              <Button type="submit" size="sm" disabled={savingSummary}>
                Registrar
              </Button>
            </div>
          </form>

          <ActivityMiniList activities={activities} />
        </div>
      )}
    </SlideOver>
  );
}

