"use client";

import React, { useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Archive, Check, GripVertical, Pencil, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  archiveStageWithMigrationAction,
  createPipelineAction,
  createStageAction,
  reorderStagesAction,
  updatePipelineAction,
  updateStageAction,
} from "@/app/(crm)/actions/settings";
import type { PipelineRow, StageRow } from "@/lib/crm/deals";

interface PipelineBuilderProps {
  initialPipelines: PipelineRow[];
  initialStages: StageRow[];
}

export function PipelineBuilder({
  initialPipelines,
  initialStages,
}: PipelineBuilderProps) {
  const [pipelines, setPipelines] = useState<PipelineRow[]>(initialPipelines);
  const [stages, setStages] = useState<StageRow[]>(initialStages);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    initialPipelines.find((p) => p.is_default)?.id ?? initialPipelines[0]?.id ?? ""
  );

  // New pipeline form
  const [newPipeName, setNewPipeName] = useState("");
  const [newPipeStale, setNewPipeStale] = useState("7");
  const [creatingPipe, setCreatingPipe] = useState(false);

  // New stage form
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState("#3b82f6");
  const [stageProb, setStageProb] = useState("25");
  const [stageStaleOverride, setStageStaleOverride] = useState("");
  const [stageWon, setStageWon] = useState(false);
  const [stageLost, setStageLost] = useState(false);
  const [creatingStage, setCreatingStage] = useState(false);

  // Edit stage form
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editStageName, setEditStageName] = useState("");
  const [editStageColor, setEditStageColor] = useState("#3b82f6");
  const [editStageProb, setEditStageProb] = useState("0");
  const [editStageStaleOverride, setEditStageStaleOverride] = useState("");
  const [editStageWon, setEditStageWon] = useState(false);
  const [editStageLost, setEditStageLost] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // Migration modal
  const [migrationPrompt, setMigrationPrompt] = useState<{
    stage: StageRow;
    dealCount: number;
    targetStageId: string;
  } | null>(null);

  const activePipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId]
  );

  const activeStages = useMemo(
    () =>
      stages
        .filter((s) => s.pipeline_id === selectedPipelineId && s.is_active)
        .sort((a, b) => a.stage_order - b.stage_order),
    [stages, selectedPipelineId]
  );

  async function handleCreatePipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!newPipeName.trim()) return;
    setCreatingPipe(true);
    try {
      const res = await createPipelineAction({
        name: newPipeName,
        stale_days_default: Number(newPipeStale) || 7,
        is_default: pipelines.length === 0,
      });
      if (res.data) {
        setPipelines((prev) => [...prev, res.data.pipeline]);
        setStages((prev) => [...prev, ...res.data.stages]);
        setSelectedPipelineId(res.data.pipeline.id);
        setNewPipeName("");
      }
    } finally {
      setCreatingPipe(false);
    }
  }

  async function handleCreateStage(e: React.FormEvent) {
    e.preventDefault();
    if (!activePipeline || !stageName.trim()) return;
    setCreatingStage(true);
    try {
      const res = await createStageAction({
        pipeline_id: activePipeline.id,
        name: stageName,
        color_code: stageColor,
        probability: Number(stageProb) || 0,
        stale_days_override: stageStaleOverride ? Number(stageStaleOverride) : null,
        is_won_stage: stageWon,
        is_lost_stage: stageLost,
      });
      if (res.data) {
        setStages((prev) => [...prev, res.data]);
        setStageName("");
        setStageStaleOverride("");
        setStageWon(false);
        setStageLost(false);
      }
    } finally {
      setCreatingStage(false);
    }
  }

  async function handleReorder(result: DropResult) {
    if (!result.destination || !activePipeline) return;
    if (result.destination.index === result.source.index) return;

    const list = [...activeStages];
    const [moved] = list.splice(result.source.index, 1);
    list.splice(result.destination.index, 0, moved);

    const updatedOrders = new Map(list.map((s, idx) => [s.id, idx + 1]));
    setStages((prev) =>
      prev.map((s) =>
        updatedOrders.has(s.id) ? { ...s, stage_order: updatedOrders.get(s.id)! } : s
      )
    );

    await reorderStagesAction(
      activePipeline.id,
      list.map((s) => s.id)
    );
  }

  async function handleArchiveStage(stage: StageRow) {
    setStageError(null);
    const res = await archiveStageWithMigrationAction({ stageId: stage.id });
    if ("requiresMigration" in res && res.requiresMigration) {
      const fallbackTarget = activeStages.find((s) => s.id !== stage.id);
      setMigrationPrompt({
        stage,
        dealCount: res.dealCount,
        targetStageId: fallbackTarget?.id ?? "",
      });
      return;
    }

    if ("data" in res && res.data) {
      setStages((prev) => prev.map((s) => (s.id === stage.id ? res.data! : s)));
      if (editingStageId === stage.id) {
        setEditingStageId(null);
      }
    }
  }

  function startEditingStage(stage: StageRow) {
    setStageError(null);
    setEditingStageId(stage.id);
    setEditStageName(stage.name);
    setEditStageColor(stage.color_code);
    setEditStageProb(String(stage.probability));
    setEditStageStaleOverride(
      stage.stale_days_override !== null ? String(stage.stale_days_override) : ""
    );
    setEditStageWon(stage.is_won_stage);
    setEditStageLost(stage.is_lost_stage);
  }

  async function handleSaveStage(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStageId || !editStageName.trim()) return;
    setSavingStage(true);
    setStageError(null);
    try {
      const res = await updateStageAction(editingStageId, {
        name: editStageName.trim(),
        color_code: editStageColor,
        probability: Number(editStageProb) || 0,
        stale_days_override: editStageStaleOverride.trim()
          ? Number(editStageStaleOverride)
          : null,
        is_won_stage: editStageWon,
        is_lost_stage: editStageLost,
      });

      if (res.error) {
        setStageError(res.error);
        return;
      }

      if (res.data) {
        setStages((prev) => prev.map((s) => (s.id === res.data!.id ? res.data! : s)));
        setEditingStageId(null);
      }
    } finally {
      setSavingStage(false);
    }
  }

  async function confirmMigration(e: React.FormEvent) {
    e.preventDefault();
    if (!migrationPrompt || !migrationPrompt.targetStageId) return;

    const res = await archiveStageWithMigrationAction({
      stageId: migrationPrompt.stage.id,
      migrateToStageId: migrationPrompt.targetStageId,
    });

    if ("data" in res && res.data) {
      setStages((prev) =>
        prev.map((s) => (s.id === migrationPrompt.stage.id ? res.data! : s))
      );
      setMigrationPrompt(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Create & Select Pipeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-950">Pipelines activos</h2>
          <div className="space-y-2">
            {pipelines
              .filter((p) => p.is_active)
              .map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-xs transition-colors ${
                    p.id === selectedPipelineId
                      ? "border-slate-950 bg-slate-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{p.name}</span>
                    {p.is_default && <Badge variant="dark">Por defecto</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <span>Estancado: {p.stale_days_default}d</span>
                    {!p.is_default && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void updatePipelineAction(p.id, { is_default: true }).then(
                            (r) => {
                              if (r.data) {
                                setPipelines((prev) =>
                                  prev.map((row) => ({
                                    ...row,
                                    is_default: row.id === p.id,
                                  }))
                                );
                              }
                            }
                          );
                        }}
                        title="Marcar por defecto"
                        className="rounded p-1 hover:bg-slate-200"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>

        <form
          onSubmit={handleCreatePipeline}
          className="rounded-lg border border-slate-200 bg-white p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-950">Crear nuevo pipeline</h2>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Input
              required
              placeholder="Ej. Outbound Enterprise"
              value={newPipeName}
              onChange={(e) => setNewPipeName(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              title="Días de estancamiento por defecto"
              value={newPipeStale}
              onChange={(e) => setNewPipeStale(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={creatingPipe}>
            <Plus className="h-3.5 w-3.5" />
            {creatingPipe ? "Creando..." : "Crear pipeline"}
          </Button>
        </form>
      </div>

      {/* Stage Editor */}
      {activePipeline && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                Etapas de &ldquo;{activePipeline.name}&rdquo;
              </h3>
              <p className="text-xs text-slate-500">
                Arrastra para reordenar. El archivado es lógico (is_active = FALSE) y
                migra negocios si hay deals activos.
              </p>
            </div>
          </div>

          <DragDropContext onDragEnd={(r) => void handleReorder(r)}>
            <Droppable droppableId="pipeline-stages-builder">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="space-y-2"
                >
                  {activeStages.map((stage, index) => {
                    const isEditing = editingStageId === stage.id;
                    return (
                      <Draggable key={stage.id} draggableId={stage.id} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs"
                          >
                            {isEditing ? (
                              <form onSubmit={handleSaveStage} className="space-y-2.5">
                                <div className="grid gap-2 sm:grid-cols-[24px_1fr_64px_86px_104px_auto]">
                                  <span
                                    {...dragProvided.dragHandleProps}
                                    className="flex cursor-grab items-center justify-center text-slate-400 hover:text-slate-700"
                                  >
                                    <GripVertical className="h-4 w-4" />
                                  </span>
                                  <Input
                                    required
                                    placeholder="Nombre de la etapa"
                                    value={editStageName}
                                    onChange={(e) => setEditStageName(e.target.value)}
                                  />
                                  <Input
                                    type="color"
                                    value={editStageColor}
                                    onChange={(e) => setEditStageColor(e.target.value)}
                                    className="p-1"
                                  />
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    placeholder="% Prob"
                                    title="Probabilidad (%)"
                                    value={editStageProb}
                                    onChange={(e) => setEditStageProb(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    min="1"
                                    placeholder="Días est."
                                    title="Días de estancamiento (vacío = usar defecto del pipeline)"
                                    value={editStageStaleOverride}
                                    onChange={(e) =>
                                      setEditStageStaleOverride(e.target.value)
                                    }
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      type="submit"
                                      size="sm"
                                      disabled={savingStage}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      {savingStage ? "Guardando..." : "Guardar"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setEditingStageId(null)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-4 pl-8 text-xs text-[#334155]">
                                  <label className="flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={editStageWon}
                                      onChange={(e) => {
                                        setEditStageWon(e.target.checked);
                                        if (e.target.checked) setEditStageLost(false);
                                      }}
                                    />
                                    Etapa de cierre ganado
                                  </label>
                                  <label className="flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={editStageLost}
                                      onChange={(e) => {
                                        setEditStageLost(e.target.checked);
                                        if (e.target.checked) setEditStageWon(false);
                                      }}
                                    />
                                    Etapa de cierre perdido
                                  </label>
                                </div>
                              </form>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <span
                                    {...dragProvided.dragHandleProps}
                                    className="cursor-grab text-slate-400 hover:text-slate-700"
                                  >
                                    <GripVertical className="h-4 w-4" />
                                  </span>
                                  <input
                                    type="color"
                                    value={stage.color_code}
                                    onChange={(e) => {
                                      const color = e.target.value;
                                      setStages((prev) =>
                                        prev.map((s) =>
                                          s.id === stage.id
                                            ? { ...s, color_code: color }
                                            : s
                                        )
                                      );
                                      void updateStageAction(stage.id, {
                                        color_code: color,
                                      });
                                    }}
                                    className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                                  />
                                  <span className="font-semibold text-[#0F172A]">
                                    {stage.name}
                                  </span>
                                  <Badge>{stage.probability}%</Badge>
                                  {stage.stale_days_override !== null && (
                                    <Badge variant="warning">
                                      {stage.stale_days_override}d estanc.
                                    </Badge>
                                  )}
                                  {stage.is_won_stage && (
                                    <Badge variant="success">Ganado</Badge>
                                  )}
                                  {stage.is_lost_stage && (
                                    <Badge variant="destructive">Perdido</Badge>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => startEditingStage(stage)}
                                    title="Editar etapa"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Editar
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={activeStages.length <= 1}
                                    onClick={() => void handleArchiveStage(stage)}
                                    title="Archivar etapa"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                    Archivar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {stageError && (
            <div className="rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] p-3 text-xs text-red-700">
              {stageError}
            </div>
          )}

          {/* Add stage */}
          <form
            onSubmit={handleCreateStage}
            className="grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_70px_90px_110px_auto]"
          >
            <Input
              required
              placeholder="Nueva etapa (ej. Cualificación)"
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
            />
            <Input
              type="color"
              value={stageColor}
              onChange={(e) => setStageColor(e.target.value)}
              className="p-1"
            />
            <Input
              type="number"
              min="0"
              max="100"
              placeholder="% Prob"
              value={stageProb}
              onChange={(e) => setStageProb(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              placeholder="Días estanc."
              value={stageStaleOverride}
              onChange={(e) => setStageStaleOverride(e.target.value)}
            />
            <Button type="submit" disabled={creatingStage}>
              <Plus className="h-3.5 w-3.5" />
              Añadir etapa
            </Button>
          </form>

          <div className="flex items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={stageWon}
                onChange={(e) => {
                  setStageWon(e.target.checked);
                  if (e.target.checked) setStageLost(false);
                }}
              />
              Etapa de cierre ganado
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={stageLost}
                onChange={(e) => {
                  setStageLost(e.target.checked);
                  if (e.target.checked) setStageWon(false);
                }}
              />
              Etapa de cierre perdido
            </label>
          </div>
        </div>
      )}

      {/* Migration Modal */}
      {migrationPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]">
          <form
            onSubmit={confirmMigration}
            className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Migrar negocios antes de archivar
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                La etapa <strong>{migrationPrompt.stage.name}</strong> tiene{" "}
                <strong>{migrationPrompt.dealCount}</strong> negocios asignados. Elige la
                etapa destino antes de archivarla.
              </p>
            </div>

            <select
              required
              value={migrationPrompt.targetStageId}
              onChange={(e) =>
                setMigrationPrompt({ ...migrationPrompt, targetStageId: e.target.value })
              }
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
            >
              {activeStages
                .filter((s) => s.id !== migrationPrompt.stage.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMigrationPrompt(null)}
              >
                Cancelar
              </Button>
              <Button type="submit">Migrar y archivar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

