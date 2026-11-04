/*
 * State machine for the Incident Replay. Pure, so it can be unit-tested.
 *
 * - "idle": not started; the first chapter is shown in its final frame.
 * - "playing": chapters advance on a timer. `suspended` holds the timer while
 *   the replay is off screen or the tab is hidden, without the learner
 *   having paused it.
 * - "paused": stopped by the learner. `midChapter` says whether it stopped
 *   part-way through a chapter (frozen frame) or on a chosen chapter (final
 *   frame).
 * - "done": the last chapter finished. It never loops on its own.
 *
 * `run` changes whenever a chapter (re)starts, so the stage can restart its
 * animations by keying on it.
 */
export type ReplayStatus = "idle" | "playing" | "paused" | "done";

export interface ReplayState {
  chapter: number;
  status: ReplayStatus;
  suspended: boolean;
  midChapter: boolean;
  /** Autoplay happens once; any choice by the learner also uses it up. */
  autoplayed: boolean;
  run: number;
}

export type ReplayAction =
  | { type: "AUTOPLAY" }
  | { type: "ADVANCE" }
  | { type: "SELECT"; chapter: number }
  | { type: "TOGGLE" }
  | { type: "SUSPEND" }
  | { type: "RESUME" };

export type StageMode = "static" | "running" | "frozen";

export const initialReplayState: ReplayState = {
  chapter: 0,
  status: "idle",
  suspended: false,
  midChapter: false,
  autoplayed: false,
  run: 0,
};

export function createReplayReducer(chapterCount: number) {
  const last = chapterCount - 1;

  return function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
    switch (action.type) {
      case "AUTOPLAY":
        if (state.autoplayed || state.status !== "idle") return state;
        return { ...state, status: "playing", chapter: 0, autoplayed: true, run: state.run + 1 };

      case "ADVANCE":
        if (state.status !== "playing" || state.suspended) return state;
        if (state.chapter >= last) return { ...state, status: "done" };
        return { ...state, chapter: state.chapter + 1, run: state.run + 1 };

      case "SELECT": {
        const chapter = Math.min(Math.max(action.chapter, 0), last);
        return {
          ...state,
          chapter,
          status: state.status === "playing" ? "playing" : "paused",
          midChapter: false,
          autoplayed: true,
          run: state.run + 1,
        };
      }

      case "TOGGLE":
        if (state.status === "playing") return { ...state, status: "paused", midChapter: true };
        if (state.status === "done") {
          return { ...state, status: "playing", chapter: 0, autoplayed: true, run: state.run + 1 };
        }
        // Resuming a frozen frame continues it; otherwise the chapter replays.
        return {
          ...state,
          status: "playing",
          autoplayed: true,
          midChapter: false,
          run: state.midChapter ? state.run : state.run + 1,
        };

      case "SUSPEND":
        return state.suspended ? state : { ...state, suspended: true };

      case "RESUME":
        return state.suspended ? { ...state, suspended: false } : state;
    }
  };
}

export function stageMode(state: ReplayState): StageMode {
  if (state.status === "playing") return state.suspended ? "frozen" : "running";
  if (state.status === "paused" && state.midChapter) return "frozen";
  return "static";
}
