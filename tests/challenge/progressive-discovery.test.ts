/*
 * Progressive discovery in the Challenge Library (9 cards, then Load more) and
 * the site footer. Counts that the shipped catalog does not produce naturally
 * (12, 5) come from isolated fixtures. Load more clicks are covered by the
 * browser check; here the page logic and the first render are pinned down.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplorerView } from "@/components/challenge/library/ExplorerView";
import { nextLimit, PAGE_SIZE, progress } from "@/components/challenge/library/progressive";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { EMPTY_QUERY, type DiscoveryQuery } from "@/lib/catalog/discovery";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import type { PublicChallenge } from "@/types/catalog";
import { fixtureChallenge } from "../catalog/fixtures";

const shipped = listPublishedChallenges();
const view = (challenges: readonly PublicChallenge[], query: Partial<DiscoveryQuery> = {}) =>
  renderToStaticMarkup(createElement(ExplorerView, { challenges, query: { ...EMPTY_QUERY, ...query }, onQueryChange: () => {} }));
const cardIds = (markup: string) => [...markup.matchAll(/<h3 id="all-(challenge-\d+)-title"/g)].map(([, id]) => id);
const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

/** Steps through Load more until everything is shown, recording what is visible after each step. */
function steps(total: number): number[] {
  let limit = PAGE_SIZE;
  const seen = [progress(limit, total).shown];
  while (progress(limit, total).next > 0) {
    limit = nextLimit(limit, total);
    seen.push(progress(limit, total).shown);
  }
  return seen;
}

describe("the page logic", () => {
  test("a page is 9 cards", () => assert.equal(PAGE_SIZE, 9));

  test("30 results: 9, 18, 27, then 30", () => assert.deepEqual(steps(30), [9, 18, 27, 30]));
  test("12 results: 9, then 12", () => assert.deepEqual(steps(12), [9, 12]));
  test("5 results: all 5 at once, nothing more to load", () => {
    assert.deepEqual(steps(5), [5]);
    assert.equal(progress(PAGE_SIZE, 5).next, 0);
  });
  test("0 results: nothing shown, nothing to load", () => assert.deepEqual(progress(PAGE_SIZE, 0), { shown: 0, total: 0, next: 0 }));
  test("Load more offers at most a page, and only what remains", () => {
    assert.equal(progress(9, 30).next, 9);
    assert.equal(progress(27, 30).next, 3);
    assert.equal(progress(9, 12).next, 3);
  });
});

describe("the first render", () => {
  test("the shipped catalog: the first 9 of 30, with progress and Load 9 more", () => {
    const markup = view(shipped);
    const ids = cardIds(markup);
    assert.equal(ids.length, 9);
    assert.equal(new Set(ids).size, 9, "no duplicate cards");
    assert.ok(markup.includes('Showing <span class="font-semibold tabular-nums text-foreground">9</span> of 30 challenges'));
    assert.match(markup, /<button type="button" class="[^"]*">Load 9 more<svg/);
    assert.match(markup, /<p aria-live="polite" class="text-sm text-muted">Showing/, "progress is announced as it changes");
  });

  test("filters run on the whole catalog before the limit: matches beyond the first page are found", () => {
    const catalog = Array.from({ length: 30 }, (_, index) =>
      fixtureChallenge(`challenge-${String(index + 101)}`, { category: index >= 25 ? "frontend" : "api" }),
    );
    const ids = cardIds(view(catalog, { category: "frontend" }));
    assert.deepEqual(ids, ["challenge-126", "challenge-127", "challenge-128", "challenge-129", "challenge-130"]);
  });

  test("sorting runs on the whole catalog before the limit", () => {
    const catalog = Array.from({ length: 30 }, (_, index) =>
      fixtureChallenge(`challenge-${String(index + 101)}`, { publishedAt: `2026-01-${String(index + 1).padStart(2, "0")}` }),
    );
    const ids = cardIds(view(catalog, { sort: "newest" }));
    assert.equal(ids[0], "challenge-130", "the newest of all 30 leads, not the newest of the first 9");
    assert.equal(ids.length, 9);
  });

  test("12 matching: 9 shown, Load 3 more, and the count says matching", () => {
    const catalog = Array.from({ length: 20 }, (_, index) =>
      fixtureChallenge(`challenge-${String(index + 201)}`, { technologies: index < 12 ? ["Rust"] : ["Go"] }),
    );
    const markup = view(catalog, { technologies: ["Rust"] });
    assert.equal(cardIds(markup).length, 9);
    assert.ok(markup.includes('Showing <span class="font-semibold tabular-nums text-foreground">9</span> of 12 matching challenges'));
    assert.match(markup, />Load 3 more<svg/);
  });

  test("5 matching: all 5, with no progress line and no Load more", () => {
    const catalog = Array.from({ length: 5 }, (_, index) => fixtureChallenge(`challenge-${String(index + 301)}`));
    const markup = view(catalog);
    assert.equal(cardIds(markup).length, 5);
    assert.doesNotMatch(markup, /Load \d+ more|Showing/);
  });

  test("0 matching: the helpful empty state, with no grid and no Load more", () => {
    const markup = view(shipped, { q: "zzqxv" });
    assert.ok(markup.includes("No challenges match these filters"));
    assert.ok(markup.includes(">Clear all filters<"));
    assert.doesNotMatch(markup, /<article|Load \d+ more/);
  });
});

