"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Users, ShieldAlert, AlertCircle } from "lucide-react";
import type { ProductIntelligenceResponse } from "@/lib/analytics/types";

interface ProductFrictionMatrixProps {
  data: ProductIntelligenceResponse;
  loading?: boolean;
}

export function ProductFrictionMatrix({ data, loading }: ProductFrictionMatrixProps) {
  if (loading) {
    return (
      <Card className="border-border/70 shadow-sm animate-pulse">
        <CardHeader className="p-5">
          <div className="h-6 w-48 bg-muted rounded mb-2" />
          <div className="h-4 w-64 bg-muted rounded" />
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-muted/40 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { products = [] } = data;

  const getFrictionBadge = (rate: number) => {
    if (rate >= 50) {
      return (
        <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 text-xs font-semibold">
          Fricção Alta ({rate}%)
        </Badge>
      );
    }
    if (rate >= 20) {
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs font-semibold">
          Fricção Média ({rate}%)
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs font-semibold">
        Fricção Baixa ({rate}%)
      </Badge>
    );
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="p-5 pb-3 border-b border-border/40">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold font-serif tracking-tight text-foreground">
                Demanda & Fricção por Produto
              </CardTitle>
              <Badge variant="secondary" className="font-sans text-xs">
                {products.length} {products.length === 1 ? "produto" : "produtos"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cruza menções de interesse com objeções registradas para cada item do catálogo.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {products.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Nenhum interesse ou objeção vinculada a produtos do catálogo no período.
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-border/50 bg-secondary/20 hover:border-border transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      <Package className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-foreground">
                          {item.name}
                        </span>
                        {item.sku && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {item.sku}
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>{getFrictionBadge(item.friction_rate)}</div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/40 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Leads Interessados</span>
                    <span className="font-bold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <Users className="h-3.5 w-3.5 text-blue-400" />
                      {item.unique_interested_contacts}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Menções de Interesse</span>
                    <span className="font-bold text-foreground text-sm mt-0.5 block">
                      {item.interest_occurrences}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Objeções Registradas</span>
                    <span className="font-bold text-foreground text-sm flex items-center gap-1 mt-0.5">
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                      {item.objection_occurrences}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Principal Objeção</span>
                    <span className="font-semibold text-foreground truncate block mt-0.5">
                      {item.top_objection_name || "Nenhuma"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
