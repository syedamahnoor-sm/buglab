import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatusDot } from "@/components/ui/StatusDot";
import type {
  ChallengeSummary,
  Difficulty,
  InvestigationStatus,
} from "@/types/workspace";

const difficultyDisplay: Record<Difficulty, { label: string; tone: BadgeTone }> = {
  beginner: { label: "Beginner", tone: "success" },
  intermediate: { label: "Intermediate", tone: "warning" },
  advanced: { label: "Advanced", tone: "danger" },
};

const statusDisplay: Record<
  InvestigationStatus,
  { label: string; tone: BadgeTone; pulse?: boolean }
> = {
  "not-started": { label: "Not started", tone: "neutral" },
  "in-progress": { label: "Investigating", tone: "info", pulse: true },
  submitted: { label: "Diagnosis submitted", tone: "accent" },
  resolved: { label: "Resolved", tone: "success" },
};

interface ChallengeOverviewProps {
  challenge: ChallengeSummary;
}

export function ChallengeOverview({ challenge }: ChallengeOverviewProps) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  const status = statusDisplay[challenge.status];

  return (
    <section
      aria-labelledby="challenge-title"
      className="rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs text-subtle">
            Challenge {challenge.number}
          </p>
          <h1
            id="challenge-title"
            className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          >
            {challenge.title}
          </h1>
          <div className="max-w-3xl rounded-md border-l-2 border-danger/60 bg-surface-sunken px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-danger/90">
              Incident
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              {challenge.incident}
            </p>
          </div>
        </div>

        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-1 lg:text-right">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-subtle">
              Difficulty
            </dt>
            <dd className="mt-1">
              <Badge tone={difficulty.tone}>{difficulty.label}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-subtle">
              Status
            </dt>
            <dd className="mt-1">
              <Badge tone={status.tone}>
                <StatusDot tone={status.tone} pulse={status.pulse} />
                {status.label}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-subtle">
              Est. time
            </dt>
            <dd className="mt-1 font-mono text-muted">
              ~{challenge.estimatedMinutes} min
            </dd>
          </div>
        </dl>
      </div>

      <ul aria-label="Topics" className="mt-4 flex flex-wrap gap-1.5">
        {challenge.tags.map((tag) => (
          <li key={tag}>
            <Badge>{tag}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
