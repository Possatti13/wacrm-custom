import React from "react";
import { cn } from "@/lib/utils";

interface CiclopesSymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  variant?: "aegean" | "white" | "terracotta" | "current";
  className?: string;
  showAccentDots?: boolean;
}

/**
 * Ciclopes Symbol — Geometric Eye of Clarity (Helênico Contemporâneo)
 * Vector recreation based on canonical brand identity.
 */
export function CiclopesSymbol({
  size = 32,
  variant = "aegean",
  className,
  showAccentDots = true,
  ...props
}: CiclopesSymbolProps) {
  const strokeColor =
    variant === "aegean"
      ? "#1E3A5F"
      : variant === "white"
      ? "#F7F3EC"
      : variant === "terracotta"
      ? "#D16A3A"
      : "currentColor";

  const dotColor = variant === "white" ? "#D16A3A" : "#D16A3A";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-300", className)}
      aria-label="Ciclopes Symbol"
      {...props}
    >
      {/* Vertical Axis Line */}
      <line
        x1="50"
        y1="12"
        x2="50"
        y2="88"
        stroke={strokeColor}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Outer Eye Almond Contour */}
      <path
        d="M 12 50 C 26 26, 74 26, 88 50 C 74 74, 26 74, 12 50 Z"
        stroke={strokeColor}
        strokeWidth="3.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Focus Ring (Iris Perimeter) */}
      <circle
        cx="50"
        cy="50"
        r="17.5"
        stroke={strokeColor}
        strokeWidth="2.4"
      />

      {/* Central Solid Pupil */}
      <circle
        cx="50"
        cy="50"
        r="7"
        fill={strokeColor}
      />

      {/* Accent Axis Dots (Terracotta) */}
      {showAccentDots && (
        <>
          <circle cx="50" cy="11" r="3.2" fill={dotColor} />
          <circle cx="50" cy="89" r="3.2" fill={dotColor} />
        </>
      )}
    </svg>
  );
}
