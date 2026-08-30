"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Quote, User, Clock, Package, ChevronLeft, ChevronRight, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadManagerObjectionDrilldown } from "@/lib/analytics/manager-cockpit-repository";
import type { ObjectionOccurrenceDetail, PeriodRange } from "@/lib/analytics/types";

interface ObjectionDrilldownDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  taxonomyCode: string | null;
  taxonomyName: string | null;
  range: PeriodRange;
}

export function ObjectionDrilldownDrawer({
  open,
  onOpenChange,
  accountId,
  taxonomyCode,
  taxonomyName,
  range,
}: ObjectionDrilldownDrawerProps) {
  const [items, setItems] = useState<ObjectionOccurrenceDetail[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    if (!open || !accountId || !taxonomyCode) return;
    setLoading(true);

    const db = createClient();
    loadManagerObjectionDrilldown(db, accountId, {
      taxonomyCode,
      range,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
      .then((res) => {
        setItems(res.items || []);
        setTotalCount(res.total_count || 0);
      })
      .catch((err) => {
        console.error("Failed to load objection drilldown:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, accountId, taxonomyCode, range, page]);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden border-border bg-card">
        <DialogHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-bold font-serif text-foreground">
                Ocorrências de Objeção: {taxonomyName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Total de {totalCount} ocorrências registradas no período selecionado.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">
              {taxonomyCode}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-muted/40 animate-pulse rounded-lg border border-border/40" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhuma ocorrência encontrada.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.occurrence_id}
                className="p-4 rounded-xl border border-border/60 bg-secondary/20 space-y-2.5 hover:border-border transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {item.contact_name}
                    </span>
                    {item.contact_phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {item.contact_phone}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatDate(item.occurred_at)}
                  </span>
                </div>

                {/* Evidence Quote */}
                {item.evidence_snippet && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-background/80 border border-border/50 text-xs text-foreground/90 italic">
                    <Quote className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <span>"{item.evidence_snippet}"</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/30 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {item.responsible_user_name}
                    </span>
                    {item.catalog_item_name && (
                      <span className="flex items-center gap-1 text-blue-400">
                        <Package className="h-3 w-3" /> {item.catalog_item_name}
                      </span>
                    )}
                    {item.override_at && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                        Classificação ajustada
                      </Badge>
                    )}
                  </div>

                  <Link href={`/inbox?conversationId=${item.conversation_id}`}>
                    <Button size="sm" variant="ghost" className="h-7 text-xs font-semibold gap-1 text-blue-400 hover:text-blue-300">
                      <MessageSquare className="h-3 w-3" />
                      <span>Ver conversa</span>
                    </Button>
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground bg-card">
            <span>
              Página {page} de {totalPages} ({totalCount} total)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
