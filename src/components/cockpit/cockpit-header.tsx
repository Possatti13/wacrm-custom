"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, RefreshCw, Globe } from "lucide-react";
import type { PeriodRange } from "@/lib/analytics/types";

interface CockpitHeaderProps {
  range: PeriodRange;
  onRangeChange: (range: PeriodRange) => void;
  timezone?: string;
  lastAnalysisAt?: string | null;
  loading: boolean;
  onRefresh: () => void;
}

export function CockpitHeader({
  range,
  onRangeChange,
  timezone = "America/Sao_Paulo",
  lastAnalysisAt,
  loading,
  onRefresh,
}: CockpitHeaderProps) {
  const getFreshnessText = () => {
    if (!lastAnalysisAt) return "Dados atualizados recentemente";
    const diffMs = Date.now() - new Date(lastAnalysisAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Atualizado agora";
    if (diffMins < 60) return `Atualizado há ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    return `Atualizado há ${diffHours}h`;
  };

  const ranges: { key: PeriodRange; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "month", label: "Este mês" },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border/50">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-serif text-foreground">
            Manager Cockpit
          </h1>
          <Badge
            variant="outline"
            className="border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-sans font-medium"
          >
            V1.4 Operating View
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Visão gerencial da operação comercial, triagem de atenção e inteligência de conversas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Timezone pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary/50 border border-border/60 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          <span>{timezone}</span>
        </div>

        {/* Freshness indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary/50 border border-border/60 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-blue-400" />
          <span>{getFreshnessText()}</span>
        </div>

        {/* Period Selector Tabs */}
        <div className="inline-flex rounded-lg bg-secondary/80 p-1 border border-border">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => onRangeChange(r.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                range === r.key
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
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
          className="h-8 px-2.5 border-border hover:bg-secondary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-400" : ""}`} />
        </Button>
      </div>
    </div>
  );
}
