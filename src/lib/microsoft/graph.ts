import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/crypto";
import { extractInlineImagesForGraph } from "@/lib/email/templates";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const MICROSOFT_SCOPES = [
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Calendars.ReadWrite",
  "offline_access",
].join(" ");

export class OutlookAuthInvalidError extends Error {
  constructor(message = "Conexión con Outlook pausada. Vuelve a autenticarte.") {
    super(message);
    this.name = "OutlookAuthInvalidError";
  }
}

function getMicrosoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!clientId || !clientSecret) {
    throw new Error("Faltan MICROSOFT_CLIENT_ID o MICROSOFT_CLIENT_SECRET en .env.local.");
  }

  return {
    clientId,
    clientSecret,
    tenantId,
    redirectUri: `${appUrl}/api/outlook/callback`,
  };
}

export function isMicrosoftConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID &&
      process.env.MICROSOFT_CLIENT_SECRET &&
      process.env.OAUTH_TOKEN_ENCRYPTION_KEY
  );
}

export function getMicrosoftAuthUrl(state: string): string {
  const { clientId, tenantId, redirectUri } = getMicrosoftConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    state,
    prompt: "select_account",
  });

  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export async function exchangeMicrosoftCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}> {
  const { clientId, clientSecret, tenantId, redirectUri } = getMicrosoftConfig();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );

  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.error_description || data.error || "Error en token OAuth Microsoft");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function fetchMicrosoftProfile(accessToken: string): Promise<{
  email: string;
}> {
  const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("No se pudo obtener el perfil de Microsoft Graph");
  }

  const data = (await res.json()) as {
    mail?: string | null;
    userPrincipalName?: string | null;
  };
  const email = (data.mail || data.userPrincipalName || "").trim().toLowerCase();
  if (!email) {
    throw new Error("La cuenta de Microsoft no devolvió un email válido.");
  }

  return { email };
}

/**
 * Devuelve un access_token válido de Graph para `userId`. Si expiró, lo refresca
 * y ante 401/403/invalid_grant marca `is_auth_invalid = TRUE` para evitar bucles.
 */
export async function getValidGraphAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("oauth_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (error || !conn) {
    throw new Error("Usuario sin cuenta de Outlook conectada.");
  }

  if (conn.is_auth_invalid) {
    throw new OutlookAuthInvalidError(conn.last_auth_error ?? undefined);
  }

  const expiresMs = new Date(conn.expires_at).getTime();
  if (expiresMs - Date.now() > 5 * 60 * 1000) {
    return decryptToken(conn.access_token_encrypted);
  }

  const { clientId, clientSecret, tenantId } = getMicrosoftConfig();
  const refreshToken = decryptToken(conn.refresh_token_encrypted);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );

  const tokenData = (await res.json()) as TokenResponse;

  if (!res.ok || !tokenData.access_token) {
    const errMsg =
      tokenData.error_description || tokenData.error || `HTTP ${res.status}`;
    if (
      res.status === 401 ||
      res.status === 403 ||
      tokenData.error === "invalid_grant"
    ) {
      await admin
        .from("oauth_connections")
        .update({
          is_auth_invalid: true,
          last_auth_error: errMsg,
        })
        .eq("id", conn.id);
      throw new OutlookAuthInvalidError(errMsg);
    }
    throw new Error(`Error refrescando token Outlook: ${errMsg}`);
  }

  const nextRefresh = tokenData.refresh_token || refreshToken;
  const nextExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  await admin
    .from("oauth_connections")
    .update({
      access_token_encrypted: encryptToken(tokenData.access_token),
      refresh_token_encrypted: encryptToken(nextRefresh),
      expires_at: nextExpiresAt,
      is_auth_invalid: false,
      last_auth_error: null,
    })
    .eq("id", conn.id);

  return tokenData.access_token;
}

