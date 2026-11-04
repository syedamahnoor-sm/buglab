import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { investigationReducer } from "@/components/workspace/investigation/useInvestigationController";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { getEvidenceId } from "@/lib/evidence";
import { evaluateDiagnosis } from "@/server/diagnosis/evaluate";
import { buildKeyObservations, createDefaultRegistry } from "@/server/diagnosis/registry";
import type { EvidenceRef } from "@/types/investigation";
import { CHALLENGE_ID, CORRECT_ID, createTestHandler, post, submission, validationContext } from "./fixtures";

const answerKey = createDefaultRegistry().get(CHALLENGE_ID)!.answerKey;
const groups = Object.fromEntries(
  provisionalAnswerKey.keyObservations.map((group) => [group.id, group.refs]),
);
const logsById = new Map(challenge001.logs.map((entry) => [entry.id, entry]));
const requestsById = new Map(challenge001.network.map((request) => [request.id, request]));

const net = (requestId: string): EvidenceRef => ({ kind: "network", requestId });
const log = (logId: string): EvidenceRef => ({ kind: "log", logId });

function coverageHint(evidence: EvidenceRef[]) {
  const result = evaluateDiagnosis(submission({ rootCauseId: CORRECT_ID, evidence }), answerKey);
  assert.equal(result.status, "correct");
  return result.feedback.hints[0];
}

const covered = (count: number) =>
  `Your evidence covered ${count} of 4 key observations for this incident.`;

function requestIdsIn(groupId: string): string[] {
  return groups[groupId].map((ref) => (ref.kind === "network" ? ref.requestId : ""));
}
function logIdsIn(groupId: string): string[] {
  return groups[groupId].map((ref) => (ref.kind === "log" ? ref.logId : ""));
}

describe("key observation groups: integrity", () => {
  test("there are exactly four observations", () => {
    assert.equal(answerKey.keyObservations.length, 4);
    assert.deepEqual(Object.keys(groups), [
      "signed-cookie-issued",
      "cookie-sent-still-401",
      "auth-rejected",
      "login-succeeded",
    ]);
  });

  test("every grouped evidence ID exists in the scenario", () => {
    for (const refs of Object.values(groups)) {
      for (const ref of refs) {
        const exists =
          ref.kind === "log" ? logsById.has(ref.logId) : requestsById.has(ref.requestId);
        assert.ok(exists, getEvidenceId(ref));
      }
    }
  });

  test("no evidence ID belongs to more than one observation", () => {
    const all = Object.values(groups).flatMap((refs) => refs.map(getEvidenceId));
    assert.equal(new Set(all).size, all.length);
  });

  test("the registry rejects unknown or shared evidence IDs", () => {
    assert.throws(
      () => buildKeyObservations([{ id: "a", refs: [net("req-99")] }], validationContext),
      /unknown evidence network:req-99/,
    );
    assert.throws(
      () =>
        buildKeyObservations(
          [
            { id: "a", refs: [log("log-06")] },
            { id: "b", refs: [log("log-06")] },
          ],
          validationContext,
        ),
      /log:log-06 is in both "a" and "b"/,
    );
  });
});

