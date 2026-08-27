"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Eye,
  Flame,
  ArrowRight,
  Sparkles,
  MessageSquare,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HotLead {
  contactId: string;
  contactName: string;
  contactPhone: string;
  score: number;
  intent: string;
  urgency: string;
  lastConversationId?: string;
  calculatedAt: string;
}

interface RecentSignal {
  id: string;
  insightType: string;
  value: string;
  verbatimQuote?: string;
  confidence: number;
  contactName?: string;
  conversationId: string;
  createdAt: string;
}

interface StageSuggestion {
  id: string;
  dealId: string;
  dealTitle: string;
  contactName: string;
  currentStageName: string;
  suggestedStageName: string;
  suggestedStageId: string;
  reason: string;
  createdAt: string;
}

interface DbScoreRow {
  score: number;
  calculated_at: string;
  contact_id: string;
  contacts?: { id: string; name: string | null; phone: string } | null;
}

interface DbInsightRow {
  id: string;
  insight_type: string;
  insight_value: unknown;
  confidence: number;
  created_at: string;
  conversation_id: string;
  conversations?: {
    contact_id: string;
    contacts?: { name: string | null } | null;
  } | null;
}

interface DbSuggestionRow {
  id: string;
  deal_id: string;
  suggested_stage_id: string;
  suggestion_reason: string | null;
  created_at: string;
  deals?: {
    title: string;
    contact_id: string | null;
    contacts?: { name: string | null } | null;
    pipeline_stages?: { name: string } | null;
  } | null;
}

async function fetchIntelligenceCenterData(accountId: string) {
  const db = createClient();

  // 1. Fetch Top Scored Leads
  const { data: scores } = await db
    .from("contact_lead_scores")
    .select("score, calculated_at, contacts(id, name, phone), contact_id")
    .eq("account_id", accountId)
    .order("score", { ascending: false })
    .limit(10);

  const scoreRows = (scores || []) as unknown as DbScoreRow[];
  const mappedLeads: HotLead[] = scoreRows.map((s) => ({
    contactId: s.contact_id,
    contactName: s.contacts?.name || s.contacts?.phone || "Contato",
    contactPhone: s.contacts?.phone || "",
    score: s.score,
    intent: s.score >= 70 ? "Compra / Contratação" : "Interesse Geral",
    urgency: s.score >= 80 ? "Alta" : "Média",
    calculatedAt: s.calculated_at,
  }));

  // 2. Fetch Recent Insights & Signals
  const { data: insights } = await db
    .from("conversation_insights")
    .select("id, insight_type, insight_value, confidence, created_at, conversation_id, conversations(contact_id, contacts(name))")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(15);

  const insightRows = (insights || []) as unknown as DbInsightRow[];
  const mappedSignals: RecentSignal[] = insightRows.map((i) => ({
    id: i.id,
    insightType: i.insight_type,
    value: typeof i.insight_value === "object" ? JSON.stringify(i.insight_value) : String(i.insight_value),
    confidence: i.confidence,
    contactName: i.conversations?.contacts?.name || "Cliente",
    conversationId: i.conversation_id,
    createdAt: i.created_at,
  }));

  // 3. Fetch Stage Suggestions
  const { data: suggestions } = await db
    .from("deal_stage_suggestions")
    .select("id, deal_id, suggested_stage_id, suggestion_reason, created_at, deals(title, contact_id, contacts(name), pipeline_stages(name))")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: allStages } = await db
    .from("pipeline_stages")
    .select("id, name")
    .eq("account_id", accountId);

  const stageRows = (allStages || []) as Array<{ id: string; name: string }>;
  const stageMap = new Map(stageRows.map((st) => [st.id, st.name]));
  const sugRows = (suggestions || []) as unknown as DbSuggestionRow[];

  const mappedSuggestions: StageSuggestion[] = sugRows.map((s) => ({
    id: s.id,
    dealId: s.deal_id,
    dealTitle: s.deals?.title || "Oportunidade",
    contactName: s.deals?.contacts?.name || "Cliente",
    currentStageName: s.deals?.pipeline_stages?.name || "Etapa Atual",
    suggestedStageName: stageMap.get(s.suggested_stage_id) || "Nova Etapa",
    suggestedStageId: s.suggested_stage_id,
    reason: s.suggestion_reason || "Identificado avanço significativo na conversa",
    createdAt: s.created_at,
  }));

  return {
    hotLeads: mappedLeads,
    recentSignals: mappedSignals,
    stageSuggestions: mappedSuggestions,
  };
}