async function graphRequest<T>(
  userId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getValidGraphAccessToken(userId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    const admin = createAdminClient();
    await admin
      .from("oauth_connections")
      .update({
        is_auth_invalid: true,
        last_auth_error: `Microsoft Graph devolvió ${res.status}`,
      })
      .eq("user_id", userId)
      .eq("provider", "microsoft");
    throw new OutlookAuthInvalidError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft Graph error ${res.status}: ${text}`);
  }

  if (res.status === 202 || res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// MAIL
// ---------------------------------------------------------------------------

export interface SendMailAttachment {
  name: string;
  contentType: string;
  contentBytesBase64: string;
  isInline?: boolean;
  contentId?: string;
}

export async function sendOutlookMail(
  userId: string,
  input: {
    to: string[];
    subject: string;
    htmlBody: string;
    attachments?: SendMailAttachment[];
  }
) {
  const { htmlBody, inlineAttachments } = extractInlineImagesForGraph(input.htmlBody);
  const allAttachments: SendMailAttachment[] = [
    ...(input.attachments ?? []),
    ...inlineAttachments,
  ];

  const message: Record<string, unknown> = {
    subject: input.subject,
    body: {
      contentType: "HTML",
      content: htmlBody,
    },
    toRecipients: input.to.map((address) => ({
      emailAddress: { address: address.trim().toLowerCase() },
    })),
  };

  if (allAttachments.length > 0) {
    message.attachments = allAttachments.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytesBase64,
      ...(att.isInline ? { isInline: true } : {}),
      ...(att.contentId ? { contentId: att.contentId } : {}),
    }));
  }

  await graphRequest<void>(userId, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
  });
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
}

export async function fetchOutlookMessage(
  userId: string,
  msGraphId: string,
  includeFullBody = false
): Promise<GraphMessage> {
  const fields = includeFullBody
    ? "id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft"
    : "id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft";

  return graphRequest<GraphMessage>(
    userId,
    `/me/messages/${encodeURIComponent(msGraphId)}?$select=${fields}`
  );
}

// ---------------------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------------------

export interface GraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    type?: string;
    status?: { response?: string };
  }>;
  isCancelled?: boolean;
}

export async function listCalendarView(
  userId: string,
  startIso: string,
  endIso: string
): Promise<GraphEvent[]> {
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $top: "250",
    $orderby: "start/dateTime",
    $select:
      "id,iCalUId,subject,bodyPreview,start,end,location,isOnlineMeeting,onlineMeeting,webLink,organizer,attendees,isCancelled",
  });

  const data = await graphRequest<{ value?: GraphEvent[] }>(
    userId,
    `/me/calendarView?${params.toString()}`,
    {
      headers: {
        Prefer: 'outlook.timezone="Europe/Madrid"',
      },
    }
  );

  return data.value ?? [];
}

export async function fetchOutlookEvent(
  userId: string,
  eventId: string
): Promise<GraphEvent> {
  return graphRequest<GraphEvent>(
    userId,
    `/me/events/${encodeURIComponent(eventId)}?$select=id,iCalUId,subject,bodyPreview,start,end,location,isOnlineMeeting,onlineMeeting,webLink,organizer,attendees,isCancelled`,
    {
      headers: {
        Prefer: 'outlook.timezone="Europe/Madrid"',
      },
    }
  );
}

export async function createOutlookEvent(
  userId: string,
  input: {
    subject: string;
    bodyHtml?: string;
    startIso: string;
    endIso: string;
    attendeeEmails?: string[];
    isOnlineMeeting?: boolean;
  }
): Promise<GraphEvent> {
  return graphRequest<GraphEvent>(userId, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject,
      body: input.bodyHtml
        ? { contentType: "HTML", content: input.bodyHtml }
        : undefined,
      start: { dateTime: input.startIso, timeZone: "Europe/Madrid" },
      end: { dateTime: input.endIso, timeZone: "Europe/Madrid" },
      attendees: (input.attendeeEmails ?? [])
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({
          emailAddress: { address: email },
          type: "required",
        })),
      isOnlineMeeting: input.isOnlineMeeting ?? true,
      onlineMeetingProvider:
        input.isOnlineMeeting === false ? undefined : "teamsForBusiness",
    }),
  });
}

export async function updateOutlookEvent(
  userId: string,
  eventId: string,
  patch: {
    subject?: string;
    startIso?: string;
    endIso?: string;
  }
): Promise<GraphEvent> {
  const payload: Record<string, unknown> = {};
  if (patch.subject !== undefined) payload.subject = patch.subject;
  if (patch.startIso) {
    payload.start = { dateTime: patch.startIso, timeZone: "Europe/Madrid" };
  }
  if (patch.endIso) {
    payload.end = { dateTime: patch.endIso, timeZone: "Europe/Madrid" };
  }

  return graphRequest<GraphEvent>(
    userId,
    `/me/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteOutlookEvent(userId: string, eventId: string): Promise<void> {
  await graphRequest<void>(userId, `/me/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// WEBHOOK SUBSCRIPTIONS (MAIL & CALENDAR)
// ---------------------------------------------------------------------------

interface GraphSubscription {
  id: string;
  expirationDateTime: string;
}

function getNextGraphExpirationIso(): string {
  // Máximo seguro en Graph para Mail/Calendar: ~4230 minutos (~2.93 días). Usamos 4200 min.
  return new Date(Date.now() + 4200 * 60 * 1000).toISOString();
}

async function upsertSingleSubscription(input: {
  userId: string;
  existingId: string | null;
  resource: "me/messages" | "me/events";
  changeType: string;
  notificationUrl: string;
  clientState: string;
}): Promise<GraphSubscription> {
  const expirationDateTime = getNextGraphExpirationIso();

  if (input.existingId) {
    try {
      return await graphRequest<GraphSubscription>(
        input.userId,
        `/subscriptions/${encodeURIComponent(input.existingId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expirationDateTime }),
        }
      );
    } catch {
      // Si expiró o ya no existe en Graph, creamos una nueva suscripción.
    }
  }

  return graphRequest<GraphSubscription>(input.userId, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: input.changeType,
      notificationUrl: input.notificationUrl,
      resource: input.resource,
      expirationDateTime,
      clientState: input.clientState,
    }),
  });
}

