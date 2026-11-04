/*
 * Enforces the manual revision bump.
 *
 * The content version is `<revision>+<fingerprint of the PUBLIC content>`. The private
 * evaluation configuration (the correct answer, the resolution text, the key observations)
 * is deliberately not part of the fingerprint, because the version is returned to learners
 * and a hash that included the answer would let anyone test the few possible answers offline.
 * So nothing in the version moves when the answer key changes, and a person has to bump
 * `revision` by hand.
 *
 * This test is what makes forgetting that impossible to do quietly. It pins, per challenge,
 * the revision and a SHA-256 digest of the canonical private configuration. If the
 * configuration changes without the revision changing, this test fails and says what to do.
 *
 * It covers every challenge the DEFAULT REGISTRY loads: it reads `defaultChallengeSources`,
 * the same list `createDefaultChallengeRegistry()` loads (default-registry.ts). A challenge
 * registered there has no pin yet, so this test fails until its revision and digest are pinned
 * below. Nothing else needs remembering.
 *
 * The digest lives only in this test file. It is not exported, not part of any version or
 * response, and a guard below checks it appears nowhere under src/, so it cannot reach a
 * client bundle. It adds no exposure: the answer key itself is in the repository.
 *
 * What the digest does NOT cover: the grading CODE (the evaluator, its hints, and the limits
 * in the validator). Changing how an answer key is applied does not change the key, so it
 * does not trip this test. Bump the revision by hand when grading behaviour changes too.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChallengeDefinition } from "@/server/challenges/definition";
import { createDefaultChallengeRegistry, defaultChallengeSources } from "@/server/challenges/default-registry";
import { staticChallengeSource, type ChallengeSource } from "@/server/challenges/loader";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { canonicalJson } from "@/server/challenges/version";
import { draftOf } from "./helpers";

interface Pin {
  readonly revision: string;
  /** SHA-256 over canonicalJson(definition.evaluation). */
  readonly evaluationDigest: string;
}

/** One entry per challenge. When the private configuration changes, bump the revision and update its entry. */
const PINS: Readonly<Record<string, Pin>> = {
  "challenge-001": {
    revision: "1",
    evaluationDigest: "91c71d8d2492864e892c9113728dd40bf2965729ac8d5ad3d43ae170fb83ebb1",
  },
};

const digestOf = (definition: ChallengeDefinition) =>
  createHash("sha256").update(canonicalJson(definition.evaluation)).digest("hex");

const definitionsOf = (sources: readonly ChallengeSource[]) => sources.flatMap((source) => [...source.load()]);
const idOf = (definition: ChallengeDefinition) => definition.scenario.challenge.id;

type Verdict = { ok: true } | { ok: false; message: string };

/** Compares a challenge's current revision and digest with its pin, and says what to do if they differ. */
function checkPin(challengeId: string, pin: Pin | undefined, current: Pin): Verdict {
  if (!pin) {
    return {
      ok: false,
      message:
        `${challengeId} has no entry in PINS (tests/challenges/revision-pin.test.ts). Add one:\n` +
        `  "${challengeId}": { revision: "${current.revision}", evaluationDigest: "${current.evaluationDigest}" }`,
    };
  }
  if (pin.evaluationDigest === current.evaluationDigest && pin.revision === current.revision) return { ok: true };

  if (pin.evaluationDigest !== current.evaluationDigest && pin.revision === current.revision) {
    return {
      ok: false,
      message:
        `The private evaluation configuration of ${challengeId} has changed (the correct answer, the resolution ` +
        `text or the key observations), but its revision is still "${pin.revision}".\n` +
        `Learners' sessions record the content version, and a changed answer key is not visible in it, so the ` +
        `revision must be bumped by hand.\n` +
        `  1. Bump the revision of ${challengeId} in the file that defines it (under src/server/challenges/).\n` +
        `  2. Update its entry in PINS (tests/challenges/revision-pin.test.ts) to:\n` +
        `       revision: "<the new revision>", evaluationDigest: "${current.evaluationDigest}"`,
    };
  }

  return {
    ok: false,
    message:
      `The revision of ${challengeId} is now "${current.revision}" (pinned: "${pin.revision}"). ` +
      `Update its entry in PINS (tests/challenges/revision-pin.test.ts) to:\n` +
      `  "${challengeId}": { revision: "${current.revision}", evaluationDigest: "${current.evaluationDigest}" }`,
  };
}

