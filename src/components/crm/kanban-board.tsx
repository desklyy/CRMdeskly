"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { AlertTriangle, Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DealSlideOver } from "@/components/crm/deal-slide-over";
import { NewPropertyModal } from "@/components/crm/new-property-modal";
import { useRealtime } from "@/components/providers/realtime-provider";
import { formatCurrencyEUR, type CustomFieldDefinition } from "@/lib/crm/custom-fields";
import {
  computeFractionalPosition,
  isDealStale,
  LOST_REASONS,
  PRIORITY_META,
  type DealRow,
  type PipelineRow,
  type StageRow,
} from "@/lib/crm/deals";
import { createDealAction, moveDealAction } from "@/app/(crm)/actions/deals-and-quotes";
import type { Database, UserRole } from "@/types/database";

type CompanySlim = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type ContactSlim = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "first_name" | "last_name" | "email" | "company_id"
>;
type ProfileSlim = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "avatar_initials" | "role" | "email"
>;

interface KanbanBoardProps {
  pipelines: PipelineRow[];
  stages: StageRow[];
  initialDeals: DealRow[];
  companies: CompanySlim[];
  contacts: ContactSlim[];
  profiles: ProfileSlim[];
  initialDefinitions: CustomFieldDefinition[];
  currentUserRole: UserRole;
}

