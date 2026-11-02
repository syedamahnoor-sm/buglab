import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { afterEach, describe, mock, test } from "node:test";
import { submitDiagnosis } from "@/lib/diagnosis/client";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";

// Neutral values: submitDiagnosis never inspects them and fetch is always mocked.
const submission: DiagnosisSubmission = {
  rootCauseId: "example-root-cause",
  explanation: "An explanation that is long enough to pass validation on the server.",
  evidence: [{ kind: "network", requestId: "req-example" }],
};

const incorrect: DiagnosisResponse = {
  status: "incorrect",
  feedback: { headline: "Not quite.", hints: ["Look again."], evidenceSummary: { total: 1, logs: 0, network: 1 } },
  attempts: { used: 1, limit: 3, remaining: 2 },
};

const correct: DiagnosisResponse = {
  status: "correct",
  feedback: { headline: "Confirmed.", hints: [], evidenceSummary: { total: 1, logs: 0, network: 1 } },
  resolution: { summary: "Resolved." },
  attempts: { used: 0, limit: 3, remaining: 3 },
};

const rateLimited: DiagnosisResponse = { status: "rate-limited", retryAfterSeconds: 60 };

const TIMED_OUT = { status: "error", message: "The server took too long to respond." } as const;
const UNSUPPORTED = {
  status: "error",
  message: "This browser is too old to submit a diagnosis. Please update it and try again.",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that settles only when its signal aborts, rejecting with the signal's reason. */
function fetchThatWaitsForAbort() {
  return mock.method(
    globalThis,
    "fetch",
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
}

/**
 * A scheduler the test controls, in place of the real setTimeout and clearTimeout.
 * No test waits in real time, and a timer left behind is visible as `pending`.
 */
function installFakeTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  const requested: number[] = [];
  let nextId = 1;

  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    const id = nextId++;
    pending.set(id, callback);
    requested.push(ms ?? 0);
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    pending.delete(id);
  }) as unknown as typeof clearTimeout;

  return {
    /** How many timers are scheduled and neither cleared nor fired. */
    get pending() {
      return pending.size;
    },
    /** The delay of every timer ever scheduled, in order. */
    requested,
    /** Fires the oldest scheduled timer, as if its delay had elapsed. */
    fire() {
      const [id, callback] = [...pending.entries()][0] ?? [];
      assert.ok(id !== undefined && callback, "there is no timer to fire");
      pending.delete(id);
      callback();
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

let fakeTimers: ReturnType<typeof installFakeTimers> | undefined;

function timers() {
  fakeTimers ??= installFakeTimers();
  return fakeTimers;
}

const listenersOn = (signal: AbortSignal) => getEventListeners(signal, "abort").length;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Statics = Record<string, unknown>;
const abortSignalStatics = AbortSignal as unknown as Statics;
const globals = globalThis as unknown as Statics;

/** Runs `run` with some browser primitives removed, as in an older browser. */
async function withoutPrimitives(
  missing: { signalStatics?: Array<"timeout" | "any">; globals?: string[] },
  run: () => Promise<void>,
) {
  const savedStatics = (missing.signalStatics ?? []).map((name) => [name, abortSignalStatics[name]] as const);
  const savedGlobals = (missing.globals ?? []).map((name) => [name, globals[name]] as const);
  for (const [name] of savedStatics) delete abortSignalStatics[name];
  for (const [name] of savedGlobals) delete globals[name];
  try {
    await run();
  } finally {
    for (const [name, value] of savedStatics) abortSignalStatics[name] = value;
    for (const [name, value] of savedGlobals) globals[name] = value;
  }
}

afterEach(() => {
  mock.restoreAll();
  fakeTimers?.restore();
  fakeTimers = undefined;
});

describe("submitDiagnosis: requests", () => {
  test("posts the submission as JSON to the challenge's diagnosis endpoint", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));

    await submitDiagnosis("challenge-001", submission);

    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
    assert.equal(url, "/api/challenges/challenge-001/diagnosis");
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { "Content-Type": "application/json" });
    assert.equal(init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(init.body as string), submission);
    assert.ok(init.signal instanceof AbortSignal, "the request carries an abort signal");
  });

  test("encodes the challenge id in the path", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));

    await submitDiagnosis("a b/c", submission);

    assert.equal(fetchMock.mock.calls[0].arguments[0], "/api/challenges/a%20b%2Fc/diagnosis");
  });

  test("arms one 15 second timeout per request, with or without a caller signal", async () => {
    const clock = timers();
    mock.method(globalThis, "fetch", async () => json(incorrect));

    await submitDiagnosis("challenge-001", submission);
    await submitDiagnosis("challenge-001", submission, new AbortController().signal);

    assert.deepEqual(clock.requested, [15_000, 15_000]);
  });

  test("gives fetch its own signal, so aborting the request never aborts the caller's signal", async () => {
    const clock = timers();
    const fetchMock = fetchThatWaitsForAbort();
    const caller = new AbortController();

    const pending = submitDiagnosis("challenge-001", submission, caller.signal);
    clock.fire();
    await pending;

    const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
    assert.notEqual(init.signal, caller.signal);
    assert.equal(init.signal?.aborted, true);
    assert.equal(caller.signal.aborted, false);
  });
});

