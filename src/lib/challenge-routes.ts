/** The workspace URL for a challenge, from its catalog ID. */
export function challengePath(challengeId: string): string {
  return `/challenges/${encodeURIComponent(challengeId)}`;
}
