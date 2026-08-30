"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, UserX, AlertCircle, Cpu, Clock } from "lucide-react";
import type { OperationalHealth as OperationalHealthData } from "@/lib/analytics/types";

interface OperationalHealthFooterProps {
  health: OperationalHealthData;
  loading?: boolean;
}

export function OperationalHealthFooter({ health, loading }: OperationalHealthFooterProps) {
  if (loading) {
    return <div className="h-16 bg-muted/40 animate-pulse rounded-xl border border-border/40" />;
  }

  const { intelligence_status } = health;

  return (
    <div className="p-4 rounded-xl border border-border/60 bg-secondary/30 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-blue-400 shrink-0" />
        <span className="font-semibold text-foreground">Saúde Operacional do Sistema</span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <UserX className="h-3.5 w-3.5 text-amber-400" />
          <strong className="text-foreground">{health.unassigned_conversations}</strong> conversas sem responsável
        </span>

        <span className="flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
          <strong className="text-foreground">{health.unassigned_followups}</strong> tarefas sem responsável
        </span>

        <span className="flex items-center gap-1">
          <Cpu className="h-3.5 w-3.5 text-indigo-400" />
          Motor IA:{" "}
          <strong className="text-foreground">
            {intelligence_status.enabled ? intelligence_status.invocation_mode : "Desativado"}
          </strong>
          {intelligence_status.backlog_count > 0 && (
            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-400 ml-1">
              {intelligence_status.backlog_count} na fila
            </Badge>
          )}
        </span>
      </div>
    </div>
  );
}
