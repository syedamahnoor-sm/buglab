/*
 * Learner-visible source for Challenge 001: Broken User Sessions.
 * A small Express service ("acme-orders-api") as it was deployed during the
 * incident. PROVISIONAL scenario: replace or adapt once aligned with the
 * Challenge Engine.
 *
 * Rules for this file: comments must read like normal engineering comments.
 * Never hint at, name, or explain the defect here; the answer key lives in
 * answer-key.server.ts and is never sent to the browser.
 */
import type { ScenarioFile } from "@/types/workspace";
import { INCIDENT_DATE, formatLogFile, incidentLogs } from "./logs";

const incidentMd = `# INC-001 · Broken User Sessions

**Opened:** ${INCIDENT_DATE} 09:16 UTC
**Severity:** SEV-2
**Service:** acme-orders-api v2.3.0

## Summary
Users can log in successfully, but subsequent
authenticated requests fail.

## Reported impact
- Login form completes and redirects to the dashboard
- Dashboard data fails to load
- Users report being sent back to the login page

## Timeline (UTC)
- 08:55  acme-orders-api v2.3.0 deployed
- 09:14  First reports received by support
- 09:20  On-call engineer acknowledged the incident

## Your task
- Review the server logs in the Investigation Console
- Explore the service code in the File Explorer
- Submit a diagnosis with supporting evidence
`;

const packageJson = `{
  "name": "acme-orders-api",
  "version": "2.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "cookie-parser": "^1.4.7",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^4.17.21",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
`;

const serverTs = `import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { authenticate } from "./middleware/authenticate";
import { logger, requestLogger } from "./lib/logger";
import { authRouter } from "./routes/auth";
import { ordersRouter } from "./routes/orders";
import { profileRouter } from "./routes/profile";

const app = express();

app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(requestLogger);
app.use(express.static("public"));

app.use("/api/auth", authRouter);
app.use("/api/profile", authenticate, profileRouter);
app.use("/api/orders", authenticate, ordersRouter);

// Browser-side failures reported by public/*.js via navigator.sendBeacon.
app.post("/api/client-errors", express.text(), (req, res) => {
  const { message } = JSON.parse(req.body) as { message: string };
  logger.error("web", message);
  res.status(204).end();
});

app.listen(config.port, () => {
  logger.info("http", \`Server listening on :\${config.port}\`);
});
`;

const configTs = `const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  isProduction,

  // Used by cookie-parser. Rotated via the COOKIE_SECRET env var.
  cookieSecret: process.env.COOKIE_SECRET ?? "dev-only-cookie-secret",

  session: {
    cookieName: "sid",
    ttlMs: 1000 * 60 * 60 * 8, // 8 hours
  },
};
`;

const authRouteTs = `import { Router } from "express";
import { config } from "../config";
import { logger } from "../lib/logger";
import { sessionStore } from "../lib/session-store";
import { verifyCredentials } from "../lib/users";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await verifyCredentials(email, password);

  if (!user) {
    logger.warn("auth", \`Login failed email=\${email}\`);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const session = sessionStore.create(user.id);

  res.cookie(config.session.cookieName, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    signed: true,
    maxAge: config.session.ttlMs,
  });

  logger.info("auth", \`Login succeeded user=\${user.id}\`);
  return res.json({ user: { id: user.id, name: user.name } });
});

authRouter.post("/logout", (req, res) => {
  const sessionId = req.signedCookies[config.session.cookieName];
  if (sessionId) {
    sessionStore.destroy(sessionId);
  }

  res.clearCookie(config.session.cookieName);
  return res.status(204).end();
});
`;

const profileRouteTs = `import { Router } from "express";
import { findUserById } from "../lib/users";

export const profileRouter = Router();

profileRouter.get("/", (_req, res) => {
  const user = findUserById(res.locals.userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({ id: user.id, name: user.name, email: user.email });
});
`;

const ordersRouteTs = `import { Router } from "express";

export const ordersRouter = Router();

interface Order {
  id: string;
  userId: string;
  total: number;
  status: "processing" | "shipped" | "delivered";
}

const orders: Order[] = [
  { id: "ord_7781", userId: "u_1042", total: 54.9, status: "shipped" },
  { id: "ord_7802", userId: "u_1042", total: 129.0, status: "processing" },
  { id: "ord_7815", userId: "u_2210", total: 18.5, status: "delivered" },
];

ordersRouter.get("/", (_req, res) => {
  const userOrders = orders.filter((order) => order.userId === res.locals.userId);
  return res.json({ orders: userOrders });
});
`;

const authenticateTs = `import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { logger } from "../lib/logger";
import { sessionStore } from "../lib/session-store";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies[config.session.cookieName];
  const session = sessionId ? sessionStore.get(sessionId) : undefined;

  if (!session) {
    logger.warn("auth", \`Unauthorized request path=\${req.originalUrl}\`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.locals.userId = session.userId;
  return next();
}
`;

