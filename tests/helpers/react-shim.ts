/*
 * A minimal stand-in for the three React hooks that useDiagnosisSubmission uses
 * (useState, useRef, useEffect), with a small driver, renderHook.
 *
 * Why it exists: the project has no DOM or component-test library, and React's
 * server renderer never runs effects or state updates. Swapping React for this
 * stand-in lets a test run the hook's REAL source through submit, abort, retry
 * and unmount. It is deliberately tiny and is not a general React replacement:
 * it supports only these three hooks, runs effects after each render, and treats
 * a state update after unmount as something to COUNT (real React silently drops
 * it), so a test can assert that none happened.
 *
 * It does not model batching, StrictMode or concurrent rendering. Behaviour that
 * depends on those still needs a real renderer.
 */
interface Slot {
  value?: unknown;
  current?: unknown;
  deps?: readonly unknown[];
  cleanup?: () => void;
}

interface Runtime {
  slots: Slot[];
  setters: Array<(next: unknown) => void>;
  cursor: number;
  unmounted: boolean;
  updatesAfterUnmount: number;
  pendingEffects: Array<() => void>;
  rerender: () => void;
}

let active: Runtime | null = null;

function runtime(): Runtime {
  if (!active) throw new Error("A hook was called outside renderHook");
  return active;
}

export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void] {
  const rt = runtime();
  const index = rt.cursor++;
  const slot = (rt.slots[index] ??= {
    value: typeof initial === "function" ? (initial as () => S)() : initial,
  });
  rt.setters[index] ??= (next) => {
    if (rt.unmounted) {
      rt.updatesAfterUnmount += 1;
      return;
    }
    slot.value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slot.value) : next;
    rt.rerender();
  };
  return [slot.value as S, rt.setters[index] as (next: S | ((previous: S) => S)) => void];
}

export function useRef<T>(initial: T): { current: T } {
  const rt = runtime();
  const index = rt.cursor++;
  const slot = (rt.slots[index] ??= { current: initial });
  return slot as { current: T };
}

export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
  const rt = runtime();
  const index = rt.cursor++;
  const slot = (rt.slots[index] ??= {});
  const previous = slot.deps;
  const changed =
    !previous ||
    !deps ||
    previous.length !== deps.length ||
    deps.some((dep, position) => !Object.is(dep, previous[position]));
  if (!changed) return;
  slot.deps = deps;
  rt.pendingEffects.push(() => {
    slot.cleanup?.();
    const cleanup = effect();
    slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  });
}

export function renderHook<T>(callback: () => T) {
  const rt: Runtime = {
    slots: [],
    setters: [],
    cursor: 0,
    unmounted: false,
    updatesAfterUnmount: 0,
    pendingEffects: [],
    rerender: () => {},
  };
  const result = { current: undefined as T };

  function render() {
    rt.cursor = 0;
    active = rt;
    try {
      result.current = callback();
    } finally {
      active = null;
    }
    for (const run of rt.pendingEffects.splice(0)) run();
  }

  rt.rerender = render;
  render();

  return {
    result,
    unmount() {
      rt.unmounted = true;
      for (const slot of rt.slots) slot.cleanup?.();
    },
    get updatesAfterUnmount() {
      return rt.updatesAfterUnmount;
    },
  };
}
