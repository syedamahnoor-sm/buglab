import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { AdminChallengeRow } from "@/types/admin";
import type { PublicationStatus } from "@/types/catalog";

export const STATUS_DISPLAY: Record<PublicationStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "warning" },
};

/** The challenge inventory: every registered challenge with its status and readiness. */
export function ChallengeInventory({ rows }: { rows: readonly AdminChallengeRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No challenges are registered.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Registered challenges</caption>
        <thead className="bg-surface-raised text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">Challenge</th>
            <th scope="col" className="px-4 py-2 font-semibold">Status</th>
            <th scope="col" className="px-4 py-2 font-semibold">Readiness</th>
            <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const status = STATUS_DISPLAY[row.status];
            return (
              <tr key={row.id} className="bg-surface">
                <th scope="row" className="px-4 py-3 font-normal">
                  <span className="block font-mono text-xs text-subtle">{row.number}</span>
                  <span className="font-medium text-foreground">{row.title}</span>
                  {row.featured && <span className="ml-2 text-xs text-accent">Featured</span>}
                </th>
                <td className="px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td>
                <td className="px-4 py-3 text-muted">
                  {row.ready ? "All checks pass" : `${row.failedChecks} ${row.failedChecks === 1 ? "check fails" : "checks fail"}`}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/challenges/${encodeURIComponent(row.id)}/edit`}
                    className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Review<span className="sr-only"> {row.title}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
