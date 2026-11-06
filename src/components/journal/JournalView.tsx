"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { challengePath, JOURNAL_SECTIONS, ROUTES } from "@/lib/challenge-routes";
import { listReflections, type LocalDay, type ReflectionEntry } from "@/lib/learning/model";
import { practiceFor, type PracticeStatus, type Suggestion } from "@/lib/learning/practice";
import { dueReflections, nextUpcoming } from "@/lib/learning/schedule";
import type { PublicChallenge } from "@/types/catalog";
import { ArrowRightIcon } from "../ui/icons";
import { formatDay, formatInstant, plural } from "./format";
import { PracticeCard } from "./PracticeCard";
import { RecallCard } from "./RecallCard";
import { ReflectionCard } from "./ReflectionCard";
import { EMPTY_REFLECTION, ReflectionForm } from "./ReflectionForm";
import { buttonDanger, buttonPrimary, buttonQuiet, buttonSecondary, buttonSmall, card, sectionTitle } from "./ui";
import { useLearning, type LearningActions, type LearningState } from "./useLearning";
import { useToday } from "./useToday";

/** Apply suggestions shown at once: one for each of the most recent reflections. */
const PRACTICE_SOURCES = 3;

function download(text: string, now: Date) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `buglab-journal-${now.toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function Notice({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "warning" ? "alert" : undefined}
      className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
        tone === "warning" ? "border-warning/40 bg-warning/10 text-foreground" : "border-card-border bg-panel text-muted"
      }`}
    >
      {children}
    </div>
  );
}

function SectionHeader({ id, title, detail, headingRef }: { id: string; title: string; detail?: React.ReactNode; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={`${sectionTitle} outline-none`}>
        {title}
      </h2>
      {detail && <p className="text-sm text-muted">{detail}</p>}
    </div>
  );
}

