import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { navigate, noOverflow, localRecord } from "./helpers";

test("guest account reminder dismisses persistently without changing learning progress", async ({ page }) => {
  const record = localRecord();
  await page.addInitScript((record) => {
    localStorage.setItem("buglab.learning.v2", record);
  }, record);
  await page.route("**/api/account/session", (route) => route.fulfill({ json: { session: null } }));
  await page.goto("/progress");
  const reminder = page.getByRole("complementary", { name: "Keep your debugging streak going!" });
  await expect(reminder).toBeVisible();
  await expect(reminder.getByRole("link", { name: "Create account", exact: true })).toHaveAttribute("href", "/signup");
  await expect(reminder).toContainText("Your progress and streak stay in this browser for now.");
  await noOverflow(page);
  await reminder.getByRole("button", { name: "Maybe later" }).focus();
  await page.keyboard.press("Enter");
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Learning overview", exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("buglab.learning.v2"))).toBe(record);
  expect(await page.evaluate(() => localStorage.getItem("buglab.guest-account-reminder.dismissed.v1"))).toBe("1");
});

test("account reminder waits for a confirmed guest session and tolerates dismissal write failures", async ({ page }) => {
  let session: object | null = {
    user: { id: "reminder-test", email: "guest-test@example.com", displayName: "Learner", emailVerified: true, role: "learner", signInMethods: ["password"], createdAt: null },
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  await page.route("**/api/account/session", (route) => route.fulfill({ json: { session } }));
  await page.goto("/progress");
  await expect(page.getByRole("link", { name: "Your account", exact: true }).first()).toBeVisible();
  const reminder = page.getByRole("complementary", { name: "Keep your debugging streak going!" });
  await expect(reminder).toHaveCount(0);
  await page.unroute("**/api/account/session");
  await page.route("**/api/account/session", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Learning overview", exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  session = null;
  await page.unroute("**/api/account/session");
  await page.route("**/api/account/session", (route) => route.fulfill({ json: { session } }));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "buglab.guest-account-reminder.dismissed.v1") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.reload();
  await expect(reminder).toBeVisible();
  await reminder.getByRole("button", { name: "Maybe later" }).click();
  await expect(reminder).toHaveCount(0);
});

test("Challenge to real diagnosis, reflection, Journal, Progress and Learning Path", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/challenges/challenge-001");
  await page.getByRole("tab", { name: /^Network/ }).click();
  await page.locator('[data-option-id="req-04"]').click();
  await page.getByRole("button", { name: /Add to evidence/ }).click();
  await page.locator('input[value="signed-cookie-read-as-unsigned"]').check();
  await page.getByLabel(/^Explanation/).fill("The server signs the session cookie at login but the middleware reads req.cookies rather than req.signedCookies. The browser sends a cookie yet authenticated requests still receive 401.");
  const confirmation = page.waitForResponse((response) => response.url().endsWith("/api/challenges/challenge-001/diagnosis") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Submit diagnosis", exact: true }).click();
  const response = await confirmation;
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("correct");
  await page.getByRole("button", { name: "Write a reflection", exact: true }).click();
  await page.getByLabel(/^Your takeaway/).fill("Check which cookie collection the middleware reads before investigating expiration.");
  await page.getByRole("button", { name: "Save to journal", exact: true }).click();
  await page.getByRole("link", { name: "Open your journal", exact: true }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByText("Check which cookie collection the middleware reads before investigating expiration.", { exact: true })).toBeVisible();
  await navigate(page, "Progress");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("learning");
  await page.getByRole("link", { name: /Plan your next investigation with Learning Path/ }).click();
  await expect(page).toHaveURL(/\/learning-path$/);
  await expect(page.getByRole("heading", { name: "Your suggested path", exact: true })).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem("buglab.learning.v2"));
  expect(JSON.parse(raw!).solves["challenge-001"].source).toBe("browser");
  expect(await page.getByRole("main").locator('a[href="/challenges/challenge-001"]').count()).toBe(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("navigation preserves existing local data, privacy and verified-completion gates", async ({ page }) => {
  const record = localRecord();
  await page.addInitScript((record) => {
    if (!localStorage.getItem("buglab.learning.v2")) localStorage.setItem("buglab.learning.v2", record);
  }, record);
  const privateRequests: string[] = [];
  const learnerCalls: string[] = [];
  const accountCalls: { url: string; method: string }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/recommendations/v1")) privateRequests.push(request.postData() ?? "");
    if (/\/api\/learner(\/|\?|$)/.test(request.url())) learnerCalls.push(`${request.method()} ${request.url()}`);
    if (/\/api\/account(\/|\?|$)/.test(request.url())) accountCalls.push({ url: request.url(), method: request.method() });
  });
  for (const path of ["/challenges", "/workspace", "/journal#recall", "/progress", "/learning-path"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Primary", exact: true })).toBeVisible();
    await noOverflow(page);
    expect(await page.evaluate(() => localStorage.getItem("buglab.learning.v2"))).toBe(record);
  }
  await expect(page.getByRole("heading", { name: "Your suggested path", exact: true })).toBeVisible();
  expect(privateRequests.length).toBeGreaterThan(0);
  expect(privateRequests.some((body) => body.includes("SMOKE_PRIVATE"))).toBe(false);
  expect(learnerCalls).toEqual([]);
  expect(accountCalls.length).toBeGreaterThan(0);
  expect(accountCalls.every((call) => call.method === "GET" && call.url.endsWith("/api/account/session"))).toBe(true);
  await navigate(page, "Journal");
  await expect(page).toHaveURL(/\/journal$/);
  await navigate(page, "Progress");
  await navigate(page, "Learning Path");
  await expect(page).toHaveURL(/\/learning-path$/);
});

test("network failure offers retry and blocked storage leaves catalog exploration available", async ({ page }) => {
  await page.route("**/api/recommendations/v1", (route) => route.abort("failed"));
  await page.goto("/learning-path");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be refreshed");
  await page.unroute("**/api/recommendations/v1");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your suggested path", exact: true })).toBeVisible();
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("Storage blocked for isolated smoke test", "SecurityError"); }; });
  for (const path of ["/journal", "/progress"]) {
    await page.goto(path);
    await expect(page.getByRole("main").getByRole("status")).toContainText("unavailable");
    await expect(page.getByRole("main").getByRole("link", { name: "Browse challenges", exact: true })).toBeVisible();
  }
  await navigate(page, "Learning Path");
  await expect(page.getByRole("heading", { name: "Your suggested path", exact: true })).toBeVisible();
  await expect(page.getByText("Browser activity is unavailable.", { exact: false })).toBeVisible();
});

