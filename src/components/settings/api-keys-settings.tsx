"use client";

import React, { useState } from "react";
import { Ban, Check, Copy, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@/app/(crm)/actions/settings";
import type { ApiKeyPermission, Database } from "@/types/database";

export type ApiKeyPublicRow = Omit<
  Database["public"]["Tables"]["api_keys"]["Row"],
  "key_hash" | "created_by"
>;

interface ApiKeysSettingsProps {
  initialKeys: ApiKeyPublicRow[];
}

export function ApiKeysSettings({ initialKeys }: ApiKeysSettingsProps) {
  const [keys, setKeys] = useState<ApiKeyPublicRow[]>(initialKeys);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<ApiKeyPermission>("read_write");
  const [creating, setCreating] = useState(false);
  const [plainTextOnce, setPlainTextOnce] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlainTextOnce(null);
    setCreating(true);
    try {
      const res = await createApiKeyAction({ name, permissions });
      if (res.error || !res.data || !res.plainTextKey) {
        setError(res.error ?? "No se pudo generar la clave API.");
        return;
      }

      setKeys((prev) => [res.data, ...prev]);
      setPlainTextOnce(res.plainTextKey);
      setName("");
      setCopied(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("¿Revocar esta API Key? Los agentes dejarán de tener acceso.")) {
      return;
    }
    const res = await revokeApiKeyAction(id);
    if (res.data) {
      setKeys((prev) => prev.map((k) => (k.id === id ? res.data : k)));
    }
  }

  async function copyPlainKey() {
    if (!plainTextOnce) return;
    await navigator.clipboard.writeText(plainTextOnce);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
        <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
          API Keys para Agentes IA (<code className="font-mono">/api/v1/*</code>)
        </h2>
        <p className="mt-0.5 text-xs text-[#64748B]">
          Las claves se almacenan como hash SHA-256. La clave completa se muestra una
          única vez al generarse.
        </p>

        {error && (
          <div className="mt-3 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {plainTextOnce && (
          <div className="mt-4 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-4 text-xs">
            <p className="font-semibold text-[#0F172A]">
              Copia esta clave ahora: no volverá a mostrarse
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0F172A]">
                {plainTextOnce}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={copyPlainKey}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiada" : "Copiar"}
              </Button>
            </div>
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px_auto]"
        >
          <Input
            required
            placeholder="Nombre del agente (ej. Agente Cualificación n8n)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            value={permissions}
            onChange={(e) => setPermissions(e.target.value as ApiKeyPermission)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
          >
            <option value="read_write">Lectura y escritura</option>
            <option value="read">Solo lectura</option>
          </select>
          <Button type="submit" disabled={creating}>
            <Plus className="h-3.5 w-3.5" />
            {creating ? "Generando..." : "Generar clave"}
          </Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Prefijo</th>
              <th className="px-4 py-2.5">Permisos</th>
              <th className="px-4 py-2.5">Último uso</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                  <KeyRound className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  No hay API Keys generadas todavía.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {k.key_prefix}...
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={k.permissions === "read_write" ? "dark" : "default"}>
                      {k.permissions}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {k.last_used_at
                      ? new Date(k.last_used_at).toLocaleString("es-ES")
                      : "Nunca"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={k.is_active ? "success" : "destructive"}>
                      {k.is_active ? "Activa" : "Revocada"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {k.is_active && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleRevoke(k.id)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Revocar
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

