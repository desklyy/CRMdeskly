"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesklyLogo } from "@/components/brand/deskly-logo";

function getSafeNextPath(nextPath: string): string {
  return nextPath.startsWith("/") &&
    !nextPath.startsWith("//") &&
    !nextPath.startsWith("/\\")
    ? nextPath
    : "/";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const setupError = searchParams.get("setup") === "missing_env";
  const authError = searchParams.get("error");
  const mfaRequiredParam = searchParams.get("mfa") === "required";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // MFA Step 2 state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verifyingMfa, setVerifyingMfa] = useState(false);

  const [error, setError] = useState<string | null>(
    authError === "inactive"
      ? "Tu usuario está desactivado. Contacta con un administrador."
      : authError === "callback"
        ? "El enlace de invitación ha caducado o no es válido."
        : null
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    const supabase = createClient();

    void (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!active || !userRes.user) return;

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active || !aal) return;

      if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verifiedTotp = (factors?.totp ?? []).find((f) => f.status === "verified");
        if (active && verifiedTotp) {
          setMfaFactorId(verifiedTotp.id);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [mfaRequiredParam]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isSupabaseConfigured()) {
      setError("Configura las variables de Supabase en .env.local antes de iniciar sesión.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError("Credenciales inválidas o usuario no invitado.");
        return;
      }

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verifiedTotp = (factors?.totp ?? []).find((f) => f.status === "verified");
        if (verifiedTotp) {
          setMfaFactorId(verifiedTotp.id);
          setMfaCode("");
          return;
        }
      }

      router.push(getSafeNextPath(nextPath));
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servicio de autenticación.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    const cleanCode = mfaCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      setError("Introduce los 6 dígitos de tu app Authenticator.");
      return;
    }

    setError(null);
    setVerifyingMfa(true);
    try {
      const supabase = createClient();
      const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfaFactorId,
        code: cleanCode,
      });

      if (verifyErr) {
        setError("Código incorrecto o caducado. Inténtalo de nuevo.");
        return;
      }

      router.push(getSafeNextPath(nextPath));
      router.refresh();
    } catch {
      setError("No se pudo verificar el código.");
    } finally {
      setVerifyingMfa(false);
    }
  }

  async function handleSwitchAccount() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaCode("");
    setError(null);
    router.refresh();
  }

  return (
    <div className="w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
      <div className="mb-7 flex items-center gap-3.5">
        <DesklyLogo size="lg" className="border border-[#E2E8F0]" />
        <div>
          <h1 className="text-lg font-bold tracking-[-0.02em] text-[#0F172A]">
            Deskly CRM
          </h1>
          <p className="text-xs text-[#64748B]">
            CRM comercial interno · Acceso por invitación
          </p>
        </div>
      </div>

      {setupError && (
        <div className="mb-5 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs text-[#334155]">
          Falta configurar <code className="font-mono text-[#0F172A]">.env.local</code>{" "}
          con la URL y clave pública de Supabase.
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {mfaFactorId ? (
        <form onSubmit={handleVerifyMfa} className="space-y-4">
          <div className="rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs text-[#334155]">
            <p className="flex items-center gap-1.5 font-semibold text-[#0F172A]">
              <ShieldCheck className="h-4 w-4 text-[#1658F5]" />
              Verificación en dos pasos
            </p>
            <p className="mt-1 text-[#64748B]">
              Introduce el código temporal de 6 dígitos de tu app Authenticator.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mfa-code" className="text-xs font-semibold text-[#0F172A]">
              Código Authenticator
            </label>
            <Input
              id="mfa-code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
              className="font-mono text-base tracking-[0.25em]"
            />
          </div>

          <Button type="submit" className="w-full" disabled={verifyingMfa}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {verifyingMfa ? "Verificando..." : "Verificar y acceder"}
          </Button>

          <button
            type="button"
            onClick={() => void handleSwitchAccount()}
            className="w-full text-center text-xs font-medium text-[#64748B] hover:text-[#0F172A]"
          >
            Cambiar de cuenta / cerrar sesión
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-semibold text-[#0F172A]">
              Email corporativo
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="nombre@desklyy.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-[#0F172A]">
              Contraseña
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            <Lock className="h-3.5 w-3.5" />
            {loading ? "Accediendo..." : "Iniciar sesión"}
          </Button>
        </form>
      )}

      <p className="mt-6 border-t border-[#F1F5F9] pt-4 text-center text-[11px] text-[#64748B]">
        El alta de cuentas está restringida a invitaciones desde Settings &gt; Equipo.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-6">
      <Suspense
        fallback={
          <div className="h-80 w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]" />
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
