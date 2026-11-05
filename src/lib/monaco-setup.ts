import type { Monaco } from "@monaco-editor/react";
import type { typescript } from "monaco-editor";

export const BUGLAB_THEME = "buglab-dark";
export const BUGLAB_LIGHT_THEME = "buglab-light";

// Monaco 0.55+ moved TS/JS language options to a top-level `typescript`
// namespace, which @monaco-editor/react's `Monaco` type doesn't include yet.
type MonacoWithTypeScript = Monaco & { typescript?: typeof typescript };

// Colours mirror the tokens in src/app/globals.css.
export const BUGLAB_THEME_RULES = [
  { token: "comment", foreground: "7d8799", fontStyle: "italic" },
  { token: "keyword", foreground: "c4a7ff" },
  { token: "string", foreground: "9ee6a8" },
  { token: "number", foreground: "fbbf24" },
  { token: "type", foreground: "67e8f9" },
  { token: "identifier", foreground: "d6dce6" },
  { token: "delimiter", foreground: "8a94a6" },
  { token: "string.key.json", foreground: "6ea8fe" },
  { token: "string.value.json", foreground: "9ee6a8" },
  { token: "keyword.md", foreground: "6ea8fe", fontStyle: "bold" },
  { token: "strong.md", fontStyle: "bold" },

  // Python, Java, SQL and config files (Monaco's built-in grammars).
  { token: "annotation", foreground: "fbbf24" },
  { token: "tag.python", foreground: "fbbf24" },
  { token: "predefined", foreground: "67e8f9" },
  { token: "operator", foreground: "c4a7ff" },
  { token: "tag", foreground: "6ea8fe" },
  { token: "attribute.name", foreground: "c4a7ff" },
  { token: "attribute.value", foreground: "9ee6a8" },
  { token: "metatag", foreground: "8a94a6" },
  { token: "type.yaml", foreground: "6ea8fe" },
  { token: "key.ini", foreground: "6ea8fe" },
  // vs-dark styles these tokens specifically, so they need their own rules.
  { token: "string.sql", foreground: "9ee6a8" },
  { token: "predefined.sql", foreground: "67e8f9" },
  { token: "operator.sql", foreground: "c4a7ff" },
  { token: "number.hex.python", foreground: "fbbf24" },
  { token: "delimiter.xml", foreground: "8a94a6" },
  { token: "metatag.xml", foreground: "8a94a6" },
  { token: "variable.dockerfile", foreground: "6ea8fe" },

  { token: "timestamp.log", foreground: "7d8799" },
  { token: "level.debug.log", foreground: "7d8799" },
  { token: "level.info.log", foreground: "67e8f9" },
  { token: "level.warn.log", foreground: "fbbf24", fontStyle: "bold" },
  { token: "level.error.log", foreground: "f87171", fontStyle: "bold" },
  { token: "source.log", foreground: "8a94a6" },
  { token: "method.log", foreground: "6ea8fe" },
  { token: "status.success.log", foreground: "4ade80" },
  { token: "status.error.log", foreground: "f87171" },
  { token: "duration.log", foreground: "7d8799" },
  { token: "key.log", foreground: "c4a7ff" },
];

export const BUGLAB_THEME_COLORS: Record<string, string> = {
  "editor.background": "#0d1117",
  "editor.foreground": "#d6dce6",
  "editorGutter.background": "#0d1117",
  "editorLineNumber.foreground": "#7d8799",
  "editorLineNumber.activeForeground": "#c3cad6",
  "editor.lineHighlightBackground": "#151a2380",
  "editor.lineHighlightBorder": "#00000000",
  "editor.selectionBackground": "#6ea8fe33",
  "editor.inactiveSelectionBackground": "#6ea8fe1f",
  "editorIndentGuide.background1": "#222a36",
  "editorIndentGuide.activeBackground1": "#2e3847",
  "editorCursor.foreground": "#6ea8fe",
  "editorWidget.background": "#151a23",
  "editorWidget.border": "#2e3847",
  "scrollbarSlider.background": "#2e384766",
  "scrollbarSlider.hoverBackground": "#2e3847aa",
  "scrollbarSlider.activeBackground": "#2e3847",
};

/*
 * The light editor: the same grammar rules with each colour swapped for a
 * deeper partner that reads on the light editor background (>= 4.5:1, checked
 * in tests/ui/accessibility.test.ts). One map keeps the two themes in step.
 */
