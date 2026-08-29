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
import {
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  Plus,
  Search,
  Sparkles,
  UserX,
  History,
  Flame,
  ExternalLink,
  Phone,
  User,
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

  // Summary counts for tabs
  const [counts, setCounts] = useState({
    today: 0,
    overdue: 0,
    upcoming: 0,
    waiting_customer: 0,
    no_next_action: 0,
    forgotten: 0,
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
        setCounts({
          today: todayRes.total,
          overdue: overdueRes.total,
          upcoming: upcomingRes.total,
          waiting_customer: waitingRes.total,
          no_next_action: noActionRes.total,
          forgotten: forgottenRes.total,
        });
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

    // Optimistic update
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
    } catch (err: any) {
      console.error("Failed to complete task:", err);
      toast.error("Erro ao concluir follow-up.");
      fetchCockpitData();
    }
  };

  const handleSnooze = async (task: Task, snoozeUntilIso: string, reason?: string) => {
    if (!accountId) return;
    const supabase = createClient();

    // Optimistic update
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
    } catch (err: any) {
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
    } catch (err: any) {
      console.error("Failed to create task:", err);
      toast.error("Erro ao criar follow-up.");
    }
  };

  // Filtered list by search term
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

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Cockpit de Follow-ups
            <Badge variant="secondary" className="text-xs font-normal">
              V1.2
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            O que você precisa fazer agora para avançar suas negociações
          </p>
        </div>

        <Button
          onClick={() => {
            setDialogInitialValues({});
            setCreateDialogOpen(true);
          }}
          className="gap-1.5 shadow-sm bg-primary"
        >
          <Plus className="h-4 w-4" />
          Novo Follow-up
        </Button>
      </div>

      {/* 6 Smart Views Navigation Tabs */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-3">
        <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={view === "today" ? "default" : "outline"}
            onClick={() => setView("today")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>Hoje</span>
            {counts.today > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "today" ? "bg-white/20 text-white" : "bg-primary/15 text-primary"
              )}>
                {counts.today}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant={view === "overdue" ? "destructive" : "outline"}
            onClick={() => setView("overdue")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
            <span>Atrasados</span>
            {counts.overdue > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "overdue" ? "bg-white/20 text-white" : "bg-rose-500/15 text-rose-600"
              )}>
                {counts.overdue}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant={view === "upcoming" ? "default" : "outline"}
            onClick={() => setView("upcoming")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            <span>Próximos</span>
            {counts.upcoming > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "upcoming" ? "bg-white/20 text-white" : "bg-blue-500/15 text-blue-600"
              )}>
                {counts.upcoming}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant={view === "waiting_customer" ? "default" : "outline"}
            onClick={() => setView("waiting_customer")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <Users className="h-3.5 w-3.5 text-amber-400" />
            <span>Aguardando Cliente</span>
            {counts.waiting_customer > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "waiting_customer" ? "bg-white/20 text-white" : "bg-amber-500/15 text-amber-600"
              )}>
                {counts.waiting_customer}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant={view === "no_next_action" ? "default" : "outline"}
            onClick={() => setView("no_next_action")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <UserX className="h-3.5 w-3.5 text-purple-400" />
            <span>Sem Próxima Ação</span>
            {counts.no_next_action > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "no_next_action" ? "bg-white/20 text-white" : "bg-purple-500/15 text-purple-600"
              )}>
                {counts.no_next_action}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant={view === "forgotten" ? "default" : "outline"}
            onClick={() => setView("forgotten")}
            className="h-9 text-xs gap-1.5 px-3 shrink-0"
          >
            <History className="h-3.5 w-3.5 text-orange-400" />
            <span>Leads Esquecidos</span>
            {counts.forgotten > 0 && (
              <span className={cn(
                "rounded-full text-[10px] px-1.5 font-bold",
                view === "forgotten" ? "bg-white/20 text-white" : "bg-orange-500/15 text-orange-600"
              )}>
                {counts.forgotten}
              </span>
            )}
          </Button>
        </div>

        {/* Search Input */}
        <div className="relative w-full lg:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por contato ou ação..."
            className="pl-8 text-xs h-9"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : view === "no_next_action" ? (
        /* SEM PRÓXIMA AÇÃO VIEW */
        noNextActionLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              Excelente! Todos os leads em negociação possuem próxima ação definida.
            </h3>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {noNextActionLeads.map((lead) => (
              <div
                key={lead.contact_id}
                className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={lead.contact_avatar_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {lead.contact_name?.slice(0, 2).toUpperCase() || <User className="h-3.5 w-3.5" />}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{lead.contact_name || "Contato"}</p>
                        <p className="text-xs text-muted-foreground">{lead.contact_phone}</p>
                      </div>
                    </div>

                    {lead.lead_score !== null && (
                      <Badge variant="outline" className="text-[10px] gap-1 font-bold">
                        <Flame className="h-2.5 w-2.5 text-rose-500" />
                        Score: {lead.lead_score}
                      </Badge>
                    )}
                  </div>

                  {lead.deal_title && (
                    <Badge variant="secondary" className="text-[10px]">
                      Deal: {lead.deal_title}
                    </Badge>
                  )}

                  {lead.suggested_next_action && (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-2 text-xs">
                      <span className="font-semibold text-primary block text-[10px] uppercase">
                        Sugestão da Inteligência
                      </span>
                      <p className="text-foreground mt-0.5">{lead.suggested_next_action}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/inbox?conversationId=${lead.conversation_id}`)}
                    className="h-8 text-xs gap-1 text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
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
                    className="h-8 text-xs gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Criar Ação
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : view === "forgotten" ? (
        /* LEADS ESQUECIDOS VIEW */
        forgottenLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              Nenhum lead qualificado esquecido há mais de 72 horas!
            </h3>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {forgottenLeads.map((lead) => (
              <div
                key={lead.contact_id}
                className="flex flex-col justify-between rounded-xl border border-rose-500/20 bg-rose-500/[0.02] p-4 space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={lead.contact_avatar_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {lead.contact_name?.slice(0, 2).toUpperCase() || <User className="h-3.5 w-3.5" />}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{lead.contact_name || "Contato"}</p>
                        <p className="text-xs text-muted-foreground">{lead.contact_phone}</p>
                      </div>
                    </div>

                    <Badge variant="destructive" className="text-[10px] font-bold">
                      {lead.inactive_hours}h sem contato
                    </Badge>
                  </div>

                  {lead.deal_title && (
                    <Badge variant="secondary" className="text-[10px]">
                      Deal aberto: {lead.deal_title}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/inbox?conversationId=${lead.conversation_id}`)}
                    className="h-8 text-xs gap-1 text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Abrir conversa
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => {
                      setDialogInitialValues({
                        contact_id: lead.contact_id,
                        conversation_id: lead.conversation_id,
                        deal_id: lead.deal_id,
                        title: "Recontato de lead inativo",
                        action_type: "recontact",
                      });
                      setCreateDialogOpen(true);
                    }}
                    className="h-8 text-xs gap-1 bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    <Plus className="h-3 w-3" />
                    Reativar Lead
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filteredTasks.length === 0 ? (
        /* EMPTY STATE FOR REGULAR TABS */
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Nenhum follow-up encontrado nesta visualização
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {view === "today"
              ? "Tudo em dia para hoje! Nenhuma ação comercial pendente com prazo para hoje."
              : view === "overdue"
              ? "Sem atrasos! Todas as tarefas e follow-ups estão dentro do prazo."
              : "Nenhum registro corresponde ao filtro selecionado."}
          </p>
        </div>
      ) : (
        /* STANDARD FOLLOW-UP CARDS GRID */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* Fast Creation Dialog */}
      <CreateFollowupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateFollowup}
        initialValues={dialogInitialValues}
      />
    </div>
  );
}
