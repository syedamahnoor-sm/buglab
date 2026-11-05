/*
 * The light/dark theme system: how a theme is chosen, the script that applies
 * it before the first paint, the light tokens (complete, readable), the light
 * editor, and where the toggle lives. The browser journey (no flash, reload,
 * system changes) is checked separately in a real browser.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AppHeader } from "@/components/layout/AppHeader";
import { BUGLAB_LIGHT_THEME_COLORS, BUGLAB_LIGHT_THEME_RULES, BUGLAB_THEME_RULES } from "@/lib/monaco-setup";
import { parseStoredTheme, resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (path: string) => readFileSync(join(SRC, path), "utf8");
const css = source("app/globals.css");

// ---- colour helpers (WCAG 2.x) ----
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
/** `colour` at `alpha` over an opaque background (#rrggbb, or #rrggbbaa with alpha from the colour). */
function over(colour: string, background: string, alpha = parseInt(colour.slice(7, 9) || "ff", 16) / 255) {
  return `#${[1, 3, 5]
    .map((i) => Math.round(parseInt(colour.slice(i, i + 2), 16) * alpha + parseInt(background.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The custom properties declared directly in one CSS block. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block not found`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value.trim()]));
}
const dark = block(":root");
const light = block(':root[data-theme="light"]');
const hex = (tokens: Map<string, string>, name: string) => {
  const value = tokens.get(name);
  assert.ok(value && /^#[0-9a-f]{6}$/i.test(value), `${name} is not a #rrggbb colour: ${value}`);
  return value;
};

// ---- the pre-paint script, run against a fake browser ----
function browser({ stored, systemDark, storageThrows = false }: { stored?: string; systemDark: boolean; storageThrows?: boolean }) {
  const attributes = new Map<string, string>();
  const store = new Map<string, string>(stored ? [[THEME_STORAGE_KEY, stored]] : []);
  const mediaListeners: (() => void)[] = [];
  const windowListeners: Record<string, ((event: { key: string | null }) => void)[]> = {};
  const media = { matches: systemDark, addEventListener: (_: string, listener: () => void) => mediaListeners.push(listener) };
  const root = { setAttribute: (name: string, value: string) => attributes.set(name, value), style: { colorScheme: "" } };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("SecurityError");
      return store.get(key) ?? null;
    },
  };
  const window = {
    matchMedia: () => media,
    localStorage,
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) => (windowListeners[type] ??= []).push(listener),
  };
  runInNewContext(THEME_INIT_SCRIPT, { window, document: { documentElement: root } });
  return {
    theme: () => attributes.get("data-theme"),
    colorScheme: () => root.style.colorScheme,
    setSystemDark(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((listener) => listener());
    },
    otherTab(value: string | null) {
      if (value === null) store.delete(THEME_STORAGE_KEY);
      else store.set(THEME_STORAGE_KEY, value);
      windowListeners.storage?.forEach((listener) => listener({ key: THEME_STORAGE_KEY }));
    },
  };
}

describe("choosing the theme", () => {
  test("an explicit choice wins; otherwise the system decides", () => {
    assert.equal(resolveTheme(null, true), "dark");
    assert.equal(resolveTheme(null, false), "light");
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
  });

  test("only 'light' and 'dark' are accepted as a stored choice", () => {
    assert.equal(parseStoredTheme("light"), "light");
    assert.equal(parseStoredTheme("dark"), "dark");
    for (const value of [null, undefined, "", "system", "DARK", 1, {}]) assert.equal(parseStoredTheme(value), null);
  });
});

