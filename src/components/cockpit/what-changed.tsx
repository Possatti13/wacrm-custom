"use client";

import React from "react";
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import type { WhatChangedHighlight } from "@/lib/analytics/types";

interface WhatChangedProps {
  highlights: WhatChangedHighlight[];
}

export function WhatChanged({ highlights }: WhatChangedProps) {
  if (!highlights || highlights.length === 0) {
    return null;
  }

  const getIcon = (direction: string, severity: string) => {
    if (severity === "danger" || severity === "warning") {
      return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />;
    }
    if (direction === "up") {
      return <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />;
    }
    if (direction === "down") {
      return <TrendingDown className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />;
    }
    return <Sparkles className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />;
  };

  const getBorderColor = (severity: string) => {
    switch (severity) {
      case "danger":
        return "border-rose-500/30 bg-rose-500/5";
      case "warning":
        return "border-amber-500/30 bg-amber-500/5";
      case "positive":
        return "border-emerald-500/30 bg-emerald-500/5";
      default:
        return "border-blue-500/30 bg-blue-500/5";
    }
  };

  return (
    <div className="p-4 rounded-xl border border-border/80 bg-card/60 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Sparkles className="h-3.5 w-3.5 text-blue-400" />
        <span>Destaques da Operação (O que mudou)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {highlights.map((h, i) => (
          <div
            key={i}
            className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm ${getBorderColor(
              h.severity
            )}`}
          >
            {getIcon(h.direction, h.severity)}
            <span className="text-xs sm:text-sm font-medium text-foreground/90 leading-snug">
              {h.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
