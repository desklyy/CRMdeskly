"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrencyEUR,
  groupFieldsBySection,
  parseFieldOptions,
  type CustomFieldDefinition,
} from "@/lib/crm/custom-fields";
import { appendCustomFieldOptionAction } from "@/app/(crm)/actions/crm-entities";
import { NewPropertyModal } from "@/components/crm/new-property-modal";
import type { EntityType, Json } from "@/types/database";

interface CustomFieldsPanelProps {
  entityType: EntityType;
  definitions: CustomFieldDefinition[];
  values: Record<string, Json> | null | undefined;
  onUpdateField: (key: string, value: Json) => Promise<void>;
  onDefinitionCreated?: (def: CustomFieldDefinition) => void;
  onDefinitionUpdated?: (def: CustomFieldDefinition) => void;
}

export function CustomFieldsPanel({
  entityType,
  definitions,
  values,
  onUpdateField,
  onDefinitionCreated,
  onDefinitionUpdated,
}: CustomFieldsPanelProps) {
  const [newPropOpen, setNewPropOpen] = useState(false);
  const [addingOptionFor, setAddingOptionFor] = useState<string | null>(null);
  const [newOptionText, setNewOptionText] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  const grouped = useMemo(() => groupFieldsBySection(definitions), [definitions]);
  const existingSections = useMemo(
    () => grouped.map((g) => g.section),
    [grouped]
  );

  async function handleAddOption(field: CustomFieldDefinition) {
    const clean = newOptionText.trim();
    if (!clean) return;
    const res = await appendCustomFieldOptionAction(field.id, clean);
    if (res.data) {
      onDefinitionUpdated?.(res.data);
      const currentVal = values?.[field.key];
      if (field.field_type === "select") {
        await onUpdateField(field.key, clean);
      } else if (field.field_type === "multi_select") {
        const list = Array.isArray(currentVal) ? currentVal.map(String) : [];
        if (!list.includes(clean)) {
          await onUpdateField(field.key, [...list, clean]);
        }
      }
      setNewOptionText("");
      setAddingOptionFor(null);
    }
  }

  function renderControl(field: CustomFieldDefinition) {
    const rawVal = values?.[field.key];

    if (field.field_type === "boolean") {
      const checked = rawVal === true;
      return (
        <button
          type="button"
          onClick={() => void onUpdateField(field.key, !checked)}
          className={`inline-flex h-6 w-11 items-center rounded-[4px] border transition-colors ${
            checked
              ? "justify-end border-[#1658F5] bg-[#1658F5]"
              : "justify-start border-[#E2E8F0] bg-[#F1F5F9]"
          } px-0.5`}
        >
          <span className="h-4 w-4 rounded-[2px] bg-white" />
        </button>
      );
    }

    if (field.field_type === "select") {
      const options = parseFieldOptions(field.options);
      const selected = typeof rawVal === "string" ? rawVal : "";

      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={selected}
              onChange={(e) => void onUpdateField(field.key, e.target.value || null)}
              className="h-7 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
            >
              <option value="">Sin seleccionar</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                setAddingOptionFor(addingOptionFor === field.id ? null : field.id)
              }
              title="Añadir opción"
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              + Opción
            </button>
          </div>
          {addingOptionFor === field.id && (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={newOptionText}
                onChange={(e) => setNewOptionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddOption(field);
                  }
                }}
                placeholder="Nueva opción..."
                className="h-7 flex-1 rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none"
              />
              <Button size="sm" type="button" onClick={() => void handleAddOption(field)}>
                Añadir
              </Button>
            </div>
          )}
        </div>
      );
    }

    if (field.field_type === "multi_select") {
      const options = parseFieldOptions(field.options);
      const selected = Array.isArray(rawVal) ? rawVal.map(String) : [];

      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {options.map((opt) => {
              const active = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value];
                    void onUpdateField(field.key, next);
                  }}
                >
                  <Badge variant={active ? "dark" : "default"}>{opt.label}</Badge>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setAddingOptionFor(addingOptionFor === field.id ? null : field.id)
              }
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              + Opción
            </button>
          </div>

          {addingOptionFor === field.id && (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={newOptionText}
                onChange={(e) => setNewOptionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddOption(field);
                  }
                }}
                placeholder="Nueva opción..."
                className="h-7 flex-1 rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none"
              />
              <Button size="sm" type="button" onClick={() => void handleAddOption(field)}>
                Añadir
              </Button>
            </div>
          )}
        </div>
      );
    }

    if (field.field_type === "date") {
      const dateVal = typeof rawVal === "string" ? rawVal : "";
      return (
        <input
          type="date"
          value={dateVal}
          onChange={(e) => void onUpdateField(field.key, e.target.value || null)}
          className="h-7 rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
        />
      );
    }

    const displayString =
      rawVal === null || rawVal === undefined ? "" : String(rawVal);
    const isNumeric = field.field_type === "number" || field.field_type === "currency";

    if (editingKey === field.key) {
      return (
        <input
          autoFocus
          type={isNumeric ? "number" : field.field_type === "url" ? "url" : "text"}
          step={isNumeric ? "any" : undefined}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => {
            const trimmed = draftText.trim();
            const parsed: Json =
              trimmed === ""
                ? null
                : isNumeric
                  ? Number(trimmed)
                  : trimmed;
            setEditingKey(null);
            void onUpdateField(field.key, parsed);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setEditingKey(null);
            }
          }}
          className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none"
        />
      );
    }

    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setDraftText(displayString);
            setEditingKey(field.key);
          }}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-slate-100 ${
            displayString ? "text-slate-900" : "text-slate-400"
          }`}
        >
          {field.field_type === "currency" && displayString
            ? formatCurrencyEUR(displayString)
            : displayString || "Sin definir"}
        </button>

        {field.field_type === "url" && displayString && (
          <a
            href={displayString.startsWith("http") ? displayString : `https://${displayString}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Variables personalizadas
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setNewPropOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva propiedad
        </Button>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
          Aún no hay variables personalizadas. Pulsa{" "}
          <span className="font-medium text-slate-700">+ Nueva propiedad</span> para
          añadir la primera.
        </div>
      ) : (
        grouped.map(({ section, fields }) => (
          <div key={section} className="space-y-1.5">
            <h4 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section}
            </h4>
            <div className="rounded-md border border-slate-200 bg-white p-1.5">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[150px_1fr] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-xs font-medium text-slate-600"
                      title={field.description ?? field.key}
                    >
                      {field.label}
                      {field.is_required && <span className="ml-0.5 text-red-500">*</span>}
                    </p>
                  </div>
                  <div className="min-w-0">{renderControl(field)}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <NewPropertyModal
        open={newPropOpen}
        onClose={() => setNewPropOpen(false)}
        entityType={entityType}
        existingSections={existingSections}
        onCreated={onDefinitionCreated}
      />
    </div>
  );
}

