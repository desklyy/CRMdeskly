"use client";

import React, { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FIELD_TYPE_LABELS,
  toSnakeCaseKey,
  type CustomFieldDefinition,
} from "@/lib/crm/custom-fields";
import { createCustomFieldAction } from "@/app/(crm)/actions/crm-entities";
import type { CustomFieldType, EntityType } from "@/types/database";

interface NewPropertyModalProps {
  open: boolean;
  onClose: () => void;
  entityType: EntityType;
  existingSections?: string[];
  onCreated?: (field: CustomFieldDefinition) => void;
}

const ENTITY_LABELS: Record<EntityType, string> = {
  company: "Empresa",
  contact: "Contacto",
  deal: "Negocio",
};

export function NewPropertyModal({
  open,
  onClose,
  entityType,
  existingSections = [],
  onCreated,
}: NewPropertyModalProps) {
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [section, setSection] = useState("Propiedades personalizadas");
  const [description, setDescription] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatedKey = useMemo(() => toSnakeCaseKey(label), [label]);
  const needsOptions = fieldType === "select" || fieldType === "multi_select";

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedOptions = optionsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (needsOptions && parsedOptions.length === 0) {
      setError("Indica al menos una opción separada por comas.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createCustomFieldAction({
        entity_type: entityType,
        label,
        key: generatedKey,
        description,
        section,
        field_type: fieldType,
        options: parsedOptions,
        is_required: isRequired,
      });

      if (res.error || !res.data) {
        setError(res.error ?? "No se pudo crear la propiedad.");
        return;
      }

      onCreated?.(res.data);
      setLabel("");
      setDescription("");
      setOptionsText("");
      setIsRequired(false);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nueva propiedad estructurada"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              + Nueva propiedad ({ENTITY_LABELS[entityType]})
            </h3>
            <p className="text-xs text-slate-500">
              Disponible al instante en las fichas y en <code className="font-mono">/api/v1/schema</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Nombre visible</label>
            <Input
              required
              autoFocus
              placeholder="Ej. MRR estimado, Sector vertical..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-[11px] text-slate-400">
              Clave API inmutable: <code className="font-mono text-slate-600">{generatedKey}</code>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Tipo de dato</label>
              <select
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950"
              >
                {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((ft) => (
                  <option key={ft} value={ft}>
                    {FIELD_TYPE_LABELS[ft]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Sección</label>
              <Input
                list="crm-field-sections"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="Propiedades personalizadas"
              />
              <datalist id="crm-field-sections">
                <option value="Propiedades personalizadas" />
                {existingSections.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          {needsOptions && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">
                Opciones (separadas por comas)
              </label>
              <Input
                required
                placeholder="Ej. SaaS, Agencia, Ecommerce"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">
              Descripción para equipo y Agentes IA (opcional)
            </label>
            <Input
              placeholder="Contexto de cuándo rellenar esta variable..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Marcar como propiedad recomendada / requerida
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              <Plus className="h-3.5 w-3.5" />
              {submitting ? "Creando..." : "Crear propiedad"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