/**
 * Crea o renueva las suscripciones Webhook de Mail (`me/messages`: Inbox + SentItems)
 * y Calendario (`me/events`) en Microsoft Graph para `userId`.
 */
export async function ensureUserSubscriptions(userId: string): Promise<{
  skipped?: string;
}> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const clientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE;

  if (!appUrl.startsWith("https://") || !clientState) {
    return {
      skipped:
        "Las suscripciones Graph requieren NEXT_PUBLIC_APP_URL con HTTPS público y GRAPH_WEBHOOK_CLIENT_STATE.",
    };
  }

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("oauth_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn || conn.is_auth_invalid) {
    return { skipped: "Conexión inexistente o inválida." };
  }

  const notificationUrl = `${appUrl}/api/webhooks/microsoft-graph`;

  const [mailSub, calSub] = await Promise.all([
    upsertSingleSubscription({
      userId,
      existingId: conn.graph_subscription_id,
      resource: "me/messages",
      changeType: "created",
      notificationUrl,
      clientState,
    }),
    upsertSingleSubscription({
      userId,
      existingId: conn.calendar_subscription_id,
      resource: "me/events",
      changeType: "created,updated,deleted",
      notificationUrl,
      clientState,
    }),
  ]);

  await admin
    .from("oauth_connections")
    .update({
      graph_subscription_id: mailSub.id,
      subscription_expires_at: mailSub.expirationDateTime,
      calendar_subscription_id: calSub.id,
      calendar_subscription_expires_at: calSub.expirationDateTime,
    })
    .eq("id", conn.id);

  return {};
}

/**
 * Renovación oportunista cuando el usuario abre el CRM si alguna suscripción vence en <48h.
 */
export async function opportunisticRenewSubscriptionsIfNeeded(userId: string) {
  if (!isMicrosoftConfigured()) return;
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("oauth_connections")
    .select(
      "is_auth_invalid, subscription_expires_at, calendar_subscription_expires_at"
    )
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn || conn.is_auth_invalid) return;

  const threshold = Date.now() + 48 * 60 * 60 * 1000;
  const mailExp = conn.subscription_expires_at
    ? new Date(conn.subscription_expires_at).getTime()
    : 0;
  const calExp = conn.calendar_subscription_expires_at
    ? new Date(conn.calendar_subscription_expires_at).getTime()
    : 0;

  if (mailExp < threshold || calExp < threshold) {
    await ensureUserSubscriptions(userId).catch((err) => {
      console.error("[opportunisticRenew] Error:", err);
    });
  }
}

