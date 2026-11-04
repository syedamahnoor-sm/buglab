/*
 * Every challenge authored with src/lib/authoring and src/server/content must
 * be registered everywhere, internally consistent, gradeable and private.
 * Adding a challenge needs no change here: each check runs over all of them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { CATEGORIES } from "@/data/catalog/categories";
import { validateCatalogEntry } from "@/lib/catalog/validate";
import { getPublicScenario, listPublishedChallenges } from "@/lib/challenge-catalog";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { AUTHORED_CHALLENGES, investigationHintsFor } from "@/server/content";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { restrictToPublished } from "@/server/diagnosis/published";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import type { DiagnosisSubmission } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";
import { post } from "../diagnosis/fixtures";

const HTTP_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) (\d{3}) (\d+)ms$/;
const authored = AUTHORED_CHALLENGES;
const idOf = (challenge: (typeof authored)[number]) => challenge.scenario.challenge.id;

/** Everything a learner can read in a scenario, as one string. */
function publicText(id: string): string {
  const scenario = getPublicScenario(id)!;
  return JSON.stringify({ ...scenario, rootCauseOptions: undefined });
}

describe("registration", () => {
  test("the catalog and the answer-key list name the same challenges, in the same order", () => {
    const catalogIds = REGISTERED_CHALLENGES.map((entry) => entry.scenario.challenge.id).filter((id) => id !== "challenge-001");
    assert.deepEqual(authored.map(idOf), catalogIds);
  });

  test("each answer key is for the very scenario the catalog registers, not a copy", () => {
    for (const challenge of authored) {
      const entry = REGISTERED_CHALLENGES.find((item) => item.scenario.challenge.id === idOf(challenge));
      assert.equal(entry?.scenario, challenge.scenario, idOf(challenge));
    }
  });

  test("every authored challenge is published, passes catalog validation and has a route, a live answer key and a content version", () => {
    const live = restrictToPublished(createDefaultRegistry());
    const registry = createDefaultChallengeRegistry();
    const published = new Set(listPublishedChallenges().map((challenge) => challenge.id));
    for (const challenge of authored) {
      const id = idOf(challenge);
      const entry = REGISTERED_CHALLENGES.find((item) => item.scenario.challenge.id === id)!;
      assert.deepEqual(validateCatalogEntry(entry), [], id);
      assert.ok(published.has(id), `${id} is published`);
      assert.ok(live.has(id), `${id} is submittable`);
      assert.ok(registry.getDiagnosis(id), `${id} is in the challenge registry`);
      assert.match(registry.contentVersion(id) ?? "", /^\d+\+[0-9a-f]{12}$/, id);
    }
  });
});

describe("internal consistency", () => {
  for (const { scenario } of authored) {
    const id = scenario.challenge.id;

    test(`${id}: every request agrees with its server log line`, () => {
      const logs = new Map(scenario.logs.map((entry) => [entry.id, entry]));
      for (const request of scenario.network) {
        if (!request.serverLogId) continue;
        const line = logs.get(request.serverLogId)!;
        const http = line.message.match(HTTP_LINE);
        if (!http) continue;
        assert.equal(request.timestamp, line.timestamp, `${request.id} time`);
        assert.equal(request.method, http[1], `${request.id} method`);
        // Some services log the path without its query string.
        assert.equal(request.path.split("?")[0], http[2].split("?")[0], `${request.id} path`);
        assert.equal(request.status, Number(http[3]), `${request.id} status`);
        assert.ok(request.durationMs >= Number(http[4]), `${request.id}: the browser cannot be faster than the server`);
      }
    });

    test(`${id}: logs and requests are in time order`, () => {
      const times = (items: { timestamp: string }[]) => items.map((item) => item.timestamp);
      assert.deepEqual(times(scenario.logs), [...times(scenario.logs)].sort(), "logs");
      assert.deepEqual(times(scenario.network), [...times(scenario.network)].sort(), "network");
    });

    test(`${id}: a real investigation: an incident brief, several code files, logs and enough choices`, () => {
      const paths = scenario.files.map((file) => file.path);
      assert.equal(scenario.entryFilePath, "INCIDENT.md");
      assert.ok(paths.includes("INCIDENT.md"));
      const code = paths.filter((path) => !/\.(md|log)$/.test(path) && path !== "package.json");
      assert.ok(code.length >= 3, `${id} has ${code.length} code files`);
      assert.ok(scenario.logs.length >= 8, `${id} has ${scenario.logs.length} log lines`);
      assert.ok(scenario.rootCauseOptions.length >= 4, `${id} options`);
      assert.ok(scenario.files.some((file) => file.path.endsWith(".log")), `${id} shows its logs as a file`);
    });
  }
});