describe("the script that applies the theme before the first paint", () => {
  test("first visit follows the system: light", () => {
    const page = browser({ systemDark: false });
    assert.equal(page.theme(), "light");
    assert.equal(page.colorScheme(), "light", "native controls and scrollbars match");
  });

  test("first visit follows the system: dark", () => assert.equal(browser({ systemDark: true }).theme(), "dark"));

  test("a saved choice is applied regardless of the system", () => {
    assert.equal(browser({ stored: "light", systemDark: true }).theme(), "light");
    assert.equal(browser({ stored: "dark", systemDark: false }).theme(), "dark");
  });

  test("an unknown saved value is ignored", () => assert.equal(browser({ stored: "sepia", systemDark: false }).theme(), "light"));

  test("with no choice, a system change is followed live", () => {
    const page = browser({ systemDark: false });
    page.setSystemDark(true);
    assert.equal(page.theme(), "dark");
    page.setSystemDark(false);
    assert.equal(page.theme(), "light");
  });

  test("with a choice, a system change is ignored", () => {
    const page = browser({ stored: "light", systemDark: false });
    page.setSystemDark(true);
    assert.equal(page.theme(), "light");
  });

  test("a choice made or cleared in another tab is applied here", () => {
    const page = browser({ systemDark: false });
    page.otherTab("dark");
    assert.equal(page.theme(), "dark");
    page.otherTab(null);
    assert.equal(page.theme(), "light", "cleared: back to the system");
  });

  test("blocked storage falls back to the system instead of failing", () => {
    assert.equal(browser({ systemDark: true, storageThrows: true }).theme(), "dark");
  });

  test("it is inlined in <head>, and only <html> tolerates the attribute it adds", () => {
    const layout = source("app/layout.tsx");
    assert.match(layout, /<head>\s*\{[^}]*\}\s*<script dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\} \/>\s*<\/head>/);
    assert.match(layout, /<html[^>]*suppressHydrationWarning[^>]*>/);
    assert.equal(layout.match(/suppressHydrationWarning/g)?.length, 1);
  });
});

