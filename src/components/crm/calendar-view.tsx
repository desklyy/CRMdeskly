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

type ViewMode = "week" | "month";

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function addMonths(d: Date, months: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth() + months, 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getMonthGridRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const gridStart = getMondayOfWeek(firstOfMonth);
  const lastWeekMonday = getMondayOfWeek(lastOfMonth);
  const gridEnd = addDays(lastWeekMonday, 7);
  const totalDays = Math.round(
    (gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)
  );
  const days = Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i));
  return { start: gridStart, end: gridEnd, days };
}

const WEEKDAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function CalendarView({ companies, contacts, deals }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchorDate, setAnchorDate] = useState<Date>(() => getMondayOfWeek(new Date()));
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [authInvalid, setAuthInvalid] = useState(false);
  const [microsoftEmail, setMicrosoftEmail] = useState<string | undefined>();
  const [events, setEvents] = useState<EnrichedCalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EnrichedCalendarEvent | null>(null);

  // Create meeting modal
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [dateStr, setDateStr] = useState(() => toLocalDateKey(new Date()));
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

  const visibleRange = useMemo(() => {
    if (viewMode === "month") {
      return getMonthGridRange(anchorDate);
    }
    const start = getMondayOfWeek(anchorDate);
    const end = addDays(start, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { start, end, days };
  }, [viewMode, anchorDate]);

  const loadRange = useCallback(async (start: Date, end: Date) => {
    setLoading(true);
    setError(null);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

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
    void loadRange(visibleRange.start, visibleRange.end);
  }, [visibleRange.start, visibleRange.end, loadRange]);

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealMap = useMemo(() => new Map(deals.map((d) => [d.id, d.title])), [deals]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EnrichedCalendarEvent[]>();
    for (const ev of events) {
      const key = (ev.start?.dateTime ?? "").slice(0, 10);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events]);

  function shiftPeriod(direction: -1 | 1) {
    setAnchorDate((prev) =>
      viewMode === "month" ? addMonths(prev, direction) : addDays(prev, direction * 7)
    );
  }

  function openCreateForDay(day?: Date) {
    setDateStr(toLocalDateKey(day ?? new Date()));
    setCreateOpen(true);
  }

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
      await loadRange(visibleRange.start, visibleRange.end);
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
      setSelectedEvent((prev) =>
        prev && prev.id === linkingEvent.id ? { ...prev, link: res.data ?? null } : prev
      );
      setLinkingEvent(null);
    }
  }

  async function handleDeleteEvent(msEventId: string) {
    if (!window.confirm("¿Cancelar esta reunión en Outlook?")) return;
    const res = await deleteOutlookMeetingAction(msEventId);
    if (res.ok) {
      setEvents((prev) => prev.filter((ev) => ev.id !== msEventId));
      setSelectedEvent((prev) => (prev?.id === msEventId ? null : prev));
    }
  }

  const todayKey = toLocalDateKey(new Date());
  const periodLabel =
    viewMode === "month"
      ? anchorDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" })
      : `Semana del ${visibleRange.start.toLocaleDateString("es-ES")}`;

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

  function renderEventCardActions(ev: EnrichedCalendarEvent) {
    return (
      <div className="mt-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => openLinkModal(ev)}
          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] text-[#334155] hover:bg-[#E2E8F0]"
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
              className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#E2E8F0]"
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
              className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#E2E8F0]"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={() => void handleDeleteEvent(ev.id)}
            title="Cancelar reunión"
            className="rounded-[4px] p-1 text-[#64748B] hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-[#0F172A]">
            Calendario Outlook
          </h1>
          <p className="text-xs capitalize text-[#64748B]">
            Fuente única en vivo {microsoftEmail ? `(${microsoftEmail})` : ""} · {periodLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-[4px] border border-[#E2E8F0] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "week"
                  ? "bg-[#1658F5] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              Semana
            </button>
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "month"
                  ? "bg-[#1658F5] text-white"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              Mes
            </button>
          </div>

          <div className="flex items-center rounded-[4px] border border-[#E2E8F0] bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => shiftPeriod(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAnchorDate(new Date())}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => shiftPeriod(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => openCreateForDay()}
            className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
          >
            <Plus className="h-3.5 w-3.5" />
            Agendar reunión
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-10 text-center text-xs text-[#64748B]">
          Consultando tu calendario de Outlook...
        </div>
      ) : viewMode === "week" ? (
        <div className="grid gap-3 md:grid-cols-7">
          {visibleRange.days.map((day) => {
            const dayKey = toLocalDateKey(day);
            const dayEvents = eventsByDay.get(dayKey) ?? [];
            const isToday = dayKey === todayKey;

            return (
              <div
                key={dayKey}
                className={`flex min-h-[320px] flex-col rounded-[4px] border bg-white ${
                  isToday ? "border-[#1658F5]" : "border-[#E2E8F0]"
                }`}
              >
                <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      {day.toLocaleDateString("es-ES", { weekday: "short" })}
                    </p>
                    <p
                      className={`text-sm font-bold ${
                        isToday ? "text-[#1658F5]" : "text-[#0F172A]"
                      }`}
                    >
                      {day.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateForDay(day)}
                    title="Agendar reunión este día"
                    className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#0F172A]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {dayEvents.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-[#64748B]">Libre</p>
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
                          className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2 text-xs"
                        >
                          <p className="font-mono text-[10px] text-[#64748B]">
                            {timeStart} – {timeEnd}
                          </p>
                          <p className="mt-0.5 font-semibold text-[#0F172A]">
                            {ev.subject || "(Sin título)"}
                          </p>

                          {(linkedDeal || linkedCompany) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {linkedDeal && <Badge variant="dark">{linkedDeal}</Badge>}
                              {linkedCompany && <Badge>{linkedCompany}</Badge>}
                            </div>
                          )}

                          {renderEventCardActions(ev)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[4px] border border-[#E2E8F0] bg-white">
          <div className="grid grid-cols-7 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            {WEEKDAY_HEADERS.map((label) => (
              <div
                key={label}
                className="border-r border-[#E2E8F0] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] last:border-r-0"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {visibleRange.days.map((day) => {
              const dayKey = toLocalDateKey(day);
              const dayEvents = eventsByDay.get(dayKey) ?? [];
              const isToday = dayKey === todayKey;
              const isCurrentMonth = day.getMonth() === anchorDate.getMonth();

              return (
                <div
                  key={dayKey}
                  className={`group flex min-h-[124px] flex-col border-b border-r border-[#E2E8F0] p-2 [&:nth-child(7n)]:border-r-0 ${
                    isCurrentMonth ? "bg-white" : "bg-[#F8FAFC]"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[4px] px-1.5 text-xs font-semibold ${
                        isToday
                          ? "bg-[#1658F5] text-white"
                          : isCurrentMonth
                            ? "text-[#0F172A]"
                            : "text-[#64748B]/60"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreateForDay(day)}
                      title="Agendar reunión este día"
                      className="rounded-[4px] p-0.5 text-[#64748B] opacity-0 transition-opacity hover:bg-[#E2E8F0] hover:text-[#0F172A] group-hover:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1 overflow-y-auto">
                    {dayEvents.map((ev) => {
                      const timeStart = ev.start?.dateTime.slice(11, 16) ?? "";
                      const hasLink = Boolean(ev.link);

                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setSelectedEvent(ev)}
                          className={`flex w-full items-center gap-1 rounded-[3px] border px-1.5 py-1 text-left text-[11px] transition-colors ${
                            hasLink
                              ? "border-[#1658F5]/40 bg-[#1658F5]/5 text-[#0F172A] hover:bg-[#1658F5]/10"
                              : "border-[#E2E8F0] bg-[#F8FAFC] text-[#334155] hover:border-[#64748B]"
                          }`}
                          title={`${timeStart} ${ev.subject || "(Sin título)"}`}
                        >
                          <span className="shrink-0 font-mono text-[10px] text-[#64748B]">
                            {timeStart}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {ev.subject || "(Sin título)"}
                          </span>
                          {ev.onlineMeeting?.joinUrl && (
                            <Video className="h-2.5 w-2.5 shrink-0 text-[#1658F5]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event Detail Modal (used from Monthly view) */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-xs text-[#64748B]">
                  {selectedEvent.start?.dateTime.slice(0, 10)} ·{" "}
                  {selectedEvent.start?.dateTime.slice(11, 16)} –{" "}
                  {selectedEvent.end?.dateTime.slice(11, 16)}
                </p>
                <h2 className="mt-1 text-base font-bold text-[#0F172A]">
                  {selectedEvent.subject || "(Sin título)"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {(selectedEvent.link?.deal_id || selectedEvent.link?.company_id) && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEvent.link?.deal_id && dealMap.get(selectedEvent.link.deal_id) && (
                  <Badge variant="dark">{dealMap.get(selectedEvent.link.deal_id)}</Badge>
                )}
                {selectedEvent.link?.company_id &&
                  companyMap.get(selectedEvent.link.company_id) && (
                    <Badge>{companyMap.get(selectedEvent.link.company_id)}</Badge>
                  )}
              </div>
            )}

            {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
              <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-xs text-[#334155]">
                <p className="font-semibold text-[#0F172A]">Asistentes</p>
                <p className="mt-0.5 text-[11px] text-[#64748B]">
                  {selectedEvent.attendees
                    .map((a) => a.emailAddress?.address)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            )}

            <div className="border-t border-[#E2E8F0] pt-2">
              {renderEventCardActions(selectedEvent)}
            </div>
          </div>
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

