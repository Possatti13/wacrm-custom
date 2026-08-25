"use client";

import { useState } from "react";
import { format, isPast, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/tasks";
import {
  CheckCircle2,
  Circle,
  Clock,
  MoreVertical,
  Sparkles,
  Trash2,
  User,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TaskCardProps {
  task: Task;
  onToggleComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
  onEdit?: (task: Task) => void;
}

export function TaskCard({
  task,
  onToggleComplete,
  onDelete,
  onEdit,
}: TaskCardProps) {
  const [toggling, setToggling] = useState(false);
  const isCompleted = task.status === "completed";

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggleComplete(task);
    } finally {
      setToggling(false);
    }
  };

  // Due Date Calculations
  let dueLabel: string | null = null;
  let isOverdue = false;
  let isDueToday = false;

  if (task.due_at) {
    const dueDate = new Date(task.due_at);
    isOverdue = isPast(dueDate) && !isToday(dueDate) && !isCompleted;
    isDueToday = isToday(dueDate) && !isCompleted;

    if (isToday(dueDate)) {
      dueLabel = `Hoje, ${format(dueDate, "HH:mm")}`;
    } else if (isTomorrow(dueDate)) {
      dueLabel = `Amanhã, ${format(dueDate, "HH:mm")}`;
    } else {
      dueLabel = format(dueDate, "dd/MM/yyyy HH:mm", { locale: ptBR });
    }
  }

  const priorityColors: Record<string, string> = {
    urgent: "bg-rose-500/15 text-rose-600 border-rose-500/30",
    high: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    medium: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    low: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };

  const priorityLabels: Record<string, string> = {
    urgent: "Urgente",
    high: "Alta",
    medium: "Média",
    low: "Baixa",
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs transition-all hover:border-primary/40 hover:shadow-sm",
        isCompleted && "bg-muted/40 opacity-75"
      )}
    >
      {/* Complete Checkbox Toggle */}
      <button
        onClick={handleToggle}
        disabled={toggling}
        className="mt-0.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5 hover:text-emerald-500" />
        )}
      </button>

      {/* Task Content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h4
            className={cn(
              "text-sm font-semibold text-foreground leading-snug",
              isCompleted && "line-through text-muted-foreground"
            )}
          >
            {task.title}
          </h4>

          {/* Action Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all">
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(task)}>
                  Editar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onDelete(task)}
                className="text-rose-600 focus:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {task.description}
          </p>
        )}

        {/* Metadata Pill Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Priority Badge */}
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0", priorityColors[task.priority])}
          >
            {priorityLabels[task.priority] || task.priority}
          </Badge>

          {/* AI Source Badge */}
          {task.source === "intelligence" && (
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/10 text-primary text-[10px] gap-1 px-1.5 py-0"
            >
              <Sparkles className="h-2.5 w-2.5" />
              Sugerida por IA
            </Badge>
          )}

          {/* Due Date Badge */}
          {dueLabel && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium",
                isOverdue
                  ? "text-rose-600 font-semibold"
                  : isDueToday
                  ? "text-amber-600 font-semibold"
                  : "text-muted-foreground"
              )}
            >
              {isOverdue ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
              {dueLabel}
            </span>
          )}

          {/* Linked Contact */}
          {task.contact && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="h-3 w-3 text-primary/70" />
              <span className="truncate max-w-[120px]">
                {task.contact.name || task.contact.phone}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