describe("key observation groups: members show the same thing", () => {
  test("signed-cookie-issued: each login response sets a signed sid cookie", () => {
    for (const id of requestIdsIn("signed-cookie-issued")) {
      const request = requestsById.get(id)!;
      assert.equal(`${request.method} ${request.path} ${request.status}`, "POST /api/auth/login 200", id);
      const setCookie = request.responseHeaders.find((header) => header.name === "Set-Cookie");
      assert.match(setCookie?.value ?? "", /^sid=s%3A/, id);
    }
  });

  test("cookie-sent-still-401: each protected request sends sid and gets 401", () => {
    const ids = requestIdsIn("cookie-sent-still-401");
    assert.deepEqual(ids, ["req-04", "req-05", "req-11", "req-12"]);
    for (const id of ids) {
      const request = requestsById.get(id)!;
      assert.equal(request.status, 401, id);
      assert.ok(["/api/profile", "/api/orders"].includes(request.path), id);
      const cookie = request.requestHeaders.find((header) => header.name === "Cookie");
      assert.match(cookie?.value ?? "", /^sid=s%3A/, id);
      assert.equal(request.responseBody, '{"error":"Unauthorized"}', id);
    }
  });

  test("auth-rejected: the rejection log for every grouped 401 request is in the group", () => {
    const rejectionLogs = new Set(logIdsIn("auth-rejected"));
    for (const id of requestIdsIn("cookie-sent-still-401")) {
      const request = requestsById.get(id)!;
      // The middleware's WARN line written just before the request's http line.
      const rejection = challenge001.logs
        .filter(
          (entry) =>
            entry.source === "auth" &&
            entry.message === `Unauthorized request path=${request.path}` &&
            entry.timestamp <= request.timestamp,
        )
        .at(-1)!;
      assert.ok(rejectionLogs.has(rejection.id), `${id} -> ${rejection.id}`);
    }
    assert.equal(rejectionLogs.size, 4);
  });

  test("login-succeeded: both attempts' successful-login logs", () => {
    for (const id of logIdsIn("login-succeeded")) {
      assert.match(logsById.get(id)!.message, /^Login succeeded user=u_1042$/, id);
    }
  });
});

describe("key observation coverage", () => {
  test("each equivalent evidence item covers its observation on its own", () => {
    for (const refs of Object.values(groups)) {
      for (const ref of refs) {
        assert.equal(coverageHint([ref]), covered(1), getEvidenceId(ref));
      }
    }
  });

  test("equivalent items for one observation count once", () => {
    assert.equal(coverageHint([net("req-04"), net("req-11")]), covered(1));
    assert.equal(
      coverageHint([net("req-04"), net("req-05"), net("req-11"), net("req-12")]),
      covered(1),
    );
    assert.equal(coverageHint([log("log-06"), log("log-17"), log("log-19")]), covered(1));
  });

  test("one item from each observation covers all four", () => {
    assert.equal(
      coverageHint([net("req-08"), net("req-12"), log("log-17"), log("log-13")]),
      covered(4),
    );
  });

  test("unrelated evidence covers nothing", () => {
    // Startup log, static asset, client-error beacon, login page reload, and the http access lines.
    assert.equal(
      coverageHint([log("log-01"), net("req-02"), net("req-06"), net("req-14"), log("log-07"), log("log-18")]),
      covered(0),
    );
  });

  test("unrelated evidence alongside key evidence does not inflate the count", () => {
    assert.equal(coverageHint([log("log-01"), net("req-11"), net("req-03")]), covered(1));
  });
});

describe("evidence collection to diagnosis feedback (req-11)", () => {
  test("collecting the second-attempt profile request yields 1 of 4", async () => {
    // Collect exactly as the UI does, including a duplicate add.
    let state = { evidence: [], hypotheses: [], observations: [], nextId: 1 } as Parameters<
      typeof investigationReducer
    >[0];
    state = investigationReducer(state, { type: "add-evidence", ref: net("req-11"), at: 1 });
    state = investigationReducer(state, { type: "add-evidence", ref: net("req-11"), at: 2 });
    assert.equal(state.evidence.length, 1);

    // Serialize exactly as WorkspaceClient/DiagnosisPanel do, then go through the handler.
    const { handler } = createTestHandler();
    const { response, json } = await post(handler, {
      body: submission({
        rootCauseId: CORRECT_ID,
        evidence: state.evidence.map((item) => item.ref),
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(json.status, "correct");
    const feedback = json.feedback as { hints: string[]; evidenceSummary: unknown };
    assert.equal(feedback.hints[0], covered(1));
    assert.deepEqual(feedback.evidenceSummary, { total: 1, logs: 0, network: 1 });
  });
});
