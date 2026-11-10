"use client";

import React, { useMemo, useState } from "react";
import { Archive, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewPropertyModal } from "@/components/crm/new-property-modal";
import {
  FIELD_TYPE_LABELS,
  type CustomFieldDefinition,
} from "@/lib/crm/custom-fields";
import {
  deleteCustomFieldDefinitionAction,
  updateCustomFieldDefinitionAction,
} from "@/app/(crm)/actions/settings";
import type { EntityType, UserRole } from "@/types/database";

interface FieldsManagerProps {
  initialDefinitions: CustomFieldDefinition[];
  currentUserRole: UserRole;
}

const ENTITY_TABS: { key: EntityType; label: string }[] = [
  { key: "company", label: "Empresas" },
  { key: "contact", label: "Contactos" },
  { key: "deal", label: "Negocios" },
];

export function FieldsManager({
  initialDefinitions,
  currentUserRole,
}: FieldsManagerProps) {
  const [definitions, setDefinitions] =
    useState<CustomFieldDefinition[]>(initialDefinitions);
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [newOpen, setNewOpen] = useState(false);

  const isAdmin = currentUserRole === "admin";

  const filtered = useMemo(
    () =>
      definitions
        .filter((d) => d.entity_type === entityType)
        .sort((a, b) => a.field_order - b.field_order),
    [definitions, entityType]
  );

  async function toggleActive(field: CustomFieldDefinition) {
    if (!isAdmin) return;
    const res = await updateCustomFieldDefinitionAction(field.id, {
      is_active: !field.is_active,
    });
    if (res.data) {
      setDefinitions((prev) => prev.map((d) => (d.id === field.id ? res.data : d)));
    }
  }

  async function handleDelete(field: CustomFieldDefinition) {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `¿Eliminar definitivamente la variable "${field.label}" (${field.key})?`
      )
    ) {
      return;
    }
    const res = await deleteCustomFieldDefinitionAction(field.id);
    if (res.ok) {
      setDefinitions((prev) => prev.filter((d) => d.id !== field.id));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1">
          {ENTITY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setEntityType(t.key)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                entityType === t.key
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Nueva propiedad
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Etiqueta</th>
              <th className="px-4 py-2.5">Clave API (inmutable)</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5">Sección</th>
              <th className="px-4 py-2.5">Estado</th>
              {isAdmin && <th className="px-4 py-2.5 text-right">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 6 : 5}
                  className="px-4 py-10 text-center text-xs text-slate-500"
                >
                  No hay propiedades personalizadas en esta entidad.
                </td>
              </tr>
            ) : (
              filtered.map((field) => (
                <tr key={field.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {field.label}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {field.key}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    <Badge>{FIELD_TYPE_LABELS[field.field_type]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {field.section}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={field.is_active ? "success" : "default"}>
                      {field.is_active ? "Activa" : "Archivada"}
                    </Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void toggleActive(field)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {field.is_active ? "Archivar" : "Activar"}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void handleDelete(field)}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NewPropertyModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        entityType={entityType}
        onCreated={(def) => setDefinitions((prev) => [...prev, def])}
      />
    </div>
  );
}

