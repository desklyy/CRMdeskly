"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createOutlookMeetingAction,
  deleteOutlookMeetingAction,
  getCalendarAgendaAction,
  linkCalendarEventAction,
  type EnrichedCalendarEvent,
} from "@/app/(crm)/actions/outlook";
import type { Database } from "@/types/database";

type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ContactSlim = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "first_name" | "last_name" | "email" | "company_id"
>;
type DealSlim = Pick<
  Database["public"]["Tables"]["deals"]["Row"],
  "id" | "title" | "company_id"
>;

interface CalendarViewProps {
  companies: CompanySlim[];
  contacts: ContactSlim[];
  deals: DealSlim[];
}

function getMondayOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function CalendarView({ companies, contacts, deals }: CalendarViewProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()));
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [authInvalid, setAuthInvalid] = useState(false);
  const [microsoftEmail, setMicrosoftEmail] = useState<string | undefined>();
  const [events, setEvents] = useState<EnrichedCalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create meeting modal
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [attendeesText, setAttendeesText] = useState("");
  const [isTeams, setIsTeams] = useState(true);
  const [newDealId, setNewDealId] = useState("");
  const [newCompanyId, setNewCompanyId] = useState("");
  const [newContactId, setNewContactId] = useState("");
  const [creating, setCreating] = useState(false);

  // Link modal
  const [linkingEvent, setLinkingEvent] = useState<EnrichedCalendarEvent | null>(null);
  const [linkCompanyId, setLinkCompanyId] = useState("");
  const [linkContactId, setLinkContactId] = useState("");
  const [linkDealId, setLinkDealId] = useState("");

  const loadWeek = useCallback(async (monday: Date) => {
    setLoading(true);
    setError(null);
    const startIso = monday.toISOString();
    const endIso = addDays(monday, 7).toISOString();

    try {
      const res = await getCalendarAgendaAction(startIso, endIso);
      setConnected(res.connected);
      setAuthInvalid(Boolean(res.authInvalid));
      setMicrosoftEmail(res.microsoftEmail);
      setEvents(res.events);
      if (res.error) setError(res.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealMap = useMemo(() => new Map(deals.map((d) => [d.id, d.title])), [deals]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  async function handleCreateMeeting(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const startIso = `${dateStr}T${startTime}:00`;
      const endIso = `${dateStr}T${endTime}:00`;
      const attendeeEmails = attendeesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await createOutlookMeetingAction({
        subject,
        startIso,
        endIso,
        attendeeEmails,
        isOnlineMeeting: isTeams,
        dealId: newDealId || null,
        companyId: newCompanyId || null,
        contactId: newContactId || null,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      setCreateOpen(false);
      setSubject("");
      setAttendeesText("");
      await loadWeek(weekStart);
    } finally {
      setCreating(false);
    }
  }

  function openLinkModal(ev: EnrichedCalendarEvent) {
    setLinkingEvent(ev);
    setLinkCompanyId(ev.link?.company_id ?? "");
    setLinkContactId(ev.link?.contact_id ?? "");
    setLinkDealId(ev.link?.deal_id ?? "");
  }

  async function handleSaveLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkingEvent) return;

    const res = await linkCalendarEventAction({
      msEventId: linkingEvent.id,
      icalUid: linkingEvent.iCalUId ?? null,
      companyId: linkCompanyId || null,
      contactId: linkContactId || null,
      dealId: linkDealId || null,
    });

    if (!res.error) {
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === linkingEvent.id ? { ...ev, link: res.data ?? null } : ev
        )
      );
      setLinkingEvent(null);
    }
  }

  async function handleDeleteEvent(msEventId: string) {
    if (!window.confirm("¿Cancelar esta reunión en Outlook?")) return;
    const res = await deleteOutlookMeetingAction(msEventId);
    if (res.ok) {
      setEvents((prev) => prev.filter((ev) => ev.id !== msEventId));
    }
  }

  if (!loading && (!connected || authInvalid)) {
    return (
      <div className="mx-auto max-w-3xl rounded-[4px] border border-[#E2E8F0] bg-white p-[30px] text-center">
        <CalendarIcon className="mx-auto mb-3 h-8 w-8 text-[#64748B]" />
        <h1 className="text-lg font-bold tracking-[-0.02em] text-[#0F172A]">
          {authInvalid ? "Vuelve a iniciar sesión con Outlook" : "Inicia sesión con Outlook"}
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          El calendario lee, crea y edita directamente sobre tu calendario real de
          Microsoft Outlook sin duplicar datos.
        </p>
        <a
          href="/api/outlook/connect"
          className="mt-5 inline-flex h-9 items-center rounded-[4px] bg-[#1658F5] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1246C8]"
        >
          {authInvalid ? "Volver a iniciar sesión con Outlook" : "Iniciar sesión con Outlook"}
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Calendario Outlook
          </h1>
          <p className="text-xs text-slate-500">
            Fuente única en vivo {microsoftEmail ? `(${microsoftEmail})` : ""} · Semana del{" "}
            {weekStart.toLocaleDateString("es-ES")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-slate-200 bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWeekStart(getMondayOfWeek(new Date()))}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Agendar reunión
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Consultando tu calendario de Outlook...
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {weekDays.map((day) => {
            const isoPrefix = day.toISOString().slice(0, 10);
            const dayEvents = events.filter((ev) =>
              (ev.start?.dateTime ?? "").startsWith(isoPrefix)
            );

            return (
              <div
                key={isoPrefix}
                className="flex min-h-[320px] flex-col rounded-lg border border-slate-200 bg-white"
              >
                <div className="border-b border-slate-200 bg-slate-50/70 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {day.toLocaleDateString("es-ES", { weekday: "short" })}
                  </p>
                  <p className="text-sm font-semibold text-slate-950">
                    {day.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                  </p>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {dayEvents.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-slate-400">Libre</p>
                  ) : (
                    dayEvents.map((ev) => {
                      const timeStart = ev.start?.dateTime.slice(11, 16) ?? "";
                      const timeEnd = ev.end?.dateTime.slice(11, 16) ?? "";
                      const linkedDeal = ev.link?.deal_id
                        ? dealMap.get(ev.link.deal_id)
                        : null;
                      const linkedCompany = ev.link?.company_id
                        ? companyMap.get(ev.link.company_id)
                        : null;

                      return (
                        <div
                          key={ev.id}
                          className="rounded-md border border-slate-200 bg-slate-50/60 p-2 text-xs"
                        >
                          <p className="font-mono text-[10px] text-slate-500">
                            {timeStart} – {timeEnd}
                          </p>
                          <p className="mt-0.5 font-medium text-slate-950">
                            {ev.subject || "(Sin título)"}
                          </p>

                          {(linkedDeal || linkedCompany) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {linkedDeal && <Badge variant="dark">{linkedDeal}</Badge>}
                              {linkedCompany && <Badge>{linkedCompany}</Badge>}
                            </div>
                          )}

                          <div className="mt-2 flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={() => openLinkModal(ev)}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
                              title="Vincular / desvincular al CRM"
                            >
                              <Link2 className="h-3 w-3" />
                              {ev.link ? "Vinculado" : "Vincular"}
                            </button>

                            <div className="flex items-center gap-1">
                              {ev.onlineMeeting?.joinUrl && (
                                <a
                                  href={ev.onlineMeeting.joinUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Abrir Teams"
                                  className="rounded p-1 text-slate-500 hover:bg-slate-200"
                                >
                                  <Video className="h-3 w-3" />
                                </a>
                              )}
                              {ev.webLink && (
                                <a
                                  href={ev.webLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Abrir en Outlook"
                                  className="rounded p-1 text-slate-500 hover:bg-slate-200"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteEvent(ev.id)}
                                title="Cancelar reunión"
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Meeting Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]"
          onClick={() => setCreateOpen(false)}
        >
          <form
            onSubmit={handleCreateMeeting}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">
                Agendar reunión en Outlook
              </h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Asunto *</label>
              <Input
                required
                autoFocus
                placeholder="Ej. Demo Deskly CRM"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Fecha</label>
                <Input
                  type="date"
                  required
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Inicio</label>
                <Input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Fin</label>
                <Input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">
                Asistentes (emails separados por coma)
              </label>
              <Input
                placeholder="cliente@empresa.es, socio@empresa.es"
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={newDealId}
                onChange={(e) => setNewDealId(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="">Negocio (opcional)</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <select
                value={newCompanyId}
                onChange={(e) => setNewCompanyId(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="">Empresa (opcional)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <select
              value={newContactId}
              onChange={(e) => {
                const cid = e.target.value;
                setNewContactId(cid);
                const found = contacts.find((c) => c.id === cid);
                if (found?.email && !attendeesText.includes(found.email)) {
                  setAttendeesText((prev) =>
                    prev.trim() ? `${prev}, ${found.email}` : found.email!
                  );
                }
              }}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="">Contacto CRM (opcional, añade su email)</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.first_name, c.last_name].filter(Boolean).join(" ")} (
                  {c.email ?? "sin email"})
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={isTeams}
                onChange={(e) => setIsTeams(e.target.checked)}
              />
              Incluir enlace automático de Microsoft Teams
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Creando..." : "Crear en Outlook"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Link Event Modal */}
      {linkingEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]"
          onClick={() => setLinkingEvent(null)}
        >
          <form
            onSubmit={handleSaveLink}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-slate-950">
              Vincular reunión al CRM
            </h3>
            <p className="text-xs text-slate-500">
              {linkingEvent.subject || "(Sin asunto)"}
            </p>

            <div className="space-y-2">
              <select
                value={linkCompanyId}
                onChange={(e) => setLinkCompanyId(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">Sin empresa</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={linkContactId}
                onChange={(e) => setLinkContactId(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">Sin contacto</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                  </option>
                ))}
              </select>

              <select
                value={linkDealId}
                onChange={(e) => setLinkDealId(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">Sin negocio</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLinkingEvent(null)}
              >
                Cancelar
              </Button>
              <Button type="submit">Guardar vínculo</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