/** Every failure for a set of sources against a set of pins: each loaded challenge, and each pin with no challenge. */
function problemsFor(sources: readonly ChallengeSource[], pins: Readonly<Record<string, Pin>>): string[] {
  const problems: string[] = [];
  const definitions = definitionsOf(sources);
  for (const definition of definitions) {
    const id = idOf(definition);
    const verdict = checkPin(id, pins[id], { revision: definition.revision, evaluationDigest: digestOf(definition) });
    if (!verdict.ok) problems.push(verdict.message);
  }
  const loaded = new Set(definitions.map(idOf));
  for (const id of Object.keys(pins)) {
    if (!loaded.has(id)) problems.push(`${id} is pinned but no longer defined, so remove its entry from PINS`);
  }
  return problems;
}

describe("the private evaluation configuration of every default challenge is pinned to a revision", () => {
  test("every challenge in the default registry matches its pin, and no pin is left without a challenge", () => {
    const problems = problemsFor(defaultChallengeSources, PINS);
    assert.deepEqual(problems, [], `\n${problems.join("\n\n")}\n`);
  });

  test("the sources checked here are the ones the default registry loads", () => {
    const registry = createDefaultChallengeRegistry();
    const checked = definitionsOf(defaultChallengeSources).map(idOf);
    assert.deepEqual(
      registry.list().map((summary) => summary.id),
      checked,
      "the registry loads a challenge this test does not check, or the reverse",
    );
    assert.ok(checked.length > 0);
  });
});

describe("a challenge that is registered without a pin cannot pass", () => {
  /** A second, valid challenge: Challenge 001's content under another id. */
  const secondChallenge = (change?: (draft: ReturnType<typeof draftOf>) => void) =>
    staticChallengeSource("a-newly-registered-challenge", [
      draftOf((draft) => {
        (draft.scenario.challenge as { id: string }).id = "challenge-002";
        draft.scenario.challenge.number = "002";
        change?.(draft);
      }),
    ]);

  test("the new challenge is valid, so the only thing standing in its way is the missing pin", () => {
    assert.doesNotThrow(() => createChallengeRegistry(definitionsOf([...defaultChallengeSources, secondChallenge()])));
  });

  test("registering it fails the pin check, and the message says exactly what to add", () => {
    const problems = problemsFor([...defaultChallengeSources, secondChallenge()], PINS);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /challenge-002 has no entry in PINS/);
    assert.match(problems[0], /"challenge-002": \{ revision: "1", evaluationDigest: "[0-9a-f]{64}" \}/);
  });

  test("giving it a pin makes it pass, and then a changed answer key fails until the revision is bumped", () => {
    const added = secondChallenge();
    const [definition] = definitionsOf([added]);
    const pins = { ...PINS, "challenge-002": { revision: definition.revision, evaluationDigest: digestOf(definition) } };
    assert.deepEqual(problemsFor([...defaultChallengeSources, added], pins), []);

    const edited = secondChallenge((draft) => {
      draft.evaluation.resolutionSummary += " (corrected)";
    });
    const problems = problemsFor([...defaultChallengeSources, edited], pins);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /private evaluation configuration of challenge-002 has changed/);
  });

  test("a challenge that is later removed leaves a stale pin that fails", () => {
    const problems = problemsFor([], PINS);
    assert.ok(problems.some((problem) => problem.includes("challenge-001 is pinned but no longer defined")));
  });
});

