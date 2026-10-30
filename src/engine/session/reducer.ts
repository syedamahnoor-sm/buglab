import type {
  ChallengePublic,
  RunReport,
  SessionEvent,
  SessionState,
} from "../types";

export function createSession(challenge: ChallengePublic): SessionState {
  return {
    version: 1,
    challengeId: challenge.id,
    files: Object.fromEntries(
      challenge.files
        .filter((file) => !file.readOnly)
        .map((file) => [file.path, file.contents]),
    ),
    hintLimit: challenge.scoring.hintCosts.length,
    hintsUsed: 0,
    wrongDiagnoses: 0,
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

    case "DIAGNOSIS_CHECKED":
      if (state.diagnosed) return state;
      return event.correct
        ? { ...state, diagnosed: true }
        : { ...state, wrongDiagnoses: state.wrongDiagnoses + 1 };

    case "REVEALED":
      return { ...state, status: "revealed" };
  }
}
