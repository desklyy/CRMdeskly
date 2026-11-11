"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/supabase/auth-guard";
import { logUserActivity } from "@/lib/crm/activities";
import {
  recordOutboundEmailAndActivity,
  requireConnectedOutlook,
  stripHtml,
} from "@/lib/crm/outbound-mail";
import {
  appendSignatureToHtmlBody,
  buildOperationalQuestionnaireEmail,
  sanitizeSignatureHtml,
} from "@/lib/email/templates";
import {
  createOutlookEvent,
  deleteOutlookEvent,
  listCalendarView,
  OutlookAuthInvalidError,
  sendOutlookMail,
  updateOutlookEvent,
  type GraphEvent,
} from "@/lib/microsoft/graph";
import type { ActivityEntityType, Database } from "@/types/database";

type CalendarLinkRow = Database["public"]["Tables"]["calendar_event_links"]["Row"];

async function requireUser() {
  return requireActiveUser();
}

export async function sendDealEmailAction(input: {
  dealId: string;
  companyId: string | null;
  contactId: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  includeSignature?: boolean;
}) {
  const { supabase, user } = await requireUser();
  const toEmail = input.toEmail.trim().toLowerCase();
  if (!toEmail || !input.subject.trim()) {
    return { error: "El destinatario y el asunto son obligatorios." };
  }

  if (!input.contactId) {
    return { error: "El negocio necesita un contacto principal para registrar el email." };
  }

  const outlook = await requireConnectedOutlook(supabase, user.id);
  if ("error" in outlook) {
    return { error: outlook.error };
  }

  let personalSignature: string | null = null;
  if (input.includeSignature !== false) {
    const { data: profileSig } = await supabase
      .from("profiles")
      .select("email_signature")
      .eq("id", user.id)
      .maybeSingle();
    personalSignature = profileSig?.email_signature ?? null;
  }

  const rawHtmlBody = input.bodyText
    .split("\n")
    .map((line) => `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "&nbsp;"}</p>`)
    .join("");

  const htmlBody = appendSignatureToHtmlBody(rawHtmlBody, personalSignature);

  try {
    await sendOutlookMail(user.id, {
      to: [toEmail],
      subject: input.subject.trim(),
      htmlBody,
      attachments: [],
    });
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return { error: err.message, authInvalid: true };
    }
    return {
      error: err instanceof Error ? err.message : "Error enviando correo por Outlook.",
    };
  }

  const emailRow = await recordOutboundEmailAndActivity({
    supabase,
    userId: user.id,
    microsoftEmail: outlook.microsoftEmail,
    toEmail,
    subject: input.subject.trim(),
    preview: stripHtml(rawHtmlBody),
    hasAttachments: false,
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    activityEntityType: "deal",
    activityEntityId: input.dealId,
    eventType: "email_sent",
  });

  revalidatePath("/pipelines");
  return { data: emailRow };
}

export async function sendQuestionnaireEmailAction(input: {
  contactId: string;
  companyId?: string | null;
  dealId?: string | null;
  entityType: Extract<ActivityEntityType, "deal" | "company" | "contact">;
  entityId: string;
}) {
  const { supabase, user } = await requireUser();

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, email, company_id")
    .eq("id", input.contactId)
    .maybeSingle();

  if (!contact) {
    return { error: "Contacto no encontrado." };
  }

  const toEmail = contact.email?.trim().toLowerCase();
  if (!toEmail) {
    return { error: "El contacto seleccionado no tiene email asignado." };
  }

  const outlook = await requireConnectedOutlook(supabase, user.id);
  if ("error" in outlook) {
    return { error: outlook.error };
  }

  const { subject, htmlBody, textPreview } = buildOperationalQuestionnaireEmail(
    contact.first_name
  );

  try {
    await sendOutlookMail(user.id, {
      to: [toEmail],
      subject,
      htmlBody,
    });
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return { error: err.message, authInvalid: true };
    }
    return {
      error:
        err instanceof Error ? err.message : "Error enviando el cuestionario por Outlook.",
    };
  }

  const emailRow = await recordOutboundEmailAndActivity({
    supabase,
    userId: user.id,
    microsoftEmail: outlook.microsoftEmail,
    toEmail,
    subject,
    preview: textPreview,
    hasAttachments: false,
    contactId: contact.id,
    companyId: input.companyId ?? contact.company_id ?? null,
    dealId: input.dealId ?? null,
    activityEntityType: input.entityType,
    activityEntityId: input.entityId,
    eventType: "email_sent",
    extraMetadata: {
      template: "cuestionario_operativo",
      greeting_name: contact.first_name,
    },
  });

  revalidatePath("/pipelines");
  revalidatePath("/contacts");
  revalidatePath("/companies");
  revalidatePath("/");

  return {
    data: emailRow,
    toEmail,
    greetingName: contact.first_name?.trim() || "",
  };
}