describe("the pin check itself", () => {
  const pin: Pin = { revision: "1", evaluationDigest: "a".repeat(64) };

  test("passes when nothing has changed", () => {
    assert.deepEqual(checkPin("c", pin, pin), { ok: true });
  });

  test("a changed answer key at the same revision fails, and tells the author to bump the revision", () => {
    const verdict = checkPin("c", pin, { revision: "1", evaluationDigest: "b".repeat(64) });
    assert.ok(!verdict.ok);
    assert.match(verdict.message, /private evaluation configuration of c has changed/);
    assert.match(verdict.message, /revision must be bumped by hand/);
    assert.match(verdict.message, /Bump the revision of c in the file that defines it/);
    assert.ok(verdict.message.includes("b".repeat(64)), "it says which digest to pin");
  });

  test("a bumped revision with a changed key fails until the pin is updated, and says how", () => {
    const verdict = checkPin("c", pin, { revision: "2", evaluationDigest: "b".repeat(64) });
    assert.ok(!verdict.ok);
    assert.match(verdict.message, /revision of c is now "2"/);
    assert.ok(verdict.message.includes('revision: "2"') && verdict.message.includes("b".repeat(64)));
  });

  test("a bumped revision with an unchanged key also asks for the pin to be updated", () => {
    const verdict = checkPin("c", pin, { revision: "2", evaluationDigest: pin.evaluationDigest });
    assert.ok(!verdict.ok);
    assert.match(verdict.message, /Update its entry in PINS/);
  });

  test("a challenge with no pin fails, and says what to add", () => {
    const verdict = checkPin("c", undefined, pin);
    assert.ok(!verdict.ok);
    assert.match(verdict.message, /has no entry in PINS/);
  });

  test("the digest follows the evaluation configuration and nothing else", () => {
    const [definition] = definitionsOf(defaultChallengeSources);
    const copy = structuredClone(definition);
    assert.equal(digestOf(copy), digestOf(definition));
    (copy.evaluation as { resolutionSummary: string }).resolutionSummary += " ";
    assert.notEqual(digestOf(copy), digestOf(definition), "the resolution text is covered");
    const other = structuredClone(definition);
    (other.evaluation as { correctRootCauseId: string }).correctRootCauseId = "cookie-not-sent";
    assert.notEqual(digestOf(other), digestOf(definition), "the correct answer is covered");
    const regrouped = structuredClone(definition);
    (regrouped.evaluation.keyObservations as unknown[]).pop();
    assert.notEqual(digestOf(regrouped), digestOf(definition), "the key observations are covered");
    const edited = structuredClone(definition);
    (edited.scenario.challenge as { title: string }).title = "A different title";
    assert.equal(digestOf(edited), digestOf(definition), "public content is not part of the digest");
  });
});

describe("the digest never leaves this test file", () => {
  const ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const BUILD_OUTPUT = join(ROOT, ".next/static");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sourceFiles(path) : [path];
    });
  }

  function hasBuildOutput(): boolean {
    try {
      return statSync(BUILD_OUTPUT).isDirectory();
    } catch {
      return false;
    }
  }

  test("no file under src/ contains a pinned digest", () => {
    const digests = Object.values(PINS).map((pin) => pin.evaluationDigest);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(path, "utf8");
      for (const digest of digests) assert.ok(!text.includes(digest), path);
    }
  });

  test("the content version does not contain any part of the digest", () => {
    const definitions = definitionsOf(defaultChallengeSources);
    const registry = createChallengeRegistry(definitions);
    for (const definition of definitions) {
      const version = registry.contentVersion(idOf(definition))!;
      const digest = digestOf(definition);
      assert.ok(!version.includes(digest.slice(0, 12)), "the version must not be derived from the private configuration");
    }
  });

  // Reported as skipped, not passed, when there is no build to look at: run `npm run build` first to include it.
  test(
    "no built client output contains a pinned digest",
    { skip: hasBuildOutput() ? false : "no .next/static: run the production build first to include this scan" },
    () => {
      const digests = Object.values(PINS).map((pin) => pin.evaluationDigest);
      let scanned = 0;
      for (const path of sourceFiles(BUILD_OUTPUT)) {
        if (!/\.(js|css|html|json|txt)$/.test(path)) continue;
        scanned += 1;
        const text = readFileSync(path, "utf8");
        for (const digest of digests) assert.ok(!text.includes(digest), path);
      }
      assert.ok(scanned > 0, "the build output was empty, so the scan proved nothing");
    },
  );
});
