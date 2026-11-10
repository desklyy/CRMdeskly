"use client";

import React, { useState } from "react";
import { MailPlus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  inviteTeamMemberAction,
  updateTeamMemberAction,
  updateTeamMemberNameAction,
} from "@/app/(crm)/actions/settings";
import type { Database, UserRole } from "@/types/database";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

interface TeamSettingsProps {
  initialProfiles: ProfileRow[];
  currentUserId: string;
}

export function TeamSettings({ initialProfiles, currentUserId }: TeamSettingsProps) {
  const [profiles, setProfiles] = useState<ProfileRow[]>(initialProfiles);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<UserRole>("sales");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setInviting(true);
    try {
      const res = await inviteTeamMemberAction({
        email,
        first_name: firstName,
        last_name: lastName,
        role,
      });

      if (res.error || !res.data) {
        setError(res.error ?? "No se pudo invitar al usuario.");
        return;
      }

      const invited = res.data;
      setProfiles((prev) => {
        const exists = prev.some((p) => p.id === invited.id);
        return exists
          ? prev.map((p) => (p.id === invited.id ? invited : p))
          : [...prev, invited];
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("sales");
      setMessage(`Invitación enviada a ${invited.email}.`);
    } finally {
      setInviting(false);
    }
  }

  function startEditName(profile: ProfileRow) {
    const parts = profile.full_name.trim().split(/\s+/);
    setEditingId(profile.id);
    setEditFirst(profile.first_name ?? parts[0] ?? "");
    setEditLast(profile.last_name ?? parts.slice(1).join(" ") ?? "");
  }

  async function saveEditName(profileId: string) {
    setError(null);
    const res = await updateTeamMemberNameAction(profileId, {
      first_name: editFirst,
      last_name: editLast,
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.data) {
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? res.data : p)));
      setEditingId(null);
    }
  }

  async function toggleRole(profile: ProfileRow) {
    const nextRole: UserRole = profile.role === "admin" ? "sales" : "admin";
    setError(null);
    const res = await updateTeamMemberAction(profile.id, { role: nextRole });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.data) {
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? res.data : p)));
    }
  }

  async function toggleActive(profile: ProfileRow) {
    setError(null);
    const res = await updateTeamMemberAction(profile.id, {
      is_active: !profile.is_active,
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.data) {
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? res.data : p)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]">
        <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
          Invitar miembro al equipo (Invite-Only)
        </h2>
        <p className="mt-0.5 text-xs text-[#64748B]">
          El avatar se genera con la primera letra del nombre y la primera del apellido.
        </p>

        {message && (
          <div className="mt-3 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs text-[#0F172A]">
            {message}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <form
          onSubmit={handleInvite}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_120px_auto]"
        >
          <Input
            required
            type="text"
            placeholder="Nombre *"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            required
            type="text"
            placeholder="Apellido *"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <Input
            required
            type="email"
            placeholder="correo@desklyy.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="h-9 rounded-[4px] border border-[#E2E8F0] bg-white px-2.5 text-sm text-[#0F172A]"
          >
            <option value="sales">Ventas</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={inviting}>
            <MailPlus className="h-3.5 w-3.5" />
            {inviting ? "Enviando..." : "Invitar"}
          </Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-[4px] border border-[#E2E8F0] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
              <th className="px-4 py-2.5">Usuario</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Rol</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {profiles.map((p) => {
              const isSelf = p.id === currentUserId;
              const isEditing = editingId === p.id;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={editFirst}
                          onChange={(e) => setEditFirst(e.target.value)}
                          placeholder="Nombre"
                          className="h-7 w-28 text-xs"
                        />
                        <Input
                          value={editLast}
                          onChange={(e) => setEditLast(e.target.value)}
                          placeholder="Apellido"
                          className="h-7 w-28 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void saveEditName(p.id)}
                          className="rounded-[4px] p-1 text-[#1658F5] hover:bg-[#F1F5F9]"
                          title="Guardar"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#F1F5F9]"
                          title="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#1658F5] text-[11px] font-bold text-white">
                          {p.avatar_initials}
                        </span>
                        <span className="font-semibold text-[#0F172A]">
                          {p.full_name}
                          {isSelf && (
                            <span className="ml-1.5 text-[11px] font-normal text-[#64748B]">
                              (tú)
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEditName(p)}
                          className="rounded-[4px] p-1 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                          title="Editar nombre y apellido"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#334155]">{p.email}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={p.role === "admin" ? "brand" : "default"}>
                      {p.role === "admin" ? "Admin" : "Ventas"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={p.is_active ? "success" : "destructive"}>
                      {p.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSelf}
                        onClick={() => void toggleRole(p)}
                      >
                        Cambiar rol
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isSelf}
                        onClick={() => void toggleActive(p)}
                      >
                        {p.is_active ? "Desactivar" : "Reactivar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
