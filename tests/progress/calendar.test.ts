/*
 * The learning calendar: meaningful activity per local day, streaks, the
 * calendar grid, and the heatmap that renders it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityHeatmap, describeDay } from "@/components/progress/ActivityHeatmap";
import { sinceLabel, streakNote } from "@/components/progress/OverviewSection";
import { EMPTY_RECORD, type LearningRecord, type LocalDay } from "@/lib/learning/model";
import { recordPracticeOpened } from "@/lib/learning/practice";
import { recordRecall, saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { activityByDay, calendarRange, intensity, streaks, weekday, type DayActivity } from "@/lib/progress/calendar";
import { browserProgress } from "@/lib/progress/source";

/** A local date-time (the learner's time zone, whatever the test machine's is). */
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min);
const days = (record: LearningRecord, today: LocalDay) => activityByDay(browserProgress(record), today);
/** A calendar with one activity on each given day. */
const activeOn = (...list: LocalDay[]) => new Map<LocalDay, DayActivity>(list.map((day) => [day, { day, solves: 1, reflections: 0, reviews: 0, total: 1 }]));

describe("meaningful activity per day", () => {
  test("an empty record has no active days and no streaks", () => {
    const map = days(EMPTY_RECORD, "2026-11-06");
    assert.equal(map.size, 0);
    assert.deepEqual(streaks(map, "2026-11-06"), { current: 0, openToday: false, longest: 0, activeDays: 0, firstActive: null });
  });

  test("first solves, reflections and recall reviews count; repeat solves, edits and opening practice do not", () => {
    let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(2026, 11, 2, 9));
    record = recordObservedSolve(record, "challenge-001", at(2026, 11, 4, 9)); // repeat solve: not a new event
    record = saveReflection(record, "challenge-001", { takeaway: "Read the cookie the middleware reads." }, at(2026, 11, 2, 9, 30));
    record = saveReflection(record, "challenge-001", { takeaway: "Edited later." }, at(2026, 11, 4, 10)); // edit: not counted
    record = recordPracticeOpened(record, "challenge-001", "challenge-002", at(2026, 11, 4, 11)); // opening: not counted
    record = recordRecall(record, "challenge-001", "need-practice", at(2026, 11, 3, 8));
    record = recordRecall(record, "challenge-001", "got-it", at(2026, 11, 3, 8, 5)); // same day: one review

    const map = days(record, "2026-11-06");
    assert.deepEqual([...map.keys()].sort(), ["2026-11-02", "2026-11-03"]);
    assert.deepEqual(map.get("2026-11-02"), { day: "2026-11-02", solves: 1, reflections: 1, reviews: 0, total: 2 });
    assert.deepEqual(map.get("2026-11-03"), { day: "2026-11-03", solves: 0, reflections: 0, reviews: 1, total: 1 });
  });

  test("days are local calendar days: 23:59 and 00:01 are different days", () => {
    let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(2026, 11, 3, 23, 59));
    record = recordObservedSolve(record, "challenge-002", at(2026, 11, 4, 0, 1));
    assert.deepEqual([...days(record, "2026-11-06").keys()].sort(), ["2026-11-03", "2026-11-04"]);
  });

  test("recall reviews are dated by the day the Journal recorded, as scheduling does", () => {
    let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(2026, 11, 1));
    record = saveReflection(record, "challenge-001", { takeaway: "t" }, at(2026, 11, 1));
    record = recordRecall(record, "challenge-001", "got-it", at(2026, 11, 2, 23, 50));
    assert.equal(days(record, "2026-11-06").get("2026-11-02")?.reviews, 1);
  });

  test("days after today (a clock that was ahead) are left out", () => {
    const record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(2026, 11, 9));
    assert.equal(days(record, "2026-11-06").size, 0);
  });

  test("intensity levels", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(intensity), [0, 1, 2, 3, 3, 4, 4]);
  });
});

