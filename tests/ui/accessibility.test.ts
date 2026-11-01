import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { neighborAfterRemoval, triggerHadFocus } from "@/lib/focus";
import { BUGLAB_THEME_COLORS, BUGLAB_THEME_RULES } from "@/lib/monaco-setup";

// WCAG 2.x relative luminance and contrast ratio for #rrggbb colours.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Composites #rrggbbaa over an opaque #rrggbb background. */
function over(foreground: string, background: string) {
  const alpha = parseInt(foreground.slice(7, 9) || "ff", 16) / 255;
  return `#${[1, 3, 5]
    .map((i) => {
      const value =
        parseInt(foreground.slice(i, i + 2), 16) * alpha +
        parseInt(background.slice(i, i + 2), 16) * (1 - alpha);
      return Math.round(value).toString(16).padStart(2, "0");
    })
    .join("")}`;
}

const AA_NORMAL_TEXT = 4.5;

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
function token(name: string) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `--${name} not found in globals.css`);
  return match[1];
}

describe("colour contrast (WCAG AA, normal text)", () => {
  const surfaces = ["background", "surface", "surface-raised", "surface-sunken"];

  for (const text of ["foreground", "muted", "subtle"]) {
    test(`--${text} is readable on every workspace surface`, () => {
      for (const surface of surfaces) {
        const ratio = contrast(token(text), token(surface));
        assert.ok(ratio >= AA_NORMAL_TEXT, `--${text} on --${surface}: ${ratio.toFixed(2)}:1`);
      }
    });
  }

  test("Monaco line numbers are readable on the editor and current-line backgrounds", () => {
    const background = BUGLAB_THEME_COLORS["editor.background"];
    const currentLine = over(BUGLAB_THEME_COLORS["editor.lineHighlightBackground"], background);
    for (const key of ["editorLineNumber.foreground", "editorLineNumber.activeForeground"]) {
      for (const surface of [background, currentLine]) {
        const ratio = contrast(BUGLAB_THEME_COLORS[key], surface);
        assert.ok(ratio >= AA_NORMAL_TEXT, `${key} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test("every Monaco syntax colour is readable on the editor background", () => {
    const background = BUGLAB_THEME_COLORS["editor.background"];
    for (const rule of BUGLAB_THEME_RULES) {
      if (!("foreground" in rule) || !rule.foreground) continue;
      const ratio = contrast(`#${rule.foreground}`, background);
      assert.ok(ratio >= AA_NORMAL_TEXT, `${rule.token}: ${ratio.toFixed(2)}:1`);
    }
  });
});

describe("focus after removal", () => {
  test("moves to the next item, else the previous one", () => {
    assert.equal(neighborAfterRemoval(["a", "b", "c"], "a"), "b");
    assert.equal(neighborAfterRemoval(["a", "b", "c"], "b"), "c");
    assert.equal(neighborAfterRemoval(["a", "b", "c"], "c"), "b");
  });

  test("returns null when the list becomes empty or the id is unknown", () => {
    assert.equal(neighborAfterRemoval(["a"], "a"), null);
    assert.equal(neighborAfterRemoval([], "a"), null);
    assert.equal(neighborAfterRemoval(["a", "b"], "z"), null);
  });

  test("never restores focus outside a browser", () => {
    assert.equal(triggerHadFocus({ currentTarget: {} as EventTarget }), false);
  });
});
