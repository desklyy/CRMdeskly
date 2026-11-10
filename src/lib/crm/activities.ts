import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEntityType, Database, Json } from "@/types/database";

interface LogActivityParams {
  supabase: SupabaseClient<Database>;
  actorId: string;
  entityType: ActivityEntityType;
  entityId: string;
  eventType: string;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  metadata?: Record<string, Json>;
}

/**
 * Registra un evento estructurado en la tabla `activities` para auditoría y Timeline.
 */
export async function logUserActivity({
  supabase,
  actorId,
  entityType,
  entityId,
  eventType,
  companyId = null,
  contactId = null,
  dealId = null,
  metadata = {},
}: LogActivityParams) {
  const { error } = await supabase.from("activities").insert({
    actor_type: "user",
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    company_id: companyId,
    contact_id: contactId,
    deal_id: dealId,
    event_type: eventType,
    metadata,
  });

  if (error) {
    console.error("[logUserActivity] Error inserting activity:", error.message);
  }
}

