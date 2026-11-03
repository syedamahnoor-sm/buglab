/*
 * ChallengeWorkspacePage renders with React's server renderer, so these tests
 * cover the initial render only (see challenge-session-provider.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { ChallengeWorkspacePage } from "@/components/challenge/ChallengeWorkspacePage";
import { challenge001 } from "@/data/challenge-001";
import type { WorkspaceScenario } from "@/types/workspace";

const render = (scenario: WorkspaceScenario) =>
  renderToStaticMarkup(createElement(ChallengeWorkspacePage, { scenario }));

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

// A test-only public scenario: Challenge 001's shape with different content, so
// the page can only show it by reading the scenario it is given.
const otherScenario: WorkspaceScenario = {
  ...challenge001,
  challenge: {
    ...challenge001.challenge,
    id: "fixture-python",
    number: "999",
    title: "Fixture Title For Tests",
    incident: "Fixture incident text.",
    tags: ["FixtureTag"],
  },
  files: [{ path: "app/fixture_main.py", content: "print('fixture')\n" }],
  entryFilePath: "app/fixture_main.py",
};

describe("ChallengeWorkspacePage", () => {
  test("the / route renders exactly the shared page for Challenge 001", () => {
    assert.equal(renderToStaticMarkup(createElement(Home)), render(challenge001));
  });

  test("renders the header, skip links and main landmark around the workspace", () => {
    const markup = render(challenge001);
    assert.match(markup, /<header/);
    assert.match(markup, /<nav aria-label="Primary"/);
    assert.match(markup, /<main class="mx-auto flex w-full max-w-\[1600px\]/);
    assert.match(markup, /href="#/); // skip links
  });

  test("shows Challenge 001's overview with the engine session's status", () => {
    const markup = render(challenge001);
    assert.ok(markup.includes(challenge001.challenge.title));
    assert.ok(markup.includes(challenge001.challenge.incident));
    assert.ok(markup.includes("Investigating"), "investigationStarted keeps the in-progress status");
  });

  test("renders whatever public scenario it is given, and nothing from another", () => {
    const markup = render(otherScenario);
    assert.ok(markup.includes("Fixture Title For Tests"));
    assert.ok(markup.includes("Fixture incident text."));
    assert.ok(markup.includes("FixtureTag"));
    assert.ok(markup.includes("fixture_main.py"));
    assert.ok(!markup.includes(challenge001.challenge.title));
    assert.ok(!markup.includes("INCIDENT.md"));
  });

  test("the page takes its data only from the scenario prop", () => {
    const page = source("components/challenge/ChallengeWorkspacePage.tsx");
    assert.doesNotMatch(page, /@\/data\//, "imports no challenge data");
    assert.doesNotMatch(page, /@\/server\/|answer-key/, "imports no server code or answer keys");
    assert.doesNotMatch(page, /challenge-?001/i, "names no specific challenge");
  });

  test("the / route only picks Challenge 001 and delegates to the shared page", () => {
    const home = source("app/page.tsx");
    const imports = [...home.matchAll(/from "([^"]+)"/g)].map(([, from]) => from);
    assert.deepEqual(imports, ["@/components/challenge/ChallengeWorkspacePage", "@/data/challenge-001"]);
    assert.match(home, /<ChallengeWorkspacePage scenario=\{challenge001\} \/>/);
  });
});
