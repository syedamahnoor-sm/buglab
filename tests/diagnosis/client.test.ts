import assert from "node:assert/strict";
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

const abortSignalApis = AbortSignal as unknown as Record<string, unknown>;

/** Runs `run` with one AbortSignal static removed, as in a browser that lacks it. */
async function withoutAbortSignalApi(name: "timeout" | "any", run: () => Promise<void>) {
  const saved = abortSignalApis[name];
  delete abortSignalApis[name];
  try {
    await run();
  } finally {
    abortSignalApis[name] = saved;
  }
}

afterEach(() => mock.restoreAll());

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

  test("arms a 15 second timeout, and still sends the request, when the caller passes a signal", async () => {
    const timeoutCalls: unknown[] = [];
    const realTimeout = abortSignalApis.timeout as (ms: number) => AbortSignal;
    abortSignalApis.timeout = (ms: number) => {
      timeoutCalls.push(ms);
      return realTimeout.call(AbortSignal, ms);
    };
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));
    try {
      await submitDiagnosis("challenge-001", submission, new AbortController().signal);
    } finally {
      abortSignalApis.timeout = realTimeout;
    }

    assert.deepEqual(timeoutCalls, [15_000]);
    assert.equal(fetchMock.mock.callCount(), 1);
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

describe("submitDiagnosis: aborting and timing out", () => {
  test("rethrows a genuine abort instead of reporting an error result", async () => {
    fetchThatWaitsForAbort();
    const controller = new AbortController();

    const pending = submitDiagnosis("challenge-001", submission, controller.signal);
    controller.abort();

    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
  });

  test("reports a timeout as its own error result", async () => {
    fetchThatWaitsForAbort();
    const timeoutController = new AbortController();
    const realTimeout = abortSignalApis.timeout;
    abortSignalApis.timeout = () => timeoutController.signal;
    try {
      const pending = submitDiagnosis("challenge-001", submission, new AbortController().signal);
      timeoutController.abort(new DOMException("timed out", "TimeoutError"));

      assert.deepEqual(await pending, { status: "error", message: "The server took too long to respond." });
    } finally {
      abortSignalApis.timeout = realTimeout;
    }
  });

  test("reports a timeout the same way when the caller passes no signal", async () => {
    fetchThatWaitsForAbort();
    const timeoutController = new AbortController();
    const realTimeout = abortSignalApis.timeout;
    abortSignalApis.timeout = () => timeoutController.signal;
    try {
      const pending = submitDiagnosis("challenge-001", submission);
      timeoutController.abort(new DOMException("timed out", "TimeoutError"));

      assert.deepEqual(await pending, { status: "error", message: "The server took too long to respond." });
    } finally {
      abortSignalApis.timeout = realTimeout;
    }
  });
});

describe("submitDiagnosis: browsers without the AbortSignal APIs", () => {
  test("AbortSignal.timeout missing: returns an error result instead of throwing a TypeError", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));

    await withoutAbortSignalApi("timeout", async () => {
      const result = await submitDiagnosis("challenge-001", submission, new AbortController().signal);

      assert.equal(result.status, "error");
      assert.ok(result.status === "error" && result.message.length > 0, "the error result carries a message");
    });
    assert.equal(fetchMock.mock.callCount(), 0, "no request is sent without timeout protection");
  });

  test("AbortSignal.timeout missing and no caller signal: still an error result, still no request", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));

    await withoutAbortSignalApi("timeout", async () => {
      const result = await submitDiagnosis("challenge-001", submission);

      assert.equal(result.status, "error");
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test("AbortSignal.any missing: returns an error result instead of throwing a TypeError", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(incorrect));

    await withoutAbortSignalApi("any", async () => {
      const result = await submitDiagnosis("challenge-001", submission, new AbortController().signal);

      assert.equal(result.status, "error");
      assert.ok(result.status === "error" && result.message.length > 0, "the error result carries a message");
    });
    assert.equal(fetchMock.mock.callCount(), 0, "no request is sent without abort support");
  });

  test("the unsupported-browser result explains what to do, and is the same for both missing APIs", async () => {
    const results: DiagnosisResponse[] = [];
    await withoutAbortSignalApi("timeout", async () => {
      results.push(await submitDiagnosis("challenge-001", submission, new AbortController().signal));
    });
    await withoutAbortSignalApi("any", async () => {
      results.push(await submitDiagnosis("challenge-001", submission, new AbortController().signal));
    });

    assert.deepEqual(results[0], results[1]);
    assert.ok(results[0].status === "error" && /browser/i.test(results[0].message));
  });

  test("AbortSignal.any is not needed, and not required, when the caller passes no signal", async () => {
    mock.method(globalThis, "fetch", async () => json(incorrect));

    await withoutAbortSignalApi("any", async () => {
      assert.deepEqual(await submitDiagnosis("challenge-001", submission), incorrect);
    });
  });

  test("restores the AbortSignal APIs after the checks above", () => {
    assert.equal(typeof AbortSignal.timeout, "function");
    assert.equal(typeof AbortSignal.any, "function");
  });
});
