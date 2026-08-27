import React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CiclopesSymbol } from "@/components/brand/ciclopes-symbol";

interface EmptyStateProps {
  icon?: LucideIcon;
  useSymbol?: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  compact?: boolean;
}

/**
 * Ciclopes Standardized Empty State Component
 * Gives users clarity on what the section is, why it matters, and the next step to take.
 */
export function EmptyState({
  icon: Icon,
  useSymbol = false,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  secondaryActionLabel,
  onSecondaryAction,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border/80 bg-card/50 p-8 transition-all",
        compact ? "py-6 px-4" : "py-12 px-6",
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/80 text-primary shadow-inner">
        {useSymbol ? (
          <CiclopesSymbol size={28} variant="aegean" />
        ) : Icon ? (
          <Icon className="h-6 w-6 text-primary" />
        ) : (
          <CiclopesSymbol size={28} variant="aegean" />
        )}
      </div>

      <h3 className="text-base font-semibold text-foreground tracking-tight max-w-md">
        {title}
      </h3>

      <p className="mt-1.5 text-sm text-muted-foreground max-w-sm leading-relaxed">
        {description}
      </p>

      {(actionLabel || secondaryActionLabel) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actionLabel && (
            actionHref ? (
              <a href={actionHref}>
                <Button className="bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-medium shadow-sm">
                  {actionLabel}
                </Button>
              </a>
            ) : (
              <Button
                onClick={onAction}
                className="bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-medium shadow-sm"
              >
                {actionLabel}
              </Button>
            )
          )}
          {secondaryActionLabel && (
            <Button
              variant="outline"
              onClick={onSecondaryAction}
              className="border-border text-foreground hover:bg-secondary"
            >
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
