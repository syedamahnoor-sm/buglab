"use client";

import { useEffect, useMemo, useState } from "react";
import { useLearning } from "@/components/journal/useLearning";
import { useToday } from "@/components/journal/useToday";
import { projectBrowserSignals } from "@/lib/recommendations/adapters/browser";
import { loadRecommendations } from "@/lib/recommendations/client";
import { DEFAULT_PREFERENCES, NO_LOCAL_SIGNALS, type Preferences, type RecommendationPlan, type RecommendationRequest } from "@/lib/recommendations/types";
import { LearningPathView, type PathViewState } from "./LearningPathView";

/** Consume existing hooks read-only. No LearningActions, second progress store, auth or account linking. */
export function LearningPathScreen({ publishedIds }: { publishedIds: readonly string[] }) {
  const { state } = useLearning();
  const today = useToday();
  const allowedIds = useMemo(() => new Set(publishedIds),[publishedIds]);
  const [preferences,setPreferences] = useState<Preferences>({ ...DEFAULT_PREFERENCES });
  const [retry,setRetry] = useState(0);
  const [result,setResult] = useState<{ key: string; plan: RecommendationPlan | null } | null>(null);
  const request = useMemo<RecommendationRequest | null>(() => {
    if (state.status === "loading" || today === null) return null;
    const status = state.status === "unavailable" ? "unavailable" : state.problems.length || state.recoveryKeys.length ? "partial" : "ready";
    return { version: 1, today, preferences, local: preferences.useLocalSignals ? projectBrowserSignals(state.record,today,status,allowedIds) : NO_LOCAL_SIGNALS };
  },[state,today,preferences,allowedIds]);
  const key = request ? `${JSON.stringify(request)}|${retry}` : "loading";
  useEffect(() => {
    if (!request) return;
    let disposed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    loadRecommendations(request,controller.signal).then(
      (plan) => { if (!disposed) setResult({ key,plan }); },
      () => { if (!disposed) setResult({ key,plan: null }); },
    ).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  },[request,key]);
  const view: PathViewState = !request || !result || result.key !== key ? { status: "loading" }
    : result.plan ? { status: "ready",plan: result.plan } : { status: "error" };
  return <LearningPathView state={view} preferences={preferences} onPreferences={setPreferences} onRetry={() => setRetry((value) => value+1)} catalogCount={publishedIds.length} />;
}