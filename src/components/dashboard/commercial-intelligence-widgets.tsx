"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Flame,
  Shield,
  ShoppingBag,
  ListTodo,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CommercialAnalyticsSummary } from "@/types/analytics";
import { loadCommercialAnalytics } from "@/lib/analytics/commercial";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function CommercialIntelligenceWidgets() {
  const { accountId } = useAuth();
  const [data, setData] = useState<CommercialAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    if (!accountId) return;

    const db = createClient();
    loadCommercialAnalytics(db, accountId)
      .then((res) => {
        if (isMounted) setData(res);
      })
      .catch((err) => {
        console.error("Failed to load commercial analytics:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accountId]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="h-32 animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const { leadScores, topObjections, topInterests, tasks } = data;
  const hotPct =
    leadScores.totalScored > 0
      ? Math.round((leadScores.hotCount / leadScores.totalScored) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Inteligência Comercial & Sinais de Conversão
        </h3>
        <Badge variant="outline" className="text-[11px] font-normal">
          Atualizado em tempo real
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 1. LEAD SCORING PULSE */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Qualificação de Leads
              </CardTitle>
              <Flame className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-foreground">
                {leadScores.hotCount}
              </span>
              <span className="text-xs text-muted-foreground">
                {hotPct}% da base ({leadScores.totalScored} avaliados)
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>🔥 Hot ({leadScores.hotCount})</span>
                <span>⚡ Warm ({leadScores.warmCount})</span>
                <span>❄️ Cold ({leadScores.coldCount})</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${hotPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. TOP OBJECTIONS MATRIX */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Principais Objeções
              </CardTitle>
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            {topObjections.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nenhuma objeção em aberto.</p>
            ) : (
              <div className="space-y-1.5">
                {topObjections.slice(0, 3).map((obj) => (
                  <div key={obj.objection} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[130px] font-medium text-foreground">
                      {obj.objection}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {obj.resolutionRate}% resolvidas
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. TOP CATALOG DEMAND */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Catálogo em Alta
              </CardTitle>
              <ShoppingBag className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            {topInterests.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Sem produtos citados ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {topInterests.slice(0, 3).map((item) => (
                  <div key={item.itemId} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[140px] font-medium text-foreground">
                      {item.itemName}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {item.interestCount} leads
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. TASKS & FOLLOW-UP */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Follow-ups & Tarefas
              </CardTitle>
              <ListTodo className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Pendentes:</span>
              <span className="font-mono font-bold text-sm text-foreground">{tasks.pending}</span>
            </div>
            {tasks.overdue > 0 && (
              <div className="flex items-center justify-between text-xs text-rose-600 font-medium">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Atrasadas:
                </span>
                <span className="font-mono font-bold">{tasks.overdue}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-emerald-600 font-medium">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Concluídas Hoje:
              </span>
              <span className="font-mono font-bold">{tasks.completedToday}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
