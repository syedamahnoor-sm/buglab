import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findByData } from "@/lib/dom";

/*
 * Paths and IDs come from challenge data, which may hold quotes, backslashes and
 * brackets. Interpolated into a CSS selector, a quote made querySelector throw
 * and a backslash or bracket changed what it matched. findByData compares the
 * attribute value exactly instead, so no value is ever parsed as selector syntax.
 */

/** A stand-in for a DOM subtree: elements with attributes, and querySelectorAll for "[attr]". */
function fakeRoot(attribute: string, values: string[]) {
  const elements = values.map((value, index) => ({ index, getAttribute: (name: string) => (name === attribute ? value : null) }));
  const selectors: string[] = [];
  const root = {
    querySelectorAll(selector: string) {
      selectors.push(selector);
      return elements;
    },
  };
  return { root: root as unknown as ParentNode, elements, selectors };
}

const TRICKY = [
  'quo"te.md',
  "back\\slash.md",
  "a]b[c.ts",
  '"] , [data-path="other.md',
  "日本語/ファイル.ts",
  "emoji-🐛.md",
  "50%20off.md",
  "50 off.md",
  "a b#1?.md",
  "other.md",
];

describe("findByData", () => {
  test("finds the element whose attribute is exactly the value, for any characters", () => {
    const { root, elements } = fakeRoot("data-path", TRICKY);
    TRICKY.forEach((value, index) => {
      assert.equal(findByData(root, "data-path", value), elements[index], value);
    });
  });

  test("never matches a near miss or a selector-injection attempt", () => {
    const { root } = fakeRoot("data-option-id", ["log-01", "log-1", 'x"]', "LOG-01"]);
    assert.equal(findByData(root, "data-option-id", "log-001"), null);
    assert.equal(findByData(root, "data-option-id", 'x"] , [data-option-id="log-01'), null);
    assert.equal(findByData(root, "data-option-id", "log-01")?.getAttribute("data-option-id"), "log-01");
  });

  test("asks the DOM only for elements that have the attribute, with no value in the selector", () => {
    const { root, selectors } = fakeRoot("data-remove-id", ['log:a"b']);
    findByData(root, "data-remove-id", 'log:a"b');
    assert.deepEqual(selectors, ["[data-remove-id]"]);
  });

  test("returns null without a root or a match, and rejects attribute names that are not data-*", () => {
    assert.equal(findByData(null, "data-path", "a.ts"), null);
    assert.equal(findByData(undefined, "data-path", "a.ts"), null);
    assert.equal(findByData(fakeRoot("data-path", ["b.ts"]).root, "data-path", "a.ts"), null);
    assert.throws(() => findByData(fakeRoot("data-path", []).root, 'data-x],[id="y' as "data-x", "v"), /attribute/);
  });
});

describe("no data-derived CSS selectors", () => {
  const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });

  test("no querySelector builds an attribute selector from a value", () => {
    const offenders = files(SRC).filter((path) => /querySelector(All)?(<[^>]*>)?\(`[^`]*\[data-[a-z-]+=["']?\$\{/.test(readFileSync(path, "utf8")));
    assert.deepEqual(offenders.map((path) => path.slice(SRC.length).replaceAll("\\", "/")), []);
  });
});
