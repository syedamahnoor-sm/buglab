/** Explicit operator command. Never imported by a route, startup or build. */
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { readAccountSettings } from "../src/server/account/settings";
import { createAccountEngine } from "../src/server/account/engine";

async function main() {
const settings = readAccountSettings({ ...process.env, BUGLAB_ACCOUNTS_ENABLED: "enabled", BUGLAB_AUTH_PRODUCTION_VERIFIED: "enabled" });
if (!settings) throw new Error("Configure provider, DATABASE_URL, secret, origin and email before planning the account schema.");
const pool = new Pool({ connectionString: settings.databaseUrl, connectionTimeoutMillis: 5000, max: 2 });
try {
  const auth = createAccountEngine(settings, pool);
  const plan = await getMigrations(auth.options);
  for (const item of [...plan.toBeCreated, ...plan.toBeAdded, ...plan.toBeAddedIndexes]) if (!item.table.startsWith("buglab_auth_")) throw new Error("Refusing to modify a table outside the account provider boundary.");
  if (plan.schemaProblems.length || plan.unsafeChanges.length) throw new Error("Provider schema requires manual review.");
  const changed = plan.toBeCreated.length + plan.toBeAdded.length + plan.toBeAddedIndexes.length;
  const sql = changed ? await plan.compileMigrations() : "";
  if (!process.argv.includes("--apply")) process.stdout.write(sql || "-- Account schema is current.\n");
  else {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('buglab-auth-schema'))");
      if (sql.trim()) await client.query(sql);
      await client.query("COMMIT");
      console.log("Account provider schema applied. Learner tables were not modified.");
    } catch { await client.query("ROLLBACK"); throw new Error("Account schema application failed; transaction rolled back."); }
    finally { client.release(); }
  }
} finally { await pool.end(); }
}

void main().catch(() => {
  // Driver/configuration exceptions may contain connection details.
  console.error("Account schema operation failed. Review configuration and database state privately.");
  process.exitCode = 1;
});
