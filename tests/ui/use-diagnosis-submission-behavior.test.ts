/*
 * Behaviour of useDiagnosisSubmission through submit, abort, retry and unmount.
 *
 * The hook's real source runs here, but two of its imports are swapped by a hook
 * registered below, and only for that one file:
 *   - "react"                     -> tests/helpers/react-shim.ts (see that file for its limits)
 *   - "@/lib/diagnosis/client"    -> tests/helpers/client-double.ts (a controllable submitDiagnosis)
 * Nothing else in the process sees the substitution. This is a stand-in for a real
 * renderer, not a replacement: batching and StrictMode are not modelled.
 */
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, mock, test } from "node:test";
import type { SubmissionState } from "@/components/workspace/diagnosis/useDiagnosisSubmission";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";

// The project's @types/node predates module.registerHooks, which the Node 24 runtime
// (and tests/setup/register.mjs) already use. This is the part of it needed here.
interface ResolveContext {
  parentURL?: string;
}
interface ResolveResult {
  url: string;
  format?: string;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context: ResolveContext) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: ResolveContext, nextResolve: NextResolve) => ResolveResult;
  }) => unknown;
};

const shimUrl = new URL("../helpers/react-shim.ts", import.meta.url).href;
const doubleUrl = new URL("../helpers/client-double.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/useDiagnosisSubmission.ts")) {
      if (specifier === "react") return { url: shimUrl, format: "module-typescript", shortCircuit: true };
      if (specifier === "@/lib/diagnosis/client") {
        return { url: doubleUrl, format: "module-typescript", shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { renderHook } = (await import(shimUrl)) as typeof import("../helpers/react-shim");
const { setSubmitDiagnosis } = (await import(doubleUrl)) as typeof import("../helpers/client-double");
const { useDiagnosisSubmission } = await import("@/components/workspace/diagnosis/useDiagnosisSubmission");

// Neutral values: the hook only forwards the submission, and the client is a double.
const submission: DiagnosisSubmission = {
  rootCauseId: "example-root-cause",
  explanation: "An explanation that is long enough to pass validation on the server.",
  evidence: [{ kind: "network", requestId: "req-example" }],
};

const summary = { total: 1, logs: 0, network: 1 };

const correct: DiagnosisResponse = {
  status: "correct",
  feedback: { headline: "Confirmed.", hints: [], evidenceSummary: summary },
  resolution: { summary: "Resolved." },
  attempts: { used: 0, limit: 3, remaining: 3 },
};

const incorrect: DiagnosisResponse = {
  status: "incorrect",
  feedback: { headline: "Not quite.", hints: ["Look again."], evidenceSummary: summary },
  attempts: { used: 1, limit: 3, remaining: 2 },
};

const invalid: DiagnosisResponse = {
  status: "invalid",
  errors: [{ field: "explanation", message: "Explain your reasoning in more detail." }],
};

const serverError: DiagnosisResponse = { status: "error", message: "Try again later." };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Records every response the hook reports. */
function recorder() {
  const received: DiagnosisResponse[] = [];
  return { received, onResponse: (response: DiagnosisResponse) => received.push(response) };
}

function useUnderTest(onResponse?: (response: DiagnosisResponse) => void) {
  return useDiagnosisSubmission("challenge-001", onResponse);
}

type View = ReturnType<typeof renderHook<ReturnType<typeof useUnderTest>>>;

/**
 * The hook's current state. Read through a function so TypeScript does not carry an
 * earlier assertion's narrowing (for example "submitting") over to a later read.
 */
function stateOf(view: View): SubmissionState {
  return view.result.current.state;
}

/** A submitDiagnosis that stays pending until its signal aborts, then rejects like fetch. */
function waitsForAbort(onSignal?: (signal: AbortSignal) => void) {
  return (_id: string, _submission: DiagnosisSubmission, signal?: AbortSignal) =>
    new Promise<DiagnosisResponse>((_resolve, reject) => {
      if (signal) onSignal?.(signal);
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
}

afterEach(() => mock.restoreAll());

describe("useDiagnosisSubmission: states", () => {
  test("starts idle", () => {
    const view = renderHook(() => useUnderTest());

    assert.deepEqual(stateOf(view), { phase: "idle" });
  });

  test("submitting enters the submitting phase, then reports the response once, unchanged", async () => {
    const gate = deferred<DiagnosisResponse>();
    setSubmitDiagnosis(() => gate.promise);
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    const pending = view.result.current.submit(submission);
    assert.equal(stateOf(view).phase, "submitting");
    assert.equal(received.length, 0, "nothing is reported while the request is in flight");

    gate.resolve(correct);
    await pending;

    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.response === correct, "the state holds the same response object");
    assert.equal(received.length, 1);
    assert.equal(received[0], correct);
  });

  test("correct, incorrect, invalid and server-error responses are each stored and reported once, unchanged", async () => {
    for (const response of [correct, incorrect, invalid, serverError]) {
      setSubmitDiagnosis(async () => response);
      const { received, onResponse } = recorder();
      const view = renderHook(() => useUnderTest(onResponse));

      await view.result.current.submit(submission);

      const state = stateOf(view);
      assert.ok(state.phase === "done" && state.response === response, `${response.status}: stored unchanged`);
      assert.equal(state.phase === "done" && state.retryAt, undefined, `${response.status}: no retry time`);
      assert.deepEqual(received, [response], `${response.status}: reported exactly once`);
    }
  });

  test("a rate-limited response records when the learner may retry", async () => {
    mock.method(Date, "now", () => 1_000_000);
    setSubmitDiagnosis(async () => ({ status: "rate-limited", retryAfterSeconds: 60 }));
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    await view.result.current.submit(submission);

    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.retryAt === 1_000_000 + 60_000);
    assert.equal(received.length, 1);
  });

  test("reset returns to idle without reporting anything", async () => {
    setSubmitDiagnosis(async () => correct);
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));
    await view.result.current.submit(submission);

    view.result.current.reset();

    assert.deepEqual(stateOf(view), { phase: "idle" });
    assert.equal(received.length, 1, "reset did not report again");
  });
});

describe("useDiagnosisSubmission: duplicate and repeated submissions", () => {
  test("ignores a second submit while one is in flight", async () => {
    const gate = deferred<DiagnosisResponse>();
    const calls: DiagnosisSubmission[] = [];
    setSubmitDiagnosis((_id, sent) => {
      calls.push(sent);
      return gate.promise;
    });
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    const first = view.result.current.submit(submission);
    const second = view.result.current.submit(submission);
    gate.resolve(correct);
    await Promise.all([first, second]);

    assert.equal(calls.length, 1, "only one request was sent");
    assert.equal(received.length, 1, "only one response was reported");
  });

  test("allows a new submission once the previous one has finished", async () => {
    let calls = 0;
    setSubmitDiagnosis(async () => (++calls === 1 ? serverError : correct));
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    await view.result.current.submit(submission);
    await view.result.current.submit(submission);

    assert.equal(calls, 2);
    assert.deepEqual(received, [serverError, correct], "each response is reported exactly once");
  });

  test("retry does nothing before any submission", async () => {
    let calls = 0;
    setSubmitDiagnosis(async () => (++calls, correct));
    const view = renderHook(() => useUnderTest());

    view.result.current.retry();
    await flush();

    assert.equal(calls, 0);
    assert.deepEqual(stateOf(view), { phase: "idle" });
  });
});

describe("useDiagnosisSubmission: unmounting", () => {
  test("a genuine unmount aborts the request and updates or reports nothing afterwards", async () => {
    let seen: AbortSignal | undefined;
    setSubmitDiagnosis(waitsForAbort((signal) => (seen = signal)));
    const consoleError = mock.method(console, "error", () => {});
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    const pending = view.result.current.submit(submission);
    view.unmount();
    await pending;

    assert.equal(seen?.aborted, true, "the in-flight request was aborted");
    assert.equal(view.updatesAfterUnmount, 0, "no state update after unmount");
    assert.equal(received.length, 0, "nothing was reported after unmount");
    assert.equal(consoleError.mock.callCount(), 0, "an unmount abort is not logged as a failure");
  });

  test("a response that still arrives after unmount is neither stored nor reported", async () => {
    const gate = deferred<DiagnosisResponse>();
    setSubmitDiagnosis(() => gate.promise);
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    const pending = view.result.current.submit(submission);
    view.unmount();
    gate.resolve(serverError);
    await pending;

    assert.equal(view.updatesAfterUnmount, 0, "no state update after unmount");
    assert.deepEqual(received, [], "nothing was reported after unmount");
  });

  test("an unexpected error that arrives after unmount is not reported either", async () => {
    const gate = deferred<DiagnosisResponse>();
    setSubmitDiagnosis(() => gate.promise.then(() => Promise.reject(new TypeError("boom"))));
    mock.method(console, "error", () => {});
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    const pending = view.result.current.submit(submission);
    view.unmount();
    gate.resolve(correct);
    await pending;

    assert.equal(view.updatesAfterUnmount, 0, "no state update after unmount");
    assert.deepEqual(received, [], "nothing was reported after unmount");
  });
});

describe("useDiagnosisSubmission: failures that are not an unmount", () => {
  test("a non-abort exception ends the submission with a visible error and is logged", async () => {
    const failure = new TypeError("boom");
    setSubmitDiagnosis(async () => {
      throw failure;
    });
    const consoleError = mock.method(console, "error", () => {});
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    await view.result.current.submit(submission);

    const state = stateOf(view);
    assert.notEqual(state.phase, "submitting", "the hook must not stay stuck in submitting");
    assert.ok(state.phase === "done" && state.response.status === "error");
    assert.equal(received.length, 1, "the failure is reported once, as an error response");
    assert.equal(received[0].status, "error");
    assert.equal(consoleError.mock.callCount(), 1, "the exception is not swallowed silently");
    assert.equal(consoleError.mock.calls[0].arguments.at(-1), failure);
  });

  test("an AbortError that did not come from unmounting is treated as a failure", async () => {
    setSubmitDiagnosis(async () => {
      throw new DOMException("aborted by something else", "AbortError");
    });
    mock.method(console, "error", () => {});
    const view = renderHook(() => useUnderTest());

    await view.result.current.submit(submission);

    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.response.status === "error");
  });

  test("the error response has a message the form can show, and is not a rate limit", async () => {
    setSubmitDiagnosis(async () => {
      throw new TypeError("boom");
    });
    mock.method(console, "error", () => {});
    const view = renderHook(() => useUnderTest());

    await view.result.current.submit(submission);

    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.response.status === "error" && state.response.message.length > 0);
    assert.equal(state.phase === "done" && state.retryAt, undefined);
  });

  test("the learner can submit again straight after a failure, so the form is not locked", async () => {
    let calls = 0;
    setSubmitDiagnosis(async () => {
      if (++calls === 1) throw new TypeError("boom");
      return correct;
    });
    mock.method(console, "error", () => {});
    const view = renderHook(() => useUnderTest());

    await view.result.current.submit(submission);
    await view.result.current.submit(submission);

    assert.equal(calls, 2, "the second submit was not ignored as 'already in flight'");
    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.response === correct);
  });

  test("the learner can retry after a recoverable failure, with the same submission", async () => {
    const sent: DiagnosisSubmission[] = [];
    let calls = 0;
    setSubmitDiagnosis(async (_id, body) => {
      sent.push(body);
      if (++calls === 1) throw new TypeError("boom");
      return correct;
    });
    mock.method(console, "error", () => {});
    const { received, onResponse } = recorder();
    const view = renderHook(() => useUnderTest(onResponse));

    await view.result.current.submit(submission);
    assert.equal(stateOf(view).phase, "done", "the failure ended the first attempt");

    view.result.current.retry();
    await flush();

    const state = stateOf(view);
    assert.ok(state.phase === "done" && state.response === correct);
    assert.equal(sent.length, 2);
    assert.equal(sent[0], submission);
    assert.equal(sent[1], submission, "retry re-sends the same submission");
    assert.deepEqual(
      received.map((response) => response.status),
      ["error", "correct"],
      "each attempt is reported exactly once",
    );
  });
});
