/*
 * Sprint 6 integration audit: the public catalog, the live diagnosis registry
 * and Habin's challenge registry must agree, unpublished challenges must stay
 * unreachable, and the catalog must scale to the planned 30 challenges in six
 * categories without UI changes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplorerView } from "@/components/challenge/library/ExplorerView";
import { CATEGORIES } from "@/data/catalog/categories";
import { createCatalog } from "@/lib/catalog/catalog";
import { categoryCounts, EMPTY_QUERY, technologyOptions } from "@/lib/catalog/discovery";
import { getPublicScenario, listChallengeSummaries } from "@/lib/challenge-catalog";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { publishedChallengeIds, restrictToPublished } from "@/server/diagnosis/published";
import { createDefaultRegistry, type DiagnosisRegistry } from "@/server/diagnosis/registry";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import type { CategoryId } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import { post } from "../diagnosis/fixtures";
import { fixtureEntry } from "./fixtures";

const published = listChallengeSummaries().map((challenge) => challenge.id).sort();
const toPlain = (value: unknown) => JSON.parse(JSON.stringify(value));
const sets = (value: Iterable<string>) => [...value].sort();

describe("the three registries cannot drift apart", () => {
  test("every published challenge has an answer key in the live diagnosis registry, built from the same scenario", () => {
    const diagnosis = createDefaultRegistry();
    for (const id of published) {
      const entry = diagnosis.get(id);
      assert.ok(entry, `${id} is published but has no answer key: it would be playable but unsubmittable`);
      const scenario = getPublicScenario(id)!;
      assert.deepEqual(sets(entry.validation.rootCauseIds), sets(scenario.rootCauseOptions.map((option) => option.id)), id);
      assert.deepEqual(sets(entry.validation.logIds), sets(scenario.logs.map((log) => log.id)), id);
      assert.deepEqual(sets(entry.validation.requestIds), sets(scenario.network.map((request) => request.id)), id);
    }
  });

  test("the live endpoint accepts exactly the published challenges", () => {
    assert.deepEqual(sets(restrictToPublished(createDefaultRegistry()).keys()), published);
  });

  test("Habin's registry lists the same challenge IDs and the same public content, with a content version for each", () => {
    const registry = createDefaultChallengeRegistry();
    assert.deepEqual(registry.list().map((summary) => summary.id).sort(), published);
    assert.deepEqual(sets(registry.diagnosisRegistry.keys()), published);
    for (const id of published) {
      assert.deepEqual(toPlain(registry.getPublic(id)), toPlain(getPublicScenario(id)), `${id}: public content differs`);
      assert.match(registry.contentVersion(id) ?? "", /^\S+\+\S+$/, `${id}: content version`);
    }
  });

  test("the live route serves only the published part of the registry", () => {
    const route = readFileSync(new URL("../../src/app/api/challenges/[challengeId]/diagnosis/route.ts", import.meta.url), "utf8");
    assert.match(route, /registry: restrictToPublished\(createDefaultRegistry\(\)\)/);
  });
});

describe("unpublished challenges are unreachable", () => {
  // A registry that also holds an answer key for an unpublished challenge, as a mistake or a work in progress would.
  const withDraft: DiagnosisRegistry = new Map([
    ...createDefaultRegistry(),
    ["challenge-099", { ...createDefaultRegistry().get("challenge-001")!, challengeId: "challenge-099" }],
  ]);
  const handler = (registry: DiagnosisRegistry) =>
    createDiagnosisHandler({
      registry,
      wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: 600_000 }),
      ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: 600_000 }),
      trustedProxyHops: 0,
      appOrigin: null,
    });

  test("without the gate the draft would be submittable (the gap this audit closed)", async () => {
    const { response } = await post(handler(withDraft), { challengeId: "challenge-099" });
    assert.equal(response.status, 200);
  });

  test("with the gate, the draft is an unknown challenge (404) and Challenge 001 is unchanged", async () => {
    const gated = handler(restrictToPublished(withDraft, publishedChallengeIds()));
    const draft = await post(gated, { challengeId: "challenge-099" });
    assert.equal(draft.response.status, 404);
    assert.equal(draft.response.headers.get("set-cookie"), null, "no attempt cookie for an unpublished challenge");
    const live = await post(gated);
    assert.equal(live.response.status, 200);
    assert.equal(live.json.status, "incorrect");
  });

  test("the gate keeps the handler's check order: 415 and 403 still come first", async () => {
    const gated = handler(restrictToPublished(withDraft, publishedChallengeIds()));
    assert.equal((await post(gated, { challengeId: "challenge-099", headers: { "content-type": "text/plain" } })).response.status, 415);
    assert.equal((await post(gated, { challengeId: "challenge-099", headers: { origin: "https://evil.example" } })).response.status, 403);
  });

  test("drafts and archived entries have no public scenario, route or proxy path", () => {
    const catalog = createCatalog([
      fixtureEntry("challenge-120", { listing: { status: "draft", publishedAt: undefined } }),
      fixtureEntry("challenge-121", { listing: { status: "archived" } }),
    ]);
    assert.deepEqual(catalog.listPublished(), []);
    assert.equal(catalog.getPublishedScenario("challenge-120"), null);
    assert.equal(catalog.getPublishedScenario("challenge-121"), null);
    // Routes and the proxy are generated from the published list only.
    const page = readFileSync(new URL("../../src/app/challenges/[challengeId]/page.tsx", import.meta.url), "utf8");
    const proxy = readFileSync(new URL("../../src/proxy.ts", import.meta.url), "utf8");
    assert.match(page, /listChallengeSummaries\(\)\.map/);
    assert.match(page, /getPublicScenario\(/);
    assert.match(proxy, /listChallengeSummaries\(\)\.map/);
  });
});

describe("the catalog scales to 30 challenges in six categories", () => {
  const categories = CATEGORIES.map((category) => category.id);
  const difficulties: Difficulty[] = ["beginner", "intermediate", "advanced"];
  const entries = Array.from({ length: 30 }, (_, index) => {
    const n = String(index + 1).padStart(3, "0");
    return fixtureEntry(`challenge-${n}`, {
      summary: { number: n, difficulty: difficulties[index % 3], title: `Scenario ${n}` },
      listing: {
        category: categories[index % 6] as CategoryId,
        technologies: [["Go", "Python", "Java", "TypeScript", "SQL", "Rust"][index % 6], "Docker"],
        publishedAt: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`,
        featured: index === 0,
      },
    });
  });
  const catalog = createCatalog(entries);
  const challenges = catalog.listPublished();

  test("six categories, each with five challenges, from metadata alone", () => {
    assert.equal(CATEGORIES.length, 6);
    assert.equal(challenges.length, 30);
    assert.deepEqual(categoryCounts(challenges).map((category) => category.count), [5, 5, 5, 5, 5, 5]);
    assert.equal(technologyOptions(challenges).length, 7);
  });

  test("the library renders all 30 with every section and unique ids, with no UI change", () => {
    const markup = renderToStaticMarkup(createElement(ExplorerView, { challenges, query: EMPTY_QUERY, onQueryChange: () => {} }));
    for (const heading of ["Featured investigation", "Recommended for you", "Beginner-friendly", "All investigations"]) {
      assert.ok(markup.includes(heading), heading);
    }
    const allSection = markup.slice(markup.indexOf('aria-labelledby="all-heading"'));
    assert.equal(allSection.match(/<article/g)?.length, 30);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids");
    for (const category of CATEGORIES) assert.ok(markup.includes(`>${category.label.replaceAll("&", "&amp;")}<`), category.label);
  });
});
