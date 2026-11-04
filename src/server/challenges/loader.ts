/*
 * The challenge loader. Server-only.
 *
 * A ChallengeSource produces definitions from wherever they live. Today that is the
 * existing Challenge 001 modules, wrapped in code. The loader does not care how a
 * source gets its definitions, and no source here touches storage, so a later source
 * (files, a database) is one more adapter and changes nothing downstream.
 *
 * Loading is synchronous and all-or-nothing: if any source fails, or any definition is
 * inconsistent, it throws and no registry is returned. Every error is a
 * ChallengeDefinitionError that names the source it came from. Call it when the module
 * loads, the way the existing diagnosis registry is built, so a bad definition stops the
 * server from starting instead of surprising the first learner.
 */
import "server-only";
import { ChallengeDefinitionError, type ChallengeDefinition } from "./definition";
import { createChallengeRegistry, type ChallengeRegistry } from "./registry";
import { reasonOf, shown } from "./text";

export interface ChallengeSource {
  /** Names the source in error messages. */
  readonly name: string;
  load(): readonly ChallengeDefinition[];
}

export function staticChallengeSource(name: string, definitions: readonly ChallengeDefinition[]): ChallengeSource {
  return { name, load: () => definitions };
}

/** The name of a source, or its position when it has none, without ever throwing. */
function nameOf(source: unknown, index: number): string {
  try {
    const name = (source as { name?: unknown } | null | undefined)?.name;
    if (typeof name === "string" && name.length > 0) return name;
  } catch {
    // A name that throws when read is as good as none.
  }
  return `#${index + 1}`;
}

export function loadChallengeRegistry(sources: readonly ChallengeSource[]): ChallengeRegistry {
  const definitions: ChallengeDefinition[] = [];
  const origins: string[] = [];

  if (!Array.isArray(sources)) throw new ChallengeDefinitionError(["sources must be a list"]);

  sources.forEach((source, index) => {
    // A source that is malformed (not an object, no usable name) is still reported by name or position.
    const name = nameOf(source, index);
    let loaded: unknown;
    try {
      loaded = source.load();
    } catch (error) {
      if (error instanceof ChallengeDefinitionError) throw error;
      throw new ChallengeDefinitionError([`source ${shown(name)} could not be loaded: ${reasonOf(error)}`]);
    }
    if (!Array.isArray(loaded)) {
      throw new ChallengeDefinitionError([`source ${shown(name)} did not return a list of challenge definitions`]);
    }
    for (const definition of loaded as ChallengeDefinition[]) {
      definitions.push(definition);
      origins.push(name);
    }
  });

  // Validation names each definition's source in its messages.
  return createChallengeRegistry(definitions, origins);
}
