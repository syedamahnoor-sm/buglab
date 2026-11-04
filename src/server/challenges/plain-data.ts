/*
 * What counts as "plain data", and a copy that is guaranteed to be nothing else. Server-only.
 *
 * A challenge's learner-visible content is published and fingerprinted as JSON, so it must BE
 * JSON-shaped data: strings, finite numbers, booleans, null, lists and plain objects. Anything
 * else either cannot be serialized (a BigInt, a cycle, a function), is silently changed by it
 * (NaN becomes null, a Date becomes a string, a getter is run) or is shared with its author
 * (an object that is aliased instead of copied).
 *
 * findDataIssues() reports every such value with its path, so a definition that contains one
 * is refused at startup with a ChallengeDefinitionError. clonePlainData() is the snapshot
 * everything else is made from: it runs the same check first, so it can neither throw a raw
 * TypeError nor return a value that still points into the source. The two cannot disagree: one
 * is built on the other.
 *
 * What is refused, so that a snapshot is exactly what was checked and nothing else:
 *   - getters and setters (never called: the property descriptor is inspected, not read);
 *   - proxies, which can answer differently each time they are asked;
 *   - objects whose prototype is not Object.prototype or null (class instances, Date, Map, ...);
 *   - symbol-keyed and non-enumerable properties, which a copy would silently drop;
 *   - lists with holes or extra named properties;
 *   - functions, symbols, BigInts, NaN and Infinity, cycles, and nesting deeper than any scenario.
 *
 * `undefined` is allowed as the value of an object property (an optional field that is absent)
 * and nowhere else.
 */
import "server-only";
import { types } from "node:util";
import { ChallengeDefinitionError } from "./definition";
import { shown } from "./text";

/** Deeper than any real scenario. A guard against runaway nesting, not a content rule. */
const MAX_DEPTH = 24;
const MAX_ISSUES = 20;

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** `.name` for an ordinary key, `["odd key"]` otherwise, so an authored key cannot forge a path. */
function keyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${shown(key)}]`;
}

/** Every place under `value` that is not plain data, as `<path> must be ...` messages. Empty means it is plain data. */
export function findDataIssues(value: unknown, path: string): string[] {
  const issues: string[] = [];
  const ancestors: object[] = [];

  const visit = (item: unknown, at: string, depth: number, inList: boolean): void => {
    if (issues.length >= MAX_ISSUES) return;

    switch (typeof item) {
      case "string":
      case "boolean":
        return;
      case "number":
        if (!Number.isFinite(item)) issues.push(`${at} must be a finite number`);
        return;
      case "undefined":
        if (inList) issues.push(`${at} must not be undefined`);
        return;
      case "object":
        break;
      default:
        issues.push(`${at} must be plain data, not a ${typeof item}`);
        return;
    }
    if (item === null) return;

    if (ancestors.includes(item)) {
      issues.push(`${at} refers back to one of its own parents`);
      return;
    }
    if (depth >= MAX_DEPTH) {
      issues.push(`${at} is nested more than ${MAX_DEPTH} levels deep`);
      return;
    }

    // A proxy can answer differently each time it is asked, so nothing read through one can be trusted.
    if (types.isProxy(item)) {
      issues.push(`${at} must be plain data, not a proxy`);
      return;
    }

    ancestors.push(item);
    if (Array.isArray(item)) {
      // Dense means every index is an own property and nothing else is: no holes, no extra named properties.
      if (Object.keys(item).length !== item.length || Reflect.ownKeys(item).length !== item.length + 1) {
        issues.push(`${at} must be a plain list, with no holes and no extra properties`);
      } else {
        for (let index = 0; index < item.length; index += 1) visit(item[index], `${at}[${index}]`, depth + 1, true);
      }
    } else if (!isPlainObject(item)) {
      issues.push(`${at} must be a plain object, a list or a primitive value`);
    } else if (Reflect.ownKeys(item).length !== Object.keys(item).length) {
      // A symbol key or a non-enumerable property would be dropped by a copy, so it would be validated but never published.
      issues.push(`${at} must not have symbol-keyed or non-enumerable properties`);
    } else {
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) {
          issues.push(`${keyPath(at, key)} must be a plain value, not a getter or setter`);
          continue;
        }
        visit(descriptor.value, keyPath(at, key), depth + 1, false);
      }
    }
    ancestors.pop();
  };

  visit(value, path, 0, false);
  return issues;
}

/** Defines an own property, so a key such as "__proto__" stays data and never reaches the prototype. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function copy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copy);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) define(result, key, copy((value as Record<string, unknown>)[key]));
    return result;
  }
  return value;
}

/**
 * A deep copy of plain data that shares no object with `value`. Throws a ChallengeDefinitionError,
 * naming `path`, if `value` is not plain data. The source is only read: it is never frozen or changed.
 */
export function clonePlainData<T>(value: T, path: string): T {
  const issues = findDataIssues(value, path);
  if (issues.length > 0) throw new ChallengeDefinitionError(issues);
  return copy(value) as T;
}
