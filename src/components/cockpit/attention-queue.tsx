"use client";

import React from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Flame,
  Clock,
  User,
  ArrowRight,
  CheckCircle2,
  Phone,
  Package,
} from "lucide-react";
import type { AttentionQueueItem } from "@/lib/analytics/types";

interface AttentionQueueProps {
  items: AttentionQueueItem[];
  totalCount: number;
  urgentCount: number;
  highCount: number;
  mediumCount: number;
  priorityFilter: "all" | "urgent" | "high" | "medium";
  onPriorityFilterChange: (filter: "all" | "urgent" | "high" | "medium") => void;
  loading?: boolean;
}

export function AttentionQueue({
  items,
  totalCount,
  urgentCount,
  highCount,
  mediumCount,
  priorityFilter,
  onPriorityFilterChange,
  loading,
}: AttentionQueueProps) {
  const formatIdleTime = (seconds: number) => {
    if (seconds < 60) return "Agora";
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return (
          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[10px] font-bold uppercase tracking-wider">
            Urgente
          </Badge>
        );
      case "high":
        return (
          <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40 text-[10px] font-bold uppercase tracking-wider">
            Alto
          </Badge>
        );
      default:
        return (
          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[10px] font-bold uppercase tracking-wider">
            Médio
          </Badge>
        );
    }
  };

  const getScoreBadge = (score: number, tier: string) => {
    if (tier === "hot" || score >= 70) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30">
          <Flame className="h-3 w-3" /> {score}
        </span>
      );
    }
    if (tier === "warm" || score >= 40) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
          {score} pts
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground border border-border">
        {score} pts
      </span>
    );
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="p-5 pb-3 border-b border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                Precisa de Atenção
              </CardTitle>
              <Badge variant="secondary" className="font-sans text-xs">
                {totalCount} pendentes
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Oportunidades em risco, follow-ups atrasados e leads quentes sem ação.
            </p>
          </div>

          {/* Priority filter pills */}
          <div className="flex items-center gap-1 bg-secondary/70 p-1 rounded-lg border border-border/80 text-xs">
            <button
              onClick={() => onPriorityFilterChange("all")}
              className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                priorityFilter === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Todos ({totalCount})
            </button>
            <button
              onClick={() => onPriorityFilterChange("urgent")}
              className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                priorityFilter === "urgent"
                  ? "bg-rose-500/20 text-rose-300 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Urgente ({urgentCount})
            </button>
            <button
              onClick={() => onPriorityFilterChange("high")}
              className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                priorityFilter === "high"
                  ? "bg-orange-500/20 text-orange-300 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Alto ({highCount})
            </button>
            <button
              onClick={() => onPriorityFilterChange("medium")}
              className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                priorityFilter === "medium"
                  ? "bg-blue-500/20 text-blue-300 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Médio ({mediumCount})
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted/40 animate-pulse rounded-lg border border-border/40" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-400/80 mx-auto" />
            <h3 className="text-sm font-semibold text-foreground">Nenhum item pendente de atenção</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Excelente! Todos os leads quentes possuem acompanhamento ativo e não há follow-ups vencidos.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {getPriorityBadge(item.priority)}
                    <span className="font-semibold text-sm text-foreground truncate">
                      {item.contact_name}
                    </span>
                    {getScoreBadge(item.score, item.score_tier)}
                    {item.contact_phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {item.contact_phone}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/90">
                      {item.reason_label}
                    </span>
                    {item.product_name && (
                      <span className="inline-flex items-center gap-1 text-blue-400">
                        <Package className="h-3 w-3" /> {item.product_name}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <User className="h-3 w-3" /> {item.responsible_user_name}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> Parado há {formatIdleTime(item.idle_time_seconds)}
                    </span>
                  </div>

                  {item.signal_text && (
                    <p className="text-xs text-muted-foreground/90 line-clamp-1 italic bg-secondary/30 px-2.5 py-1 rounded border border-border/40">
                      &ldquo;{item.signal_text}&rdquo;
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <Link href={`/inbox?c=${item.conversation_id}`}>
                    <Button size="sm" className="h-8 text-xs font-semibold gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white shadow-xs">
                      <span>Abrir conversa</span>
                      <ArrowRight className="size-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