export function KanbanBoard({
  pipelines,
  stages,
  initialDeals,
  companies,
  contacts,
  profiles,
  initialDefinitions,
  currentUserRole,
}: KanbanBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { subscribe } = useRealtime();
  const isDraggingRef = useRef(false);

  const defaultPipeline =
    pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null;

  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    defaultPipeline?.id ?? ""
  );
  const [deals, setDeals] = useState<DealRow[]>(initialDeals);
  const [definitions, setDefinitions] =
    useState<CustomFieldDefinition[]>(initialDefinitions);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(
    searchParams.get("deal")
  );
  const [onlyQuestionnaire, setOnlyQuestionnaire] = useState(false);
  const [newPropOpen, setNewPropOpen] = useState(false);

  // Quick create deal modal
  const [newDealOpen, setNewDealOpen] = useState(searchParams.get("new") === "1");
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("0");
  const [newCompanyId, setNewCompanyId] = useState("");
  const [newContactId, setNewContactId] = useState("");
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Lost reason prompt on drop into is_lost_stage
  const [pendingLostMove, setPendingLostMove] = useState<{
    dealId: string;
    targetStageId: string;
    position: number;
    prevDeals: DealRow[];
  } | null>(null);
  const [lostReasonChoice, setLostReasonChoice] = useState<string>(LOST_REASONS[0]);

  useEffect(() => {
    const dealParam = searchParams.get("deal");
    if (dealParam) {
      setSelectedDealId(dealParam);
      const targetDeal = deals.find((d) => d.id === dealParam);
      if (targetDeal) setSelectedPipelineId(targetDeal.pipeline_id);
    }
    if (searchParams.get("new") === "1") {
      setNewDealOpen(true);
    }
  }, [searchParams, deals]);

  useEffect(() => {
    const unsubDeals = subscribe("deals", (payload) => {
      if (isDraggingRef.current) return;

      if (payload.eventType === "DELETE") {
        const oldRow = payload.old as { id?: string } | undefined;
        if (oldRow?.id) {
          setDeals((prev) => prev.filter((d) => d.id !== oldRow.id));
        }
        return;
      }

      const row = payload.new as DealRow | undefined;
      if (!row?.id) return;

      setDeals((prev) => {
        const exists = prev.some((d) => d.id === row.id);
        return exists
          ? prev.map((d) => (d.id === row.id ? row : d))
          : [...prev, row];
      });
    });

    const unsubDefs = subscribe("custom_field_definitions", (payload) => {
      const record = (payload.new ?? payload.old) as CustomFieldDefinition | undefined;
      if (!record || record.entity_type !== "deal") return;

      if (payload.eventType === "DELETE") {
        setDefinitions((prev) => prev.filter((d) => d.id !== record.id));
        return;
      }

      setDefinitions((prev) => {
        const exists = prev.some((d) => d.id === record.id);
        if (!exists) return record.is_active ? [...prev, record] : prev;
        return prev
          .map((d) => (d.id === record.id ? record : d))
          .filter((d) => d.is_active);
      });
    });

    return () => {
      unsubDeals();
      unsubDefs();
    };
  }, [subscribe]);

  const activePipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) ?? defaultPipeline,
    [pipelines, selectedPipelineId, defaultPipeline]
  );

  const pipelineStages = useMemo(
    () =>
      stages
        .filter((s) => s.pipeline_id === activePipeline?.id && s.is_active)
        .sort((a, b) => a.stage_order - b.stage_order),
    [stages, activePipeline]
  );

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies]
  );
  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, DealRow[]>();
    for (const s of pipelineStages) map.set(s.id, []);

    for (const d of deals) {
      if (d.pipeline_id !== activePipeline?.id) continue;
      if (
        onlyQuestionnaire &&
        d.custom_fields?.cuestionario_completado !== true
      ) {
        continue;
      }
      const col = map.get(d.stage_id);
      if (col) col.push(d);
    }

    for (const [, list] of map) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [deals, pipelineStages, activePipeline, onlyQuestionnaire]);

  const selectedDeal = useMemo(
    () => deals.find((d) => d.id === selectedDealId) ?? null,
    [deals, selectedDealId]
  );

  function openDeal(id: string) {
    setSelectedDealId(id);
    router.replace(`/pipelines?deal=${id}`, { scroll: false });
  }

  function closeDeal() {
    setSelectedDealId(null);
    router.replace("/pipelines", { scroll: false });
  }

  async function handleDragEnd(result: DropResult) {
    isDraggingRef.current = false;
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const destList = [...(dealsByStage.get(destination.droppableId) ?? [])].filter(
      (d) => d.id !== draggableId
    );
    const prevCard = destination.index > 0 ? destList[destination.index - 1] : null;
    const nextCard =
      destination.index < destList.length ? destList[destination.index] : null;

    const newPos = computeFractionalPosition(
      prevCard?.position ?? null,
      nextCard?.position ?? null
    );

    const targetStage = pipelineStages.find((s) => s.id === destination.droppableId);
    if (!targetStage) return;

    const prevDealsSnapshot = deals;
    const now = new Date().toISOString();
    const nextStatus: DealRow["status"] = targetStage.is_won_stage
      ? "won"
      : targetStage.is_lost_stage
        ? "lost"
        : "open";

    setDeals((prev) =>
      prev.map((d) =>
        d.id === draggableId
          ? {
              ...d,
              stage_id: targetStage.id,
              position: newPos,
              status: nextStatus,
              last_activity_at: now,
              ...(d.stage_id !== targetStage.id ? { stage_changed_at: now } : {}),
            }
          : d
      )
    );

    if (targetStage.is_lost_stage && destination.droppableId !== source.droppableId) {
      setLostReasonChoice(LOST_REASONS[0]);
      setPendingLostMove({
        dealId: draggableId,
        targetStageId: targetStage.id,
        position: newPos,
        prevDeals: prevDealsSnapshot,
      });
      return;
    }

    const res = await moveDealAction({
      dealId: draggableId,
      targetStageId: targetStage.id,
      position: newPos,
    });

    if (res.data) {
      setDeals((prev) => prev.map((d) => (d.id === res.data.id ? res.data : d)));
    } else {
      setDeals(prevDealsSnapshot);
    }
  }

  async function confirmLostMove(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingLostMove) return;

    const res = await moveDealAction({
      dealId: pendingLostMove.dealId,
      targetStageId: pendingLostMove.targetStageId,
      position: pendingLostMove.position,
      lostReason: lostReasonChoice,
    });

    if (res.data) {
      setDeals((prev) => prev.map((d) => (d.id === res.data.id ? res.data : d)));
    } else {
      setDeals(pendingLostMove.prevDeals);
    }
    setPendingLostMove(null);
  }

  async function handleCreateDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!activePipeline || pipelineStages.length === 0) return;
    setCreateError(null);
    setCreatingDeal(true);
    try {
      const firstStage =
        pipelineStages.find((s) => !s.is_won_stage && !s.is_lost_stage) ??
        pipelineStages[0];

      const res = await createDealAction({
        title: newTitle,
        amount: Number(newAmount) || 0,
        pipeline_id: activePipeline.id,
        stage_id: firstStage.id,
        company_id: newCompanyId || null,
        primary_contact_id: newContactId || null,
      });

      if (res.error || !res.data) {
        setCreateError(res.error ?? "No se pudo crear el negocio.");
        return;
      }

      setDeals((prev) => [...prev, res.data]);
      setNewTitle("");
      setNewAmount("0");
      setNewCompanyId("");
      setNewContactId("");
      setNewDealOpen(false);
      openDeal(res.data.id);
    } finally {
      setCreatingDeal(false);
    }
  }

  if (!activePipeline) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No hay ningún pipeline activo configurado todavía. Ejecuta la migración{" "}
        <code className="font-mono">0002_auth_triggers_and_seed.sql</code> en Supabase
        para crear el embudo inicial.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Pipelines
          </h1>
          <select
            value={activePipeline.id}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 focus:outline-none"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOnlyQuestionnaire((v) => !v)}
            className={`h-8 rounded-[4px] border px-2.5 text-xs font-semibold transition-colors ${
              onlyQuestionnaire
                ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {onlyQuestionnaire ? "Cuestionario ✓ (activo)" : "Solo con cuestionario"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setNewPropOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            + Nueva propiedad
          </Button>
          <Button type="button" size="sm" onClick={() => setNewDealOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo negocio
          </Button>
        </div>
      </div>

      {/* Kanban Columns */}
      <DragDropContext
        onDragStart={() => {
          isDraggingRef.current = true;
        }}
        onDragEnd={(res) => void handleDragEnd(res)}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {pipelineStages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            const totalSum = stageDeals.reduce((acc, d) => acc + Number(d.amount || 0), 0);

            return (
              <div
                key={stage.id}
                className="flex w-72 shrink-0 flex-col rounded-lg border border-slate-200 bg-slate-100/70"
              >
                {/* Stage Header */}
                <div className="border-b border-slate-200 bg-white px-3 py-2.5 rounded-t-lg">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color_code }}
                      />
                      <h2 className="truncate text-xs font-semibold text-slate-900">
                        {stage.name}
                      </h2>
                    </div>
                    <Badge>{stageDeals.length}</Badge>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    {formatCurrencyEUR(totalSum)}
                  </p>
                </div>

                {/* Droppable list */}
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${
                        snapshot.isDraggingOver ? "bg-slate-200/60" : ""
                      }`}
                    >
                      {stageDeals.map((deal, idx) => {
                        const companyName = deal.company_id
                          ? companyMap.get(deal.company_id)
                          : null;
                        const owner = deal.owner_id ? profileMap.get(deal.owner_id) : null;
                        const prio = PRIORITY_META[deal.priority];
                        const staleInfo = isDealStale(deal, stage, activePipeline);

                        return (
                          <Draggable key={deal.id} draggableId={deal.id} index={idx}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                onClick={() => openDeal(deal.id)}
                                className={`cursor-pointer rounded-[4px] border bg-white p-3.5 transition-colors ${
                                  dragSnapshot.isDragging
                                    ? "border-[#1658F5]"
                                    : "border-[#E2E8F0] hover:border-[#1658F5]/50"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium leading-snug text-slate-950">
                                    {deal.title}
                                  </p>
                                  {staleInfo.stale && (
                                    <span
                                      title={`Atascado (${staleInfo.daysIdle} días sin cambios; umbral ${staleInfo.thresholdDays}d)`}
                                      className="shrink-0 text-amber-500"
                                    >
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    </span>
                                  )}
                                </div>

                                {companyName && (
                                  <p className="mt-1 truncate text-xs text-slate-500">
                                    {companyName}
                                  </p>
                                )}

                                {(deal.custom_fields?.cuestionario_completado === true ||
                                  deal.next_action) && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                    {deal.custom_fields?.cuestionario_completado ===
                                      true && (
                                      <Badge
                                        variant="success"
                                        className="text-[10px]"
                                      >
                                        Cuestionario ✓
                                      </Badge>
                                    )}
                                    {deal.next_action && (
                                      <span className="truncate text-[10px] font-medium text-slate-500">
                                        Próx.: {deal.next_action}
                                      </span>
                                    )}
                                  </div>
                                )}

                                <div className="mt-2.5 flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-emerald-700">
                                    {formatCurrencyEUR(deal.amount)}
                                  </span>

                                  <div className="flex items-center gap-1.5">
                                    <Badge variant={prio.variant} className="text-[10px]">
                                      {prio.label}
                                    </Badge>
                                    {owner && (
                                      <span
                                        title={owner.full_name}
                                        className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white"
                                      >
                                        {owner.avatar_initials}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {/* New Deal Modal */}
      {newDealOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
          onClick={() => setNewDealOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[4px] border border-[#E2E8F0] bg-white p-[30px]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">Nuevo negocio</h2>
              <button
                type="button"
                onClick={() => setNewDealOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateDeal} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Título *</label>
                <Input
                  required
                  autoFocus
                  placeholder="Ej. Implementación CRM Acme"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Importe estimado (€)
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Empresa</label>
                <select
                  value={newCompanyId}
                  onChange={(e) => setNewCompanyId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                >
                  <option value="">Sin empresa</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Contacto principal
                </label>
                <select
                  value={newContactId}
                  onChange={(e) => setNewContactId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                >
                  <option value="">Sin contacto</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewDealOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={creatingDeal}>
                  {creatingDeal ? "Creando..." : "Crear negocio"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lost Reason Modal */}
      {pendingLostMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]">
          <form
            onSubmit={confirmLostMove}
            className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Motivo de pérdida
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Selecciona un motivo estructurado antes de cerrar el negocio.
              </p>
            </div>

            <select
              value={lostReasonChoice}
              onChange={(e) => setLostReasonChoice(e.target.value)}
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
            >
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeals(pendingLostMove.prevDeals);
                  setPendingLostMove(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit">Confirmar cierre</Button>
            </div>
          </form>
        </div>
      )}

      {/* Deal 360 Slide-over */}
      <DealSlideOver
        deal={selectedDeal}
        onClose={closeDeal}
        stages={pipelineStages}
        companies={companies}
        contacts={contacts}
        profiles={profiles}
        definitions={definitions}
        currentUserRole={currentUserRole}
        onDealUpdated={(updated) =>
          setDeals((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
        }
        onDealDeleted={(id) => setDeals((prev) => prev.filter((d) => d.id !== id))}
        onDefinitionCreated={(def) =>
          setDefinitions((prev) =>
            prev.some((d) => d.id === def.id) ? prev : [...prev, def]
          )
        }
        onDefinitionUpdated={(def) =>
          setDefinitions((prev) => prev.map((d) => (d.id === def.id ? def : d)))
        }
      />

      {/* New Deal Property Modal */}
      <NewPropertyModal
        open={newPropOpen}
        onClose={() => setNewPropOpen(false)}
        entityType="deal"
        onCreated={(def) =>
          setDefinitions((prev) =>
            prev.some((d) => d.id === def.id) ? prev : [...prev, def]
          )
        }
      />
    </div>
  );
}

