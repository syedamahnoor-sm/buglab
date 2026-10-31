/*
 * Static placeholder data for Stage 1 of the Debugging Workspace.
 * UI components receive this via props from the page, so it can be swapped
 * for Challenge Engine data later without touching the components.
 *
 * Keep this content neutral: it describes symptoms only and must not reveal
 * or hint at the confirmed root cause.
 */
import type {
  ChallengeSummary,
  FileNode,
  LogEntry,
  OpenFile,
} from "@/types/workspace";

export const challenge: ChallengeSummary = {
  id: "challenge-001",
  number: "001",
  title: "Broken User Sessions",
  incident:
    "Users can log in successfully, but subsequent authenticated requests fail.",
  difficulty: "intermediate",
  status: "in-progress",
  tags: ["Authentication", "HTTP", "Backend"],
  estimatedMinutes: 30,
};

export const fileTree: FileNode[] = [
  { kind: "file", name: "INCIDENT.md", path: "INCIDENT.md" },
  {
    kind: "folder",
    name: "src",
    path: "src",
    children: [
      { kind: "file", name: "server.ts", path: "src/server.ts" },
      {
        kind: "folder",
        name: "routes",
        path: "src/routes",
        children: [
          { kind: "file", name: "auth.ts", path: "src/routes/auth.ts" },
          { kind: "file", name: "profile.ts", path: "src/routes/profile.ts" },
          { kind: "file", name: "orders.ts", path: "src/routes/orders.ts" },
        ],
      },
      {
        kind: "folder",
        name: "middleware",
        path: "src/middleware",
        children: [
          {
            kind: "file",
            name: "authenticate.ts",
            path: "src/middleware/authenticate.ts",
          },
        ],
      },
      {
        kind: "folder",
        name: "lib",
        path: "src/lib",
        children: [
          {
            kind: "file",
            name: "session-store.ts",
            path: "src/lib/session-store.ts",
          },
        ],
      },
      {
        kind: "folder",
        name: "config",
        path: "src/config",
        children: [
          { kind: "file", name: "index.ts", path: "src/config/index.ts" },
        ],
      },
    ],
  },
  {
    kind: "folder",
    name: "logs",
    path: "logs",
    children: [{ kind: "file", name: "app.log", path: "logs/app.log" }],
  },
  { kind: "file", name: "package.json", path: "package.json" },
];

export const openFile: OpenFile = {
  path: "INCIDENT.md",
  name: "INCIDENT.md",
  language: "Markdown",
  lines: [
    "# INC-001 · Broken User Sessions",
    "",
    "## Summary",
    "Users can log in successfully, but subsequent",
    "authenticated requests fail.",
    "",
    "## Reported impact",
    "- Login form completes and redirects to the dashboard",
    "- Dashboard data fails to load",
    "- Users report being sent back to the login page",
    "",
    "## Timeline (UTC)",
    "- 09:14  First reports received by support",
    "- 09:20  On-call engineer acknowledged the incident",
    "",
    "## Your task",
    "- Review the server logs in the Investigation Console",
    "- Explore the service code in the File Explorer",
    "- Submit a diagnosis with supporting evidence",
  ],
};

export const incidentLogs: LogEntry[] = [
  {
    id: "log-01",
    timestamp: "09:14:02.118",
    level: "INFO",
    source: "http",
    message: "POST /api/auth/login 200 142ms",
  },
  {
    id: "log-02",
    timestamp: "09:14:02.121",
    level: "INFO",
    source: "auth",
    message: "Login succeeded user=u_1042",
  },
  {
    id: "log-03",
    timestamp: "09:14:02.486",
    level: "INFO",
    source: "http",
    message: "GET /api/profile 401 7ms",
  },
  {
    id: "log-04",
    timestamp: "09:14:02.487",
    level: "WARN",
    source: "auth",
    message: "Unauthorized request path=/api/profile",
  },
  {
    id: "log-05",
    timestamp: "09:14:02.512",
    level: "INFO",
    source: "http",
    message: "GET /api/orders 401 6ms",
  },
  {
    id: "log-06",
    timestamp: "09:14:02.513",
    level: "WARN",
    source: "auth",
    message: "Unauthorized request path=/api/orders",
  },
  {
    id: "log-07",
    timestamp: "09:14:09.904",
    level: "INFO",
    source: "http",
    message: "GET /api/profile 401 5ms",
  },
  {
    id: "log-08",
    timestamp: "09:14:09.905",
    level: "ERROR",
    source: "web",
    message: "Dashboard failed to load: 2 requests returned 401",
  },
];
