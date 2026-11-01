import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createReplayReducer,
  initialReplayState,
  stageMode,
  type ReplayAction,
  type ReplayState,
} from "@/components/landing/replay/replay-reducer";
import { nextActiveChapter } from "@/components/landing/replay/useActiveChapter";

const reduce = createReplayReducer(5);

function run(...actions: ReplayAction[]): ReplayState {
  return actions.reduce(reduce, initialReplayState);
}

const advance: ReplayAction = { type: "ADVANCE" };

describe("incident replay", () => {
  test("starts idle on chapter 1, shown as a still frame", () => {
    assert.equal(initialReplayState.chapter, 0);
    assert.equal(stageMode(initialReplayState), "static");
  });

  test("autoplays once, then walks the chapters in order and stops", () => {
    let state = run({ type: "AUTOPLAY" });
    assert.equal(stageMode(state), "running");
    for (let chapter = 1; chapter < 5; chapter++) {
      state = reduce(state, advance);
      assert.equal(state.chapter, chapter);
    }
    state = reduce(state, advance);
    assert.equal(state.status, "done");
    assert.equal(state.chapter, 4, "never moves past the diagnosis chapter");
    assert.equal(reduce(state, advance), state, "never loops on its own");
    assert.equal(reduce(state, { type: "AUTOPLAY" }), state, "autoplay happens only once");
  });

  test("a chapter chosen by the visitor uses up autoplay", () => {
    const state = run({ type: "SELECT", chapter: 2 }, { type: "AUTOPLAY" });
    assert.equal(state.status, "paused");
    assert.equal(state.chapter, 2);
    assert.equal(stageMode(state), "static", "a chosen chapter shows its finished frame");
  });

  test("pausing freezes the frame and resuming continues it", () => {
    const paused = run({ type: "AUTOPLAY" }, advance, { type: "TOGGLE" });
    assert.equal(stageMode(paused), "frozen");
    const resumed = reduce(paused, { type: "TOGGLE" });
    assert.equal(stageMode(resumed), "running");
    assert.equal(resumed.chapter, 1);
    assert.equal(resumed.run, paused.run, "continues instead of restarting the chapter");
  });

  test("playing a chosen chapter restarts its animation", () => {
    const chosen = run({ type: "SELECT", chapter: 3 });
    const playing = reduce(chosen, { type: "TOGGLE" });
    assert.equal(playing.chapter, 3);
    assert.notEqual(playing.run, chosen.run);
  });

  test("replay starts again from chapter 1", () => {
    const done = run({ type: "AUTOPLAY" }, advance, advance, advance, advance, advance);
    const again = reduce(done, { type: "TOGGLE" });
    assert.equal(again.status, "playing");
    assert.equal(again.chapter, 0);
  });

  test("off screen or in a hidden tab, it holds without counting as a pause", () => {
    const suspended = run({ type: "AUTOPLAY" }, { type: "SUSPEND" });
    assert.equal(stageMode(suspended), "frozen");
    assert.equal(reduce(suspended, advance).chapter, 0, "the timer is not running");
    const back = reduce(suspended, { type: "RESUME" });
    assert.equal(stageMode(back), "running");
  });

  test("ignores chapters out of range", () => {
    assert.equal(run({ type: "SELECT", chapter: 9 }).chapter, 4);
    assert.equal(run({ type: "SELECT", chapter: -1 }).chapter, 0);
  });
});

describe("pinned replay chapter choice", () => {
  test("a chapter entering the middle of the screen becomes active", () => {
    assert.equal(nextActiveChapter(0, new Set([0, 1]), [1]), 1);
  });

  test("scrolling back up hands over to the chapter still in the middle", () => {
    // Chapter 2 leaves the band while 1 is already there.
    assert.equal(nextActiveChapter(2, new Set([1]), []), 1);
  });

  test("above or below the chapters, the last one shown stays", () => {
    assert.equal(nextActiveChapter(4, new Set(), []), 4);
    assert.equal(nextActiveChapter(0, new Set(), []), 0);
  });

  test("an index jump lands on the chosen chapter", () => {
    assert.equal(nextActiveChapter(0, new Set([3]), [3]), 3);
  });
});
