"use client";

import { useState, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Task, CreateTaskInput, TaskPriority } from "@/types/tasks";
import { Sparkles } from "lucide-react";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  initialTask?: Task | null;
  initialSuggestion?: {
    actionText: string;
    contactId?: string;
    conversationId?: string;
    provenance?: Record<string, unknown>;
  } | null;
}

export function TaskFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialTask,
  initialSuggestion,
}: TaskFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueAt, setDueAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialTask) {
      setTitle(initialTask.title);
      setDescription(initialTask.description || "");
      setPriority(initialTask.priority);
      setDueAt(
        initialTask.due_at
          ? new Date(initialTask.due_at).toISOString().slice(0, 16)
          : ""
      );
    } else if (initialSuggestion) {
      setTitle(initialSuggestion.actionText);
      setDescription("Tarefa gerada a partir da recomendação da inteligência comercial.");
      setPriority("high");
      // Default to tomorrow at 09:00
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setDueAt(tomorrow.toISOString().slice(0, 16));
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueAt("");
    }
  }, [initialTask, initialSuggestion, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        contact_id: initialSuggestion?.contactId || initialTask?.contact_id || null,
        conversation_id:
          initialSuggestion?.conversationId || initialTask?.conversation_id || null,
        source: initialSuggestion ? "intelligence" : (initialTask?.source || "manual"),
        ai_suggestion_provenance: initialSuggestion?.provenance || initialTask?.ai_suggestion_provenance,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              {initialSuggestion ? (
                <>
                  <Sparkles className="h-4 w-4 text-primary" />
                  Criar Tarefa de Follow-up (IA)
                </>
              ) : initialTask ? (
                "Editar Tarefa"
              ) : (
                "Nova Tarefa de Atendimento"
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="task-title" className="text-xs">
                Título da Tarefa *
              </Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Enviar proposta de financiamento"
                required
                className="text-xs"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="task-desc" className="text-xs">
                Observações / Contexto
              </Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes adicionais para o atendente..."
                className="text-xs resize-none h-20"
              />
            </div>

            {/* Priority & Due Date Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Prioridade</Label>
                <Select
                  value={priority}
                  onValueChange={(val) => setPriority(val as TaskPriority)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-due" className="text-xs">
                  Data e Hora Limite
                </Label>
                <Input
                  id="task-due"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
              {submitting ? "Salvando..." : "Salvar Tarefa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
