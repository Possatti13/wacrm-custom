'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  X,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Lightbulb,
  CheckCircle2,
  Zap,
  ArrowRight,
  User,
} from 'lucide-react';
import { CiclopesSymbol } from '@/components/brand/ciclopes-symbol';
import type { AskCiclopesResult, DrilldownAction } from '@/lib/analytics/ask-ciclopes/types';

interface AskCiclopesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDrilldown?: (action: DrilldownAction) => void;
}

const PRESET_QUESTIONS = [
  'Quais oportunidades precisam de atenção agora?',
  'Quais objeções estão aparecendo com mais frequência?',
  'Onde estamos perdendo ritmo nas conversas?',
  'Como está o desempenho comercial da equipe?',
  'Quais sinais de compra e negócios temos no pipeline?',
];

export function AskCiclopesPanel({ isOpen, onClose, onDrilldown }: AskCiclopesPanelProps) {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turns, setTurns] = useState<AskCiclopesResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isLoading]);

  if (!isOpen) return null;

  const handleSubmit = async (queryText?: string) => {
    const q = (queryText || question).trim();
    if (!q || isLoading) return;

    setError(null);
    setIsLoading(true);
    if (!queryText) setQuestion('');

    try {
      const res = await fetch('/api/manager/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Erro na requisição (${res.status})`);
      }

      const data: AskCiclopesResult = await res.json();
      setTurns((prev) => [...prev, data]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao processar pergunta';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Container */}
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-card border-l border-border shadow-2xl text-foreground">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-card/95">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary ring-1 ring-border/80">
              <CiclopesSymbol size={24} variant="aegean" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-brand tracking-wide text-foreground">ASK CICLOPES</h2>
                <span className="rounded-full bg-[#1E3A5F]/10 dark:bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-[#1E3A5F] dark:text-primary border border-border">
                  Dados Verificados
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Inteligência gerencial sobre a operação comercial real</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Fechar painel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Turns / Messages Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {turns.length === 0 && !isLoading && (
            <div className="space-y-6 py-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-5 text-center relative overflow-hidden">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold font-sans text-foreground">Visão Executiva da sua Operação</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
                  Respostas analíticas estruturadas com base nos dados reais de conversas, oportunidades, objeções e desempenho do time.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 font-sans">
                  Perguntas Sugeridas
                </h4>
                <div className="flex flex-col gap-2">
                  {PRESET_QUESTIONS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSubmit(preset)}
                      className="group flex items-center justify-between rounded-xl border border-border/80 bg-background/80 px-4 py-3 text-left text-xs font-medium text-foreground hover:border-[#1E3A5F]/50 dark:hover:border-primary/50 hover:bg-muted/50 transition-all shadow-xs"
                    >
                      <span>{preset}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-[#1E3A5F] dark:group-hover:text-primary transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Render Turns */}
          {turns.map((turn) => (
            <div key={turn.turnId} className="space-y-4">
              {/* User Question */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-[#1E3A5F] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground px-4 py-2.5 text-xs font-medium shadow-xs">
                  {turn.question}
                </div>
              </div>

              {/* Ciclopes Answer Card */}
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
                {/* Executive Answer Text */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/60 pb-2">
                    <span className="font-bold text-[#D16A3A] flex items-center gap-1.5 font-sans">
                      <Sparkles className="h-3.5 w-3.5" />
                      Resposta Executiva
                    </span>
                    <div className="flex items-center gap-2">
                      {turn.cached && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Zap className="h-3 w-3" /> Resposta Otimizada
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {turn.resolvedPeriod?.range === 'today' ? 'Hoje' : turn.resolvedPeriod?.range === 'month' ? 'Este Mês' : 'Últimos 30 Dias'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-foreground whitespace-pre-line font-normal">
                    {turn.answer}
                  </p>
                </div>

                {/* Grounded Factual Highlights */}
                {turn.claims && turn.claims.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <h5 className="text-xs font-bold text-foreground flex items-center gap-1.5 font-sans">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      Destaques da Operação
                    </h5>
                    <div className="space-y-1.5">
                      {turn.claims.map((claim, cIdx) => (
                        <div
                          key={cIdx}
                          className="flex items-start gap-2 text-xs text-foreground bg-muted/30 rounded-lg p-2.5 border border-border/60"
                        >
                          <span className="font-mono text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 shrink-0">
                            Evidência
                          </span>
                          <span className="leading-snug text-xs">{claim.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {turn.recommendations && turn.recommendations.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <h5 className="text-xs font-bold text-[#D16A3A] flex items-center gap-1.5 font-sans">
                      <Lightbulb className="h-3.5 w-3.5 text-[#D16A3A]" />
                      Próximos Passos Sugeridos
                    </h5>
                    <div className="space-y-1.5">
                      {turn.recommendations.map((rec, rIdx) => (
                        <div
                          key={rIdx}
                          className="text-xs text-foreground bg-orange-500/[0.05] border border-[#D16A3A]/20 rounded-lg p-2.5 leading-snug"
                        >
                          {rec.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Opaque Lead Cards (PII resolved locally in UI) */}
                {turn.opaqueEntities && Object.keys(turn.opaqueEntities).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <h5 className="text-xs font-bold text-foreground flex items-center gap-1.5 font-sans">
                      <User className="h-3.5 w-3.5 text-primary" />
                      Contatos Identificados
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Object.values(turn.opaqueEntities).map((lead) => (
                        <div
                          key={lead.lead_token}
                          className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-foreground truncate">{lead.contact_name || lead.lead_token}</span>
                            {lead.score !== undefined && lead.score !== null && (
                              <span className="rounded bg-[#D16A3A]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#D16A3A]">
                                Score {lead.score}
                              </span>
                            )}
                          </div>
                          {lead.phone && <p className="text-[11px] text-muted-foreground font-mono">{lead.phone}</p>}
                          {lead.reasons && lead.reasons.length > 0 && (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">⚠️ {lead.reasons.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Drilldown Actions */}
                {turn.drilldowns && turn.drilldowns.length > 0 && (
                  <div className="pt-2 border-t border-border/60 flex flex-wrap gap-2">
                    {turn.drilldowns.map((action, dIdx) => (
                      <button
                        key={dIdx}
                        onClick={() => onDrilldown?.(action)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted hover:border-primary/40 transition-all cursor-pointer shadow-xs"
                      >
                        <span>{action.label}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Footer Micro-Trust */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                  <span>Baseado nos dados do seu Ciclopes</span>
                  <span>Tempo de resposta: {turn.latencyMs}ms</span>
                </div>
              </div>
            </div>
          ))}

          {/* Loading Skeleton */}
          {isLoading && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-[#1E3A5F]/80 text-[#F7F3EC] px-4 py-2.5 text-xs animate-pulse">
                  {question || 'Processando pergunta...'}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 text-xs text-primary font-medium">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Analisando sua operação e cruzando indicadores...</span>
                </div>
                <div className="h-3.5 bg-muted/60 rounded w-3/4 animate-pulse" />
                <div className="h-3.5 bg-muted/60 rounded w-5/6 animate-pulse" />
                <div className="h-3.5 bg-muted/60 rounded w-1/2 animate-pulse" />
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Não foi possível responder</p>
                <p className="leading-relaxed text-red-600/90 dark:text-red-400/90">{error}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="border-t border-border p-4 bg-card">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Pergunte sobre sua operação comercial..."
              className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-[#1E3A5F] focus:outline-hidden focus:ring-1 focus:ring-[#1E3A5F] disabled:opacity-50 transition-all h-10"
            />

            <button
              type="submit"
              disabled={!question.trim() || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E3A5F] text-[#F7F3EC] hover:bg-[#162B46] dark:bg-primary dark:text-primary-foreground disabled:opacity-40 transition-colors shadow-xs cursor-pointer"
              title="Enviar pergunta"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
