"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CatalogCategory, CatalogItemWithDetails, CreateCatalogItemInput } from "@/lib/catalog/types";

interface CatalogItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CatalogCategory[];
  initialItem?: CatalogItemWithDetails | null;
  onSave: (input: CreateCatalogItemInput, itemId?: string) => Promise<void>;
}

export function CatalogItemDialog({
  open,
  onOpenChange,
  categories,
  initialItem,
  onSave,
}: CatalogItemDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"product" | "service">("product");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [aliases, setAliases] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialItem) {
      setName(initialItem.name || "");
      setType(initialItem.type || "product");
      setCategoryId(initialItem.category_id || "none");
      setSku(initialItem.sku || "");
      setDescription(initialItem.description || "");
      setStatus(initialItem.status === "inactive" ? "inactive" : "active");
      const aliasTerms = initialItem.terms
        ?.filter((t) => t.kind === "alias")
        .map((t) => t.term)
        .join(", ");
      setAliases(aliasTerms || "");
    } else {
      setName("");
      setType("product");
      setCategoryId("none");
      setSku("");
      setDescription("");
      setAliases("");
      setStatus("active");
    }
  }, [initialItem, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const aliasList = aliases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const input: CreateCatalogItemInput = {
        name: name.trim(),
        type,
        category_id: categoryId === "none" ? null : categoryId,
        sku: sku.trim() || null,
        description: description.trim() || null,
        status,
        aliases: aliasList,
      };

      await onSave(input, initialItem?.id);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save catalog item:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card text-card-foreground border-border">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground font-sans">
              {initialItem ? "Editar Item do Catálogo" : "Novo Produto ou Serviço"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Cadastre produtos e serviços para que a inteligência identifique o interesse dos clientes nas conversas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-type" className="text-xs font-medium text-foreground">
                  Tipo
                </Label>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    if (v) setType(v as "product" | "service");
                  }}
                >
                  <SelectTrigger id="item-type" className="h-9 text-xs border-border bg-background">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="product">Produto</SelectItem>
                    <SelectItem value="service">Serviço</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="item-category" className="text-xs font-medium text-foreground">
                  Categoria
                </Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => {
                    if (v) setCategoryId(v);
                  }}
                >
                  <SelectTrigger id="item-category" className="h-9 text-xs border-border bg-background">
                    <SelectValue placeholder="Sem categoria" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-name" className="text-xs font-medium text-foreground">
                Nome Oficial do Item *
              </Label>
              <Input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Honda Falcon 400 ou Consultoria Financeira"
                required
                className="h-9 text-xs border-border bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-aliases" className="text-xs font-medium text-foreground">
                Como os clientes costumam chamar este item? (Sinônimos)
              </Label>
              <Input
                id="item-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="Ex: falcon, falcon 400, moto falcon (separados por vírgula)"
                className="h-9 text-xs border-border bg-background"
              />
              <p className="text-[10px] text-muted-foreground">
                Ajuda o Ciclopes a reconhecer quando um cliente cita apelidos ou variações do produto na conversa.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-sku" className="text-xs font-medium text-foreground">
                  Código / Identificador (Opcional)
                </Label>
                <Input
                  id="item-sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Ex: FALCON-400"
                  className="h-9 text-xs border-border bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="item-status" className="text-xs font-medium text-foreground">
                  Disponibilidade
                </Label>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    if (v) setStatus(v as "active" | "inactive");
                  }}
                >
                  <SelectTrigger id="item-status" className="h-9 text-xs border-border bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="active">Ativo no Catálogo</SelectItem>
                    <SelectItem value="inactive">Inativo / Pausado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-description" className="text-xs font-medium text-foreground">
                Descrição Comercial (Opcional)
              </Label>
              <Textarea
                id="item-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes, especificações ou propostas de valor..."
                rows={2}
                className="text-xs border-border bg-background resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving || !name.trim()}
              className="bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground text-xs"
            >
              {saving ? "Salvando..." : initialItem ? "Atualizar Item" : "Cadastrar Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
