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
const view = (challenges: PublicChallenge[], query: Partial<DiscoveryQuery> = {}) =>
  renderToStaticMarkup(createElement(ExplorerView, { challenges, query: { ...EMPTY_QUERY, ...query }, onQueryChange: () => {} }));
const headings = (markup: string) => [...markup.matchAll(/<h2 id="[^"]+"[^>]*>([^<]+)</g)].map(([, text]) => text);
const sectionHeadings = (markup: string) => headings(markup).filter((heading) => !["Categories", "Filters"].includes(heading));
const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("discovery sections with the shipped catalog (Challenge 001 only)", () => {
  const markup = view(shipped);

  test("Challenge 001 is featured, with the case-file card and an Open investigation link", () => {
    assert.match(markup, /<section aria-labelledby="featured-heading"/);
    assert.match(markup, /<a aria-labelledby="challenge-card-challenge-001-title"[^>]*href="\/challenges\/challenge-001"/);
    assert.ok(markup.includes("Open investigation"));
    assert.ok(markup.includes(challenge001.challenge.incident));
  });

  test("sections with nothing new to show are left out; Continue investigating shows an honest empty state", () => {
    assert.deepEqual(sectionHeadings(markup), ["Featured investigation", "Continue investigating", "All investigations"]);
    assert.ok(markup.includes("Nothing in progress yet."));
    assert.doesNotMatch(markup, /Recommended for you|Beginner-friendly/);
  });

  test("categories and counts come from the catalog, with no empty categories", () => {
    const sidebar = markup.slice(markup.indexOf('aria-label="Filters"'), markup.indexOf("</aside>"));
    assert.match(sidebar, /aria-pressed="true"[^>]*>[\s\S]*?All challenges[\s\S]*?>1</);
    assert.match(sidebar, />Authentication<[\s\S]*?>1</);
    assert.doesNotMatch(sidebar, /APIs|Databases|Frontend|Performance|Infrastructure/);
    assert.ok(markup.includes(">1 challenge available<"));
  });

  test("no fabricated metrics, ratings or learner counts", () => {
    assert.doesNotMatch(markup, /rating|learners|completion rate|popular|% complete/i);
  });

  test("nothing from the answer key or the scenario's code reaches the page", () => {
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations"]) assert.ok(!markup.includes(field), field);
    assert.ok(!markup.includes(provisionalAnswerKey.resolutionSummary));
    for (const option of challenge001.rootCauseOptions) assert.ok(!markup.includes(option.label), option.id);
    assert.ok(!markup.includes(challenge001.files[2].content.slice(0, 40)), "no scenario file contents");
  });
});

describe("a larger catalog", () => {
  const catalog = [
    ...shipped,
    fixtureChallenge("challenge-002", { difficulty: "beginner" }),
    fixtureChallenge("challenge-003", { difficulty: "advanced", category: "frontend", technologies: ["React"] }),
  ];

  test("recommendations and beginner-friendly appear, without repeating the featured challenge", () => {
    const markup = view(catalog);
    assert.deepEqual(sectionHeadings(markup), [
      "Featured investigation",
      "Continue investigating",
      "Recommended for you",
      "Beginner-friendly",
      "All investigations",
    ]);
    const recommended = markup.slice(markup.indexOf("recommended-heading"), markup.indexOf("beginner-heading"));
    assert.ok(!recommended.includes("challenge-001"), "the featured challenge is not recommended again");
    assert.ok(recommended.includes("Chosen from the catalog"), "says how recommendations are made");
  });

  test("filtered: only results, with chips, a count and Clear filters", () => {
    const markup = view(catalog, { difficulties: ["beginner"], technologies: ["Go"] });
    assert.deepEqual(sectionHeadings(markup), ["Results"]);
    assert.ok(markup.includes(">1 of 3 challenges<"));
    assert.match(markup, /<ul aria-label="Active filters"/);
    assert.ok(markup.includes("Remove filter: </span>Beginner"));
    assert.ok(markup.includes("Remove filter: </span>Go"));
    assert.ok(markup.includes(">Clear filters<"));
  });

  test("no results: a clear state and a way out", () => {
    const markup = view(catalog, { q: "kubernetes" });
    assert.ok(markup.includes("No challenges match these filters"));
    assert.ok(markup.includes(">0 of 3 challenges<"));
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

  test("filters are grouped and named; categories are toggle buttons", () => {
    assert.match(markup, /<legend[^>]*>Difficulty<\/legend>/);
    assert.match(markup, /<legend[^>]*>Technologies<\/legend>/);
    assert.match(markup, /<nav aria-labelledby="sidebar-categories"/);
    assert.match(markup, /<button type="button" aria-pressed="(true|false)"/);
  });

  test("the mobile drawer is a named dialog with a close button, and every id is unique", () => {
    assert.match(markup, /<dialog aria-labelledby="filters-drawer-heading"/);
    assert.match(markup, /aria-label="Close filters"/);
    assert.match(markup, /aria-haspopup="dialog"/);
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
      "components/challenge/library/FilterPanel.tsx",
      "components/challenge/library/DiscoveryCard.tsx",
    ]) {
      assert.doesNotMatch(source(path), /@\/lib\/challenge-catalog|@\/data\/catalog["']|@\/data\/challenge-|@\/server\/|answer-key/, path);
    }
  });
});
