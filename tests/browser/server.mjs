// Owns only a newly allocated test database and its own Next.js child process.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { accountFixture, freePort } from "../account/fixture.ts";

const port = await freePort();
const origin = `http://localhost:${port}`;
const fixture = await accountFixture(origin);
const mailDirectory = join(fixture.directory, "mail");
process.env.BUGLAB_AUTH_BROWSER_FIXTURE = "1";
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
  cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "development", BUGLAB_AUTH_PROVIDER: "better-auth", BUGLAB_ACCOUNTS_ENABLED: "enabled", BUGLAB_APP_ORIGIN: origin, DATABASE_URL: fixture.runtime.settings.databaseUrl, BETTER_AUTH_SECRET: fixture.runtime.settings.secret, BUGLAB_EMAIL_MODE: "capture", BUGLAB_DEV_MAIL_DIRECTORY: mailDirectory, NEXT_TELEMETRY_DISABLED: "1", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", BUGLAB_SMTP_HOST: "" },
});
// Keep diagnostics bounded, and never log request URLs containing credentials.
let diagnostics = "";
for (const stream of [next.stdout, next.stderr]) stream.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-5000); });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (next.pid && next.exitCode === null) {
    if (process.platform === "win32") await new Promise((done) => spawn("taskkill", ["/PID", String(next.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).once("exit", done));
    else { next.kill("SIGTERM"); await new Promise((done) => next.once("exit", done)); }
  }
  await fixture.close();
  process.exit(0);
}
process.on("message", (message) => { if (message === "stop") void stop(); });
process.on("disconnect", () => { void stop(); });
for (let attempt = 0; attempt < 120; attempt++) {
  if (next.exitCode !== null) throw new Error("Authentication test server exited during startup.");
  try {
    const response = await fetch(`${origin}/api/account/capabilities`);
    if (response.ok) { process.send?.({ ready: true, origin, mailDirectory, databaseUrl: fixture.runtime.settings.databaseUrl }); break; }
    if (attempt === 119) throw new Error("Authentication test server never became ready.");
  } catch { if (attempt === 119) { process.stderr.write(diagnostics); await stop(); } }
  await setTimeout(1000);
}
