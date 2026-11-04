import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  beginnerChallenges,
  categoryCounts,
  discover,
  EMPTY_QUERY,
  featuredChallenges,
  filterChallenges,
  isFiltered,
  matchesSearch,
  parseDiscoveryQuery,
  recommendedChallenges,
  relatedChallenges,
  serializeDiscoveryQuery,
  sortChallenges,
  technologyOptions,
  type DiscoveryQuery,
} from "@/lib/catalog/discovery";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { fixtureChallenge } from "./fixtures";

const [c001] = listPublishedChallenges();
const api = fixtureChallenge("challenge-002", { category: "api", difficulty: "beginner", technologies: ["Go", "PostgreSQL"], publishedAt: "2026-11-02", description: "Orders double-charge customers.", tags: ["Payments"] });
const front = fixtureChallenge("challenge-003", { category: "frontend", difficulty: "advanced", technologies: ["React", "TypeScript"], publishedAt: "2026-11-03", tags: ["Rendering"] });
const auth2 = fixtureChallenge("challenge-004", { category: "authentication", difficulty: "beginner", technologies: ["Express"], publishedAt: "2026-10-01", tags: ["Authentication"] });
const all = [c001, api, front, auth2];
const ids = (list: { id: string }[]) => list.map((item) => item.id);
const q = (overrides: Partial<DiscoveryQuery>): DiscoveryQuery => ({ ...EMPTY_QUERY, ...overrides });

describe("URL query", () => {
  test("parses, sanitises and serialises in a stable form", () => {
    const params = new URLSearchParams("q=%20session%20&category=authentication&difficulty=advanced,beginner,expert&tech=express,TYPESCRIPT,Cobol&sort=newest");
    const query = parseDiscoveryQuery(params, all);
    assert.deepEqual(query, {
      q: "session",
      category: "authentication",
      difficulties: ["beginner", "advanced"],
      technologies: ["Express", "TypeScript"],
      sort: "newest",
    });
    assert.equal(serializeDiscoveryQuery(query), "q=session&category=authentication&difficulty=beginner%2Cadvanced&tech=Express%2CTypeScript&sort=newest");
    assert.deepEqual(parseDiscoveryQuery(new URLSearchParams(serializeDiscoveryQuery(query)), all), query, "round trip");
  });

  test("unknown or empty values fall back to the defaults", () => {
    const query = parseDiscoveryQuery(new URLSearchParams("category=mobile&sort=popular&difficulty=&tech=,,"), all);
    assert.deepEqual(query, EMPTY_QUERY);
    assert.equal(serializeDiscoveryQuery(EMPTY_QUERY), "");
    assert.equal(parseDiscoveryQuery(new URLSearchParams(`q=${"x".repeat(500)}`), all).q.length, 100);
  });

  test("a category with no published challenge is not accepted", () => {
    assert.equal(parseDiscoveryQuery(new URLSearchParams("category=database"), all).category, null);
  });

  test("sorting alone is not filtering", () => {
    assert.equal(isFiltered(q({ sort: "newest" })), false);
    assert.equal(isFiltered(q({ q: "  " })), false);
    assert.equal(isFiltered(q({ technologies: ["Go"] })), true);
  });
});

describe("search", () => {
  test("matches title, description, category, technologies and tags; every term must match", () => {
    assert.ok(matchesSearch(c001, "broken sessions"));
    assert.ok(matchesSearch(c001, "EXPRESS"));
    assert.ok(matchesSearch(c001, "authentication"));
    assert.ok(matchesSearch(api, "double-charge"));
    assert.ok(!matchesSearch(c001, "sessions kubernetes"));
  });

  test("is normalised (case and Unicode compatibility forms)", () => {
    assert.ok(matchesSearch(c001, "ＥＸＰＲＥＳＳ"), "fullwidth letters");
    assert.ok(matchesSearch(c001, "  \t broken \n "));
  });
});

