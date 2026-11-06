import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const password = "Browser-test-passphrase-8234";
const origin = () => process.env.BUGLAB_AUTH_TEST_ORIGIN!;

async function mailLink(email: string, subject: string) {
  let link: string | undefined;
  await expect.poll(async () => {
    const directory = process.env.BUGLAB_AUTH_TEST_MAIL!;
    const files = await readdir(directory).catch(() => [] as string[]);
    for (const name of files.reverse()) {
      const message = JSON.parse(await readFile(join(directory, name), "utf8"));
      if (message.to === email && message.subject.includes(subject)) { link = message.text.match(/https?:\/\/[^\s]+/)?.[0]; return Boolean(link); }
    }
    return false;
  }).toBe(true);
  return link!;
}
async function signup(page: Page) {
  const email = `browser-${randomUUID()}@example.com`;
  await page.goto(`${origin()}/signup`);
  await page.getByLabel("Display name").fill("Ada Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check your inbox" })).toBeVisible();
  return email;
}
async function verify(page: Page, email: string) {
  await page.goto(await mailLink(email, "Verify"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your email is verified" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
}
async function login(page: Page, email: string, next = "/account", value = password) {
  await page.goto(`${origin()}/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin()}${next}`);
}
test.beforeEach(async () => {
  const pool = new Pool({ connectionString: process.env.BUGLAB_AUTH_TEST_DATABASE });
  try { await pool.query('DELETE FROM "buglab_auth_rate_limit"'); } finally { await pool.end(); }
});

test("register, verify, sign in, restore, profile, history status and sign out", async ({ page }) => {
  const email = await signup(page);
  await page.goto(`${origin()}/login`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Verify your email");
  await verify(page, email);
  await login(page, email);
  await expect(page.getByRole("heading", { name: "Good to see you, Ada Learner" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Verified email · Learner")).toBeVisible();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Grace Learner");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Your profile is saved");
  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page.getByText("This session", { exact: true })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByLabel("New password", { exact: true }).fill("Updated-browser-test-passphrase-43");
  await page.getByLabel("Confirm new password", { exact: true }).fill("Updated-browser-test-passphrase-43");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your password is updated");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByText("The shared learning service is not connected yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link server-recorded history" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out of BugLab" }).click();
  await expect(page).toHaveURL(`${origin()}/login`);
  await page.goto(`${origin()}/account/security`);
  await expect(page).toHaveURL(/\/login\?next=/);
});
test("recovery email, token reset, old credential refusal and new credential login", async ({ page }) => {
  const email = await signup(page);
  await verify(page, email);
  await page.goto(`${origin()}/forgot-password`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page.goto(await mailLink(email, "Reset"));
  const updated = "New-browser-test-passphrase-7394";
  await page.getByLabel("New password", { exact: true }).fill(updated);
  await page.getByLabel("Confirm password", { exact: true }).fill(updated);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been reset");
  expect(new URL(page.url()).hash).toBe("");
  await login(page, email, "/account", updated);
  await expect(page.getByText("Verified email · Learner")).toBeVisible();
});
test("mobile validation, safe return URL, themes and session expiry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await signup(page);
  await verify(page, email);
  await page.goto(`${origin()}/login?next=https://evil.example`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your email address.", { exact: true })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin()}/account`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
    await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  }
  const pool = new Pool({ connectionString: process.env.BUGLAB_AUTH_TEST_DATABASE });
  try { await pool.query('UPDATE "buglab_auth_session" SET "expiresAt" = NOW() - INTERVAL \'1 minute\' WHERE "userId" = (SELECT "id" FROM "buglab_auth_user" WHERE "email" = $1)', [email]); } finally { await pool.end(); }
  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("guest discovery and signed-in menu preserve optional practice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin()}/`);
  await expect(page.getByRole("main").getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account actions", exact: true }).getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await page.goto(`${origin()}/challenges`);
  await expect(page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Learning Path", exact: true })).toBeVisible();
  for (const width of [320, 390, 834]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole("button", { name: "Account menu", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("navigation", { name: "Account options", exact: true }).getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const email = await signup(page);
  await verify(page, email);
  await login(page, email, "/challenges");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.getByRole("button", { name: "Your account menu", exact: true }).click();
    const menu = page.getByRole("navigation", { name: "Account options", exact: true });
    await expect(menu.getByRole("link", { name: "Account Security", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Your account menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Account options", exact: true }).getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(`${origin()}/account/profile`);
  await page.getByRole("button", { name: "Your account menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Account options", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origin()}/login`);
  await page.goto(`${origin()}/challenges`);
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeVisible();
});

test("account forms have labels, fit desktop/mobile and support keyboard navigation", async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin()}/login`);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await page.getByLabel("Email address").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Intentional review images contain an empty form: no email, password or token.
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
      await page.screenshot({ path: `test-results/auth-login-${theme}-${width}.png`, fullPage: true });
    }
  }
});
