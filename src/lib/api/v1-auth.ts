import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityEntityType, ApiKeyPermission, Json } from "@/types/database";

export interface AuthenticatedAgent {
  apiKeyId: string;
  name: string;
  permissions: ApiKeyPermission;
}

/**
 * Autentica peticiones `/api/v1/*` mediante `Authorization: Bearer dsk_live_...`,
 * verifica permisos (`read` vs `read_write`) y actualiza `last_used_at`.
 */
export async function authenticateApiV1(
  request: NextRequest,
  requireWrite = false
): Promise<{ agent: AuthenticatedAgent } | { errorResponse: NextResponse }> {
  const authHeader = request.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const rawKey = match?.[1]?.trim();

  if (!rawKey) {
    return {
      errorResponse: NextResponse.json(
        { error: "Missing Authorization: Bearer <api_key> header" },
        { status: 401 }
      ),
    };
  }

  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const admin = createAdminClient();

  const { data: keyRow, error } = await admin
    .from("api_keys")
    .select("id, name, permissions, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !keyRow) {
    return {
      errorResponse: NextResponse.json(
        { error: "Invalid or revoked API key" },
        { status: 401 }
      ),
    };
  }

  if (requireWrite && keyRow.permissions !== "read_write") {
    return {
      errorResponse: NextResponse.json(
        { error: "API key with 'read' permission cannot perform write operations" },
        { status: 403 }
      ),
    };
  }

  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id);

  return {
    agent: {
      apiKeyId: keyRow.id,
      name: keyRow.name,
      permissions: keyRow.permissions,
    },
  };
}

/**
 * Paginación estricta para proteger la ventana de contexto de los Agentes IA.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  defaultLimit = 25,
  maxLimit = 50
) {
  const rawLimit = Number(searchParams.get("limit") || defaultLimit);
  const rawOffset = Number(searchParams.get("offset") || 0);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)))
    : defaultLimit;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.floor(rawOffset))
    : 0;

  return { limit, offset };
}

export function paginatedResponse<T>(
  data: T[],
  total: number | null,
  limit: number,
  offset: number
) {
  const safeTotal = total ?? data.length;
  return NextResponse.json({
    data,
    pagination: {
      total: safeTotal,
      limit,
      offset,
      has_more: offset + data.length < safeTotal,
    },
  });
}

export async function logAgentActivity(input: {
  apiKeyId: string;
  entityType: ActivityEntityType;
  entityId: string;
  eventType: string;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  metadata?: Record<string, Json>;
}) {
  const admin = createAdminClient();
  await admin.from("activities").insert({
    actor_type: "ai_agent",
    actor_id: input.apiKeyId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    company_id: input.companyId ?? null,
    contact_id: input.contactId ?? null,
    deal_id: input.dealId ?? null,
    event_type: input.eventType,
    metadata: input.metadata ?? {},
  });
}