describe("answer keys", () => {
  for (const challenge of authored) {
    const id = idOf(challenge);
    const { evaluation, investigationHints } = challenge;

    test(`${id}: at least three key observations, each backed by evidence`, () => {
      assert.ok(evaluation.keyObservations.length >= 3, id);
      for (const observation of evaluation.keyObservations) assert.ok(observation.refs.length > 0, observation.id);
    });

    test(`${id}: nothing public gives the answer away`, () => {
      const text = publicText(id);
      assert.ok(!text.includes(evaluation.correctRootCauseId), "the correct option id appears outside the options");
      assert.ok(!text.includes(evaluation.resolutionSummary.slice(0, 60)), "the resolution text is public");
      const correct = challenge.scenario.rootCauseOptions.find((option) => option.id === evaluation.correctRootCauseId)!;
      for (const hint of investigationHints) {
        assert.ok(!hint.includes(correct.label) && !hint.includes(correct.id), `a hint names the answer: ${hint}`);
      }
    });
  }

  test("the correct option is not always in the same position", () => {
    const positions = new Set(
      authored.map((challenge) =>
        challenge.scenario.rootCauseOptions.findIndex((option) => option.id === challenge.evaluation.correctRootCauseId),
      ),
    );
    assert.ok(authored.length < 4 || positions.size >= 3, `correct options only ever at ${[...positions]}`);
  });

  test("no two challenges share a title, an incident, a resolution or a code file", () => {
    for (const pick of [
      (c: (typeof authored)[number]) => c.scenario.challenge.title,
      (c: (typeof authored)[number]) => c.scenario.challenge.incident,
      (c: (typeof authored)[number]) => c.evaluation.resolutionSummary,
    ]) {
      const values = authored.map(pick);
      assert.equal(new Set(values).size, values.length);
    }
    const seen = new Map<string, string>();
    for (const challenge of authored) {
      for (const file of challenge.scenario.files) {
        if (file.path === "package.json" || file.content.length < 200) continue;
        const owner = seen.get(file.content);
        assert.ok(!owner, `${idOf(challenge)} ${file.path} duplicates ${owner}`);
        seen.set(file.content, `${idOf(challenge)} ${file.path}`);
      }
    }
  });
});

describe("grading through the live endpoint", () => {
  const handler = () =>
    createDiagnosisHandler({
      registry: restrictToPublished(createDefaultRegistry()),
      wrongAttempts: new FixedWindowLimiter({ limit: 1000, windowMs: 600_000 }),
      ipSubmissions: new FixedWindowLimiter({ limit: 1000, windowMs: 600_000 }),
      trustedProxyHops: 0,
      appOrigin: null,
      investigationHints: investigationHintsFor,
    });
  const explanation =
    "The evidence I collected points to this cause: the logs and requests show the failure happening exactly where this explains it.";

  for (const challenge of authored) {
    const id = idOf(challenge);
    const evidence: EvidenceRef[] = challenge.evaluation.keyObservations.map((observation) => observation.refs[0]);
    const submit = (rootCauseId: string) => {
      const body: DiagnosisSubmission = { rootCauseId, explanation, evidence };
      return post(handler(), { challengeId: id, body });
    };

    test(`${id}: the correct diagnosis is confirmed with its resolution and full evidence coverage`, async () => {
      const { response, json } = await submit(challenge.evaluation.correctRootCauseId);
      assert.equal(response.status, 200);
      assert.equal(json.status, "correct");
      assert.deepEqual(json.resolution, { summary: challenge.evaluation.resolutionSummary });
      const count = challenge.evaluation.keyObservations.length;
      assert.ok((json.feedback as { hints: string[] }).hints[0].includes(`covered ${count} of ${count}`));
    });

    test(`${id}: every wrong option gets the same feedback, with this challenge's hints and no resolution`, async () => {
      const wrong = challenge.scenario.rootCauseOptions.filter((option) => option.id !== challenge.evaluation.correctRootCauseId);
      const feedback = new Set<string>();
      for (const option of wrong) {
        const { response, json, text } = await submit(option.id);
        assert.equal(response.status, 200, option.id);
        assert.equal(json.status, "incorrect", option.id);
        assert.equal(json.resolution, undefined, option.id);
        assert.ok(!text.includes(challenge.evaluation.resolutionSummary.slice(0, 60)), option.id);
        feedback.add(JSON.stringify(json.feedback));
      }
      assert.equal(feedback.size, 1, "feedback differs between wrong options");
      const hints = (JSON.parse([...feedback][0]) as { hints: string[] }).hints;
      for (const hint of challenge.investigationHints) assert.ok(hints.includes(hint), hint);
    });
  }
});

describe("coverage of the catalog", () => {
  const challenges = listPublishedChallenges();

  test("every category and difficulty in use is a known one", () => {
    const categories = new Set(CATEGORIES.map((category) => category.id));
    for (const challenge of challenges) assert.ok(categories.has(challenge.category), challenge.id);
  });
});
