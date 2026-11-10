"use server";

import crypto from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFullName, computeAvatarInitials } from "@/lib/crm/profiles";
import type { Database, Json, UserRole } from "@/types/database";

type PipelineUpdate = Database["public"]["Tables"]["pipelines"]["Update"];
type StageUpdate = Database["public"]["Tables"]["pipeline_stages"]["Update"];
type CustomFieldUpdate =
  Database["public"]["Tables"]["custom_field_definitions"]["Update"];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Sesión no iniciada");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active || profile.role !== "admin") {
    throw new Error("Acción restringida a administradores");
  }

  return { supabase, user, profile };
}

function revalidateSchemaAndCrm() {
  revalidateTag("crm-schema");
  revalidatePath("/settings");
  revalidatePath("/pipelines");
  revalidatePath("/companies");
  revalidatePath("/contacts");
}

// ---------------------------------------------------------------------------
// EQUIPO (INVITE-ONLY)
// ---------------------------------------------------------------------------

export async function inviteTeamMemberAction(input: {
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
}) {
  await requireAdmin();
  const email = input.email.trim().toLowerCase();
  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();

  if (!email || !firstName || !lastName) {
    return { error: "El email, el nombre y el apellido son obligatorios." };
  }

  const fullName = buildFullName(firstName, lastName);
  const initials = computeAvatarInitials(firstName, lastName);

  const adminClient = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      role: input.role,
    },
    redirectTo: `${appUrl}/auth/callback?type=invite`,
  });

  if (error || !data.user) {
    return { error: error?.message ?? "No se pudo enviar la invitación." };
  }

  const { data: profileRow } = await adminClient
    .from("profiles")
    .upsert({
      id: data.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      avatar_initials: initials,
      role: input.role,
      is_active: true,
    })
    .select("*")
    .single();

  revalidatePath("/settings");
  return { data: profileRow };
}

export async function updateTeamMemberNameAction(
  profileId: string,
  input: { first_name: string; last_name: string }
) {
  const { supabase } = await requireAdmin();
  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();
  if (!firstName || !lastName) {
    return { error: "Nombre y apellido son obligatorios." };
  }

  const fullName = buildFullName(firstName, lastName);
  const avatarInitials = computeAvatarInitials(firstName, lastName);

  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      avatar_initials: avatarInitials,
    })
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { data };
}

