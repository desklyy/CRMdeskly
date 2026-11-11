"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Layers,
  Lock,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatCurrencyEUR,
  parseFieldOptions,
  type CustomFieldDefinition,
} from "@/lib/crm/custom-fields";
import type { Json } from "@/types/database";

export interface CompanyDealSummary {
  id: string;
  title: string;
  amount: number;
  status: "open" | "won" | "lost";
  stage_name: string | null;
  stage_color: string | null;
  lead_source: string | null;
  custom_fields: Record<string, Json>;
}

interface OperationalProjectPanelProps {
  companyId?: string | null;
  companyName?: string | null;
  companyValues?: Record<string, Json> | null;
  companyDefinitions?: CustomFieldDefinition[];
  onUpdateCompanyField?: (key: string, value: Json) => Promise<void>;
  dealValues?: Record<string, Json> | null;
  dealDefinitions?: CustomFieldDefinition[];
  onUpdateDealField?: (key: string, value: Json) => Promise<void>;
  companyDeals?: CompanyDealSummary[];
}

interface ParsedDepartment {
  name: string;
  workers: string | null;
  procedures: string | null;
}

type SubView = "departamentos" | "stack" | "operativa";

function asText(val: Json | undefined): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function asBool(val: Json | undefined): boolean | null {
  if (typeof val === "boolean") return val;
  if (val === "true") return true;
  if (val === "false") return false;
  return null;
}

function parseDepartmentsAndProcedures(
  deptsRaw: string,
  procsRaw: string
): ParsedDepartment[] {
  const byName = new Map<string, ParsedDepartment>();

  if (deptsRaw) {
    for (const part of deptsRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^(.+?)\s*\(([^)]+)\)$/);
      const name = (m ? m[1] : part).trim();
      const workers = m ? m[2].trim() : null;
      byName.set(name.toLowerCase(), { name, workers, procedures: null });
    }
  }

  if (procsRaw) {
    let currentDept: ParsedDepartment | null = null;
    const hasSeededDepts = byName.size > 0;

    for (const rawLine of procsRaw.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const hasBullet = /^[•*]\s*/.test(trimmed);
      const withoutBullet = trimmed.replace(/^[•*]\s*/, "");
      const colonIdx = withoutBullet.indexOf(":");

      if (colonIdx > 0) {
        const head = withoutBullet.slice(0, colonIdx).trim();
        const proc = withoutBullet.slice(colonIdx + 1).trim();
        const m = head.match(/^(.+?)\s*\(([^)]+)\)$/);
        const name = (m ? m[1] : head).trim();
        const workers = m ? m[2].trim() : null;
        const key = name.toLowerCase();

        const matchesKnownDept = byName.has(key);
        const matchesHeaderFormat = hasBullet && (Boolean(workers) || !hasSeededDepts);

        if (matchesKnownDept || matchesHeaderFormat) {
          const existing = byName.get(key);
          if (existing) {
            existing.workers = existing.workers || workers;
            if (proc) {
              existing.procedures = existing.procedures
                ? `${existing.procedures}\n${proc}`
                : proc;
            }
            currentDept = existing;
          } else {
            const created: ParsedDepartment = {
              name,
              workers,
              procedures: proc || null,
            };
            byName.set(key, created);
            currentDept = created;
          }
          continue;
        }
      }

      if (currentDept) {
        currentDept.procedures = currentDept.procedures
          ? `${currentDept.procedures}\n${trimmed}`
          : trimmed;
      } else {
        const cleaned = trimmed.replace(/^[•\-*]\s*/, "");
        const fallbackKey = cleaned.toLowerCase();
        const fallback: ParsedDepartment = {
          name: cleaned,
          workers: null,
          procedures: null,
        };
        byName.set(fallbackKey, fallback);
        currentDept = fallback;
      }
    }
  }

  return Array.from(byName.values());
}

function normalizeWorkersBadge(raw: string): string | null {
  const clean = raw.trim();
  if (!clean) return null;
  if (/^\d+$/.test(clean)) return `${clean} trab.`;
  return clean;
}

