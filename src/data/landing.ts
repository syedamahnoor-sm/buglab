/*
 * Content for the landing page at /.
 *
 * Only features that work in the workspace today are described here. Every
 * piece of scenario content (replay, sample logs, sample requests, notes) is
 * curated by hand to restate the incident's symptom only, never its cause;
 * tests/ui/landing.test.ts enforces that.
 */
import { challenge } from "@/data/challenge-001/challenge";
import type { LandingIconName } from "@/components/landing/icons";
import { challengePath, ROUTES as APP_ROUTES } from "@/lib/challenge-routes";

/**
 * Every link into the product goes through these routes. The landing page
 * walks through Challenge 001, so its case links open that challenge; the
 * main calls to action lead to the whole library.
 */
export const ROUTES = {
  home: APP_ROUTES.home,
  library: APP_ROUTES.library,
  featuredChallenge: challengePath(challenge.id),
} as const;

export const SECTION_IDS = {
  content: "landing-content",
  replay: "replay",
  method: "method",
  workspace: "workspace",
  caseFile: "case-file",
} as const;

export const primaryCta = { href: ROUTES.library, label: "Browse the challenges" };
export const openWorkspaceCta = { href: ROUTES.library, label: "Browse challenges" };
export const caseCta = { href: ROUTES.featuredChallenge, label: "Open the case" };
export const replayCta = { href: ROUTES.featuredChallenge, label: "Finish the investigation" };

export const navLinks = [
  { href: `#${SECTION_IDS.replay}`, label: "Replay" },
  { href: `#${SECTION_IDS.method}`, label: "Method" },
  { href: `#${SECTION_IDS.workspace}`, label: "Workspace" },
  { href: `#${SECTION_IDS.caseFile}`, label: "Case file" },
];

export const hero = {
  ticker: `INC-${challenge.number} · SEV-2 · opened 09:16 UTC`,
  title: "Every bug leaves a trail.",
  subtitle:
    "BugLab drops you into a production incident: the code, the logs, the network traffic. Follow the evidence and prove what broke.",
  secondaryCta: { href: `#${SECTION_IDS.replay}`, label: "Watch an investigation" },
  proofPoints: ["Production-style logs", "Full network traffic", "Server-checked diagnosis"],
};

// ---------------------------------------------------------------------------
// Incident replay
// ---------------------------------------------------------------------------

export interface ReplayChapter {
  id: "read" | "search" | "inspect" | "collect" | "diagnose";
  label: string;
  title: string;
  caption: string;
  durationMs: number;
}

export const replayChapters: ReplayChapter[] = [
  {
    id: "read",
    label: "Read",
    title: "Read the incident",
    caption: "The report says what users see: logins work, but everything after them fails.",
    durationMs: 4200,
  },
  {
    id: "search",
    label: "Search",
    title: "Search the logs",
    caption: "Filter the server logs for 401 and the failing requests stand out from the noise.",
    durationMs: 4600,
  },
  {
    id: "inspect",
    label: "Inspect",
    title: "Inspect a request",
    caption: "Open a failing request to read its status, timing and headers.",
    durationMs: 4600,
  },
  {
    id: "collect",
    label: "Collect",
    title: "Collect evidence",
    caption: "Pin what matters as evidence and write down what you notice.",
    durationMs: 4800,
  },
  {
    id: "diagnose",
    label: "Diagnose",
    title: "Make the call",
    caption: "You have the evidence. Choose the root cause and explain it. The server checks your reasoning.",
    durationMs: 5000,
  },
];

