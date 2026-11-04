/*
 * Read-only views of a Map and a Set. Server-only.
 *
 * Object.freeze() does not make a Map or a Set immutable: it freezes the object's own
 * properties, and set(), delete(), clear() and add() keep working on the contents.
 * These classes are the fix. Each one holds a private COPY of its data in a #private
 * field that nothing outside the class can reach, and has no method that changes it:
 *
 *   - there is no set(), delete(), clear() or add() to call (calling one is a TypeError);
 *   - Map.prototype.set.call(view, ...) is a TypeError too, because the view is not a Map
 *     and has no map data of its own to write to;
 *   - the instance, the prototype and the class are frozen, so methods cannot be replaced;
 *   - forEach() hands callbacks the view, never the backing collection.
 *
 * They implement ReadonlyMap and ReadonlySet, so code written against those types (the
 * diagnosis handler, the evaluator and the learner-session service) works unchanged.
 * They are not `instanceof Map` or `instanceof Set` on purpose: code that needed a real,
 * mutable Map should not be handed one.
 *
 * What they do not protect: the VALUES. A view of objects hands out the objects, so those
 * must be frozen by whoever builds the view (the registry does).
 *
 * Known limits, all consequences of keeping the data in a #private field:
 *   - Inspection: util.inspect() / console.log() show the contents, through a custom inspector
 *     that returns a string (it never hands out the backing collection).
 *   - Equality: assert.deepStrictEqual() and similar compare own enumerable properties, and a
 *     view has none, so two views with DIFFERENT contents compare equal. Compare their contents
 *     instead: [...view] or [...view.entries()].
 *   - Cloning: structuredClone(view) returns an empty object, because private fields are not
 *     cloned, and JSON.stringify(view) is "{}". Neither is an error, so neither can be relied on.
 *     Convert first: new Map(view), new Set(view), [...view].
 * Nothing in the diagnosis handler, the evaluator or the session service does any of these.
 */
import "server-only";

/** What util.inspect() looks for. Registered by name so this file needs no import from node:util. */
const INSPECT: unique symbol = Symbol.for("nodejs.util.inspect.custom") as never;

type Inspect = (value: unknown, options?: unknown) => string;

/** Prints the contents as util.inspect prints a Map or Set, under the view's own name. */
function inspected(name: string, copy: unknown, options: unknown, inspect: Inspect): string {
  return inspect(copy, options).replace(/^(Map|Set)/, name);
}

export class ReadOnlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #entries: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#entries.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  entries() {
    return this.#entries.entries();
  }

  keys() {
    return this.#entries.keys();
  }

  values() {
    return this.#entries.values();
  }

  [Symbol.iterator]() {
    return this.#entries[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ReadOnlyMap";
  }

  // Returns a string built from a throwaway copy: the backing collection never leaves the class.
  [INSPECT](_depth: number, options: unknown, inspect: Inspect): string {
    return inspected("ReadOnlyMap", new Map(this.#entries), options, inspect);
  }
}

export class ReadOnlySet<T> implements ReadonlySet<T> {
  readonly #items: Set<T>;

  constructor(items: Iterable<T>) {
    this.#items = new Set(items);
    Object.freeze(this);
  }

  get size(): number {
    return this.#items.size;
  }

  has(value: T): boolean {
    return this.#items.has(value);
  }

  forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    this.#items.forEach((value) => callback.call(thisArg, value, value, this));
  }

  entries() {
    return this.#items.entries();
  }

  keys() {
    return this.#items.keys();
  }

  values() {
    return this.#items.values();
  }

  [Symbol.iterator]() {
    return this.#items[Symbol.iterator]();
  }

  // The algebra methods return new, independent Sets: the caller owns the result.
  union<U>(other: ReadonlySetLike<U>) {
    return this.#items.union(other);
  }

  intersection<U>(other: ReadonlySetLike<U>) {
    return this.#items.intersection(other);
  }

  difference<U>(other: ReadonlySetLike<U>) {
    return this.#items.difference(other);
  }

  symmetricDifference<U>(other: ReadonlySetLike<U>) {
    return this.#items.symmetricDifference(other);
  }

  isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    return this.#items.isSubsetOf(other);
  }

  isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    return this.#items.isSupersetOf(other);
  }

  isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    return this.#items.isDisjointFrom(other);
  }

  get [Symbol.toStringTag](): string {
    return "ReadOnlySet";
  }

  [INSPECT](_depth: number, options: unknown, inspect: Inspect): string {
    return inspected("ReadOnlySet", new Set(this.#items), options, inspect);
  }
}

// The prototype and the class are frozen too, or a method could be swapped out from outside.
Object.freeze(ReadOnlyMap.prototype);
Object.freeze(ReadOnlyMap);
Object.freeze(ReadOnlySet.prototype);
Object.freeze(ReadOnlySet);
