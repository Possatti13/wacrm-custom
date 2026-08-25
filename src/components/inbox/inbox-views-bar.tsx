"use client";

import { cn } from "@/lib/utils";
import { Flame, MessageCircle, Clock, Calendar, CheckCircle2, ListFilter } from "lucide-react";

export type InboxViewType =
  | "all"
  | "priority"
  | "needs_reply"
  | "waiting_customer"
  | "follow_up"
  | "closed";

interface InboxViewsBarProps {
  activeView: InboxViewType;
  onViewChange: (view: InboxViewType) => void;
  counts?: {
    all?: number;
    priority?: number;
    needs_reply?: number;
    waiting_customer?: number;
    follow_up?: number;
    closed?: number;
  };
}

export function InboxViewsBar({
  activeView,
  onViewChange,
  counts = {},
}: InboxViewsBarProps) {
  const views: Array<{
    id: InboxViewType;
    label: string;
    icon: typeof Flame;
    color: string;
    count?: number;
  }> = [
    {
      id: "all",
      label: "Todas",
      icon: ListFilter,
      color: "text-muted-foreground",
      count: counts.all,
    },
    {
      id: "priority",
      label: "Prioridades",
      icon: Flame,
      color: "text-emerald-500",
      count: counts.priority,
    },
    {
      id: "needs_reply",
      label: "Precisa de Resposta",
      icon: MessageCircle,
      color: "text-primary",
      count: counts.needs_reply,
    },
    {
      id: "waiting_customer",
      label: "Aguardando",
      icon: Clock,
      color: "text-amber-500",
      count: counts.waiting_customer,
    },
    {
      id: "closed",
      label: "Fechadas",
      icon: CheckCircle2,
      color: "text-slate-400",
      count: counts.closed,
    },
  ];

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-1.5 scrollbar-none">
      {views.map((v) => {
        const Icon = v.icon;
        const isActive = activeView === v.id;
        return (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all shrink-0",
              isActive
                ? "bg-background text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", v.color)} />
            <span>{v.label}</span>
            {v.count !== undefined && v.count > 0 && (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                  isActive
                    ? "bg-primary/15 text-primary font-semibold"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {v.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
