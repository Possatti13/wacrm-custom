import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  badge,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1",
        className
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          {icon && <div className="shrink-0">{icon}</div>}
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-sans">
            {title}
          </h1>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {subtitle && (
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
