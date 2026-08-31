"use client";

import { useState, useEffect } from "react";
import type { CreateTaskInput, ActionType, WaitingOn, TaskPriority } from "@/types/tasks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Phone,
  FileText,
  FileCheck,
  CheckSquare,
  RotateCcw,
  Users,
  Briefcase,
  Clock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { addHours, addDays, setHours, setMinutes, nextMonday } from "date-fns";
import { cn } from "@/lib/utils";

interface CreateFollowupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  initialValues?: Partial<CreateTaskInput>;
}

const ACTION_OPTIONS: Array<{ type: ActionType; label: string; icon: LucideIcon }> = [
  { type: "message", label: "Mensagem", icon: MessageSquare },
  { type: "call", label: "Ligação", icon: Phone },
  { type: "proposal", label: "Proposta", icon: FileText },
  { type: "documents", label: "Documentos", icon: FileCheck },
  { type: "decision", label: "Decisão", icon: CheckSquare },
  { type: "recontact", label: "Recontato", icon: RotateCcw },
  { type: "meeting", label: "Reunião", icon: Users },
  { type: "other", label: "Outro", icon: Briefcase },
];

export function CreateFollowupDialog({
  open,
  onOpenChange,
  onSubmit,
  initialValues,
}: CreateFollowupDialogProps) {
  const [actionType, setActionType] = useState<ActionType>("message");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [waitingOn, setWaitingOn] = useState<WaitingOn | null>(null);
  const [dueAt, setDueAt] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setActionType(initialValues?.action_type || "message");
      setTitle(initialValues?.title || "");
      setDescription(initialValues?.description || "");
      setPriority(initialValues?.priority || "medium");
      setWaitingOn(initialValues?.waiting_on || null);
      if (initialValues?.due_at) {
        setDueAt(initialValues.due_at);
        setCustomDate(initialValues.due_at.slice(0, 16));
      } else {
        // Default tomorrow 09:00
        const tomorrow = setMinutes(setHours(addDays(new Date(), 1), 9), 0);
        setDueAt(tomorrow.toISOString());
        setCustomDate(tomorrow.toISOString().slice(0, 16));
      }
    }
  }, [open, initialValues]);

  const handleApplyPresetDue = (targetDate: Date) => {
    setDueAt(targetDate.toISOString());
    setCustomDate(targetDate.toISOString().slice(0, 16));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        action_type: actionType,
        waiting_on: waitingOn,
        priority,
        due_at: dueAt || null,
        contact_id: initialValues?.contact_id || null,
        conversation_id: initialValues?.conversation_id || null,
        deal_id: initialValues?.deal_id || null,
        assigned_user_id: initialValues?.assigned_user_id || null,
        source: initialValues?.source || "manual",
        ai_suggestion_provenance: initialValues?.ai_suggestion_provenance || {},
      });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {initialValues?.source === "intelligence" ? (
              <>
                <Sparkles className="h-4 w-4 text-primary" />
                Criar Follow-up da Sugestão
              </>
            ) : (
              "Novo Follow-up Comercial"
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Action Type Chips */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Tipo de Ação</label>
            <div className="grid grid-cols-4 gap-1.5">
              {ACTION_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = actionType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setActionType(opt.type)}
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-lg border text-xs gap-1 transition-all",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                        : "border-border hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[11px] truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title & Context */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Ação a ser executada *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Enviar proposta atualizada com desconto..."
              required
              className="text-xs h-9"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contexto / Detalhes (opcional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes adicionais para lembrar na hora de falar com o cliente..."
              rows={2}
              className="text-xs"
            />
          </div>

          {/* Quick Due Date Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Quando executar?</label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2"
                onClick={() => handleApplyPresetDue(addHours(new Date(), 2))}
              >
                Hoje +2h
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2"
                onClick={() => handleApplyPresetDue(setMinutes(setHours(new Date(), 17), 0))}
              >
                Hoje 17:00
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2"
                onClick={() => {
                  const tomorrow = addDays(new Date(), 1);
                  handleApplyPresetDue(setMinutes(setHours(tomorrow, 9), 0));
                }}
              >
                Amanhã 09:00
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2"
                onClick={() => {
                  const monday = nextMonday(new Date());
                  handleApplyPresetDue(setMinutes(setHours(monday, 9), 0));
                }}
              >
                Próx. 2ª 09:00
              </Button>
            </div>

            <div className="pt-1">
              <Input
                type="datetime-local"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  if (e.target.value) {
                    setDueAt(new Date(e.target.value).toISOString());
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Waiting On State Toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Estado Operacional</label>
            <div className="flex gap-2">
              <Badge
                variant={waitingOn === "customer" ? "default" : "outline"}
                className="cursor-pointer text-xs py-1 px-2.5"
                onClick={() => setWaitingOn(waitingOn === "customer" ? null : "customer")}
              >
                Aguardando Cliente
              </Badge>
              <Badge
                variant={waitingOn === "team" ? "default" : "outline"}
                className="cursor-pointer text-xs py-1 px-2.5"
                onClick={() => setWaitingOn(waitingOn === "team" ? null : "team")}
              >
                Aguardando Equipe
              </Badge>
              <Badge
                variant={waitingOn === null ? "secondary" : "outline"}
                className="cursor-pointer text-xs py-1 px-2.5"
                onClick={() => setWaitingOn(null)}
              >
                Pronto para Ação
              </Badge>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim() || loading}
              className="gap-1.5 bg-primary"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Criar Follow-up</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
