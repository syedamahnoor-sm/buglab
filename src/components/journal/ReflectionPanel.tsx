"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ROUTES } from "@/lib/challenge-routes";
import { EMPTY_REFLECTION, focusRing, ReflectionForm } from "./ReflectionForm";
import { useJournal } from "./useJournal";

/**
 * An optional reflection, offered only below a server-confirmed correct
 * diagnosis. Saving it writes to this browser's journal and changes nothing
 * about the result.
 */
export function ReflectionPanel({ challengeId, publishedIds }: { challengeId: string; publishedIds: readonly string[] }) {
  const journal = useJournal(publishedIds);
  const entry = journal.state.journal.entries[challengeId];
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<"new" | "updated" | null>(null);
  const id = useId();

  if (journal.state.status === "loading") return null;
  if (journal.state.status === "unavailable") {
    return (
      <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
        Your Learning Journal is unavailable because this browser is not letting BugLab save anything.
      </p>
    );
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3 rounded-md border border-border bg-surface-sunken/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`${id}-heading`} className="text-sm font-semibold text-foreground">
            Reflect on this investigation
          </h3>
          <p className="mt-0.5 text-xs text-muted">Optional. Saved in this browser only, in your Learning Journal.</p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setOpen(true);
            }}
            className={`h-8 rounded-md border border-border-strong px-3 text-xs font-medium text-foreground hover:bg-surface-raised ${focusRing}`}
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
            const result = journal.saveReflection(challengeId, reflection);
            if (!result.ok) return result.message;
            setOpen(false);
            setSaved(isNew ? "new" : "updated");
            return null;
          }}
        />
      )}

      <div aria-live="polite" className="text-xs">
        {saved && (
          <p className="text-success">
            {saved === "new" ? "Saved to your journal. It will come up for recall in 1 day." : "Reflection updated."}{" "}
            <Link href={ROUTES.journal} className={`font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}>
              Open your journal
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
