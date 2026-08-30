"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Task,
  CreateTaskInput,
  CockpitView,
  NoNextActionLeadItem,
  ForgottenLeadItem,
} from "@/types/tasks";
import {
  getCockpitFollowups,
  getLeadsWithoutNextAction,
  getForgottenLeads,
  createTask,
  completeFollowup,
  snoozeFollowup,
} from "@/lib/tasks/repository";
import { FollowupCard } from "./followup-card";
import { CreateFollowupDialog } from "./create-followup-dialog";
import { PageHeader } from "@/components/layout/page-header";
import {
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  Plus,
  Search,
  Sparkles,
  ExternalLink,
  User,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TasksView() {
  const router = useRouter();
  const { accountId, user } = useAuth();
  const [view, setView] = useState<CockpitView>("today");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [noNextActionLeads, setNoNextActionLeads] = useState<NoNextActionLeadItem[]>([]);
  const [forgottenLeads, setForgottenLeads] = useState<ForgottenLeadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [dialogInitialValues, setDialogInitialValues] = useState<Partial<CreateTaskInput>>({});

  // Summary counts for tabs & daily rail
  const [counts, setCounts] = useState({
    today: 0,
    overdue: 0,
    upcoming: 0,
    waiting_customer: 0,
    no_next_action: 0,
    forgotten: 0,
    completed_today: 0,
  });

  const fetchCockpitData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();

    try {
      if (view === "no_next_action") {
        const res = await getLeadsWithoutNextAction(supabase, accountId);
        setNoNextActionLeads(res.items);
      } else if (view === "forgotten") {
        const res = await getForgottenLeads(supabase, accountId, { inactive_hours: 72 });
        setForgottenLeads(res.items);
      } else {
        const res = await getCockpitFollowups(supabase, accountId, { view });
        setTasks(res.items);
      }

      // Pre-fetch count stats in background
      Promise.all([
        getCockpitFollowups(supabase, accountId, { view: "today", limit: 1 }),
        getCockpitFollowups(supabase, accountId, { view: "overdue", limit: 1 }),
        getCockpitFollowups(supabase, accountId, { view: "upcoming", limit: 1 }),
        getCockpitFollowups(supabase, accountId, { view: "waiting_customer", limit: 1 }),
        getLeadsWithoutNextAction(supabase, accountId, { limit: 1 }),
        getForgottenLeads(supabase, accountId, { limit: 1, inactive_hours: 72 }),
      ]).then(([todayRes, overdueRes, upcomingRes, waitingRes, noActionRes, forgottenRes]) => {
        setCounts((prev) => ({
          ...prev,
          today: todayRes.total,
          overdue: overdueRes.total,
          upcoming: upcomingRes.total,
          waiting_customer: waitingRes.total,
          no_next_action: noActionRes.total,
          forgotten: forgottenRes.total,
        }));
      });
    } catch (err) {
      console.error("Failed to load cockpit data:", err);
      toast.error("Erro ao carregar follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [accountId, view]);

  useEffect(() => {
    fetchCockpitData();
  }, [fetchCockpitData]);

  const handleComplete = async (task: Task) => {
    if (!accountId) return;
    const supabase = createClient();
    const isCompleted = task.status === "completed";

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: isCompleted ? "pending" : "completed",
              completed_at: isCompleted ? null : new Date().toISOString(),
            }
          : t
      )
    );

    try {
      await completeFollowup(supabase, accountId, task.id, user?.id);
      toast.success(isCompleted ? "Follow-up reaberto." : "Follow-up concluído com sucesso!");
      fetchCockpitData();
    } catch (err) {
      console.error("Failed to complete task:", err);
      toast.error("Erro ao concluir follow-up.");
      fetchCockpitData();
    }
  };

  const handleSnooze = async (task: Task, snoozeUntilIso: string, reason?: string) => {
    if (!accountId) return;
    const supabase = createClient();

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              snoozed_until: snoozeUntilIso,
              snooze_count: t.snooze_count + 1,
              snooze_reason: reason || t.snooze_reason,
            }
          : t
      )
    );

    try {
      await snoozeFollowup(supabase, accountId, task.id, {
        snooze_until: snoozeUntilIso,
        reason,
      });
      toast.success("Follow-up adiado.");
      fetchCockpitData();
    } catch (err) {
      console.error("Failed to snooze task:", err);
      toast.error("Erro ao adiar follow-up.");
      fetchCockpitData();
    }
  };

  const handleCreateFollowup = async (input: CreateTaskInput) => {
    if (!accountId) return;
    const supabase = createClient();

    try {
      const created = await createTask(supabase, accountId, {
        ...input,
        created_by_user_id: user?.id,
      });
      setTasks((prev) => [created, ...prev]);
      toast.success("Follow-up criado com sucesso!");
      fetchCockpitData();
    } catch (err) {
      console.error("Failed to create task:", err);
      toast.error("Erro ao criar follow-up.");
    }
  };

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.contact?.name?.toLowerCase().includes(q) ||
        t.contact?.phone.includes(q) ||
        t.action_type.toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const tabsConfig: Array<{ id: CockpitView; label: string; count: number; alert?: boolean }> = [
    { id: "today", label: "Hoje", count: counts.today },
    { id: "overdue", label: "Atrasados", count: counts.overdue, alert: counts.overdue > 0 },
    { id: "upcoming", label: "Próximos", count: counts.upcoming },
    { id: "waiting_customer", label: "Aguardando cliente", count: counts.waiting_customer },
    { id: "no_next_action", label: "Sem próxima ação", count: counts.no_next_action, alert: counts.no_next_action > 0 },
    { id: "forgotten", label: "Leads esquecidos", count: counts.forgotten },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Standardized PageHeader matching Visual Reference 2 */}
      <PageHeader
        title="Follow-ups"
        subtitle="Acompanhe e execute suas próximas ações comerciais"
        actions={
          <Button
            onClick={() => {
              setDialogInitialValues({});
              setCreateDialogOpen(true);
            }}
            className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white shadow-xs rounded-lg cursor-pointer"
          >
            <Plus className="size-3.5" />
            <span>Novo Follow-up</span>
          </Button>
        }
      />

      {/* 6 Canonical Horizontal Tabs strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-border/80 scrollbar-none">
        {tabsConfig.map((tab) => {
          const isActive = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0",
                isActive
                  ? "bg-[#1E3A5F] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
                    isActive
                      ? "bg-white/20 text-white"
                      : tab.alert
                      ? "bg-[#D16A3A]/15 text-[#D16A3A]"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 2-Column Main Layout: Left Stream + Right Daily Summary Rail */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Tasks Stream & Search (w-full lg:flex-1) */}
        <div className="w-full lg:flex-1 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por contato ou ação..."
              className="pl-9 text-xs h-9 bg-card border-border/80 rounded-lg placeholder-muted-foreground"
            />
          </div>

          {/* Main Task List */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : view === "no_next_action" ? (
            /* Sem Próxima Ação View */
            noNextActionLeads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card">
                <CheckCircle2 className="mx-auto size-8 text-emerald-500 mb-2" />
                <h3 className="text-sm font-semibold text-foreground">
                  Excelente! Todos os leads em negociação possuem próxima ação definida.
                </h3>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {noNextActionLeads.map((lead) => (
                  <div
                    key={lead.contact_id}
                    className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 space-y-3 shadow-2xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="size-7 border border-border">
                            <AvatarImage src={lead.contact_avatar_url || undefined} />
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {lead.contact_name?.slice(0, 2).toUpperCase() || <User className="size-3.5" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-semibold text-xs text-foreground truncate">{lead.contact_name || "Contato"}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{lead.contact_phone}</p>
                          </div>
                        </div>

                        {lead.lead_score !== null && (
                          <Badge variant="outline" className="text-[9px] gap-1 font-bold text-[#D16A3A] border-[#D16A3A]/30">
                            Score: {lead.lead_score}
                          </Badge>
                        )}
                      </div>

                      {lead.suggested_next_action && (
                        <div className="rounded-lg bg-primary/5 border border-primary/20 p-2 text-xs">
                          <span className="font-semibold text-primary block text-[10px] uppercase">
                            Sugestão do Copiloto
                          </span>
                          <p className="text-foreground mt-0.5 leading-snug">{lead.suggested_next_action}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(`/inbox?c=${lead.conversation_id}`)}
                        className="h-7 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10 px-2"
                      >
                        <ExternalLink className="size-3" />
                        Abrir conversa
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setDialogInitialValues({
                            contact_id: lead.contact_id,
                            conversation_id: lead.conversation_id,
                            deal_id: lead.deal_id,
                            title: lead.suggested_next_action || "Follow-up de recontato",
                            due_at: lead.suggested_due_at || null,
                            source: lead.suggested_next_action ? "intelligence" : "manual",
                          });
                          setCreateDialogOpen(true);
                        }}
                        className="h-7 text-xs gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                      >
                        <Plus className="size-3" />
                        Criar ação
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : view === "forgotten" ? (
            /* Leads Esquecidos View */
            forgottenLeads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card">
                <CheckCircle2 className="mx-auto size-8 text-emerald-500 mb-2" />
                <h3 className="text-sm font-semibold text-foreground">
                  Nenhum lead esquecido! Toda a base está em dia.
                </h3>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {forgottenLeads.map((lead) => (
                  <div
                    key={lead.contact_id}
                    className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 space-y-3 shadow-2xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="size-7 border border-border">
                            <AvatarImage src={lead.contact_avatar_url || undefined} />
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {lead.contact_name?.slice(0, 2).toUpperCase() || <User className="size-3.5" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-semibold text-xs text-foreground truncate">{lead.contact_name || "Contato"}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{lead.contact_phone}</p>
                          </div>
                        </div>

                        <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-500/30 bg-amber-500/10">
                          {lead.inactive_hours}h sem contato
                        </Badge>
                      </div>

                      {lead.unattended_since && (
                        <p className="text-xs text-muted-foreground italic bg-muted/30 p-2 rounded-md border border-border/40">
                          Sem interação desde {new Date(lead.unattended_since).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(`/inbox?c=${lead.conversation_id}`)}
                        className="h-7 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10 px-2"
                      >
                        <ExternalLink className="size-3" />
                        Abrir conversa
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setDialogInitialValues({
                            contact_id: lead.contact_id,
                            conversation_id: lead.conversation_id,
                            title: "Retomar contato com cliente",
                          });
                          setCreateDialogOpen(true);
                        }}
                        className="h-7 text-xs gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                      >
                        <Plus className="size-3" />
                        Criar follow-up
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card">
              <Clock className="mx-auto size-8 text-muted-foreground/50 mb-2" />
              <h3 className="text-sm font-semibold text-foreground">Nenhum follow-up nesta visualização</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Tudo em ordem por aqui ou adicione uma nova ação.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => (
                <FollowupCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onSnooze={handleSnooze}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Daily Summary Rail (w-full lg:w-80 shrink-0) */}
        <div className="w-full lg:w-80 shrink-0 space-y-4">
          {/* Card 1: Resumo do Dia */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground font-sans">
                Resumo do Dia
              </span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Hoje
              </Badge>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Progresso</span>
                <span className="text-foreground font-bold">
                  {counts.today > 0 ? `${Math.round((counts.today / (counts.today + counts.overdue || 1)) * 100)}%` : "100%"}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${counts.today > 0 ? Math.min(100, Math.round((counts.today / (counts.today + counts.overdue || 1)) * 100)) : 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60 text-center">
              <div className="p-2 rounded-lg bg-muted/40 border border-border/40">
                <span className="text-lg font-bold text-foreground block font-sans">
                  {counts.today}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight block">
                  Para hoje
                </span>
              </div>

              <div className="p-2 rounded-lg bg-rose-500/5 border border-rose-500/20">
                <span className="text-lg font-bold text-[#D16A3A] block font-sans">
                  {counts.overdue}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight block">
                  Atrasados
                </span>
              </div>

              <div className="p-2 rounded-lg bg-muted/40 border border-border/40">
                <span className="text-lg font-bold text-foreground block font-sans">
                  {counts.upcoming}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight block">
                  Futuros
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Leads em Atenção */}
          {(counts.no_next_action > 0 || counts.forgotten > 0) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 font-sans">
                <ShieldAlert className="size-4 shrink-0" />
                <span>Atenção Necessária</span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">
                Você possui <strong className="font-semibold text-foreground">{counts.no_next_action} leads</strong> sem próxima ação e{" "}
                <strong className="font-semibold text-foreground">{counts.forgotten} leads</strong> inativos há mais de 72 horas.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setView("no_next_action")}
                className="w-full h-8 text-xs font-semibold border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                Verificar leads em risco
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Follow-up Creation Dialog */}
      <CreateFollowupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialValues={dialogInitialValues}
        onSubmit={handleCreateFollowup}
      />
    </div>
  );
}
