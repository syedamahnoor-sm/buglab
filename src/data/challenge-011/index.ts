/*
 * Challenge 011: The Checkbox That Moves. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-28";
const COOKIE = { cookie: "listly_session=c9f20a4b8e" };
const initial = [
  { id: "t_101", title: "Pay electricity bill", done: false },
  { id: "t_102", title: "Book dentist", done: false },
  { id: "t_103", title: "Renew passport", done: false },
  { id: "t_104", title: "Water plants", done: false },
];

export const challenge011 = defineChallenge({
  number: "011",
  title: "The Checkbox That Moves",
  incident: "Deleting a completed task makes the next task in the list appear completed.",
  difficulty: "beginner",
  tags: ["React", "State", "Lists"],
  estimatedMinutes: 15,
  description:
    "Users tick a task, delete it, and watch the tick jump to the task below. The server says nothing is wrong, and a page refresh puts everything right.",
  category: "frontend",
  technologies: ["TypeScript", "React", "Vite"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://app.listly.example",
  files: {
    "INCIDENT.md": `# INC-011 · The Checkbox That Moves

**Opened:** ${DATE} 16:05 UTC
**Severity:** SEV-3
**Service:** listly-web v1.6.0

## Summary
"I ticked 'Pay electricity bill', deleted it, and now 'Book dentist' is
ticked, but I never touched it." Several users report the same thing.
Refreshing the page shows the right state.

## Evidence attached
- The task API's logs and session-replay events from one user's session
  (Investigation Console; replay events are tagged [replay])
- The user's browser capture (Network tab)

## Your task
Explain why the tick moves to another task.
`,
    "package.json": `{
  "name": "listly-web",
  "version": "1.6.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "vite": "^5.4.10", "typescript": "^5.6.3" }
}
`,
    "src/TaskList.tsx": `import { useEffect, useState } from "react";
import { api, type Task } from "./api";
import { TaskRow } from "./TaskRow";

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    api.list().then(setTasks);
  }, []);

  async function remove(id: string) {
    await api.remove(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  return (
    <ul className="task-list">
      {tasks.map((task, index) => (
        <TaskRow key={index} task={task} onDelete={() => remove(task.id)} />
      ))}
    </ul>
  );
}
`,
    "src/TaskRow.tsx": `import { useState } from "react";
import { api, type Task } from "./api";

interface Props {
  task: Task;
  onDelete: () => void;
}

export function TaskRow({ task, onDelete }: Props) {
  // Local so the tick shows instantly; the server is updated in the background.
  const [done, setDone] = useState(task.done);

  function toggle() {
    setDone(!done);
    api.toggle(task.id);
  }

  return (
    <li className={done ? "task done" : "task"}>
      <label>
        <input type="checkbox" checked={done} onChange={toggle} />
        {task.title}
      </label>
      <button aria-label={\`Delete \${task.title}\`} onClick={onDelete}>Delete</button>
    </li>
  );
}
`,
    "src/api.ts": `export interface Task {
  id: string;
  title: string;
  done: boolean;
}

const json = (response: Response) => {
  if (!response.ok) throw new Error(\`Request failed: \${response.status}\`);
  return response.json();
};

export const api = {
  list: (): Promise<Task[]> => fetch("/api/tasks").then(json),
  toggle: (id: string): Promise<Task> => fetch(\`/api/tasks/\${id}/toggle\`, { method: "POST" }).then(json),
  remove: (id: string): Promise<void> => fetch(\`/api/tasks/\${id}/delete\`, { method: "POST" }).then(() => undefined),
};
`,
    "server/routes/tasks.ts": `import { Router } from "express";
import { tasks } from "../store";

export const tasksRouter = Router();

tasksRouter.get("/api/tasks", (req, res) => res.json(tasks.forUser(req.userId)));

tasksRouter.post("/api/tasks/:id/toggle", (req, res) => {
  const task = tasks.toggle(req.userId, req.params.id);
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json(task);
});

tasksRouter.post("/api/tasks/:id/delete", (req, res) => {
  tasks.remove(req.userId, req.params.id);
  res.status(204).end();
});
`,
  },
  logs: [
    ["15:40:22.017", "INFO", "http", "GET /api/tasks 200 6ms"],
    ["15:40:22.204", "INFO", "replay", "Rendered tasks: [ ] Pay electricity bill, [ ] Book dentist, [ ] Renew passport, [ ] Water plants"],
    ["15:40:30.611", "INFO", "replay", "Checkbox changed task=\"Pay electricity bill\" checked=true"],
    ["15:40:30.640", "INFO", "http", "POST /api/tasks/t_101/toggle 200 4ms"],
    ["15:40:34.902", "INFO", "replay", "Click button=\"Delete Pay electricity bill\""],
    ["15:40:34.925", "INFO", "http", "POST /api/tasks/t_101/delete 204 3ms"],
    ["15:40:34.951", "INFO", "replay", "Rendered tasks: [x] Book dentist, [ ] Renew passport, [ ] Water plants"],
    ["15:40:51.330", "INFO", "replay", "Window focused after 16 s in another tab"],
    ["15:41:03.118", "INFO", "replay", "Page reloaded"],
    ["15:41:03.402", "INFO", "http", "GET /api/tasks 200 5ms"],
    ["15:41:03.588", "INFO", "replay", "Rendered tasks: [ ] Book dentist, [ ] Renew passport, [ ] Water plants"],
  ],
  network: [
    { log: 1, initiator: "src/api.ts", requestHeaders: COOKIE, response: JSON.stringify(initial) },
    { log: 4, initiator: "src/api.ts", requestHeaders: COOKIE, response: JSON.stringify({ ...initial[0], done: true }) },
    { log: 6, initiator: "src/api.ts", requestHeaders: COOKIE },
    { log: 10, initiator: "src/api.ts", requestHeaders: COOKIE, response: JSON.stringify(initial.slice(1)) },
  ],
  options: [
    [
      "server-returns-wrong-done",
      "The server marks the wrong task as done",
      "The toggle or delete endpoint updates a neighbouring task, so the list comes back with the wrong task completed.",
    ],
    [
      "filter-removes-wrong-task",
      "The delete handler removes the wrong task from the list",
      "The list update after a delete drops a different task than the one deleted.",
    ],
    [
      "index-keys-reuse-row-state",
      "Rows are keyed by position, so a row's local state stays with the position",
      "After a delete, React keeps the first row's component and its state, and gives it the next task's data.",
    ],
    [
      "toggle-response-race",
      "A late toggle response overwrites the list",
      "The toggle request finishes after the delete and writes its task's done state into the list.",
    ],
  ],
});