test("keyboard disclosure, skip links, theme control and internal route discovery", async ({ page }, info) => {
  await page.goto("/learning-path");
  await expect(page.getByRole("heading", { name: "Your suggested path", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to your learning path", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#learning-path")).toBeFocused();
  const nav = page.getByRole("navigation", { name: "Primary", exact: true });
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
  }
  await expect(nav.locator('[aria-current="page"]:visible')).toContainText("Learning Path");
  const hrefs = await nav.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  for (const href of new Set(hrefs)) expect((await page.request.get(href)).ok()).toBe(true);
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "true") await page.keyboard.press("Escape");
  const previous = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", previous!);
  await noOverflow(page);
  // Restore the project theme before capturing its review image.
  await page.getByRole("button", { name: new RegExp("Switch to " + previous + " theme") }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", previous!);
  const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  await mkdir(".next/integration-smoke", { recursive: true });
  await page.screenshot({ path: ".next/integration-smoke/" + info.project.name + ".png", fullPage: true });
  if (info.project.name === "desktop-light") {
    await page.setViewportSize({ width: 768, height: 1000 });
    await noOverflow(page);
    const last = await nav.getByRole("link", { name: "Learning Path", exact: true }).boundingBox();
    const toggle = await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).boundingBox();
    expect(last && toggle && last.x + last.width <= toggle.x).toBe(true);
  }
  expect((await page.request.get("/challenges/unknown-smoke-challenge")).status()).toBe(404);
});
