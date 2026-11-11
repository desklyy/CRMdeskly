import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/crm/activities";
import type { ActivityEntityType, Json } from "@/types/database";

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function requireConnectedOutlook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data: conn } = await supabase
    .from("oauth_connections")
    .select("microsoft_email, is_auth_invalid")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!conn) {
    return {
      error: "Conecta tu cuenta de Outlook en Settings > Integraciones primero.",
    } as const;
  }
  if (conn.is_auth_invalid) {
    return {
      error: "Conexión con Outlook pausada. Vuelve a autenticarte.",
    } as const;
  }

  return { microsoftEmail: conn.microsoft_email } as const;
}

export async function recordOutboundEmailAndActivity(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  microsoftEmail: string;
  toEmail: string;
  subject: string;
  preview: string;
  hasAttachments: boolean;
  contactId: string;
  companyId: string | null;
  dealId: string | null;
  quoteId?: string | null;
  syncedBaseAmount?: number | null;
  activityEntityType: ActivityEntityType;
  activityEntityId: string;
  eventType: string;
  extraMetadata?: Record<string, Json>;
}) {
  const now = new Date().toISOString();
  const syntheticGraphId = `crm-sent-${crypto.randomUUID()}`;

  const { data: emailRow } = await input.supabase
    .from("emails")
    .insert({
      ms_graph_id: syntheticGraphId,
      user_id: input.userId,
      contact_id: input.contactId,
      deal_id: input.dealId,
      quote_id: input.quoteId ?? null,
      from_email: input.microsoftEmail,
      to_emails: [input.toEmail] as Json,
      subject: input.subject,
      body_preview: input.preview.slice(0, 500),
      direction: "outbound",
      has_attachments: input.hasAttachments,
      sent_at: now,
    })
    .select("*")
    .single();

  if (input.dealId) {
    await input.supabase
      .from("deals")
      .update({
        last_activity_at: now,
        ...(input.syncedBaseAmount !== undefined && input.syncedBaseAmount !== null
          ? { amount: input.syncedBaseAmount }
          : {}),
      })
      .eq("id", input.dealId);
  }

  await logUserActivity({
    supabase: input.supabase,
    actorId: input.userId,
    entityType: input.activityEntityType,
    entityId: input.activityEntityId,
    companyId: input.companyId,
    contactId: input.contactId,
    dealId: input.dealId,
    eventType: input.eventType,
    metadata: {
      to_email: input.toEmail,
      subject: input.subject,
      ...(input.extraMetadata ?? {}),
    },
  });

  return emailRow;
}

