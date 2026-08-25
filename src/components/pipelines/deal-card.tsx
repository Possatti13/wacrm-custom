"use client";

import type { Deal, PipelineStage } from "@/types";
import type { DealStageSuggestion } from "@/types/pipeline-intelligence";
import { Calendar, Check, X, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  suggestion?: DealStageSuggestion | null;
  onApplySuggestion?: (suggestion: DealStageSuggestion) => void;
  onDismissSuggestion?: (suggestion: DealStageSuggestion) => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  suggestion,
  onApplySuggestion,
  onDismissSuggestion,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}

      {/* AI Stage Transition Recommendation */}
      {suggestion && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2.5 rounded-lg border border-primary/30 bg-primary/10 p-2 text-xs space-y-1.5"
        >
          <div className="flex items-center gap-1 font-semibold text-primary text-[11px]">
            <Sparkles className="h-3 w-3" />
            <span>Sugerido: {suggestion.suggested_stage?.name || "Avançar Etapa"}</span>
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-2 italic">
            &ldquo;{suggestion.reason}&rdquo;
          </p>
          <div className="flex items-center gap-1.5 pt-0.5">
            {onApplySuggestion && (
              <button
                type="button"
                onClick={() => onApplySuggestion(suggestion)}
                className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Avançar Etapa ✓
              </button>
            )}
            {onDismissSuggestion && (
              <button
                type="button"
                onClick={() => onDismissSuggestion(suggestion)}
                className="rounded border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="Ignorar recomendação"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </button>
  );
}
