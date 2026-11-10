"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesklyLogo } from "@/components/brand/deskly-logo";
import { buildFullName, computeAvatarInitials } from "@/lib/crm/profiles";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const fName = firstName.trim();
      const lName = lastName.trim();
      const fullName = fName ? buildFullName(fName, lName) : "";

      const { data: userData, error: updateError } = await supabase.auth.updateUser({
        password,
        ...(fullName
          ? {
              data: {
                first_name: fName,
                last_name: lName || null,
                full_name: fullName,
              },
            }
          : {}),
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      if (fName && userData.user) {
        await supabase
          .from("profiles")
          .update({
            first_name: fName,
            last_name: lName || null,
            full_name: fullName,
            avatar_initials: computeAvatarInitials(fName, lName),
          })
          .eq("id", userData.user.id);
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("No se pudo guardar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-6">
      <div className="w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
        <div className="mb-6 flex items-center gap-3">
          <DesklyLogo size="md" className="border border-[#E2E8F0]" />
          <div>
            <h1 className="text-lg font-bold tracking-[-0.02em] text-[#0F172A]">
              Activa tu cuenta
            </h1>
            <p className="text-xs text-[#64748B]">
              Completa tu nombre, apellido y contraseña para acceder a Deskly CRM.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="firstName" className="text-xs font-semibold text-[#0F172A]">
                Nombre
              </label>
              <Input
                id="firstName"
                type="text"
                placeholder="Ej. Noé"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="lastName" className="text-xs font-semibold text-[#0F172A]">
                Apellido
              </label>
              <Input
                id="lastName"
                type="text"
                placeholder="Ej. Hidalgo"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-[#0F172A]">
              Nueva contraseña
            </label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="confirmPassword"
              className="text-xs font-semibold text-[#0F172A]"
            >
              Confirmar contraseña
            </label>
            <Input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              placeholder="Repite la contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            <KeyRound className="h-3.5 w-3.5" />
            {loading ? "Guardando..." : "Guardar y entrar"}
          </Button>
        </form>
      </div>
    </main>
  );
}
