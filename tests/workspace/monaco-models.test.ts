import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  MODEL_URI_ROOT,
  getModelUri,
  releaseModels,
  syncModel,
  type MonacoModelHost,
  type TextModel,
} from "@/lib/monaco-models";

/*
 * A stand-in for the parts of Monaco that lib/monaco-models.ts uses. Like
 * Monaco, it keeps one page-wide model registry keyed by the URI's string
 * form, and Uri.parse decodes the path while toString re-encodes it.
 */
function createFakeMonaco() {
  const models = new Map<string, TextModel>();
  const editors: { model: TextModel | null }[] = [];
  const languageSetters = new WeakMap<TextModel, (languageId: string) => void>();

  function parse(value: string) {
    const url = new URL(value);
    return { path: decodeURIComponent(url.pathname), toString: () => url.href };
  }

  const host = {
    Uri: { parse },
    editor: {
      getModel: (uri) => models.get(uri.toString()) ?? null,
      createModel(value, language, uri) {
        const key = uri.toString();
        assert.ok(!models.has(key), `a model for ${key} already exists`);
        let text = value;
        let languageId = language;
        let disposed = false;
        const model: TextModel = {
          uri,
          getValue: () => text,
          setValue: (next) => void (text = next),
          getLanguageId: () => languageId,
          isDisposed: () => disposed,
          dispose() {
            disposed = true;
            models.delete(key);
          },
        };
        languageSetters.set(model, (id) => void (languageId = id));
        models.set(key, model);
        return model;
      },
      getModels: () => [...models.values()],
      getEditors: () => editors.map((editor) => ({ getModel: () => editor.model })),
      setModelLanguage: (model, id) => languageSetters.get(model)!(id),
    },
  } satisfies MonacoModelHost;

  /** What @monaco-editor/react does for a path: reuse any model, else create one. */
  function getOrCreate(uri: string, value: string, language: string) {
    return host.editor.getModel(parse(uri)) ?? host.editor.createModel(value, language, parse(uri));
  }

  function showInEditor(model: TextModel | null) {
    const editor = { model };
    editors.push(editor);
    return editor;
  }

  return { host, models, getOrCreate, showInEditor };
}

describe("model URIs", () => {
  test("name the challenge and the file", () => {
    assert.equal(getModelUri("challenge-001", "src/server.ts"), `${MODEL_URI_ROOT}challenge-001/src/server.ts`);
  });

  test("differ between challenges for the same path", () => {
    assert.notEqual(getModelUri("challenge-001", "src/main.py"), getModelUri("challenge-002", "src/main.py"));
  });

  test("keep the file extension last, for the TypeScript worker", () => {
    assert.ok(getModelUri("challenge-001", "src/App.jsx").endsWith("/App.jsx"));
    assert.ok(getModelUri("challenge-001", "src/App.tsx").endsWith("/App.tsx"));
  });

  test("encode characters that would change the URI's meaning", () => {
    const uri = getModelUri("challenge-001", "notes/a b#1?.md");
    assert.equal(uri, `${MODEL_URI_ROOT}challenge-001/notes/a%20b%231%3F.md`);
    assert.equal(new URL(uri).hash, "");
    assert.equal(new URL(uri).search, "");
  });

  test("ignore leading and repeated slashes in a path", () => {
    assert.equal(getModelUri("c", "/src//a.ts"), getModelUri("c", "src/a.ts"));
  });

  test("reject IDs and paths that can't identify a file", () => {
    for (const id of ["", "a/b", "a\\b"]) assert.throws(() => getModelUri(id, "a.ts"), /challenge ID/);
    for (const path of ["", "/", "//"]) assert.throws(() => getModelUri("c", path), /file path/);
  });
});

/*
 * Literal percent signs, checked with Monaco's own URI class: Monaco decodes a
 * model URI's path, so a file named "50%20off.md" must not turn into
 * "50 off.md" or share a model with it.
 */