describe("how the limit behaves", () => {
  const explorer = source("components/challenge/library/ExplorerView.tsx");

  test("any change to the query (search, category, difficulty, technology, sort) resets to one page", () => {
    assert.match(explorer, /const querySignature = JSON\.stringify\(current\);/);
    assert.match(explorer, /if \(querySignature !== limitFor\) \{\s*setLimitFor\(querySignature\);\s*setLimit\(PAGE_SIZE\);/);
  });

  test("results are discovered from the whole catalog, then cut to the limit", () => {
    assert.match(explorer, /const results = discover\(challenges, current\);\s*const shown = progress\(limit, results\.length\);\s*const visible = results\.slice\(0, shown\.shown\);/);
  });

  test("Load more stays on the page: it neither navigates nor writes the URL", () => {
    const loadMore = explorer.slice(explorer.indexOf("const loadMore = () => {"), explorer.indexOf("};", explorer.indexOf("const loadMore = () => {")));
    assert.doesNotMatch(loadMore, /onQueryChange|router|location|href/);
    assert.match(explorer, /<button\s+type="button"\s+onClick=\{loadMore\}/);
  });

  test("after Load more, focus moves to the first new card without scrolling", () => {
    assert.match(explorer, /focusFrom\.current = shown\.shown;/);
    assert.match(explorer, /\.querySelector\("a"\)\?\.focus\(\{ preventScroll: true \}\)/);
  });

  test("without scripts the static fallback lists every challenge; with scripts CSS trims it to one page", () => {
    const css = source("app/globals.css");
    assert.match(css, /@media \(scripting: enabled\) \{\s*\.library-static-grid > li:nth-child\(n \+ 10\) \{\s*display: none;/);
    assert.equal(PAGE_SIZE + 1, 10, "the CSS rule hides from card PAGE_SIZE + 1");
  });
});

describe("the site footer", () => {
  const markup = renderToStaticMarkup(createElement(SiteFooter));

  test("carries the brand, its lines and the theme, and nothing invented", () => {
    for (const text of ["BugLab", "Investigate. Understand. Remember.", "Built for curious developers.", "© 2026 BugLab", "Learning That Sticks."]) {
      assert.ok(markup.includes(text), text);
    }
    assert.doesNotMatch(markup, /<a\b/, "no placeholder links");
    assert.match(markup, /^<footer class="[^"]*bg-footer/, "near-black through the footer token");
  });

  test("appears on the Challenge Library and not in the debugging workspace", () => {
    assert.match(source("components/challenge/ChallengeLibrary.tsx"), /<\/main>\s*<SiteFooter \/>/);
    for (const path of ["components/challenge/ChallengeWorkspacePage.tsx", "app/challenges/[challengeId]/page.tsx", "app/layout.tsx"]) {
      assert.doesNotMatch(source(path), /SiteFooter/, path);
    }
  });

  test("its colours are theme tokens", () => {
    const css = source("app/globals.css");
    assert.match(css, /--footer: #080a0f;/);
    assert.match(css, /--color-footer: var\(--footer\);/);
  });
});
