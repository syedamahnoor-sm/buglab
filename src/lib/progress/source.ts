/*
 * Where Learning Progress gets its facts: the boundary between the dashboard
 * and the data behind it.
 *
 * Two origins, never mixed:
 *   record    this browser's version 2 learning record (lib/learning): observed
 *             solves, reflections, recall and practice. Browser facts are
 *             observations; they can be cleared or edited by the learner.
 *   verified  completions BugLab's server recorded (lib/verified), when a
 *             server source is connected. Today none is: production passes
 *             "not-connected", and no endpoint is called.
 *
 * Progress selectors read a ProgressSource and nothing else, so the dashboard
 * keeps no copy of its own. Reflections, recall, practice and the activity
 * calendar stay browser-only; verified completions only change what counts
 * as completed and whether it is verified (see completions.ts).
 */
import type { LearningRecord } from "@/lib/learning/model";
import { NOT_CONNECTED, type VerifiedState } from "@/lib/verified/model";

export interface ProgressSource {
  /** The browser's learning record. */
  readonly record: LearningRecord;
  /** Verified completions, or why there are none. */
  readonly verified: VerifiedState;
}

/** Progress from this browser's learning record, with verified completions when a server source supplied them. */
export function browserProgress(record: LearningRecord, verified: VerifiedState = NOT_CONNECTED): ProgressSource {
  return { record, verified };
}
