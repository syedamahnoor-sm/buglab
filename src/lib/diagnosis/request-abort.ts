/*
 * The abort signal for one diagnosis request. It ends when the caller aborts or
 * when the timeout elapses, whichever happens first.
 *
 * It is built from AbortController, a timer and an event listener, which every
 * browser that can cancel a fetch has. AbortSignal.timeout and AbortSignal.any are
 * deliberately not used: older browsers lack them, and a native timeout cannot be
 * cleared, so a finished request would leave its timer behind. Here one code path
 * serves every browser, and dispose() releases the timer and the listener.
 */

/** The browser has no AbortController, so a request could be neither cancelled nor timed out. */
export class UnsupportedBrowserError extends Error {}

export interface RequestAbort {
  /** Pass this to fetch. It aborts on the caller's abort or on the timeout. */
  readonly signal: AbortSignal;
  /** True once the timeout, rather than the caller, ended the request. */
  timedOut(): boolean;
  /** Clears the timer and removes the listener. Safe to call more than once. */
  dispose(): void;
}

/**
 * The error for a caller signal that is already aborted: its own reason, or an
 * AbortError where the browser has no `reason`.
 */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Throws UnsupportedBrowserError without AbortController, and the caller signal's
 * abort error if it is already aborted. Otherwise the timer and listener it sets up
 * are released by dispose(), and also as soon as the request is aborted or times out.
 */
export function createRequestAbort(timeoutMs: number, callerSignal?: AbortSignal): RequestAbort {
  if (typeof AbortController !== "function") throw new UnsupportedBrowserError();
  if (callerSignal?.aborted) throw abortError(callerSignal);

  const controller = new AbortController();
  let timedOut = false;

  function dispose() {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  function onCallerAbort() {
    controller.abort(callerSignal?.reason);
    dispose();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    dispose();
  }, timeoutMs);
  callerSignal?.addEventListener("abort", onCallerAbort);

  return { signal: controller.signal, timedOut: () => timedOut, dispose };
}
