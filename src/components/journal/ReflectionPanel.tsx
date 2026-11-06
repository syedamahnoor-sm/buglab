"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ROUTES } from "@/lib/challenge-routes";
import { EMPTY_REFLECTION, ReflectionForm } from "./ReflectionForm";
import { buttonSecondary, focusRing } from "./ui";
import { useLearning } from "./useLearning";

/**
 * The optional reflection, offered below a server-confirmed correct diagnosis
 * once the solve is recorded. Saving writes to this browser's learning record
 * and changes nothing about the result. Collapsed until the learner asks, so
 * it never gets in the way of reading the resolution.
 */
export function ReflectionPanel({ challengeId }: { challengeId: string }) {
  const { state, actions } = useLearning();
  const entry = state.record.reflections[challengeId];
  const solved = Boolean(state.record.solves[challengeId]);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<"new" | "updated" | null>(null);
  const id = useId();

  if (state.status === "loading") return null;
  if (state.status === "unavailable") {
    return (
      <p className="rounded-xl border border-card-border bg-panel px-3.5 py-2.5 text-xs text-muted">
        Reflections are unavailable because this browser is not letting BugLab save anything. Your diagnosis is unaffected.
      </p>
    );
  }
  // The solve is recorded by the confirmation just shown; until then there is nothing to reflect on.
  if (!solved) return null;

  return (
    <section aria-labelledby={`${id}-heading`} className="animate-rise space-y-3 rounded-xl border border-accent/25 bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Learning Loop · Reflect</p>
          <h3 id={`${id}-heading`} className="mt-1 text-sm font-semibold text-foreground">
            Reflect on this investigation
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Optional. A short takeaway now makes it easier to recall later. Saved in this browser only.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setOpen(true);
            }}
            className={`${buttonSecondary} h-9 shrink-0 px-3.5`}
          >
            {entry ? "Edit reflection" : "Write a reflection"}
          </button>
        )}
      </div>

      {open && (
        <ReflectionForm
          initial={entry ? entry.reflection : EMPTY_REFLECTION}
          submitLabel="Save to journal"
          onCancel={() => setOpen(false)}
          onSubmit={(reflection) => {
            const isNew = !entry;
            const result = actions.saveReflection(challengeId, reflection);
            if (!result.ok) return result.message;
            setOpen(false);
            setSaved(isNew ? "new" : "updated");
            return null;
          }}
        />
      )}

      <div aria-live="polite" className="text-xs">
        {saved && (
          <p className="animate-rise text-success">
            {saved === "new" ? "Saved to your journal. It is due for recall tomorrow." : "Reflection updated."}{" "}
            <Link href={ROUTES.journal} className={`font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}>
              Open your journal
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
