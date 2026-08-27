import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — Hostinger
// violet rounded square + white chat-square glyph — matching the
// sidebar logo in `src/components/layout/sidebar.tsx`. Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1E3A5F", // Aegean Blue
          borderRadius: 8,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 100 100"
          fill="none"
        >
          {/* Axis Line */}
          <line x1="50" y1="12" x2="50" y2="88" stroke="#F7F3EC" strokeWidth="4" strokeLinecap="round" />
          {/* Eye Almond Contour */}
          <path
            d="M 12 50 C 26 26, 74 26, 88 50 C 74 74, 26 74, 12 50 Z"
            stroke="#F7F3EC"
            strokeWidth="5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Focus Ring */}
          <circle cx="50" cy="50" r="17.5" stroke="#F7F3EC" strokeWidth="4" />
          {/* Pupil */}
          <circle cx="50" cy="50" r="7" fill="#F7F3EC" />
          {/* Terracotta Accent Dots */}
          <circle cx="50" cy="11" r="5" fill="#D16A3A" />
          <circle cx="50" cy="89" r="5" fill="#D16A3A" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
