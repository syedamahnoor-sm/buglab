export const SKIP_TARGETS = {
  workspace: "workspace",
  diagnosis: "diagnosis",
} as const;

export interface SkipLink {
  target: string;
  label: string;
}

const workspaceLinks: SkipLink[] = [
  { target: SKIP_TARGETS.workspace, label: "Skip to workspace" },
  { target: SKIP_TARGETS.diagnosis, label: "Skip to diagnosis" },
];

// Visually hidden until focused; the first Tab stops on the page. Defaults to
// the workspace page's links.
export function SkipLinks({ links = workspaceLinks }: { links?: readonly SkipLink[] }) {
  return (
    <>
      {links.map((link) => (
        <a
          key={link.target}
          href={`#${link.target}`}
          className="sr-only rounded-md bg-accent px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-foreground"
        >
          {link.label}
        </a>
      ))}
    </>
  );
}

/** Focusable, visually hidden landing point for a skip link. */
export function SkipTarget({ id, label }: { id: string; label: string }) {
  return (
    <span id={id} tabIndex={-1} className="sr-only scroll-mt-20">
      {label}
    </span>
  );
}
