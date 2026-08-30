'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, RefreshCw, Globe, Sparkles } from 'lucide-react';
import type { PeriodRange } from '@/lib/analytics/types';

interface CockpitHeaderProps {
  range: PeriodRange;
  onRangeChange: (range: PeriodRange) => void;
  timezone?: string;
  lastAnalysisAt?: string | null;
  evaluatedAt?: string | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenAskCiclopes?: () => void;
}

export function CockpitHeader({
  range,
  onRangeChange,
  timezone = 'America/Sao_Paulo',
  lastAnalysisAt,
  evaluatedAt,
  loading,
  onRefresh,
  onOpenAskCiclopes,
}: CockpitHeaderProps) {
  const getFreshnessText = () => {
    if (!lastAnalysisAt) return 'Dados atualizados recentemente';
    const evalTime = evaluatedAt ? new Date(evaluatedAt).getTime() : 0;
    const analysisTime = new Date(lastAnalysisAt).getTime();
    if (!evalTime || isNaN(evalTime) || isNaN(analysisTime)) {
      return 'Dados atualizados';
    }
    const diffMs = Math.max(0, evalTime - analysisTime);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Atualizado agora';
    if (diffMins < 60) return `Atualizado há ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    return `Atualizado há ${diffHours}h`;
  };

  const ranges: { key: PeriodRange; label: string }[] = [
    { key: 'today', label: 'Hoje' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'month', label: 'Este mês' },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/70">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-sans text-foreground">
            Cockpit Operacional
          </h1>
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/10 text-primary text-[11px] font-sans font-semibold"
          >
            Gestão Ativa
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Visão estratégica da operação comercial, triagem de atenção e inteligência de conversas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {/* Ask Ciclopes AI Action Button matching Visual Reference 3 */}
        {onOpenAskCiclopes && (
          <Button
            onClick={onOpenAskCiclopes}
            size="sm"
            className="h-8 text-xs gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white font-semibold shadow-xs rounded-lg cursor-pointer"
          >
            <Sparkles className="size-3.5 text-[#D16A3A]" />
            <span>Pergunte ao Ciclopes</span>
          </Button>
        )}

        {/* Freshness indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border/70 text-xs text-muted-foreground">
          <Clock className="size-3 text-primary" />
          <span>{getFreshnessText()}</span>
        </div>

        {/* Period Selector Tabs */}
        <div className="inline-flex rounded-lg bg-muted/60 p-0.5 border border-border/70">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => onRangeChange(r.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                range === r.key
                  ? 'bg-card text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="size-8 p-0 border-border/70 hover:bg-muted"
          title="Atualizar dados"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
        </Button>
      </div>
    </div>
  );
}
