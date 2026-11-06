"use client";

import { useEffect, useState } from "react";
import { NOT_CONNECTED, type VerifiedState } from "@/lib/verified/model";
import { notConnectedSource, type VerifiedCompletionsSource } from "@/lib/verified/source";

/**
 * The learner's verified completions from `source`. The default source is not
 * connected: it answers "not-connected" at once and makes no request, which is
 * what production uses until a completions endpoint is mounted.
 */
export function useVerifiedCompletions(source: VerifiedCompletionsSource = notConnectedSource): VerifiedState {
  const [state, setState] = useState<VerifiedState>(() => (source.kind === "not-connected" ? NOT_CONNECTED : { status: "loading" }));
  useEffect(() => {
    if (source.kind === "not-connected") return;
    const controller = new AbortController();
    source.load(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setState(next);
      },
      () => {
        // Sources report failures as states; a rejection is the abort below (the
        // page moved on) or a source that broke its contract. Either way, show
        // browser progress rather than nothing.
        if (!controller.signal.aborted) setState({ status: "unavailable", reason: "invalid-response" });
      },
    );
    return () => controller.abort();
  }, [source]);
  return state;
}
