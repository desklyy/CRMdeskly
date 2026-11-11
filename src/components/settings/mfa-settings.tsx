"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface VerifiedFactor {
  id: string;
  friendly_name?: string;
  created_at: string;
}

export function MfaSettings() {
  const [loading, setLoading] = useState(true);
  const [verifiedFactors, setVerifiedFactors] = useState<VerifiedFactor[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);

  // Enroll flow
  const [enrolling, setEnrolling] = useState(false);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Unenroll flow
  const [unenrollingId, setUnenrollingId] = useState<string | null>(null);
  const [stepUpFactorId, setStepUpFactorId] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState("");

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [factorsRes, aalRes] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      const verified = (factorsRes.data?.totp ?? []).filter(
        (f) => f.status === "verified"
      );
      setVerifiedFactors(verified);
      setCurrentLevel(aalRes.data?.currentLevel ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  async function handleStartEnroll() {
    setFeedback(null);
    setEnrolling(true);
    try {
      const supabase = createClient();
      const existing = await supabase.auth.mfa.listFactors();
      const unverified = (existing.data?.all ?? []).filter(
        (f) => f.factor_type === "totp" && f.status !== "verified"
      );
      for (const old of unverified) {
        await supabase.auth.mfa.unenroll({ factorId: old.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Deskly CRM Authenticator",
      });

      if (error || !data) {
        setFeedback({
          type: "error",
          text: error?.message ?? "No se pudo iniciar la configuración del Authenticator.",
        });
        return;
      }

      const rawQr = data.totp.qr_code;
      const resolvedQr = rawQr.startsWith("data:")
        ? rawQr
        : `data:image/svg+xml;utf8,${encodeURIComponent(rawQr)}`;

      setPendingFactorId(data.id);
      setQrDataUrl(resolvedQr);
      setManualSecret(data.totp.secret);
      setVerifyCode("");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleConfirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFactorId) return;
    const cleanCode = verifyCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      setFeedback({ type: "error", text: "Introduce los 6 dígitos de tu app Authenticator." });
      return;
    }

    setVerifying(true);
    setFeedback(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pendingFactorId,
        code: cleanCode,
      });

      if (error) {
        setFeedback({
          type: "error",
          text: "Código incorrecto o caducado. Comprueba la hora de tu móvil e inténtalo de nuevo.",
        });
        return;
      }

      setPendingFactorId(null);
      setQrDataUrl(null);
      setManualSecret(null);
      setVerifyCode("");
      setFeedback({
        type: "success",
        text: "Doble verificación activada. A partir de ahora te pedirá el código al iniciar sesión.",
      });
      await loadFactors();
    } finally {
      setVerifying(false);
    }
  }

  async function handleCancelEnroll() {
    if (pendingFactorId) {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
    }
    setPendingFactorId(null);
    setQrDataUrl(null);
    setManualSecret(null);
    setVerifyCode("");
  }

  async function handleUnenroll(factorId: string) {
    if (!window.confirm("¿Desactivar la doble verificación (Authenticator) de tu cuenta?")) {
      return;
    }

    setFeedback(null);
    if (currentLevel !== "aal2") {
      setStepUpFactorId(factorId);
      setStepUpCode("");
      return;
    }

    setUnenrollingId(factorId);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        setFeedback({ type: "error", text: error.message });
        return;
      }
      setFeedback({
        type: "success",
        text: "Doble verificación desactivada en tu cuenta.",
      });
      await loadFactors();
    } finally {
      setUnenrollingId(null);
    }
  }

  async function handleStepUpAndUnenroll(e: React.FormEvent) {
    e.preventDefault();
    if (!stepUpFactorId) return;
    const cleanCode = stepUpCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) return;

    setUnenrollingId(stepUpFactorId);
    setFeedback(null);
    try {
      const supabase = createClient();
      const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
        factorId: stepUpFactorId,
        code: cleanCode,
      });
      if (verifyErr) {
        setFeedback({ type: "error", text: "Código incorrecto." });
        return;
      }

      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: stepUpFactorId,
      });
      if (unenrollErr) {
        setFeedback({ type: "error", text: unenrollErr.message });
        return;
      }

      setStepUpFactorId(null);
      setStepUpCode("");
      setFeedback({
        type: "success",
        text: "Doble verificación desactivada en tu cuenta.",
      });
      await loadFactors();
    } finally {
      setUnenrollingId(null);
    }
  }

  const isEnabled = verifiedFactors.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#1658F5]" />
              <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                Doble verificación con App Authenticator (2FA)
              </h2>
              {!loading &&
                (isEnabled ? (
                  <Badge variant="success">Activada</Badge>
                ) : (
                  <Badge>Desactivada</Badge>
                ))}
            </div>
            <p className="text-xs text-[#64748B]">
              Protege tu acceso al CRM con un código temporal de 6 dígitos generado por
              Google Authenticator, Microsoft Authenticator, Authy o 1Password.
            </p>
          </div>

          {!loading && !isEnabled && !pendingFactorId && (
            <Button
              type="button"
              size="sm"
              disabled={enrolling}
              onClick={() => void handleStartEnroll()}
              className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
            >
              {enrolling ? "Generando QR..." : "Activar Authenticator (2FA)"}
            </Button>
          )}
        </div>

        {feedback && (
          <div
            className={`flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] bg-[#F8FAFC] p-3 text-xs ${
              feedback.type === "error"
                ? "border-l-red-600 text-red-700"
                : "border-l-emerald-600 text-[#0F172A]"
            }`}
          >
            {feedback.type === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* QR Enrollment Step */}
        {pendingFactorId && qrDataUrl && (
          <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-5 space-y-4">
            <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
              <div className="flex items-center justify-center rounded-[4px] border border-[#E2E8F0] bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="Código QR para app Authenticator"
                  className="h-40 w-40"
                />
              </div>

              <div className="space-y-3 text-xs text-[#334155]">
                <p className="font-semibold text-[#0F172A]">
                  1. Escanea el código QR con tu app Authenticator
                </p>
                <p>
                  Abre Google Authenticator, Microsoft Authenticator o 1Password y escanea
                  el QR de la izquierda. Si prefieres introducirla a mano, usa esta clave:
                </p>

                {manualSecret && (
                  <div className="flex items-center gap-2">
                    <code className="rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#0F172A]">
                      {manualSecret}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(manualSecret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 1500);
                      }}
                    >
                      {copiedSecret ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedSecret ? "Copiada" : "Copiar"}
                    </Button>
                  </div>
                )}

                <form onSubmit={handleConfirmEnroll} className="space-y-2 pt-2">
                  <p className="font-semibold text-[#0F172A]">
                    2. Introduce el código de 6 dígitos para confirmar
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                      className="h-9 w-36 font-mono text-sm tracking-widest"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={verifying}
                      className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
                    >
                      {verifying ? "Verificando..." : "Confirmar y activar"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCancelEnroll()}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Active factors list */}
        {isEnabled && (
          <div className="space-y-2">
            {verifiedFactors.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs"
              >
                <div>
                  <p className="font-semibold text-[#0F172A]">
                    {f.friendly_name || "App Authenticator (TOTP)"}
                  </p>
                  <p className="text-[#64748B]">
                    Activado el{" "}
                    {new Date(f.created_at).toLocaleDateString("es-ES", {
                      dateStyle: "medium",
                    })}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={unenrollingId === f.id}
                  onClick={() => void handleUnenroll(f.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {unenrollingId === f.id ? "Desactivando..." : "Desactivar 2FA"}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Step-up prompt if unenroll requested from AAL1 session */}
        {stepUpFactorId && (
          <form
            onSubmit={handleStepUpAndUnenroll}
            className="rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs space-y-2"
          >
            <p className="font-semibold text-[#0F172A]">
              Confirma tu código actual de 6 dígitos para desactivar la doble verificación:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                required
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={stepUpCode}
                onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, ""))}
                className="h-8 w-32 font-mono tracking-widest"
              />
              <Button type="submit" size="sm" disabled={Boolean(unenrollingId)}>
                Confirmar desactivación
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStepUpFactorId(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
