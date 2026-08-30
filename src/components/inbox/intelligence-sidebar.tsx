"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import type { ConversationInsightWithEvidence } from "@/lib/insights/types";
import type { ContactLeadProfile, ContactCatalogInterestWithItem, ContactObjection } from "@/lib/leads/types";
import {
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  ShoppingBag,
  StickyNote,
  Plus,
  Briefcase,
  FileText,
  ShieldAlert,
  Clock,
  ChevronDown,
  ChevronUp,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateFollowupDialog } from "@/components/tasks/create-followup-dialog";
import { SnoozePopover } from "@/components/tasks/snooze-popover";
import { ObjectionOverrideDialog } from "./objection-override-dialog";
import type { ConversationObjectionOccurrence } from "@/lib/intelligence/types";
import {
  createTask,
  completeFollowup,
  snoozeFollowup,
} from "@/lib/tasks/repository";
import type { CreateTaskInput, Task } from "@/types/tasks";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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

interface EnrichedNote extends ContactNote {
  author_name?: string;
}

export function IntelligenceSidebar({
  contact,
  conversationId,
  onJumpToMessage,
  onCreateTaskFromAction,
}: IntelligenceSidebarProps) {
  const { accountId, user } = useAuth();
  const [copied, setCopied] = useState(false);

  // CRM Data
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<EnrichedNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);

  // Commercial Intelligence Data
  const [leadProfile, setLeadProfile] = useState<ContactLeadProfile | null>(null);
  const [leadScore, setLeadScore] = useState<LeadScoreRecord | null>(null);
  const [interests, setInterests] = useState<ContactCatalogInterestWithItem[]>([]);
  const [objections, setObjections] = useState<ContactObjection[]>([]);
  const [objectionOccurrences, setObjectionOccurrences] = useState<ConversationObjectionOccurrence[]>([]);
  const [insights, setInsights] = useState<ConversationInsightWithEvidence[]>([]);
  const [loadingIntel, setLoadingIntel] = useState(false);

  // Score breakdown expansion toggle
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  // Inline evidence disclosure expansion map
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Record<string, boolean>>({});

  // Objection Override Dialog State
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [selectedOccurrence, setSelectedOccurrence] = useState<ConversationObjectionOccurrence | null>(null);

  // Active Follow-up & Creation Dialog
  const [activeFollowup, setActiveFollowup] = useState<Task | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [dialogInitialValues, setDialogInitialValues] = useState<Partial<CreateTaskInput>>({});

  // Freshness calculation
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null);

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
          .from("contact_tags")
          .select("id, tag_id, tags(*)")
          .eq("contact_id", contact.id),
      ]);

      if (dealsRes.data) setDeals(dealsRes.data as unknown as Deal[]);
      else setDeals([]);

      if (notesRes.data) {
        const rawNotes = notesRes.data as unknown as ContactNote[];
        const userIds = Array.from(
          new Set(rawNotes.map((n) => n.user_id).filter((id): id is string => Boolean(id)))
        );

        const profileNameMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .eq("account_id", accountId)
            .in("user_id", userIds);

          if (profs) {
            for (const p of profs) {
              if (p.user_id) profileNameMap.set(p.user_id, p.full_name);
            }
          }
        }

        const enrichedNotes: EnrichedNote[] = rawNotes.map((n) => ({
          ...n,
          author_name: profileNameMap.get(n.user_id) || "Atendente",
        }));
        setNotes(enrichedNotes);
      } else {
        setNotes([]);
      }

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
      } else {
        setTags([]);
      }

      // Fetch active follow-up
      const { data: followups } = await supabase
        .from("tasks")
        .select("*, contact:contacts(id, name, phone, avatar_url)")
        .eq("account_id", accountId)
        .eq("contact_id", contact.id)
        .in("status", ["pending", "in_progress"])
        .order("due_at", { ascending: true })
        .limit(1);

      if (followups && followups.length > 0) {
        setActiveFollowup(followups[0] as Task);
      } else {
        setActiveFollowup(null);
      }
    } catch (err) {
      console.error("[intelligence-sidebar] Failed to load CRM data:", err);
    }
  }, [contact, accountId]);

  // 2. Fetch Commercial Intelligence Data
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
          .select("*, item:catalog_items(*)")
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

      if (conversationId) {
        const [insightsDataRes, occurrencesRes, lastReqRes] = await Promise.all([
          supabase
            .from("conversation_insights")
            .select("*, evidence:conversation_insight_evidence(*)")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false }),
          supabase
            .from("conversation_objection_occurrences")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false }),
          supabase
            .from("internal_ai_requests")
            .select("completed_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (insightsDataRes.data) {
          setInsights(insightsDataRes.data as ConversationInsightWithEvidence[]);
        } else {
          setInsights([]);
        }

        if (occurrencesRes.data) {
          setObjectionOccurrences(occurrencesRes.data as ConversationObjectionOccurrence[]);
        } else {
          setObjectionOccurrences([]);
        }

        if (lastReqRes.data?.completed_at) {
          setLastAnalysisAt(lastReqRes.data.completed_at);
        }
      }
    } catch (err) {
      console.error("[intelligence-sidebar] Failed to load intelligence data:", err);
    } finally {
      setLoadingIntel(false);
    }
  }, [contact, accountId, conversationId]);

  useEffect(() => {
    if (contact && accountId) {
      void fetchCrmData();
      void fetchIntelligenceData();
    }
  }, [contact, accountId, conversationId, fetchCrmData, fetchIntelligenceData]);

  // Handle adding a note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !contact || !accountId || !user) return;

    setAddingNote(true);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("contact_notes")
        .insert({
          account_id: accountId,
          contact_id: contact.id,
          user_id: user.id,
          note_text: newNote.trim(),
        });

      if (error) throw error;
      toast.success("Nota interna adicionada.");
      setNewNote("");
      setShowNoteInput(false);
      void fetchCrmData();
    } catch (err) {
      toast.error("Erro ao adicionar nota.");
    } finally {
      setAddingNote(false);
    }
  };

  const handleCopyPhone = async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Telefone copiado.");
  };

  const toggleEvidence = (id: string) => {
    setExpandedEvidenceIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!contact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <AlertCircle className="size-8 opacity-40 mb-2" />
        <p className="text-xs">Selecione uma conversa para ver os dados comerciais do contato.</p>
      </div>
    );
  }

  const scoreValue = leadScore?.score ?? 0;
  const isHot = scoreValue >= 70;
  const isWarm = scoreValue >= 40 && scoreValue < 70;

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card text-foreground">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* 1. CONTACT SUMMARY (Clean & Compact) */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-2">
            <div className="flex items-center gap-3">
              <Avatar className="size-10 border border-border">
                {contact.avatar_url ? (
                  <AvatarImage src={contact.avatar_url} alt={contact.name || "Contato"} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                  {contact.name?.charAt(0)?.toUpperCase() || "C"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-foreground truncate font-sans">
                  {contact.name || "Contato sem nome"}
                </h3>
                {contact.company && (
                  <p className="text-xs text-muted-foreground truncate">{contact.company}</p>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-muted-foreground font-mono truncate">
                      {contact.phone}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPhone}
                      className="text-muted-foreground hover:text-foreground"
                      title="Copiar telefone"
                    >
                      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Freshness subtle label */}
            {lastAnalysisAt && (
              <div className="pt-1 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Sparkles className="size-2.5 text-[#D16A3A]" />
                  Inteligência atualizada
                </span>
                <span>{format(new Date(lastAnalysisAt), "HH:mm", { locale: ptBR })}</span>
              </div>
            )}
          </div>

          {/* 2. ACTIVE FOLLOW-UP / PRÓXIMA AÇÃO (Prominent Action Card) */}
          <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-sans">
                <Clock className="size-3 text-primary" />
                Próxima Ação
              </span>
              {activeFollowup && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] px-1.5 py-0.2",
                    activeFollowup.status === "in_progress"
                      ? "border-amber-500/40 text-amber-500 bg-amber-500/10"
                      : "border-primary/40 text-primary bg-primary/10"
                  )}
                >
                  Agendado
                </Badge>
              )}
            </div>

            {activeFollowup ? (
              <div className="space-y-2 bg-muted/30 p-2.5 rounded-lg border border-border/50">
                <p className="text-xs font-semibold text-foreground leading-snug">
                  {activeFollowup.title}
                </p>
                {activeFollowup.due_at && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Calendar className="size-3 text-muted-foreground" />
                    <span>
                      {format(new Date(activeFollowup.due_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1 gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    onClick={async () => {
                      if (!accountId || !user) return;
                      const db = createClient();
                      await completeFollowup(db, accountId, activeFollowup.id, user.id);
                      toast.success("Follow-up concluído!");
                      void fetchCrmData();
                    }}
                  >
                    <Check className="size-3" />
                    Concluir
                  </Button>
                  <SnoozePopover
                    onSnooze={async (snoozeUntil, reason) => {
                      if (!accountId || !user) return;
                      const db = createClient();
                      await snoozeFollowup(db, accountId, activeFollowup.id, {
                        snooze_until: snoozeUntil,
                        reason: reason || undefined,
                      });
                      toast.success("Follow-up adiado.");
                      void fetchCrmData();
                    }}
                  />
                </div>
              </div>
            ) : leadProfile?.next_action ? (
              <div className="space-y-2 bg-muted/20 p-2.5 rounded-lg border border-border/40">
                <p className="text-xs text-foreground/90 leading-snug">
                  {leadProfile.next_action}
                </p>
                <Button
                  size="sm"
                  className="w-full h-7 text-xs font-semibold gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                  onClick={() => {
                    setDialogInitialValues({
                      title: leadProfile.next_action || "Follow-up",
                      contact_id: contact.id,
                    });
                    setCreateDialogOpen(true);
                  }}
                >
                  <Plus className="size-3" />
                  Criar follow-up
                </Button>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-muted-foreground">Nenhuma ação pendente no momento.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs gap-1 border-border"
                  onClick={() => {
                    setDialogInitialValues({ contact_id: contact.id });
                    setCreateDialogOpen(true);
                  }}
                >
                  <Plus className="size-3" />
                  Agendar Follow-up
                </Button>
              </div>
            )}
          </div>

          {/* 3. LEAD SCORE (Clean Gauge & Propensity) */}
          <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-sans">
                Lead Score Comercial
              </span>
              <Badge
                className={cn(
                  "text-[10px] font-bold px-2 py-0.2 uppercase tracking-wide",
                  isHot
                    ? "bg-[#D16A3A] text-white border-transparent"
                    : isWarm
                    ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-secondary text-muted-foreground border-border"
                )}
              >
                {isHot ? "🔥 Lead quente" : isWarm ? "⚡ Lead morno" : "❄️ Lead frio"}
              </Badge>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-sans tracking-tight text-foreground">
                {scoreValue}
              </span>
              <span className="text-xs text-muted-foreground">/ 100 pontos</span>
            </div>

            {/* Score calculation disclosure */}
            {leadScore?.breakdown?.rule_results && leadScore.breakdown.rule_results.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                >
                  {showScoreBreakdown ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {showScoreBreakdown ? "Ocultar detalhes do cálculo" : "Como este score foi calculado?"}
                </button>

                {showScoreBreakdown && (
                  <div className="mt-2 space-y-1.5 bg-muted/40 p-2.5 rounded-lg border border-border/60 text-xs">
                    {leadScore.breakdown.rule_results.map((r, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[11px]">
                        <span className={cn(r.matched ? "text-foreground font-medium" : "text-muted-foreground")}>
                          {r.label || r.rule_key}
                        </span>
                        <span className={cn("font-mono font-semibold", r.points > 0 ? "text-emerald-500" : "text-muted-foreground")}>
                          {r.points > 0 ? `+${r.points}` : `${r.points}`} pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. INTENÇÃO & URGÊNCIA */}
          {leadProfile && (leadProfile.current_intent || leadProfile.urgency) && (
            <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-sans">
                Qualificação
              </span>
              <div className="flex flex-wrap gap-2">
                {leadProfile.current_intent && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary text-foreground text-xs font-medium border border-border/60">
                    <span className="text-muted-foreground text-[10px]">Intenção:</span>
                    <span className="font-semibold">
                      {leadProfile.current_intent.toLowerCase() === "purchase"
                        ? "Compra"
                        : leadProfile.current_intent.toLowerCase() === "service"
                        ? "Serviço"
                        : leadProfile.current_intent.toLowerCase() === "support"
                        ? "Suporte"
                        : leadProfile.current_intent.toLowerCase() === "pricing"
                        ? "Preço / Orçamento"
                        : leadProfile.current_intent}
                    </span>
                  </div>
                )}
                {leadProfile.urgency && (
                  <div
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border",
                      leadProfile.urgency === "high"
                        ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30 font-semibold"
                        : "bg-secondary text-foreground border-border/60"
                    )}
                  >
                    <span className="text-muted-foreground text-[10px]">Urgência:</span>
                    <span>
                      {leadProfile.urgency === "high"
                        ? "Alta"
                        : leadProfile.urgency === "medium"
                        ? "Média"
                        : leadProfile.urgency === "low"
                        ? "Baixa"
                        : leadProfile.urgency}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. INTERESSE NO CATÁLOGO */}
          {interests.length > 0 && (
            <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-sans">
                <ShoppingBag className="size-3 text-primary" />
                Interesse no Catálogo
              </span>
              <div className="space-y-1.5">
                {interests.map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">
                        {it.item?.name || "Item do Catálogo"}
                      </p>
                      {it.item?.type && (
                        <p className="text-[10px] text-muted-foreground">
                          {it.item.type === "service" ? "Serviço" : "Produto"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. OBJEÇÕES DETECTADAS */}
          {objectionOccurrences.length > 0 && (
            <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-sans">
                <ShieldAlert className="size-3 text-orange-500" />
                Objeções Identificadas
              </span>
              <div className="space-y-2">
                {objectionOccurrences.map((occ) => (
                  <div
                    key={occ.id}
                    className="p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/20 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-orange-600 dark:text-orange-400 capitalize">
                        {occ.raw_objection || "Objeção"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOccurrence(occ);
                          setOverrideDialogOpen(true);
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline"
                      >
                        Corrigir
                      </button>
                    </div>
                    {occ.raw_objection && (
                      <p className="text-[11px] text-muted-foreground italic line-clamp-2">
                        &ldquo;{occ.raw_objection}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. RESUMO DA CONVERSA */}
          {leadProfile?.summary && (
            <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-1.5 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-sans">
                Resumo da Situação
              </span>
              <p className="text-xs text-foreground/90 leading-relaxed bg-muted/20 p-2.5 rounded-lg border border-border/40">
                {leadProfile.summary}
              </p>
            </div>
          )}

          {/* 8. SINAIS FATUAIS & EVIDÊNCIAS (Inline Disclosure) */}
          {insights.length > 0 && (
            <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-sans">
                <FileText className="size-3 text-primary" />
                Sinais Fatuais da Conversa
              </span>
              <div className="space-y-2">
                {insights.map((ins) => {
                  const isExpanded = expandedEvidenceIds[ins.id];
                  const hasEvidence = ins.evidence && ins.evidence.length > 0;

                  return (
                    <div
                      key={ins.id}
                      className="p-2.5 rounded-lg bg-muted/20 border border-border/40 text-xs space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-foreground text-xs leading-snug">
                          {ins.value_text || ins.insight_type}
                        </span>
                        {ins.confidence && (
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {Math.round(ins.confidence * 100)}%
                          </span>
                        )}
                      </div>

                      {hasEvidence && (
                        <div>
                          <button
                            type="button"
                            onClick={() => toggleEvidence(ins.id)}
                            className="text-[10px] text-primary hover:underline flex items-center gap-1 font-medium mt-0.5"
                          >
                            {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                            {isExpanded ? "Ocultar evidência" : "Por que? ▼"}
                          </button>

                          {isExpanded && (
                            <div className="mt-1.5 p-2 rounded bg-muted/60 border border-border/60 text-[11px] text-foreground/80 space-y-1">
                              {ins.evidence.map((ev, evIdx) => (
                                <div key={evIdx} className="space-y-0.5">
                                  <p className="italic">&ldquo;{ev.snippet}&rdquo;</p>
                                  {ev.created_at && (
                                    <p className="text-[9px] text-muted-foreground">
                                      {format(new Date(ev.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 9. CRM CONTEXT: DEALS, NOTES & TAGS */}
          <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-3 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-sans">
              <Briefcase className="size-3 text-primary" />
              Contexto CRM
            </span>

            {/* Deals */}
            {deals.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Oportunidades
                </span>
                {deals.map((d) => (
                  <div
                    key={d.id}
                    className="p-2 rounded-lg bg-muted/30 border border-border/40 flex items-center justify-between text-xs"
                  >
                    <span className="font-semibold text-foreground truncate">{d.title}</span>
                    <span className="font-mono text-primary font-bold shrink-0 ml-2">
                      R$ {Number(d.value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Tags
                </span>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant="secondary"
                      className="text-[10px] px-2 py-0.5 rounded-md"
                      style={t.color ? { borderColor: t.color, color: t.color } : undefined}
                    >
                      {t.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Internal Notes */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <StickyNote className="size-3" />
                  Notas Internas ({notes.length})
                </span>
                <button
                  type="button"
                  onClick={() => setShowNoteInput(!showNoteInput)}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="size-3" />
                  Nova nota
                </button>
              </div>

              {showNoteInput && (
                <form onSubmit={handleAddNote} className="space-y-2 bg-muted/40 p-2.5 rounded-lg border border-border">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Escreva uma observação interna..."
                    className="w-full text-xs p-2 rounded border border-border bg-card text-foreground resize-none h-16 outline-none focus:border-primary"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNoteInput(false)}
                      className="h-6 text-xs px-2"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={addingNote || !newNote.trim()}
                      className="h-6 text-xs px-2.5 bg-primary text-white"
                    >
                      Salvar
                    </Button>
                  </div>
                </form>
              )}

              {notes.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {notes.map((n) => (
                    <div
                      key={n.id}
                      className="p-2 rounded bg-muted/20 border border-border/30 text-xs space-y-0.5"
                    >
                      <p className="text-foreground/90">{n.note_text}</p>
                      <p className="text-[9px] text-muted-foreground">
                        {n.author_name || "Atendente"} • {format(new Date(n.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">Nenhuma nota adicionada.</p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Follow-up Creation Dialog */}
      <CreateFollowupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialValues={dialogInitialValues}
        onSubmit={async (input) => {
          if (!accountId) return;
          const db = createClient();
          await createTask(db, accountId, input);
          toast.success("Follow-up criado com sucesso!");
          void fetchCrmData();
        }}
      />

      {/* Objection Override Dialog */}
      {selectedOccurrence && (
        <ObjectionOverrideDialog
          open={overrideDialogOpen}
          onOpenChange={setOverrideDialogOpen}
          occurrenceId={selectedOccurrence.id}
          currentTaxonomyId={selectedOccurrence.effective_taxonomy_id}
          rawObjectionText={selectedOccurrence.raw_objection}
          onOverridden={() => void fetchIntelligenceData()}
        />
      )}
    </div>
  );
}
