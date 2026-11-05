"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath, ROUTES } from "@/lib/challenge-routes";
import { listEntries, type JournalEntry, type RecallResponse, type Reflection } from "@/lib/journal/model";
import { daysUntilDue, dueEntries } from "@/lib/journal/schedule";
import type { PublicChallenge } from "@/types/catalog";
import { RecallCard } from "./RecallCard";
import { focusRing, REFLECTION_PROMPTS, ReflectionForm } from "./ReflectionForm";
import { useJournal, type ActionResult, type JournalState } from "./useJournal";

export interface JournalActions {
  saveReflection: (challengeId: string, reflection: Partial<Reflection>) => ActionResult;
  recordRecall: (challengeId: string, response: RecallResponse) => ActionResult;
  deleteEntry: (challengeId: string) => ActionResult;
  clear: () => ActionResult;
}

const button = `h-8 rounded-md border border-border-strong px-3 text-xs text-foreground hover:bg-surface-raised ${focusRing}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const dueLabel = (entry: JournalEntry, now: Date) => {
  const days = daysUntilDue(entry, now);
  return days === 0 ? "Due for recall now" : `Next recall in ${days} ${days === 1 ? "day" : "days"}`;
};

/** The Learning Journal's content for a given journal state. */
export function JournalView({
  state,
  published,
  actions,
  now,
}: {
  state: JournalState;
  published: readonly PublicChallenge[];
  actions: JournalActions;
  now: Date;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recallRef = useRef<HTMLDivElement>(null);
  const clearConfirmRef = useRef<HTMLButtonElement>(null);
  const byId = new Map(published.map((challenge) => [challenge.id, challenge]));

  useEffect(() => {
    if (active) recallRef.current?.scrollIntoView({ block: "start" });
  }, [active]);
  useEffect(() => {
    if (confirmClear) clearConfirmRef.current?.focus();
  }, [confirmClear]);

  if (state.status === "loading") {
    return <p className="text-sm text-muted">Loading your journal…</p>;
  }
  if (state.status === "unavailable") {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
        <h2 className="text-base font-semibold text-foreground">Your journal is unavailable in this browser</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          This browser is not letting BugLab save anything, for example in some private windows or when site data is blocked. Challenges still
          work; reflections just cannot be kept here.
        </p>
      </div>
    );
  }

  const entries = listEntries(state.journal).filter((entry) => byId.has(entry.challengeId));
  const due = dueEntries(state.journal, now).filter((entry) => byId.has(entry.challengeId));
  const reflectedIds = new Set(entries.map((entry) => entry.challengeId));
  const activeEntry = active ? state.journal.entries[active] : undefined;
  const activeChallenge = active ? byId.get(active) : undefined;
  const run = (result: ActionResult, success: string) => {
    if (result.ok) {
      setError(null);
      setNotice(success);
    } else {
      setNotice(null);
      setError(result.message);
    }
    return result.ok;
  };

  return (
    <div className="flex flex-col gap-8">
      <div aria-live="polite" className="sr-only">
        {notice}
      </div>
      {state.corrupt && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-foreground">
          Your saved journal could not be read, so it is starting fresh.
        </p>
      )}
      {state.discarded > 0 && (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
          {state.discarded} saved {state.discarded === 1 ? "entry was" : "entries were"} for challenges that are no longer available and {state.discarded === 1 ? "is" : "are"} not shown.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-foreground">No reflections yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Solve a challenge, then write a short reflection under the result. It will appear here, and come back for recall after 1, 3 and 7
            days.
          </p>
          <Link
            href={ROUTES.library}
            className={`mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-background hover:bg-accent/85 ${focusRing}`}
          >
            Browse the challenges
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="recall-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="recall-heading" className="text-lg font-semibold tracking-tight text-foreground">
                Recall
              </h2>
              <p className="mt-0.5 text-sm text-muted">Reviews come back after 1, 3 and 7 days. You can also review any entry now.</p>
            </div>
            <div ref={recallRef} className="scroll-mt-24">
              {activeEntry && activeChallenge && (
                <RecallCard
                  key={active}
                  entry={activeEntry}
                  challenge={activeChallenge}
                  published={published}
                  reflectedIds={reflectedIds}
                  onRecord={(response) => {
                    const result = actions.recordRecall(activeEntry.challengeId, response);
                    run(result, "Recall recorded.");
                    return result;
                  }}
                  onClose={() => setActive(null)}
                />
              )}
            </div>
            {due.length > 0 ? (
              <ul aria-label="Due for recall" className="flex flex-col gap-2">
                {due
                  .filter((entry) => entry.challengeId !== active)
                  .map((entry) => {
                    const challenge = byId.get(entry.challengeId)!;
                    return (
                      <li key={entry.challengeId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                        <span className="text-sm text-foreground">
                          Challenge {challenge.number} · {challenge.title}
                          <span className="text-muted"> · due</span>
                        </span>
                        <button type="button" onClick={() => setActive(entry.challengeId)} className={`${button} border-accent/50 text-accent`}>
                          Start recall
                        </button>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              !activeEntry && <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">Nothing is due for recall right now.</p>
            )}
          </section>

          <section aria-labelledby="entries-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="entries-heading" className="text-lg font-semibold tracking-tight text-foreground">
                Your reflections <span className="font-normal text-muted">({entries.length})</span>
              </h2>
              {confirmClear ? (
                <div role="group" aria-label="Confirm clearing the journal" className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-foreground">Delete every reflection in this browser?</span>
                  <button
                    ref={clearConfirmRef}
                    type="button"
                    onClick={() => {
                      if (run(actions.clear(), "Journal cleared.")) setActive(null);
                      setConfirmClear(false);
                    }}
                    className={`h-8 rounded-md bg-danger px-3 text-xs font-medium text-background hover:bg-danger/90 ${focusRing}`}
                  >
                    Yes, clear journal
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className={button}>
                    Keep it
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className={button}>
                  Clear journal
                </button>
              )}
            </div>

            <ul className="flex flex-col gap-3">
              {entries.map((entry) => {
                const challenge = byId.get(entry.challengeId)!;
                const titleId = `entry-${entry.challengeId}-title`;
                return (
                  <li key={entry.challengeId}>
                    <article aria-labelledby={titleId} className="rounded-xl border border-border bg-surface p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-muted">
                            {categoryLabel(challenge.category)} · Challenge {challenge.number}
                          </p>
                          <h3 id={titleId} className="mt-1 text-base font-semibold text-foreground">
                            <Link href={challengePath(challenge.id)} className={`rounded hover:text-accent ${focusRing}`}>
                              {challenge.title}
                            </Link>
                          </h3>
                          <p className="mt-1 text-xs text-subtle">
                            Reflected {formatDate(entry.reflectedAt)}
                            {entry.updatedAt !== entry.reflectedAt && ` · edited ${formatDate(entry.updatedAt)}`} · {dueLabel(entry, now)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setActive(entry.challengeId)} className={button}>
                            Review now
                          </button>
                          <button type="button" onClick={() => setEditing(entry.challengeId)} className={button}>
                            Edit
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(entry.challengeId)} className={button}>
                            Delete
                          </button>
                        </div>
                      </div>

                      {editing === entry.challengeId ? (
                        <div className="mt-4">
                          <ReflectionForm
                            initial={entry.reflection}
                            submitLabel="Save changes"
                            onCancel={() => setEditing(null)}
                            onSubmit={(reflection) => {
                              const result = actions.saveReflection(entry.challengeId, reflection);
                              if (!result.ok) return result.message;
                              run(result, "Reflection updated.");
                              setEditing(null);
                              return null;
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-foreground">{entry.reflection.takeaway}</p>
                          {REFLECTION_PROMPTS.some((prompt) => entry.reflection[prompt.key]) && (
                            <details className="mt-3 text-sm">
                              <summary className={`cursor-pointer rounded text-xs font-medium text-accent ${focusRing}`}>Your notes</summary>
                              <dl className="mt-2 space-y-2">
                                {REFLECTION_PROMPTS.filter((prompt) => entry.reflection[prompt.key]).map((prompt) => (
                                  <div key={prompt.key}>
                                    <dt className="text-xs text-muted">{prompt.label}</dt>
                                    <dd className="mt-0.5 whitespace-pre-line text-foreground">{entry.reflection[prompt.key]}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          )}
                        </>
                      )}

                      {confirmDelete === entry.challengeId && (
                        <div role="group" aria-label={`Confirm deleting ${challenge.title}`} className="mt-4 flex flex-wrap items-center gap-2">
                          <span className="text-sm text-foreground">Delete this reflection?</span>
                          <button
                            type="button"
                            ref={(element) => element?.focus()}
                            onClick={() => {
                              if (run(actions.deleteEntry(entry.challengeId), "Reflection deleted.") && active === entry.challengeId) setActive(null);
                              setConfirmDelete(null);
                            }}
                            className={`h-8 rounded-md bg-danger px-3 text-xs font-medium text-background hover:bg-danger/90 ${focusRing}`}
                          >
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className={button}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

// The current time, read in the browser only (never during prerendering) and
// refreshed when the tab comes back into view, so what is due stays current.
let clock: Date | null = null;
const CLOCK_MAX_AGE_MS = 60_000;
function readClock(): Date {
  // A new object at most once a minute, so repeated reads during one render agree.
  if (!clock || Date.now() - clock.getTime() > CLOCK_MAX_AGE_MS) clock = new Date();
  return clock;
}
function subscribeClock(onChange: () => void) {
  const refresh = () => {
    clock = new Date();
    onChange();
  };
  window.addEventListener("focus", refresh);
  return () => window.removeEventListener("focus", refresh);
}

/** Connects the Learning Journal to this browser's journal store. */
export function JournalScreen({ published }: { published: PublicChallenge[] }) {
  const [ids] = useState(() => published.map((challenge) => challenge.id));
  const journal = useJournal(ids);
  const now = useSyncExternalStore(subscribeClock, readClock, () => null);
  const state: JournalState = now ? journal.state : { status: "loading", journal: journal.state.journal };
  return <JournalView state={state} published={published} actions={journal} now={now ?? new Date(0)} />;
}
