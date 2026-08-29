"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { listTenantObjectionTaxonomy, overrideObjectionTaxonomy } from "@/lib/intelligence/taxonomy";
import type { TenantObjectionTaxonomy } from "@/lib/intelligence/types";
import { toast } from "sonner";
import { Check, Tag, ShieldCheck } from "lucide-react";

interface ObjectionOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occurrenceId?: string | null;
  currentTaxonomyId?: string | null;
  rawObjectionText?: string | null;
  onOverridden?: () => void;
}

export function ObjectionOverrideDialog({
  open,
  onOpenChange,
  occurrenceId,
  currentTaxonomyId,
  rawObjectionText,
  onOverridden,
}: ObjectionOverrideDialogProps) {
  const { accountId } = useAuth();
  const [taxonomies, setTaxonomies] = useState<TenantObjectionTaxonomy[]>([]);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    const supabase = createClient();
    listTenantObjectionTaxonomy(supabase, accountId)
      .then((items) => {
        setTaxonomies(items);
        if (currentTaxonomyId) {
          setSelectedTaxonomyId(currentTaxonomyId);
        } else if (items.length > 0) {
          setSelectedTaxonomyId(items[0].id);
        }
      })
      .catch((err) => {
        console.error("[ObjectionOverrideDialog] Failed to list taxonomies:", err);
      });
  }, [open, accountId, currentTaxonomyId]);

  const handleSave = async () => {
    if (!accountId || !occurrenceId || !selectedTaxonomyId) return;
    setSaving(true);
    try {
      const supabase = createClient();
      await overrideObjectionTaxonomy(supabase, accountId, occurrenceId, selectedTaxonomyId, reason);
      toast.success("Classificação da objeção atualizada!");
      onOpenChange(false);
      onOverridden?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao atualizar categoria: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-amber-500" />
            Corrigir Categoria da Objeção
          </DialogTitle>
          <DialogDescription>
            A classificação original da IA é preservada para auditoria. A nova categoria passa a vigorar nos relatórios analíticos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {rawObjectionText && (
            <div className="p-3 bg-muted/40 rounded-md text-xs border">
              <span className="font-semibold text-muted-foreground block mb-1">Citação original:</span>
              <p className="italic text-foreground">"{rawObjectionText}"</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="taxonomy-select">Nova Categoria Canônica</Label>
            <Select value={selectedTaxonomyId} onValueChange={(val) => setSelectedTaxonomyId(val || '')}>
              <SelectTrigger id="taxonomy-select">
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                {taxonomies.map((tax) => (
                  <SelectItem key={tax.id} value={tax.id}>
                    <div className="flex flex-col text-left">
                      <span className="font-medium">{tax.name}</span>
                      {tax.description && (
                        <span className="text-[10px] text-muted-foreground">{tax.description}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="override-reason">Motivo da Correção (opcional)</Label>
            <Input
              id="override-reason"
              placeholder="Ex.: Cliente mencionou taxa de juros e não preço base"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !selectedTaxonomyId} className="gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            {saving ? "Salvando..." : "Confirmar Correção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
