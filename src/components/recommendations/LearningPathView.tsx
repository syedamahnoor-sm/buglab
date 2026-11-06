"use client";

import Link from "next/link";
import { useId } from "react";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, ClockIcon, SlidersIcon } from "@/components/ui/icons";
import { difficultyDisplay } from "@/components/challenge/difficulty";
import { CATEGORIES, categoryLabel } from "@/data/catalog/categories";
import { challengePath, journalSection, ROUTES } from "@/lib/challenge-routes";
import { explainReason } from "@/lib/recommendations/reasons";
import type { ChallengeRecommendation, Notice, Preferences, RecommendationPlan } from "@/lib/recommendations/types";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const card = "rounded-2xl border border-card-border bg-card shadow-card";
const quietLink = `inline-flex items-center gap-2 rounded-lg text-sm font-medium text-accent hover:underline underline-offset-4 ${focus}`;
const select = `mt-2 h-11 w-full min-w-0 rounded-xl border border-border-strong bg-field px-3 text-sm text-foreground ${focus}`;
export type PathViewState = { status: "loading" } | { status: "error" } | { status: "ready"; plan: RecommendationPlan };
interface ViewProps {
  state: PathViewState;
  preferences: Preferences;
  onPreferences: (value: Preferences) => void;
  onRetry: () => void;
  catalogCount: number;
}

