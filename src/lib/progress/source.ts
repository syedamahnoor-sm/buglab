/*
 * Where Learning Progress gets its facts: the boundary between the dashboard
 * and the data behind it.
 *
 * Today there is one source, the version 2 learning record kept in this
 * browser (lib/learning). Every progress selector reads a ProgressSource and
 * nothing else, so the dashboard never keeps a copy of its own and cannot
 * drift from the Journal.
 *
 * Browser facts are observations: a solve here means the diagnosis server
 * confirmed a correct diagnosis while BugLab was used in this browser. They
 * can be cleared or edited by the learner, so the dashboard words them as
 * "completed in this browser", never as verified, mastered or synced.
 *
 * A later source backed by Habin's learner backend would add a second origin
 * (for example "server") and supply server-recorded completions through this
 * same shape. That needs a backend endpoint that lists a learner's completed
 * challenges, which does not exist yet; none is assumed or called here.
 */
import type { LearningRecord } from "@/lib/learning/model";

export type ProgressOrigin = "browser";

export interface ProgressSource {
  /** Where the facts come from. Only "browser" exists today. */
  readonly origin: ProgressOrigin;
  /** The learning record the facts are read from. */
  readonly record: LearningRecord;
}

/** The progress source for this browser's learning record. */
export function browserProgress(record: LearningRecord): ProgressSource {
  return { origin: "browser", record };
}
