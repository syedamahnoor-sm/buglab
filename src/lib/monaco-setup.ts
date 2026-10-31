import type { Monaco } from "@monaco-editor/react";
import type { typescript } from "monaco-editor";

export const BUGLAB_THEME = "buglab-dark";

// Monaco 0.55+ moved TS/JS language options to a top-level `typescript`
// namespace, which @monaco-editor/react's `Monaco` type doesn't include yet.
type MonacoWithTypeScript = Monaco & { typescript?: typeof typescript };

let configured = false;

/** Registers BugLab's theme, the `log` language, and TS options. Idempotent. */
export function setupMonaco(monaco: Monaco) {
  if (configured) return;
  configured = true;

  // Colours mirror the tokens in src/app/globals.css.
  monaco.editor.defineTheme(BUGLAB_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5b6576", fontStyle: "italic" },
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

      { token: "timestamp.log", foreground: "5b6576" },
      { token: "level.debug.log", foreground: "5b6576" },
      { token: "level.info.log", foreground: "67e8f9" },
      { token: "level.warn.log", foreground: "fbbf24", fontStyle: "bold" },
      { token: "level.error.log", foreground: "f87171", fontStyle: "bold" },
      { token: "source.log", foreground: "8a94a6" },
      { token: "method.log", foreground: "6ea8fe" },
      { token: "status.success.log", foreground: "4ade80" },
      { token: "status.error.log", foreground: "f87171" },
      { token: "duration.log", foreground: "5b6576" },
      { token: "key.log", foreground: "c4a7ff" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#d6dce6",
      "editorGutter.background": "#0d1117",
      "editorLineNumber.foreground": "#3f4856",
      "editorLineNumber.activeForeground": "#8a94a6",
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
    },
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