describe("submitDiagnosis: responses", () => {
  test("returns a correct response unchanged", async () => {
    mock.method(globalThis, "fetch", async () => json(correct));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), correct);
  });

  test("returns an incorrect response unchanged", async () => {
    mock.method(globalThis, "fetch", async () => json(incorrect));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), incorrect);
  });

  test("passes a rate-limited body through unchanged, whatever the HTTP status", async () => {
    mock.method(globalThis, "fetch", async () => json(rateLimited, 429));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), rateLimited);
  });

  test("passes a server error body through unchanged", async () => {
    const serverError: DiagnosisResponse = { status: "error", message: "The diagnosis could not be evaluated." };
    mock.method(globalThis, "fetch", async () => json(serverError, 500));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), serverError);
  });

  test("turns a network failure into the documented error result", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), {
      status: "error",
      message: "Couldn't reach the server. Check your connection.",
    });
  });

  test("turns a non-JSON error page into an unexpected-response error", async () => {
    mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), {
      status: "error",
      message: "Unexpected response from the server (502).",
    });
  });

  test("does not trust a body that only has a matching status: { status: 'correct' } is an error", async () => {
    mock.method(globalThis, "fetch", async () => json({ status: "correct" }));

    assert.deepEqual(await submitDiagnosis("challenge-001", submission), {
      status: "error",
      message: "Unexpected response from the server (200).",
    });
  });

  test("turns JSON that is not a response object into an unexpected-response error", async () => {
    for (const body of [null, [], "correct", 42, { status: "unknown" }]) {
      mock.restoreAll();
      mock.method(globalThis, "fetch", async () => json(body));

      assert.deepEqual(
        await submitDiagnosis("challenge-001", submission),
        { status: "error", message: "Unexpected response from the server (200)." },
        `body ${JSON.stringify(body)}`,
      );
    }
  });
});

// The same behaviour must hold whichever of the two static methods the browser has.
const environments: Array<{ name: string; missing: Array<"timeout" | "any"> }> = [
  { name: "a browser with AbortSignal.any and AbortSignal.timeout", missing: [] },
  { name: "a browser without AbortSignal.any", missing: ["any"] },
  { name: "a browser without AbortSignal.timeout", missing: ["timeout"] },
  { name: "a browser with neither AbortSignal.any nor AbortSignal.timeout", missing: ["any", "timeout"] },
];

