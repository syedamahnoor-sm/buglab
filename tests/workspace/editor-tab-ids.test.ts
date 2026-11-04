import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getTabId } from "@/components/workspace/EditorTabs";

/*
 * Each editor tab's DOM id is derived from its file path, and the editor panel
 * names itself after the active tab (aria-labelledby). The old derivation
 * replaced every non-alphanumeric character with "-", so a-b.ts, a_b.ts and
 * a.b.ts shared one id: focus, scrolling and the panel's name could land on the
 * wrong tab. The id must be different for every path.
 */
describe("editor tab ids", () => {
  test("a-b.ts, a_b.ts and a.b.ts get different ids", () => {
    const ids = ["a-b.ts", "a_b.ts", "a.b.ts"].map(getTabId);
    assert.equal(new Set(ids).size, 3, ids.join(" "));
  });

  test("punctuation, separators, percent signs and non-Latin names never collide", () => {
    const paths = [
      "a-b.ts", "a_b.ts", "a.b.ts", "a b.ts", "a/b.ts", "a\\b.ts", 'a"b.ts', "a]b.ts", "a--b.ts", "a-2d-b.ts",
      "ab.ts", "a.b-ts", "50%20off.md", "50 off.md", "日本語.ts", "ファイル.ts", "Ab.ts", "AB.ts", "src/a-b.ts", "src-a-b.ts",
    ];
    const ids = paths.map(getTabId);
    assert.equal(new Set(ids).size, paths.length);
  });

  test("random paths never collide", () => {
    const alphabet = "aA0-_./ %\"\\[]é日🐛";
    const chars = Array.from(alphabet);
    const seen = new Map<string, string>();
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 5000; i++) {
      const length = 1 + Math.floor(random() * 8);
      const path = Array.from({ length }, () => chars[Math.floor(random() * chars.length)]).join("");
      const id = getTabId(path);
      const other = seen.get(id);
      if (other !== undefined && other !== path) assert.fail(`${JSON.stringify(path)} and ${JSON.stringify(other)} share ${id}`);
      seen.set(id, path);
    }
  });

  test("ids are stable, keep their prefix and use only characters safe in an id and a CSS #selector", () => {
    for (const path of ["INCIDENT.md", "src/routes/auth.ts", 'quo"te.md', "日本語/ファイル.ts", "50%20off.md"]) {
      const id = getTabId(path);
      assert.equal(id, getTabId(path), "deterministic");
      assert.match(id, /^editor-tab-[A-Za-z0-9-]+$/, path);
    }
  });
});

/*
 * Why getTabId cannot collide. The string iterator yields one code point per
 * well-formed surrogate pair and a lone surrogate's own value otherwise, so
 * distinct strings give distinct code-point sequences. Each code point then
 * becomes itself (ASCII letters and digits) or "-<hex>-" (everything else, "-"
 * included), so a bare "-" only ever delimits a code. That has an exact inverse,
 * written out below: an injective function is one with a left inverse.
 */
function decodeTabId(id: string): string {
  assert.ok(id.startsWith("editor-tab-"), id);
  const body = id.slice("editor-tab-".length);
  let out = "";
  for (let i = 0; i < body.length; ) {
    if (body[i] !== "-") {
      out += body[i++];
      continue;
    }
    const end = body.indexOf("-", i + 1);
    assert.ok(end > i + 1, `unterminated code in ${id}`);
    const hex = body.slice(i + 1, end);
    assert.match(hex, /^[0-9a-f]+$/, id);
    out += String.fromCodePoint(parseInt(hex, 16));
    i = end + 1;
  }
  return out;
}

describe("editor tab ids are injective", () => {
  const tricky = [
    "",
    "-",
    "--",
    "-2d-",
    "a-2d-b",
    "0",
    "\u0000",
    "é",
    "é",
    "é".normalize("NFD"),
    "Å",
    "Å",
    "🐛",
    "👩‍💻",
    "👩‍💻",
    "🇵🇰",
    "\uD83D",
    "\uDC1B",
    "\uDC1B\uD83D",
    "🐛",
    "file​name.ts",
    "﻿bom.ts",
    "a\tb\nc.ts",
    'q"u\\o]t[e.ts',
    "50%20off.md",
    "%41.md",
    "A.md",
    "日本語/ファイル.ts",
    "ﬁle.ts",
    "fi" + "le.ts",
    "x".repeat(300),
  ];

  test("every id decodes back to exactly its path", () => {
    for (const path of tricky) assert.equal(decodeTabId(getTabId(path)), path, JSON.stringify(path));
  });

  test("lookalike, normalisation and surrogate variants all get different ids", () => {
    const ids = new Map<string, string>();
    for (const path of new Set(tricky)) {
      const id = getTabId(path);
      assert.equal(ids.get(id), undefined, `${JSON.stringify(path)} collides with ${JSON.stringify(ids.get(id))}`);
      ids.set(id, path);
    }
  });

  test("exhaustively: every single UTF-16 code unit, lone surrogates included, has its own id", () => {
    const seen = new Set<string>();
    for (let unit = 0; unit <= 0xffff; unit++) {
      const path = String.fromCharCode(unit);
      const id = getTabId(path);
      assert.ok(!seen.has(id), `U+${unit.toString(16)}`);
      seen.add(id);
      assert.equal(decodeTabId(id), path);
    }
  });

  test("exhaustively: every string of up to 4 characters over a delimiter-heavy alphabet", () => {
    // "-", hex digits and letters next to codes are where a parse could go wrong.
    const alphabet = ["-", "2", "d", "a", "f", "0", "_", ".", "é", "🐛"];
    const seen = new Map<string, string>();
    const walk = (prefix: string, depth: number) => {
      const id = getTabId(prefix);
      const other = seen.get(id);
      assert.ok(other === undefined || other === prefix, `${JSON.stringify(prefix)} and ${JSON.stringify(other)}`);
      seen.set(id, prefix);
      assert.equal(decodeTabId(id), prefix);
      if (depth === 0) return;
      for (const char of alphabet) walk(prefix + char, depth - 1);
    };
    walk("", 4);
    assert.equal(seen.size, (10 ** 5 - 1) / 9); // 1 + 10 + 100 + 1000 + 10000 distinct strings
  });
});
