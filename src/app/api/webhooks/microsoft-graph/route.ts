import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchOutlookEvent,
  fetchOutlookMessage,
} from "@/lib/microsoft/graph";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: "created" | "updated" | "deleted";
  resource?: string;
  resourceData?: {
    id?: string;
  };
}

async function processMailNotification(
  userId: string,
  microsoftEmail: string,
  msGraphId: string
) {
  const admin = createAdminClient();
  const msg = await fetchOutlookMessage(userId, msGraphId, false);
  if (msg.isDraft) return;

  const fromEmail = msg.from?.emailAddress?.address?.trim().toLowerCase() ?? "";
  const toEmails = (msg.toRecipients ?? [])
    .map((r) => r.emailAddress?.address?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  const isOutbound = fromEmail === microsoftEmail.toLowerCase();
  const candidateEmails = isOutbound ? toEmails : [fromEmail];

  if (candidateEmails.length === 0) return;

  const { data: contact } = await admin
    .from("contacts")
    .select("id, company_id")
    .in("email", candidateEmails)
    .limit(1)
    .maybeSingle();

  if (!contact) return;

  const internetMessageId = msg.internetMessageId || null;
  if (internetMessageId) {
    const { data: existing } = await admin
      .from("emails")
      .select("id")
      .eq("internet_message_id", internetMessageId)
      .maybeSingle();

    if (existing) return;
  }

  let dealId: string | null = null;
  const { data: contactDeal } = await admin
    .from("deals")
    .select("id")
    .eq("primary_contact_id", contact.id)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contactDeal) {
    dealId = contactDeal.id;
  } else if (contact.company_id) {
    const { data: companyDeal } = await admin
      .from("deals")
      .select("id")
      .eq("company_id", contact.company_id)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dealId = companyDeal?.id ?? null;
  }

  const sentAt = msg.sentDateTime || msg.receivedDateTime || new Date().toISOString();
  const direction = isOutbound ? "outbound" : "inbound";

  const { data: insertedEmail, error: insertErr } = await admin
    .from("emails")
    .upsert(
      {
        ms_graph_id: msg.id,
        internet_message_id: internetMessageId,
        ms_conversation_id: msg.conversationId ?? null,
        user_id: userId,
        contact_id: contact.id,
        deal_id: dealId,
        from_email: fromEmail,
        to_emails: toEmails as Json,
        subject: msg.subject ?? null,
        body_preview: msg.bodyPreview?.slice(0, 500) ?? null,
        direction,
        has_attachments: Boolean(msg.hasAttachments),
        sent_at: sentAt,
      },
      { onConflict: "user_id,ms_graph_id" }
    )
    .select("id")
    .single();

  if (insertErr || !insertedEmail) return;

  if (dealId) {
    await admin
      .from("deals")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", dealId);
  }

  await admin.from("activities").insert({
    actor_type: "webhook",
    actor_id: userId,
    entity_type: dealId ? "deal" : "contact",
    entity_id: dealId ?? contact.id,
    company_id: contact.company_id,
    contact_id: contact.id,
    deal_id: dealId,
    event_type: isOutbound ? "email_sent" : "email_received",
    metadata: {
      subject: msg.subject ?? "(Sin asunto)",
      from_email: fromEmail,
      email_id: insertedEmail.id,
    },
  });
}

async function shouldLogCalendarActivity(
  icalUid: string | null | undefined,
  eventType: string
): Promise<boolean> {
  if (!icalUid) return true;
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data } = await admin
    .from("activities")
    .select("id")
    .eq("event_type", eventType)
    .gte("created_at", cutoff)
    .contains("metadata", { ical_uid: icalUid })
    .limit(1);

  return (data ?? []).length === 0;
}

