/**
 * Explicit local-only account provisioning. A real PostgreSQL cluster and its
 * credentials persist in an ignored private directory. Never opens an existing
 * external database, installs a service, creates learner tables or enables prod.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFile } from "node:process";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountEngine } from "../src/server/account/engine";
import { readAccountSettings } from "../src/server/account/settings";

const run = promisify(execFile);
const directory = resolve(".buglab-dev-auth");
const dataDirectory = join(directory, "postgres");
const configFile = join(directory, "owner.json");
interface Owner { workspace: string; port: number; user: string; password: string; secret: string }

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((done, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", done); });
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No local database port.");
  await new Promise<void>((done) => socket.close(() => done()));
  return address.port;
}
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development launcher refuses production.");
  if (process.platform !== "win32") throw new Error("This local bootstrap currently supports the installed Windows PostgreSQL binaries; use configured PostgreSQL and npm run dev on other platforms.");
  const binary = join(process.cwd(), "node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");
  if (!existsSync(binary)) throw new Error("Install the locked development PostgreSQL dependency before starting.");
  if (existsSync(directory) && (await lstat(directory)).isSymbolicLink()) throw new Error("Refusing linked development state directory.");
  await mkdir(directory, { recursive: true });
  let owner: Owner;
  const workspace = createHash("sha256").update(resolve(".")).digest("hex");
  if (existsSync(configFile)) {
    owner = JSON.parse(await readFile(configFile, "utf8"));
    if (owner.workspace !== workspace || !Number.isInteger(owner.port) || owner.port < 1024 || owner.port > 65535 || owner.user !== "buglab_auth_dev" || !/^[a-f0-9]{48}$/.test(owner.password) || !/^[a-f0-9]{96}$/.test(owner.secret)) throw new Error("Development database ownership metadata is invalid.");
  } else {
    if (existsSync(dataDirectory)) throw new Error("An existing database has no matching owner metadata; refusing to change it.");
    owner = { workspace, port: await freePort(), user: "buglab_auth_dev", password: randomBytes(24).toString("hex"), secret: randomBytes(48).toString("hex") };
    await writeFile(configFile, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  }
  const databaseUrl = `postgresql://${owner.user}:${owner.password}@127.0.0.1:${owner.port}/postgres`;
  if (existsSync(".env.local")) {
    loadEnvFile(".env.local");
    if (process.env.DATABASE_URL !== databaseUrl || process.env.BETTER_AUTH_SECRET !== owner.secret) throw new Error("Existing environment targets a different database or secret. It was not changed; follow the manual setup guide instead.");
  }
  if (process.argv.includes("--stop-database")) {
    await run(binary, ["stop", "-D", dataDirectory, "-m", "fast", "-w"], { windowsHide: true });
    console.log("Stopped only this worktree's development PostgreSQL cluster. Its data is preserved.");
    return;
  }
  if (!existsSync(join(dataDirectory, "PG_VERSION"))) {
    const instance = new EmbeddedPostgres({ databaseDir: dataDirectory, user: owner.user, password: owner.password, port: owner.port, authMethod: "scram-sha-256", persistent: true, createPostgresUser: false, postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
    await instance.initialise();
  }
  const running = await run(binary, ["status", "-D", dataDirectory], { windowsHide: true }).then(() => true, () => false);
  if (!running) await run(binary, ["start", "-D", dataDirectory, "-l", join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${owner.port}`, "-w", "-t", "20"], { windowsHide: true });
  const index = process.argv.indexOf("--port");
  const port = index === -1 ? 3200 : Number(process.argv[index + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid development preview port.");
  const origin = `http://localhost:${port}`;
  const config = { NODE_ENV: "development" as const, BUGLAB_AUTH_PROVIDER: "better-auth", BUGLAB_ACCOUNTS_ENABLED: "enabled", DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: owner.secret, BUGLAB_APP_ORIGIN: origin, BUGLAB_EMAIL_MODE: "capture", BUGLAB_SMTP_HOST: "", BUGLAB_DEV_MAIL_DIRECTORY: resolve(".buglab-dev-mail"), BUGLAB_AUTH_PRODUCTION_VERIFIED: "" };
  const settings = readAccountSettings({ ...process.env, ...config });
  if (!settings) throw new Error("Local provider settings did not validate.");
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  try {
    const auth = createAccountEngine(settings, pool);
    const plan = await getMigrations(auth.options);
    for (const table of [...plan.toBeCreated, ...plan.toBeAdded, ...plan.toBeAddedIndexes]) if (!table.table.startsWith("buglab_auth_")) throw new Error("Refusing non-provider schema changes.");
    if (plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error("Provider schema requires manual review.");
    // This connection is proven to be our newly provisioned local cluster.
    await plan.runMigrations();
  } finally { await pool.end(); }
  if (!existsSync(".env.local")) {
    const text = ["# Generated for this real, isolated local account database. Never commit.", ...Object.entries(config).filter(([key]) => key !== "NODE_ENV" && key !== "BUGLAB_AUTH_PRODUCTION_VERIFIED").map(([key, value]) => `${key}=${JSON.stringify(value)}`), ""].join("\n");
    await writeFile(".env.local", text, { flag: "wx", mode: 0o600 });
  }
  console.log(`Real account development configuration ready for: ${origin}`);
  console.log("PostgreSQL data is persistent and loopback-only. Verification/reset mail is captured privately in .buglab-dev-mail; no email tokens or credentials are printed.");
  if (process.argv.includes("--setup-only")) return;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], { cwd: process.cwd(), windowsHide: true, stdio: "inherit", env: { ...process.env, ...config, NEXT_TELEMETRY_DISABLED: "1" } });
  const stop = () => { if (next.pid && next.exitCode === null) { if (process.platform === "win32") spawn("taskkill", ["/PID", String(next.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else next.kill("SIGTERM"); } };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  next.once("exit", (code) => { process.exitCode = code ?? 0; });
}
void main().catch(() => { console.error("Local account startup failed. No credentials were printed. Check private .buglab-dev-auth logs and run npm run auth:doctor; existing external databases were not changed."); process.exitCode = 1; });
