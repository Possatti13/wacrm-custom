"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import type { ConversationInsightWithEvidence } from "@/lib/insights/types";
import type { ContactLeadProfile, ContactCatalogInterestWithItem, ContactObjection } from "@/lib/leads/types";
import type { ActionType } from "@/lib/intelligence/types";
import {
  Copy,
  Check,
  Sparkles,
  Flame,
  AlertCircle,
  HelpCircle,
  ShoppingBag,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Briefcase,
  RefreshCw,
  FileText,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvidenceDialog } from "./evidence-dialog";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { createTask } from "@/lib/tasks/repository";
import type { CreateTaskInput } from "@/types/tasks";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface IntelligenceSidebarProps {
  contact: Contact | null;
  conversationId?: string | null;
  onJumpToMessage?: (messageId: string) => void;
  onCreateTaskFromAction?: (actionText: string) => void;
}

interface LeadScoreRecord {
  score: number;
  scoring_revision_number?: number;
  breakdown: {
    base_score?: number;
    rule_results?: Array<{
      rule_key: string;
      label?: string;
      matched: boolean;
      points: number;
      explanation?: string;
    }>;
  };
  calculated_at: string;
}

export function IntelligenceSidebar({
  contact,
  conversationId,
  onJumpToMessage,
  onCreateTaskFromAction,
}: IntelligenceSidebarProps) {
  const { accountId, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"intelligence" | "crm">("intelligence");
  const [copied, setCopied] = useState(false);

  // CRM Data
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Commercial Intelligence Data
  const [leadProfile, setLeadProfile] = useState<ContactLeadProfile | null>(null);
  const [leadScore, setLeadScore] = useState<LeadScoreRecord | null>(null);
  const [interests, setInterests] = useState<ContactCatalogInterestWithItem[]>([]);
  const [objections, setObjections] = useState<ContactObjection[]>([]);
  const [insights, setInsights] = useState<ConversationInsightWithEvidence[]>([]);
  const [loadingIntel, setLoadingIntel] = useState(false);

  // On-Demand AI Execution & Freshness State
  const [freshness, setFreshness] = useState<"not_analyzed" | "fresh" | "stale">("not_analyzed");
  const [messageDeltaCount, setMessageDeltaCount] = useState(0);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null);
  const [executingAiAction, setExecutingAiAction] = useState<string | null>(null);
  const [aiActionResultText, setAiActionResultText] = useState<string | null>(null);
  const [aiActionTitle, setAiActionTitle] = useState<string | null>(null);

  // Evidence Dialog State
  const [selectedInsightForEvidence, setSelectedInsightForEvidence] =
    useState<ConversationInsightWithEvidence | null>(null);
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false);

  // Task creation from AI suggestion
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskActionText, setTaskActionText] = useState("");

  // Score breakdown expansion toggle
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  // 1. Fetch CRM & Contact Details
  const fetchCrmData = useCallback(async () => {
    if (!contact || !accountId) return;
    const supabase = createClient();

    try {
      const [dealsRes, notesRes, tagsRes] = await Promise.all([
        supabase
          .from("deals")
          .select("*, pipeline_stages(name)")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contact_notes")
          .select("*")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contact_tag_assignments")
          .select("id, tag_id, tags(*)")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id),
      ]);

      if (dealsRes.error) console.error("Failed to load deals:", dealsRes.error);
      if (dealsRes.data) setDeals(dealsRes.data as unknown as Deal[]);

      if (notesRes.error) {
        console.error("Failed to load contact notes:", notesRes.error);
      } else if (notesRes.data) {
        const rawNotes = notesRes.data as unknown as ContactNote[];
        const userIds = Array.from(
          new Set(rawNotes.map((n) => n.user_id).filter((id): id is string => Boolean(id)))
        );

        const profileNameMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profs, error: profError } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .eq("account_id", accountId)
            .in("user_id", userIds);

          if (profError) {
            console.error("Failed to load note author profiles:", profError);
          } else if (profs) {
            for (const p of profs) {
              if (p.user_id) profileNameMap.set(p.user_id, p.full_name);
            }
          }
        }

        const enrichedNotes = rawNotes.map((n) => ({
          ...n,
          profiles: { name: profileNameMap.get(n.user_id) || "Atendente" },
        }));
        setNotes(enrichedNotes as ContactNote[]);
      }

      if (tagsRes.error) console.error("Failed to load tags:", tagsRes.error);
      if (tagsRes.data) {
        interface TagJoinRow {
          id: string;
          tag_id: string;
          tags: Tag | null;
        }
        const rows = tagsRes.data as unknown as TagJoinRow[];
        const flattened = rows
          .filter((t): t is TagJoinRow & { tags: Tag } => Boolean(t.tags))
          .map((t) => ({
            ...t.tags,
            contact_tag_id: t.id,
          }));
        setTags(flattened);
      }
    } catch (err) {
      console.error("Failed to load CRM data:", err);
    }
  }, [contact, accountId]);

  // 2. Fetch Commercial Intelligence & Lead Scoring Data
  const fetchIntelligenceData = useCallback(async () => {
    if (!contact || !accountId) return;
    setLoadingIntel(true);
    const supabase = createClient();

    try {
      const [profileRes, scoreRes, interestsRes, objectionsRes] = await Promise.all([
        supabase
          .from("contact_lead_profiles")
          .select("*")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id)
          .maybeSingle(),
        supabase
          .from("contact_lead_scores")
          .select("*")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id)
          .maybeSingle(),
        supabase
          .from("contact_catalog_interests")
          .select("*, catalog_item:catalog_items(*)")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id),
        supabase
          .from("contact_objections")
          .select("*")
          .eq("account_id", accountId)
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
      ]);

      if (profileRes.data) setLeadProfile(profileRes.data as ContactLeadProfile);
      else setLeadProfile(null);

      if (scoreRes.data) setLeadScore(scoreRes.data as LeadScoreRecord);
      else setLeadScore(null);

      if (interestsRes.data) setInterests(interestsRes.data as unknown as ContactCatalogInterestWithItem[]);
      else setInterests([]);

      if (objectionsRes.data) setObjections(objectionsRes.data as ContactObjection[]);
      else setObjections([]);

      // Check conversation message count & last analysis boundary
      if (conversationId) {
        const [msgsRes, lastReqRes, insightsDataRes] = await Promise.all([
          supabase
            .from("messages")
            .select("id, created_at", { count: "exact" })
            .eq("account_id", accountId)
            .eq("conversation_id", conversationId),
          supabase
            .from("internal_ai_requests")
            .select("id, created_at, message_count, status")
            .eq("account_id", accountId)
            .eq("target_type", "conversation")
            .eq("target_id", conversationId)
            .eq("action_type", "analyze_conversation")
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("conversation_insights")
            .select(`
              *,
              catalog_items:catalog_item_id (
                id,
                name,
                type,
                sku,
                status
              )
            `)
            .eq("account_id", accountId)
            .eq("conversation_id", conversationId)
            .eq("status", "active")
            .order("observed_at", { ascending: false }),
        ]);

        const totalMsgs = msgsRes.count || 0;
        const lastReq = lastReqRes.data;

        if (!lastReq) {
          setFreshness("not_analyzed");
          setMessageDeltaCount(totalMsgs);
          setLastAnalysisAt(null);
        } else {
          setLastAnalysisAt(lastReq.created_at);
          const analyzedCount = lastReq.message_count || 0;
          const delta = Math.max(0, totalMsgs - analyzedCount);
          setMessageDeltaCount(delta);
          setFreshness(delta === 0 ? "fresh" : "stale");
        }

        const insightsData = insightsDataRes.data;
        if (insightsData && insightsData.length > 0) {
          const insightIds = insightsData.map((i: { id: string }) => i.id);
          const { data: evidenceData } = await supabase
            .from("conversation_insight_evidence")
            .select("*")
            .eq("account_id", accountId)
            .eq("conversation_id", conversationId)
            .in("insight_id", insightIds);

          const joined = insightsData.map((ins) => ({
            ...ins,
            evidence: evidenceData?.filter((e) => e.insight_id === ins.id) || [],
          }));
          setInsights(joined as unknown as ConversationInsightWithEvidence[]);
        } else {
          setInsights([]);
        }
      }
    } catch (err) {
      console.error("Failed to load commercial intelligence:", err);
    } finally {
      setLoadingIntel(false);
    }
  }, [contact, accountId, conversationId]);

  useEffect(() => {
    fetchCrmData();
    fetchIntelligenceData();
  }, [fetchCrmData, fetchIntelligenceData]);

  // Execute explicit On-Demand AI action
  const handleTriggerAiAction = async (actionType: ActionType, label: string) => {
    if (!conversationId || !accountId) return;
    setExecutingAiAction(actionType);
    setAiActionTitle(label);

    try {
      const res = await fetch("/api/ai/on-demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "conversation",
          targetId: conversationId,
          actionType,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Erro ao executar ação de IA");
      }

      const data = await res.json();
      setAiActionResultText(data.request?.result_text || "Análise concluída com sucesso.");
      toast.success(
        data.cached
          ? `Resultado obtido instantaneamente do cache!`
          : `Inteligência executada com sucesso!`
      );
      fetchIntelligenceData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Falha na inteligência: ${msg}`);
    } finally {
      setExecutingAiAction(null);
    }
  };

  const handleCopyPhone = useCallback(async () => {
    const textToCopy = contact?.phone || contact?.whatsapp_lid;
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: session?.user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      const enrichedNote = {
        ...data,
        profiles: { name: (session?.user?.user_metadata?.full_name as string) || "Você" },
      };
      setNotes((prev) => [enrichedNote as unknown as ContactNote, ...prev]);
      setNewNote("");
      toast.success("Nota interna adicionada.");
    } else if (error) {
      console.error("Failed to add contact note:", error);
      toast.error("Erro ao adicionar nota interna.");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleOpenEvidence = (insight: ConversationInsightWithEvidence) => {
    setSelectedInsightForEvidence(insight);
    setEvidenceDialogOpen(true);
  };

  const handleRetractInsight = async (insightId: string) => {
    if (!accountId || !conversationId) return;
    const supabase = createClient();
    try {
      const { error } = await supabase.rpc("retract_conversation_insight", {
        p_account_id: accountId,
        p_conversation_id: conversationId,
        p_insight_id: insightId,
        p_retracted_reason: "Retratado manualmente pelo atendente via Inbox",
      });
      if (error) throw error;
      toast.success("Insight retratado com sucesso.");
      fetchIntelligenceData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro ao retratar: ${msg}`);
    }
  };

  const handleCreateTask = async (input: CreateTaskInput) => {
    if (!accountId) return;
    const supabase = createClient();
    try {
      await createTask(supabase, accountId, {
        ...input,
        created_by_user_id: user?.id,
      });
      toast.success("Tarefa de follow-up criada com sucesso!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro ao criar tarefa: ${msg}`);
    }
  };

  if (!contact) {
    return (
      <div className="flex h-full w-80 items-center justify-center border-l border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">Selecione uma conversa para visualizar a inteligência</p>
      </div>
    );
  }

  const displayName =
    contact.name ||
    contact.phone ||
    (contact.whatsapp_lid ? "Contato WhatsApp" : "Contato");
  const displayPhone =
    contact.phone || (contact.whatsapp_lid ? "Identidade WhatsApp" : "Sem telefone");
  const initials = displayName.charAt(0).toUpperCase();

  // Score Visual Properties
  const scoreVal = leadScore?.score ?? null;
  const isHot = scoreVal !== null && scoreVal >= 70;
  const isWarm = scoreVal !== null && scoreVal >= 40 && scoreVal < 70;
  const isCold = scoreVal !== null && scoreVal < 40;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card select-none">
      {/* Contact Summary Header */}
      <div className="p-3.5 border-b border-border/80 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {contact.avatar_url ? (
              <img
                src={contact.avatar_url}
                alt={displayName}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground leading-tight">
              {displayName}
            </h3>
            <p className="truncate text-xs text-muted-foreground mt-0.5">
              {contact.company || displayPhone}
            </p>
          </div>
        </div>

        {/* Quick Phone / Copy Button */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            onClick={handleCopyPhone}
            className="flex flex-1 items-center justify-between rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
          >
            <span className="truncate">{displayPhone}</span>
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "intelligence" | "crm")} className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-2 border-b border-border">
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="intelligence" className="text-xs gap-1.5 py-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Inteligência</span>
              {loadingIntel && <div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
            </TabsTrigger>
            <TabsTrigger value="crm" className="text-xs gap-1.5 py-1">
              <Briefcase className="h-3.5 w-3.5" />
              CRM
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ============================================================ */}
        {/* TAB 1: COMMERCIAL INTELLIGENCE */}
        {/* ============================================================ */}
        <TabsContent value="intelligence" className="flex-1 min-h-0 m-0">
          <ScrollArea className="h-full">
            <div className="p-3.5 space-y-4">
              {/* ON-DEMAND CONTROL & FRESHNESS BANNER */}
              <div className="rounded-xl border border-border bg-background p-3 shadow-sm space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Status da Análise
                  </span>
                  {freshness === "fresh" && (
                    <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20">
                      ✓ Em dia
                    </Badge>
                  )}
                  {freshness === "stale" && (
                    <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
                      ⚠️ {messageDeltaCount} nova(s) msg(s)
                    </Badge>
                  )}
                  {freshness === "not_analyzed" && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Não analisado
                    </Badge>
                  )}
                </div>

                {lastAnalysisAt && (
                  <div className="text-[10px] text-muted-foreground">
                    Última análise: {format(new Date(lastAnalysisAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </div>
                )}

                {/* Primary Action Button */}
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={executingAiAction !== null}
                  onClick={() => handleTriggerAiAction("analyze_conversation", "Extração Completa")}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", executingAiAction === "analyze_conversation" && "animate-spin")} />
                  {freshness === "stale" ? "Atualizar Análise do Lead" : "Analisar Conversa Agora"}
                </Button>

                {/* Secondary Quick Actions */}
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-1 gap-1"
                    disabled={executingAiAction !== null}
                    onClick={() => handleTriggerAiAction("summarize_conversation", "Resumo Executivo")}
                  >
                    <FileText className="h-3 w-3" />
                    Resumir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-1 gap-1"
                    disabled={executingAiAction !== null}
                    onClick={() => handleTriggerAiAction("suggest_next_action", "Próximo Passo")}
                  >
                    <Lightbulb className="h-3 w-3" />
                    Próx. Ação
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-1 gap-1"
                    disabled={executingAiAction !== null}
                    onClick={() => handleTriggerAiAction("identify_objections", "Mapeamento de Objeções")}
                  >
                    <ShieldAlert className="h-3 w-3" />
                    Objeções
                  </Button>
                </div>
              </div>

              {/* On-Demand Result Box (When generated) */}
              {aiActionResultText && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between text-primary font-semibold text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      {aiActionTitle || "Resultado da IA"}
                    </span>
                    <button
                      onClick={() => setAiActionResultText(null)}
                      className="text-muted-foreground hover:text-foreground text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap text-foreground font-sans leading-relaxed text-[11px]">
                    {aiActionResultText}
                  </div>
                </div>
              )}

              {/* Lead Score Widget */}
              <div className="rounded-xl border border-border bg-background p-3.5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Flame className={cn("h-4 w-4", isHot ? "text-emerald-500" : isWarm ? "text-amber-500" : "text-slate-400")} />
                    <span className="text-xs font-semibold text-foreground">Lead Score Comercial</span>
                  </div>
                  {scoreVal !== null ? (
                    <Badge
                      className={cn(
                        "font-mono text-xs px-2 py-0.5",
                        isHot && "bg-emerald-500 text-white hover:bg-emerald-600",
                        isWarm && "bg-amber-500 text-white hover:bg-amber-600",
                        isCold && "bg-slate-500 text-white hover:bg-slate-600"
                      )}
                    >
                      {scoreVal} / 100
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Sem cálculo</Badge>
                  )}
                </div>

                {/* Score Level Description */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Classificação:</span>
                  <span className="font-medium">
                    {isHot ? "🔥 Alta Propensão (Quente)" : isWarm ? "⚡ Média Propensão (Morno)" : isCold ? "❄️ Baixa Propensão (Frio)" : "Não avaliado"}
                  </span>
                </div>

                {/* Score Breakdown Toggle */}
                {leadScore?.breakdown?.rule_results && leadScore.breakdown.rule_results.length > 0 && (
                  <div className="pt-1 border-t border-border/60">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-6 text-[11px] text-muted-foreground hover:text-primary justify-between px-1"
                      onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                    >
                      <span>Composição dos Pontos</span>
                      <span>{showScoreBreakdown ? "▲ Ocultar" : "▼ Detalhes"}</span>
                    </Button>

                    {showScoreBreakdown && (
                      <div className="mt-2 space-y-1.5 text-xs bg-muted/40 rounded-lg p-2 font-mono">
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>Pontuação Base:</span>
                          <span>{leadScore.breakdown.base_score ?? 0} pts</span>
                        </div>
                        {leadScore.breakdown.rule_results.map((rule, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px]">
                            <span className="truncate pr-2 text-foreground">{rule.label || rule.rule_key}:</span>
                            <span className={cn("font-bold shrink-0", rule.points >= 0 ? "text-emerald-600" : "text-rose-600")}>
                              {rule.points >= 0 ? `+${rule.points}` : rule.points}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Signals: Intent & Urgency */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Intenção & Urgência
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border/80 bg-background p-2.5">
                    <div className="text-[10px] text-muted-foreground">Intenção</div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-semibold capitalize text-foreground">
                        {leadProfile?.current_intent || "Não detectada"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-background p-2.5">
                    <div className="text-[10px] text-muted-foreground">Urgência</div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={cn(
                        "text-xs font-semibold capitalize",
                        leadProfile?.urgency === "high" ? "text-rose-600" : leadProfile?.urgency === "medium" ? "text-amber-600" : "text-muted-foreground"
                      )}>
                        {leadProfile?.urgency === "high" ? "Alta" : leadProfile?.urgency === "medium" ? "Média" : leadProfile?.urgency === "low" ? "Baixa" : "Normal"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Catalog Interests */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <ShoppingBag className="h-3 w-3 text-primary" />
                    Interesses no Catálogo ({interests.length})
                  </div>
                </div>

                {interests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhum produto/serviço identificado
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {interests.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground truncate">
                            {item.item?.name || "Produto/Serviço"}
                          </div>
                          {item.item?.sku && (
                            <div className="text-[10px] text-muted-foreground font-mono">
                              SKU: {item.item.sku}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px] capitalize ml-2 shrink-0">
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Objections */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    Objeções Detectadas ({objections.length})
                  </div>
                </div>

                {objections.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhuma objeção em aberto
                  </div>
                ) : (
                  <div className="space-y-2">
                    {objections.map((obj) => (
                      <div
                        key={obj.id}
                        className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{obj.objection}</span>
                          <Badge
                            variant={obj.status === "open" ? "destructive" : "secondary"}
                            className="text-[10px] uppercase"
                          >
                            {obj.status === "open" ? "Aberta" : obj.status}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Detectada em {format(new Date(obj.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Suggested Next Action */}
              {leadProfile?.next_action && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    Próxima Ação Sugerida
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">
                    {leadProfile.next_action}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 text-xs gap-1.5 mt-1 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => {
                      if (onCreateTaskFromAction) {
                        onCreateTaskFromAction(leadProfile.next_action!);
                      } else {
                        setTaskActionText(leadProfile.next_action!);
                        setTaskDialogOpen(true);
                      }
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    Criar Tarefa de Follow-up
                  </Button>
                </div>
              )}

              {/* Interactive Evidence List ("Por quê?") */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Sinais Fatuais da Conversa ({insights.length})
                  </span>
                </div>

                {insights.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhum sinal extraído nesta conversa ainda.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {insights.map((ins) => (
                      <div
                        key={ins.id}
                        className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1.5 hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div>
                            <span className="font-semibold text-foreground capitalize">
                              {ins.insight_type.replace("_", " ")}:
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {ins.value_text || (ins as unknown as { catalog_items?: { name?: string } }).catalog_items?.name || "Detectado"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[10px] text-primary gap-1 shrink-0"
                              onClick={() => handleOpenEvidence(ins)}
                            >
                              <HelpCircle className="h-3 w-3" />
                              Por quê?
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-[10px] text-muted-foreground hover:text-rose-600 shrink-0"
                              title="Retratar este sinal"
                              onClick={() => handleRetractInsight(ins.id)}
                            >
                              ✕
                            </Button>
                          </div>
                        </div>

                        {ins.evidence && ins.evidence.length > 0 && (
                          <div className="text-[11px] text-muted-foreground italic truncate bg-muted/40 p-1.5 rounded">
                            &ldquo;{ins.evidence[0].snippet || "Evidência citada"}&rdquo;
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: CRM DETAILS, DEALS & NOTES */}
        {/* ============================================================ */}
        <TabsContent value="crm" className="flex-1 min-h-0 m-0">
          <ScrollArea className="h-full">
            <div className="p-3.5 space-y-4">
              {/* Tags */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <TagIcon className="h-3 w-3" />
                  Tags do Contato ({tags.length})
                </div>
                {tags.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhuma tag vinculada
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="secondary"
                        className="text-xs"
                        style={{
                          backgroundColor: tag.color ? `${tag.color}20` : undefined,
                          color: tag.color || undefined,
                          borderColor: tag.color ? `${tag.color}40` : undefined,
                        }}
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Deals */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <DollarSign className="h-3 w-3 text-emerald-500" />
                    Oportunidades ({deals.length})
                  </div>
                </div>

                {deals.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nenhum negócio associado
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-medium">
                          <span className="text-foreground">{deal.title}</span>
                          <span className="font-mono text-emerald-600 dark:text-emerald-400">
                            {deal.value ? `R$ ${Number(deal.value).toLocaleString("pt-BR")}` : "R$ 0"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{(deal as Deal & { pipeline_stages?: { name: string } | null }).pipeline_stages?.name || "Etapa padrão"}</span>
                          <span className="capitalize">{deal.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Internal Notes */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <StickyNote className="h-3 w-3 text-amber-500" />
                  Notas Internas ({notes.length})
                </div>

                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Adicionar nota..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                      className="flex-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={handleAddNote}
                      disabled={addingNote || !newNote.trim()}
                    >
                      Salvar
                    </Button>
                  </div>

                  {notes.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                      Nenhuma nota registrada
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1"
                        >
                          <p className="text-foreground whitespace-pre-wrap">{note.note_text}</p>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{(note as ContactNote & { profiles?: { name: string } | null }).profiles?.name || "Atendente"}</span>
                            <span>{format(new Date(note.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Evidence Dialog */}
      <EvidenceDialog
        open={evidenceDialogOpen}
        onOpenChange={setEvidenceDialogOpen}
        insight={selectedInsightForEvidence}
        onJumpToMessage={onJumpToMessage}
      />

      {/* Task Creation Dialog */}
      <TaskFormDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        initialSuggestion={{
          actionText: taskActionText ? `Follow-up: ${taskActionText}` : "",
          contactId: contact.id,
          conversationId: conversationId || undefined,
        }}
        onSubmit={handleCreateTask}
      />
    </div>
  );
}
