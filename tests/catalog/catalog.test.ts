import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { createCatalog } from "@/lib/catalog/catalog";
import { validateCatalogEntry } from "@/lib/catalog/validate";
import { getCatalogInventory, getPublicScenario, listChallengeSummaries, listPublishedChallenges } from "@/lib/challenge-catalog";
import { fixtureEntry } from "./fixtures";

const shippedIds = REGISTERED_CHALLENGES.map((entry) => entry.scenario.challenge.id);

describe("automatic discovery from the registration point", () => {
  test("a newly registered published challenge appears everywhere without UI changes", () => {
    const catalog = createCatalog([...REGISTERED_CHALLENGES, fixtureEntry("challenge-042", { listing: { publishedAt: "2026-11-05" } })]);
    assert.deepEqual(catalog.listPublished().map((challenge) => challenge.id), [...shippedIds, "challenge-042"]);
    assert.equal(catalog.getPublishedScenario("challenge-042")?.challenge.title, "Fixture challenge-042");
  });

  test("draft and archived challenges are not discoverable or openable, but stay in the inventory", () => {
    const catalog = createCatalog([
      ...REGISTERED_CHALLENGES,
      fixtureEntry("challenge-050", { listing: { status: "draft", publishedAt: undefined } }),
      fixtureEntry("challenge-051", { listing: { status: "archived" } }),
    ]);
    assert.deepEqual(catalog.listPublished().map((challenge) => challenge.id), shippedIds);
    assert.equal(catalog.getPublishedScenario("challenge-050"), null);
    assert.equal(catalog.getPublishedScenario("challenge-051"), null);
    assert.deepEqual(
      catalog.inventory().map((item) => `${item.id}:${item.status}`),
      [...shippedIds.map((id) => `${id}:published`), "challenge-050:draft", "challenge-051:archived"],
    );
  });

  test("an incomplete draft is allowed and reports its problems; an incomplete published entry stops the build", () => {
    const incomplete = { description: "", technologies: [] as string[] };
    const catalog = createCatalog([fixtureEntry("challenge-060", { listing: { ...incomplete, status: "draft" } })]);
    assert.ok(catalog.inventory()[0].issues.length >= 2);
    assert.throws(
      () => createCatalog([fixtureEntry("challenge-061", { listing: { ...incomplete, status: "published" } })]),
      /Published challenges must pass catalog validation:[\s\S]*challenge-061/,
    );
  });

  test("duplicate ids are refused", () => {
    assert.throws(() => createCatalog([fixtureEntry("challenge-070"), fixtureEntry("challenge-070")]), /Duplicate challenge ID/);
  });

  test("order is the catalog order, whatever the registration order", () => {
    const catalog = createCatalog([fixtureEntry("challenge-010"), fixtureEntry("challenge-002"), fixtureEntry("challenge-100")]);
    assert.deepEqual(catalog.listPublished().map((challenge) => challenge.number), ["002", "010", "100"]);
  });

  test("every call returns independent copies", () => {
    const catalog = createCatalog(REGISTERED_CHALLENGES);
    const first = catalog.listPublished();
    first[0].technologies.push("Changed");
    first[0].tags.push("Changed");
    const second = catalog.listPublished();
    assert.ok(!second[0].technologies.includes("Changed") && !second[0].tags.includes("Changed"));
  });
});

describe("the shipped catalog", () => {
  test("Challenge 001 is registered first, published, valid and featured, with real metadata", () => {
    const [entry] = REGISTERED_CHALLENGES;
    assert.equal(entry.scenario, challenge001, "the scenario itself is unchanged");
    assert.deepEqual(validateCatalogEntry(entry), []);
    assert.equal(entry.listing.status, "published");
    assert.equal(entry.listing.featured, true);
    assert.deepEqual(entry.listing.technologies, ["TypeScript", "Node.js", "Express"]);
  });

  test("every shipped challenge is published and passes catalog validation", () => {
    for (const entry of REGISTERED_CHALLENGES) {
      assert.deepEqual(validateCatalogEntry(entry), [], entry.scenario.challenge.id);
      assert.equal(entry.listing.status, "published", entry.scenario.challenge.id);
    }
  });

  test("the existing catalog API keeps its contract", () => {
    assert.deepEqual(listChallengeSummaries(), REGISTERED_CHALLENGES.map((entry) => entry.scenario.challenge));
    assert.deepEqual(listChallengeSummaries()[0], challenge001.challenge);
    assert.equal(getPublicScenario("challenge-001"), challenge001);
    assert.equal(getPublicScenario("CHALLENGE-001"), null);
    assert.equal(listPublishedChallenges().length, REGISTERED_CHALLENGES.length);
    assert.ok(getCatalogInventory().every((item) => item.status === "published"));
  });

  test("published metadata reveals nothing about the answer", () => {
    const published = JSON.stringify(listPublishedChallenges());
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations", "keyEvidence", "rootCauseOptions", "files"]) {
      assert.ok(!published.includes(field), field);
    }
    assert.ok(!published.includes(provisionalAnswerKey.resolutionSummary));
    const correct = challenge001.rootCauseOptions.find((option) => option.id === provisionalAnswerKey.correctRootCauseId)!;
    assert.ok(!published.includes(correct.label), "the correct option's label");
    assert.ok(!published.includes(correct.id), "the correct option's id");
  });
});

describe("who may read the catalog", () => {
  test("only server code imports the catalog; no client component can bundle scenarios", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
    const users = walk(root)
      .filter((path) => /@\/lib\/challenge-catalog|@\/data\/catalog["']/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(root.length).replaceAll("\\", "/"))
      .sort();
    assert.deepEqual(users, [
      "app/challenges/[challengeId]/page.tsx",
      "app/challenges/page.tsx",
      "lib/challenge-catalog.ts",
      "proxy.ts",
      "server/admin/challenges.ts",
      "server/diagnosis/published.ts",
    ]);
    for (const path of users) assert.doesNotMatch(readFileSync(join(root, path), "utf8"), /["']use client["']/, path);
  });
});
