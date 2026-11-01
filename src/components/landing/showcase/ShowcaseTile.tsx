import type { ReactNode } from "react";
import type { ShowcaseTile as TileContent } from "@/data/landing";
import { FeatureIcon } from "../icons";
import { styles } from "../styles";

interface ShowcaseTileProps {
  content: TileContent;
  children?: ReactNode;
  className?: string;
  /** Instruments are the large, lifted panels; callouts the smaller notes beside them. */
  variant?: "instrument" | "callout";
}

const variants = {
  instrument: {
    frame: "rounded-xl border-border-strong bg-surface p-5 shadow-[0_30px_70px_-30px_rgb(0_0_0/0.9)] sm:p-6",
    icon: "size-8",
    title: "font-medium",
    description: "mt-3 text-sm",
    body: "mt-5",
  },
  callout: {
    frame: "rounded-lg border-border bg-surface/95 p-4 shadow-[0_20px_50px_-25px_rgb(0_0_0/0.8)] backdrop-blur",
    icon: "size-7",
    title: "text-sm font-medium",
    description: "mt-2 text-xs",
    body: "mt-4",
  },
};

// Shared frame for the workspace tiles; [data-spot] opts into the pointer glow.
export function ShowcaseTile({ content, children, className = "", variant = "instrument" }: ShowcaseTileProps) {
  const v = variants[variant];
  return (
    <article
      data-spot
      className={`${styles.spot} flex h-full flex-col overflow-hidden border ${v.frame} ${className}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex ${v.icon} shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent`}
        >
          <FeatureIcon name={content.icon} />
        </span>
        <h3 className={`${v.title} text-foreground`}>{content.title}</h3>
      </div>
      <p className={`${v.description} leading-relaxed text-muted`}>{content.description}</p>
      {children && <div className={`${v.body} flex min-h-0 flex-1 flex-col`}>{children}</div>}
    </article>
  );
}
