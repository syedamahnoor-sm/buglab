/** Print configuration presence and connection/schema health, never secrets. */
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { readAccountSettings } from "../src/server/account/settings";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const required = ["BUGLAB_AUTH_PROVIDER", "BUGLAB_ACCOUNTS_ENABLED", "DATABASE_URL", "BETTER_AUTH_SECRET", "BUGLAB_APP_ORIGIN"];
console.log("Account configuration:");
for (const name of required) console.log(`  ${name}: ${process.env[name] ? "configured" : "missing"}`);
console.log(`  Email: ${process.env.BUGLAB_SMTP_HOST ? "SMTP configured" : process.env.BUGLAB_EMAIL_MODE === "capture" ? "development capture" : "missing"}`);
console.log(`  Runtime: ${process.env.NODE_ENV ?? "development"}`);
console.log(`  Production verification gate: ${process.env.BUGLAB_AUTH_PRODUCTION_VERIFIED === "enabled" ? "enabled" : "disabled"}`);
let pool: Pool | undefined;
try {
  const settings = readAccountSettings({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" });
  if (!settings) { console.log("Accounts are disabled or required configuration is incomplete."); process.exitCode = 1; }
  else {
    pool = new Pool({ connectionString: settings.databaseUrl, connectionTimeoutMillis: 5000, max: 1 });
    for (const table of ["buglab_auth_user", "buglab_auth_account", "buglab_auth_session", "buglab_auth_verification", "buglab_auth_rate_limit"]) await pool.query(`SELECT "id" FROM "${table}" LIMIT 0`);
    console.log("PostgreSQL connection and all five provider tables: ready.");
  }
} catch { console.log("Account configuration, database connection or provider schema is not ready. Connection details were not printed."); process.exitCode = 1; }
finally { await pool?.end(); }
