import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCatalogEntry } from "@/lib/catalog/validate";
import type { CatalogEntry } from "@/types/catalog";
import { fixtureEntry } from "./fixtures";

const fieldsOf = (entry: CatalogEntry) => validateCatalogEntry(entry).map((issue) => issue.field);

describe("catalog metadata contract", () => {
  test("a complete entry has no issues", () => {
    assert.deepEqual(validateCatalogEntry(fixtureEntry("challenge-200")), []);
  });

  const cases: [string, Parameters<typeof fixtureEntry>[1], string][] = [
    ["slug differs from id", { listing: { slug: "other" } }, "slug"],
    ["id with spaces", { summary: { id: "Bad Id" }, listing: { slug: "Bad Id" } }, "id"],
    ["short number", { summary: { number: "7" } }, "number"],
    ["blank title", { summary: { title: " " } }, "title"],
    ["title too long", { summary: { title: "x".repeat(81) } }, "title"],
    ["unknown difficulty", { summary: { difficulty: "expert" as never } }, "difficulty"],
    ["zero minutes", { summary: { estimatedMinutes: 0 } }, "estimatedMinutes"],
    ["fractional minutes", { summary: { estimatedMinutes: 12.5 } }, "estimatedMinutes"],
    ["duplicate tags", { summary: { tags: ["HTTP", "http"] } }, "tags"],
    ["short description", { listing: { description: "Too short." } }, "description"],
    ["padded description", { listing: { description: " A description with a leading space here. " } }, "description"],
    ["unknown category", { listing: { category: "mobile" as never } }, "category"],
    ["no technologies", { listing: { technologies: [] } }, "technologies"],
    ["too many technologies", { listing: { technologies: Array.from({ length: 9 }, (_, i) => `T${i}`) } }, "technologies"],
    ["blank technology", { listing: { technologies: ["Go", " "] } }, "technologies"],
    ["unknown status", { listing: { status: "live" as never } }, "status"],
    ["featured not boolean", { listing: { featured: "yes" as never } }, "featured"],
    ["impossible date", { listing: { publishedAt: "2026-02-30" } }, "publishedAt"],
    ["published without a date", { listing: { publishedAt: undefined } }, "publishedAt"],
    ["fix-mode challenge", { summary: { completion: "fix" } }, "completion"],
  ];
  for (const [name, options, field] of cases) {
    test(`${name} -> ${field}`, () => assert.ok(fieldsOf(fixtureEntry("challenge-201", options)).includes(field), name));
  }

  test("a draft needs no publish date", () => {
    assert.deepEqual(fieldsOf(fixtureEntry("challenge-202", { listing: { status: "draft", publishedAt: undefined } })), []);
  });

  test("a scenario that cannot be played is refused", () => {
    const entry = fixtureEntry("challenge-203");
    assert.ok(fieldsOf({ ...entry, scenario: { ...entry.scenario, files: [] } }).includes("files"));
    assert.ok(fieldsOf({ ...entry, scenario: { ...entry.scenario, entryFilePath: "missing.ts" } }).includes("entryFilePath"));
    assert.ok(fieldsOf({ ...entry, scenario: { ...entry.scenario, rootCauseOptions: [] } }).includes("rootCauseOptions"));
  });
});