export function IntelligenceCenterView() {
  const { accountId } = useAuth();
  const [hotLeads, setHotLeads] = useState<HotLead[]>([]);
  const [recentSignals, setRecentSignals] = useState<RecentSignal[]>([]);
  const [stageSuggestions, setStageSuggestions] = useState<StageSuggestion[]>([]);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;
    if (!accountId) return;

    fetchIntelligenceCenterData(accountId)
      .then((data) => {
        if (!isMounted) return;
        setHotLeads(data.hotLeads);
        setRecentSignals(data.recentSignals);
        setStageSuggestions(data.stageSuggestions);
      })
      .catch((err) => {
        console.error("Failed to load intelligence data:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [accountId, refreshIndex]);

  const handleApplyStageSuggestion = async (suggestion: StageSuggestion) => {
    if (!accountId) return;
    const db = createClient();
    try {
      // 1. Update deal stage
      await db
        .from("deals")
        .update({ stage_id: suggestion.suggestedStageId, updated_at: new Date().toISOString() })
        .eq("account_id", accountId)
        .eq("id", suggestion.dealId);

      // 2. Mark suggestion applied
      await db
        .from("deal_stage_suggestions")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("account_id", accountId)
        .eq("id", suggestion.id);

      toast.success(`Oportunidade movida para "${suggestion.suggestedStageName}"!`);
      setRefreshIndex((prev) => prev + 1);
    } catch {
      toast.error("Erro ao aplicar sugestão.");
    }
  };

  const handleDismissSuggestion = async (suggestionId: string) => {
    if (!accountId) return;
    const db = createClient();
    try {
      await db
        .from("deal_stage_suggestions")
        .update({ status: "dismissed" })
        .eq("account_id", accountId)
        .eq("id", suggestionId);

      toast.info("Sugestão ignorada.");
      setRefreshIndex((prev) => prev + 1);
    } catch {
      toast.error("Erro ao ignorar sugestão.");
    }
  };

  const totalHot = hotLeads.filter((l) => l.score >= 70).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground font-sans flex items-center gap-2">
            <Eye className="h-5 w-5 text-[#D16A3A]" />
            Central de Inteligência Comercial
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Consolidação executiva de sinais de compra, propensão de fechamento e sugestões de avanço de pipeline.
          </p>
        </div>
        <Link href="/inbox">
          <Button className="bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground gap-2 font-medium text-xs shadow-sm">
            <MessageSquare className="h-4 w-4" />
            Ir para o Inbox
          </Button>
        </Link>
      </div>

      {/* Pulse Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Leads de Alta Propensão
              </CardTitle>
              <Flame className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">{totalHot}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Score &ge; 70 com intenção clara</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Sugestões de Pipeline
              </CardTitle>
              <Sparkles className="h-4 w-4 text-[#D16A3A]" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">{stageSuggestions.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Avanços sugeridos pelo Ciclopes</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Sinais Identificados
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-[#1E3A5F] dark:text-[#5B8EC2]" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-mono text-foreground">{recentSignals.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Extraídos de conversas recentes</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Modo de Inteligência
              </CardTitle>
              <Eye className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <Badge variant="outline" className="text-xs font-semibold border-border bg-secondary">
              Sob Demanda
            </Badge>
            <p className="text-[11px] text-muted-foreground mt-1">Disparado sob controle humano</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Grids: Stage Suggestions & Hot Leads */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Stage Suggestions Box */}
        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-5 pb-3 border-b border-border/60">
            <CardTitle className="text-sm font-semibold text-foreground font-sans flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#D16A3A]" />
              Sugestões de Avanço de Pipeline
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              A IA analisou os diálogos e recomenda mover os seguintes negócios de etapa.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {stageSuggestions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhuma sugestão de etapa pendente. Todas as oportunidades estão alinhadas.
              </div>
            ) : (
              stageSuggestions.map((sug) => (
                <div
                  key={sug.id}
                  className="rounded-lg border border-border/80 bg-secondary/30 p-3.5 space-y-2.5 transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-foreground block">
                        {sug.dealTitle}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {sug.contactName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Badge variant="outline" className="text-[10px] border-border">
                        {sug.currentStageName}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <Badge className="text-[10px] bg-[#1E3A5F] text-white">
                        {sug.suggestedStageName}
                      </Badge>
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground bg-card p-2 rounded border border-border/40 leading-relaxed">
                    💡 <span className="font-medium text-foreground">Motivo:</span> {sug.reason}
                  </p>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismissSuggestion(sug.id)}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Ignorar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApplyStageSuggestion(sug)}
                      className="h-7 text-xs bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-medium"
                    >
                      Avançar Etapa ✓
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 2. Top Scored Leads */}
        <Card className="border-border/80 bg-card shadow-sm">
          <CardHeader className="p-5 pb-3 border-b border-border/60">
            <CardTitle className="text-sm font-semibold text-foreground font-sans flex items-center gap-2">
              <Flame className="h-4 w-4 text-emerald-500" />
              Leads Mais Qualificados
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Contatos com maior propensão de fechamento baseados nos critérios comerciais.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-2.5">
            {hotLeads.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhum lead avaliado ainda. Abra uma conversa no Inbox e clique em &quot;Analisar Conversa&quot;.
              </div>
            ) : (
              hotLeads.map((lead) => (
                <div
                  key={lead.contactId}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-card hover:bg-secondary/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {lead.contactName}
                      </span>
                      <Badge
                        className={`text-[10px] font-mono font-bold ${
                          lead.score >= 70
                            ? "bg-emerald-500 text-white"
                            : lead.score >= 40
                            ? "bg-amber-500 text-white"
                            : "bg-slate-500 text-white"
                        }`}
                      >
                        {lead.score} pts
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground block truncate mt-0.5">
                      {lead.intent} • Urgência {lead.urgency}
                    </span>
                  </div>

                  <Link href="/inbox">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-[#D16A3A] hover:text-[#B85528]">
                      Ver Conversa <ChevronRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Signals Feed */}
      <Card className="border-border/80 bg-card shadow-sm">
        <CardHeader className="p-5 pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-semibold text-foreground font-sans flex items-center gap-2">
            <Eye className="h-4 w-4 text-[#1E3A5F] dark:text-[#5B8EC2]" />
            Radar de Sinais & Extrações Recentes
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Feed auditável de intenções, interesses e objeções identificadas pela inteligência nas conversas.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          {recentSignals.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Nenhum sinal extraído recentemente.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentSignals.map((sig) => (
                <div
                  key={sig.id}
                  className="rounded-lg border border-border/70 p-3 bg-secondary/20 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <Badge variant="outline" className="text-[9px] uppercase font-bold border-border">
                      {sig.insightType}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(sig.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-foreground line-clamp-2">
                    {sig.value}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                    <span className="truncate">{sig.contactName}</span>
                    <span className="text-[10px] font-mono text-emerald-600">
                      {Math.round(sig.confidence * 100)}% conf.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
