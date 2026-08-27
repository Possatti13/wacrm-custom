import React from "react";
import { cn } from "@/lib/utils";
import { CiclopesSymbol } from "./ciclopes-symbol";
import { CiclopesWordmark } from "./ciclopes-wordmark";

interface CiclopesLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  layout?: "horizontal" | "stacked" | "symbol-only";
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "aegean" | "white" | "current";
  showTagline?: boolean;
  taglineText?: string;
  className?: string;
}

/**
 * Ciclopes Full Logo Lockup
 * Supports horizontal lockup (for sidebar/header), stacked lockup (for splash/login),
 * and symbol-only mode with tagline options.
 */
export function CiclopesLogo({
  layout = "horizontal",
  size = "md",
  variant = "aegean",
  showTagline = false,
  taglineText = "Muitas conversas, uma visão.",
  className,
  ...props
}: CiclopesLogoProps) {
  const symbolSizes = {
    sm: 24,
    md: 32,
    lg: 48,
    xl: 64,
  };

  const wordmarkSizes = {
    sm: "sm",
    md: "md",
    lg: "lg",
    xl: "xl",
  } as const;

  const taglineSizeClasses = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
    xl: "text-base",
  };

  const tagColorClasses = {
    aegean: "text-[#1E3A5F]/70 dark:text-[#F7F3EC]/70",
    white: "text-[#F7F3EC]/80",
    current: "text-current/75",
  };

  if (layout === "symbol-only") {
    return (
      <div className={cn("inline-flex items-center justify-center", className)} {...props}>
        <CiclopesSymbol
          size={symbolSizes[size]}
          variant={variant}
        />
      </div>
    );
  }

  if (layout === "stacked") {
    return (
      <div
        className={cn("flex flex-col items-center justify-center text-center gap-3", className)}
        {...props}
      >
        <CiclopesSymbol
          size={symbolSizes[size]}
          variant={variant}
        />
        <div className="flex flex-col items-center">
          <CiclopesWordmark
            size={wordmarkSizes[size]}
            variant={variant}
          />
          {showTagline && (
            <span
              className={cn(
                "mt-1.5 font-sans font-normal tracking-wide italic",
                taglineSizeClasses[size],
                tagColorClasses[variant]
              )}
            >
              {taglineText}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Default: Horizontal Lockup
  return (
    <div
      className={cn("inline-flex items-center gap-3", className)}
      {...props}
    >
      <CiclopesSymbol
        size={symbolSizes[size]}
        variant={variant}
      />
      <div className="flex flex-col leading-tight">
        <CiclopesWordmark
          size={wordmarkSizes[size]}
          variant={variant}
        />
        {showTagline && (
          <span
            className={cn(
              "text-[10px] font-sans font-normal tracking-tight -mt-0.5 text-muted-foreground",
              tagColorClasses[variant]
            )}
          >
            {taglineText}
          </span>
        )}
      </div>
    </div>
  );
}
