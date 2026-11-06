import { defineConfig } from "@playwright/test";

const target = process.env.BUGLAB_AUTH_LOCAL_URL ?? "http://localhost:3200";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(target)) throw new Error("Local authentication verification is restricted to an explicitly configured localhost preview.");
export default defineConfig({
  testDir: "./tests/local-auth", workers: 1, timeout: 90000,
  expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: target, browserName: "chromium", channel: "chromium", trace: "off", screenshot: "off", video: "off" },
});
