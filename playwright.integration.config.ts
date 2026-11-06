import { defineConfig } from "@playwright/test";

const target = process.env.BUGLAB_SMOKE_BASE_URL ?? "http://localhost:3188";
const url = new URL(target);
if (!["http:", "https:"].includes(url.protocol) || url.origin !== target) throw new Error("BUGLAB_SMOKE_BASE_URL must be an exact HTTP(S) origin.");

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: target,
    browserName: "chromium",
    channel: process.env.BUGLAB_SMOKE_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    trace: "off", screenshot: "off", video: "off",
  },
  webServer: process.env.BUGLAB_SMOKE_BASE_URL ? undefined : {
    command: "node node_modules/next/dist/bin/next start --port 3188",
    url: target + "/challenges",
    reuseExistingServer: false,
    timeout: 60000,
    // Match the real smoke server's origin; never inherit development account
    // activation or contact a developer database from production UI checks.
    env: { NEXT_TELEMETRY_DISABLED: "1", BUGLAB_APP_ORIGIN: target, BUGLAB_ACCOUNTS_ENABLED: "", BUGLAB_AUTH_PRODUCTION_VERIFIED: "" },
  },
  projects: [
    { name: "desktop-dark", testMatch: /frontend\.spec\.ts/, use: { viewport: { width: 1440, height: 1000 }, colorScheme: "dark" } },
    { name: "desktop-light", testMatch: /frontend\.spec\.ts/, use: { viewport: { width: 834, height: 1000 }, colorScheme: "light" } },
    { name: "mobile-dark", testMatch: /frontend\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, colorScheme: "dark" } },
    { name: "mobile-light", testMatch: /frontend\.spec\.ts/, use: { viewport: { width: 320, height: 844 }, colorScheme: "light" } },
    { name: "real-api", testMatch: /backend\.spec\.ts/ },
  ],
});