describe("the light tokens", () => {
  const SHARED = ["--footer", "--footer-border", "--footer-text", "--footer-muted", "--footer-accent"];

  test("every dark token has a light value, except the footer, which stays near-black by design", () => {
    const missing = [...dark.keys()].filter((name) => !light.has(name) && !SHARED.includes(name));
    assert.deepEqual(missing, []);
    for (const name of SHARED) assert.ok(!light.has(name), `${name} is redefined in light`);
    assert.equal(dark.get("--footer"), "#080a0f");
  });

  test("the footer's own colours are readable on it in both themes, and it never uses the page accent", () => {
    for (const text of ["--footer-text", "--footer-muted", "--footer-accent"]) {
      assert.ok(contrast(hex(dark, text), hex(dark, "--footer")) >= 4.5, text);
    }
    assert.doesNotMatch(source("components/layout/SiteFooter.tsx"), /(text|bg|border)-accent/);
  });

  test("the approved dark baseline is unchanged", () => {
    const baseline = { "--background": "#0b0e14", "--foreground": "#d6dce6", "--surface": "#10141b", "--accent": "#6ea8fe", "--card": "#151b26", "--panel": "#0f141c", "--card-border": "#283244" };
    for (const [name, value] of Object.entries(baseline)) assert.equal(dark.get(name), value, name);
  });

  test("the light palette follows the approved direction", () => {
    const approved = { "--background": "#edf2f9", "--card": "#ffffff", "--surface": "#ffffff", "--nav": "#ffffff", "--panel": "#e7eef8", "--foreground": "#14233c", "--muted": "#52627b", "--border": "#c8d4e5", "--accent": "#1d4ed8" };
    for (const [name, value] of Object.entries(approved)) assert.equal(light.get(name), value, name);
  });

  test("light has three distinct levels: inset panels below the canvas, white surfaces above it", () => {
    const lum = (name: string) => luminance(hex(light, name));
    assert.ok(lum("--panel") < lum("--background"), "inset panels sit below the canvas");
    assert.ok(lum("--background") < lum("--card") && lum("--background") < lum("--nav"), "cards and navigation sit above it");
    assert.ok(contrast(hex(light, "--card"), hex(light, "--background")) >= 1.1, "white surfaces stand clear of the canvas");
    assert.ok(contrast(hex(light, "--border"), hex(light, "--background")) >= 1.3, "borders read against the canvas");
    assert.match(light.get("--nav-shadow") ?? "", /rgb\(20 35 60/, "the bar lifts with a navy-tinted shadow");
  });

  test("hover and current states: dark keeps the values it always used; light has clearer, readable steps", () => {
    const unchanged = { "--hover-fill": "var(--card)", "--hover-fill-raised": "var(--card-hover)", "--nav-current": "var(--surface-raised)", "--cta-image-hover": "none", "--card-edge-tint": "38%" };
    for (const [name, value] of Object.entries(unchanged)) assert.equal(dark.get(name), value, `dark ${name}`);
    for (const fill of ["--hover-fill", "--hover-fill-raised", "--nav-current"]) {
      for (const text of ["--foreground", "--muted", "--subtle", "--accent"]) {
        const ratio = contrast(hex(light, text), hex(light, fill));
        assert.ok(ratio >= 4.5, `${text} on ${fill}: ${ratio.toFixed(2)}:1`);
      }
    }
    // Hover and current are visibly different from each other and from white.
    assert.ok(luminance(hex(light, "--nav-current")) < luminance(hex(light, "--surface-raised")), "current is a step deeper than a hovered link");
    assert.ok(contrast(hex(light, "--hover-fill"), hex(light, "--field")) >= 1.08, "a hovered chip visibly leaves white");
    const stops = [...(light.get("--cta-image-hover") ?? "").matchAll(/#[0-9a-f]{6}/gi)].map(([stop]) => stop);
    assert.ok(stops.length >= 2, "light primary actions deepen on hover");
    for (const stop of stops) assert.ok(contrast("#ffffff", stop) >= 4.5 && luminance(stop) <= luminance("#2563eb"), stop);
    assert.match(css, /@media \(hover: hover\) \{\s*\.cta-gradient:hover \{\s*background-image: var\(--cta-image-hover\);/, "hover-capable devices only");
  });

  test("dark keeps its approved navigation and fields: the page colour, no shadow", () => {
    assert.equal(dark.get("--nav"), "var(--background)");
    assert.equal(dark.get("--field"), "var(--background)");
    assert.equal(dark.get("--nav-shadow"), "none");
  });

  const surfaces = ["--background", "--surface", "--surface-raised", "--surface-sunken", "--panel", "--card", "--card-hover"];

  for (const text of ["--foreground", "--muted", "--subtle", "--accent", "--success", "--warning", "--danger", "--info"]) {
    test(`${text} is readable (AA) on every light surface`, () => {
      for (const surface of surfaces) {
        const ratio = contrast(hex(light, text), hex(light, surface));
        assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    });
  }

  test("status colours stay readable on their own 10% and 15% tints (badges, selected filters)", () => {
    for (const text of ["--accent", "--success", "--warning", "--danger", "--info"]) {
      for (const surface of surfaces) {
        for (const alpha of [0.1, 0.15]) {
          const tint = over(hex(light, text), hex(light, surface), alpha);
          const ratio = contrast(hex(light, text), tint);
          assert.ok(ratio >= 4.5, `${text} on its ${alpha * 100}% tint over ${surface}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  test("text on accent buttons is readable in both themes, and on every stop of the light CTA gradient", () => {
    assert.ok(contrast(hex(dark, "--background"), hex(dark, "--accent")) >= 4.5);
    assert.ok(contrast(hex(light, "--background"), hex(light, "--accent")) >= 4.5);
    const stops = [...(light.get("--cta-image") ?? "").matchAll(/#[0-9a-f]{6}/gi)].map(([stop]) => stop);
    assert.ok(stops.length >= 2, "the light CTA is a gradient");
    for (const stop of stops) assert.ok(contrast("#ffffff", stop) >= 4.5 && contrast(hex(light, "--background"), stop) >= 4.5, stop);
  });

  test("category hues remain visible as icons (>= 3:1) on white and on their tints", () => {
    for (const [name, value] of light) {
      if (!name.startsWith("--cat-")) continue;
      assert.ok(contrast(value, "#ffffff") >= 3, `${name} on white`);
      assert.ok(contrast(value, over(value, "#ffffff", 0.12)) >= 3, `${name} on its tint`);
    }
  });
});

describe("the light editor", () => {
  const background = BUGLAB_LIGHT_THEME_COLORS["editor.background"];
  const currentLine = over(BUGLAB_LIGHT_THEME_COLORS["editor.lineHighlightBackground"], background);

  test("covers every syntax rule of the dark editor", () => {
    assert.equal(BUGLAB_LIGHT_THEME_RULES.length, BUGLAB_THEME_RULES.length);
    BUGLAB_LIGHT_THEME_RULES.forEach((rule, index) => {
      assert.equal(rule.token, BUGLAB_THEME_RULES[index].token);
      const darkRule = BUGLAB_THEME_RULES[index];
      if ("foreground" in darkRule && darkRule.foreground) assert.notEqual((rule as { foreground?: string }).foreground, darkRule.foreground, `${rule.token} kept its dark colour`);
    });
  });

  test("every syntax colour is readable on the light editor and its current line", () => {
    for (const rule of BUGLAB_LIGHT_THEME_RULES) {
      if (!("foreground" in rule) || !rule.foreground) continue;
      for (const surface of [background, currentLine]) {
        const ratio = contrast(`#${rule.foreground}`, surface);
        assert.ok(ratio >= 4.5, `${rule.token} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test("bracket-pair colours are set and readable (Monaco's light defaults are not)", () => {
    for (const key of Object.keys(BUGLAB_LIGHT_THEME_COLORS).filter((name) => name.startsWith("editorBracketHighlight."))) {
      assert.ok(contrast(BUGLAB_LIGHT_THEME_COLORS[key], background) >= 4.5, key);
    }
    assert.ok("editorBracketHighlight.foreground1" in BUGLAB_LIGHT_THEME_COLORS);
  });

  test("line numbers are readable", () => {
    for (const key of ["editorLineNumber.foreground", "editorLineNumber.activeForeground"]) {
      for (const surface of [background, currentLine]) assert.ok(contrast(BUGLAB_LIGHT_THEME_COLORS[key], surface) >= 4.5, key);
    }
  });

  test("the editor follows the page theme", () => {
    const editor = source("components/workspace/MonacoEditor.tsx");
    assert.match(editor, /theme=\{theme === "light" \? BUGLAB_LIGHT_THEME : BUGLAB_THEME\}/);
    assert.match(source("lib/monaco-setup.ts"), /defineTheme\(BUGLAB_LIGHT_THEME, \{\s*base: "vs",/);
  });
});

describe("the toggle", () => {
  test("server markup is the same whatever the theme: a labelled button with both icons, chosen by CSS", () => {
    const markup = renderToStaticMarkup(createElement(ThemeToggle));
    assert.match(markup, /^<button type="button" aria-label="Switch colour theme" title="Switch colour theme"/);
    assert.match(markup, /class="theme-toggle-sun /);
    assert.match(markup, /class="theme-toggle-moon /);
    assert.match(markup, /focus-visible:outline-2/);
    assert.match(markup, /size-9/, "a 36px target");
    assert.match(css, /:root:not\(\[data-theme="light"\]\) \.theme-toggle-sun,\s*:root\[data-theme="light"\] \.theme-toggle-moon \{\s*opacity: 0;/);
  });

  test("is in the app header and the landing header", () => {
    assert.match(renderToStaticMarkup(createElement(AppHeader, { current: "challenges" })), /aria-label="Switch colour theme"/);
    assert.match(source("components/landing/LandingHeader.tsx"), /<ThemeToggle \/>/);
  });

  test("a choice is remembered under the theme key and applied to <html>", () => {
    const store = source("components/theme/theme-store.ts");
    assert.match(store, /window\.localStorage\.setItem\(THEME_STORAGE_KEY, theme\)/);
    assert.match(store, /document\.documentElement\.setAttribute\(THEME_ATTRIBUTE, theme\)/);
  });
});

describe("no hard-coded colours that ignore the theme", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(SRC, dir)).flatMap((name) => (statSync(join(SRC, dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

  test("components use the shadow ink, not black shadows", () => {
    for (const path of files("components").filter((file) => file.endsWith(".tsx"))) {
      assert.doesNotMatch(source(path), /rgb\(0_0_0|shadow-black/, path);
    }
  });

  test("components contain no hex colour literals", () => {
    for (const path of files("components").filter((file) => /\.tsx?$/.test(file))) {
      assert.doesNotMatch(source(path).replace(/#000\b/g, ""), /#[0-9a-f]{6}\b/i, path);
    }
  });
});
