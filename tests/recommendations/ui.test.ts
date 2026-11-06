import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LearningPathView } from "@/components/recommendations/LearningPathView";
import { recommend } from "@/lib/recommendations/engine";
import { candidate,input } from "./fixtures";

const render = (state: Parameters<typeof LearningPathView>[0]["state"]) => renderToStaticMarkup(createElement(LearningPathView,{ state,preferences: input().preferences,onPreferences: () => {},onRetry: () => {},catalogCount: 30 }));
describe("Learning Path presentation and source boundaries", () => {
  test("controls, headings, details and internal links have native accessible semantics", () => {
    const markup = render({ status: "ready",plan: recommend(input()) });
    assert.equal((markup.match(/<h1\b/g) ?? []).length,1);
    assert.ok(markup.includes("<form")); assert.ok(markup.includes("<summary"));
    assert.equal((markup.match(/<select\b/g) ?? []).length,3);
    assert.equal((markup.match(/type="checkbox"/g) ?? []).length,2);
    assert.ok(markup.includes("Use activity from this browser")); assert.ok(markup.includes("/challenges/challenge-a"));
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size,ids.length,"Next card and path must not duplicate IDs");
    for (const match of markup.matchAll(/aria-labelledby="([^"]+)"/g)) for (const id of match[1].split(" ")) assert.ok(ids.includes(id),id);
    for (const match of markup.matchAll(/for="([^"]+)"/g)) assert.ok(ids.includes(match[1]),match[1]);
  });
  test("loading, error, empty, recall and unavailable states are truthful", () => {
    assert.ok(render({ status: "loading" }).includes('aria-busy="true"'));
    assert.ok(render({ status: "loading" }).includes("motion-reduce:animate-none"));
    assert.ok(render({ status: "error" }).includes('role="alert"'));
    assert.ok(render({ status: "error" }).includes("Try again"));
    const i = input({ catalog: [] });
    assert.ok(render({ status: "ready",plan: recommend(i) }).includes("No new investigations fit this range"));
    i.catalog = [candidate()]; i.local.recalls = [{ challengeId: "challenge-a",dueOn: "2026-11-05" }];
    const markup = render({ status: "ready",plan: recommend(i) });
    assert.ok(markup.includes("1 day overdue")); assert.ok(markup.includes("/journal#recall"));
    assert.ok(markup.includes("Verified completion history is not available"));
    assert.equal(markup.includes("PRIVATE_TAKEAWAY"),false);
  });
  test("pure engine/client modules do not import private grading or server registries", () => {
    for (const path of ["engine.ts","types.ts","reasons.ts","validation.ts","client.ts","adapters/browser.ts"]) {
      const text = readFileSync(new URL(`../../src/lib/recommendations/${path}`,import.meta.url),"utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      assert.ok(imports.every((p) => !p.includes("/server") && !p.includes("answer-key") && !p.includes("/data/challenge-")),path);
    }
    const server = new URL("../../src/lib/recommendations/server/",import.meta.url);
    for (const file of readdirSync(server)) assert.ok(readFileSync(new URL(file,server),"utf8").startsWith('import "server-only";'));
    const screen = readFileSync(new URL("../../src/components/recommendations/LearningPathScreen.tsx",import.meta.url),"utf8");
    assert.equal(/learningActions|recordSolve\(|recordRecall\(|localStorage\.setItem|\/server\/auth|\/lib\/progress\//.test(screen),false);
  });
});