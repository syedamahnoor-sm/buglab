/*
 * Static checks that the answer key and evaluation logic can only be reached
 * from server-only modules. (The post-build bundle scan is a separate step.)
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rootCauseOptions } from "@/data/challenge-001/diagnosis-options";
import { CORRECT_ID } from "./fixtures";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

const SERVER_ONLY_PATHS = [/^server\//, /\.server\.ts$/, /^app\/api\//, /^app\/account\/layout\.tsx$/];
const isServerOnlyPath = (path: string) => SERVER_ONLY_PATHS.some((pattern) => pattern.test(path));

describe("answer-key confidentiality", () => {
  test("the account layout that reads authentication is explicitly server-only", () => {
    assert.match(files.find(({ path }) => path === "app/account/layout.tsx")!.text, /^import "server-only";$/m);
  });
  test("only server-only modules import the answer key or server diagnosis code", () => {
    const offenders = files
      .filter(({ path }) => !isServerOnlyPath(path))
      .filter(({ text }) => /from\s+["'][^"']*(answer-key|@\/server\/)/.test(text))
      .map(({ path }) => path);
    assert.deepEqual(offenders, []);
  });

  test("every server module and answer key starts with import \"server-only\"", () => {
    const missing = files
      .filter(({ path }) => /^server\//.test(path) || /\.server\.ts$/.test(path))
      .filter(({ text }) => !/^import "server-only";$/m.test(text))
      .map(({ path }) => path);
    assert.deepEqual(missing, []);
  });

  test("no client-reachable module contains a 'use client' import chain to server code", () => {
    const clientFiles = files.filter(({ text }) => /^"use client";/m.test(text));
    assert.ok(clientFiles.length > 0);
    for (const { path, text } of clientFiles) {
      assert.equal(/@\/server\/|answer-key/.test(text), false, path);
    }
  });

  test("public root-cause options carry no correctness information", () => {
    for (const option of rootCauseOptions) {
      assert.deepEqual(Object.keys(option).sort(), ["description", "id", "label"]);
    }
    // The correct option is a valid, listed choice, but not marked or first.
    assert.ok(rootCauseOptions.some((option) => option.id === CORRECT_ID));
    assert.notEqual(rootCauseOptions[0].id, CORRECT_ID);
  });

  test("the correctness field name never appears outside server-only code", () => {
    const offenders = files
      .filter(({ path }) => !isServerOnlyPath(path))
      .filter(({ text }) => /correctRootCauseId|resolutionSummary|keyEvidence|keyObservation/.test(text))
      .map(({ path }) => path);
    assert.deepEqual(offenders, []);
  });
});
