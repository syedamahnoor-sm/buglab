/*
 * useRemountKey through the hide and show of a page kept alive in a hidden
 * <Activity>, which is what Next.js does with visited pages. This is the cause
 * of the Monaco revisit bug: the editor was disposed on hide and never created
 * again on show.
 *
 * The hook's real source runs here, with "react" swapped for
 * tests/helpers/react-shim.ts for that one file (see the shim for its limits).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The project's @types/node predates module.registerHooks; this is the part used here.
interface ResolveContext {
  parentURL?: string;
}
interface ResolveResult {
  url: string;
  format?: string;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context: ResolveContext) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: ResolveContext, nextResolve: NextResolve) => ResolveResult;
  }) => unknown;
};

const shimUrl = new URL("../helpers/react-shim.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/useRemountKey.ts") && specifier === "react") {
      return { url: shimUrl, format: "module-typescript", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { renderHook } = (await import(shimUrl)) as typeof import("../helpers/react-shim");
const { useRemountKey } = await import("@/components/workspace/useRemountKey");

describe("useRemountKey", () => {
  test("keeps the same key while the component stays shown", () => {
    const hook = renderHook(() => useRemountKey());
    assert.equal(hook.result.current, 0);
    hook.show(); // effects re-running without a hide changes nothing
    assert.equal(hook.result.current, 0);
  });

  test("hiding gives a new key, rendered while still hidden, so the next show gets a fresh child", () => {
    const hook = renderHook(() => useRemountKey());
    hook.hide();
    assert.equal(hook.result.current, 1, "the key changes before the page is shown again");
    hook.show();
    assert.equal(hook.result.current, 1, "showing does not change it again");
  });

  test("every hide and show cycle gives a new key", () => {
    const hook = renderHook(() => useRemountKey());
    const keys = [hook.result.current];
    for (let cycle = 0; cycle < 5; cycle++) {
      hook.hide();
      hook.show();
      keys.push(hook.result.current);
    }
    assert.deepEqual(keys, [0, 1, 2, 3, 4, 5]);
  });

  test("a real unmount makes one update, which React ignores", () => {
    const hook = renderHook(() => useRemountKey());
    hook.unmount();
    assert.equal(hook.updatesAfterUnmount, 1);
  });
});

describe("MonacoEditor uses the key", () => {
  test("the editor is keyed by useRemountKey, so a revisit creates a new one", () => {
    const source = readFileSync(new URL("../../src/components/workspace/MonacoEditor.tsx", import.meta.url), "utf8");
    assert.match(source, /const editorKey = useRemountKey\(\);/);
    assert.match(source, /<Editor\s+key=\{editorKey\}/);
  });
});
