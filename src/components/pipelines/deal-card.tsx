"use client";

import type { Deal, PipelineStage } from "@/types";
import type { DealStageSuggestion } from "@/types/pipeline-intelligence";
import { Calendar, Check, X, Sparkles, Flame, User } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getContactDisplayName } from "@/lib/contacts/display";

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
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  return source.slice(0, 2).toUpperCase();
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
  const contactLabel = getContactDisplayName(deal.contact, "Contato");
  const assigneeLabel = deal.assignee?.full_name || null;
  const leadScore = deal.contact?.lead_score?.score ?? null;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={cn(
        "group relative w-full cursor-pointer rounded-xl border border-border/70 bg-card pl-3.5 pr-3 py-3 text-left shadow-2xs transition-all",
        isOverlay
          ? "shadow-xl ring-2 ring-primary/40 bg-card"
          : "hover:-translate-y-0.5 hover:border-border hover:shadow-md"
      )}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#1E3A5F" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-xs font-bold leading-snug text-foreground break-words font-sans">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600">
            <Check className="size-2.5" />
            Ganho
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-500/15 px-1.5 py-0.2 text-[9px] font-bold text-rose-500">
            <X className="size-2.5" />
            Perdido
          </span>
        )}
      </div>

      {/* Contact row & Score */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar className="size-5 border border-border">
            {deal.contact?.avatar_url && (
              <AvatarImage src={deal.contact.avatar_url} alt={contactLabel} />
            )}
            <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-bold">
              {initials(deal.contact?.name, deal.contact?.phone || undefined)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-[11px] text-muted-foreground">{contactLabel}</span>
        </div>

        {leadScore !== null && (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] px-1.5 py-0 font-bold shrink-0",
              leadScore >= 70
                ? "text-[#D16A3A] border-[#D16A3A]/30 bg-[#D16A3A]/10"
                : leadScore >= 40
                ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
                : "text-muted-foreground"
            )}
          >
            {leadScore >= 70 ? "🔥 " : ""}
            {leadScore}
          </Badge>
        )}
      </div>

      {/* Value and Expected Close Date */}
      <div className="mt-2 flex items-center justify-between pt-1 border-t border-border/40">
        <span className="text-xs font-mono font-bold text-foreground">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="size-2.5" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-1.5 flex items-center justify-end">
          <span
            title={`Responsável: ${assigneeLabel}`}
            className="flex size-4.5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}

      {/* AI Stage Transition Recommendation */}
      {suggestion && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2.5 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs space-y-1.5"
        >
          <div className="flex items-center gap-1 font-semibold text-primary text-[11px]">
            <Sparkles className="size-3 text-[#D16A3A]" />
            <span>Sugerido: {suggestion.suggested_stage?.name || "Avançar Etapa"}</span>
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-2 italic">
            &ldquo;{suggestion.reason}&rdquo;
          </p>
          <div className="flex items-center gap-1.5 pt-0.5">
            {onApplySuggestion && (
              <button
                type="button"
                onClick={() => onApplySuggestion(suggestion)}
                className="flex-1 rounded bg-[#1E3A5F] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#162B46] transition-colors"
              >
                Avançar Etapa ✓
              </button>
            )}
            {onDismissSuggestion && (
              <button
                type="button"
                onClick={() => onDismissSuggestion(suggestion)}
                className="rounded border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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
