/*
 * Challenge 013: The Board That Never Stops Loading. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge, type LogLine, type RequestSpec } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-31";
const COOKIE = { cookie: "kb_sid=73e1f0a92c" };
const TASKS = JSON.stringify([
  { id: "k_88", title: "Draft Q4 roadmap", status: "open", assignee: "me" },
  { id: "k_91", title: "Review vendor contract", status: "open", assignee: "me" },
]);

// The first requests after the board opened, one every ~26 ms, then the rate limiter steps in.
const burst: LogLine[] = [];
for (let i = 0; i < 8; i++) {
  const ms = 512 + i * 26;
  burst.push([`11:30:04.${String(ms).padStart(3, "0")}`, "INFO", "http", "GET /api/tasks?status=open&assignee=me 200 9ms"]);
}

export const challenge013 = defineChallenge({
  number: "013",
  title: "The Board That Never Stops Loading",
  incident: "Opening the task board sends hundreds of identical API requests until the rate limiter blocks the user.",
  difficulty: "intermediate",
  tags: ["React", "useEffect", "Rendering"],
  estimatedMinutes: 20,
  description:
    "Since the board gained filters, opening it makes the browser fire the same request dozens of times a second. After a few seconds the API starts answering 429 and the board shows an error.",
  category: "frontend",
  technologies: ["TypeScript", "React", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://board.kitebase.example",
  files: {
    "INCIDENT.md": `# INC-013 · The Board That Never Stops Loading

**Opened:** ${DATE} 11:40 UTC
**Severity:** SEV-2
**Service:** kitebase-web v2.0.0 (adds board filters)

## Summary
The API's rate limiter is blocking ordinary users. Each of them opened the
task board and their browser sent the same request about 40 times a second
until the limiter (120 requests a minute per user) refused them.

## Notes
- This is the production build: React StrictMode's development
  double-rendering is not involved
- The board has no polling; tasks refresh when filters change
- The browser capture shows the first requests of one session; the full
  session sent 412 requests in ten seconds

## Your task
Explain what makes the board request its tasks again and again.
`,
    "package.json": `{
  "name": "kitebase-web",
  "version": "2.0.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" }
}
`,
    "src/board/TaskBoard.tsx": `import { useEffect, useState } from "react";
import { fetchTasks, type Task, type TaskFilters } from "./api";
import { FilterBar } from "./FilterBar";

export function TaskBoard() {
  const [status, setStatus] = useState<TaskFilters["status"]>("open");
  const [assignee, setAssignee] = useState<TaskFilters["assignee"]>("me");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filters: TaskFilters = { status, assignee };

  // Refresh whenever the filters change.
  useEffect(() => {
    fetchTasks(filters)
      .then((result) => {
        setTasks(result);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [filters]);

  return (
    <main>
      <FilterBar status={status} assignee={assignee} onStatus={setStatus} onAssignee={setAssignee} />
      {error ? <p role="alert">{error}</p> : <TaskColumns tasks={tasks} />}
    </main>
  );
}

function TaskColumns({ tasks }: { tasks: Task[] }) {
  return <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>;
}
`,
    "src/board/api.ts": `export interface Task {
  id: string;
  title: string;
  status: "open" | "done";
  assignee: string;
}

export interface TaskFilters {
  status: "open" | "done" | "all";
  assignee: "me" | "anyone";
}

export async function fetchTasks(filters: TaskFilters): Promise<Task[]> {
  const query = new URLSearchParams({ status: filters.status, assignee: filters.assignee });
  const response = await fetch(\`/api/tasks?\${query}\`);
  if (response.status === 429) throw new Error("Too many requests. Try again in a minute.");
  if (!response.ok) throw new Error(\`Could not load tasks (\${response.status})\`);
  return response.json();
}
`,
    "src/board/FilterBar.tsx": `import type { TaskFilters } from "./api";

interface Props {
  status: TaskFilters["status"];
  assignee: TaskFilters["assignee"];
  onStatus: (status: TaskFilters["status"]) => void;
  onAssignee: (assignee: TaskFilters["assignee"]) => void;
}

export function FilterBar({ status, assignee, onStatus, onAssignee }: Props) {
  return (
    <div className="filters">
      <select aria-label="Status" value={status} onChange={(e) => onStatus(e.target.value as TaskFilters["status"])}>
        <option value="open">Open</option>
        <option value="done">Done</option>
        <option value="all">All</option>
      </select>
      <select aria-label="Assignee" value={assignee} onChange={(e) => onAssignee(e.target.value as TaskFilters["assignee"])}>
        <option value="me">Me</option>
        <option value="anyone">Anyone</option>
      </select>
    </div>
  );
}
`,
    "server/rate-limit.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "./log";

const WINDOW_MS = 60_000;
const LIMIT = 120;
const counters = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = \`\${req.userId}:\${req.path}\`;
  const now = Date.now();
  const entry = counters.get(key);
  const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
  current.count += 1;
  counters.set(key, current);
  if (current.count > LIMIT) {
    if (current.count === LIMIT + 1) log.warn("ratelimit", \`Limit reached user=\${req.userId} route=\${req.path} limit=\${LIMIT}/min\`);
    return res.status(429).set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000))).json({ error: "Too many requests" });
  }
  next();
}
`,
  },
  logs: [
    ["11:30:04.288", "INFO", "http", "GET /board 200 4ms"],
    ["11:30:04.461", "INFO", "http", "GET /assets/board-7c1e.js 200 3ms"],
    ...burst,
    ["11:30:07.630", "WARN", "ratelimit", "Limit reached user=u_640 route=/api/tasks limit=120/min"],
    ["11:30:07.631", "INFO", "http", "GET /api/tasks?status=open&assignee=me 429 1ms"],
    ["11:30:07.657", "INFO", "http", "GET /api/tasks?status=open&assignee=me 429 1ms"],
    ["11:30:14.402", "WARN", "rum", "Session u_640 sent 412 requests to /api/tasks in 10.1 s from /board; no filter changes recorded"],
  ],
  network: [
    { log: 1, type: "document", requestHeaders: COOKIE, response: "<!doctype html><title>Board</title>" },
    { log: 2, type: "script", requestHeaders: COOKIE },
    ...[3, 4, 5, 6].map((log): RequestSpec => ({ log, initiator: "src/board/api.ts", requestHeaders: COOKIE, response: TASKS })),
    {
      log: 12,
      initiator: "src/board/api.ts",
      requestHeaders: COOKIE,
      responseHeaders: { "retry-after": "57" },
      response: '{"error":"Too many requests"}',
    },
  ],
  options: [
    [
      "strict-mode-double-render",
      "React StrictMode runs the effect twice on every render",
      "Development-only double invocation of effects doubles every request.",
    ],
    [
      "effect-depends-on-new-object",
      "The effect depends on an object that is new on every render",
      "Each render builds a fresh filters object, so the effect sees a changed dependency, fetches, sets state and renders again.",
    ],
    [
      "polling-interval-zero",
      "A refresh timer runs with no delay",
      "A polling interval of 0 ms makes the board refetch continuously.",
    ],
    [
      "limiter-too-strict",
      "The rate limit is set far too low for normal use",
      "120 requests a minute is not enough for one board, so normal loading trips the limiter.",
    ],
  ],
});
