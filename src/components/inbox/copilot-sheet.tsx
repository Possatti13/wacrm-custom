"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  RotateCcw,
  X,
  MessageSquare,
  Shield,
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

  // Reset Copilot output whenever conversation changes to avoid stale/cross-conversation leaks
  useEffect(() => {
    setResult(null);
    setIsEditing(false);
    setEditedText("");
    setCustomPrompt("");
    setFeedback(null);
  }, [conversationId]);

  const handleRunCopilot = async (action: CopilotActionType, promptOverride?: string) => {
    if (!conversationId) {
      toast.error("Nenhuma conversa selecionada.");
      return;
    }

    const effectivePrompt = (promptOverride ?? customPrompt).trim();
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
          customPrompt: effectivePrompt || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Falha ao executar Copiloto");
      }

      const data = (await res.json()) as CopilotResponse;
      setResult(data);
      setEditedText(data.suggestedReply || data.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro no Copiloto: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const textToCopy = isEditing ? editedText : (result?.suggestedReply || result?.content);
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copiado para a área de transferência.");
  };

  const handleInsert = () => {
    const textToInsert = isEditing ? editedText : (result?.suggestedReply || result?.content);
    if (!textToInsert) return;
    onInsertText(textToInsert);
    onOpenChange(false);
    toast.success("Texto inserido no campo de mensagem!");
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    handleRunCopilot("custom_query", customPrompt);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[420px] flex flex-col p-0 bg-card border-l border-border text-foreground shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="size-4 text-[#D16A3A]" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase text-foreground font-sans">
                COPILOTO COMERCIAL
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Analisando conversa com <span className="font-semibold text-foreground">{contactName}</span>
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
                  {contextSummary || `${contactName} está em atendimento. Escolha uma ação rápida abaixo ou faça uma pergunta sobre esta negociação.`}
                </p>
              </div>
            </div>

            {/* Suggested Action Cards */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground font-sans">
                Perguntas e Ações Rápidas
              </span>
              <div className="grid grid-cols-2 gap-2">
                {/* 1. O que o cliente quer */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("analyze_intent", "O que esse cliente quer e qual o momento dele?")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "analyze_intent" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <MessageSquare className="size-3.5 text-primary" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    O que o cliente quer?
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Interesse real e intenção de compra.
                  </span>
                </button>

                {/* 2. Contornar Objeção */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("overcome_objection", "Qual a principal objeção do cliente e como contornar?")}
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
                    Qual a objeção?
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Identifica objeções e argumentos.
                  </span>
                </button>

                {/* 3. Sugerir Próximo Passo */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("next_step", "Qual deve ser o próximo passo comercial para avançar?")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "next_step" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Lightbulb className="size-3.5 text-amber-500" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Próximo passo
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Próxima ação comercial recomendada.
                  </span>
                </button>

                {/* 4. Sugerir Resposta */}
                <button
                  type="button"
                  onClick={() => handleRunCopilot("suggest_reply", "O que eu deveria responder agora para avançar o atendimento?")}
                  disabled={loading}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-lg border transition-all relative group",
                    activeAction === "suggest_reply" && result
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/40 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Send className="size-3.5 text-blue-500" />
                    <ChevronRight className="size-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    O que responder?
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    Sugestão de resposta pronta.
                  </span>
                </button>
              </div>
            </div>

            {/* Free Prompt Question Box */}
            <form onSubmit={handleCustomSubmit} className="space-y-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Ou faça uma pergunta específica sobre esta conversa...
              </span>
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Ex: Qual o orçamento dele? Ele quer parcelar?"
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
                  Analisando mensagens reais da conversa...
                </span>
              </div>
            )}

            {/* Generated Copilot Answer Card */}
            {result && !loading && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="text-xs font-semibold text-foreground">
                      Análise do Copiloto
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.confidence && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-sm font-medium",
                        result.confidence === "high" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
                        result.confidence === "medium" && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                        result.confidence === "low" && "bg-muted text-muted-foreground border border-border"
                      )}>
                        {result.confidence === "high" ? "Alta confiança" : result.confidence === "medium" ? "Média confiança" : "Contexto inicial"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRunCopilot(activeAction)}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      title="Regerar análise"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  </div>
                </div>

                {/* Analytical Content */}
                <div className="text-xs text-foreground/90 leading-relaxed bg-muted/20 p-3 rounded-md border border-border/50 whitespace-pre-wrap">
                  {result.content}
                </div>

                {/* Grounding Evidence List */}
                {result.evidence && result.evidence.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Baseado na conversa:
                    </span>
                    <ul className="space-y-1">
                      {result.evidence.map((ev, idx) => (
                        <li key={idx} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5 font-bold">•</span>
                          <span className="italic">&ldquo;{ev}&rdquo;</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Reply Box (if present) */}
                {result.suggestedReply && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary flex items-center gap-1">
                        <Send className="size-3" />
                        Sugestão de resposta:
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsEditing(!isEditing)}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Edit2 className="size-2.5" />
                        <span>{isEditing ? "Concluir" : "Editar"}</span>
                      </button>
                    </div>

                    {isEditing ? (
                      <Textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        className="text-xs min-h-[80px] bg-muted/40 border-border resize-none"
                      />
                    ) : (
                      <div className="border-l-2 border-primary bg-primary/5 p-2.5 rounded-r-md text-xs text-foreground/95 leading-relaxed font-sans">
                        {editedText || result.suggestedReply}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={handleInsert}
                        className="h-7 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white shadow-xs"
                      >
                        <Check className="size-3" />
                        <span>Usar resposta</span>
                      </Button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCopy}
                          title="Copiar resposta"
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {copied ? (
                            <Check className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Feedback Row */}
                <div className="flex items-center justify-end gap-1 pt-1 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground mr-1">Esta análise foi útil?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFeedback("up");
                      toast.success("Obrigado pelo feedback!");
                    }}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                      feedback === "up" && "text-emerald-500"
                    )}
                    title="Sim"
                  >
                    <ThumbsUp className="size-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFeedback("down");
                      toast.info("Feedback registrado.");
                    }}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                      feedback === "down" && "text-rose-500"
                    )}
                    title="Não"
                  >
                    <ThumbsDown className="size-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footnote */}
        <div className="p-3 border-t border-border bg-muted/20 text-center">
          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Lock className="size-3 shrink-0" />
            As análises do Copiloto são fundamentadas nas mensagens da conversa. Revise antes de enviar.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