async function processCalendarNotification(
  userId: string,
  msEventId: string,
  changeType: "created" | "updated" | "deleted"
) {
  const admin = createAdminClient();

  if (changeType === "deleted") {
    const { data: link } = await admin
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", userId)
      .eq("ms_event_id", msEventId)
      .maybeSingle();

    if (!link) return;

    await admin.from("calendar_event_links").delete().eq("id", link.id);

    if (await shouldLogCalendarActivity(link.ical_uid, "meeting_cancelled")) {
      await admin.from("activities").insert({
        actor_type: "webhook",
        actor_id: userId,
        entity_type: "calendar_event",
        entity_id: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        company_id: link.company_id,
        contact_id: link.contact_id,
        deal_id: link.deal_id,
        event_type: "meeting_cancelled",
        metadata: {
          ms_event_id: msEventId,
          ...(link.ical_uid ? { ical_uid: link.ical_uid } : {}),
        },
      });
    }
    return;
  }

  const event = await fetchOutlookEvent(userId, msEventId);
  if (event.isCancelled) return;

  const { data: existingLink } = await admin
    .from("calendar_event_links")
    .select("*")
    .eq("user_id", userId)
    .eq("ms_event_id", msEventId)
    .maybeSingle();

  let companyId = existingLink?.company_id ?? null;
  let contactId = existingLink?.contact_id ?? null;
  let dealId = existingLink?.deal_id ?? null;

  if (!existingLink) {
    const attendeeEmails = (event.attendees ?? [])
      .map((a) => a.emailAddress?.address?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e));

    if (attendeeEmails.length === 0) return;

    const { data: matchedContact } = await admin
      .from("contacts")
      .select("id, company_id")
      .in("email", attendeeEmails)
      .limit(1)
      .maybeSingle();

    if (!matchedContact) return;

    contactId = matchedContact.id;
    companyId = matchedContact.company_id;

    const { data: openDeal } = await admin
      .from("deals")
      .select("id")
      .eq("primary_contact_id", contactId)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    dealId = openDeal?.id ?? null;

    await admin.from("calendar_event_links").upsert(
      {
        ms_event_id: event.id,
        ical_uid: event.iCalUId ?? null,
        user_id: userId,
        company_id: companyId,
        contact_id: contactId,
        deal_id: dealId,
      },
      { onConflict: "user_id,ms_event_id" }
    );
  }

  if (dealId) {
    await admin
      .from("deals")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", dealId);
  }

  const eventType =
    changeType === "created" ? "meeting_scheduled" : "meeting_updated";

  if (await shouldLogCalendarActivity(event.iCalUId, eventType)) {
    await admin.from("activities").insert({
      actor_type: "webhook",
      actor_id: userId,
      entity_type: "calendar_event",
      entity_id: dealId ?? contactId ?? companyId ?? userId,
      company_id: companyId,
      contact_id: contactId,
      deal_id: dealId,
      event_type: eventType,
      metadata: {
        subject: event.subject ?? "Reunión",
        start: event.start?.dateTime ?? null,
        ms_event_id: event.id,
        ...(event.iCalUId ? { ical_uid: event.iCalUId } : {}),
      },
    });
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const expectedClientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE;
  if (!expectedClientState) {
    return NextResponse.json(
      { error: "GRAPH_WEBHOOK_CLIENT_STATE is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    value?: GraphNotification[];
  } | null;

  const notifications = body?.value ?? [];
  const admin = createAdminClient();

  for (const notif of notifications) {
    if (!notif.clientState || !timingSafeEqualStr(notif.clientState, expectedClientState)) {
      continue;
    }

    const resourceId = notif.resourceData?.id;
    const subId = notif.subscriptionId;
    if (!resourceId || !subId) continue;

    const { data: mailConn } = await admin
      .from("oauth_connections")
      .select("user_id, microsoft_email")
      .eq("graph_subscription_id", subId)
      .maybeSingle();

    if (mailConn) {
      await processMailNotification(
        mailConn.user_id,
        mailConn.microsoft_email,
        resourceId
      ).catch((err) => console.error("[GraphWebhook Mail]", err));
      continue;
    }

    const { data: calConn } = await admin
      .from("oauth_connections")
      .select("user_id")
      .eq("calendar_subscription_id", subId)
      .maybeSingle();

    if (calConn) {
      await processCalendarNotification(
        calConn.user_id,
        resourceId,
        notif.changeType ?? "updated"
      ).catch((err) => console.error("[GraphWebhook Calendar]", err));
    }
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}