const LIGHT_SYNTAX: Record<string, string> = {
  "7d8799": "5f6e84", // comments, timestamps, debug
  c4a7ff: "6d3fd6", // keywords, operators, attributes
  "9ee6a8": "18794e", // strings, success
  fbbf24: "975108", // numbers, annotations, warnings
  "67e8f9": "0b6a80", // types, predefined, info
  d6dce6: "14233c", // identifiers
  "8a94a6": "52627b", // delimiters, metadata
  "6ea8fe": "1d4ed8", // keys, tags, methods
  f87171: "b3202a", // errors
  "4ade80": "18794e", // success statuses
};

export const BUGLAB_LIGHT_THEME_RULES = BUGLAB_THEME_RULES.map((rule) =>
  "foreground" in rule && rule.foreground ? { ...rule, foreground: LIGHT_SYNTAX[rule.foreground] ?? rule.foreground } : rule,
);

// Colours mirror the light tokens in src/app/globals.css.
export const BUGLAB_LIGHT_THEME_COLORS: Record<string, string> = {
  "editor.background": "#f6f8fc",
  "editor.foreground": "#14233c",
  "editorGutter.background": "#f6f8fc",
  "editorLineNumber.foreground": "#5a6a82",
  "editorLineNumber.activeForeground": "#14233c",
  "editor.lineHighlightBackground": "#e3eaf680",
  "editor.lineHighlightBorder": "#00000000",
  "editor.selectionBackground": "#1d4ed82e",
  "editor.inactiveSelectionBackground": "#1d4ed81a",
  "editorIndentGuide.background1": "#dce4f0",
  "editorIndentGuide.activeBackground1": "#c3cfe0",
  "editorCursor.foreground": "#1d4ed8",
  "editorWidget.background": "#ffffff",
  "editorWidget.border": "#c3cfe0",
  "scrollbarSlider.background": "#c3cfe080",
  "scrollbarSlider.hoverBackground": "#a9b8cdaa",
  "scrollbarSlider.activeBackground": "#a9b8cd",
  // Bracket-pair colours: Monaco's light defaults include a green under 4.5:1, so they are set here.
  "editorBracketHighlight.foreground1": "#1d4ed8",
  "editorBracketHighlight.foreground2": "#6d3fd6",
  "editorBracketHighlight.foreground3": "#975108",
  "editorBracketHighlight.foreground4": "#1d4ed8",
  "editorBracketHighlight.foreground5": "#6d3fd6",
  "editorBracketHighlight.foreground6": "#975108",
  "editorBracketHighlight.unexpectedBracket.foreground": "#b3202a",
};

let configured = false;

/** Registers BugLab's dark and light themes, the `log` language, and TS options. Idempotent. */
export function setupMonaco(monaco: Monaco) {
  if (configured) return;
  configured = true;

  monaco.editor.defineTheme(BUGLAB_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: BUGLAB_THEME_RULES,
    colors: BUGLAB_THEME_COLORS,
  });
  monaco.editor.defineTheme(BUGLAB_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: BUGLAB_LIGHT_THEME_RULES,
    colors: BUGLAB_LIGHT_THEME_COLORS,
  });

  monaco.languages.register({ id: "log", extensions: [".log"] });
  monaco.languages.setMonarchTokensProvider("log", {
    tokenPostfix: ".log",
    tokenizer: {
      root: [
        [/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/, "timestamp"],
        [/\bDEBUG\b/, "level.debug"],
        [/\bINFO\b/, "level.info"],
        [/\bWARN\b/, "level.warn"],
        [/\bERROR\b/, "level.error"],
        [/\[[\w-]+\]/, "source"],
        [/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/, "method"],
        [/\b\d+ms\b/, "duration"],
        [/\b[45]\d{2}\b/, "status.error"],
        [/\b[23]\d{2}\b/, "status.success"],
        [/\b[\w.]+=/, "key"],
      ],
    },
  });

  // The scenario's npm packages don't exist in the browser, so semantic
  // errors like "Cannot find module 'express'" would only be noise.
  const ts = (monaco as MonacoWithTypeScript).typescript;
  const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
  ts?.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  ts?.javascriptDefaults.setDiagnosticsOptions(diagnostics);
}
