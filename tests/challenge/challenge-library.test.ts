import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChallengesPage, { metadata } from "@/app/challenges/page";
import { ChallengeLibrary, type ChallengeLibraryEntry } from "@/components/challenge/ChallengeLibrary";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import type { ChallengeSummary } from "@/types/workspace";

const renderPage = () => renderToStaticMarkup(createElement(ChallengesPage));
const renderLibrary = (entries: ChallengeLibraryEntry[]) =>
  renderToStaticMarkup(createElement(ChallengeLibrary, { entries }));

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (path: string) => readFileSync(join(SRC, path), "utf8");
const imports = (text: string) => [...text.matchAll(/from "([^"]+)"/g)].map(([, from]) => from);

/** Every .ts/.tsx file under src, as paths relative to src. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path.slice(SRC.length).replaceAll("\\", "/")] : [];
  });
}

/** Test-only summaries; never part of the catalog. */
const fixture = (id: string, number: string, title: string): ChallengeSummary => ({
  ...challenge001.challenge,
  id,
  number,
  title,
  tags: [`${title} tag`],
});

const challenge = challenge001.challenge;

/** The "Available challenges" section, where the cards are. */
function cardSection(markup: string): string {
  const section = markup.match(/<section aria-labelledby="available-challenges-heading"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, "has an Available challenges section");
  return section;
}

/** Card links: [aria-labelledby, href] for each, in order. */
const cardLinks = (markup: string) =>
  [...cardSection(markup).matchAll(/<a aria-labelledby="([^"]+)"[^>]* href="([^"]+)"/g)].map((m) => [m[1], m[2]]);

describe("/challenges", () => {
  test("renders the library with exactly the catalog's entry for Challenge 001", () => {
    assert.equal(renderPage(), renderLibrary([{ challenge, href: "/challenges/challenge-001" }]));
  });

  test("has a clear heading, an introduction and the challenge count", () => {
    const markup = renderPage();
    assert.match(markup, /<main aria-labelledby="challenge-library-heading"/);
    assert.match(markup, /<h1 id="challenge-library-heading"[^>]*>Every bug has a story\.<\/h1>/);
    assert.ok(markup.includes("diagnose the root cause"));
    assert.ok(markup.includes(">1 challenge available<"));
    assert.equal(markup.match(/<h1\b/g)?.length, 1, "one page heading");
  });

  test("shows Challenge 001 as the only card, linking to its own workspace route", () => {
    const markup = renderPage();
    assert.equal(markup.match(/<article\b/g)?.length, 1);
    assert.equal(cardSection(markup).match(/<a\b/g)?.length, 1);
    assert.deepEqual(cardLinks(markup), [["challenge-card-challenge-001-title", "/challenges/challenge-001"]]);
    for (const text of [challenge.title, challenge.incident, `Challenge ${challenge.number}`]) {
      assert.ok(markup.includes(text), text);
    }
  });

  test("sets its own page title", () => {
    assert.equal(metadata.title, "BugLab · Challenge Library");
  });
});

