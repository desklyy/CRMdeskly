import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiV1, logAgentActivity } from "@/lib/api/v1-auth";
import {
  createOutlookEvent,
  deleteOutlookEvent,
  listCalendarView,
  OutlookAuthInvalidError,
  updateOutlookEvent,
} from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";

async function resolveTargetUserId(
  explicitUserId?: string | null,
  dealId?: string | null
): Promise<string | null> {
  if (explicitUserId) return explicitUserId;
  if (!dealId) return null;

  const admin = createAdminClient();
  const { data: deal } = await admin
    .from("deals")
    .select("owner_id")
    .eq("id", dealId)
    .maybeSingle();

  return deal?.owner_id ?? null;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const userId = await resolveTargetUserId(sp.get("user_id"), sp.get("deal_id"));
  const startIso = sp.get("start");
  const endIso = sp.get("end");

  if (!userId || !startIso || !endIso) {
    return NextResponse.json(
      { error: "user_id (or deal_id with owner), start, and end ISO params are required" },
      { status: 400 }
    );
  }

  try {
    const events = await listCalendarView(userId, startIso, endIso);
    return NextResponse.json({ data: events });
  } catch (err) {
    const status = err instanceof OutlookAuthInvalidError ? 401 : 400;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Calendar fetch failed" },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as {
    user_id?: string;
    deal_id?: string | null;
    company_id?: string | null;
    contact_id?: string | null;
    subject?: string;
    start_iso?: string;
    end_iso?: string;
    attendee_emails?: string[];
    is_online_meeting?: boolean;
  } | null;

  if (!body?.subject || !body.start_iso || !body.end_iso) {
    return NextResponse.json(
      { error: "subject, start_iso and end_iso are required" },
      { status: 400 }
    );
  }

  const userId = await resolveTargetUserId(body.user_id, body.deal_id);
  if (!userId) {
    return NextResponse.json(
      { error: "user_id (or deal_id with owner_id) is required" },
      { status: 400 }
    );
  }

  try {
    const created = await createOutlookEvent(userId, {
      subject: body.subject,
      startIso: body.start_iso,
      endIso: body.end_iso,
      attendeeEmails: body.attendee_emails ?? [],
      isOnlineMeeting: body.is_online_meeting ?? true,
    });

    const admin = createAdminClient();
    if (body.deal_id || body.company_id || body.contact_id) {
      await admin.from("calendar_event_links").upsert(
        {
          ms_event_id: created.id,
          ical_uid: created.iCalUId ?? null,
          user_id: userId,
          deal_id: body.deal_id ?? null,
          company_id: body.company_id ?? null,
          contact_id: body.contact_id ?? null,
        },
        { onConflict: "user_id,ms_event_id" }
      );
    }

    if (body.deal_id) {
      await admin
        .from("deals")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", body.deal_id);
    }

    await logAgentActivity({
      apiKeyId: auth.agent.apiKeyId,
      entityType: "calendar_event",
      entityId: body.deal_id ?? body.contact_id ?? body.company_id ?? userId,
      companyId: body.company_id ?? null,
      contactId: body.contact_id ?? null,
      dealId: body.deal_id ?? null,
      eventType: "meeting_scheduled",
      metadata: {
        subject: created.subject ?? body.subject,
        ms_event_id: created.id,
        ...(created.iCalUId ? { ical_uid: created.iCalUId } : {}),
        agent: auth.agent.name,
      },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    const status = err instanceof OutlookAuthInvalidError ? 401 : 400;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create meeting" },
      { status }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const body = (await request.json().catch(() => null)) as {
    user_id?: string;
    ms_event_id?: string;
    subject?: string;
    start_iso?: string;
    end_iso?: string;
  } | null;

  if (!body?.user_id || !body.ms_event_id) {
    return NextResponse.json(
      { error: "user_id and ms_event_id are required" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateOutlookEvent(body.user_id, body.ms_event_id, {
      subject: body.subject,
      startIso: body.start_iso,
      endIso: body.end_iso,
    });
    return NextResponse.json({ data: updated });
  } catch (err) {
    const status = err instanceof OutlookAuthInvalidError ? 401 : 400;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update meeting" },
      { status }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateApiV1(request, true);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const userId = sp.get("user_id");
  const msEventId = sp.get("ms_event_id");

  if (!userId || !msEventId) {
    return NextResponse.json(
      { error: "user_id and ms_event_id query params are required" },
      { status: 400 }
    );
  }

  try {
    await deleteOutlookEvent(userId, msEventId);

    const admin = createAdminClient();
    const { data: link } = await admin
      .from("calendar_event_links")
      .select("*")
      .eq("user_id", userId)
      .eq("ms_event_id", msEventId)
      .maybeSingle();

    if (link) {
      await admin.from("calendar_event_links").delete().eq("id", link.id);
      await logAgentActivity({
        apiKeyId: auth.agent.apiKeyId,
        entityType: "calendar_event",
        entityId: link.deal_id ?? link.contact_id ?? link.company_id ?? link.id,
        companyId: link.company_id,
        contactId: link.contact_id,
        dealId: link.deal_id,
        eventType: "meeting_cancelled",
        metadata: { ms_event_id: msEventId, agent: auth.agent.name },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof OutlookAuthInvalidError ? 401 : 400;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not cancel meeting" },
      { status }
    );
  }
}

