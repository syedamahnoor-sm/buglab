import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import ChallengePage, { ensureStatic, generateMetadata, generateStaticParams } from "@/app/challenges/[challengeId]/page";
import { ChallengeWorkspacePage } from "@/components/challenge/ChallengeWorkspacePage";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { listChallengeSummaries } from "@/lib/challenge-catalog";
import { challengePath } from "@/lib/challenge-routes";
import type { WorkspaceScenario } from "@/types/workspace";

const props = (challengeId: string) => ({ params: Promise.resolve({ challengeId }) }) as never;
const page = (challengeId: string) => ChallengePage(props(challengeId));

/** True for the error notFound() throws to render the 404 page. */
const isNotFound = (error: unknown) =>
  (error as { digest?: string } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

const source = readFileSync(new URL("../../src/app/challenges/[challengeId]/page.tsx", import.meta.url), "utf8");

describe("/challenges/[challengeId]: known challenges", () => {
  test("renders the shared workspace page with the catalog's public scenario", async () => {
    const element = (await page("challenge-001")) as ReactElement<{ scenario: WorkspaceScenario }>;
    assert.ok(isValidElement(element));
    assert.equal(element.type, ChallengeWorkspacePage);
    assert.equal(element.props.scenario, challenge001);
  });

  test("Challenge 001 renders the same playable workspace as the home page", async () => {
    assert.equal(renderToStaticMarkup(await page("challenge-001")), renderToStaticMarkup(createElement(Home)));
  });

  test("the workspace is given Challenge 001's ID, which diagnosis requests are sent for", async () => {
    const element = (await page("challenge-001")) as ReactElement<{ scenario: WorkspaceScenario }>;
    assert.equal(element.props.scenario.challenge.id, "challenge-001");
  });

  test("prerenders exactly the catalog's challenges, and requires the route to stay static", () => {
    assert.deepEqual(generateStaticParams(), listChallengeSummaries().map(({ id }) => ({ challengeId: id })));
    assert.deepEqual(generateStaticParams(), [{ challengeId: "challenge-001" }]);
    assert.equal(ensureStatic, "navigation");
  });

  test("titles the page after the challenge", async () => {
    assert.deepEqual(await generateMetadata(props("challenge-001")), {
      title: "BugLab · Challenge 001: Broken User Sessions",
    });
  });
});

describe("/challenges/[challengeId]: unknown challenges", () => {
  const unknown = ["challenge-999", "", "CHALLENGE-001", "challenge-001 ", "__proto__", "constructor", "001"];

  test("calls notFound() for IDs that are not in the catalog", async () => {
    for (const id of unknown) await assert.rejects(page(id), isNotFound, JSON.stringify(id));
  });

  test("adds no metadata for unknown IDs", async () => {
    for (const id of unknown) assert.deepEqual(await generateMetadata(props(id)), {}, JSON.stringify(id));
  });
});

describe("challenge routes", () => {
  test("a challenge's path is built from its catalog ID", () => {
    assert.equal(challengePath("challenge-001"), "/challenges/challenge-001");
    assert.equal(challengePath("a b/c?d"), "/challenges/a%20b%2Fc%3Fd", "IDs are encoded as one segment");
  });
});

describe("/challenges/[challengeId]: public data only", () => {
  test("the rendered workspace contains no answer-key data", async () => {
    const markup = renderToStaticMarkup(await page("challenge-001"));
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations", "keyEvidence"]) {
      assert.ok(!markup.includes(field), field);
    }
    assert.ok(!markup.includes(provisionalAnswerKey.resolutionSummary), "resolution summary");
  });

  test("the route reads only the public catalog and the shared workspace page", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(([, from]) => from);
    assert.deepEqual(imports, [
      "next",
      "next/navigation",
      "@/components/challenge/ChallengeWorkspacePage",
      "@/lib/challenge-catalog",
    ]);
    assert.doesNotMatch(source, /use client|@\/server\/|answer-key|\.server\b|fetch\(|cookies\(|headers\(/);
  });
});