export async function getMyEmailSignatureAction(): Promise<string | null> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("profiles")
    .select("email_signature")
    .eq("id", user.id)
    .maybeSingle();

  const raw = data?.email_signature;
  if (!raw) return null;
  const clean = sanitizeSignatureHtml(raw);
  return clean || null;
}

export async function updateMyEmailSignatureAction(rawSignatureHtml: string) {
  const { supabase } = await requireUser();
  const sanitized = sanitizeSignatureHtml(rawSignatureHtml);

  const { data, error } = await supabase.rpc("update_my_email_signature", {
    p_signature: sanitized,
  });

  if (error) {
    if (
      error.message.includes("update_my_email_signature") ||
      error.message.includes("email_signature")
    ) {
      return {
        error:
          "Falta aplicar la migración SQL 0006_profile_email_signature.sql en Supabase.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { data: data ?? null };
}

// ---------------------------------------------------------------------------
// CALENDARIO OUTLOOK DIRECTO
// ---------------------------------------------------------------------------

export interface EnrichedCalendarEvent extends GraphEvent {
  link: CalendarLinkRow | null;
}

export async function getCalendarAgendaAction(startIso: string, endIso: string): Promise<{
  connected: boolean;
  authInvalid?: boolean;
  microsoftEmail?: string;
  events: EnrichedCalendarEvent[];
  error?: string;
}> {
  const { supabase, user } = await requireUser();

  const { data: conn } = await supabase
    .from("oauth_connections")
    .select("microsoft_email, is_auth_invalid")
    .eq("user_id", user.id)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn) {
    return { connected: false, events: [] };
  }

  if (conn.is_auth_invalid) {
    return {
      connected: true,
      authInvalid: true,
      microsoftEmail: conn.microsoft_email,
      events: [],
    };
  }

  try {
    const [events, linksRes] = await Promise.all([
      listCalendarView(user.id, startIso, endIso),
      supabase.from("calendar_event_links").select("*").eq("user_id", user.id),
    ]);

    const linkMap = new Map((linksRes.data ?? []).map((l) => [l.ms_event_id, l]));

    return {
      connected: true,
      microsoftEmail: conn.microsoft_email,
      events: events.map((ev) => ({
        ...ev,
        link: linkMap.get(ev.id) ?? null,
      })),
    };
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return {
        connected: true,
        authInvalid: true,
        microsoftEmail: conn.microsoft_email,
        events: [],
      };
    }
    return {
      connected: true,
      microsoftEmail: conn.microsoft_email,
      events: [],
      error: err instanceof Error ? err.message : "No se pudo leer Outlook Calendar.",
    };
  }
}

export async function createOutlookMeetingAction(input: {
  subject: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  isOnlineMeeting?: boolean;
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
}) {
  const { supabase, user } = await requireUser();
  if (!input.subject.trim()) {
    return { error: "El asunto de la reunión es obligatorio." };
  }

  try {
    const created = await createOutlookEvent(user.id, {
      subject: input.subject.trim(),
      startIso: input.startIso,
      endIso: input.endIso,
      attendeeEmails: input.attendeeEmails,
      isOnlineMeeting: input.isOnlineMeeting ?? true,
    });

    let linkRow: CalendarLinkRow | null = null;
    if (input.dealId || input.companyId || input.contactId) {
      const { data } = await supabase
        .from("calendar_event_links")
        .upsert(
          {
            ms_event_id: created.id,
            ical_uid: created.iCalUId ?? null,
            user_id: user.id,
            deal_id: input.dealId || null,
            company_id: input.companyId || null,
            contact_id: input.contactId || null,
          },
          { onConflict: "user_id,ms_event_id" }
        )
        .select("*")
        .single();
      linkRow = data;
    }

    if (input.dealId) {
      await supabase
        .from("deals")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", input.dealId);
    }

    await logUserActivity({
      supabase,
      actorId: user.id,
      entityType: "calendar_event",
      entityId: input.dealId ?? input.contactId ?? input.companyId ?? user.id,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      dealId: input.dealId ?? null,
      eventType: "meeting_scheduled",
      metadata: {
        subject: created.subject ?? input.subject.trim(),
        ms_event_id: created.id,
        ...(created.iCalUId ? { ical_uid: created.iCalUId } : {}),
      },
    });

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { data: { ...created, link: linkRow } as EnrichedCalendarEvent };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error creando reunión en Outlook.",
    };
  }
}

