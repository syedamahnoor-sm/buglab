/*
 * The browser client against the REAL backend: the learner, session, attempts
 * and diagnosis handlers built by createAppServices, which no route mounts yet.
 *
 * A browser-like fetch double routes each request to the matching handler. Like
 * a browser it sends Origin and Sec-Fetch-Site and keeps the HttpOnly learner
 * cookie in a jar the client never sees. So every response the client parses
 * here is one the real server built, and a change to a server view or status
 * code that the client does not follow fails this file.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { createLearnerSessionApi } from "@/lib/learner-session/api";
import { createSessionCoordinator } from "@/lib/learner-session/coordinator";
import { createSubmissionKeys } from "@/lib/learner-session/idempotency";
import { createAppServices } from "@/server/app-services";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { createAttemptHistoryHandler, createChallengeSessionHandlers, createLearnerHandlers } from "@/server/session/handlers";
import type { DiagnosisSubmission } from "@/types/diagnosis";

const APP = "https://buglab.example";
const CHALLENGE = "challenge-001";

/** A fresh backend (in-memory store) and a browser with its own cookie jar. */
function setup(options: { sendOrigin?: boolean } = {}) {
  const base = createDefaultChallengeRegistry();
  let versionSuffix = "";
  // The real registry, with a switch to simulate a content change.
  const challenges = { ...base, contentVersion: (id: string) => base.contentVersion(id)?.concat(versionSuffix) };
  const services = createAppServices({ challenges, appOrigin: APP, trustedProxyHops: 0 });
  const learner = createLearnerHandlers({ service: services.service, appOrigin: APP });
  const session = createChallengeSessionHandlers({ service: services.service, appOrigin: APP });
  const attempts = createAttemptHistoryHandler({ service: services.service, appOrigin: APP });

  const jar = new Map<string, string>();
  const requests: string[] = [];
  const browserFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), APP);
    const method = init.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    const headers = new Headers(init.headers);
    if (options.sendOrigin !== false) {
      headers.set("sec-fetch-site", "same-origin");
      if (method !== "GET") headers.set("origin", APP);
    }
    if (jar.size) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    const request = new Request(url, { method, headers, body: init.body, signal: init.signal });

    const match = url.pathname.match(/^\/api\/challenges\/([^/]+)\/(session|attempts|diagnosis)$/);
    const context = { params: Promise.resolve({ challengeId: decodeURIComponent(match?.[1] ?? "") }) };
    let response: Response;
    if (url.pathname === "/api/learner") response = await (method === "POST" ? learner.POST(request) : learner.GET(request));
    else if (match?.[2] === "session") response = await (method === "POST" ? session.POST(request, context) : session.GET(request, context));
    else if (match?.[2] === "attempts") response = await attempts.GET(request, context);
    else if (match?.[2] === "diagnosis") response = await services.diagnosis(request, context);
    else response = new Response(null, { status: 404 });

    const cookie = response.headers.get("set-cookie");
    if (cookie) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }) as typeof fetch;

  return {
    api: createLearnerSessionApi({ fetch: browserFetch }),
    jar,
    requests,
    bumpContentVersion: () => {
      versionSuffix += "-next";
    },
  };
}

const wrongOption = challenge001.rootCauseOptions.find((option) => option.id !== provisionalAnswerKey.correctRootCauseId)!.id;
const otherWrongOption = challenge001.rootCauseOptions.filter((option) => option.id !== provisionalAnswerKey.correctRootCauseId)[1].id;
const evidence = [{ kind: "log" as const, logId: challenge001.logs[0].id }];
const wrong: DiagnosisSubmission = { rootCauseId: wrongOption, explanation: "The session cookie is not sent with later requests at all.", evidence };
const right: DiagnosisSubmission = { rootCauseId: provisionalAnswerKey.correctRootCauseId, explanation: "Login signs the cookie but the middleware reads it as unsigned.", evidence };

