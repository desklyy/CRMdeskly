import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export type SessionGuardSuccess = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: NonNullable<
    Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["getUser"]>>["data"]["user"]
  >;
  profile: {
    id: string;
    role: UserRole;
    is_active: boolean;
  };
};

export type SessionGuardFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
};

/**
 * Verifica sesión autenticada, cumplimiento de 2FA (AAL2 si tiene factor verificado),
 * perfil activo (`is_active = TRUE`) y opcionalmente rol administrador.
 */
export async function verifyActiveSession(options?: {
  requireAdmin?: boolean;
}): Promise<SessionGuardSuccess | SessionGuardFailure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: "Sesión no iniciada" };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return {
      ok: false,
      status: 403,
      error: "Verificación en dos pasos (2FA) requerida.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return {
      ok: false,
      status: 403,
      error: "Usuario desactivado o sin perfil activo.",
    };
  }

  if (options?.requireAdmin && profile.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Acción restringida a administradores",
    };
  }

  return {
    ok: true,
    supabase,
    user,
    profile: {
      id: profile.id,
      role: profile.role as UserRole,
      is_active: profile.is_active,
    },
  };
}

/**
 * Variante para Server Actions que lanza excepción si la sesión no es válida,
 * está pendiente de 2FA o el usuario está desactivado.
 */
export async function requireActiveUser(options?: { requireAdmin?: boolean }) {
  const res = await verifyActiveSession(options);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res;
}

