/** The app's learner-facing routes. Every internal link goes through these or challengePath(). */
export const ROUTES = {
  home: "/",
  library: "/challenges",
  /** The workspace's own page: the welcome screen when no challenge is open. */
  workspace: "/workspace",
} as const;

/** The workspace URL for a challenge, from its catalog ID. */
export function challengePath(challengeId: string): string {
  return `/challenges/${encodeURIComponent(challengeId)}`;
}
