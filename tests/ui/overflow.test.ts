import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getDisambiguatingFolders, getFolderPrefix } from "@/lib/file-tree";
import { revealOffset } from "@/lib/scroll";

describe("editor tab labels", () => {
  test("unique file names get no folder suffix", () => {
    assert.equal(getDisambiguatingFolders(["src/server.ts", "src/routes/auth.ts"]).size, 0);
  });

  test("duplicate names are told apart by their nearest distinct folder", () => {
    const folders = getDisambiguatingFolders([
      "src/routes/index.ts",
      "src/lib/index.ts",
      "src/server.ts",
    ]);
    assert.deepEqual(Object.fromEntries(folders), {
      "src/routes/index.ts": "routes",
      "src/lib/index.ts": "lib",
    });
  });

  test("uses more folders when the parent folder name also repeats", () => {
    const folders = getDisambiguatingFolders(["api/v1/index.ts", "web/v1/index.ts"]);
    assert.equal(folders.get("api/v1/index.ts"), "api/v1");
    assert.equal(folders.get("web/v1/index.ts"), "web/v1");
  });

  test("a root-level file is labelled ./", () => {
    const folders = getDisambiguatingFolders(["index.ts", "src/index.ts"]);
    assert.equal(folders.get("index.ts"), "./");
    assert.equal(folders.get("src/index.ts"), "src");
  });

  test("the footer splits a path into folder and file name", () => {
    assert.equal(getFolderPrefix("src/middleware/authenticate.ts"), "src/middleware/");
    assert.equal(getFolderPrefix("INCIDENT.md"), "");
  });
});

describe("scrolling the active tab into view", () => {
  // Viewport of 200px, currently scrolled to 100 (shows 100..300).
  test("leaves a fully visible tab alone", () => {
    assert.equal(revealOffset(100, 200, 150, 80), 100);
  });

  test("scrolls back for a tab cut off on the left", () => {
    assert.equal(revealOffset(100, 200, 60, 80), 60);
  });

  test("scrolls forward just enough for a tab cut off on the right", () => {
    assert.equal(revealOffset(100, 200, 260, 80), 140);
  });

  test("aligns a tab wider than the viewport to its start", () => {
    assert.equal(revealOffset(0, 200, 300, 250), 300);
  });
});