/** The Learning Journal's content for one state of the learning record. */
export function JournalView({
  state,
  published,
  actions,
  today,
}: {
  state: LearningState;
  published: readonly PublicChallenge[];
  actions: LearningActions;
  today: LocalDay | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reflectingId, setReflectingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const recallHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();

  if (state.status === "loading" || today === null) {
    return (
      <div aria-busy="true" className={`${card} px-6 py-10 text-center text-sm text-muted`}>
        Loading your journal…
      </div>
    );
  }
  if (state.status === "unavailable") {
    return (
      <div className={`${card} px-6 py-10 text-center`}>
        <h2 className="text-base font-semibold text-foreground">Your journal is unavailable in this browser</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
          This browser is not letting BugLab save anything (for example in a private window or with site data blocked). Challenges still work;
          reflections and recall need saved site data.
        </p>
      </div>
    );
  }

  const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
  const { record } = state;
  const reflections = listReflections(record).filter((entry) => byId.has(entry.challengeId));
  const awaiting = Object.values(record.solves)
    .filter((solve) => byId.has(solve.challengeId) && !record.reflections[solve.challengeId])
    .sort((a, b) => b.lastSolvedAt.localeCompare(a.lastSolvedAt));
  const hidden =
    Object.keys(record.reflections).filter((challengeId) => !byId.has(challengeId)).length +
    Object.keys(record.solves).filter((challengeId) => !byId.has(challengeId) && !record.reflections[challengeId]).length;
  const visible = { ...record, reflections: Object.fromEntries(reflections.map((entry) => [entry.challengeId, entry])) };
  const due = dueReflections(visible, today);
  const upcoming = nextUpcoming(visible, today);
  const active: ReflectionEntry | undefined = (activeId ? record.reflections[activeId] : undefined) ?? due[0];
  const needsRecovery = state.problems.length > 0;

  // An opened or applied case stays on show with its status; otherwise a fresh suggestion.
  const practice: { from: PublicChallenge; suggestion: Suggestion; status: PracticeStatus }[] = [];
  const suggested = new Set<string>();
  for (const entry of reflections) {
    if (practice.length >= PRACTICE_SOURCES) break;
    const from = byId.get(entry.challengeId)!;
    const item = practiceFor(record, from, published);
    if (item && !suggested.has(item.challenge.id)) {
      suggested.add(item.challenge.id);
      practice.push({ from, suggestion: item, status: item.status });
    }
  }

  const report = (result: { ok: true } | { ok: false; message: string }, success?: string) => {
    if (!result.ok) setMessage({ tone: "error", text: result.message });
    else if (success) setMessage({ tone: "ok", text: success });
    return result;
  };
  const exportNow = () => {
    const text = actions.exportData();
    if (text) download(text, new Date());
    else setMessage({ tone: "error", text: "Your journal could not be exported because this browser's storage is unavailable." });
  };
  const startRecall = (challengeId: string) => {
    setActiveId(challengeId);
    requestAnimationFrame(() => {
      recallHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      recallHeading.current?.focus({ preventScroll: true });
    });
  };

  const notices = (
    <>
      {needsRecovery && (
        <Notice tone="warning">
          <span className="font-medium">Some saved journal data could not be read.</span> Nothing has been deleted: the original is kept in this
          browser and is saved as a separate recovery copy before anything is written over it.{" "}
          <button type="button" onClick={exportNow} className="font-medium text-accent underline underline-offset-2">
            Download a copy
          </button>
        </Notice>
      )}
      {!needsRecovery && state.recoveryKeys.length > 0 && (
        <Notice tone="info">
          This browser keeps {plural(state.recoveryKeys.length, "recovery copy")} of journal data that could not be read earlier.{" "}
          <button type="button" onClick={exportNow} className="font-medium text-accent underline underline-offset-2">
            Download them
          </button>
        </Notice>
      )}
      {state.hasLegacyJournal && (
        <Notice tone="info">
          Your journal from an earlier version of BugLab has been upgraded. The original is kept unchanged in this browser.
        </Notice>
      )}
      {hidden > 0 && (
        <Notice tone="info">
          {plural(hidden, "saved entry")} {hidden === 1 ? "is" : "are"} for a challenge that is no longer available. {hidden === 1 ? "It is" : "They are"} kept,
          not shown, and included when you download your journal.
        </Notice>
      )}
    </>
  );

  const live = (
    <div aria-live="polite" className="empty:hidden">
      {message && (
        <p className={`rounded-xl border px-4 py-2.5 text-sm ${message.tone === "ok" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );

  if (reflections.length === 0 && awaiting.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {notices}
        {live}
        <section aria-labelledby={`${id}-empty`} className={`${card} featured-glow relative overflow-hidden px-6 py-12 text-center sm:px-10`}>
          <h2 id={`${id}-empty`} className="text-xl font-semibold tracking-tight text-foreground">
            Your journal starts with a solved case
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Solve a challenge and the workspace offers a short reflection. It comes back for recall after 1, 3 and 7 days, with a related case to
            practise on. Nothing is here yet.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href={ROUTES.library} className={buttonPrimary}>
              Browse Challenges
              <ArrowRightIcon />
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3 empty:hidden">
        {notices}
        {live}
      </div>

      {/* 1. Recall: first, because it is the time-sensitive step. */}
      <section id={JOURNAL_SECTIONS.recall} aria-labelledby={`${id}-recall`} className="flex scroll-mt-20 flex-col gap-4">
        <SectionHeader
          id={`${id}-recall`}
          headingRef={recallHeading}
          title="Recall"
          detail={due.length ? `${plural(due.length, "review")} due today` : "Nothing due today"}
        />
        {active ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className={`${card} min-w-0 p-5 sm:p-6`}>
              <RecallCard
                key={active.challengeId}
                entry={active}
                challenge={byId.get(active.challengeId)!}
                today={today}
                onRecord={(response) => {
                  setActiveId(active.challengeId);
                  return report(actions.recordRecall(active.challengeId, response));
                }}
                onClose={activeId || due.length === 0 ? () => setActiveId(null) : undefined}
              />
            </div>
            <aside aria-label="Recall queue" className="flex min-w-0 flex-col gap-3 self-start rounded-2xl border border-panel-border bg-panel p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Due for recall</p>
              {due.length ? (
                <ul aria-label="Due for recall" className="flex flex-col gap-1.5">
                  {due.map((entry) => {
                    const challenge = byId.get(entry.challengeId)!;
                    const current = entry.challengeId === active.challengeId;
                    return (
                      <li key={entry.challengeId}>
                        <button
                          type="button"
                          aria-current={current ? "true" : undefined}
                          onClick={() => startRecall(entry.challengeId)}
                          className={`${buttonQuiet} h-auto w-full justify-between py-2 text-left ${current ? "bg-card text-foreground shadow-card" : ""}`}
                        >
                          <span className="min-w-0 truncate">{challenge.title}</span>
                          <span className="shrink-0 font-mono text-xs text-subtle">{entry.recall.dueOn < today ? "overdue" : "today"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted">All caught up for today.</p>
              )}
              {upcoming && (
                <p className="border-t border-panel-border pt-3 text-xs leading-relaxed text-muted">
                  Next: <span className="text-foreground">{byId.get(upcoming.challengeId)?.title}</span> on {formatDay(upcoming.recall.dueOn)}.
                </p>
              )}
            </aside>
          </div>
        ) : (
          <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}>
            <p className="text-sm text-muted">
              {upcoming ? (
                <>
                  Nothing is due today. Next: <span className="text-foreground">{byId.get(upcoming.challengeId)?.title}</span> on{" "}
                  {formatDay(upcoming.recall.dueOn)}.
                </>
              ) : (
                "Write a reflection and it comes up here for recall the next day."
              )}
            </p>
            <p className="text-xs text-subtle">No reminders are sent: reviews appear here when they are due.</p>
          </div>
        )}
      </section>

      {/* Solved, not yet reflected on: a reflection can still be written. */}
      {awaiting.length > 0 && (
        <section id={JOURNAL_SECTIONS.awaiting} aria-labelledby={`${id}-awaiting`} className="flex scroll-mt-20 flex-col gap-4">
          <SectionHeader id={`${id}-awaiting`} title="Solved, not yet reflected" detail="A takeaway now makes the next recall possible." />
          <ul className="flex flex-col gap-3">
            {awaiting.map((solve) => {
              const challenge = byId.get(solve.challengeId)!;
              const open = reflectingId === solve.challengeId;
              return (
                <li key={solve.challengeId} className={`${card} p-5`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">
                        Challenge {challenge.number} · solved {formatInstant(solve.lastSolvedAt)}
                      </p>
                      <h3 className="mt-0.5 text-base font-semibold text-foreground">
                        <Link href={challengePath(challenge.id)} className="hover:text-accent">
                          {challenge.title}
                        </Link>
                      </h3>
                    </div>
                    {!open && (
                      <button type="button" onClick={() => setReflectingId(solve.challengeId)} className={buttonSmall}>
                        Write a reflection
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="mt-4">
                      <ReflectionForm
                        initial={EMPTY_REFLECTION}
                        submitLabel="Save to journal"
                        onCancel={() => setReflectingId(null)}
                        onSubmit={(reflection) => {
                          const result = actions.saveReflection(solve.challengeId, reflection);
                          if (!result.ok) return result.message;
                          setReflectingId(null);
                          setMessage({ tone: "ok", text: `Saved. ${challenge.title} is due for recall tomorrow.` });
                          return null;
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 2. Reflection history. */}
      {reflections.length > 0 && (
        <section aria-labelledby={`${id}-reflections`} className="flex flex-col gap-4">
          <SectionHeader id={`${id}-reflections`} title={`Reflections (${reflections.length})`} detail="Newest first" />
          <ul className="flex flex-col gap-4">
            {reflections.map((entry) => (
              <li key={entry.challengeId}>
                <ReflectionCard
                  entry={entry}
                  solve={record.solves[entry.challengeId]}
                  challenge={byId.get(entry.challengeId)!}
                  today={today}
                  onReview={() => startRecall(entry.challengeId)}
                  onSave={(reflection) => report(actions.saveReflection(entry.challengeId, reflection), "Reflection updated.")}
                  onDelete={() => {
                    if (activeId === entry.challengeId) setActiveId(null);
                    return report(actions.deleteReflection(entry.challengeId), "Reflection deleted. The solve stays recorded.");
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Apply: related practice. */}
      {practice.length > 0 && (
        <section id={JOURNAL_SECTIONS.practice} aria-labelledby={`${id}-practice`} className="flex scroll-mt-20 flex-col gap-4">
          <SectionHeader id={`${id}-practice`} title="Apply: practise next" />
          <p className="-mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Related cases chosen from the catalog by shared category, technologies and topics, skipping ones you have solved here. A case counts as
            applied only when you solve it after opening it from here; opening it is not enough.
          </p>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {practice.map(({ from, suggestion, status }) => (
              <PracticeCard
                key={suggestion.challenge.id}
                from={from}
                suggestion={suggestion}
                status={status}
                onOpen={() => actions.recordPracticeOpened(from.id, suggestion.challenge.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Your data: export, and a deliberate way to start over. */}
      <section aria-labelledby={`${id}-data`} className="flex flex-col gap-3 rounded-2xl border border-panel-border bg-panel p-5">
        <h2 id={`${id}-data`} className="text-sm font-semibold text-foreground">
          Your journal data
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Kept in this browser only. Download a copy to keep it safe; clearing site data removes it.
        </p>
        {confirmClear ? (
          <div role="group" aria-label="Confirm clearing reflections" className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/[0.06] p-3">
            <p className="mr-auto text-sm text-foreground">
              Delete all {plural(Object.keys(record.reflections).length, "reflection")} and their recall schedules? Solved challenges stay recorded.
              Consider downloading a copy first.
            </p>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setConfirmClear(false);
                setActiveId(null);
                report(actions.clearReflections(), "All reflections deleted.");
              }}
              className={buttonDanger}
            >
              Yes, delete all
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className={buttonQuiet}>
              Keep them
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportNow} className={buttonSecondary}>
              Download a copy
            </button>
            {Object.keys(record.reflections).length > 0 && (
              <button type="button" onClick={() => setConfirmClear(true)} className={buttonQuiet}>
                Delete all reflections
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** The journal for this browser, kept current as the day changes and other tabs write. */
export function JournalScreen({ published }: { published: readonly PublicChallenge[] }) {
  const { state, actions } = useLearning();
  const today = useToday();
  useScrollToHash(state.status !== "loading" && today !== null);
  return <JournalView state={state} published={published} actions={actions} today={today} />;
}

/**
 * The journal renders in the browser, after the page has loaded, so a link to
 * one of its sections (from Learning Progress) has nothing to scroll to at
 * first. Once the journal is ready, go to the linked section.
 */
function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    target?.scrollIntoView({ block: "start" });
  }, [ready]);
}
