"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CatalogCategory, CatalogItemWithDetails, CreateCatalogItemInput } from "@/lib/catalog/types";
import {
  listCatalogItems,
  listCategories,
  createCatalogItem,
  updateCatalogItem,
  archiveCatalogItem,
  getCatalogItem,
} from "@/lib/catalog/repository";
import { CatalogItemDialog } from "./catalog-item-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export function CatalogView() {
  const { accountId } = useAuth();
  const [items, setItems] = useState<CatalogItemWithDetails[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItemWithDetails | null>(null);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const db = createClient();
    try {
      const [cats, rawItems] = await Promise.all([
        listCategories(db, accountId),
        listCatalogItems(db, accountId, {
          status: statusFilter === "all" ? undefined : (statusFilter as "active" | "inactive"),
          type: typeFilter === "all" ? undefined : (typeFilter as "product" | "service"),
          category_id: categoryFilter === "all" ? undefined : categoryFilter,
        }),
      ]);

      setCategories(cats);

      // Load details (including alias terms) for items
      const detailedItems = await Promise.all(
        rawItems.map(async (it) => {
          try {
            const res = await getCatalogItem(db, accountId, it.id);
            return res || (it as CatalogItemWithDetails);
          } catch {
            return it as CatalogItemWithDetails;
          }
        })
      );

      setItems(detailedItems);
    } catch (err) {
      console.error("Failed to load catalog:", err);
      toast.error("Erro ao carregar catálogo.");
    } finally {
      setLoading(false);
    }
  }, [accountId, statusFilter, typeFilter, categoryFilter]);

  useEffect(() => {
    let isMounted = true;
    if (!accountId) return;

    loadData().catch((err) => {
      console.error("Failed to load catalog:", err);
    });

    return () => {
      isMounted = false;
    };
  }, [loadData, accountId]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase().trim();
    return items.filter((it) => {
      const matchName = it.name.toLowerCase().includes(q);
      const matchSku = it.sku?.toLowerCase().includes(q);
      const matchTerms = it.terms?.some((t) => t.term.toLowerCase().includes(q));
      const matchDesc = it.description?.toLowerCase().includes(q);
      return matchName || matchSku || matchTerms || matchDesc;
    });
  }, [items, search]);

  const handleSaveItem = async (input: CreateCatalogItemInput, itemId?: string) => {
    if (!accountId) return;
    const db = createClient();
    try {
      if (itemId) {
        await updateCatalogItem(db, accountId, itemId, input);
        toast.success("Item do catálogo atualizado.");
      } else {
        await createCatalogItem(db, accountId, input);
        toast.success("Item adicionado ao catálogo.");
      }
      loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Falha ao salvar: ${msg}`);
      throw err;
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (!accountId) return;
    if (!confirm(`Deseja realmente arquivar "${name}" do catálogo?`)) return;
    const db = createClient();
    try {
      await archiveCatalogItem(db, accountId, id);
      toast.success("Item arquivado do catálogo.");
      loadData();
    } catch (err) {
      console.error("Failed to archive catalog item:", err);
      toast.error("Erro ao arquivar item.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground font-sans flex items-center gap-2">
            <Package className="h-5 w-5 text-[#1E3A5F] dark:text-[#5B8EC2]" />
            Catálogo de Produtos & Serviços
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cadastre os itens da sua empresa para que a IA reconheça automaticamente intenções e interesses de compra nas conversas.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingItem(null);
            setDialogOpen(true);
          }}
          className="bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground gap-2 font-medium text-xs shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novo Item
        </Button>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por produto, serviço ou sinônimo..."
            className="pl-9 h-9 text-xs border-border bg-background"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              if (v) setTypeFilter(v);
            }}
          >
            <SelectTrigger className="h-9 text-xs border-border bg-background w-[120px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="product">Produtos</SelectItem>
              <SelectItem value="service">Serviços</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              if (v) setCategoryFilter(v);
            }}
          >
            <SelectTrigger className="h-9 text-xs border-border bg-background w-[140px]">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => {
              if (v) setStatusFilter(v);
            }}
          >
            <SelectTrigger className="h-9 text-xs border-border bg-background w-[120px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Apenas Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="h-44 animate-pulse bg-muted/40 border-border" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nenhum item no catálogo"
          description="Cadastre seus principais produtos ou serviços com seus sinônimos para ativar o mapeamento automático de interesse durante o atendimento."
          actionLabel="Cadastrar Primeiro Item"
          onAction={() => {
            setEditingItem(null);
            setDialogOpen(true);
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const aliasList = item.terms?.filter((t) => t.kind === "alias") || [];
            const isProduct = item.type === "product";

            return (
              <Card
                key={item.id}
                className="border-border/80 bg-card hover:border-primary/40 transition-all shadow-sm flex flex-col justify-between"
              >
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider font-semibold border-border bg-secondary"
                        >
                          {isProduct ? "Produto" : "Serviço"}
                        </Badge>
                        {item.category && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground border-border"
                          >
                            {item.category.name}
                          </Badge>
                        )}
                        {item.status === "inactive" && (
                          <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/30">
                            Inativo
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-sm font-semibold text-foreground leading-snug">
                        {item.name}
                      </CardTitle>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingItem(item);
                          setDialogOpen(true);
                        }}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(item.id, item.name)}
                        className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {item.description && (
                    <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {item.description}
                    </CardDescription>
                  )}
                </CardHeader>

                <CardContent className="p-4 pt-2 border-t border-border/40 mt-2">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Sinônimos identificáveis ({aliasList.length})
                    </span>
                    {aliasList.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground italic">
                        Apenas pelo nome exato
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {aliasList.slice(0, 4).map((alias) => (
                          <span
                            key={alias.id}
                            className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] text-foreground font-mono"
                          >
                            {alias.term}
                          </span>
                        ))}
                        {aliasList.length > 4 && (
                          <span className="text-[10px] text-muted-foreground self-center">
                            +{aliasList.length - 4} mais
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog */}
      <CatalogItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories}
        initialItem={editingItem}
        onSave={handleSaveItem}
      />
    </div>
  );
}
