'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  loadManagerCockpitSummary,
  loadManagerAttentionQueue,
  loadManagerObjectionAnalytics,
  loadManagerProductIntelligence,
  loadManagerTeamPerformance,
  loadManagerSignalsAndPipeline,
} from '@/lib/analytics/manager-cockpit-repository';
import type {
  ManagerCockpitSummary,
  AttentionQueueResponse,
  ObjectionAnalyticsResponse,
  ProductIntelligenceResponse,
  TeamPerformanceResponse,
  SignalsAndPipelineResponse,
  PeriodRange,
} from '@/lib/analytics/types';

import { CockpitHeader } from '@/components/cockpit/cockpit-header';
import { ExecutivePulse } from '@/components/cockpit/executive-pulse';
import { WhatChanged } from '@/components/cockpit/what-changed';
import { AttentionQueue } from '@/components/cockpit/attention-queue';
import { ObjectionIntelligence } from '@/components/cockpit/objection-intelligence';
import { ProductFrictionMatrix } from '@/components/cockpit/product-friction-matrix';
import { TeamOperatingTable } from '@/components/cockpit/team-operating-table';
import { SignalsAndPipeline } from '@/components/cockpit/signals-and-pipeline';
import { OperationalHealthFooter } from '@/components/cockpit/operational-health-footer';
import { AskCiclopesPanel } from '@/components/cockpit/ask-ciclopes-panel';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ListTodo, MessageSquare, ShieldAlert } from 'lucide-react';

export default function DashboardPage() {
  const { accountId, profile, defaultCurrency, loading: authLoading } = useAuth();

  const [range, setRange] = useState<PeriodRange>('30d');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium'>('all');
  const [isAskCiclopesOpen, setIsAskCiclopesOpen] = useState(false);

  const [summary, setSummary] = useState<ManagerCockpitSummary | null>(null);
  const [attention, setAttention] = useState<AttentionQueueResponse | null>(null);
  const [objections, setObjections] = useState<ObjectionAnalyticsResponse | null>(null);
  const [products, setProducts] = useState<ProductIntelligenceResponse | null>(null);
  const [team, setTeam] = useState<TeamPerformanceResponse | null>(null);
  const [signals, setSignals] = useState<SignalsAndPipelineResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userRole = profile?.account_role || 'agent';
  const isManager = userRole === 'owner' || userRole === 'admin';

  const loadAll = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);

    const db = createClient();

    try {
      if (isManager) {
        const [sumRes, attRes, objRes, prodRes, teamRes, sigRes] = await Promise.all([
          loadManagerCockpitSummary(db, accountId, range),
          loadManagerAttentionQueue(db, accountId, priorityFilter, 20, 0),
          loadManagerObjectionAnalytics(db, accountId, range),
          loadManagerProductIntelligence(db, accountId, range),
          loadManagerTeamPerformance(db, accountId, range),
          loadManagerSignalsAndPipeline(db, accountId, range),
        ]);

        setSummary(sumRes);
        setAttention(attRes);
        setObjections(objRes);
        setProducts(prodRes);
        setTeam(teamRes);
        setSignals(sigRes);
      }
    } catch (err: unknown) {
      console.error('[DashboardPage] loadAll failed:', err);
      const msg = err instanceof Error ? err.message : 'Erro ao carregar dados do cockpit.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [accountId, range, priorityFilter, isManager]);

  useEffect(() => {
    if (!authLoading && accountId) {
      loadAll().catch((err) => console.error('Error loading cockpit:', err));
    }
  }, [authLoading, accountId, loadAll]);

  const handlePriorityFilterChange = async (newFilter: 'all' | 'urgent' | 'high' | 'medium') => {
    setPriorityFilter(newFilter);
    if (!accountId || !isManager) return;

    setAttentionLoading(true);
    const db = createClient();
    try {
      const attRes = await loadManagerAttentionQueue(db, accountId, newFilter, 20, 0);
      setAttention(attRes);
    } catch (err) {
      console.error('Failed to filter attention queue:', err);
    } finally {
      setAttentionLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl space-y-6">
        <div className="h-10 w-48 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 bg-muted/60 animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Seller View (Role Isolation)
  if (!isManager) {
    return (
      <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6 py-12">
        <Card className="border-border text-center p-8 space-y-4 shadow-sm">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
            <MessageSquare className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold font-serif text-foreground">
            Painel do Vendedor
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            O Manager Cockpit é restrito à gestão comercial. Como vendedor, utilize sua fila de atendimento na Caixa de Entrada e gerencie seus follow-ups diários.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/inbox">
              <Button variant="default" className="gap-2 font-semibold">
                <MessageSquare className="h-4 w-4" />
                <span>Minha Caixa de Entrada</span>
              </Button>
            </Link>
            <Link href="/tasks">
              <Button variant="outline" className="gap-2 font-semibold border-border">
                <ListTodo className="h-4 w-4" />
                <span>Meus Follow-ups</span>
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl space-y-6">
      {/* 1. Header with Period Selector & Freshness */}
      <CockpitHeader
        range={range}
        onRangeChange={setRange}
        timezone={summary?.period.timezone}
        lastAnalysisAt={summary?.data_freshness.last_analysis_at}
        evaluatedAt={summary?.data_freshness.evaluated_at}
        loading={loading}
        onRefresh={loadAll}
        onOpenAskCiclopes={() => setIsAskCiclopesOpen(true)}
      />

      {/* Error alert if any */}
      {error && (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Executive Pulse (Top 5 KPIs with deltas) */}
      {summary && (
        <ExecutivePulse
          pulse={summary.executive_pulse}
          loading={loading}
        />
      )}

      {/* 3. What Changed? (Highlights from deltas) */}
      {summary?.what_changed && (
        <WhatChanged highlights={summary.what_changed} />
      )}

      {/* 4. Attention Queue (Triage & Actions) */}
      {attention && (
        <AttentionQueue
          items={attention.items}
          totalCount={attention.total_count}
          urgentCount={attention.urgent_count}
          highCount={attention.high_count}
          mediumCount={attention.medium_count}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={handlePriorityFilterChange}
          loading={attentionLoading || loading}
        />
      )}

      {/* 5. Objections & Product Friction Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {objections && accountId && (
          <ObjectionIntelligence
            analytics={objections}
            accountId={accountId}
            range={range}
            loading={loading}
          />
        )}

        {products && (
          <ProductFrictionMatrix
            data={products}
            loading={loading}
          />
        )}
      </div>

      {/* 6. Team Operational Performance */}
      {team && (
        <TeamOperatingTable
          data={team}
          loading={loading}
        />
      )}

      {/* 7. Signals & Pipeline Snapshot */}
      {signals && (
        <SignalsAndPipeline
          data={signals}
          currency={defaultCurrency}
          loading={loading}
        />
      )}

      {/* 8. Operational Health Footer */}
      {summary?.operational_health && (
        <OperationalHealthFooter
          health={summary.operational_health}
          loading={loading}
        />
      )}

      {/* 9. Ask Ciclopes Grounded AI Drawer */}
      <AskCiclopesPanel
        isOpen={isAskCiclopesOpen}
        onClose={() => setIsAskCiclopesOpen(false)}
      />
    </div>
  );
}
