"use client";

import { useState } from "react";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  RotateCcw,
  X,
  MessageSquare,
  Shield,
  Bot,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  Edit2,
  Lock,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CopilotActionType, CopilotResponse } from "@/lib/copilot/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CopilotSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  contactId?: string;
  contactName?: string;
  contextSummary?: string;
  onInsertText: (text: string) => void;
}

export function CopilotSheet({
  open,
  onOpenChange,
  conversationId,
  contactId,
  contactName = "o cliente",
  contextSummary,
  onInsertText,
}: CopilotSheetProps) {
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<CopilotActionType>("suggest_reply");
  const [customPrompt, setCustomPrompt] = useState("");
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleRunCopilot = async (action: CopilotActionType, promptOverride?: string) => {
    if (!conversationId) {
      toast.error("Nenhuma conversa selecionada.");
      return;
    }

    setActiveAction(action);
    setLoading(true);
    setIsEditing(false);
    setFeedback(null);

    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          conversationId,
          contactId,
          customPrompt: (promptOverride ?? customPrompt).trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Falha ao executar Copiloto");
      }

      const data = (await res.json()) as CopilotResponse;
      setResult(data);
      setEditedText(data.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro no Copiloto: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const textToCopy = isEditing ? editedText : result?.content;
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copiado para a área de transferência.");
  };

  const handleInsert = () => {
    const textToInsert = isEditing ? editedText : result?.content;
    if (!textToInsert) return;
    onInsertText(textToInsert);
    onOpenChange(false);
    toast.success("Texto inserido no campo de mensagem!");
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    handleRunCopilot("suggest_reply", customPrompt);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[420px] flex flex-col p-0 bg-card border-l border-border text-foreground shadow-2xl"
      >
        {/* Header matching Visual Reference 4 */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="size-4 text-[#D16A3A]" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase text-foreground font-sans">
                COPILOTO
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Entendi a conversa com <span className="font-semibold text-foreground">{contactName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-4">
            {/* Contextual Summary Box */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground">
              <div className="flex items-start gap-2">
                <span className="flex size-4 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 text-[10px] font-bold">
                  ●
                </span>
                <p className="text-xs text-foreground/90">
                  {contextSummary || `${contactName} está em atendimento. Escolha uma ação rápida abaixo ou faça uma pergunta personalizada ao Copiloto.`}
                </p>
              </div>
            </div>

            {/* 4 Suggested Action Cards in 2x2 Grid */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground font-sans">
                Ações sugeridas
              </span>
              <div className="grid grid-cols-2 gap-2">
                {/* 1. Sugerir Resposta */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("suggest_reply")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "suggest_reply" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Send className="size-3.5 text-primary" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Sugerir resposta
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Sugere uma resposta para continuar.
                  </span>
                </button>

                {/* 2. Contornar Objeção */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("overcome_objection")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "overcome_objection" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Shield className="size-3.5 text-orange-500" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Contornar objeção
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Argumentos para lidar com a objeção.
                  </span>
                </button>

                {/* 3. Buscar no Catálogo */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("match_catalog")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "match_catalog" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Lightbulb className="size-3.5 text-amber-500" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Buscar no catálogo
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Encontra produtos e serviços relevantes.
                  </span>
                </button>

                {/* 4. Resumir Situação */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("summarize")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "summarize" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Bot className="size-3.5 text-blue-500" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Resumir situação
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Resumo da conversa até o momento.
                  </span>
                </button>
              </div>
            </div>

            {/* Free Prompt Question Box */}
            <form onSubmit={handleCustomSubmit} className="space-y-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Ou pergunte ao Ciclopes...
              </span>
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Ex: Como posso responder sem dar desconto?"
                  className="flex-1 bg-transparent px-2.5 py-1 text-xs text-foreground placeholder-muted-foreground outline-none"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={loading || !customPrompt.trim()}
                  className="h-7 w-7 p-0 bg-primary hover:bg-primary/90 text-white rounded-md shrink-0"
                >
                  <Send className="size-3" />
                </Button>
              </div>
            </form>

            {/* Loading Indicator */}
            {loading && (
              <div className="flex flex-col items-center justify-center p-8 space-y-2 rounded-xl border border-border bg-muted/20">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs text-muted-foreground font-medium">
                  Analisando conversa e gerando sugestão...
                </span>
              </div>
            )}

            {/* Generated Suggestion Card Matching Visual Reference 4 */}
            {result && !loading && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    Sugestão de resposta
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRunCopilot(activeAction)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Regerar resposta"
                  >
                    <RotateCcw className="size-3" />
                    <span>Regerar</span>
                  </button>
                </div>

                {/* Quote / Editable Content */}
                {isEditing ? (
                  <Textarea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="text-xs min-h-[100px] bg-muted/40 border-border resize-none"
                  />
                ) : (
                  <div className="border-l-2 border-primary/60 bg-muted/30 p-3 rounded-r-md text-xs text-foreground/90 leading-relaxed italic">
                    &ldquo;{result.content}&rdquo;
                  </div>
                )}

                {/* Action Buttons Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleInsert}
                      className="h-8 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white shadow-xs"
                    >
                      <Check className="size-3.5" />
                      <span>Usar resposta</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(!isEditing)}
                      className="h-8 text-xs gap-1 border-border"
                    >
                      <Edit2 className="size-3" />
                      <span>{isEditing ? "Concluir" : "Editar"}</span>
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopy}
                      title="Copiar texto"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {copied ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFeedback("up");
                        toast.success("Obrigado pelo feedback!");
                      }}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                        feedback === "up" && "text-emerald-500"
                      )}
                      title="Boa sugestão"
                    >
                      <ThumbsUp className="size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFeedback("down");
                        toast.info("Feedback registrado.");
                      }}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                        feedback === "down" && "text-rose-500"
                      )}
                      title="Sugestão ruim"
                    >
                      <ThumbsDown className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footnote */}
        <div className="p-3 border-t border-border bg-muted/20 text-center">
          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Lock className="size-3 shrink-0" />
            As sugestões do Copiloto são geradas por IA e podem conter imprecisões. Revise antes de enviar.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
