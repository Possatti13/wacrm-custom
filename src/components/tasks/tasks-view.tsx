"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Task, CreateTaskInput, TaskTimeframeFilter } from "@/types/tasks";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/tasks/repository";
import { TaskCard } from "./task-card";
import { TaskFormDialog } from "./task-form-dialog";
import {
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ListTodo,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export function TasksView() {
  const { accountId, user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<TaskTimeframeFilter>("today");
  const [search, setSearch] = useState("");
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();
    try {
      const data = await listTasks(supabase, accountId);
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks:", err);
      toast.error("Erro ao carregar tarefas.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Tab Counts
  const counts = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));

    let today = 0;
    let overdue = 0;
    let upcoming = 0;
    let completed = 0;

    for (const t of tasks) {
      if (t.status === "completed") {
        completed++;
        continue;
      }
      if (!t.due_at) {
        upcoming++;
        continue;
      }
      const d = new Date(t.due_at);
      if (d < now && d < startOfToday) {
        overdue++;
      } else if (d >= startOfToday && d <= endOfToday) {
        today++;
      } else if (d > endOfToday) {
        upcoming++;
      }
    }

    return {
      today,
      overdue,
      upcoming,
      completed,
      all: tasks.length,
    };
  }, [tasks]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));

    let result = tasks;

    if (timeframe === "today") {
      result = result.filter((t) => {
        if (t.status === "completed") return false;
        if (!t.due_at) return false;
        const d = new Date(t.due_at);
        return d >= startOfToday && d <= endOfToday;
      });
    } else if (timeframe === "overdue") {
      result = result.filter((t) => {
        if (t.status === "completed") return false;
        if (!t.due_at) return false;
        const d = new Date(t.due_at);
        return d < startOfToday;
      });
    } else if (timeframe === "upcoming") {
      result = result.filter((t) => {
        if (t.status === "completed") return false;
        if (!t.due_at) return true;
        const d = new Date(t.due_at);
        return d > endOfToday;
      });
    } else if (timeframe === "completed") {
      result = result.filter((t) => t.status === "completed");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.contact?.name?.toLowerCase().includes(q) ||
          t.contact?.phone.includes(q)
      );
    }

    return result;
  }, [tasks, timeframe, search]);

  const handleToggleComplete = async (task: Task) => {
    if (!accountId) return;
    const supabase = createClient();
    const nextStatus = task.status === "completed" ? "pending" : "completed";

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: nextStatus,
              completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
            }
          : t
      )
    );

    try {
      await updateTask(supabase, accountId, task.id, {
        status: nextStatus,
      });
      toast.success(nextStatus === "completed" ? "Tarefa concluída!" : "Tarefa reaberta.");
    } catch (err) {
      console.error("Failed to update task:", err);
      toast.error("Erro ao atualizar tarefa.");
      fetchTasks();
    }
  };

  const handleDeleteTask = async (task: Task) => {
    if (!accountId) return;
    const supabase = createClient();

    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await deleteTask(supabase, accountId, task.id);
      toast.success("Tarefa excluída.");
    } catch (err) {
      console.error("Failed to delete task:", err);
      toast.error("Erro ao excluir tarefa.");
      fetchTasks();
    }
  };

  const handleCreateOrEditTask = async (input: CreateTaskInput) => {
    if (!accountId) return;
    const supabase = createClient();

    if (editingTask) {
      const updated = await updateTask(supabase, accountId, editingTask.id, {
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.due_at,
      });
      setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? updated : t)));
      toast.success("Tarefa atualizada.");
      setEditingTask(null);
    } else {
      const created = await createTask(supabase, accountId, {
        ...input,
        created_by_user_id: user?.id,
      });
      setTasks((prev) => [created, ...prev]);
      toast.success("Tarefa criada com sucesso.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Tarefas & Próximas Ações
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe follow-ups, compromissos e recomendações geradas pela IA
          </p>
        </div>

        <Button
          onClick={() => {
            setEditingTask(null);
            setFormDialogOpen(true);
          }}
          className="gap-1.5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Tarefa
        </Button>
      </div>

      {/* Tabs & Search Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        <Tabs
          value={timeframe}
          onValueChange={(val) => setTimeframe(val as TaskTimeframeFilter)}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid grid-cols-5 w-full sm:w-auto h-9">
            <TabsTrigger value="today" className="text-xs gap-1.5 px-3">
              <Calendar className="h-3.5 w-3.5" />
              <span>Hoje</span>
              {counts.today > 0 && (
                <span className="rounded-full bg-primary/15 text-primary text-[10px] px-1.5 font-bold">
                  {counts.today}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="overdue" className="text-xs gap-1.5 px-3">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
              <span>Atrasadas</span>
              {counts.overdue > 0 && (
                <span className="rounded-full bg-rose-500/15 text-rose-600 text-[10px] px-1.5 font-bold">
                  {counts.overdue}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs gap-1.5 px-3">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <span>Próximas</span>
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs gap-1.5 px-3">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>Concluídas</span>
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs gap-1.5 px-3">
              <ListTodo className="h-3.5 w-3.5" />
              <span>Todas</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarefas..."
            className="pl-8 text-xs h-9"
          />
        </div>
      </div>

      {/* Task List Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Nenhuma tarefa encontrada
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {timeframe === "today"
              ? "Tudo em dia por hoje! Nenhuma tarefa agendada para este período."
              : "Nenhuma tarefa corresponde aos filtros selecionados."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggleComplete={handleToggleComplete}
              onDelete={handleDeleteTask}
              onEdit={(t) => {
                setEditingTask(t);
                setFormDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Task Creation / Edit Modal */}
      <TaskFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        onSubmit={handleCreateOrEditTask}
        initialTask={editingTask}
      />
    </div>
  );
}
