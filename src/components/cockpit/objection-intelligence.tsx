"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Quote, ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ObjectionDrilldownDrawer } from "./objection-drilldown-drawer";
import type { ObjectionAnalyticsResponse, PeriodRange } from "@/lib/analytics/types";

interface ObjectionIntelligenceProps {
  analytics: ObjectionAnalyticsResponse;
  accountId: string;
  range: PeriodRange;
  loading?: boolean;
}

export function ObjectionIntelligence({
  analytics,
  accountId,
  range,
  loading,
}: ObjectionIntelligenceProps) {
  const [selectedTaxonomy, setSelectedTaxonomy] = useState<{
    code: string;
    name: string;
  } | null>(null);

  if (loading) {
    return (
      <Card className="border-border/70 shadow-sm animate-pulse">
        <CardHeader className="p-5">
          <div className="h-6 w-48 bg-muted rounded mb-2" />
          <div className="h-4 w-64 bg-muted rounded" />
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/40 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { top_objections = [], total_count = 0 } = analytics;

  return (
    <>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="p-5 pb-3 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                  Inteligência de Objeções
                </CardTitle>
                <Badge variant="secondary" className="font-sans text-xs">
                  {total_count} ocorrências
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Principais resistências e atritos comerciais extraídos diretamente das conversas.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-5">
          {top_objections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              Ainda não há ocorrências de objeções registradas neste período.
            </div>
          ) : (
            top_objections.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-border/50 bg-secondary/20 hover:border-border transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {item.name}
                    </span>
                    <Badge variant="outline" className="text-[11px] font-medium border-border/80">
                      {item.count} {item.count === 1 ? "ocorrência" : "ocorrências"} ({item.percentage}%)
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3">
                    {item.delta_pct !== null && item.delta_pct !== undefined ? (
                      <span
                        className={`text-xs font-semibold flex items-center gap-0.5 ${
                          item.delta_pct > 0 ? "text-rose-400" : item.delta_pct < 0 ? "text-emerald-400" : "text-muted-foreground"
                        }`}
                      >
                        {item.delta_pct > 0 ? (
                          <TrendingUp className="h-3.5 w-3.5" />
                        ) : item.delta_pct < 0 ? (
                          <TrendingDown className="h-3.5 w-3.5" />
                        ) : (
                          <Minus className="h-3 w-3" />
                        )}
                        {Math.abs(item.delta_pct)}% vs anterior
                      </span>
                    ) : null}

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-semibold gap-1 border-border/80 hover:bg-secondary"
                      onClick={() =>
                        setSelectedTaxonomy({
                          code: item.code,
                          name: item.name,
                        })
                      }
                    >
                      <span>Ver ocorrências</span>
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Progress bar visualizer */}
                <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden border border-border/30">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, item.percentage)}%` }}
                  />
                </div>

                {/* Sample Quote from Real Evidence */}
                {item.sample_quote && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground italic bg-background/60 p-2.5 rounded-lg border border-border/40">
                    <Quote className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">&ldquo;{item.sample_quote}&rdquo;</span>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Drill-down Drawer */}
      <ObjectionDrilldownDrawer
        open={!!selectedTaxonomy}
        onOpenChange={(open) => !open && setSelectedTaxonomy(null)}
        accountId={accountId}
        taxonomyCode={selectedTaxonomy?.code || null}
        taxonomyName={selectedTaxonomy?.name || null}
        range={range}
      />
    </>
  );
}
