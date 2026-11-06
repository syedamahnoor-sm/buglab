import { spawn } from "node:child_process";

export default async function setup() {
  const server = spawn(process.execPath, ["--import", "./tests/setup/register.mjs", "tests/browser/server.mjs"], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const errors: string[] = [];
  server.stderr?.on("data", (chunk) => errors.push(chunk.toString()));
  const ready = await new Promise<{ origin: string; mailDirectory: string; databaseUrl: string }>((done, reject) => {
    const timeout = setTimeout(() => { server.send("stop"); reject(new Error("Authentication test server timed out.")); }, 180000);
    server.on("message", (message) => {
      if (typeof message === "object" && message && "ready" in message && "origin" in message && typeof message.origin === "string" && "mailDirectory" in message && typeof message.mailDirectory === "string" && "databaseUrl" in message && typeof message.databaseUrl === "string") {
        clearTimeout(timeout); done({ origin: message.origin, mailDirectory: message.mailDirectory, databaseUrl: message.databaseUrl });
      }
    });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error(`Authentication test server exited: ${errors.join("").slice(-2000)}`)); });
  });
  process.env.BUGLAB_AUTH_TEST_ORIGIN = ready.origin;
  process.env.BUGLAB_AUTH_TEST_MAIL = ready.mailDirectory;
  process.env.BUGLAB_AUTH_TEST_DATABASE = ready.databaseUrl;
  return async () => {
    if (server.exitCode !== null) return;
    await new Promise<void>((done) => { server.once("exit", () => done()); server.send("stop"); });
  };
}
