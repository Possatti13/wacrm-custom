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
import type { AskCiclopesResult, DrilldownAction } from '@/lib/analytics/ask-ciclopes/types';

interface AskCiclopesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDrilldown?: (action: DrilldownAction) => void;
}

const PRESET_QUESTIONS = [
  'Quais leads precisam de atenção agora?',
  'Quais foram as maiores objeções este mês?',
  'Qual produto está enfrentando mais resistência?',
  'Como está o desempenho da equipe nos últimos 7 dias?',
  'Quais sinais de compra e deals temos no pipeline?',
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Container */}
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-slate-900 border-l border-slate-800 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-950/40 ring-1 ring-white/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">ASK CICLOPES</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                  Grounded BI
                </span>
              </div>
              <p className="text-xs text-slate-400">Inteligência gerencial sobre a operação comercial real</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            title="Fechar painel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Turns / Messages Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {turns.length === 0 && !isLoading && (
            <div className="space-y-6 py-6">
              <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-5 text-center">
                <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
                <h3 className="text-sm font-semibold text-white">Análise 100% Determinística</h3>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                  O PostgreSQL consolida os fatos e o modelo sintetiza as respostas executivas sem alucinações matemáticas ou estimativas inventadas.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Perguntas Sugeridas
                </h4>
                <div className="flex flex-col gap-2">
                  {PRESET_QUESTIONS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSubmit(preset)}
                      className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/60 px-4 py-3 text-left text-xs font-medium text-slate-200 hover:border-emerald-500/50 hover:bg-slate-800 hover:text-white transition-all shadow-xs"
                    >
                      <span>{preset}</span>
                      <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 group-hover:text-emerald-400 transition-all" />
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
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-emerald-600/20 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-100 shadow-xs">
                  {turn.question}
                </div>
              </div>

              {/* Ciclopes Answer Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-5 space-y-4 shadow-lg ring-1 ring-white/5">
                {/* Executive Answer Text */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      Resposta Executiva
                    </span>
                    <div className="flex items-center gap-2">
                      {turn.cached && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
                          <Zap className="h-3 w-3" /> Cache
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {turn.resolvedPeriod?.range === 'today' ? 'Hoje' : turn.resolvedPeriod?.range === 'month' ? 'Este Mês' : 'Últimos 30 Dias'}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-line font-normal">
                    {turn.answer}
                  </p>
                </div>

                {/* Grounded Factual Highlights */}
                {turn.claims && turn.claims.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <h5 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      Destaques Fatuais
                    </h5>
                    <div className="space-y-1.5">
                      {turn.claims.map((claim, cIdx) => (
                        <div
                          key={cIdx}
                          className="flex items-start gap-2 text-xs text-slate-300 bg-slate-900/60 rounded-lg p-2.5 border border-slate-800/80"
                        >
                          <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50 shrink-0">
                            {claim.fact_ids.join(', ') || 'Fato'}
                          </span>
                          <span className="leading-snug">{claim.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {turn.recommendations && turn.recommendations.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <h5 className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                      Recomendações Práticas
                    </h5>
                    <div className="space-y-1.5">
                      {turn.recommendations.map((rec, rIdx) => (
                        <div
                          key={rIdx}
                          className="text-xs text-amber-100/90 bg-amber-950/20 border border-amber-500/20 rounded-lg p-2.5 leading-snug"
                        >
                          {rec.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Opaque Lead Cards (PII resolved locally in UI) */}
                {turn.opaqueEntities && Object.keys(turn.opaqueEntities).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <h5 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-teal-400" />
                      Leads Identificados
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Object.values(turn.opaqueEntities).map((lead) => (
                        <div
                          key={lead.lead_token}
                          className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white truncate">{lead.contact_name || lead.lead_token}</span>
                            {lead.score !== undefined && lead.score !== null && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                                Score {lead.score}
                              </span>
                            )}
                          </div>
                          {lead.phone && <p className="text-[11px] text-slate-400">{lead.phone}</p>}
                          {lead.reasons && lead.reasons.length > 0 && (
                            <p className="text-[10px] text-amber-300/80 truncate">⚠️ {lead.reasons.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Drilldown Actions */}
                {turn.drilldowns && turn.drilldowns.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-2">
                    {turn.drilldowns.map((action, dIdx) => (
                      <button
                        key={dIdx}
                        onClick={() => onDrilldown?.(action)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-500/60 transition-all cursor-pointer shadow-xs"
                      >
                        <span>{action.label}</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Footer Metadata */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                  <span>Latência: {turn.latencyMs}ms</span>
                  <span>{turn.provider} • {turn.model}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Loading Skeleton */}
          {isLoading && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-emerald-600/20 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-100 animate-pulse">
                  {question || 'Processando pergunta...'}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-800/40 p-5 space-y-3 animate-pulse">
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Consultando métricas do PostgreSQL e gerando resposta...
                </div>
                <div className="h-4 bg-slate-700/50 rounded w-3/4" />
                <div className="h-4 bg-slate-700/50 rounded w-5/6" />
                <div className="h-4 bg-slate-700/50 rounded w-1/2" />
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-xs text-red-300 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-200">Não foi possível responder</p>
                <p className="leading-relaxed text-red-300/90">{error}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="border-t border-slate-800 p-4 bg-slate-900/95">
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
              placeholder="Ex.: Quais foram as maiores objeções deste mês?"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition-all"
            />

            <button
              type="submit"
              disabled={!question.trim() || isLoading}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-950/50 cursor-pointer"
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