describe("model URIs with literal percent signs (Monaco's URI parser)", () => {
  type MonacoUri = { path: string; toString(): string };
  const monacoUri = new URL("../../node_modules/monaco-editor/esm/vs/base/common/uri.js", import.meta.url);
  const load = async () => (await import(monacoUri.href)) as { URI: { parse(value: string): MonacoUri } };
  const filePath = (uri: MonacoUri) => uri.path.slice("/challenges/c1/".length);

  test("50%20off.md keeps its %20 and is not decoded into a space", async () => {
    const { URI } = await load();
    const uri = getModelUri("c1", "docs/50%20off.md");
    assert.equal(uri, `${MODEL_URI_ROOT}c1/docs/50%2520off.md`);
    assert.equal(filePath(URI.parse(uri)), "docs/50%20off.md");
  });

  test("50%20off.md and 50 off.md are different models", async () => {
    const { URI } = await load();
    const literal = URI.parse(getModelUri("c1", "50%20off.md"));
    const spaced = URI.parse(getModelUri("c1", "50 off.md"));
    assert.equal(filePath(literal), "50%20off.md");
    assert.equal(filePath(spaced), "50 off.md");
    assert.notEqual(literal.toString(), spaced.toString());
  });

  test("the model for 50%20off.md is the one selected, whichever file was opened first", () => {
    const { host, models } = createFakeMonaco();
    const literal = { uri: getModelUri("c1", "50%20off.md"), content: "literal percent", language: "markdown" } as const;
    const spaced = { uri: getModelUri("c1", "50 off.md"), content: "real space", language: "markdown" } as const;
    const a = syncModel(host, literal);
    const b = syncModel(host, spaced);
    assert.notEqual(a, b);
    assert.equal(models.size, 2);
    assert.equal(syncModel(host, literal), a, "reopening selects the same model");
    assert.equal(syncModel(host, literal).getValue(), "literal percent");
    assert.equal(syncModel(host, spaced).getValue(), "real space");
  });

  test("percent escapes, Unicode, nesting and special characters all round-trip without collisions", async () => {
    const { URI } = await load();
    const paths = [
      "50%20off.md",
      "50 off.md",
      "100%.md",
      "a%zz.md",
      "%41.md",
      "A.md",
      "a%2fb.md",
      "a/b.md",
      "%2e%2e/x.md",
      "%252e.md",
      "caf%C3%A9.md",
      "café.md",
      "日本語/ファイル.ts",
      "emoji-🐛.md",
      'quo"te.md',
      "notes/a b#1?.md",
      "src/deep/nested/path/file.ts",
    ];
    const keys = new Map<string, string>();
    for (const path of paths) {
      const uri = URI.parse(getModelUri("c1", path));
      assert.equal(filePath(uri), path, `round-trips: ${path}`);
      const key = uri.toString();
      assert.equal(keys.get(key), undefined, `${path} collides with ${keys.get(key)}`);
      keys.set(key, path);
    }
  });
});

describe("model sync", () => {
  test("creates a model with the file's content and language", () => {
    const { host } = createFakeMonaco();
    const model = syncModel(host, { uri: getModelUri("c1", "q.sql"), content: "SELECT 1;", language: "pgsql" });
    assert.equal(model.getValue(), "SELECT 1;");
    assert.equal(model.getLanguageId(), "pgsql");
  });

  test("reuses an up-to-date model", () => {
    const { host } = createFakeMonaco();
    const source = { uri: getModelUri("c1", "a.py"), content: "print(1)", language: "python" } as const;
    assert.equal(syncModel(host, source), syncModel(host, source));
  });

  test("replaces stale content and language in an existing model", () => {
    const { host } = createFakeMonaco();
    const uri = getModelUri("c1", "query.sql");
    const first = syncModel(host, { uri, content: "old", language: "sql" });
    const second = syncModel(host, { uri, content: "new", language: "mysql" });
    assert.equal(second, first);
    assert.equal(second.getValue(), "new");
    assert.equal(second.getLanguageId(), "mysql");
  });

  test("recreates a model that was disposed", () => {
    const { host } = createFakeMonaco();
    const source = { uri: getModelUri("c1", "a.ts"), content: "x", language: "typescript" } as const;
    const first = syncModel(host, source);
    first.dispose();
    const second = syncModel(host, source);
    assert.notEqual(second, first);
    assert.equal(second.getValue(), "x");
  });
});

