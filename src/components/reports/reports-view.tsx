"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import {
  BarChart3,
  Clock,
  Flame,
  CheckCircle2,
  ShoppingBag,
  DollarSign,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversationsChart } from "@/components/dashboard/conversations-chart";
import { PipelineDonut } from "@/components/dashboard/pipeline-donut";
import { ResponseTimeChart } from "@/components/dashboard/response-time-chart";
import {
  loadConversationsSeries,
  loadPipelineDonut,
  loadResponseTime,
  loadMetrics,
} from "@/lib/dashboard/queries";
import { loadCommercialAnalytics } from "@/lib/analytics/commercial";
import type {
  ConversationsSeriesPoint,
  PipelineDonutData,
  ResponseTimeSummary,
  MetricsBundle,
} from "@/lib/dashboard/types";
import type { CommercialAnalyticsSummary } from "@/types/analytics";

type RangeDays = 7 | 30 | 90;

export function ReportsView() {
  const { accountId, defaultCurrency } = useAuth();
  const [range, setRange] = useState<RangeDays>(30);
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  });
  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null);
  const [commercialData, setCommercialData] = useState<CommercialAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const db = createClient();

    try {
      const [m, s, p, r, c] = await Promise.all([
        loadMetrics(db),
        loadConversationsSeries(db, range),
        loadPipelineDonut(db),
        loadResponseTime(db),
        loadCommercialAnalytics(db, accountId),
      ]);

      setMetrics(m);
      setSeries((prev) => ({ ...prev, [range]: s }));
      setPipeline(p);
      setResponseTime(r);
      setCommercialData(c);
    } catch (err) {
      console.error("Failed to load reports data:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId, range]);

  useEffect(() => {
    let isMounted = true;
    if (!accountId) return;

    loadData().catch((err) => {
      console.error("Failed to load reports:", err);
    });

    return () => {
      isMounted = false;
    };
  }, [loadData, accountId]);

  const handleRangeChange = (r: RangeDays) => {
    setRange(r);
  };

  const totalDealsInPipeline = pipeline?.stages.reduce((acc, s) => acc + s.dealCount, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header & Period Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground font-sans flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#1E3A5F] dark:text-[#5B8EC2]" />
            Relatórios & Indicadores Comerciais
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Métricas de atendimento, conversão de funil, disciplina de follow-up e demanda do catálogo.
          </p>
        </div>

        <Tabs value={String(range)} onValueChange={(v) => handleRangeChange(Number(v) as RangeDays)}>
          <TabsList className="h-8">
            <TabsTrigger value="7" className="text-xs px-3">7 dias</TabsTrigger>
            <TabsTrigger value="30" className="text-xs px-3">30 dias</TabsTrigger>
            <TabsTrigger value="90" className="text-xs px-3">90 dias</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Top Executive KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pipeline em Negociação
              </CardTitle>
              <DollarSign className="h-4 w-4 text-[#1E3A5F] dark:text-[#5B8EC2]" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">
              {formatCurrency(metrics?.openDealsValue ?? 0, defaultCurrency)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {totalDealsInPipeline} negócios em andamento
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tempo Médio 1ª Resposta
              </CardTitle>
              <Clock className="h-4 w-4 text-[#D16A3A]" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">
              {responseTime?.thisWeekAvg != null ? `${responseTime.thisWeekAvg} min` : "—"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Média móvel dos atendimentos
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Leads Quentes (Hot)
              </CardTitle>
              <Flame className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">
              {commercialData?.leadScores.hotCount ?? 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Score &ge; 70 ({commercialData?.leadScores.totalScored ?? 0} avaliados)
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Follow-ups Realizados
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">
              {commercialData?.tasks.completedToday ?? 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {commercialData?.tasks.pending ?? 0} tarefas pendentes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Analytical Visualizations */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ConversationsChart
          series={series}
          range={range}
          onRangeChange={handleRangeChange}
          loading={loading}
        />

        <PipelineDonut
          data={pipeline}
          loading={loading}
          currency={defaultCurrency}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ResponseTimeChart
          data={responseTime}
          loading={loading}
        />

        {/* Catalog & Demand Breakdown Card */}
        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-5 pb-3 border-b border-border/60">
            <CardTitle className="text-sm font-semibold text-foreground font-sans flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-[#1E3A5F] dark:text-[#5B8EC2]" />
              Produtos & Serviços Mais Demandados
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Itens do catálogo com maior número de menções qualificadas pelos clientes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {!commercialData?.topInterests || commercialData.topInterests.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                Sem dados de catálogo ainda. Cadastre produtos em Catálogo para ativar o rastreamento.
              </p>
            ) : (
              <div className="space-y-3">
                {commercialData.topInterests.slice(0, 5).map((it) => (
                  <div key={it.itemId} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{it.itemName}</span>
                    <Badge variant="outline" className="text-xs font-mono border-border">
                      {it.interestCount} intenções
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
