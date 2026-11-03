import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { challenge001 } from "@/data/challenge-001";
import {
  EDITOR_LANGUAGES,
  getFileLanguage,
  getLanguageLabel,
  resolveFileLanguage,
} from "@/lib/file-language";
import type { EditorLanguage } from "@/types/workspace";

const MONACO_VS = fileURLToPath(new URL("../../node_modules/monaco-editor/min/vs/", import.meta.url));

describe("file language detection", () => {
  const cases: [string, EditorLanguage][] = [
    ["src/server.ts", "typescript"],
    ["src/App.tsx", "typescript"],
    ["src/config.mts", "typescript"],
    ["public/login.js", "javascript"],
    ["src/Button.jsx", "javascript"],
    ["scripts/build.mjs", "javascript"],
    ["eslint.config.cjs", "javascript"],
    ["app/main.py", "python"],
    ["stubs/client.pyi", "python"],
    ["src/main/java/com/acme/OrderService.java", "java"],
    ["db/migrations/001_init.sql", "sql"],
    ["package.json", "json"],
    ["docker-compose.yml", "yaml"],
    [".github/workflows/ci.yaml", "yaml"],
    ["pom.xml", "xml"],
    ["src/main/resources/application.properties", "ini"],
    ["setup.cfg", "ini"],
    ["scripts/deploy.sh", "shell"],
    ["Dockerfile", "dockerfile"],
    ["api.dockerfile", "dockerfile"],
    ["INCIDENT.md", "markdown"],
    ["logs/app.log", "log"],
    ["requirements.txt", "plaintext"],
  ];
  for (const [path, language] of cases) {
    test(`${path} is ${language}`, () => assert.equal(getFileLanguage(path), language));
  }

  test("extensions and well-known names are case-insensitive", () => {
    assert.equal(getFileLanguage("SRC/MAIN.PY"), "python");
    assert.equal(getFileLanguage("Query.SQL"), "sql");
    assert.equal(getFileLanguage("docker/DOCKERFILE"), "dockerfile");
  });

  test("only the file name counts, not dots in folder names", () => {
    assert.equal(getFileLanguage("releases/v1.2/README"), "plaintext");
    assert.equal(getFileLanguage("app.v2/handler.py"), "python");
  });

  test("dotfiles, extensionless and unknown files are plain text", () => {
    for (const path of [".gitignore", ".env", "Makefile", "LICENSE", "pyproject.toml", "build.gradle", "notes."]) {
      assert.equal(getFileLanguage(path), "plaintext", path);
    }
  });
});

describe("language overrides", () => {
  test("an override replaces the detected language", () => {
    assert.equal(resolveFileLanguage({ path: "db/report.sql", language: "pgsql" }), "pgsql");
    assert.equal(resolveFileLanguage({ path: "db/report.sql", language: "mysql" }), "mysql");
    assert.equal(resolveFileLanguage({ path: "scripts/run", language: "shell" }), "shell");
    assert.equal(resolveFileLanguage({ path: "notes.md", language: "plaintext" }), "plaintext");
  });

  test("without an override the language is detected", () => {
    assert.equal(resolveFileLanguage({ path: "db/report.sql" }), "sql");
    assert.equal(resolveFileLanguage({ path: "db/report.sql", language: undefined }), "sql");
  });

  test("SQL dialects have distinct labels", () => {
    assert.equal(getLanguageLabel("sql"), "SQL");
    assert.equal(getLanguageLabel("mysql"), "MySQL");
    assert.equal(getLanguageLabel("pgsql"), "PostgreSQL");
  });
});

describe("language support", () => {
  test("every language has a label", () => {
    for (const language of EDITOR_LANGUAGES) assert.ok(getLanguageLabel(language), language);
  });

  // Languages are loaded lazily from the self-hosted copy of min/vs, so each
  // one must be registered there. `log` is registered by setupMonaco and
  // `plaintext` is built into the editor core.
  test("every language is registered by the self-hosted Monaco build", () => {
    const registrations = [
      ...readdirSync(MONACO_VS).filter((name) => name.endsWith(".js")).map((name) => join(MONACO_VS, name)),
      join(MONACO_VS, "basic-languages", "monaco.contribution.js"),
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    for (const language of EDITOR_LANGUAGES) {
      if (language === "log" || language === "plaintext") continue;
      assert.ok(registrations.includes(`id:"${language}"`), `Monaco does not register "${language}"`);
    }
  });

  test("Challenge 001's files keep the languages they had before", () => {
    // The mapping before multi-language support, for the extensions 001 uses.
    const previous: Record<string, EditorLanguage> = {
      ts: "typescript",
      js: "javascript",
      md: "markdown",
      json: "json",
      log: "log",
    };
    for (const file of challenge001.files) {
      const extension = file.path.slice(file.path.lastIndexOf(".") + 1);
      assert.ok(previous[extension], `${file.path} has an extension this test doesn't cover`);
      assert.equal(file.language, undefined, `${file.path} has an override`);
      assert.equal(resolveFileLanguage(file), previous[extension], file.path);
    }
  });
});