export const replay = {
  windowTitle: `acme-orders-api · INC-${challenge.number}`,
  files: [
    { name: "INCIDENT.md", depth: 0 },
    { name: "package.json", depth: 0 },
    { name: "src", depth: 0, folder: true },
    { name: "routes", depth: 1, folder: true },
    { name: "lib", depth: 1, folder: true },
    { name: "server.ts", depth: 1 },
    { name: "public", depth: 0, folder: true },
    { name: "logs", depth: 0, folder: true },
  ],
  incident: [
    `# INC-${challenge.number} · ${challenge.title}`,
    "",
    "## Summary",
    "Users can log in successfully, but",
    "subsequent authenticated requests fail.",
    "",
    "## Reported impact",
    "- Dashboard data fails to load",
  ],
  search: "401",
  logs: [
    { time: "09:14:02.117", level: "INFO", message: "[auth] Login succeeded user=u_1042" },
    { time: "09:14:02.118", level: "INFO", message: "[http] POST /api/auth/login 200 142ms" },
    { time: "09:14:02.301", level: "INFO", message: "[http] GET /dashboard.html 200 4ms" },
    { time: "09:14:02.487", level: "INFO", message: "[http] GET /api/profile 401 3ms", selected: true },
    { time: "09:14:02.489", level: "INFO", message: "[http] GET /api/orders 401 2ms" },
    { time: "09:14:02.512", level: "ERROR", message: "[web] Dashboard failed to load: 2 requests returned 401" },
    { time: "09:14:10.105", level: "INFO", message: "[http] GET /api/profile 401 2ms" },
    { time: "09:14:10.107", level: "INFO", message: "[http] GET /api/orders 401 2ms" },
  ],
  request: {
    title: "GET /api/profile",
    status: "401 Unauthorized",
    rows: [
      ["Type", "fetch"],
      ["Duration", "3 ms"],
      ["Content-Type", "application/json; charset=utf-8"],
      ["X-Powered-By", "Express"],
    ],
  },
  // Typed into the note card one line at a time.
  note: ["Login returns 200, but the next", "authenticated requests return 401."],
  evidence: ["GET /api/profile → 401", "GET /api/orders → 401"],
} as const;

// ---------------------------------------------------------------------------
// Method waterfall
// ---------------------------------------------------------------------------

export interface MethodStep {
  offset: string;
  title: string;
  description: string;
  /** Position of the span on the waterfall, as percentages of the track. */
  start: number;
  width: number;
}

export const methodSteps: MethodStep[] = [
  {
    offset: "+00:00",
    title: "Read the incident",
    description: "Start where on-call starts: a report of what users see and what changed.",
    start: 0,
    width: 14,
  },
  {
    offset: "+02:40",
    title: "Search the logs",
    description: "Filter by level, search sources and messages, and jump to the matching request.",
    start: 12,
    width: 24,
  },
  {
    offset: "+06:15",
    title: "Inspect the traffic",
    description: "Read every request the browser made: headers, payloads, bodies and the file that sent it.",
    start: 30,
    width: 30,
  },
  {
    offset: "+11:30",
    title: "Collect evidence",
    description: "Pin log lines and requests, and track hypotheses and observations as you go.",
    start: 52,
    width: 28,
  },
  {
    offset: "+18:05",
    title: "Submit a diagnosis",
    description: "Pick a root cause, explain it and back it with evidence. The server replies with feedback.",
    start: 76,
    width: 24,
  },
];

// ---------------------------------------------------------------------------
// Workspace showcase tiles
// ---------------------------------------------------------------------------

export interface SampleRequest {
  id: string;
  method: string;
  path: string;
  status: number;
  statusText: string;
  durationMs: number;
  type: string;
  headers: [string, string][];
}

// Hand-picked, harmless headers only.
export const sampleRequests: SampleRequest[] = [
  {
    id: "login",
    method: "POST",
    path: "/api/auth/login",
    status: 200,
    statusText: "OK",
    durationMs: 142,
    type: "fetch",
    headers: [
      ["Content-Type", "application/json; charset=utf-8"],
      ["X-Powered-By", "Express"],
      ["Connection", "keep-alive"],
    ],
  },
  {
    id: "dashboard",
    method: "GET",
    path: "/dashboard.html",
    status: 200,
    statusText: "OK",
    durationMs: 4,
    type: "document",
    headers: [
      ["Content-Type", "text/html; charset=UTF-8"],
      ["Cache-Control", "public, max-age=0"],
    ],
  },
  {
    id: "profile",
    method: "GET",
    path: "/api/profile",
    status: 401,
    statusText: "Unauthorized",
    durationMs: 3,
    type: "fetch",
    headers: [
      ["Content-Type", "application/json; charset=utf-8"],
      ["X-Powered-By", "Express"],
      ["Connection", "keep-alive"],
    ],
  },
  {
    id: "orders",
    method: "GET",
    path: "/api/orders",
    status: 401,
    statusText: "Unauthorized",
    durationMs: 2,
    type: "fetch",
    headers: [
      ["Content-Type", "application/json; charset=utf-8"],
      ["X-Powered-By", "Express"],
      ["Connection", "keep-alive"],
    ],
  },
  {
    id: "client-errors",
    method: "POST",
    path: "/api/client-errors",
    status: 204,
    statusText: "No Content",
    durationMs: 1,
    type: "fetch",
    headers: [
      ["X-Powered-By", "Express"],
      ["Connection", "keep-alive"],
    ],
  },
];

