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
import { Tag, ShieldCheck } from "lucide-react";

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
  const supabase = createClient();
  const { accountId } = useAuth();

  const [taxonomies, setTaxonomies] = useState<TenantObjectionTaxonomy[]>([]);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!open || !accountId) return;
    const currentAccountId = accountId;

    let mounted = true;
    async function loadTaxonomy() {
      setLoading(true);
      try {
        const list = await listTenantObjectionTaxonomy(supabase, currentAccountId);
        if (!mounted) return;
        setTaxonomies(list);
        if (currentTaxonomyId) {
          setSelectedTaxonomyId(currentTaxonomyId);
        } else if (list.length > 0) {
          setSelectedTaxonomyId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load objection taxonomy:', err);
        toast.error('Erro ao carregar categorias de objeção.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadTaxonomy();

    return () => {
      mounted = false;
    };
  }, [open, accountId, currentTaxonomyId, supabase]);

  const handleSave = async () => {
    if (!accountId || !occurrenceId || !selectedTaxonomyId) return;

    setSaving(true);
    try {
      const res = await overrideObjectionTaxonomy(
        supabase,
        accountId,
        occurrenceId,
        selectedTaxonomyId,
        reason.trim() || undefined
      );

      if (res.success) {
        toast.success('Categoria de objeção atualizada com sucesso!');
        onOverridden?.();
        onOpenChange(false);
      } else {
        toast.error('Não foi possível atualizar a objeção.');
      }
    } catch (err) {
      console.error('Override error:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar classificação da objeção.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
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
              <p className="italic text-foreground">&quot;{rawObjectionText}&quot;</p>
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
