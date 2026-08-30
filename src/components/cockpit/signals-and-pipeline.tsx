"use client";

import React from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, CheckCircle2, AlertCircle, GitBranch, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { SignalsAndPipelineResponse } from "@/lib/analytics/types";

interface SignalsAndPipelineProps {
  data: SignalsAndPipelineResponse;
  currency?: string;
  loading?: boolean;
}

export function SignalsAndPipeline({
  data,
  currency = "BRL",
  loading,
}: SignalsAndPipelineProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/70 shadow-sm animate-pulse h-64" />
        <Card className="border-border/70 shadow-sm animate-pulse h-64" />
      </div>
    );
  }

  const { buying_signals = [], pipeline_snapshot } = data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Buying Signals */}
      <Card className="border-border/70 shadow-sm flex flex-col">
        <CardHeader className="p-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                  Sinais de Compra Recentes
                </CardTitle>
                <Badge variant="secondary" className="font-sans text-xs">
                  {buying_signals.length} {buying_signals.length === 1 ? "sinal" : "sinais"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Intenção explícita de fechamento identificada pelo motor no período.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 flex-1 overflow-y-auto max-h-[350px] space-y-3">
          {buying_signals.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">
              Nenhum sinal de compra registrado neste período.
            </div>
          ) : (
            buying_signals.map((sig, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl border border-border/50 bg-secondary/20 hover:border-border transition-all space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">
                      {sig.contact_name}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        sig.score_tier === "hot"
                          ? "border-orange-500/40 text-orange-400"
                          : "border-blue-500/40 text-blue-400"
                      }`}
                    >
                      {sig.score} pts
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    {sig.has_followup ? (
                      <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Follow-up ativo
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" /> Sem follow-up
                      </span>
                    )}

                    <Link href={`/inbox?conversationId=${sig.conversation_id}`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs p-1.5 text-blue-400 hover:text-blue-300">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>

                <p className="text-xs text-foreground/90 bg-background/60 p-2 rounded-lg border border-border/30 italic">
                  "{sig.signal_text}"
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Pipeline Stages Snapshot */}
      <Card className="border-border/70 shadow-sm flex flex-col">
        <CardHeader className="p-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                  Pipeline Atual (Snapshot)
                </CardTitle>
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                  {pipeline_snapshot?.total_open_deals || 0} negócios abertos
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Distribuição atual de negócios ativos por estágio do pipeline comercial.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 flex-1 space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
            <span className="text-muted-foreground font-medium">Valor Total em Negociação</span>
            <span className="text-sm font-bold text-foreground">
              {formatCurrency(pipeline_snapshot?.total_open_value || 0, currency)}
            </span>
          </div>

          <div className="space-y-3">
            {(!pipeline_snapshot?.stages || pipeline_snapshot.stages.length === 0) ? (
              <div className="text-center py-8 text-muted-foreground text-xs">
                Nenhum estágio de pipeline configurado.
              </div>
            ) : (
              pipeline_snapshot.stages.map((st, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{st.stage_name}</span>
                    <span className="text-muted-foreground">
                      {st.deals_count} {st.deals_count === 1 ? "negócio" : "negócios"} • {formatCurrency(st.total_value, currency)}
                    </span>
                  </div>
                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden border border-border/30">
                    <div
                      className="bg-indigo-500 h-full rounded-full"
                      style={{
                        width: `${
                          pipeline_snapshot.total_open_deals > 0
                            ? (st.deals_count / pipeline_snapshot.total_open_deals) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
