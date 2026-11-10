import type { CustomFieldType, Database, Json } from "@/types/database";

export type CustomFieldDefinition =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"];

export interface CustomFieldOption {
  value: string;
  label: string;
}

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Texto corto",
  number: "Número",
  currency: "Importe (€)",
  select: "Selección única",
  multi_select: "Selección múltiple",
  date: "Fecha",
  boolean: "Sí / No",
  url: "URL",
};

/**
 * Genera una clave inmutable en snake_case a partir de una etiqueta legible.
 */
export function toSnakeCaseKey(label: string): string {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!normalized) return "propiedad";
  return /^[0-9]/.test(normalized) ? `f_${normalized}` : normalized;
}

/**
 * Normaliza el JSONB `options` de custom_field_definitions en una lista uniforme.
 */
export function parseFieldOptions(raw: Json | undefined): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];

  const result: CustomFieldOption[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      result.push({ value: item.trim(), label: item.trim() });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, Json | undefined>;
      const value = typeof obj.value === "string" ? obj.value.trim() : "";
      const label = typeof obj.label === "string" ? obj.label.trim() : value;
      if (value) {
        result.push({ value, label: label || value });
      }
    }
  }
  return result;
}

/**
 * Agrupa definiciones activas por `section` manteniendo `field_order`.
 */
export function groupFieldsBySection(
  fields: CustomFieldDefinition[]
): Array<{ section: string; fields: CustomFieldDefinition[] }> {
  const sorted = [...fields]
    .filter((f) => f.is_active)
    .sort((a, b) => a.field_order - b.field_order || a.label.localeCompare(b.label));

  const map = new Map<string, CustomFieldDefinition[]>();
  for (const field of sorted) {
    const section = field.section?.trim() || "Propiedades personalizadas";
    const group = map.get(section) ?? [];
    group.push(field);
    map.set(section, group);
  }

  return Array.from(map.entries()).map(([section, sectionFields]) => ({
    section,
    fields: sectionFields,
  }));
}

export function formatCurrencyEUR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(num);
}