describe("filters combine with AND across kinds and OR within a kind", () => {
  test("category", () => assert.deepEqual(ids(filterChallenges(all, q({ category: "authentication" }))), ["challenge-001", "challenge-004"]));
  test("two difficulties match either", () => assert.deepEqual(ids(filterChallenges(all, q({ difficulties: ["beginner", "advanced"] }))), ["challenge-002", "challenge-003", "challenge-004"]));
  test("two technologies match either, case-insensitively", () => assert.deepEqual(ids(filterChallenges(all, q({ technologies: ["go", "react"] }))), ["challenge-002", "challenge-003"]));
  test("search AND category AND difficulty AND technology", () => {
    assert.deepEqual(ids(filterChallenges(all, q({ q: "fixture", category: "authentication", difficulties: ["beginner"], technologies: ["Express"] }))), ["challenge-004"]);
    assert.deepEqual(ids(filterChallenges(all, q({ category: "authentication", technologies: ["Go"] }))), []);
  });
});

describe("sorting", () => {
  test("recommended: featured, then easier, then newer, then catalog order", () => {
    assert.deepEqual(ids(sortChallenges(all, "recommended")), ["challenge-001", "challenge-002", "challenge-004", "challenge-003"]);
  });
  test("newest first", () => assert.deepEqual(ids(sortChallenges(all, "newest")), ["challenge-003", "challenge-002", "challenge-001", "challenge-004"]));
  test("difficulty, easiest first, then catalog order", () => assert.deepEqual(ids(sortChallenges(all, "difficulty")), ["challenge-002", "challenge-004", "challenge-001", "challenge-003"]));
  test("deterministic whatever the input order", () => {
    for (const sort of ["recommended", "newest", "difficulty"] as const) {
      assert.deepEqual(ids(sortChallenges([...all].reverse(), sort)), ids(sortChallenges(all, sort)), sort);
    }
  });
  test("discover filters and then sorts", () => {
    assert.deepEqual(ids(discover(all, q({ difficulties: ["beginner"], sort: "newest" }))), ["challenge-002", "challenge-004"]);
  });
});

describe("facets from the real catalog", () => {
  test("categories appear only when they have challenges, with their counts, in taxonomy order", () => {
    assert.deepEqual(categoryCounts(all), [
      { id: "authentication", label: "Authentication & Authorization", count: 2 },
      { id: "api", label: "APIs & Backend", count: 1 },
      { id: "frontend", label: "Frontend & React", count: 1 },
    ]);
    assert.deepEqual(categoryCounts([c001]), [{ id: "authentication", label: "Authentication & Authorization", count: 1 }]);
    assert.deepEqual(categoryCounts([]), []);
  });

  test("technologies are unique case-insensitively, counted and alphabetical", () => {
    const options = technologyOptions([...all, fixtureChallenge("challenge-009", { technologies: ["express"] })]);
    assert.deepEqual(options.map((option) => `${option.label}:${option.count}`), ["Express:3", "Go:1", "Node.js:1", "PostgreSQL:1", "React:1", "TypeScript:2"]);
  });
});

describe("curated sections", () => {
  test("featured, recommendations without repeats, and beginner-friendly", () => {
    assert.deepEqual(ids(featuredChallenges(all)), ["challenge-001"]);
    assert.deepEqual(ids(recommendedChallenges(all, { exclude: new Set(["challenge-001"]) })), ["challenge-002", "challenge-004", "challenge-003"]);
    assert.deepEqual(ids(beginnerChallenges(all)), ["challenge-002", "challenge-004"]);
  });

  test("with only Challenge 001 there is nothing else to recommend and no beginner section", () => {
    assert.deepEqual(ids(recommendedChallenges([c001], { exclude: new Set(["challenge-001"]) })), []);
    assert.deepEqual(beginnerChallenges([c001]), []);
  });

  test("related challenges share category, technologies or tags; unrelated ones are left out", () => {
    assert.deepEqual(ids(relatedChallenges(c001, all)), ["challenge-004", "challenge-003"]);
    assert.deepEqual(relatedChallenges(c001, [c001]), []);
  });
});
