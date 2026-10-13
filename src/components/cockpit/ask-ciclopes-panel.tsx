'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { CiclopesSymbol } from '@/components/brand/ciclopes-symbol';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { getContactDisplayName } from '@/lib/contacts/display';
import { formatPhoneNumber } from '@/lib/whatsapp/phone-utils';
import {
  getAskConversationHref,
  getAskWhatsAppHref,
  resolveAskDrilldown,
} from '@/lib/analytics/ask-ciclopes/actionability';
import type {
  AskCiclopesResult,
  DrilldownAction,
  OpaqueLeadEntity,
} from '@/lib/analytics/ask-ciclopes/types';

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
const actionClass =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const tierLabels: Record<string, string> = {
  hot: 'Lead Quente',
  warm: 'Lead Morno',
  cold: 'Lead Frio',
};
const statusLabels: Record<string, string> = {
  open: 'Em aberto',
  reviewed: 'Revisado',
  dismissed: 'Dispensado',
  resolved: 'Resolvido',
};

function LeadResult({
  lead,
  testWorkspace,
  onNavigate,
}: {
  lead: OpaqueLeadEntity;
  testWorkspace: boolean;
  onNavigate: () => void;
}) {
  const phone =
    lead.phone && /^\+?[\d\s().-]+$/.test(lead.phone)
      ? formatPhoneNumber(lead.phone)
      : '';
  const name = getContactDisplayName({ name: lead.contact_name, phone });
  const conversationHref = getAskConversationHref(lead);
  const whatsappHref = getAskWhatsAppHref(lead, testWorkspace);
  return (
    <article
      aria-label={`Resultado: ${name}`}
      className="border-border bg-background min-w-0 rounded-xl border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-foreground text-sm font-semibold break-words">
            {name}
          </h4>
          {phone && (
            <p className="text-muted-foreground mt-0.5 text-xs break-words">
              {phone}
            </p>
          )}
        </div>
        {typeof lead.score === 'number' && Number.isFinite(lead.score) && (
          <span className="bg-primary/10 text-primary shrink-0 rounded-md px-2 py-1 text-xs font-semibold">
            Score {lead.score}
          </span>
        )}
      </div>
      {(lead.score_tier && tierLabels[lead.score_tier]) ||
      (lead.status && statusLabels[lead.status]) ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {[
            lead.score_tier && tierLabels[lead.score_tier],
            lead.status && statusLabels[lead.status],
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {lead.reasons?.length ? (
        <p className="text-foreground mt-2 text-xs leading-relaxed break-words">
          {lead.reasons.join(' · ')}
        </p>
      ) : null}
      {lead.signal_text && !lead.reasons?.includes(lead.signal_text) && (
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed break-words">
          {lead.signal_text}
        </p>
      )}
      {lead.responsible_user_name && (
        <p className="text-muted-foreground mt-1 text-xs break-words">
          Responsável: {lead.responsible_user_name}
        </p>
      )}
      {(conversationHref || whatsappHref) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Document navigation follows the certified Follow-ups → Inbox contract. */}
          {conversationHref && (
            <a
              href={conversationHref}
              onClick={onNavigate}
              aria-label={`Abrir conversa — ${name}`}
              className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}
            >
              Abrir conversa{' '}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </a>
          )}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp — ${name} (abre em nova aba)`}
              className={`${actionClass} border-border hover:bg-muted border`}
            >
              WhatsApp <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export function AskCiclopesPanel({
  isOpen,
  onClose,
  onDrilldown,
}: AskCiclopesPanelProps) {
  const { profile, account, user } = useAuth();
  const testWorkspace =
    /\.(test|invalid)$/i.test(user?.email ?? profile?.email ?? '') ||
    /\b(qa|teste?|demo|fixture)\b/i.test(account?.name ?? '');
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskCiclopesResult[]>([]);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pendingRef = useRef(false);
  const latestTurnRef = useRef<HTMLElement>(null);
  const pendingQuestionRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const target = isLoading
      ? pendingQuestionRef.current
      : error
        ? errorRef.current
        : latestTurnRef.current;
    if (isOpen) target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [turns, isLoading, error, isOpen]);

  const handleSubmit = async (queryText?: string) => {
    const q = (queryText || question).trim();
    if (!q || pendingRef.current) return;
    pendingRef.current = true;
    setError(null);
    setFailedQuestion(null);
    setPendingQuestion(q);
    setIsLoading(true);
    if (!queryText) setQuestion('');
    try {
      const res = await fetch('/api/manager/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok)
        throw new Error(
          res.status === 403
            ? 'Esta consulta está disponível apenas para gestores autorizados.'
            : 'Não foi possível concluir a consulta. Tente novamente.'
        );
      const data: AskCiclopesResult = await res.json();
      setTurns((prev) => [...prev, data]);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível concluir a consulta. Tente novamente.'
      );
      setFailedQuestion(q);
    } finally {
      pendingRef.current = false;
      setIsLoading(false);
      setPendingQuestion(null);
    }
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="bg-card text-foreground h-dvh min-w-0 gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]"
      >
        <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-xl">
              <CiclopesSymbol size={24} variant="aegean" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="font-brand text-base font-bold tracking-wide">
                Ask Ciclopes
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                Da visão da operação à próxima ação
              </SheetDescription>
            </div>
          </div>
          <SheetClose
            aria-label="Fechar Ask Ciclopes"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring shrink-0 rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <X className="size-5" aria-hidden="true" />
          </SheetClose>
        </header>
        <div
          aria-label="Respostas do Ask Ciclopes"
          className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
        >
          {turns.length === 0 && !isLoading && !error && (
            <div className="space-y-6 py-2">
              <div className="space-y-2">
                <ShieldCheck
                  className="text-primary size-6"
                  aria-hidden="true"
                />
                <h3 className="text-base font-semibold">
                  O que merece sua atenção?
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Consulte conversas, oportunidades e desempenho da equipe com
                  base nos dados da sua operação.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Perguntas sugeridas
                </h4>
                {PRESET_QUESTIONS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handleSubmit(preset)}
                    className="border-border hover:bg-muted/50 focus-visible:outline-ring flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span className="min-w-0 break-words">{preset}</span>
                    <ArrowRight
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn, turnIndex) => {
            const entities = Object.values(turn.opaqueEntities ?? {});
            const destinations = (turn.drilldowns ?? [])
              .map((action) =>
                resolveAskDrilldown(
                  action,
                  turn.facts ?? [],
                  turn.opaqueEntities ?? {}
                )
              )
              .filter(
                (destination) =>
                  destination && (destination.href || onDrilldown)
              );
            return (
              <section
                key={turn.turnId}
                ref={turnIndex === turns.length - 1 ? latestTurnRef : null}
                aria-label={`Resposta: ${turn.question}`}
                className="min-w-0 space-y-4"
              >
                <div className="flex justify-end">
                  <p className="bg-primary text-primary-foreground max-w-[90%] rounded-2xl rounded-tr-sm px-4 py-3 text-sm break-words">
                    {turn.question}
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles
                        className="text-primary size-4"
                        aria-hidden="true"
                      />
                      Resumo
                    </h3>
                    <p className="text-sm leading-relaxed break-words whitespace-pre-line">
                      {turn.answer}
                    </p>
                  </div>
                  {entities.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        Resultados{' '}
                        <span className="text-muted-foreground ml-1 text-xs font-normal">
                          ({entities.length})
                        </span>
                      </h3>
                      <div className="space-y-2">
                        {entities.map((lead) => (
                          <LeadResult
                            key={lead.lead_token}
                            lead={lead}
                            testWorkspace={testWorkspace}
                            onNavigate={onClose}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {turn.claims?.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <CheckCircle2
                          className="text-primary size-4"
                          aria-hidden="true"
                        />
                        Destaques da operação
                      </h3>
                      <ul className="border-primary/20 space-y-2 border-l-2 pl-3">
                        {turn.claims.map((claim, index) => (
                          <li
                            key={index}
                            className="text-sm leading-relaxed break-words"
                          >
                            {claim.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {turn.recommendations?.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Lightbulb
                          className="text-primary size-4"
                          aria-hidden="true"
                        />
                        Recomendações
                      </h3>
                      <ul className="space-y-2">
                        {turn.recommendations.map((rec, index) => (
                          <li
                            key={index}
                            className="text-sm leading-relaxed break-words"
                          >
                            {rec.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {destinations.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        Ações relacionadas
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {destinations.map(
                          (destination, index) =>
                            destination &&
                            (destination.href ? (
                              <a
                                key={index}
                                href={destination.href}
                                onClick={onClose}
                                className={`${actionClass} border-border hover:bg-muted border`}
                              >
                                {destination.label}
                                <ArrowRight
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                              </a>
                            ) : (
                              <button
                                key={index}
                                onClick={() =>
                                  onDrilldown?.(destination.action)
                                }
                                className={`${actionClass} border-border hover:bg-muted border`}
                              >
                                {destination.label}
                                <ArrowRight
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  )}
                  <p className="border-border text-muted-foreground border-t pt-3 text-xs">
                    Resposta de IA baseada nos dados do seu Ciclopes
                    {turn.resolvedPeriod?.label
                      ? ` · ${turn.resolvedPeriod.label}`
                      : ''}
                    {turn.cached ? ' · Resposta otimizada' : ''}
                  </p>
                </div>
              </section>
            );
          })}
          {pendingQuestion && (
            <p
              ref={pendingQuestionRef}
              className="bg-primary text-primary-foreground ml-auto max-w-[90%] rounded-2xl rounded-tr-sm px-4 py-3 text-sm break-words"
            >
              {pendingQuestion}
            </p>
          )}
          {isLoading && (
            <div role="status" aria-live="polite" className="space-y-3 py-2">
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <RefreshCw
                  className="size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
                Analisando sua operação...
              </p>
              <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
              <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            </div>
          )}
          {error && (
            <div
              role="alert"
              ref={errorRef}
              className="border-destructive/30 bg-destructive/5 space-y-3 rounded-xl border p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  Não foi possível responder
                </p>
                {failedQuestion && (
                  <p className="text-muted-foreground text-xs break-words">
                    Pergunta: {failedQuestion}
                  </p>
                )}
                <p className="text-sm break-words">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => handleSubmit(failedQuestion ?? undefined)}
                className={`${actionClass} border-border hover:bg-muted border`}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Tentar novamente
              </button>
            </div>
          )}
        </div>
        <footer className="border-border bg-card shrink-0 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="flex min-w-0 gap-2"
          >
            <input
              ref={inputRef}
              aria-label="Pergunta ao Ask Ciclopes"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={isLoading}
              maxLength={1000}
              placeholder="Pergunte sobre sua operação..."
              className="border-border bg-background placeholder:text-muted-foreground focus-visible:outline-ring h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            />
            <button
              type="submit"
              aria-label="Enviar pergunta"
              disabled={!question.trim() || isLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </form>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
