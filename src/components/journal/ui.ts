/*
 * Shared class names for the Learning Loop, built only from BugLab's theme
 * tokens so both themes and the approved hover states apply everywhere.
 */
export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const button = `inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-[background-color,border-color,box-shadow,color,scale] duration-200 ease-out active:scale-[0.98] motion-reduce:transition-colors motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export const buttonPrimary = `${button} h-10 bg-accent cta-gradient px-4 font-semibold text-background shadow-[0_8px_24px_-12px_var(--accent)] hover:bg-accent/90 hover:shadow-[0_10px_28px_-10px_var(--accent)]`;
export const buttonSecondary = `${button} h-10 border border-card-border-hover bg-card px-4 text-foreground hover:border-accent/50 hover:bg-hover-fill-raised`;
export const buttonQuiet = `${button} h-9 px-3 text-muted hover:bg-hover-fill hover:text-foreground`;
export const buttonDanger = `${button} h-9 border border-danger/40 bg-danger/10 px-3 text-danger hover:border-danger/70 hover:bg-danger/15`;
export const buttonSmall = `${button} h-9 border border-card-border bg-field px-3 text-foreground hover:border-card-border-hover hover:bg-hover-fill`;

export const field =
  "w-full rounded-xl border border-card-border bg-field px-3.5 py-2.5 text-sm leading-relaxed text-foreground transition-[border-color,box-shadow] duration-150 placeholder:text-subtle hover:border-card-border-hover focus:border-accent/60 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_14%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent motion-reduce:transition-none";

export const card = "rounded-2xl border border-card-border bg-card shadow-card";
export const eyebrow = "font-mono text-xs uppercase tracking-[0.16em] text-accent";
export const sectionTitle = "text-lg font-semibold tracking-tight text-foreground";
