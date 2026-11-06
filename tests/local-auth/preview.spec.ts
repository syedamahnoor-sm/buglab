import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

test("actual localhost preview: discover, register, verify, login, account menu, logout and recovery", async ({ page }) => {
  const email = `local-preview-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  async function emailLink(subject: string) {
    let link = "";
    await expect.poll(async () => {
      const directory = resolve(".buglab-dev-mail");
      for (const file of await readdir(directory).catch(() => [] as string[])) {
        const message = JSON.parse(await readFile(join(directory, file), "utf8"));
        if (message.to === email && message.subject.includes(subject)) link = message.text.match(/http:\/\/[^\s]+/)?.[0] ?? "";
      }
      return Boolean(link);
    }).toBe(true);
    return link;
  }
  const capability = await page.request.get("/api/account/capabilities");
  expect(capability.status(), "Start the real local account preview with npm run auth:dev before running this check.").toBe(200);
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Display name").fill("Local integration learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check your inbox" })).toBeVisible();
  await page.goto(await emailLink("Verify"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your email is verified" })).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Your account menu", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "Account options", exact: true });
  await expect(menu.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Account Security", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page.goto(await emailLink("Reset"));
  const replacement = randomBytes(24).toString("base64url");
  await page.getByLabel("New password", { exact: true }).fill(replacement);
  await page.getByLabel("Confirm password", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been reset");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await (await page.request.get("/api/account/session")).json()).session.user.emailVerified).toBe(true);
  await page.getByRole("button", { name: "Sign out of BugLab", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
