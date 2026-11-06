/** The app's learner-facing routes. Every internal link goes through these or challengePath(). */
export const ROUTES = {
  home: "/",
  library: "/challenges",
  /** The workspace's own page: the welcome screen when no challenge is open. */
  workspace: "/workspace",
  /** The Learning Journal: reflections, recall and related practice. */
  journal: "/journal",
  /** Learning Progress: what has been solved, reflected on and recalled in this browser. */
  progress: "/progress",
  /** Read-only suggestions and existing due recalls. */
  learningPath: "/learning-path",
} as const;

/** Fixed anchors on the Journal page, so other pages can link straight to a section. */
export const JOURNAL_SECTIONS = {
  recall: "recall",
  awaiting: "to-reflect",
  practice: "practise-next",
} as const;

/** A link to one section of the Journal. */
export const journalSection = (section: keyof typeof JOURNAL_SECTIONS) => `${ROUTES.journal}#${JOURNAL_SECTIONS[section]}`;

/** The workspace URL for a challenge, from its catalog ID. */
export function challengePath(challengeId: string): string {
  return `/challenges/${encodeURIComponent(challengeId)}`;
}