function serializeDepartments(list: ParsedDepartment[]): {
  deptsText: string | null;
  procsText: string | null;
} {
  if (list.length === 0) {
    return { deptsText: null, procsText: null };
  }

  const deptsText = list
    .map((d) => (d.workers ? `${d.name} (${d.workers})` : d.name))
    .join(", ");

  const hasAnyProc = list.some((d) => Boolean(d.procedures && d.procedures.trim()));
  const procsText = hasAnyProc
    ? list
        .map((d) => {
          const prefix = d.workers ? `${d.name} (${d.workers})` : d.name;
          const rawProc = (d.procedures ?? "").trim();
          const formattedProc = rawProc
            ? rawProc
                .split(/\r?\n/)
                .map((l, idx) => (idx === 0 ? l.trim() : `  ${l.trim()}`))
                .join("\n")
            : "Sin procedimientos detallados";
          return `• ${prefix}: ${formattedProc}`;
        })
        .join("\n")
    : null;

  return { deptsText, procsText };
}

export function OperationalProjectPanel({
  companyId,
  companyName,
  companyValues,
  companyDefinitions = [],
  onUpdateCompanyField,
  dealValues,
  dealDefinitions = [],
  onUpdateDealField,
  companyDeals,
}: OperationalProjectPanelProps) {
  const [subView, setSubView] = useState<SubView>("departamentos");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [editingDeptsRaw, setEditingDeptsRaw] = useState(false);
  const [editingDeptIdx, setEditingDeptIdx] = useState<number | null>(null);
  const [deptDraftName, setDeptDraftName] = useState("");
  const [deptDraftWorkers, setDeptDraftWorkers] = useState("");
  const [deptDraftProcs, setDeptDraftProcs] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const [savingDeptList, setSavingDeptList] = useState(false);

  const cVals = companyValues ?? {};
  const dVals = dealValues ?? {};

  const deptsText = asText(cVals.departamentos_empresa);
  const procsText = asText(cVals.procedimientos_por_departamento);
  const erpText = asText(cVals.erp_principal);
  const alojamientoText = asText(cVals.alojamiento_erp);
  const crmText = asText(cVals.crm_actual);
  const mailText = asText(cVals.correo_ofimatica);
  const storageText = asText(cVals.almacen_archivos);
  const strictPrivacy = asBool(cVals.privacidad_estricta);
  const onPremiseLan = asBool(cVals.red_local_minipc);

  const dealVolume = asText(dVals.volumen_mensual);
  const dealManualTasks = asText(dVals.tareas_manuales);
  const dealCompleted = asBool(dVals.cuestionario_completado);

  const parsedDepts = useMemo(
    () => parseDepartmentsAndProcedures(deptsText, procsText),
    [deptsText, procsText]
  );

  const companyDefMap = useMemo(
    () => new Map(companyDefinitions.map((d) => [d.key, d])),
    [companyDefinitions]
  );
  const dealDefMap = useMemo(
    () => new Map(dealDefinitions.map((d) => [d.key, d])),
    [dealDefinitions]
  );

  const alojamientoOptions = parseFieldOptions(
    companyDefMap.get("alojamiento_erp")?.options
  );
  const volumenOptions = parseFieldOptions(
    dealDefMap.get("volumen_mensual")?.options
  );

  function startEdit(key: string, current: string) {
    setEditingKey(key);
    setDraftValue(current);
  }

  async function commitCompanyEdit(key: string) {
    const trimmed = draftValue.trim();
    setEditingKey(null);
    if (onUpdateCompanyField) {
      await onUpdateCompanyField(key, trimmed || null);
    }
  }

  async function commitDealEdit(key: string) {
    const trimmed = draftValue.trim();
    setEditingKey(null);
    if (onUpdateDealField) {
      await onUpdateDealField(key, trimmed || null);
    }
  }

  async function persistDepartmentList(nextList: ParsedDepartment[]) {
    if (!onUpdateCompanyField) return;
    setSavingDeptList(true);
    try {
      const { deptsText: nextDepts, procsText: nextProcs } = serializeDepartments(nextList);
      await onUpdateCompanyField("departamentos_empresa", nextDepts);
      await onUpdateCompanyField("procedimientos_por_departamento", nextProcs);
    } finally {
      setSavingDeptList(false);
    }
  }

  function openEditDept(idx: number, dept: ParsedDepartment) {
    setAddingDept(false);
    setEditingDeptIdx(idx);
    setDeptDraftName(dept.name);
    setDeptDraftWorkers(dept.workers ? dept.workers.replace(/\s*trab\.?$/i, "").trim() : "");
    setDeptDraftProcs(dept.procedures ?? "");
  }

  function openAddDept() {
    setEditingDeptIdx(null);
    setAddingDept(true);
    setDeptDraftName("");
    setDeptDraftWorkers("");
    setDeptDraftProcs("");
  }

  async function saveEditedDept(idx: number) {
    const cleanName = deptDraftName.trim();
    if (!cleanName) return;
    const nextList = parsedDepts.map((item, i) =>
      i === idx
        ? {
            name: cleanName,
            workers: normalizeWorkersBadge(deptDraftWorkers),
            procedures: deptDraftProcs.trim() || null,
          }
        : item
    );
    setEditingDeptIdx(null);
    await persistDepartmentList(nextList);
  }

  async function saveNewDept() {
    const cleanName = deptDraftName.trim();
    if (!cleanName) return;
    const nextList = [
      ...parsedDepts,
      {
        name: cleanName,
        workers: normalizeWorkersBadge(deptDraftWorkers),
        procedures: deptDraftProcs.trim() || null,
      },
    ];
    setAddingDept(false);
    await persistDepartmentList(nextList);
  }

  async function removeDeptAt(idx: number) {
    const target = parsedDepts[idx];
    if (!target) return;
    if (!window.confirm(`¿Quitar el departamento "${target.name}"?`)) return;
    if (editingDeptIdx === idx) setEditingDeptIdx(null);
    await persistDepartmentList(parsedDepts.filter((_, i) => i !== idx));
  }

  function renderEditableTextField(
    scope: "company" | "deal",
    key: string,
    label: string,
    value: string,
    multiline = false
  ) {
    const canEdit =
      scope === "company" ? Boolean(onUpdateCompanyField) : Boolean(onUpdateDealField);
    const editId = `${scope}:${key}`;

    if (editingKey === editId) {
      return multiline ? (
        <textarea
          autoFocus
          rows={4}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={() =>
            void (scope === "company"
              ? commitCompanyEdit(key)
              : commitDealEdit(key))
          }
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingKey(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 focus:border-[#1658F5] focus:outline-none"
        />
      ) : (
        <input
          autoFocus
          type="text"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={() =>
            void (scope === "company"
              ? commitCompanyEdit(key)
              : commitDealEdit(key))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingKey(null);
          }}
          className="mt-1 h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-[#1658F5] focus:outline-none"
        />
      );
    }

    return (
      <div className="mt-1 flex items-start justify-between gap-2">
        <p
          className={`min-w-0 flex-1 text-xs leading-relaxed whitespace-pre-wrap break-words ${
            value ? "font-medium text-slate-900" : "text-slate-400"
          }`}
        >
          {value || `Sin ${label.toLowerCase()} definido`}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={() => startEdit(editId, value)}
            title={`Editar ${label}`}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  const hasCompanyProjectData = Boolean(
    deptsText ||
      procsText ||
      erpText ||
      alojamientoText ||
      crmText ||
      mailText ||
      storageText ||
      strictPrivacy !== null ||
      onPremiseLan !== null
  );

  const hasDealProjectData = Boolean(
    dealVolume || dealManualTasks || dealCompleted !== null
  );

  return (
    <div className="space-y-4">
      {/* Cabecera resumen compacta */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#1658F5]" />
            <span className="text-xs font-semibold text-slate-900">
              {companyName ? `Diagnóstico · ${companyName}` : "Diagnóstico Operativo"}
            </span>
            {companyId && (
              <Link
                href={`/companies?id=${companyId}`}
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#1658F5] hover:underline"
              >
                Ver empresa
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {dealCompleted === true && (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Cuestionario recibido
              </Badge>
            )}
            {dealVolume && <Badge variant="brand">{dealVolume}</Badge>}
            {strictPrivacy === true && (
              <Badge variant="warning">
                <Lock className="mr-1 h-3 w-3" />
                IA local estricta
              </Badge>
            )}
            {onPremiseLan === true && (
              <Badge variant="default">
                <Server className="mr-1 h-3 w-3" />
                Red LAN lista
              </Badge>
            )}
          </div>
        </div>

        {/* Métricas rápidas en 3 cajas */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              ERP
            </p>
            <p className="truncate font-semibold text-slate-900">
              {erpText || "Sin definir"}
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Alojamiento
            </p>
            <p className="truncate font-semibold text-slate-900">
              {alojamientoText || "Sin definir"}
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Departamentos
            </p>
            <p className="truncate font-semibold text-slate-900">
              {parsedDepts.length > 0 ? `${parsedDepts.length} áreas` : "Sin definir"}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-navegación dentro de Proyecto para evitar listas largas */}
      <div className="flex flex-wrap gap-1.5 rounded-md bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setSubView("departamentos")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            subView === "departamentos"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-600 hover:text-slate-950"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Departamentos ({parsedDepts.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView("stack")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            subView === "stack"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-600 hover:text-slate-950"
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          Stack y Red
        </button>
        <button
          type="button"
          onClick={() => setSubView("operativa")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            subView === "operativa"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-600 hover:text-slate-950"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Operativa
        </button>
      </div>

      {/* SUB-VISTA 1: DEPARTAMENTOS Y PROCEDIMIENTOS */}
      {subView === "departamentos" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Áreas y procedimientos
            </h4>
            {onUpdateCompanyField && (
              <div className="flex items-center gap-1.5">
                {!editingDeptsRaw && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingDeptList}
                    onClick={openAddDept}
                  >
                    <Plus className="h-3 w-3" />
                    Añadir
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingDeptList}
                  onClick={() => {
                    setEditingDeptIdx(null);
                    setAddingDept(false);
                    setEditingDeptsRaw((v) => !v);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                  {editingDeptsRaw ? "Ver tarjetas" : "Editar texto"}
                </Button>
              </div>
            )}
          </div>

          {!editingDeptsRaw ? (
            <div className="space-y-2">
              {addingDept && (
                <div className="space-y-2 rounded-md border border-[#1658F5]/40 bg-slate-50/70 p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_110px]">
                    <input
                      type="text"
                      placeholder="Nombre del departamento (ej. Logística)"
                      value={deptDraftName}
                      onChange={(e) => setDeptDraftName(e.target.value)}
                      className="h-7 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-[#1658F5] focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Nº trab."
                      value={deptDraftWorkers}
                      onChange={(e) => setDeptDraftWorkers(e.target.value)}
                      className="h-7 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-[#1658F5] focus:outline-none"
                    />
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Procedimientos que realizan..."
                    value={deptDraftProcs}
                    onChange={(e) => setDeptDraftProcs(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 focus:border-[#1658F5] focus:outline-none"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setAddingDept(false)}
                    >
                      <X className="h-3 w-3" />
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingDeptList || !deptDraftName.trim()}
                      onClick={() => void saveNewDept()}
                    >
                      <Check className="h-3 w-3" />
                      Guardar
                    </Button>
                  </div>
                </div>
              )}

              {parsedDepts.length === 0 && !addingDept ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                  Aún no se han registrado departamentos ni procedimientos para{" "}
                  {companyName || "esta empresa"}.
                </div>
              ) : (
                parsedDepts.map((dept, idx) => {
                  const isEditingThis = editingDeptIdx === idx;
                  return (
                    <div
                      key={`${dept.name}-${idx}`}
                      className="rounded-md border border-slate-200 bg-white p-3"
                    >
                      {isEditingThis ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_110px]">
                            <input
                              type="text"
                              value={deptDraftName}
                              onChange={(e) => setDeptDraftName(e.target.value)}
                              className="h-7 rounded border border-slate-300 bg-white px-2 text-xs font-medium text-slate-900 focus:border-[#1658F5] focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="Nº trab."
                              value={deptDraftWorkers}
                              onChange={(e) => setDeptDraftWorkers(e.target.value)}
                              className="h-7 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-[#1658F5] focus:outline-none"
                            />
                          </div>
                          <textarea
                            rows={3}
                            placeholder="Procedimientos que realizan..."
                            value={deptDraftProcs}
                            onChange={(e) => setDeptDraftProcs(e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 focus:border-[#1658F5] focus:outline-none"
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingDeptIdx(null)}
                            >
                              <X className="h-3 w-3" />
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={savingDeptList || !deptDraftName.trim()}
                              onClick={() => void saveEditedDept(idx)}
                            >
                              <Check className="h-3 w-3" />
                              Guardar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {dept.name}
                            </span>
                            <div className="flex items-center gap-1">
                              {dept.workers && (
                                <Badge variant="brand">{dept.workers}</Badge>
                              )}
                              {onUpdateCompanyField && (
                                <>
                                  <button
                                    type="button"
                                    disabled={savingDeptList}
                                    onClick={() => openEditDept(idx, dept)}
                                    title="Editar departamento"
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingDeptList}
                                    onClick={() => void removeDeptAt(idx)}
                                    title="Quitar departamento"
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <p
                            className={`mt-1.5 text-xs leading-relaxed whitespace-pre-wrap ${
                              dept.procedures
                                ? "text-slate-600"
                                : "italic text-slate-400"
                            }`}
                          >
                            {dept.procedures || "Sin procedimientos especificados"}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Departamentos y equipo
                </span>
                {renderEditableTextField(
                  "company",
                  "departamentos_empresa",
                  "Departamentos",
                  deptsText,
                  true
                )}
              </div>
              <div className="border-t border-slate-100 pt-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Procedimientos por departamento
                </span>
                {renderEditableTextField(
                  "company",
                  "procedimientos_por_departamento",
                  "Procedimientos por departamento",
                  procsText,
                  true
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-VISTA 2: STACK Y SEGURIDAD */}
      {subView === "stack" && (
        <div className="space-y-3">
          {!hasCompanyProjectData && !onUpdateCompanyField ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
              No hay datos de infraestructura tecnológica registrados todavía.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  ERP principal
                </span>
                {renderEditableTextField("company", "erp_principal", "ERP", erpText)}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Alojamiento del ERP
                </span>
                {onUpdateCompanyField ? (
                  <select
                    value={alojamientoText}
                    onChange={(e) =>
                      void onUpdateCompanyField(
                        "alojamiento_erp",
                        e.target.value || null
                      )
                    }
                    className="mt-1.5 h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 focus:border-[#1658F5] focus:outline-none"
                  >
                    <option value="">Sin definir</option>
                    {alojamientoOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-xs font-medium text-slate-900">
                    {alojamientoText || "Sin definir"}
                  </p>
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  CRM comercial actual
                </span>
                {renderEditableTextField("company", "crm_actual", "CRM", crmText)}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Correo / Ofimática
                </span>
                {renderEditableTextField(
                  "company",
                  "correo_ofimatica",
                  "Correo / Ofimática",
                  mailText
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3 sm:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Almacén de archivos
                </span>
                {renderEditableTextField(
                  "company",
                  "almacen_archivos",
                  "Almacén de archivos",
                  storageText
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                    Privacidad IA local
                  </span>
                  {onUpdateCompanyField ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateCompanyField(
                          "privacidad_estricta",
                          !(strictPrivacy === true)
                        )
                      }
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        strictPrivacy === true
                          ? "bg-amber-100 text-amber-800"
                          : strictPrivacy === false
                            ? "bg-slate-100 text-slate-600"
                            : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {strictPrivacy === null
                        ? "Sin definir"
                        : strictPrivacy
                          ? "Sí, crítica"
                          : "No estricta"}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-slate-900">
                      {strictPrivacy === null
                        ? "Sin definir"
                        : strictPrivacy
                          ? "Sí, crítica"
                          : "No estricta"}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Server className="h-3.5 w-3.5 text-slate-400" />
                    Red LAN (Mini PC)
                  </span>
                  {onUpdateCompanyField ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateCompanyField(
                          "red_local_minipc",
                          !(onPremiseLan === true)
                        )
                      }
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        onPremiseLan === true
                          ? "bg-emerald-100 text-emerald-800"
                          : onPremiseLan === false
                            ? "bg-slate-100 text-slate-600"
                            : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {onPremiseLan === null
                        ? "Sin definir"
                        : onPremiseLan
                          ? "Sí, disponible"
                          : "Revisar con IT"}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-slate-900">
                      {onPremiseLan === null
                        ? "Sin definir"
                        : onPremiseLan
                          ? "Sí, disponible"
                          : "Revisar con IT"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-VISTA 3: OPERATIVA Y PROYECTOS */}
      {subView === "operativa" && (
        <div className="space-y-3">
          {dealValues !== undefined && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Volumen mensual (docs)
                  </span>
                  {onUpdateDealField ? (
                    <select
                      value={dealVolume}
                      onChange={(e) =>
                        void onUpdateDealField(
                          "volumen_mensual",
                          e.target.value || null
                        )
                      }
                      className="mt-1.5 h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 focus:border-[#1658F5] focus:outline-none"
                    >
                      <option value="">Sin definir</option>
                      {volumenOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-slate-900">
                      {dealVolume || "Sin definir"}
                    </p>
                  )}
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Estado del cuestionario
                  </span>
                  <div className="mt-1.5">
                    {onUpdateDealField ? (
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateDealField(
                            "cuestionario_completado",
                            !(dealCompleted === true)
                          )
                        }
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          dealCompleted === true
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {dealCompleted === true ? "Completado" : "Pendiente"}
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-slate-900">
                        {dealCompleted === true ? "Completado" : "Pendiente"}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Tareas manuales / Puntos de dolor
                </span>
                {renderEditableTextField(
                  "deal",
                  "tareas_manuales",
                  "Tareas manuales",
                  dealManualTasks,
                  true
                )}
              </div>

              {!hasDealProjectData && !onUpdateDealField && (
                <p className="text-xs text-slate-400">
                  Sin datos operativos registrados en este negocio.
                </p>
              )}
            </div>
          )}

          {/* Lista detallada de proyectos/negocios cuando estamos dentro de una Empresa */}
          {companyDeals && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Building2 className="h-3.5 w-3.5" />
                  Proyectos / Negocios ({companyDeals.length})
                </h4>
                <Link
                  href="/pipelines"
                  className="text-xs font-medium text-[#1658F5] hover:underline"
                >
                  Ir a Pipelines →
                </Link>
              </div>
              {companyDeals.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                  Esta empresa aún no tiene negocios o proyectos asociados.
                </div>
              ) : (
                <div className="space-y-2">
                  {companyDeals.map((d) => {
                    const vol = asText(d.custom_fields?.volumen_mensual);
                    const tasks = asText(d.custom_fields?.tareas_manuales);
                    return (
                      <Link
                        key={d.id}
                        href={`/pipelines?deal=${d.id}`}
                        className="block rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-[#1658F5]/50 hover:bg-slate-50/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1 truncate text-xs font-semibold text-slate-900">
                              <span className="truncate">{d.title}</span>
                              <ArrowUpRight className="h-3 w-3 shrink-0 text-[#1658F5]" />
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {d.stage_name && (
                                <Badge variant="default">{d.stage_name}</Badge>
                              )}
                              <Badge
                                variant={
                                  d.status === "won"
                                    ? "success"
                                    : d.status === "lost"
                                      ? "destructive"
                                      : "brand"
                                }
                              >
                                {d.status === "won"
                                  ? "Ganado"
                                  : d.status === "lost"
                                    ? "Perdido"
                                    : "Abierto"}
                              </Badge>
                              {vol && <Badge variant="default">{vol}</Badge>}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-slate-900">
                            {formatCurrencyEUR(d.amount)}
                          </span>
                        </div>
                        {tasks && (
                          <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed whitespace-pre-wrap text-slate-600">
                            {tasks}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
