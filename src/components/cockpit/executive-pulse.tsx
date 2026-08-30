"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Flame, ClockAlert, AlertCircle, ShieldAlert, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { ExecutivePulse as ExecutivePulseData } from "@/lib/analytics/types";

interface ExecutivePulseProps {
  pulse: ExecutivePulseData;
  loading?: boolean;
}

export function ExecutivePulse({ pulse, loading }: ExecutivePulseProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="animate-pulse bg-card/60 border-border/50">
            <CardContent className="p-5">
              <div className="h-4 w-24 bg-muted rounded mb-3" />
              <div className="h-8 w-16 bg-muted rounded mb-2" />
              <div className="h-3 w-28 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const formatDelta = (deltaPct: number | null | undefined, invert: boolean = false) => {
    if (deltaPct === null || deltaPct === undefined) {
      return (
        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
          <Minus className="h-3 w-3" /> sem histórico
        </span>
      );
    }

    const isPositive = deltaPct > 0;
    const isNeutral = deltaPct === 0;

    let colorClass = "text-emerald-400";
    if ((isPositive && invert) || (!isPositive && !invert)) {
      colorClass = "text-rose-400";
    }
    if (isNeutral) colorClass = "text-muted-foreground";

    return (
      <span className={`text-xs font-semibold flex items-center gap-0.5 ${colorClass}`}>
        {isPositive ? (
          <ArrowUpRight className="h-3.5 w-3.5" />
        ) : !isNeutral ? (
          <ArrowDownRight className="h-3.5 w-3.5" />
        ) : (
          <Minus className="h-3 w-3" />
        )}
        {Math.abs(deltaPct)}% vs anterior
      </span>
    );
  };

  const cards = [
    {
      title: "Leads Ativos",
      value: pulse.active_leads.current,
      delta: formatDelta(pulse.active_leads.delta_pct),
      icon: Users,
      iconColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      description: "Contatos com mensagens no período",
    },
    {
      title: "Leads Quentes",
      value: pulse.hot_leads.current,
      delta: (
        <span className="text-xs text-muted-foreground">
          {pulse.hot_leads.warm} mornos • {pulse.hot_leads.cold} frios
        </span>
      ),
      icon: Flame,
      iconColor: "text-orange-400 bg-orange-500/10 border-orange-500/20",
      description: "Score comercial ≥ 70 pontos",
    },
    {
      title: "Follow-ups Atrasados",
      value: pulse.overdue_followups.current,
      delta: (
        <span className="text-xs text-rose-400/90 font-medium">
          Backlog atual pendente
        </span>
      ),
      icon: ClockAlert,
      iconColor: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      description: "Tarefas vencidas no momento",
    },
    {
      title: "Sem Próxima Ação",
      value: pulse.leads_without_next_action.current,
      delta: (
        <span className="text-xs text-amber-400/90 font-medium">
          Ação prioritária de equipe
        </span>
      ),
      icon: AlertCircle,
      iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      description: "Leads ativos sem tarefa aberta",
    },
    {
      title: "Objeções no Período",
      value: pulse.period_objections.current,
      delta: formatDelta(pulse.period_objections.delta_pct, true),
      icon: ShieldAlert,
      iconColor: "text-purple-400 bg-purple-500/10 border-purple-500/20",
      description: "Ocorrências registradas pelo motor",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <Card
            key={idx}
            className="border-border/60 bg-card hover:border-border transition-all duration-200 shadow-sm"
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {card.title}
                </span>
                <div className={`p-2 rounded-lg border ${card.iconColor}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="text-3xl font-bold font-sans text-foreground tracking-tight">
                {card.value}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                {card.delta}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground/80 truncate">
                {card.description}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
