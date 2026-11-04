"use client";

import type { PointerEvent, ReactNode } from "react";

// Moves the glow of whichever [data-spot] tile is under the pointer by
// setting CSS variables; nothing re-renders.
function track(event: PointerEvent<HTMLDivElement>) {
  const tile = (event.target as Element).closest<HTMLElement>("[data-spot]");
  if (!tile) return;
  const rect = tile.getBoundingClientRect();
  tile.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  tile.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

// Back to centre, which is also where keyboard focus shows the glow.
function reset(event: PointerEvent<HTMLDivElement>) {
  for (const tile of event.currentTarget.querySelectorAll<HTMLElement>("[data-spot]")) {
    tile.style.removeProperty("--mx");
    tile.style.removeProperty("--my");
  }
}

export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} onPointerMove={track} onPointerLeave={reset}>
      {children}
    </div>
  );
}