describe("model isolation between challenges", () => {
  test("the same path in two challenges gets two models", () => {
    const { host, models } = createFakeMonaco();
    const a = syncModel(host, { uri: getModelUri("c1", "src/main.py"), content: "# one", language: "python" });
    const b = syncModel(host, { uri: getModelUri("c2", "src/main.py"), content: "# two", language: "python" });
    assert.notEqual(a, b);
    assert.equal(a.getValue(), "# one");
    assert.equal(b.getValue(), "# two");
    assert.equal(models.size, 2);
  });

  test("switching challenges shows the new challenge's file, not the old one", () => {
    const fake = createFakeMonaco();
    // Challenge 1 is shown, then the learner opens challenge 2 with the same path.
    const shown1 = fake.getOrCreate(getModelUri("c1", "src/App.java"), "class One {}", "java");
    const uri2 = getModelUri("c2", "src/App.java");
    syncModel(fake.host, { uri: uri2, content: "class Two {}", language: "java" });
    const shown2 = fake.getOrCreate(uri2, "class Two {}", "java");
    assert.equal(shown1.getValue(), "class One {}");
    assert.equal(shown2.getValue(), "class Two {}");
  });

  test("an unscoped URI (the previous behaviour) would show stale code", () => {
    // Documents the bug the scoped URIs fix: the library reuses the old model.
    const fake = createFakeMonaco();
    fake.getOrCreate("file:///src/App.java", "class One {}", "java");
    assert.equal(fake.getOrCreate("file:///src/App.java", "class Two {}", "java").getValue(), "class One {}");
  });

  test("syncing one challenge never changes another challenge's model", () => {
    const { host } = createFakeMonaco();
    const a = syncModel(host, { uri: getModelUri("c1", "a.sql"), content: "A", language: "sql" });
    syncModel(host, { uri: getModelUri("c2", "a.sql"), content: "B", language: "pgsql" });
    assert.equal(a.getValue(), "A");
    assert.equal(a.getLanguageId(), "sql");
  });
});

describe("model release", () => {
  function setUp() {
    const fake = createFakeMonaco();
    const sync = (challenge: string, path: string) =>
      syncModel(fake.host, { uri: getModelUri(challenge, path), content: path, language: "plaintext" });
    return { ...fake, sync };
  }

  test("disposes models of closed tabs and keeps open ones", () => {
    const { host, sync } = setUp();
    const open = sync("c1", "a.ts");
    const closed = sync("c1", "b.ts");
    assert.equal(releaseModels(host, [getModelUri("c1", "a.ts")]), 1);
    assert.ok(!open.isDisposed());
    assert.ok(closed.isDisposed());
  });

  test("never disposes a model shown in a live editor", () => {
    const { host, sync, showInEditor } = setUp();
    const active = sync("c1", "a.ts");
    showInEditor(active);
    assert.equal(releaseModels(host, []), 0);
    assert.ok(!active.isDisposed());
  });

  test("after switching challenges, disposes the old challenge's models", () => {
    const { host, sync, showInEditor } = setUp();
    const old1 = sync("c1", "src/main.py");
    const old2 = sync("c1", "README.md");
    const editor = showInEditor(old1);
    // The editor now shows challenge 2's file.
    editor.model = sync("c2", "src/main.py");
    assert.equal(releaseModels(host, [getModelUri("c2", "src/main.py")]), 2);
    assert.ok(old1.isDisposed() && old2.isDisposed());
    assert.ok(!editor.model.isDisposed());
  });

  test("leaves models outside the scenario root alone", () => {
    const { host, sync } = setUp();
    const own = sync("c1", "a.ts");
    const other = host.editor.createModel("x", "plaintext", host.Uri.parse("inmemory://model/1"));
    const otherFile = host.editor.createModel("y", "plaintext", host.Uri.parse("file:///src/a.ts"));
    assert.equal(releaseModels(host, []), 1);
    assert.ok(own.isDisposed());
    assert.ok(!other.isDisposed());
    assert.ok(!otherFile.isDisposed());
  });

  test("matches kept URIs regardless of how they are encoded", () => {
    const { host, sync } = setUp();
    const model = sync("c1", "notes/a b.md");
    assert.equal(releaseModels(host, [`${MODEL_URI_ROOT}c1/notes/a%20b.md`]), 0);
    assert.ok(!model.isDisposed());
  });

  test("is safe to repeat", () => {
    const { host, sync } = setUp();
    sync("c1", "a.ts");
    assert.equal(releaseModels(host, []), 1);
    assert.equal(releaseModels(host, []), 0);
  });
});

describe("editor wiring", () => {
  const source = readFileSync(new URL("../../src/components/workspace/MonacoEditor.tsx", import.meta.url), "utf8");

  test("every model URI comes from getModelUri", () => {
    assert.doesNotMatch(source, /file:\/\//);
    assert.match(source, /path=\{uri\}/);
    assert.match(source, /const uri = getModelUri\(challengeId, path\)/);
  });

  test("the model is synced before the library looks it up", () => {
    assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?syncModel\(/);
    assert.match(source, /function handleBeforeMount[\s\S]*?syncModel\(/);
  });
});
