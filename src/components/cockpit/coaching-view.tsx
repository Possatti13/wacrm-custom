'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  Sparkles,
  AlertTriangle,
  Clock,
  MessageSquare,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
  ShieldCheck,
  User,
  Filter,
  Eye,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type {
  CoachingSummaryResponse,
  CoachingOpportunitiesResponse,
  CoachingPatternsResponse,
  ConversationReviewPayload,
  CoachingReviewStatus,
} from '@/lib/analytics/types';
import {
  getManagerCoachingSummary,
  getManagerCoachingOpportunities,
  getManagerCoachingPatterns,
  getManagerCoachingConversation,
  updateManagerCoachingOpportunityStatus,
} from '@/lib/analytics/coaching';
import { createClient } from '@/lib/supabase/client';

interface CoachingViewProps {
  accountId: string;
  range: 'today' | '7d' | '30d' | 'month' | 'custom';
  onOpenAskCiclopes?: () => void;
}

export function CoachingView({ accountId, range, onOpenAskCiclopes }: CoachingViewProps) {
  const [summary, setSummary] = useState<CoachingSummaryResponse | null>(null);
  const [opportunities, setOpportunities] = useState<CoachingOpportunitiesResponse | null>(null);
  const [patterns, setPatterns] = useState<CoachingPatternsResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<CoachingReviewStatus | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationReview, setConversationReview] = useState<ConversationReviewPayload | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const db = createClient();
    try {
      const [sumRes, oppRes, patRes] = await Promise.all([
        getManagerCoachingSummary(db, accountId, { range }),
        getManagerCoachingOpportunities(db, accountId, { range, status: statusFilter, limit: 30 }),
        getManagerCoachingPatterns(db, accountId, { range }),
      ]);
      setSummary(sumRes);
      setOpportunities(oppRes);
      setPatterns(patRes);
    } catch (err) {
      console.error('[CoachingView] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, [accountId, range, statusFilter]);

  useEffect(() => {
    loadData().catch(console.error);
  }, [loadData]);

  const handleOpenConversationReview = async (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setReviewLoading(true);
    const db = createClient();
    try {
      const payload = await getManagerCoachingConversation(db, accountId, conversationId);
      setConversationReview(payload);
    } catch (err) {
      console.error('[CoachingView] handleOpenConversationReview error:', err);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleUpdateStatus = async (
    opportunityKey: string,
    newStatus: CoachingReviewStatus,
    notes?: string
  ) => {
    setUpdatingKey(opportunityKey);
    const db = createClient();
    try {
      await updateManagerCoachingOpportunityStatus(db, accountId, opportunityKey, newStatus, notes);
      await loadData();
      if (conversationReview && selectedConversationId) {
        await handleOpenConversationReview(selectedConversationId);
      }
    } catch (err) {
      console.error('[CoachingView] handleUpdateStatus error:', err);
    } finally {
      setUpdatingKey(null);
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'urgent':
        return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40">Urgente</Badge>;
      case 'high':
        return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">Alta</Badge>;
      case 'medium':
        return <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">Média</Badge>;
      default:
        return <Badge className="bg-slate-500/20 text-slate-300 border-slate-500/40">Baixa</Badge>;
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'buying_signal_missed':
        return 'Sinal de Compra';
      case 'overdue_followup':
        return 'Follow-up Atrasado';
      case 'hot_lead_unattended':
        return 'Lead Quente';
      case 'unanswered_customer':
        return 'Aguardando Resposta';
      case 'loss_signal_unreviewed':
        return 'Sinal de Perda';
      case 'unassigned_commercial':
        return 'Sem Vendedor';
      default:
        return category;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & AI Assist Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900 border border-indigo-500/20">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-foreground">Coaching & Inteligência de Conversas</h2>
            <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-300 border-indigo-500/30">
              V1.6 Grounded
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Oportunidades factuais de desenvolvimento comercial baseadas em eventos reais da operação.
          </p>
        </div>

        {onOpenAskCiclopes && (
          <Button
            onClick={onOpenAskCiclopes}
            className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 shrink-0"
          >
            <Sparkles className="h-4 w-4" />
            <span>Perguntar ao Ciclopes</span>
          </Button>
        )}
      </div>

      {/* 2. Key Focus KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 bg-card border-border space-y-1">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Para Revisão</span>
            <AlertTriangle className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {loading ? '...' : summary?.total_open_opportunities ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {summary?.urgent_count ?? 0} com severidade urgente
          </div>
        </Card>

        <Card className="p-4 bg-card border-border space-y-1">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Sinais de Compra</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {loading ? '...' : summary?.category_breakdown.buying_signals_missed ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">sem retorno recente</div>
        </Card>

        <Card className="p-4 bg-card border-border space-y-1">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Follow-ups Vencidos</span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {loading ? '...' : summary?.category_breakdown.overdue_followups ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">tarefas com prazo estourado</div>
        </Card>

        <Card className="p-4 bg-card border-border space-y-1">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Aguardando Resposta</span>
            <MessageSquare className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">
            {loading ? '...' : summary?.category_breakdown.unanswered_customer ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">clientes esperando contato</div>
        </Card>
      </div>

      {/* 3. Observed Friction Patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Objection Patterns */}
        <Card className="p-5 bg-card border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span>Padrões de Objeções Recorrentes</span>
              </h3>
              <p className="text-xs text-muted-foreground">Mínimo de 3 ocorrências no período</p>
            </div>
          </div>

          <div className="space-y-2">
            {(patterns?.objection_patterns || []).length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhum padrão repetitivo de objeção identificado no período selecionado.
              </div>
            ) : (
              patterns?.objection_patterns.map((pat, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/50 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground">{pat.objection_name}</div>
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      <span>{pat.seller_name}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="font-mono text-amber-300 border-amber-500/30">
                      {pat.occurrences}x no período
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Follow-up & Response Patterns */}
        <Card className="p-5 bg-card border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-400" />
                <span>Acompanhamento & Follow-up por Vendedor</span>
              </h3>
              <p className="text-xs text-muted-foreground">Taxa de atraso em tarefas e primeira resposta</p>
            </div>
          </div>

          <div className="space-y-2">
            {(patterns?.followup_patterns || []).length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhum gargalo de follow-up identificado no período.
              </div>
            ) : (
              patterns?.followup_patterns.map((fp, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/50 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span>{fp.seller_name}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {fp.overdue_tasks} atrasadas de {fp.total_tasks} tarefas
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant="outline"
                      className={`font-mono ${
                        fp.overdue_pct > 30
                          ? 'text-rose-400 border-rose-500/30'
                          : 'text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {fp.overdue_pct}% atraso
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* 4. Conversations for Review (Opportunities List) */}
      <Card className="p-5 bg-card border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Conversas para Revisão da Gestão</h3>
            <p className="text-xs text-muted-foreground">
              Oportunidades identificadas para feedback e alinhamento prático
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex rounded-lg bg-muted/60 p-0.5 text-xs">
              {(['open', 'reviewed', 'all'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-md capitalize transition-colors ${
                    statusFilter === st
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {st === 'open' ? 'Pendentes' : st === 'reviewed' ? 'Revisadas' : 'Todas'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Opportunity Cards */}
        <div className="space-y-3">
          {(opportunities?.items || []).length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <ShieldCheck className="h-8 w-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-semibold text-foreground">
                Nenhuma oportunidade de revisão encontrada
              </div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Não há gargalos operacionais críticos em aberto com os critérios atuais no período.
              </p>
            </div>
          ) : (
            opportunities?.items.map((opp) => (
              <div
                key={opp.opportunity_key}
                className="p-4 rounded-xl bg-muted/30 hover:bg-muted/50 border border-border transition-colors space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getSeverityBadge(opp.severity)}
                      <Badge variant="outline" className="text-[11px] bg-muted/60">
                        {getCategoryLabel(opp.category)}
                      </Badge>
                      <span className="text-sm font-semibold text-foreground">
                        {opp.contact_name}
                      </span>
                      {opp.lead_score !== null && (
                        <span className="text-xs font-mono text-muted-foreground">
                          (Score: {opp.lead_score})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground font-medium">{opp.primary_reason}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenConversationReview(opp.conversation_id)}
                      className="gap-1 text-xs h-8"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Ver Timeline</span>
                    </Button>

                    {opp.status === 'open' ? (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={updatingKey === opp.opportunity_key}
                        onClick={() => handleUpdateStatus(opp.opportunity_key, 'reviewed')}
                        className="gap-1 text-xs h-8 bg-indigo-600 hover:bg-indigo-500 text-white"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Marcar Revisada</span>
                      </Button>
                    ) : (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                        Revisada
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                  <div className="flex items-center gap-3">
                    <span>
                      Responsável: <strong className="text-foreground">{opp.responsible_user_name}</strong>
                    </span>
                    {opp.next_action && (
                      <span>
                        Próxima Ação: <span className="text-foreground">{opp.next_action.title}</span>
                      </span>
                    )}
                  </div>

                  {opp.secondary_signals && opp.secondary_signals.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span>Sinais secundários:</span>
                      {opp.secondary_signals.map((sig, sIdx) => (
                        <span key={sIdx} className="px-1.5 py-0.5 rounded bg-muted text-foreground">
                          {sig}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* 5. Conversation Timeline & Review Modal */}
      {selectedConversationId && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl bg-card border-border shadow-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-sm text-foreground">
                  Revisão da Conversa: {conversationReview?.contact_name || '...'}
                </h4>
                <p className="text-xs text-muted-foreground">
                  Responsável: {conversationReview?.assigned_agent_name}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedConversationId(null);
                  setConversationReview(null);
                }}
              >
                ✕
              </Button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {reviewLoading ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Carregando timeline factual...
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Linha do Tempo Comercial
                  </div>

                  {(conversationReview?.timeline || []).map((ev, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-muted/40 border border-border/50 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="font-semibold text-foreground capitalize">
                          {ev.event_type}
                        </span>
                        <span>{new Date(ev.event_time).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-foreground">{ev.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex items-center justify-between">
              <a
                href={`/inbox?conversationId=${selectedConversationId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
              >
                <span>Abrir conversa completa</span>
                <ExternalLink className="h-3 w-3" />
              </a>

              <Button
                size="sm"
                onClick={() => {
                  handleUpdateStatus(`conv:${selectedConversationId}`, 'reviewed');
                  setSelectedConversationId(null);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
              >
                Concluir Revisão
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
