import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rootCauseOptions } from "@/data/challenge-001/diagnosis-options";
import { styles } from "@/components/landing/styles";
import * as landing from "@/data/landing";
import { heroLogLines, heroScene } from "@/data/landing-hero";
import { listChallengeSummaries } from "@/lib/challenge-catalog";

const APP_DIR = fileURLToPath(new URL("../../src/app/", import.meta.url));
const LANDING_DIR = fileURLToPath(new URL("../../src/components/landing/", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** "/" -> src/app/page.tsx, "/challenges" -> src/app/challenges/page.tsx, a challenge -> the dynamic route plus a published id. */
function pageExists(route: string) {
  const challenge = route.match(/^\/challenges\/([^/]+)$/);
  if (challenge) {
    return existsSync(join(APP_DIR, "challenges", "[challengeId]", "page.tsx")) && listChallengeSummaries().some(({ id }) => id === challenge[1]);
  }
  return existsSync(join(APP_DIR, route.replace(/^\//, ""), "page.tsx"));
}

const landingSources = [...walk(LANDING_DIR), join(APP_DIR, "page.tsx")]
  .filter((path) => /\.tsx?$/.test(path))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

// Every string a visitor can read: the landing data (including the replay
// script, sample logs, requests and notes) plus copy written in components.
const landingCopy = [
  JSON.stringify(landing),
  JSON.stringify(heroLogLines),
  JSON.stringify(heroScene),
  ...landingSources.map((source) => source.text),
].join("\n");

// The reduced-motion block (last in the file) only overrides rules defined
// above it, so it doesn't count as defining a class.
const stylesheet = readFileSync(join(LANDING_DIR, "landing.css"), "utf8").split(
  "@media (prefers-reduced-motion: reduce)",
)[0];

describe("landing page styles", () => {
  // next.config loads every *.css file as global CSS, so a class name used by
  // a component but missing from the stylesheet would fail silently.
  test("every class name the components use is defined in landing.css", () => {
    for (const className of Object.values(styles)) {
      assert.match(stylesheet, new RegExp(`\\.${className}(?![\\w-])`), `.${className} is not defined`);
    }
  });

  test("only the landing page at / loads the landing stylesheet", () => {
    const importers = walk(fileURLToPath(new URL("../../src/", import.meta.url))).filter(
      (path) => /\.tsx?$/.test(path) && readFileSync(path, "utf8").includes("landing/landing.css"),
    );
    assert.deepEqual(importers, [join(APP_DIR, "page.tsx")]);
  });
});

describe("landing page routes", () => {
  test("every route it links to is an existing page", () => {
    for (const route of Object.values(landing.ROUTES)) {
      assert.ok(pageExists(route), `no page for ${route}`);
    }
  });

  test("the main calls to action lead to the library; the case links open the challenge the page walks through", () => {
    assert.equal(landing.primaryCta.href, landing.ROUTES.library);
    assert.equal(landing.openWorkspaceCta.href, landing.ROUTES.library);
    for (const cta of [landing.caseCta, landing.replayCta]) assert.equal(cta.href, landing.ROUTES.featuredChallenge);
    assert.equal(landing.ROUTES.featuredChallenge, `/challenges/${landing.featuredChallenge.id}`);
  });

  test("components never hard-code a route", () => {
    for (const { path, text } of landingSources) {
      assert.doesNotMatch(text, /href=["'{`]+\//, `${path} hard-codes an href`);
    }
  });

  test("section links point at section ids", () => {
    const ids = new Set<string>(Object.values(landing.SECTION_IDS));
    for (const href of [...landing.navLinks.map((link) => link.href), landing.hero.secondaryCta.href]) {
      assert.ok(ids.has(href.slice(1)), `${href} has no section`);
    }
  });
});

describe("landing page messaging", () => {
  test("presents BugLab as a product, not a demo", () => {
    for (const word of [/\bdemo\b/i, /prototype/i, /coming soon/i, /\bsoon\b/i, /assessment/i, /preview/i]) {
      assert.doesNotMatch(landingCopy, word);
    }
    for (const { path, text } of landingSources) {
      assert.ok(!text.includes("@/config/app"), `${path} imports the app stage label`);
    }
  });

  test("does not advertise features that are not built yet", () => {
    for (const unbuilt of [/fix mode/i, /\bscor(e|es|ing)\b/i, /leaderboard/i, /progress/i, /sign (in|up)/i]) {
      assert.doesNotMatch(landingCopy, unbuilt);
    }
  });

  test("replay chapters run in the approved order", () => {
    assert.deepEqual(
      landing.replayChapters.map((chapter) => chapter.id),
      ["read", "search", "inspect", "collect", "diagnose"],
    );
  });
});

describe("landing page spoilers", () => {
  test("never hints at Challenge 001's root cause", () => {
    for (const hint of [/signed/i, /cookie/i, /middleware/i, /session[- ]?store/i, /\bsid\b/i]) {
      assert.doesNotMatch(landingCopy, hint);
    }
  });

  test("never names a diagnosis option", () => {
    for (const option of rootCauseOptions) {
      assert.ok(!landingCopy.includes(option.id), `mentions option ${option.id}`);
      assert.ok(!landingCopy.includes(option.label), `mentions option "${option.label}"`);
    }
  });

  test("sample requests carry only harmless headers", () => {
    const allowed = new Set(["Content-Type", "Cache-Control", "X-Powered-By", "Connection"]);
    for (const request of landing.sampleRequests) {
      for (const [name] of request.headers) assert.ok(allowed.has(name), `${request.id} shows ${name}`);
    }
  });
});