describe("streaks", () => {
  test("active today: the run ending today", () => {
    assert.deepEqual(streaks(activeOn("2026-11-04", "2026-11-05", "2026-11-06"), "2026-11-06"), {
      current: 3,
      openToday: false,
      longest: 3,
      activeDays: 3,
      firstActive: "2026-11-04",
    });
  });

  test("active yesterday but not yet today: the streak still counts, open until today ends", () => {
    const result = streaks(activeOn("2026-11-04", "2026-11-05"), "2026-11-06");
    assert.equal(result.current, 2);
    assert.equal(result.openToday, true);
    assert.match(streakNote(result), /Active yesterday/);
  });

  test("a missed day ends it: last active two days ago means no current streak", () => {
    const result = streaks(activeOn("2026-11-03", "2026-11-04"), "2026-11-06");
    assert.deepEqual([result.current, result.openToday, result.longest], [0, false, 2]);
    assert.match(streakNote(result), /starts a new one/);
  });

  test("the longest streak is the longest run anywhere, not the current one", () => {
    const result = streaks(activeOn("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-05", "2026-11-06"), "2026-11-06");
    assert.deepEqual([result.current, result.longest, result.activeDays], [2, 4, 6]);
  });

  test("across a leap day: 28 Feb, 29 Feb and 1 Mar 2028 are three consecutive days", () => {
    const result = streaks(activeOn("2028-02-28", "2028-02-29", "2028-03-01"), "2028-03-01");
    assert.deepEqual([result.current, result.longest], [3, 3]);
  });

  test("in a common year, 28 Feb and 1 Mar are consecutive", () => {
    assert.equal(streaks(activeOn("2027-02-28", "2027-03-01"), "2027-03-01").current, 2);
    assert.equal(streaks(activeOn("2028-02-28", "2028-03-01"), "2028-03-01").current, 1, "2028 has a 29 Feb in between");
  });

  test("across the new year", () => {
    assert.equal(streaks(activeOn("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-02").current, 3);
  });

  test("the first active day names its year when it was in an earlier year", () => {
    assert.equal(sinceLabel("2025-09-12", "2026-11-06"), "12 Sept 2025");
    assert.match(sinceLabel("2026-03-02", "2026-11-06"), /^Mon,? 2 Mar$/);
  });

  test("a single active day today", () => {
    const result = streaks(activeOn("2026-11-06"), "2026-11-06");
    assert.deepEqual([result.current, result.longest, result.openToday], [1, 1, false]);
    assert.equal(streakNote(result), "Including today.");
  });
});

describe("calendar grid", () => {
  test("weekdays from the calendar date alone, Monday first", () => {
    assert.equal(weekday("2026-11-02"), 0, "Monday");
    assert.equal(weekday("2026-11-08"), 6, "Sunday");
    assert.equal(weekday("2028-02-29"), 1, "Tuesday");
    assert.equal(weekday("2024-12-31"), 1, "Tuesday");
  });

  test("whole weeks ending with the week of the end day; later days are future slots", () => {
    const range = calendarRange(activeOn("2026-11-05"), "2026-11-06", 53, "2026-11-06");
    assert.equal(range.weeks.length, 53);
    assert.ok(range.weeks.every((week) => week.length === 7 && weekday(week[0].day) === 0));
    assert.equal(range.start, "2025-11-03");
    assert.equal(range.end, "2026-11-06");
    const last = range.weeks.at(-1)!;
    assert.deepEqual(last.map((cell) => cell.future), [false, false, false, false, false, true, true]);
    assert.equal(last.find((cell) => cell.day === "2026-11-05")!.level, 1);
  });

  test("every day appears once, in order, including 29 Feb in a leap year", () => {
    const range = calendarRange(new Map(), "2028-03-05", 10, "2028-03-05");
    const all = range.weeks.flat().map((cell) => cell.day);
    assert.equal(new Set(all).size, 70);
    assert.deepEqual([...all].sort(), all);
    assert.ok(all.includes("2028-02-29"));
  });

  test("month labels sit on the week where a month starts, never crowded together", () => {
    const range = calendarRange(new Map(), "2026-11-06", 53, "2026-11-06");
    for (const month of range.months) {
      const week = range.weeks[month.column];
      assert.ok(month.column === 0 || week.some((cell) => cell.day === month.month), month.month);
    }
    for (let i = 1; i < range.months.length; i++) assert.ok(range.months[i].column - range.months[i - 1].column >= 2);
    assert.ok(range.months.some((m) => m.month === "2026-01-01"));
  });
});

describe("heatmap rendering", () => {
  const render = (map: Map<LocalDay, DayActivity>, weeks: number, today = "2026-11-06", firstActive: LocalDay | null = null) =>
    renderToStaticMarkup(createElement(ActivityHeatmap, { days: map, today, firstActive, weeks }));

  test("a grid of seven weekday rows with one labelled, focusable cell per past day", () => {
    const markup = render(activeOn("2026-11-05"), 14);
    assert.match(markup, /role="grid"/);
    assert.equal(markup.match(/role="row"/g)?.length, 7);
    assert.equal(markup.match(/role="rowheader"/g)?.length, 7);
    const cells = markup.match(/data-day="[^"]+"/g) ?? [];
    assert.equal(cells.length, 14 * 7 - 2, "the two future days of this week are empty slots");
    assert.equal(markup.match(/tabindex="0"/g)?.length, 1, "one tab stop: roving focus");
    assert.match(markup, /data-day="2026-11-06"[^>]*tabindex="0"/);
    assert.match(markup, /aria-label="Thu,? 5 Nov 2026: 1 activity: 1 first solve"/);
    assert.match(markup, /aria-label="Fri,? 6 Nov 2026: No learning activity \(today\)"/);
  });

  test("intensity shows on each day, with a legend for every level", () => {
    const map = new Map<LocalDay, DayActivity>([
      ["2026-11-02", { day: "2026-11-02", solves: 1, reflections: 1, reviews: 0, total: 2 }],
      ["2026-11-03", { day: "2026-11-03", solves: 2, reflections: 2, reviews: 2, total: 6 }],
    ]);
    const markup = render(map, 14);
    assert.match(markup, /data-day="2026-11-02" data-level="2"/);
    assert.match(markup, /data-day="2026-11-03" data-level="4"/);
    for (const label of ["No activity", "1 activity", "2 activities", "3 to 4 activities", "5 or more activities"]) assert.ok(markup.includes(label), label);
  });

  test("earlier periods: Earlier is offered only when there is older activity; Later is off on the current range", () => {
    const none = render(new Map(), 14);
    assert.match(none, /<button[^>]*disabled=""[^>]*>.*?Earlier/);
    assert.match(none, /<button[^>]*disabled=""[^>]*>Later/);
    const older = render(activeOn("2026-01-10"), 14, "2026-11-06", "2026-01-10");
    assert.doesNotMatch(older, /<button[^>]*disabled=""[^>]*>.*?Earlier/);
  });

  test("a year range on wide screens, with the date range named", () => {
    const markup = render(new Map(), 53);
    assert.equal((markup.match(/data-day="/g) ?? []).length, 53 * 7 - 2);
    assert.ok(markup.includes("Nov 2025 to Nov 2026"));
  });

  test("day details in words", () => {
    assert.equal(describeDay(null), "No learning activity");
    assert.equal(describeDay({ day: "2026-11-06", solves: 1, reflections: 2, reviews: 0, total: 3 }), "3 activities: 1 first solve, 2 reflections");
  });
});

/* ---- colour: the heat levels in both themes ---- */
const css = readFileSync(fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)), "utf8");
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return body.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))![1].trim();
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function toOklab([r, g, b]: number[]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]: number[]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((c) => Math.min(1, Math.max(0, fromLinear(c))));
}
const mix = (a: string, b: string, weight: number) => {
  const [x, y] = [toOklab(rgb(a)), toOklab(rgb(b))];
  return fromOklab(x.map((v, i) => v * weight + y[i] * (1 - weight)));
};
const luminance = (c: number[]) => 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("heat colours", () => {
  const weights = [...css.matchAll(/--color-heat-\d: color-mix\(in oklab, var\(--accent\) (\d+)%, var\(--card\)\);/g)].map((m) => Number(m[1]) / 100);
  test("levels 1 to 3 mix the accent into the card surface; level 4 is the accent", () => {
    assert.deepEqual(weights.length, 3);
    assert.ok(css.includes("--color-heat-4: var(--accent);"));
  });

  for (const [theme, selector] of [["dark", ":root"], ["light", ':root[data-theme="light"]']] as const) {
    test(`${theme}: each level is a clearer step from the card, and the top level stands out (3:1)`, () => {
      const card = rgb(token(selector, "--card"));
      const accent = token(selector, "--accent");
      const levels = [...weights.map((w) => mix(accent, token(selector, "--card"), w)), rgb(accent)];
      const steps = levels.map((level) => contrast(level, card));
      for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], `${theme} level ${i + 1}: ${steps.map((s) => s.toFixed(2))}`);
      assert.ok(steps[0] >= 1.3, `${theme} level 1 is distinguishable: ${steps[0].toFixed(2)}`);
      assert.ok(steps.at(-1)! >= 3, `${theme} top level: ${steps.at(-1)!.toFixed(2)}`);
    });
  }
});