export async function updateOutlookMeetingAction(input: {
  msEventId: string;
  subject?: string;
  startIso?: string;
  endIso?: string;
}) {
  const { supabase, user } = await requireUser();
  try {
    const updated = await updateOutlookEvent(user.id, input.msEventId, {
      subject: input.subject,
      startIso: input.startIso,
      endIso: input.endIso,
    });

    const { data: link } = await supabase
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", user.id)
      .eq("ms_event_id", input.msEventId)
      .maybeSingle();

    if (link) {
      await logUserActivity({
        supabase,
        actorId: user.id,
        entityType: "calendar_event",
        entityId: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        companyId: link.company_id,
        contactId: link.contact_id,
        dealId: link.deal_id,
        eventType: "meeting_updated",
        metadata: {
          subject: updated.subject ?? input.subject ?? "Reunión",
          ms_event_id: input.msEventId,
          ...(link.ical_uid ? { ical_uid: link.ical_uid } : {}),
        },
      });
    }

    revalidatePath("/calendar");
    return { data: updated };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo actualizar la reunión.",
    };
  }
}

export async function deleteOutlookMeetingAction(msEventId: string) {
  const { supabase, user } = await requireUser();
  try {
    const { data: link } = await supabase
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", user.id)
      .eq("ms_event_id", msEventId)
      .maybeSingle();

    await deleteOutlookEvent(user.id, msEventId);

    if (link) {
      await supabase.from("calendar_event_links").delete().eq("id", link.id);
      await logUserActivity({
        supabase,
        actorId: user.id,
        entityType: "calendar_event",
        entityId: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        companyId: link.company_id,
        contactId: link.contact_id,
        dealId: link.deal_id,
        eventType: "meeting_cancelled",
        metadata: {
          ms_event_id: msEventId,
          ...(link.ical_uid ? { ical_uid: link.ical_uid } : {}),
        },
      });
    }

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo cancelar la reunión.",
    };
  }
}

export async function linkCalendarEventAction(input: {
  msEventId: string;
  icalUid?: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
}) {
  const { supabase, user } = await requireUser();

  if (!input.companyId && !input.contactId && !input.dealId) {
    await supabase
      .from("calendar_event_links")
      .delete()
      .eq("user_id", user.id)
      .eq("ms_event_id", input.msEventId);

    revalidatePath("/calendar");
    revalidatePath("/pipelines");
    return { data: null };
  }

  const { data, error } = await supabase
    .from("calendar_event_links")
    .upsert(
      {
        ms_event_id: input.msEventId,
        ical_uid: input.icalUid ?? null,
        user_id: user.id,
        company_id: input.companyId,
        contact_id: input.contactId,
        deal_id: input.dealId,
      },
      { onConflict: "user_id,ms_event_id" }
    )
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/calendar");
  revalidatePath("/pipelines");
  return { data };
}

