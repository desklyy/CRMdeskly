"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calendar, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignatureEditor } from "@/components/settings/signature-editor";
import type { Database } from "@/types/database";

type OAuthConnectionPublic = Pick<
  Database["public"]["Tables"]["oauth_connections"]["Row"],
  | "id"
  | "microsoft_email"
  | "is_auth_invalid"
  | "last_auth_error"
  | "subscription_expires_at"
  | "calendar_subscription_expires_at"
  | "updated_at"
>;

interface IntegrationsSettingsProps {
  connection: OAuthConnectionPublic | null;
  emailSignature?: string | null;
  outlookStatus?: string;
  outlookReason?: string;
}

export function IntegrationsSettings({
  connection,
  emailSignature = null,
  outlookStatus,
  outlookReason,
}: IntegrationsSettingsProps) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    if (!window.confirm("¿Desconectar tu cuenta de Microsoft Outlook del CRM?")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/outlook/disconnect", { method: "POST" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
                Microsoft Outlook (Email + Calendario Bidireccional)
              </h2>
              {connection ? (
                connection.is_auth_invalid ? (
                  <Badge variant="destructive">Reautenticación requerida</Badge>
                ) : (
                  <Badge variant="success">Conectado</Badge>
                )
              ) : (
                <Badge>No conectado</Badge>
              )}
            </div>
            <p className="text-xs text-[#64748B]">
              Conexión por usuario vía OAuth2 Microsoft Entra ID (Mail Inbox/SentItems +
              Calendario en tiempo real sin duplicar eventos).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/outlook/connect"
              className="inline-flex h-8 items-center rounded-[4px] bg-[#1658F5] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1246C8]"
            >
              {connection
                ? "Volver a iniciar sesión con Outlook"
                : "Iniciar sesión con Outlook"}
            </a>

            {connection && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disconnecting}
                onClick={() => void handleDisconnect()}
              >
                {disconnecting ? "Desconectando..." : "Desconectar"}
              </Button>
            )}
          </div>
        </div>

        {outlookStatus === "missing_config" && (
          <div className="mt-4 flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs text-[#334155]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#1658F5]" />
            <div className="space-y-1">
              <p className="font-semibold text-[#0F172A]">
                Falta configurar la app de Microsoft Entra ID en <code>.env.local</code>
              </p>
              <p>
                Para que el botón abra el inicio de sesión oficial de Microsoft, añade en{" "}
                <code>.env.local</code> las variables <code>MICROSOFT_CLIENT_ID</code>,{" "}
                <code>MICROSOFT_CLIENT_SECRET</code> y{" "}
                <code>OAUTH_TOKEN_ENCRYPTION_KEY</code>, y registra en Azure el URI de
                redirección <code>http://localhost:3000/api/outlook/callback</code>.
              </p>
            </div>
          </div>
        )}

        {outlookStatus === "connected" && (
          <div className="mt-4 flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-emerald-600 bg-[#F8FAFC] p-3 text-xs text-[#334155]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold text-[#0F172A]">
                Sesión iniciada con Microsoft Outlook correctamente.
              </p>
              <p className="mt-0.5 text-[#64748B]">
                El buzón y el calendario ya están sincronizados con tu usuario del CRM.
              </p>
            </div>
          </div>
        )}

        {outlookStatus === "error" && (
          <div className="mt-4 flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                No se pudo completar el inicio de sesión con Outlook.
              </p>
              {outlookReason && (
                <p className="mt-0.5 font-mono text-[11px]">{outlookReason}</p>
              )}
            </div>
          </div>
        )}

        {connection?.is_auth_invalid && (
          <div className="mt-4 flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                Conexión con Outlook pausada. Vuelve a autenticarte.
              </p>
              {connection.last_auth_error && (
                <p className="mt-0.5 font-mono text-[11px]">{connection.last_auth_error}</p>
              )}
            </div>
          </div>
        )}

        {connection && !connection.is_auth_invalid && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-2 text-slate-700">
              <Mail className="h-4 w-4 text-slate-400" />
              <span>
                Buzón: <strong className="text-slate-950">{connection.microsoft_email}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <Calendar className="h-4 w-4 text-slate-400" />
              <span>
                Calendario:{" "}
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Sincronizado
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      <SignatureEditor initialSignature={emailSignature} />
    </div>
  );
}