function ReasonList({ item }: { item: ChallengeRecommendation }) {
  return (
    <details className="group mt-4 border-t border-card-border pt-3">
      <summary className={`w-fit cursor-pointer rounded text-sm font-medium text-accent ${focus}`}>Why this suggestion?</summary>
      <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-muted">
        {item.reasons.map((reason) => <li key={reason.code} className="list-disc marker:text-accent">{explainReason(reason,item)}</li>)}
      </ul>
    </details>
  );
}
function Metadata({ item }: { item: ChallengeRecommendation }) {
  const d = difficultyDisplay[item.challenge.difficulty];
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Badge tone={d.tone}>{d.label}</Badge><span className="inline-flex items-center gap-1"><ClockIcon width={14} height={14} />~{item.challenge.estimatedMinutes} min</span><span aria-hidden="true">·</span><span>{categoryLabel(item.challenge.category)}</span></div>;
}
function NextChallenge({ item }: { item: ChallengeRecommendation }) {
  const id = useId();
  const lead = item.reasons.find((reason) => reason.code === "goal-match" || reason.code === "practice-request" || reason.code === "starting-point") ?? item.reasons[0];
  return (
    <section aria-labelledby={id} className={`${card} relative overflow-hidden border-accent/35 p-6 sm:p-8`} style={{ backgroundImage: "radial-gradient(ellipse at 100% 0%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 65%)" }}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Next investigation</p><span className="font-mono text-xs text-subtle">CASE {item.challenge.number}</span></div>
      <Metadata item={item} />
      <h2 id={id} className="mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{item.challenge.title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{item.challenge.description}</p>
      {lead && <p className="mt-5 border-l-2 border-accent/60 pl-3 text-sm leading-relaxed text-foreground">{explainReason(lead,item)}</p>}
      <Link href={challengePath(item.challenge.id)} className={`mt-6 inline-flex min-h-11 items-center justify-center gap-3 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-accent/90 ${focus}`}>Open investigation<ArrowRightIcon /></Link>
      <ReasonList item={item} />
    </section>
  );
}
function PreferencesForm({ preferences: p, onPreferences }: Pick<ViewProps,"preferences"|"onPreferences">) {
  const id = useId();
  return (
    <form aria-labelledby={`${id}-heading`} onSubmit={(event) => event.preventDefault()} className={`${card} p-5 sm:p-6`}>
      <div className="flex items-center gap-2"><SlidersIcon className="text-accent" /><h2 id={`${id}-heading`} className="text-base font-semibold">Shape your practice</h2></div>
      <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted">Optional preferences, kept only on this page. Time is an estimate, not a strict filter.</p>
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium" htmlFor={`${id}-focus`}>Focus area<select id={`${id}-focus`} className={select} value={p.category ?? ""} onChange={(e) => onPreferences({ ...p, category: (e.target.value || null) as Preferences["category"] })}><option value="">Explore all areas</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium" htmlFor={`${id}-difficulty`}>Difficulty<select id={`${id}-difficulty`} className={select} value={p.difficulty ?? ""} onChange={(e) => onPreferences({ ...p, difficulty: (e.target.value || null) as Preferences["difficulty"] })}><option value="">Conservative starting level</option>{Object.entries(difficultyDisplay).map(([key,d]) => <option key={key} value={key}>{d.label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium" htmlFor={`${id}-time`}>Time available<select id={`${id}-time`} className={select} value={p.minutes ?? ""} aria-describedby={`${id}-help`} onChange={(e) => onPreferences({ ...p, minutes: e.target.value ? Number(e.target.value) : null })}><option value="">No time preference</option>{[15,20,30,45,60].map((n) => <option key={n} value={n}>About {n} minutes</option>)}</select></label>
      </div>
      <div className="mt-5 grid gap-4 border-t border-card-border pt-4 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className={`mt-0.5 size-4 shrink-0 accent-accent ${focus}`} checked={p.allowStretch} onChange={(e) => onPreferences({ ...p, allowStretch: e.target.checked })} /><span><span className="font-medium">Include an optional stretch</span><span className="mt-1 block text-xs leading-relaxed text-muted">Allow one tier above your range. This is not a proficiency assessment.</span></span></label>
        <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className={`mt-0.5 size-4 shrink-0 accent-accent ${focus}`} checked={p.useLocalSignals} onChange={(e) => onPreferences({ ...p, useLocalSignals: e.target.checked })} /><span><span className="font-medium">Use activity from this browser</span><span className="mt-1 block text-xs leading-relaxed text-muted">Only challenge activity and review dates are used. Your journal writing stays private.</span></span></label>
      </div>
    </form>
  );
}
const NOTICE_COPY: Record<Notice,string> = {
  "completion-history-unavailable": "Verified completion history is not available. Suggestions use the catalog and any enabled browser activity; a challenge may already be completed elsewhere.",
  "partial-verified-history": "Only part of your verified history is available. Known verified completions remain excluded; other suggestions may have been completed elsewhere.",
  "local-data-unavailable": "Browser activity is unavailable. You can still explore catalog suggestions; local solves and recalls are not being used.",
  "partial-local-data": "Some saved browser activity could not be read. Only valid entries are used. The Journal has recovery information.",
};
export function LearningPathView({ state, preferences, onPreferences, onRetry, catalogCount }: ViewProps) {
  const id = useId();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-9 sm:gap-9 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl"><p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Your learning path</p><h1 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">Make your next<br className="hidden sm:block" /> investigation count.</h1><p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">A clear next step, a little focused practice, and a reminder of what is worth remembering. Every suggestion comes with a reason.</p></div>
        <p className="w-fit rounded-full border border-border bg-panel px-4 py-2 font-mono text-xs text-muted">{catalogCount} published investigations · 6 practice areas</p>
      </header>
      <PreferencesForm preferences={preferences} onPreferences={onPreferences} />
      {state.status === "loading" ? <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><p role="status" className="sr-only">Loading your learning path…</p><div aria-hidden="true" className={`${card} h-96 animate-pulse motion-reduce:animate-none`} /><div aria-hidden="true" className={`${card} h-64 animate-pulse motion-reduce:animate-none`} /></div>
      : state.status === "error" ? <section role="alert" className={`${card} p-6 sm:p-8`}><h2 className="text-xl font-semibold">Your suggestions could not be refreshed</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Your learning record has not changed. Try again, or choose an investigation from the library.</p><div className="mt-5 flex flex-wrap gap-5"><button type="button" onClick={onRetry} className={`min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-background ${focus}`}>Try again</button><Link href={ROUTES.library} className={quietLink}>Browse challenges<ArrowRightIcon /></Link></div></section>
      : <>
        <div role="status" className="rounded-xl border border-panel-border bg-panel px-4 py-3 text-xs leading-relaxed text-muted">
          <p className="font-medium text-foreground">{state.plan.mode === "cold-start" ? "A starting point, not a skill assessment." : "Guided by the evidence available to this session."}</p>
          {state.plan.notices.map((notice) => <p key={notice} className="mt-1">{NOTICE_COPY[notice]}</p>)}
          {state.plan.evidence.local === "disabled" && <p className="mt-1">Browser activity is off. No local learning signals were sent.</p>}
          {state.plan.target.basis === "verified-exposure" && <p className="mt-1">Your optional stretch is based on verified, version-matched challenge exposure, not measured proficiency.</p>}
        </div>
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-7">
            {state.plan.next ? <NextChallenge item={state.plan.next} /> : <section className={`${card} p-6`}><h2 className="text-xl font-semibold">No new investigations fit this range</h2><p className="mt-3 text-sm leading-relaxed text-muted">Try another difficulty or include an optional stretch. Known verified completions and any enabled browser-observed solves stay out of new-work suggestions.</p><Link href={ROUTES.library} className={`${quietLink} mt-5`}>Explore the full library<ArrowRightIcon /></Link></section>}
            <section aria-labelledby={`${id}-path`}><div className="mb-4 flex items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-[0.15em] text-accent">One step at a time</p><h2 id={`${id}-path`} className="mt-2 text-xl font-semibold tracking-tight">Your suggested path</h2></div><span className="text-xs text-muted">{state.plan.path.length} steps</span></div><p className="mb-4 text-sm leading-relaxed text-muted">A suggested sequence, not a set of prerequisites. Choosing a step does not mark anything complete.</p>
              {state.plan.path.length ? <ol className={`${card} divide-y divide-card-border`}>{state.plan.path.map((item,index) => <li key={item.challenge.id} className="flex min-w-0 gap-4 p-4 sm:p-5"><span aria-label={`Step ${index+1}`} className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 font-mono text-xs text-accent">{String(index+1).padStart(2,"0")}</span><div className="min-w-0 flex-1"><Link href={challengePath(item.challenge.id)} className={`inline-block rounded text-base font-semibold leading-snug text-foreground hover:text-accent ${focus}`}>{item.challenge.title}</Link><div className="mt-2"><Metadata item={item} /></div><ReasonList item={item} /></div></li>)}</ol> : <p className="rounded-xl border border-panel-border bg-panel p-5 text-sm text-muted">A path appears when there is eligible work in your chosen range.</p>}
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-6" aria-label="Recall and practice">
            <section aria-labelledby={`${id}-recall`} className={`${card} p-5`}><p className="font-mono text-xs uppercase tracking-[0.15em] text-warning">Keep it fresh</p><h2 id={`${id}-recall`} className="mt-2 text-lg font-semibold">Due for recall</h2><p className="mt-2 text-xs leading-relaxed text-muted">From existing reflection schedules in this browser. No new reviews are invented.</p>
              {state.plan.recalls.length ? <ul className="mt-5 space-y-4">{state.plan.recalls.slice(0,3).map((r) => <li key={r.challenge.id} className="border-t border-card-border pt-4"><p className="text-xs font-medium text-warning">{r.overdueDays ? `${r.overdueDays} ${r.overdueDays === 1 ? "day" : "days"} overdue` : "Due today"}</p><p className="mt-1 text-sm font-medium">{r.challenge.title}</p><Link href={journalSection("recall")} className={`${quietLink} mt-2`}>Recall in your Journal<ArrowRightIcon width={14} height={14} /></Link></li>)}</ul> : <p className="mt-5 rounded-xl bg-panel p-4 text-sm leading-relaxed text-muted">{state.plan.evidence.local === "ready" ? "No published reflection is due right now. Your next review will appear when its scheduled day arrives." : "Enable available browser activity to see existing due reviews. You can always open your Journal."}</p>}
              <Link href={journalSection("recall")} className={`${quietLink} mt-5`}>View all recalls<ArrowRightIcon width={14} height={14} /></Link>
            </section>
            <section aria-labelledby={`${id}-practice`} className={`${card} p-5`}><p className="font-mono text-xs uppercase tracking-[0.15em] text-accent">Try another angle</p><h2 id={`${id}-practice`} className="mt-2 text-lg font-semibold">Practice opportunities</h2><p className="mt-2 text-xs leading-relaxed text-muted">Focused picks from your suggested path. Coverage suggests practice, not proficiency.</p>
              {state.plan.practice.length ? <ul className="mt-5 space-y-5">{state.plan.practice.map((item) => <li key={item.challenge.id} className="border-t border-card-border pt-4"><p className="text-xs text-accent">{categoryLabel(item.challenge.category)}</p><Link href={challengePath(item.challenge.id)} className={`mt-1 inline-block rounded text-sm font-semibold leading-snug hover:text-accent ${focus}`}>{item.challenge.title}</Link><p className="mt-2 text-xs text-muted">{difficultyDisplay[item.challenge.difficulty].label} · ~{item.challenge.estimatedMinutes} min</p><ReasonList item={item} /></li>)}</ul> : <p className="mt-5 text-sm leading-relaxed text-muted">No further practice picks in this range. Start with your next investigation, or adjust your preferences.</p>}
            </section>
          </aside>
        </div>
      </>}
      <p className="border-t border-border pt-5 text-xs leading-relaxed text-muted">Recommendations adapt to the signals available here. They do not grade your ability, change your Journal, or link browser activity to an account.</p>
    </div>
  );
}