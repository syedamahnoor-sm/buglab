/*
 * Challenge Library v2. The interactive explorer reads the URL in the browser,
 * so these tests render its presentational view (ExplorerView) directly with
 * each kind of query, plus the page shell and its static fallback.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticChallengeList } from "@/components/challenge/ChallengeLibrary";
import { ExplorerView } from "@/components/challenge/library/ExplorerView";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { EMPTY_QUERY, type DiscoveryQuery } from "@/lib/catalog/discovery";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import type { PublicChallenge } from "@/types/catalog";
import { fixtureChallenge } from "../catalog/fixtures";

const shipped = listPublishedChallenges();
/** Challenge 001 on its own: the smallest real catalog, so section and count expectations stay fixed. */
const solo = shipped.filter((challenge) => challenge.id === "challenge-001");
const view = (challenges: PublicChallenge[], query: Partial<DiscoveryQuery> = {}) =>
  renderToStaticMarkup(createElement(ExplorerView, { challenges, query: { ...EMPTY_QUERY, ...query }, onQueryChange: () => {} }));
const headings = (markup: string) => [...markup.matchAll(/<h2 id="[^"]+"[^>]*>([^<]+)</g)].map(([, text]) => text);
const sectionHeadings = (markup: string) => headings(markup).filter((heading) => heading !== "Filter by technology");
/** The result count as a learner reads it. */
const resultCount = (markup: string) => markup.match(/<p id="challenge-results"[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]+>/g, "");
const categoryBar = (markup: string) => {
  const start = markup.indexOf('<nav aria-label="Categories"');
  return markup.slice(start, markup.indexOf("</nav>", start));
};
const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("discovery sections with a catalog of Challenge 001 alone", () => {
  const markup = view(solo);

  test("with no beginner challenge there is no start-here pointer, only the one card", () => {
    assert.doesNotMatch(markup, /start-here-heading/, "Challenge 001 is intermediate, so it is not offered as the beginner start");
    assert.equal(markup.match(/<article/g)?.length, 1, "the card appears once");
    assert.ok(markup.includes(solo[0].description), "the card shows the listing description");
  });

  test("one collection: no recommendation, beginner or progress sections, and no progress claims", () => {
    assert.deepEqual(sectionHeadings(markup), ["All investigations"]);
    assert.doesNotMatch(markup, /Recommended for you|Beginner-friendly|Continue investigating|in progress/i);
  });

  test("categories and counts come from the catalog, with no empty categories", () => {
    const bar = categoryBar(markup);
    assert.match(bar, /aria-pressed="true"[^>]*>[\s\S]*?All[\s\S]*?>1</);
    assert.match(bar, /Authentication &amp; Authorization[\s\S]*?>1</);
    assert.doesNotMatch(bar, /APIs|Databases|Frontend|Performance|Security/);
    assert.match(resultCount(markup) ?? "", /^1 challenges?$/);
  });

  test("no fabricated metrics, ratings or learner counts", () => {
    assert.doesNotMatch(markup, /rating|learners|completion rate|popular|% complete/i);
  });

  test("nothing from the answer key or the scenario's code reaches the page", () => {
    const markup = view(shipped);
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations"]) assert.ok(!markup.includes(field), field);
    assert.ok(!markup.includes(provisionalAnswerKey.resolutionSummary));
    for (const option of challenge001.rootCauseOptions) assert.ok(!markup.includes(option.label), option.id);
    assert.ok(!markup.includes(challenge001.files[2].content.slice(0, 40)), "no scenario file contents");
  });
});

describe("a larger catalog", () => {
  const catalog = [
    ...solo,
    fixtureChallenge("challenge-002", { difficulty: "beginner" }),
    fixtureChallenge("challenge-003", { difficulty: "advanced", category: "frontend", technologies: ["React"] }),
  ];

  test("every challenge appears exactly once; the start-here pointer leads to the first beginner challenge", () => {
    const markup = view(catalog);
    assert.deepEqual(sectionHeadings(markup), ["New to BugLab? Start here", "All investigations"]);
    assert.equal(markup.match(/<article/g)?.length, catalog.length);
    assert.match(markup, /<a [^>]*href="\/challenges\/challenge-002"[^>]*>Open Challenge 002/);
    const aside = markup.slice(markup.indexOf('<aside aria-labelledby="start-here-heading"'), markup.indexOf("</aside>"));
    assert.ok(aside.includes(">Beginner</span>") && aside.includes("Estimated time: </span>~"), "the pointer states the difficulty and the authored estimate");
    for (const challenge of catalog) {
      const expected = challenge.id === "challenge-002" ? 2 : 1;
      assert.equal(markup.split(`href="/challenges/${challenge.id}"`).length - 1, expected, `${challenge.id}: one card (plus the start-here link)`);
    }
  });

  test("filtered: only results, with chips, a count and Clear filters", () => {
    const markup = view(catalog, { difficulties: ["beginner"], technologies: ["Go"] });
    assert.deepEqual(sectionHeadings(markup), ["Matching investigations"]);
    assert.equal(resultCount(markup), "1 of 3 challenges");
    assert.match(markup, /<ul aria-label="Active filters"/);
    assert.ok(markup.includes("Remove filter: </span>Beginner"));
    assert.ok(markup.includes("Remove filter: </span>Go"));
    assert.ok(markup.includes(">Clear all<"));
    assert.doesNotMatch(markup, /start-here-heading/, "the start-here pointer is for the unfiltered view only");
  });

  test("no results: a clear state and a way out", () => {
    const markup = view(catalog, { q: "kubernetes" });
    assert.ok(markup.includes("No challenges match these filters"));
    assert.equal(resultCount(markup), "0 of 3 challenges");
    assert.ok(markup.includes(">Clear all filters<"));
    assert.doesNotMatch(markup, /<article/);
  });
});

describe("empty catalog", () => {
  test("says nothing is published and offers no filters", () => {
    const markup = view([]);
    assert.ok(markup.includes("No challenges are published yet"));
    assert.doesNotMatch(markup, /<input|<dialog|<aside/);
    assert.ok(renderToStaticMarkup(createElement(StaticChallengeList, { challenges: [] })).includes("No challenges are published yet."));
  });
});

describe("accessibility", () => {
  const markup = view(shipped);

  test("search and sort are labelled; the result count is announced", () => {
    assert.match(markup, /<label for="challenge-search"[^>]*><span class="sr-only">Search challenges<\/span>/);
    assert.match(markup, /<input id="challenge-search" type="search"/);
    assert.match(markup, /<span>Sort<\/span><select/);
    assert.match(markup, /<p id="challenge-results" aria-live="polite"/);
  });

  test("filters are grouped and named; categories and difficulties are toggle buttons", () => {
    assert.match(markup, /<nav aria-label="Categories"/);
    assert.equal(categoryBar(markup).match(/<button type="button" aria-pressed="(true|false)"/g)?.length, 7, "All plus six categories");
    assert.match(markup, /<div role="group" aria-labelledby="difficulty-label"/);
    assert.match(markup, /<span id="difficulty-label"[^>]*>Difficulty<\/span>/);
    assert.match(markup, /<legend[^>]*>Technologies<\/legend>/);
  });

  test("the technology drawer is a named dialog with a close button, and every id is unique", () => {
    assert.match(markup, /<dialog aria-labelledby="filters-drawer-heading"/);
    assert.match(markup, /<h2 id="filters-drawer-heading"[^>]*>Filter by technology<\/h2>/);
    assert.match(markup, /aria-label="Close"/);
    assert.match(markup, /<button type="button" aria-haspopup="dialog"[^>]*>[\s\S]*?Technologies/);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids");
  });

  test("every card is one link named by its title, with no nested controls", () => {
    for (const [, inner] of markup.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.doesNotMatch(inner, /<(a|button|input|select)\b/);
  });
});

describe("page and boundaries", () => {
  test("the page passes only the published catalog; the explorer has a static fallback", () => {
    assert.match(source("app/challenges/page.tsx"), /<ChallengeLibrary challenges=\{listPublishedChallenges\(\)\} \/>/);
    assert.match(source("components/challenge/ChallengeLibrary.tsx"), /<Suspense fallback=\{<StaticChallengeList challenges=\{challenges\} \/>\}>/);
  });

  test("the static fallback lists every published challenge as a link", () => {
    const markup = renderToStaticMarkup(createElement(StaticChallengeList, { challenges: shipped }));
    assert.match(markup, /href="\/challenges\/challenge-001"/);
  });

  test("client components import no scenarios, catalog data, answer keys or server code", () => {
    for (const path of [
      "components/challenge/library/ExplorerView.tsx",
      "components/challenge/library/ChallengeExplorer.tsx",
      "components/challenge/library/LibraryFilters.tsx",
      "components/challenge/library/DiscoveryCard.tsx",
    ]) {
      assert.doesNotMatch(source(path), /@\/lib\/challenge-catalog|@\/data\/catalog["']|@\/data\/challenge-|@\/server\/|answer-key/, path);
    }
  });
});

describe("technology filters", () => {
  const drawer = (markup: string) => markup.slice(markup.indexOf("<dialog"), markup.indexOf("</dialog>"));

  test("the drawer lists every technology in the catalog, with counts", () => {
    const markup = view(shipped);
    const technologies = new Set(shipped.flatMap((challenge) => challenge.technologies.map((t) => t.toLowerCase())));
    assert.equal(drawer(markup).match(/id="drawer-tech-/g)?.length, technologies.size);
  });

  test("a selected technology is checked, counted on the toolbar button and shown as a chip", () => {
    const markup = view(shipped, { technologies: ["Helm"] });
    assert.match(drawer(markup), /id="drawer-tech-helm"[^>]*checked=""/);
    assert.match(markup, /Technologies<span[^>]*>1<span class="sr-only"> selected<\/span>/);
    assert.ok(markup.includes("Remove filter: </span>Helm"));
  });
});

describe("challenge cards", () => {
  test("show only real metadata: category, difficulty, title, preview, technologies, number and the authored estimate", () => {
    const markup = view(solo);
    const card = markup.slice(markup.indexOf("<article"), markup.indexOf("</article>"));
    for (const text of ["Authentication &amp; Authorization", "Intermediate", challenge001.challenge.title, "Challenge 001", "Investigate"]) {
      assert.ok(card.includes(text), text);
    }
    assert.match(card, /<span class="sr-only">Estimated time: <\/span>~30 min/);
    assert.doesNotMatch(card, /rating|learners|completion|popular|%|score/i);
  });

  test("more than three technologies are summarised as +N, with the rest kept for screen readers", () => {
    const many = fixtureChallenge("challenge-077", { technologies: ["A1", "B2", "C3", "D4", "E5"] });
    const markup = view([many]);
    const start = markup.indexOf('<ul aria-label="Technologies"');
    const list = markup.slice(start, markup.indexOf("</ul>", start));
    assert.equal(list.match(/<li>/g)?.length, 4);
    assert.match(list, /<span aria-hidden="true">\+2<\/span><span class="sr-only">and D4, E5<\/span>/);
  });
});

describe("history", () => {
  test("filter and sort changes add history entries; typing a search replaces the current one", () => {
    const explorer = source("components/challenge/library/ChallengeExplorer.tsx");
    assert.match(explorer, /if \(options\?\.replace\) router\.replace\(href, \{ scroll: false \}\);\s*else router\.push\(href, \{ scroll: false \}\);/);
    const explorerView = source("components/challenge/library/ExplorerView.tsx");
    assert.equal(explorerView.match(/\{ replace: true \}/g)?.length, 1, "only the debounced search write replaces");
  });

  test("results follow the search box immediately; only the URL waits", () => {
    const explorerView = source("components/challenge/library/ExplorerView.tsx");
    assert.match(explorerView, /const current: DiscoveryQuery = \{ \.\.\.query, q: search \};/);
    assert.match(explorerView, /const results = discover\(challenges, current\);/);
  });
});

describe("the shipped catalog's start-here pointer", () => {
  test("is the first beginner challenge in catalog order, with its real difficulty", () => {
    const markup = view(shipped);
    const firstBeginner = shipped.find((challenge) => challenge.difficulty === "beginner")!;
    const aside = markup.slice(markup.indexOf('<aside aria-labelledby="start-here-heading"'), markup.indexOf("</aside>"));
    assert.ok(aside.includes(`>${firstBeginner.title}<`), "its title");
    assert.ok(aside.includes(firstBeginner.description.replaceAll("'", "&#x27;")), "its own description");
    assert.ok(aside.includes(`>Challenge ${firstBeginner.number}<`), "its number");
    assert.match(aside, /<span aria-hidden="true" class="[^"]*"><\/span>Beginner<\/span>/, "its real difficulty");
    assert.ok(aside.includes(`<span class="sr-only">Estimated time: </span>~${firstBeginner.estimatedMinutes} min`), "its authored estimate");
    assert.match(aside, new RegExp(`href="/challenges/${firstBeginner.id}"[^>]*>Open Challenge ${firstBeginner.number}`));
    assert.doesNotMatch(aside, /rating|learners|completion|popular|%|score/i);
  });
});