describe("ChallengeLibrary", () => {
  const entries: ChallengeLibraryEntry[] = [
    { challenge: fixture("fixture-a", "101", "Fixture Alpha"), href: "/play/a" },
    { challenge: fixture("fixture-b", "102", "Fixture Beta"), href: "/play/b" },
    { challenge: fixture("fixture-c", "103", "Fixture Gamma"), href: "/play/c" },
  ];

  test("renders one linked card per entry, in the order given", () => {
    const markup = renderLibrary(entries);
    assert.ok(markup.includes(">3 challenges available<"));
    assert.equal(cardSection(markup).match(/<li><a\b/g)?.length, 3, "one list item per card");
    assert.equal(markup.match(/<article\b/g)?.length, 3);
    const titles = [...markup.matchAll(/<h3 id="challenge-card-[^"]+"[^>]*>([^<]+)</g)].map(([, title]) => title);
    assert.deepEqual(titles, ["Fixture Alpha", "Fixture Beta", "Fixture Gamma"]);
    const links = cardLinks(markup);
    assert.deepEqual(links, [
      ["challenge-card-fixture-a-title", "/play/a"],
      ["challenge-card-fixture-b-title", "/play/b"],
      ["challenge-card-fixture-c-title", "/play/c"],
    ]);
    for (const [titleId] of links) assert.match(markup, new RegExp(`<h3 id="${titleId}"`), "link names resolve");
  });

  test("pairs several cards on wide screens, and lays each card out by its own width", () => {
    const markup = renderLibrary(entries);
    assert.match(markup, /<ul aria-labelledby="available-challenges-heading" class="grid gap-4 lg:grid-cols-2">/);
    assert.equal(markup.match(/<article [^>]*class="@container /g)?.length, 3, "each card is a size container");
  });

  test("each card is a single keyboard-focusable link with a visible focus style and no nested controls", () => {
    const markup = renderLibrary(entries);
    const cards = cardSection(markup);
    assert.doesNotMatch(markup, /<(button|input|select|textarea|form)\b/);
    assert.doesNotMatch(cards.slice(cards.indexOf("<ul")), /tabindex=/, "cards add no extra tab stops");
    for (const [, link] of cards.matchAll(/<a\b([^>]*)>/g)) {
      assert.match(link, /focus-visible:outline-accent/);
      assert.match(link, /\bgroup\b/, "drives the card's hover and focus styles");
    }
    for (const [, inner] of markup.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.doesNotMatch(inner, /<a\b/);
  });

  test("gives a single card the full column width", () => {
    const markup = renderLibrary(entries.slice(0, 1));
    assert.match(markup, /<ul aria-labelledby="available-challenges-heading" class="grid gap-4">/);
  });

  test("makes Open investigation the card link's call to action", () => {
    const cards = cardSection(renderLibrary(entries));
    assert.equal(cards.match(/>Open investigation</g)?.length, 3);
    assert.equal(cards.match(/class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent /g)?.length, 3);
  });

  test("shows an empty message, not placeholder cards, when there are no entries", () => {
    const markup = renderLibrary([]);
    assert.ok(markup.includes(">0 challenges available<"));
    assert.ok(markup.includes("No challenges are available yet."));
    assert.doesNotMatch(cardSection(markup), /<(article|ul|a)\b/);
  });
});

describe("/challenges: public data only", () => {
  test("shows no answer-key data, resolution text or root-cause options", () => {
    const markup = renderPage();
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations", "keyEvidence"]) {
      assert.ok(!markup.includes(field), field);
    }
    assert.ok(!markup.includes(provisionalAnswerKey.resolutionSummary), "resolution summary");
    assert.ok(!markup.includes(provisionalAnswerKey.correctRootCauseId), "correct option ID");
    for (const option of challenge001.rootCauseOptions) {
      assert.ok(!markup.includes(option.label), option.id);
      assert.ok(!markup.includes(option.description), option.id);
    }
  });

  test("the route reads only the public catalog and renders the shared library", () => {
    const page = source("app/challenges/page.tsx");
    assert.deepEqual(imports(page), [
      "next",
      "@/components/challenge/ChallengeLibrary",
      "@/lib/challenge-catalog",
      "@/lib/challenge-routes",
    ]);
    assert.doesNotMatch(page, /use client|@\/server\/|answer-key|\.server\b|fetch\(/);
  });

  test("the library component is a server component that reads no challenge data itself", () => {
    const library = source("components/challenge/ChallengeLibrary.tsx");
    assert.deepEqual(imports(library), [
      "next/link",
      "@/components/layout/AppHeader",
      "@/components/layout/SkipLinks",
      "@/components/ui/icons",
      "@/types/workspace",
      "./ChallengeCard",
    ]);
    assert.doesNotMatch(library, /use client/);
  });

  test("no client component imports the catalog", () => {
    const users = sourceFiles().filter((path) => source(path).includes("@/lib/challenge-catalog"));
    assert.deepEqual(users.sort(), ["app/challenges/[challengeId]/page.tsx", "app/challenges/page.tsx", "proxy.ts"]);
    for (const path of users) assert.doesNotMatch(source(path), /["']use client["']/, path);
  });
});