for (const environment of environments) {
  describe(`submitDiagnosis in ${environment.name}`, () => {
    const inEnvironment = (run: () => Promise<void>) => withoutPrimitives({ signalStatics: environment.missing }, run);

    test("returns the server's response", () =>
      inEnvironment(async () => {
        timers();
        mock.method(globalThis, "fetch", async () => json(incorrect));

        assert.deepEqual(await submitDiagnosis("challenge-001", submission), incorrect);
        assert.deepEqual(await submitDiagnosis("challenge-001", submission, new AbortController().signal), incorrect);
      }));

    test("a caller abort while the request is pending rejects with an AbortError", () =>
      inEnvironment(async () => {
        timers();
        const fetchMock = fetchThatWaitsForAbort();
        const caller = new AbortController();

        const pending = submitDiagnosis("challenge-001", submission, caller.signal);
        caller.abort();

        await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.equal(init.signal?.aborted, true, "the request itself was cancelled");
      }));

    test("a timeout while the request is pending is reported as its own error result", () =>
      inEnvironment(async () => {
        const clock = timers();
        fetchThatWaitsForAbort();

        const pending = submitDiagnosis("challenge-001", submission, new AbortController().signal);
        clock.fire();

        assert.deepEqual(await pending, TIMED_OUT);
      }));

    test("a timeout is reported the same way when the caller passes no signal", () =>
      inEnvironment(async () => {
        const clock = timers();
        fetchThatWaitsForAbort();

        const pending = submitDiagnosis("challenge-001", submission);
        clock.fire();

        assert.deepEqual(await pending, TIMED_OUT);
      }));

    test("an already-aborted caller signal rejects at once, without sending a request or arming a timer", () =>
      inEnvironment(async () => {
        const clock = timers();
        const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));
        const caller = new AbortController();
        caller.abort();

        await assert.rejects(
          submitDiagnosis("challenge-001", submission, caller.signal),
          (error: unknown) => error instanceof Error && error.name === "AbortError",
        );

        assert.equal(fetchMock.mock.callCount(), 0);
        assert.equal(clock.pending, 0);
        assert.equal(listenersOn(caller.signal), 0);
      }));
  });
}

describe("submitDiagnosis: the caller's signal", () => {
  test("an already-aborted signal rejects with that signal's own reason", async () => {
    timers();
    mock.method(globalThis, "fetch", async () => json(incorrect));
    const caller = new AbortController();
    const reason = new Error("the learner navigated away");
    caller.abort(reason);

    await assert.rejects(submitDiagnosis("challenge-001", submission, caller.signal), (error: unknown) => error === reason);
  });

  test("without a reason on the signal (an older browser), the rejection is still an AbortError", async () => {
    timers();
    mock.method(globalThis, "fetch", async () => json(incorrect));
    const bare = { aborted: true, addEventListener() {}, removeEventListener() {} } as unknown as AbortSignal;

    await assert.rejects(
      submitDiagnosis("challenge-001", submission, bare),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });

  test("forwards the caller's reason to the request when it aborts mid-flight", async () => {
    timers();
    const fetchMock = fetchThatWaitsForAbort();
    const caller = new AbortController();
    const reason = new Error("cancelled by the form");

    const pending = submitDiagnosis("challenge-001", submission, caller.signal);
    caller.abort(reason);

    await assert.rejects(pending, (error: unknown) => error === reason);
    assert.equal((fetchMock.mock.calls[0].arguments[1] as RequestInit).signal?.reason, reason);
  });

  test("aborting the caller's signal after the request has finished does nothing", async () => {
    timers();
    mock.method(globalThis, "fetch", async () => json(correct));
    const caller = new AbortController();

    assert.deepEqual(await submitDiagnosis("challenge-001", submission, caller.signal), correct);

    assert.doesNotThrow(() => caller.abort());
    assert.equal(listenersOn(caller.signal), 0);
  });
});

describe("submitDiagnosis: cleaning up timers and listeners", () => {
  test("while a request is pending it holds exactly one timer and one listener", async () => {
    const clock = timers();
    const gate = deferred<Response>();
    mock.method(globalThis, "fetch", () => gate.promise);
    const caller = new AbortController();

    const pending = submitDiagnosis("challenge-001", submission, caller.signal);

    assert.equal(clock.pending, 1);
    assert.equal(listenersOn(caller.signal), 1);
    gate.resolve(json(correct));
    await pending;
  });

  test("a successful request releases both", async () => {
    const clock = timers();
    mock.method(globalThis, "fetch", async () => json(correct));
    const caller = new AbortController();

    await submitDiagnosis("challenge-001", submission, caller.signal);

    assert.equal(clock.pending, 0, "the timeout timer was cleared");
    assert.equal(listenersOn(caller.signal), 0, "the abort listener was removed");
  });

  test("a failed request (network error) releases both", async () => {
    const clock = timers();
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const caller = new AbortController();

    await submitDiagnosis("challenge-001", submission, caller.signal);

    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });

  test("a malformed or non-JSON response releases both", async () => {
    const clock = timers();
    const caller = new AbortController();
    mock.method(globalThis, "fetch", async () => new Response("<html>", { status: 502 }));
    await submitDiagnosis("challenge-001", submission, caller.signal);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => json({ status: "correct" }));
    await submitDiagnosis("challenge-001", submission, caller.signal);

    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });

  test("a timeout releases both, straight away and again once the request settles", async () => {
    const clock = timers();
    fetchThatWaitsForAbort();
    const caller = new AbortController();

    const pending = submitDiagnosis("challenge-001", submission, caller.signal);
    clock.fire();
    assert.equal(listenersOn(caller.signal), 0, "the listener is gone as soon as the timeout fires");
    await pending;

    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });

  test("a caller abort clears the timer straight away and leaves no listener", async () => {
    const clock = timers();
    fetchThatWaitsForAbort();
    const caller = new AbortController();

    const pending = submitDiagnosis("challenge-001", submission, caller.signal);
    caller.abort();
    assert.equal(clock.pending, 0, "no timer is left to fire after the caller has cancelled");
    await assert.rejects(pending);

    assert.equal(listenersOn(caller.signal), 0);
  });

  test("an already-aborted signal leaves nothing behind", async () => {
    const clock = timers();
    const caller = new AbortController();
    caller.abort();

    await assert.rejects(submitDiagnosis("challenge-001", submission, caller.signal));

    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });

  test("repeated submissions on one signal never accumulate listeners or timers", async () => {
    const clock = timers();
    const caller = new AbortController();
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      if (++calls % 3 === 0) throw new TypeError("fetch failed");
      return json(calls % 3 === 1 ? correct : { status: "correct" });
    });

    for (let i = 0; i < 60; i++) {
      await submitDiagnosis("challenge-001", submission, caller.signal);
      assert.equal(listenersOn(caller.signal), 0, `listeners after submission ${i + 1}`);
      assert.equal(clock.pending, 0, `timers after submission ${i + 1}`);
    }
    assert.equal(clock.requested.length, 60);
  });

  test("overlapping submissions each hold their own timer and listener, and release them all", async () => {
    const clock = timers();
    const caller = new AbortController();
    const gates = Array.from({ length: 5 }, () => deferred<Response>());
    let index = 0;
    mock.method(globalThis, "fetch", () => gates[index++].promise);

    const pending = gates.map(() => submitDiagnosis("challenge-001", submission, caller.signal));
    assert.equal(clock.pending, 5);
    assert.equal(listenersOn(caller.signal), 5);

    for (const gate of gates) gate.resolve(json(incorrect));
    await Promise.all(pending);

    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });
});