describe("initialization against the real handlers", () => {
  test("a new browser gets a learner and a session in three calls, then none", async () => {
    const { api, requests, jar } = setup();
    const coordinator = createSessionCoordinator(api, CHALLENGE);
    const init = await coordinator.ensure();
    assert.ok(init.kind === "ready" && init.learnerCreated && init.sessionCreated && !init.restarted);
    assert.equal(init.session.challengeId, CHALLENGE);
    assert.equal(init.session.status, "active");
    assert.deepEqual(requests, [
      "GET /api/challenges/challenge-001/session",
      "POST /api/learner",
      "POST /api/challenges/challenge-001/session",
    ]);
    assert.ok(jar.has("buglab_learner"), "the browser holds the HttpOnly cookie");
    await coordinator.ensure();
    assert.equal(requests.length, 3, "a ready session is not initialized again");
  });

  test("a returning browser with a session needs one read", async () => {
    const { api, requests } = setup();
    await createSessionCoordinator(api, CHALLENGE).ensure();
    requests.length = 0;
    const init = await createSessionCoordinator(api, CHALLENGE).ensure();
    assert.ok(init.kind === "ready" && !init.learnerCreated && !init.sessionCreated);
    assert.deepEqual(requests, ["GET /api/challenges/challenge-001/session"]);
  });

  test("a content change is detected and the session restarted", async () => {
    const { api, bumpContentVersion } = setup();
    const coordinator = createSessionCoordinator(api, CHALLENGE);
    const first = await coordinator.ensure();
    bumpContentVersion();
    const stale = await api.getSession(CHALLENGE);
    assert.ok(stale.ok && stale.data.state === "active" && stale.data.session.restartRequired);
    coordinator.invalidate();
    const second = await coordinator.ensure();
    assert.ok(first.kind === "ready" && second.kind === "ready");
    assert.ok(second.restarted && second.versionChanged);
    assert.notEqual(second.session.contentVersion, first.session.contentVersion);
  });

  test("an unknown challenge fails with the server's reason", async () => {
    const { api } = setup();
    await api.startLearner();
    const init = await createSessionCoordinator(api, "no-such-challenge").ensure();
    assert.ok(init.kind === "failed" && init.error.kind === "not-found" && init.error.code === "unknown-challenge");
  });
});

