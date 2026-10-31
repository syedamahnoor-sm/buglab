import type { EditorLanguage } from "@/types/workspace";

const extensionLanguages: Record<string, EditorLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  md: "markdown",
  json: "json",
  log: "log",
};

const languageLabels: Record<EditorLanguage, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  markdown: "Markdown",
  json: "JSON",
  log: "Log",
  plaintext: "Plain Text",
};

export function getFileLanguage(path: string): EditorLanguage {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return extensionLanguages[extension] ?? "plaintext";
}

export function getLanguageLabel(language: EditorLanguage): string {
  return languageLabels[language];
}
