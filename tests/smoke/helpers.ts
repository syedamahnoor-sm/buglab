import { expect, type Page } from "@playwright/test";

export async function navigate(page: Page, label: string) {
  const navigation = page.locator('nav[aria-label="Primary"]:visible');
  // Mobile links include their helpful detail in the accessible name.
  const link = navigation.getByRole("link", { name: new RegExp("^" + label + "(?:$| )") }).filter({ visible: true });
  if (!await link.isVisible()) await navigation.getByRole("button", { name: /^Menu/ }).click();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

export function localRecord() {
  const now = new Date().toISOString();
  const date = new Date();
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  return JSON.stringify({
    version: 2,
    solves: { "challenge-001": { challengeId: "challenge-001", firstSolvedAt: now, lastSolvedAt: now, timesSolved: 1, source: "browser" } },
    reflections: { "challenge-001": {
      challengeId: "challenge-001", reflectedAt: now, updatedAt: now,
      reflection: { cause: "SMOKE_PRIVATE_CAUSE", evidence: "", misunderstanding: "", nextTime: "", takeaway: "SMOKE_PRIVATE_TAKEAWAY" },
      recall: { stage: 0, stageBefore: 0, dueOn: day, lastReviewedOn: day, attempts: [{ at: now, day, response: "need-practice" }] },
    } },
    practice: [],
  });
}
