"use client";

import { useState } from "react";
import {
  Sparkles,
  Bot,
  MessageSquare,
  Shield,
  ShoppingBag,
  Send,
  Copy,
  Check,
  RotateCcw,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { CopilotActionType, CopilotResponse } from "@/lib/copilot/types";
import { toast } from "sonner";

interface CopilotSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  contactId?: string;
  onInsertText: (text: string) => void;
}

export function CopilotSheet({
  open,
  onOpenChange,
  conversationId,
  contactId,
  onInsertText,
}: CopilotSheetProps) {
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<CopilotActionType>("suggest_reply");
  const [customPrompt, setCustomPrompt] = useState("");
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRunCopilot = async (action: CopilotActionType) => {
    if (!conversationId) {
      toast.error("Nenhuma conversa selecionada.");
      return;
    }

    setActiveAction(action);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          conversationId,
          contactId,
          customPrompt: customPrompt.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Falha ao executar Copiloto");
      }

      const data = (await res.json()) as CopilotResponse;
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro no Copiloto: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.content) return;
    await navigator.clipboard.writeText(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copiado para a área de transferência.");
  };

  const handleInsert = () => {
    if (!result?.content) return;
    onInsertText(result.content);
    onOpenChange(false);
    toast.success("Texto inserido no campo de mensagem!");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-4">
        <SheetHeader className="pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Copiloto Comercial de Vendas
          </SheetTitle>
          <SheetDescription className="text-xs">
            Assistência em tempo real para atendimento, negociação e contorno de objeções.
          </SheetDescription>
        </SheetHeader>

        {/* Quick Action Pills */}
        <div className="grid grid-cols-2 gap-2 pt-3">
          <Button
            variant={activeAction === "suggest_reply" ? "default" : "outline"}
            size="sm"
            className="text-xs h-8 justify-start gap-1.5"
            onClick={() => handleRunCopilot("suggest_reply")}
            disabled={loading}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Sugerir Resposta
          </Button>

          <Button
            variant={activeAction === "summarize" ? "default" : "outline"}
            size="sm"
            className="text-xs h-8 justify-start gap-1.5"
            onClick={() => handleRunCopilot("summarize")}
            disabled={loading}
          >
            <Bot className="h-3.5 w-3.5" />
            Resumir Cliente
          </Button>

          <Button
            variant={activeAction === "overcome_objection" ? "default" : "outline"}
            size="sm"
            className="text-xs h-8 justify-start gap-1.5"
            onClick={() => handleRunCopilot("overcome_objection")}
            disabled={loading}
          >
            <Shield className="h-3.5 w-3.5" />
            Contornar Objeção
          </Button>

          <Button
            variant={activeAction === "match_catalog" ? "default" : "outline"}
            size="sm"
            className="text-xs h-8 justify-start gap-1.5"
            onClick={() => handleRunCopilot("match_catalog")}
            disabled={loading}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Consultar Catálogo
          </Button>
        </div>

        {/* Custom prompt refinement */}
        <div className="pt-2">
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Instrução adicional (ex: 'seja mais direto', 'ofereça desconto de 5%')..."
            className="text-xs resize-none h-14"
          />
        </div>

        {/* Output Box */}
        <div className="flex-1 min-h-0 flex flex-col pt-3">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-foreground">
              {loading ? "Gerando sugestão..." : "Sugestão do Copiloto"}
            </span>
            {result && !loading && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 rounded-xl border border-border bg-muted/20 p-3 flex flex-col">
            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : result ? (
              <ScrollArea className="flex-1 pr-2">
                <div className="text-xs whitespace-pre-wrap text-foreground leading-relaxed">
                  {result.content}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex flex-1 items-center justify-center text-center p-4">
                <p className="text-xs text-muted-foreground">
                  Selecione uma das ações acima para que a inteligência analise o contexto da conversa.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {result && !loading && (
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRunCopilot(activeAction)}
              className="text-xs gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Regerar
            </Button>
            <Button
              size="sm"
              onClick={handleInsert}
              className="text-xs gap-1.5 shadow-sm"
            >
              <Send className="h-3 w-3" />
              Inserir na Conversa
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
