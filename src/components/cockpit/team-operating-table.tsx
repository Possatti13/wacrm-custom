"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare, Clock, CheckCircle2, AlertTriangle, ShieldAlert, Flame } from "lucide-react";
import type { TeamPerformanceResponse } from "@/lib/analytics/types";

interface TeamOperatingTableProps {
  data: TeamPerformanceResponse;
  loading?: boolean;
}

export function TeamOperatingTable({ data, loading }: TeamOperatingTableProps) {
  const formatDuration = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return "—";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <Card className="border-border/70 shadow-sm animate-pulse">
        <CardHeader className="p-5">
          <div className="h-6 w-48 bg-muted rounded mb-2" />
          <div className="h-4 w-64 bg-muted rounded" />
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/40 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { team = [] } = data;

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="p-5 pb-3 border-b border-border/40">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                Operação da Equipe & Atendimento
              </CardTitle>
              <Badge variant="secondary" className="font-sans text-xs">
                {team.length} {team.length === 1 ? "membro" : "membros"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Métricas factuais de conversas atendidas, velocidade de resposta e disciplina de follow-up.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {team.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Nenhum membro da equipe com atividade registrada no período.
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {team.map((member, idx) => (
              <div
                key={idx}
                className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
              >
                {/* Member Identity */}
                <div className="flex items-center gap-3 min-w-[200px]">
                  <Avatar className="h-9 w-9 border border-border">
                    <AvatarImage src={member.avatar_url || undefined} alt={member.full_name} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                      {getInitials(member.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">
                        {member.full_name}
                      </span>
                      <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                        {member.role}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{member.email}</span>
                  </div>
                </div>

                {/* Operational Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4 text-xs flex-1">
                  {/* Conversations & Messages */}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Conversas / Msg</span>
                    <span className="font-bold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                      {member.conversations_handled} / {member.messages_sent}
                    </span>
                  </div>

                  {/* Response Speed */}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Resposta Mediana (P90)</span>
                    <span className="font-bold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-indigo-400" />
                      {formatDuration(member.median_response_seconds)}
                      <span className="text-[11px] text-muted-foreground font-normal">
                        ({formatDuration(member.p90_response_seconds)})
                      </span>
                    </span>
                  </div>

                  {/* Follow-ups */}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Follow-ups Concluídos</span>
                    <span className="font-bold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      {member.followups_completed}
                      {member.followups_on_time_pct !== null && (
                        <span className="text-[11px] text-emerald-400 font-semibold">
                          ({member.followups_on_time_pct}% prazo)
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Overdue */}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Tarefas Atrasadas</span>
                    <span
                      className={`font-bold text-sm flex items-center gap-1 mt-0.5 ${
                        member.followups_overdue > 0 ? "text-rose-400" : "text-foreground"
                      }`}
                    >
                      {member.followups_overdue > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
                      {member.followups_overdue}
                    </span>
                  </div>

                  {/* Objections & Hot Leads coaching */}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Objeções / Leads s/ Ação</span>
                    <span className="font-semibold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <ShieldAlert className="h-3.5 w-3.5 text-purple-400" />
                      {member.objections_encountered}
                      {member.hot_leads_without_action > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-orange-400 font-bold ml-1 text-xs">
                          • <Flame className="h-3 w-3" /> {member.hot_leads_without_action} quentes
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
