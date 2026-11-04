import type { EditorLanguage, ScenarioFile } from "@/types/workspace";

// Every ID here is a language bundled with the self-hosted Monaco build
// (public/monaco/<version>/vs), except `log`, which setupMonaco registers.
const extensionLanguages: Record<string, EditorLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  java: "java",
  // Generic SQL. A file's `language` override selects a dialect.
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  ini: "ini",
  cfg: "ini",
  properties: "ini",
  sh: "shell",
  bash: "shell",
  dockerfile: "dockerfile",
  md: "markdown",
  markdown: "markdown",
  log: "log",
  txt: "plaintext",
};

// Files recognised by their whole (lower-cased) name instead of an extension.
const fileNameLanguages: Record<string, EditorLanguage> = {
  dockerfile: "dockerfile",
};

const languageLabels: Record<EditorLanguage, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  java: "Java",
  sql: "SQL",
  mysql: "MySQL",
  pgsql: "PostgreSQL",
  json: "JSON",
  yaml: "YAML",
  xml: "XML",
  ini: "INI",
  shell: "Shell",
  dockerfile: "Dockerfile",
  markdown: "Markdown",
  log: "Log",
  plaintext: "Plain Text",
};

export const EDITOR_LANGUAGES = Object.keys(languageLabels) as EditorLanguage[];

/** Detects a file's language from its name alone. Unknown types are plain text. */
export function getFileLanguage(path: string): EditorLanguage {
  // Only the file name counts, so a dot in a folder name ("v1.2/README") is ignored.
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = fileNameLanguages[name];
  if (byName) return byName;

  const dot = name.lastIndexOf(".");
  // A leading dot marks a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return "plaintext";
  return extensionLanguages[name.slice(dot + 1)] ?? "plaintext";
}

/** The language a scenario file is shown in: its explicit override, else detection. */
export function resolveFileLanguage(file: Pick<ScenarioFile, "path" | "language">): EditorLanguage {
  return file.language ?? getFileLanguage(file.path);
}

export function getLanguageLabel(language: EditorLanguage): string {
  return languageLabels[language];
}
