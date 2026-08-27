import React from "react";
import { cn } from "@/lib/utils";

interface CiclopesWordmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "aegean" | "white" | "current";
  className?: string;
}

/**
 * Ciclopes Wordmark — Helênico Contemporâneo Typography
 * Uses Cinzel serif display font with elegant wide letter-spacing.
 */
export function CiclopesWordmark({
  size = "md",
  variant = "aegean",
  className,
  ...props
}: CiclopesWordmarkProps) {
  const sizeClasses = {
    sm: "text-sm tracking-[0.22em]",
    md: "text-lg tracking-[0.25em]",
    lg: "text-2xl tracking-[0.28em]",
    xl: "text-4xl tracking-[0.30em]",
  };

  const colorClasses = {
    aegean: "text-[#1E3A5F] dark:text-[#F7F3EC]",
    white: "text-[#F7F3EC]",
    current: "text-current",
  };

  return (
    <div
      className={cn(
        "font-brand font-semibold select-none uppercase tracking-widest inline-flex items-center",
        sizeClasses[size],
        colorClasses[variant],
        className
      )}
      {...props}
    >
      CICLOPES
    </div>
  );
}
