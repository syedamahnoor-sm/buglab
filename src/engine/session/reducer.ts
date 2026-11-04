import type {
  RunReport,
  SessionConfig,
  SessionEvent,
  SessionState,
} from "../types";

export function createSession(config: SessionConfig): SessionState {
  const fix = config.completion === "fix" ? config : null;
  return {
    version: 1,
    challengeId: config.challengeId,
    completion: config.completion,
    files: { ...fix?.editableFiles },
    hintLimit: fix?.hintLimit ?? 0,
    hintsUsed: 0,
    diagnosed: false,
    runs: 0,
    lastRun: null,
    editedSinceRun: false,
    passedVisible: false,
    passedAll: false,
    status: "in_progress",
  };
}

function visibleTestsPassed(report: RunReport): boolean {
  if (report.outcome === "timeout" || report.outcome === "crashed") return false;
  const visible = report.results.filter((r) => r.visibility === "visible");
  return visible.length > 0 && visible.every((r) => r.status === "pass");
}

// Once a session is solved or revealed it is frozen: every later event is ignored.
// passedVisible is sticky (it records that the visible tests passed at some point);
// lastRun and editedSinceRun describe the current code.
export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  if (state.status !== "in_progress") return state;

  if (event.type === "DIAGNOSIS_ACCEPTED") {
    if (state.diagnosed) return state;
    // Only a diagnosis-mode session is completed by the diagnosis alone. In
    // Fix Mode the diagnosis is one part of the work, so it never solves.
    return state.completion === "diagnosis"
      ? { ...state, diagnosed: true, status: "solved" }
      : { ...state, diagnosed: true };
  }

  // A diagnosis-mode session has nothing to edit, run, hint or reveal.
  if (state.completion === "diagnosis") return state;

  switch (event.type) {
    case "FILE_EDITED":
      if (
        !Object.hasOwn(state.files, event.path) ||
        state.files[event.path] === event.contents
      ) {
        return state;
      }
      return {
        ...state,
        files: { ...state.files, [event.path]: event.contents },
        editedSinceRun: true,
      };

    case "RUN_COMPLETED": {
      const passedAll =
        event.report.scope === "all" && event.report.outcome === "passed";
      return {
        ...state,
        runs: state.runs + 1,
        lastRun: event.report,
        editedSinceRun: false,
        passedVisible:
          state.passedVisible || passedAll || visibleTestsPassed(event.report),
        passedAll,
        status: passedAll ? "solved" : state.status,
      };
    }

    case "HINT_REVEALED":
      return state.hintsUsed >= state.hintLimit
        ? state
        : { ...state, hintsUsed: state.hintsUsed + 1 };

    case "REVEALED":
      return { ...state, status: "revealed" };
  }
}
