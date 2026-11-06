import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountEngine, type AccountRuntime } from "@/server/account/engine";
import type { AccountSettings } from "@/server/account/settings";
import type { AccountEmail } from "@/server/account/email";

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

/** A new, private PostgreSQL cluster. No deployment credentials or existing DBs. */
export async function accountFixture(origin = "http://localhost:3198") {
  const directory = await mkdtemp(join(tmpdir(), "buglab-auth-test-"));
  const port = await freePort();
  const databasePassword = randomBytes(24).toString("hex");
  const postgres = new EmbeddedPostgres({ databaseDir: join(directory, "database"), port, user: "buglab_test", password: databasePassword, authMethod: "scram-sha-256", persistent: true, createPostgresUser: false, postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
  await postgres.initialise();
  await postgres.start();
  const settings: AccountSettings = { origin, databaseUrl: `postgresql://buglab_test:${databasePassword}@127.0.0.1:${port}/postgres`, secret: randomBytes(48).toString("hex"), production: false, email: { mode: "capture" } };
  const pool = new Pool({ connectionString: settings.databaseUrl, max: 4 });
  const mail: AccountEmail[] = [];
  const auth = createAccountEngine(settings, pool, async (message) => { mail.push(message); });
  const runtime: AccountRuntime = { settings, pool, auth };
  const migrations = await getMigrations(auth.options);
  if (migrations.toBeCreated.some((item) => !item.table.startsWith("buglab_auth_"))) throw new Error("Test schema escaped provider boundary.");
  await migrations.runMigrations();
  return {
    runtime, mail, directory,
    async close() {
      await pool.end();
      await postgres.stop();
      // Restrict recursive cleanup to this helper's newly allocated directory.
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("buglab-auth-test-")) throw new Error("Unsafe fixture cleanup path.");
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      // embedded-postgres's exit-hook installs an IPC message listener. In a
      // Node test worker that would keep an otherwise finished suite alive.
      process.channel?.unref();
    },
  };
}

export function emailToken(message: AccountEmail | undefined): string {
  const raw = message?.text.match(/#token=([^\s]+)/)?.[1];
  if (!raw) throw new Error("Expected a captured test email link.");
  return decodeURIComponent(raw);
}
