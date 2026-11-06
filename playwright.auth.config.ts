import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/browser/setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  // Tokens appear in email fragments. Never retain traces or request recordings.
  use: { browserName: "chromium", channel: "chromium", headless: true, trace: "off", screenshot: "off", video: "off" },
  reporter: "list",
});
