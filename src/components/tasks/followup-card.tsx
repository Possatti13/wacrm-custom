"use client";

import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Task, ActionType } from "@/types/tasks";
import {
  MessageSquare,
  Phone,
  FileText,
  FileCheck,
  CheckSquare,
  RotateCcw,
  Users,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Flame,
  Clock,
  AlertTriangle,
  User,
  CornerDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SnoozePopover } from "./snooze-popover";
import { cn } from "@/lib/utils";

interface FollowupCardProps {
  task: Task;
  onComplete: (task: Task) => Promise<void>;
  onSnooze: (task: Task, snoozeUntilIso: string, reason?: string) => Promise<void>;
  onDelete?: (task: Task) => Promise<void>;
}

export function getActionTypeConfig(type: ActionType) {
  switch (type) {
    case "message":
      return { label: "Mensagem", icon: MessageSquare, color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" };
    case "call":
      return { label: "Ligação", icon: Phone, color: "text-blue-600 bg-blue-500/10 border-blue-500/20" };
    case "proposal":
      return { label: "Proposta", icon: FileText, color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/20" };
    case "documents":
      return { label: "Documentos", icon: FileCheck, color: "text-amber-600 bg-amber-500/10 border-amber-500/20" };
    case "decision":
      return { label: "Decisão", icon: CheckSquare, color: "text-rose-600 bg-rose-500/10 border-rose-500/20" };
    case "recontact":
      return { label: "Recontato", icon: RotateCcw, color: "text-purple-600 bg-purple-500/10 border-purple-500/20" };
    case "meeting":
      return { label: "Reunião", icon: Users, color: "text-cyan-600 bg-cyan-500/10 border-cyan-500/20" };
    default:
      return { label: "Outro", icon: Briefcase, color: "text-muted-foreground bg-muted border-border" };
  }
}

export function FollowupCard({ task, onComplete, onSnooze }: FollowupCardProps) {
  const router = useRouter();
  const actionConfig = getActionTypeConfig(task.action_type || "other");
  const ActionIcon = actionConfig.icon;

  const effectiveDue = task.snoozed_until || task.due_at;
  const isOverdue = effectiveDue ? new Date(effectiveDue) < new Date() && task.status !== "completed" : false;
  const isCompleted = task.status === "completed";

  const handleOpenConversation = () => {
    if (task.conversation_id) {
      router.push(`/inbox?conversationId=${task.conversation_id}`);
    } else if (task.contact_id) {
      router.push(`/inbox?contactId=${task.contact_id}`);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md",
        isCompleted
          ? "border-border/60 bg-muted/20 opacity-75"
          : isOverdue
          ? "border-rose-500/30 bg-rose-500/[0.02]"
          : "border-border hover:border-primary/30"
      )}
    >
      <div className="space-y-3">
        {/* Header: Action Type Badge & Time / Delay */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("text-[11px] font-semibold gap-1 py-0.5 px-2", actionConfig.color)}
            >
              <ActionIcon className="h-3 w-3" />
              {actionConfig.label}
            </Badge>

            {task.waiting_on && (
              <Badge variant="secondary" className="text-[10px] py-0.5 px-1.5 font-normal">
                Aguardando {task.waiting_on === "customer" ? "Cliente" : task.waiting_on === "team" ? "Equipe" : "Externo"}
              </Badge>
            )}

            {task.snooze_count > 0 && (
              <Badge variant="outline" className="text-[10px] py-0.5 px-1.5 text-muted-foreground gap-1">
                <Clock className="h-2.5 w-2.5" />
                Adiado {task.snooze_count}x
              </Badge>
            )}
          </div>

          {/* Time / Relative Delay Badge */}
          {effectiveDue && (
            <div className="text-right shrink-0">
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md",
                  isCompleted
                    ? "text-muted-foreground bg-muted"
                    : isOverdue
                    ? "text-rose-600 bg-rose-500/10 font-bold"
                    : "text-foreground bg-muted/60"
                )}
              >
                {isOverdue && <AlertTriangle className="h-3 w-3 text-rose-500" />}
                {isOverdue
                  ? `${formatDistanceToNow(new Date(effectiveDue), { locale: ptBR, addSuffix: false })} atrasado`
                  : format(new Date(effectiveDue), "dd/MM 'às' HH:mm", { locale: ptBR })}
              </span>
            </div>
          )}
        </div>

        {/* Title & Context */}
        <div className="space-y-1">
          <h4
            className={cn(
              "text-sm font-semibold text-foreground leading-snug",
              isCompleted && "line-through text-muted-foreground"
            )}
          >
            {task.title}
          </h4>
          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {task.description}
            </p>
          )}
        </div>

        {/* Customer & Conversation Banner */}
        {task.contact && (
          <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-6 w-6">
                <AvatarImage src={task.contact.avatar_url || undefined} />
                <AvatarFallback className="text-[10px]">
                  {task.contact.name?.slice(0, 2).toUpperCase() || <User className="h-3 w-3" />}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{task.contact.name || "Contato"}</p>
                <p className="text-[10px] text-muted-foreground truncate">{task.contact.phone}</p>
              </div>
            </div>

            {task.lead_score !== undefined && task.lead_score !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] shrink-0 gap-1",
                  task.lead_score >= 70
                    ? "text-rose-600 border-rose-500/30 bg-rose-500/5 font-bold"
                    : task.lead_score >= 40
                    ? "text-amber-600 border-amber-500/30 bg-amber-500/5"
                    : "text-muted-foreground"
                )}
              >
                <Flame className="h-2.5 w-2.5" />
                Score: {task.lead_score}
              </Badge>
            )}
          </div>
        )}

        {/* Customer Replied Indicator */}
        {task.customer_replied_after_creation && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700">
            <CornerDownRight className="h-3 w-3 shrink-0" />
            <span>Cliente respondeu após este follow-up!</span>
          </div>
        )}

        {/* Operator Attribution */}
        {task.assigned_user && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="h-3 w-3" />
            <span>Responsável: <strong className="text-foreground font-medium">{task.assigned_user.full_name}</strong></span>
          </div>
        )}
      </div>

      {/* Footer Action Buttons */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-border/60">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleOpenConversation}
          disabled={!task.conversation_id && !task.contact_id}
          className="h-8 text-xs gap-1.5 text-primary hover:text-primary hover:bg-primary/10 px-2.5"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Abrir conversa</span>
        </Button>

        <div className="flex items-center gap-1.5">
          {!isCompleted && (
            <SnoozePopover
              onSnooze={(iso, reason) => onSnooze(task, iso, reason)}
              disabled={isCompleted}
            />
          )}

          <Button
            size="sm"
            variant={isCompleted ? "outline" : "default"}
            onClick={() => onComplete(task)}
            className={cn(
              "h-8 text-xs gap-1.5 shadow-sm",
              !isCompleted && "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{isCompleted ? "Reabrir" : "Concluir"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
