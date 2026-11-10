"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesklyLogo } from "@/components/brand/deskly-logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const setupError = searchParams.get("setup") === "missing_env";
  const authError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    authError === "inactive"
      ? "Tu usuario está desactivado. Contacta con un administrador."
      : authError === "callback"
        ? "El enlace de invitación ha caducado o no es válido."
        : null
  );

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

      const safeNext =
        nextPath.startsWith("/") &&
        !nextPath.startsWith("//") &&
        !nextPath.startsWith("/\\")
          ? nextPath
          : "/";
      router.push(safeNext);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servicio de autenticación.");
    } finally {
      setLoading(false);
    }
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