describe("submitDiagnosis: how the signals are built", () => {
  test("it does not depend on AbortSignal.timeout or AbortSignal.any, even where they exist", async () => {
    timers();
    mock.method(globalThis, "fetch", async () => json(incorrect));
    const timeout = mock.method(AbortSignal, "timeout");
    const any = mock.method(AbortSignal, "any");

    await submitDiagnosis("challenge-001", submission, new AbortController().signal);

    assert.equal(timeout.mock.callCount(), 0);
    assert.equal(any.mock.callCount(), 0);
  });
});

describe("submitDiagnosis: browsers without AbortController", () => {
  test("returns a clear error result instead of throwing, and sends no request", async () => {
    const clock = timers();
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));
    const caller = new AbortController();

    await withoutPrimitives({ globals: ["AbortController"] }, async () => {
      assert.deepEqual(await submitDiagnosis("challenge-001", submission, caller.signal), UNSUPPORTED);
      assert.deepEqual(await submitDiagnosis("challenge-001", submission), UNSUPPORTED);
    });

    assert.equal(fetchMock.mock.callCount(), 0, "no request is sent without a way to time it out");
    assert.equal(clock.pending, 0);
    assert.equal(listenersOn(caller.signal), 0);
  });

  test("the unsupported-browser error is not reported for a browser that only lacks the static methods", async () => {
    timers();
    mock.method(globalThis, "fetch", async () => json(incorrect));

    await withoutPrimitives({ signalStatics: ["any", "timeout"] }, async () => {
      assert.deepEqual(await submitDiagnosis("challenge-001", submission, new AbortController().signal), incorrect);
    });
  });
});

describe("submitDiagnosis: test environment", () => {
  test("restores the browser primitives that the checks above removed", () => {
    assert.equal(typeof AbortSignal.timeout, "function");
    assert.equal(typeof AbortSignal.any, "function");
    assert.equal(typeof AbortController, "function");
    assert.equal(typeof setTimeout, "function");
  });
});
