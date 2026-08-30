"use client";

import { useMemo, useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, PipelineStage } from "@/types";
import type { DealStageSuggestion } from "@/types/pipeline-intelligence";
import {
  listPendingStageSuggestions,
  applyStageSuggestion,
  dismissStageSuggestion,
} from "@/lib/pipelines/intelligence-repository";
import { createClient } from "@/lib/supabase/client";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
}: PipelineBoardProps) {
  const { accountId, defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DealStageSuggestion[]>([]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  // Mobile selected stage index
  const [mobileStageIndex, setMobileStageIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;
    if (!accountId || deals.length === 0) {
      return;
    }
    const supabase = createClient();
    listPendingStageSuggestions(supabase, accountId)
      .then((data) => {
        if (isMounted) setSuggestions(data);
      })
      .catch((err) => {
        console.error("Failed to load stage suggestions:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [accountId, deals.length]);

  const suggestionsByDealId = useMemo(() => {
    const map = new Map<string, DealStageSuggestion>();
    for (const s of suggestions) {
      map.set(s.deal_id, s);
    }
    return map;
  }, [suggestions]);

  const handleApplySuggestion = async (suggestion: DealStageSuggestion) => {
    if (!accountId) return;
    const supabase = createClient();
    try {
      await applyStageSuggestion(supabase, accountId, suggestion.id);
      onDealMoved(suggestion.deal_id, suggestion.suggested_stage_id);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      toast.success(
        `Negócio avançado para ${suggestion.suggested_stage?.name || "nova etapa"}!`
      );
    } catch (err) {
      console.error("Failed to apply stage suggestion:", err);
      toast.error("Erro ao aplicar sugestão de etapa.");
    }
  };

  const handleDismissSuggestion = async (suggestion: DealStageSuggestion) => {
    if (!accountId) return;
    const supabase = createClient();
    try {
      await dismissStageSuggestion(supabase, accountId, suggestion.id);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      toast.info("Sugestão de etapa ignorada.");
    } catch (err) {
      console.error("Failed to dismiss stage suggestion:", err);
      toast.error("Erro ao dispensar sugestão.");
    }
  };

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId
    ? deals.find((d) => d.id === activeDealId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  const activeMobileStage = sortedStages[mobileStageIndex] || sortedStages[0];
  const activeMobileDeals = activeMobileStage ? dealsByStage.get(activeMobileStage.id) ?? [] : [];
  const activeMobileTotal = activeMobileDeals.reduce((s, d) => s + Number(d.value || 0), 0);

  return (
    <>
      {/* MOBILE VIEW (< md): Vertical Opportunity Stack with Stage Navigation */}
      <div className="block md:hidden space-y-4">
        {/* Stage Pills & Navigation Bar */}
        <div className="rounded-xl border border-border bg-card p-3 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={mobileStageIndex === 0}
              onClick={() => setMobileStageIndex((i) => Math.max(0, i - 1))}
              className="p-1.5 rounded-lg border border-border/80 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Etapa anterior"
            >
              <ChevronLeft className="size-4" />
            </button>

            <div className="text-center min-w-0 flex-1">
              <div className="flex items-center justify-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: activeMobileStage?.color || "#1E3A5F" }}
                />
                <h3 className="font-bold text-sm text-foreground truncate">
                  {activeMobileStage?.name || "Etapa"}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <strong className="font-semibold text-foreground">{activeMobileDeals.length}</strong> oportunidades •{" "}
                <span className="font-mono">{formatCurrency(activeMobileTotal, defaultCurrency)}</span>
              </p>
            </div>

            <button
              type="button"
              disabled={mobileStageIndex === sortedStages.length - 1}
              onClick={() => setMobileStageIndex((i) => Math.min(sortedStages.length - 1, i + 1))}
              className="p-1.5 rounded-lg border border-border/80 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Próxima etapa"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Quick Stage Pills Bar */}
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {sortedStages.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setMobileStageIndex(idx)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 transition-all ${
                  idx === mobileStageIndex
                    ? "bg-[#1E3A5F] text-white shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {st.name} ({dealsByStage.get(st.id)?.length || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Opportunity Cards List for active stage */}
        <div className="space-y-3">
          {activeMobileDeals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center bg-card/60">
              <p className="text-xs text-muted-foreground">Nenhuma oportunidade nesta etapa</p>
            </div>
          ) : (
            activeMobileDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                stage={activeMobileStage}
                suggestion={suggestionsByDealId.get(deal.id) ?? null}
                onApplySuggestion={handleApplySuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                onEdit={onEditDeal}
              />
            ))
          )}

          {activeMobileStage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddDeal(activeMobileStage.id)}
              className="w-full h-9 text-xs font-semibold gap-1.5 border-dashed border-border text-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              <span>Adicionar oportunidade nesta etapa</span>
            </Button>
          )}
        </div>
      </div>

      {/* DESKTOP VIEW (>= md): Full Responsive Drag and Drop Kanban Board */}
      <div className="hidden md:block">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="pipeline-scroll flex gap-3 overflow-x-auto pb-4">
            {sortedStages.map((stage) => {
              const stageDeals = dealsByStage.get(stage.id) ?? [];
              const totalValue = stageDeals.reduce(
                (s, d) => s + Number(d.value || 0),
                0,
              );
              return (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  deals={stageDeals}
                  totalValue={totalValue}
                  currency={defaultCurrency}
                  suggestionsByDealId={suggestionsByDealId}
                  onApplySuggestion={handleApplySuggestion}
                  onDismissSuggestion={handleDismissSuggestion}
                  onAddDeal={onAddDeal}
                  onEditDeal={onEditDeal}
                />
              );
            })}
          </div>

          <DragOverlay>
            {activeDeal ? (
              <div className="opacity-90">
                <DealCard
                  deal={activeDeal}
                  stage={
                    sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
                  }
                  onEdit={() => {}}
                  isOverlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  suggestionsByDealId,
  onApplySuggestion,
  onDismissSuggestion,
  onAddDeal,
  onEditDeal,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  suggestionsByDealId: Map<string, DealStageSuggestion>;
  onApplySuggestion: (suggestion: DealStageSuggestion) => void;
  onDismissSuggestion: (suggestion: DealStageSuggestion) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex min-w-[260px] max-w-[320px] shrink-0 flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink">
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {deals.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(totalValue, currency)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              suggestion={suggestionsByDealId.get(deal.id) ?? null}
              onApplySuggestion={onApplySuggestion}
              onDismissSuggestion={onDismissSuggestion}
              onEdit={onEditDeal}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  suggestion,
  onApplySuggestion,
  onDismissSuggestion,
  onEdit,
}: {
  deal: Deal;
  stage: PipelineStage;
  suggestion?: DealStageSuggestion | null;
  onApplySuggestion?: (suggestion: DealStageSuggestion) => void;
  onDismissSuggestion?: (suggestion: DealStageSuggestion) => void;
  onEdit: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        suggestion={suggestion}
        onApplySuggestion={onApplySuggestion}
        onDismissSuggestion={onDismissSuggestion}
        onEdit={onEdit}
      />
    </div>
  );
}