describe("diagnosis with idempotency against the real handlers", () => {
  test("a retry replays, a change counts, a reused key conflicts, and completion is restorable data", async () => {
    const { api } = setup();
    await createSessionCoordinator(api, CHALLENGE).ensure();
    const keys = createSubmissionKeys();

    const firstKey = keys.keyFor(wrong);
    const first = await api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: firstKey });
    assert.ok(first.kind === "response" && first.response.status === "incorrect");

    // A retry of the same click: same key, same result, nothing new recorded.
    const retryKey = keys.keyFor(structuredClone(wrong));
    assert.equal(retryKey, firstKey);
    const retry = await api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: retryKey });
    assert.deepEqual(retry, first);
    let history = await api.listAttempts(CHALLENGE);
    assert.ok(history.ok && history.data.length === 1);

    // The same key for a different answer is refused.
    const conflict = await api.submitDiagnosis(CHALLENGE, right, { idempotencyKey: firstKey });
    assert.ok(conflict.kind === "error" && conflict.error.kind === "conflict" && conflict.error.code === "submission-id-conflict");

    // A changed submission gets a new key and counts.
    const correct = await api.submitDiagnosis(CHALLENGE, right, { idempotencyKey: keys.keyFor(right) });
    assert.ok(correct.kind === "response" && correct.response.status === "correct");
    history = await api.listAttempts(CHALLENGE);
    assert.ok(history.ok && history.data.map((attempt) => attempt.result).join() === "incorrect,correct");

    const after = await api.getSession(CHALLENGE);
    assert.ok(after.ok && after.data.state === "active");
    const { session } = after.data;
    assert.equal(session.status, "completed");
    assert.equal(session.completion?.submission.rootCauseId, right.rootCauseId);
    assert.deepEqual(session.completion?.submission.evidence, evidence);
  });

  test("the attempt window answers 429 with Retry-After as a rate-limited answer", async () => {
    const { api } = setup();
    await createSessionCoordinator(api, CHALLENGE).ensure();
    const keys = createSubmissionKeys();
    const variants = [0, 1, 2, 3].map((n) => ({ ...wrong, rootCauseId: n % 2 ? otherWrongOption : wrongOption, explanation: `${wrong.explanation} (variant ${n})` }));
    for (const submission of variants.slice(0, 3)) {
      const result = await api.submitDiagnosis(CHALLENGE, submission, { idempotencyKey: keys.keyFor(submission) });
      assert.ok(result.kind === "response" && result.response.status === "incorrect");
    }
    const blocked = await api.submitDiagnosis(CHALLENGE, variants[3], { idempotencyKey: keys.keyFor(variants[3]) });
    assert.ok(blocked.kind === "response" && blocked.status === 429 && blocked.response.status === "rate-limited");
    assert.ok(blocked.response.retryAfterSeconds > 0);
  });

  test("the server's failures map to the documented kinds and codes", async () => {
    const fresh = setup();
    const key = createSubmissionKeys().keyFor(wrong);

    const noLearner = await fresh.api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: key });
    assert.ok(noLearner.kind === "error" && noLearner.error.status === 401 && noLearner.error.code === "learner-missing");

    await fresh.api.startLearner();
    const noSession = await fresh.api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: key });
    assert.ok(noSession.kind === "error" && noSession.error.status === 404 && noSession.error.code === "session-missing");

    const unknown = await fresh.api.submitDiagnosis("no-such-challenge", wrong, { idempotencyKey: key });
    assert.ok(unknown.kind === "error" && unknown.error.kind === "not-found" && unknown.error.code === "unknown-challenge");

    const huge = { ...wrong, explanation: "x".repeat(20_000) };
    const tooLarge = await fresh.api.submitDiagnosis(CHALLENGE, huge, { idempotencyKey: key });
    assert.ok(tooLarge.kind === "error" && tooLarge.error.kind === "payload-too-large" && tooLarge.error.status === 413);

    const badKey = await fresh.api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: "not-a-uuid" });
    assert.ok(badKey.kind === "response" && badKey.status === 400 && badKey.response.status === "invalid");

    const noOrigin = setup({ sendOrigin: false });
    const forbidden = await noOrigin.api.startLearner();
    assert.ok(!forbidden.ok && forbidden.error.kind === "forbidden" && forbidden.error.status === 403);
  });
});

describe("nothing secret reaches the client", () => {
  test("no learner token and no private evaluation data in anything the client returns", async () => {
    const { api, jar } = setup();
    const keys = createSubmissionKeys();
    const returned: unknown[] = [];
    returned.push(await createSessionCoordinator(api, CHALLENGE).ensure());
    returned.push(await api.submitDiagnosis(CHALLENGE, wrong, { idempotencyKey: keys.keyFor(wrong) }));
    returned.push(await api.submitDiagnosis(CHALLENGE, right, { idempotencyKey: keys.keyFor(right) }));
    returned.push(await api.getSession(CHALLENGE), await api.listAttempts(CHALLENGE), await api.getLearner());
    const text = JSON.stringify(returned);
    const token = jar.get("buglab_learner")!;
    assert.ok(token.length >= 40);
    assert.ok(!text.includes(token), "the learner token");
    for (const secret of ["correctRootCauseId", "keyObservations", ...provisionalAnswerKey.keyObservations.map((observation) => observation.id)]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  test("the client code never touches cookies or storage, and imports nothing from the server", () => {
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    const sources = ["lib/learner-session/api.ts", "lib/learner-session/parse.ts", "lib/learner-session/idempotency.ts", "lib/learner-session/coordinator.ts", "types/learner-session.ts"];
    for (const path of sources) {
      const text = readFileSync(join(root, path), "utf8");
      assert.doesNotMatch(text, /document\.cookie|localStorage|sessionStorage|indexedDB/, path);
      assert.doesNotMatch(text, /@\/server\/|answer-key|server-only/, path);
    }
  });

  test("Phase 1: no page or component uses the client yet", () => {
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
    const users = [...walk(join(root, "app")), ...walk(join(root, "components")), ...walk(join(root, "engine"))].filter((path) =>
      readFileSync(path, "utf8").includes("@/lib/learner-session"),
    );
    assert.deepEqual(users, []);
  });
});
