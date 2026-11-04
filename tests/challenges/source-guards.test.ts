/*
 * Static guards on the challenge loader's source: it stays on the server, adds no
 * public API, builds the public view by allow-list, and wraps Challenge 001 without
 * copying its data.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = join(ROOT, "src/server/challenges");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, "utf8");
const name = (path: string) => relative(ROOT, path).replaceAll("\\", "/");

/** The code with comments removed, so a guard does not trip over prose. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = sourceFiles(DIR);

describe("challenge loader: source guards", () => {
  test("the module contains exactly its documented files", () => {
    assert.deepEqual(files.map(name).sort(), [
      "src/server/challenges/challenge-001.ts",
      "src/server/challenges/default-registry.ts",
      "src/server/challenges/definition.ts",
      "src/server/challenges/fields.ts",
      "src/server/challenges/limits.ts",
      "src/server/challenges/loader.ts",
      "src/server/challenges/paths.ts",
      "src/server/challenges/plain-data.ts",
      "src/server/challenges/public-view.ts",
      "src/server/challenges/read-only.ts",
      "src/server/challenges/registry.ts",
      "src/server/challenges/structure.ts",
      "src/server/challenges/text.ts",
      "src/server/challenges/timestamps.ts",
      "src/server/challenges/validate.ts",
      "src/server/challenges/version.ts",
    ]);
  });

  test("every file is server-only", () => {
    for (const path of files) {
      assert.match(withoutComments(read(path)).trimStart(), /^import "server-only";/, name(path));
    }
  });

  test("nothing outside src/server can import it, and nothing under src/app does: no public API", () => {
    const outside = sourceFiles(join(ROOT, "src")).filter((path) => !name(path).startsWith("src/server/"));
    for (const path of outside) {
      assert.doesNotMatch(read(path), /server\/challenges/, name(path));
    }
    assert.ok(outside.some((path) => name(path).startsWith("src/app/")));
  });

  test("the existing diagnosis route, handler, evaluator, validator and registry do not import it", () => {
    const untouched = [
      "src/app/api/challenges/[challengeId]/diagnosis/route.ts",
      "src/server/diagnosis/handler.ts",
      "src/server/diagnosis/evaluate.ts",
      "src/server/diagnosis/registry.ts",
      "src/lib/diagnosis/validate.ts",
      // The session service is checked in tests/session/source-guards.test.ts, so that this suite
      // does not read a file that only exists once the session module does.
    ];
    for (const path of untouched) assert.doesNotMatch(read(join(ROOT, path)), /server\/challenges/, path);
  });

  test("the public view never spreads a definition, scenario or part of one", () => {
    const code = withoutComments(read(join(DIR, "public-view.ts")));
    assert.doesNotMatch(code, /\.\.\.\s*(definition|scenario|evaluation|challenge|request|file|entry|option|header)\s*[,}\])]/);
  });

  test("the public view does not know the evaluation configuration exists", () => {
    const code = withoutComments(read(join(DIR, "public-view.ts")));
    assert.doesNotMatch(code, /evaluation|answer-key|EvaluationConfig|correctRootCauseId|keyObservation/i);
  });

  test("the version is computed from the public view, never from the evaluation configuration", () => {
    const registry = withoutComments(read(join(DIR, "registry.ts")));
    assert.match(registry, /contentVersionOf\(definition\.revision, publicChallenge\)/);
    assert.doesNotMatch(withoutComments(read(join(DIR, "version.ts"))), /evaluation|answer/i);
  });

  test("the Challenge 001 adapter wraps the existing modules and copies no scenario data", () => {
    const code = withoutComments(read(join(DIR, "challenge-001.ts")));
    assert.match(code, /from "@\/data\/challenge-001"/);
    assert.match(code, /from "@\/data\/challenge-001\/answer-key\.server"/);
    assert.doesNotMatch(code, /\blog-\d|\breq-\d|\bpath:|\blabel:|\btimestamp:/);
  });

  test("the registry never hands out a raw Map or Set: its collections go through the read-only views", () => {
    const code = withoutComments(read(join(DIR, "registry.ts")));
    assert.match(code, /return Object\.freeze\(\{/);
    assert.match(code, /new ReadOnlyMap\(diagnosis\)/);
    for (const set of ["rootCauseIds", "logIds", "requestIds"]) {
      assert.match(code, new RegExp(String.raw`new ReadOnlySet\(validation\.${set}\)`));
    }
    assert.match(code, /new ReadOnlySet\(observation\.evidenceIds\)/);
    // The raw collections are local to the builder: none is returned or exposed.
    assert.doesNotMatch(code, /diagnosisRegistry:\s*diagnosis\b|return\s+(publicById|versions|diagnosis)\b/);
  });

  test("the read-only views hold their data in a #private field, extend nothing and define no mutator", () => {
    const code = withoutComments(read(join(DIR, "read-only.ts")));
    assert.match(code, /readonly #entries: Map/);
    assert.match(code, /readonly #items: Set/);
    assert.doesNotMatch(code, /class\s+\w+(<[^>]*>)?\s+extends\b/);
    assert.doesNotMatch(code, /^\s*(set|add|delete|clear)\s*\(/m);
    for (const frozen of ["ReadOnlyMap.prototype", "ReadOnlyMap", "ReadOnlySet.prototype", "ReadOnlySet"]) {
      assert.match(code, new RegExp(String.raw`Object\.freeze\(${frozen.replace(".", String.raw`\.`)}\)`));
    }
    assert.equal((code.match(/Object\.freeze\(this\)/g) ?? []).length, 2);
  });

  test("messages never repeat an authored value raw: it goes through text.ts, not a quote and an interpolation", () => {
    // `"${value}"` and JSON.stringify(value) both skip the bounding and the control-character escaping.
    const guarded = ["validate.ts", "loader.ts", "structure.ts", "registry.ts", "plain-data.ts", "fields.ts", "paths.ts", "timestamps.ts", "limits.ts"];
    for (const file of guarded) {
      const code = withoutComments(read(join(DIR, file)));
      assert.doesNotMatch(code, /"\$\{/, `${file}: a quoted raw interpolation`);
      // limits.ts measures the size of the scenario with it: see the next test.
      if (file !== "limits.ts") assert.doesNotMatch(code, /JSON\.stringify\(/, `${file}: JSON.stringify of an authored value`);
    }
  });

  test("limits.ts uses JSON.stringify only to measure a size, never to build a message", () => {
    const code = withoutComments(read(join(DIR, "limits.ts")));
    assert.equal((code.match(/JSON\.stringify\(/g) ?? []).length, 1);
    assert.match(code, /byteLength\(JSON\.stringify\(scenario\)\)/);
  });

  test("the loader looks at no extension and names no language: it limits size, never kind", () => {
    for (const file of ["paths.ts", "limits.ts", "timestamps.ts", "fields.ts"]) {
      const code = withoutComments(read(join(DIR, file)));
      assert.doesNotMatch(code, /\.(ts|tsx|js|jsx|py|sql|java|md)["'`]/i, `${file}: names an extension in code`);
      assert.doesNotMatch(code, /\bextname\b|endsWith\(["'`]\.[a-z]/, `${file}: inspects an extension`);
    }
  });

  test("the public view is built from a deep copy, so it aliases nothing and freezes nothing the author owns", () => {
    const code = withoutComments(read(join(DIR, "public-view.ts")));
    assert.match(code, /clonePlainData\(/);
    // The only freeze is of the copy, never of the source.
    assert.match(code, /return deepFreeze\(clonePlainData\(/);
    assert.doesNotMatch(code, /\.\.\.\s*challenge\.tags|\[\s*\.\.\.\s*challenge/);
  });

  test("the default registry loads exactly the list the revision-pin test reads", () => {
    const code = withoutComments(read(join(DIR, "default-registry.ts")));
    assert.match(code, /export const defaultChallengeSources/);
    assert.match(code, /loadChallengeRegistry\(defaultChallengeSources\)/);
    assert.doesNotMatch(code, /loadChallengeRegistry\(\[/, "the default registry must not carry a second, private list");
  });

  test("the loader touches no storage, network or process state", () => {
    for (const path of files) {
      assert.doesNotMatch(withoutComments(read(path)), /node:fs|node:child_process|\bfetch\(|process\.env|globalThis|\bconsole\s*\./, name(path));
    }
  });
});