const sessionStoreTs = `import { randomUUID } from "node:crypto";
import { config } from "../config";

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

// In-memory store. Sessions are lost on restart, which is acceptable
// for a single instance deployment.
const sessions = new Map<string, Session>();

export const sessionStore = {
  create(userId: string): Session {
    const session: Session = {
      id: randomUUID(),
      userId,
      expiresAt: Date.now() + config.session.ttlMs,
    };
    sessions.set(session.id, session);
    return session;
  },

  get(id: string): Session | undefined {
    const session = sessions.get(id);
    if (!session) return undefined;

    if (session.expiresAt <= Date.now()) {
      sessions.delete(id);
      return undefined;
    }
    return session;
  },

  destroy(id: string): void {
    sessions.delete(id);
  },
};
`;

const usersTs = `import { scryptSync, timingSafeEqual } from "node:crypto";

export interface User {
  id: string;
  name: string;
  email: string;
}

interface StoredUser extends User {
  passwordHash: string;
}

const SALT = "acme-demo-salt";

function hashPassword(password: string): string {
  return scryptSync(password, SALT, 32).toString("hex");
}

const users: StoredUser[] = [
  { id: "u_1042", name: "Priya Shah", email: "priya@example.com", passwordHash: hashPassword("correct-horse") },
  { id: "u_2210", name: "Marcus Lee", email: "marcus@example.com", passwordHash: hashPassword("battery-staple") },
];

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = users.find((candidate) => candidate.email === email);
  if (!user) return null;

  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password), "hex");
  if (!timingSafeEqual(expected, actual)) return null;

  return { id: user.id, name: user.name, email: user.email };
}

export function findUserById(id: string): User | undefined {
  const user = users.find((candidate) => candidate.id === id);
  return user && { id: user.id, name: user.name, email: user.email };
}
`;

const loggerTs = `import type { NextFunction, Request, Response } from "express";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

function write(level: Level, source: string, message: string) {
  console.log(\`\${new Date().toISOString()} \${level.padEnd(5)} [\${source}] \${message}\`);
}

export const logger = {
  debug: (source: string, message: string) => write("DEBUG", source, message),
  info: (source: string, message: string) => write("INFO", source, message),
  warn: (source: string, message: string) => write("WARN", source, message),
  error: (source: string, message: string) => write("ERROR", source, message),
};

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    logger.info("http", \`\${req.method} \${req.originalUrl} \${res.statusCode} \${duration}ms\`);
  });

  next();
}
`;

const loginJs = `const form = document.querySelector("#login-form");
const errorMessage = document.querySelector("#login-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;

  const data = new FormData(form);
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: data.get("email"),
      password: data.get("password"),
    }),
  });

  if (!response.ok) {
    errorMessage.textContent = "Invalid email or password.";
    errorMessage.hidden = false;
    return;
  }

  window.location.assign("/dashboard.html");
});
`;

const dashboardJs = `function reportClientError(message) {
  navigator.sendBeacon("/api/client-errors", JSON.stringify({ message }));
}

function renderProfile(profile) {
  document.querySelector("#profile-name").textContent = profile.name;
  document.querySelector("#profile-email").textContent = profile.email;
}

function renderOrders({ orders }) {
  const list = document.querySelector("#orders");
  list.replaceChildren(
    ...orders.map((order) => {
      const item = document.createElement("li");
      item.textContent = \`\${order.id} · $\${order.total.toFixed(2)} · \${order.status}\`;
      return item;
    }),
  );
}

async function loadDashboard() {
  const [profileResponse, ordersResponse] = await Promise.all([
    fetch("/api/profile", { credentials: "same-origin" }),
    fetch("/api/orders", { credentials: "same-origin" }),
  ]);

  const failed = [profileResponse, ordersResponse].filter((response) => !response.ok);
  if (failed.length > 0) {
    reportClientError(
      \`Dashboard failed to load: \${failed.length} requests returned \${failed[0].status}\`,
    );

    if (failed.some((response) => response.status === 401)) {
      window.location.assign("/login.html");
    }
    return;
  }

  renderProfile(await profileResponse.json());
  renderOrders(await ordersResponse.json());
}

loadDashboard();
`;

export const scenarioFiles: ScenarioFile[] = [
  { path: "INCIDENT.md", content: incidentMd },
  { path: "package.json", content: packageJson },
  { path: "src/server.ts", content: serverTs },
  { path: "src/config/index.ts", content: configTs },
  { path: "src/routes/auth.ts", content: authRouteTs },
  { path: "src/routes/profile.ts", content: profileRouteTs },
  { path: "src/routes/orders.ts", content: ordersRouteTs },
  { path: "src/middleware/authenticate.ts", content: authenticateTs },
  { path: "src/lib/session-store.ts", content: sessionStoreTs },
  { path: "src/lib/users.ts", content: usersTs },
  { path: "src/lib/logger.ts", content: loggerTs },
  { path: "public/login.js", content: loginJs },
  { path: "public/dashboard.js", content: dashboardJs },
  { path: "logs/app.log", content: formatLogFile(incidentLogs) },
];