export async function updateTeamMemberAction(
  profileId: string,
  patch: { role?: UserRole; is_active?: boolean }
) {
  const { supabase, user } = await requireAdmin();

  if (profileId === user.id && (patch.is_active === false || patch.role === "sales")) {
    return { error: "No puedes desactivarte ni quitarte el rol de administrador a ti mismo." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { data };
}

// ---------------------------------------------------------------------------
// CONSTRUCTOR DE PIPELINES Y ETAPAS
// ---------------------------------------------------------------------------

export async function createPipelineAction(input: {
  name: string;
  stale_days_default: number;
  is_default: boolean;
}) {
  const { supabase } = await requireAdmin();
  const name = input.name.trim();
  if (!name) return { error: "El nombre del pipeline es obligatorio." };

  if (input.is_default) {
    await supabase.from("pipelines").update({ is_default: false }).eq("is_default", true);
  }

  const { data: pipeline, error } = await supabase
    .from("pipelines")
    .insert({
      name,
      stale_days_default: Math.max(1, Number(input.stale_days_default) || 7),
      is_default: input.is_default,
      is_active: true,
    })
    .select("*")
    .single();

  if (error || !pipeline) return { error: error?.message ?? "No se pudo crear el pipeline." };

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .insert([
      {
        pipeline_id: pipeline.id,
        name: "Nuevo Lead",
        stage_order: 1,
        color_code: "#64748b",
        probability: 10,
      },
      {
        pipeline_id: pipeline.id,
        name: "Propuesta",
        stage_order: 2,
        color_code: "#8b5cf6",
        probability: 50,
      },
      {
        pipeline_id: pipeline.id,
        name: "Ganado",
        stage_order: 3,
        color_code: "#10b981",
        probability: 100,
        is_won_stage: true,
      },
      {
        pipeline_id: pipeline.id,
        name: "Perdido",
        stage_order: 4,
        color_code: "#ef4444",
        probability: 0,
        is_lost_stage: true,
      },
    ])
    .select("*")
    .order("stage_order", { ascending: true });

  revalidateSchemaAndCrm();
  return { data: { pipeline, stages: stages ?? [] } };
}

export async function updatePipelineAction(pipelineId: string, patch: PipelineUpdate) {
  const { supabase } = await requireAdmin();
  const sanitized: PipelineUpdate = { ...patch };

  if (sanitized.name !== undefined) {
    const trimmed = sanitized.name.trim();
    if (!trimmed) return { error: "El nombre del pipeline es obligatorio." };
    sanitized.name = trimmed;
  }

  if (sanitized.stale_days_default !== undefined) {
    sanitized.stale_days_default = Math.max(
      1,
      Math.floor(Number(sanitized.stale_days_default) || 7)
    );
  }

  if (sanitized.is_default) {
    await supabase.from("pipelines").update({ is_default: false }).neq("id", pipelineId);
  }

  const { data, error } = await supabase
    .from("pipelines")
    .update(sanitized)
    .eq("id", pipelineId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { data };
}

export async function createStageAction(input: {
  pipeline_id: string;
  name: string;
  color_code: string;
  probability: number;
  stale_days_override: number | null;
  is_won_stage: boolean;
  is_lost_stage: boolean;
}) {
  const { supabase } = await requireAdmin();
  const name = input.name.trim();
  if (!name) return { error: "El nombre de la etapa es obligatorio." };

  const { data: maxOrderRow } = await supabase
    .from("pipeline_stages")
    .select("stage_order")
    .eq("pipeline_id", input.pipeline_id)
    .order("stage_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxOrderRow?.stage_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("pipeline_stages")
    .insert({
      pipeline_id: input.pipeline_id,
      name,
      stage_order: nextOrder,
      color_code: input.color_code || "#64748b",
      probability: Math.min(100, Math.max(0, Number(input.probability) || 0)),
      stale_days_override: input.stale_days_override,
      is_won_stage: input.is_won_stage,
      is_lost_stage: input.is_lost_stage,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { data };
}

export async function updateStageAction(stageId: string, patch: StageUpdate) {
  const { supabase } = await requireAdmin();
  const sanitized: StageUpdate = { ...patch };

  if (sanitized.name !== undefined) {
    const trimmed = sanitized.name.trim();
    if (!trimmed) return { error: "El nombre de la etapa es obligatorio." };
    sanitized.name = trimmed;
  }

  if (sanitized.probability !== undefined) {
    sanitized.probability = Math.min(100, Math.max(0, Number(sanitized.probability) || 0));
  }

  if (sanitized.stale_days_override !== undefined && sanitized.stale_days_override !== null) {
    sanitized.stale_days_override = Math.max(
      1,
      Math.floor(Number(sanitized.stale_days_override) || 1)
    );
  }

  if (sanitized.is_won_stage) {
    sanitized.is_lost_stage = false;
  } else if (sanitized.is_lost_stage) {
    sanitized.is_won_stage = false;
  }

  const { data, error } = await supabase
    .from("pipeline_stages")
    .update(sanitized)
    .eq("id", stageId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { data };
}

export async function reorderStagesAction(pipelineId: string, orderedStageIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedStageIds.map((stageId, index) =>
      supabase
        .from("pipeline_stages")
        .update({ stage_order: index + 1 })
        .eq("id", stageId)
        .eq("pipeline_id", pipelineId)
    )
  );

  revalidateSchemaAndCrm();
  return { ok: true };
}

export async function archiveStageWithMigrationAction(input: {
  stageId: string;
  migrateToStageId?: string;
}) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", input.stageId);

  const dealCount = count ?? 0;

  if (dealCount > 0 && !input.migrateToStageId) {
    return { requiresMigration: true as const, dealCount };
  }

  if (dealCount > 0 && input.migrateToStageId) {
    const { data: targetStage } = await supabase
      .from("pipeline_stages")
      .select("id, pipeline_id, is_won_stage, is_lost_stage")
      .eq("id", input.migrateToStageId)
      .single();

    if (!targetStage) {
      return { error: "La etapa destino no existe." };
    }

    const nextStatus = targetStage.is_won_stage
      ? "won"
      : targetStage.is_lost_stage
        ? "lost"
        : "open";

    const { error: moveError } = await supabase
      .from("deals")
      .update({
        pipeline_id: targetStage.pipeline_id,
        stage_id: targetStage.id,
        status: nextStatus,
        stage_changed_at: new Date().toISOString(),
      })
      .eq("stage_id", input.stageId);

    if (moveError) return { error: moveError.message };
  }

  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({ is_active: false })
    .eq("id", input.stageId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { data };
}

// ---------------------------------------------------------------------------
// GESTOR CENTRAL DE VARIABLES / PROPIEDADES
// ---------------------------------------------------------------------------

export async function updateCustomFieldDefinitionAction(
  fieldId: string,
  patch: CustomFieldUpdate & { options?: Json }
) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .update(patch)
    .eq("id", fieldId)
    .select("*")
    .single();

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { data };
}

export async function deleteCustomFieldDefinitionAction(fieldId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("custom_field_definitions")
    .delete()
    .eq("id", fieldId);

  if (error) return { error: error.message };
  revalidateSchemaAndCrm();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API KEYS PARA AGENTES IA
// ---------------------------------------------------------------------------

export async function createApiKeyAction(input: {
  name: string;
  permissions: "read" | "read_write";
}) {
  const { supabase, user } = await requireAdmin();
  const name = input.name.trim();
  if (!name) return { error: "El nombre de la clave API es obligatorio." };

  const rawSecret = `dsk_live_${crypto.randomBytes(24).toString("hex")}`;
  const keyPrefix = rawSecret.slice(0, 16);
  const keyHash = crypto.createHash("sha256").update(rawSecret).digest("hex");

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      permissions: input.permissions,
      created_by: user.id,
      is_active: true,
    })
    .select("id, name, key_prefix, permissions, last_used_at, is_active, revoked_at, created_at")
    .single();

  if (error || !data) return { error: error?.message ?? "No se pudo crear la API Key." };

  revalidatePath("/settings");
  return { data, plainTextKey: rawSecret };
}

export async function revokeApiKeyAction(keyId: string) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq("id", keyId)
    .select("id, name, key_prefix, permissions, last_used_at, is_active, revoked_at, created_at")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { data };
}

