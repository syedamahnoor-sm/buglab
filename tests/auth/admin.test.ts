import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { ChallengeInventory } from "@/components/admin/ChallengeInventory";
import { ChallengeReview } from "@/components/admin/ChallengeReview";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { AdminAccessError, getAdminChallenge, listAdminChallenges } from "@/server/admin/challenges";
import type { AuthenticatedUser } from "@/server/auth/types";
import { fixtureEntry } from "../catalog/fixtures";

const admin: AuthenticatedUser = { id: "acct-admin", email: "admin@buglab.example", displayName: null, role: "admin" };
const learner: AuthenticatedUser = { ...admin, id: "acct-learner", role: "learner" };
const entries = [
  ...REGISTERED_CHALLENGES,
  fixtureEntry("challenge-080", { listing: { status: "draft", publishedAt: undefined, description: "" } }),
  fixtureEntry("challenge-081", { listing: { status: "archived" } }),
];

describe("admin data access enforces its own permission", () => {
  test("anonymous and learner are refused, whatever the caller forgot", () => {
    for (const user of [null, learner]) {
      assert.throws(() => listAdminChallenges(user, entries), AdminAccessError);
      assert.throws(() => getAdminChallenge(user, "challenge-001", entries), AdminAccessError);
    }
  });

  test("an admin sees every challenge, drafts and archived included, with readiness", () => {
    const rows = listAdminChallenges(admin, entries);
    assert.deepEqual(rows.map((row) => `${row.id}:${row.status}:${row.ready}`), [
      "challenge-001:published:true",
      "challenge-080:draft:false",
      "challenge-081:archived:true",
    ]);
    assert.ok(rows[1].failedChecks >= 1);
  });

  test("details carry public metadata and readiness, never evaluation data", () => {
    const detail = getAdminChallenge(admin, "challenge-001", entries)!;
    assert.ok(detail.checks.every((check) => check.passed));
    const text = JSON.stringify(detail);
    for (const secret of ["correctRootCauseId", "keyObservations", "rootCauseOptions", provisionalAnswerKey.resolutionSummary]) {
      assert.ok(!text.includes(secret), secret);
    }
    assert.equal(getAdminChallenge(admin, "no-such-challenge", entries), null);
  });
});

describe("admin components", () => {
  test("inventory shows status and readiness for every row, with labelled table headers", () => {
    const markup = renderToStaticMarkup(createElement(ChallengeInventory, { rows: listAdminChallenges(admin, entries) }));
    assert.match(markup, /<caption class="sr-only">Registered challenges<\/caption>/);
    for (const label of [">Published<", ">Draft<", ">Archived<", "All checks pass", "check"]) assert.ok(markup.includes(label), label);
    assert.match(markup, /href="\/admin\/challenges\/challenge-001\/edit"/);
  });

  test("review is honest: a disabled form with no save action, a checklist and a preview", () => {
    const markup = renderToStaticMarkup(createElement(ChallengeReview, { detail: getAdminChallenge(admin, "challenge-080", entries)! }));
    assert.match(markup, /<fieldset disabled=""/);
    assert.doesNotMatch(markup, /type="submit"|<button|action=/);
    assert.ok(markup.includes("Read-only."));
    assert.match(markup, /aria-hidden="true" class="text-danger">✕/);
    assert.ok(markup.includes(": fails"));
    assert.ok(markup.includes("Card preview"));
  });

  test("the admin frame marks itself read-only and names the current section", () => {
    const markup = renderToStaticMarkup(createElement(AdminShell, { current: "challenges", title: "Challenges" }));
    assert.match(markup, /<nav aria-label="Admin"/);
    assert.match(markup, /aria-current="page"[^>]*href="\/admin\/challenges"|href="\/admin\/challenges"[^>]*aria-current="page"/);
    assert.ok(markup.includes(">Read-only<"));
  });

  test("Challenge 001 is untouched by the admin view", () => {
    assert.equal(REGISTERED_CHALLENGES[0].scenario, challenge001);
  });
});
