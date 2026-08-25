"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sparkles, MessageSquare, ExternalLink, ShieldCheck } from "lucide-react";
import type { ConversationInsightWithEvidence } from "@/lib/insights/types";

interface EvidenceDialogProps {
  insight: ConversationInsightWithEvidence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToMessage?: (messageId: string) => void;
}

export function EvidenceDialog({
  insight,
  open,
  onOpenChange,
  onJumpToMessage,
}: EvidenceDialogProps) {
  if (!insight) return null;

  const typeLabels: Record<string, string> = {
    intent: "Intenção Comercial",
    urgency: "Urgência",
    sentiment: "Sentimento",
    catalog_interest: "Interesse no Catálogo",
    objection: "Objeção Comercial",
    attribute: "Atributo de Qualificação",
    next_action: "Próxima Ação Sugerida",
    summary: "Resumo do Lead",
  };

  const confidencePct = insight.confidence != null ? Math.round(insight.confidence * 100) : null;
  const isAi = insight.source === "intelligence";
  const evidenceList = insight.evidence || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Evidência & Auditoria do Sinal
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Comprovação factual extraída das mensagens da conversa
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Signal Header Card */}
          <div className="rounded-lg border border-border bg-muted/40 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {typeLabels[insight.insight_type] || insight.insight_type}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={
                    isAi
                      ? "border-primary/30 bg-primary/10 text-primary text-[10px]"
                      : "border-slate-300 bg-slate-100 text-slate-700 text-[10px]"
                  }
                >
                  {isAi ? "IA (Commercial Intelligence)" : "Humano (Manual)"}
                </Badge>
                {confidencePct !== null && (
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {confidencePct}% confiança
                  </Badge>
                )}
              </div>
            </div>

            <div className="text-sm font-semibold text-foreground">
              {insight.value_text || JSON.stringify(insight.value_json) || "Detectado"}
            </div>

            {insight.observed_at && (
              <div className="text-[11px] text-muted-foreground">
                Observado em: {format(new Date(insight.observed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
            )}
          </div>

          {/* Citations / Exact Quotes */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
              Trechos Citados na Conversa ({evidenceList.length})
            </div>

            {evidenceList.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhum trecho textual específico anexado (inferência contextual global).
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {evidenceList.map((ev, idx) => (
                  <div
                    key={ev.id || idx}
                    className="rounded-lg border border-border/80 bg-background p-3 text-xs space-y-2 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-primary font-medium text-[11px]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Citação Factual #{idx + 1}</span>
                      </div>
                      {ev.message_id && onJumpToMessage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-primary gap-1"
                          onClick={() => {
                            onJumpToMessage(ev.message_id);
                            onOpenChange(false);
                          }}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ver na conversa
                        </Button>
                      )}
                    </div>

                    <div className="rounded bg-muted/60 p-2.5 font-sans italic text-foreground text-xs border-l-2 border-primary">
                      &ldquo;{ev.snippet || "Trecho identificado"}&rdquo;
                    </div>

                    {ev.created_at && (
                      <div className="text-[10px] text-muted-foreground text-right">
                        {format(new Date(ev.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