export const defaultSampleRequestId = "profile";

export const sampleLogLines = [
  "09:14:02.117 INFO  [auth] Login succeeded user=u_1042",
  "09:14:02.118 INFO  [http] POST /api/auth/login 200 142ms",
  "09:14:02.344 INFO  [http] GET /dashboard.js 200 2ms",
  "09:14:02.486 WARN  [auth] Unauthorized request path=/api/profile",
  "09:14:02.487 INFO  [http] GET /api/profile 401 3ms",
  "09:14:02.489 INFO  [http] GET /api/orders 401 2ms",
  "09:14:02.512 ERROR [web] Dashboard failed to load",
  "09:14:02.530 INFO  [http] GET /login.html 304 1ms",
];

export const sampleNotes = [
  { kind: "Observation", text: "Login returns 200 for user u_1042." },
  { kind: "Observation", text: "/api/profile returns 401 right after." },
  { kind: "Hypothesis", text: "Something changed in the v2.3.0 deploy at 08:55." },
  { kind: "Evidence", text: "GET /api/orders → 401" },
];

export interface ShowcaseTile {
  icon: LandingIconName;
  title: string;
  description: string;
}

export const showcase = {
  network: {
    icon: "network",
    title: "Network inspector",
    description:
      "Every request the browser made, with status, timing, headers, payloads and bodies. Pick one to inspect it.",
  },
  logs: {
    icon: "search",
    title: "Log search",
    description: "Filter by level and search across sources and messages. Try it.",
  },
  notes: {
    icon: "notes",
    title: "Investigation notes",
    description: "Hypotheses, observations and evidence, side by side while you work.",
  },
  server: {
    icon: "shield",
    title: "Checked on the server",
    description: "Your diagnosis is evaluated on the server. Answers never reach the browser.",
  },
  keyboard: {
    icon: "keyboard",
    title: "Keyboard first",
    description: "Every panel, list and form works from the keyboard, with skip links and predictable focus.",
  },
} satisfies Record<string, ShowcaseTile>;

// ---------------------------------------------------------------------------
// Case file
// ---------------------------------------------------------------------------

// Public challenge details only. Learner status belongs to a session, and
// naming the fields keeps the page stable if ChallengeSummary changes.
const { id, number, title, incident, difficulty, tags, estimatedMinutes } = challenge;
export const featuredChallenge = { id, number, title, incident, difficulty, tags, estimatedMinutes };

export const difficultyLabels = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
} as const;

export const caseFile = {
  caseId: `INC-${challenge.number}`,
  severity: "SEV-2",
  service: "acme-orders-api v2.3.0",
  // From the challenge's public INCIDENT.md.
  timeline: [
    { time: "08:55", text: "acme-orders-api v2.3.0 deployed" },
    { time: "09:14", text: "First reports received by support" },
    { time: "09:16", text: "Incident opened as SEV-2" },
    { time: "09:20", text: "On-call engineer acknowledged" },
  ],
  // What anyone on the incident channel can see: symptoms, never the cause.
  evidence: [
    { label: "Reported", value: "Dashboard data fails to load" },
    { label: "Login", value: "POST /api/auth/login → 200" },
    { label: "Right after", value: "GET /api/profile → 401" },
    { label: "Last change", value: "v2.3.0 deployed at 08:55" },
  ],
  // The clipped strip on the dossier: one public log line.
  clipping: { time: "09:14:02.487", line: "GET /api/profile 401 3ms" },
};

export const closing = {
  title: "The next move is yours.",
  subtitle: "Pick an incident from the library and pick up the trail. No account needed.",
  // The handoff panel. The incident stays open: it is handed over, not solved.
  handoff: {
    status: "Open · awaiting investigator",
    note: "Handed over to you",
    owner: "You",
  },
};

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export const footer = {
  tagline: "Every bug leaves a trail.",
  mission: "Learn debugging through real-world incidents.",
  copyright: "© 2026 BugLab",
  motto: "Observe. Investigate. Understand.",
  backToTop: { href: `#${SECTION_IDS.content}`, label: "Back to top" },
};
