"use client";

import React, { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineFieldOption {
  value: string;
  label: string;
}

interface InlineFieldProps {
  label: string;
  value: string | number | null | undefined;
  type?: "text" | "url" | "number" | "select";
  options?: InlineFieldOption[];
  placeholder?: string;
  onSave: (nextValue: string | null) => Promise<void> | void;
}

export function InlineField({
  label,
  value,
  type = "text",
  options = [],
  placeholder = "Sin definir",
  onSave,
}: InlineFieldProps) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stringValue);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(stringValue);
  }, [stringValue]);

  async function commit(nextRaw: string) {
    const trimmed = nextRaw.trim();
    const normalized = trimmed === "" ? null : trimmed;
    if ((normalized ?? "") === stringValue) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(normalized);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  return (
    <div className="group grid grid-cols-[140px_1fr] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50">
      <span className="truncate text-xs font-medium text-slate-500" title={label}>
        {label}
      </span>

      <div className="flex min-w-0 items-center gap-2">
        {type === "select" ? (
          <select
            value={stringValue}
            disabled={saving}
            onChange={(e) => void commit(e.target.value)}
            className={cn(
              "h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-900 transition-colors hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none",
              !stringValue && "text-slate-400"
            )}
          >
            <option value="">{placeholder}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : editing ? (
          <input
            autoFocus
            type={type === "number" ? "number" : type === "url" ? "url" : "text"}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit(draft);
              } else if (e.key === "Escape") {
                setDraft(stringValue);
                setEditing(false);
              }
            }}
            placeholder={placeholder}
            className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-slate-100",
                stringValue ? "text-slate-900" : "text-slate-400"
              )}
            >
              {stringValue || placeholder}
            </button>

            {type === "url" && stringValue && (
              <a
                href={stringValue.startsWith("http") ? stringValue : `https://${stringValue}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Abrir enlace"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}

        {savedFlash && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
      </div>
    </div>
  );
}

