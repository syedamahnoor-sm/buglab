/*
 * The path policy for scenario files. Server-only.
 *
 * A file path names a node in a virtual file tree that the workspace builds by splitting on "/"
 * (src/lib/file-tree.ts). Nothing here touches a real file system, but a path is shown to
 * learners, used as an evidence and editor key, and may one day be written out, so it must mean
 * exactly one thing. The policy is STRICT and it REFUSES, never repairs: a path is published
 * exactly as the author wrote it, so there is no second, "cleaned" form for two people to
 * disagree about.
 *
 * A path is refused when it is:
 *   - blank, or longer than the limits in limits.ts (total length, segment length, depth);
 *   - containing a control character, or an invisible or direction-changing one (zero-width
 *     characters, bidirectional overrides, line and paragraph separators);
 *   - containing a backslash;
 *   - not in Unicode NFC, because the same visible name can be written in more than one form;
 *   - written with look-alike characters for "/", "\" or "." that a compatibility fold would turn
 *     into the real thing (the fullwidth solidus and reverse solidus, the fullwidth full stop). The
 *     division slash and the fraction slash have no such mapping: they are ordinary characters,
 *     because the file tree splits only on "/";
 *   - absolute: a leading "/" (an empty first segment) or a drive letter such as "C:";
 *   - containing an empty segment (a trailing or doubled "/");
 *   - containing a "." or ".." segment;
 *   - containing a segment with leading or trailing whitespace, or a trailing dot, which a
 *     Windows file system would silently strip, making two names the same.
 *
 * PERCENT SIGNS ARE LITERAL (approved). A path is never URL-decoded by this module, by the registry
 * or by the file tree: "50%20off.md" is a file whose name has a percent sign in it, it is published
 * as written, and it is valid, as are "100%.md" and "caf%C3%A9.md".
 *
 * One consumer does decode, though, and it is why a percent-escape is not simply ignored. The
 * workspace opens each file in Monaco under the model URI `file:///<path>`
 * (src/components/workspace/MonacoEditor.tsx), and Monaco's URI parser percent-decodes it (verified
 * against monaco-editor's own uri.js by tests/challenges/paths.test.ts). Left alone, that would let a
 * literal name act as another path inside the editor: "a%2fb.md" would open the same buffer as the
 * file "a/b.md", "50%20off.md" the same as "50 off.md", and "%2e%2e/x.md" would become "../x.md".
 * So the traversal, separator and collision protections are applied to the decoded form as well:
 *   - a percent-escape is refused if decoding it, the way Monaco does and repeatedly, yields a
 *     path this policy refuses (a "/", a backslash, a "." or ".." segment, a control or invisible
 *     character, a drive letter, a non-NFC name, a look-alike). That covers %2e, %2f, %5c, %00 and
 *     double-encoded forms such as %252e. A percent-escape that decodes to something harmless,
 *     such as a space or an accented letter, is accepted;
 *   - two paths whose decoded forms are the same path collide, because they would share an editor buffer.
 * If the editor ever builds its model URI from the path with each segment encoded, the decoded checks
 * stop being needed and can be removed, leaving percent signs purely literal.
 *
 * Across a challenge's files, two paths are refused as colliding when they differ only in case,
 * in a Unicode form or in percent-encoding (a case-insensitive file system, an NFD/NFC difference
 * or the editor's decoding would make them one file), and when one is a file and the other lives
 * inside it as if it were a folder.
 *
 * Nothing here looks at an extension. A file may be .ts, .py, .sql, .java or anything else: the
 * language is the workspace's decision from the file's name, not a rule of the loader.
 *
 * Not checked, because it is a platform rule and the files are virtual: Windows reserved device
 * names (CON, NUL, COM1) and the characters < > : " | ? * (a ":" is refused only as a drive letter).
 */
import "server-only";
import { LIMITS } from "./limits";
import { shown } from "./text";

/** Controls (C0, DEL, C1), format characters (zero-width, bidi), and line/paragraph separators. */
const INVISIBLE = new RegExp("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", "u");
const DRIVE_LETTER = /^[A-Za-z]:/;

/** Monaco's own pattern for a run of percent-escapes (monaco-editor/esm/vs/base/common/uri.js). Not only hex: a bad escape just stays. */
const ESCAPE_RUN = /(%[0-9A-Za-z][0-9A-Za-z])+/g;
/** More than this many levels of percent-encoding is not a name, it is an attempt to hide something. */
const MAX_DECODE_ROUNDS = 4;

const isBlank = (value: string) => value.trim().length === 0;

/**
 * Monaco's decodeURIComponentGraceful, copied exactly (monaco-editor 0.57, esm/vs/base/common/uri.js). A run that
 * cannot be decoded as a whole is not decoded at all at its first escape, which stays as written, and the rest of
 * the run is tried again. So an escape beside a broken one can stay undecoded: "%41%c0" is left exactly as it is.
 */
function decodeGraceful(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.length > 3 ? text.slice(0, 3) + decodeGraceful(text.slice(3)) : text;
  }
}

/**
 * One round of what the editor does to a path: every run of percent-escapes is decoded, the rest is left
 * alone. Exported so a test can hold it equal to Monaco's own parser. Nothing in the loader publishes or
 * stores its result: it is only ever used to judge a path.
 */
export function decodePercentEscapes(path: string): string {
  return path.replace(ESCAPE_RUN, (run) => decodeGraceful(run));
}

/** The path as the editor would finally see it: decoded round after round until nothing changes (or the bound is hit). */
function fullyDecoded(path: string): string {
  let current = path;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const next = decodePercentEscapes(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Every rule that looks at the path as written, with percent signs as ordinary characters. */
function literalProblem(path: string): string | null {
  if (isBlank(path)) return "must not be blank";
  if (INVISIBLE.test(path)) return "must not contain control, invisible or direction-changing characters";
  if (path.includes("\\")) return 'must not contain a backslash; separate folders with "/"';
  if (path !== path.normalize("NFC")) return "must be written in Unicode NFC form";
  if (DRIVE_LETTER.test(path)) return 'must be relative: it must not start with a drive letter such as "C:"';

  const segments = path.split("/");
  if (segments.some((segment) => segment === "")) {
    return 'must not have an empty segment (no leading, trailing or doubled "/", so it is relative)';
  }
  if (segments.some((segment) => segment === "." || segment === "..")) return 'must not contain a "." or ".." segment';

  // Look-alikes: a compatibility fold turns the fullwidth solidus into "/" and the fullwidth full stop into ".".
  const folded = path.normalize("NFKC");
  const foldedSegments = folded.split("/");
  if (
    folded.includes("\\") ||
    foldedSegments.length !== segments.length ||
    foldedSegments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return 'must not use look-alike characters for "/", "\\" or "."';
  }

  if (segments.some((segment) => segment !== segment.trim())) return "must not have a segment with leading or trailing whitespace";
  if (segments.some((segment) => segment.endsWith("."))) return "must not have a segment that ends with a dot";

  if (path.length > LIMITS.pathLength) return `must be at most ${LIMITS.pathLength} characters long`;
  if (segments.length > LIMITS.pathDepth) return `must be at most ${LIMITS.pathDepth} folders deep`;
  if (segments.some((segment) => segment.length > LIMITS.pathSegmentLength)) {
    return `must have no segment longer than ${LIMITS.pathSegmentLength} characters`;
  }
  return null;
}

/** A malformed path, as a sentence that follows the path ("must not ..."), or null when it is acceptable. */
export function pathProblem(path: string): string | null {
  const own = literalProblem(path);
  if (own) return own;

  // The path itself is fine as a literal. Now: what would the editor make of it?
  let current = path;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const next = decodePercentEscapes(current);
    if (next === current) return null;
    if (next.split("/").length !== current.split("/").length) {
      return `must not contain a percent-escape that decodes to "/" (it would become ${shown(next)})`;
    }
    const problem = literalProblem(next);
    if (problem) return `must not contain a percent-escape that decodes to ${shown(next)}, which ${problem}`;
    current = next;
  }
  return `must not nest percent-escapes more than ${MAX_DECODE_ROUNDS} levels deep`;
}

/**
 * What two names must differ in to be different files, in any file system and in the editor: case, Unicode form
 * and percent-encoding do not count.
 */
const identityOf = (path: string) => fullyDecoded(path).normalize("NFKC").toLowerCase();

/** Whether either path uses a percent-escape that the editor would decode into something else. */
const usesEscapes = (...paths: string[]) => paths.some((path) => decodePercentEscapes(path) !== path);

/**
 * Collisions between well-formed paths. `entries` carries each path with where it was written, so a
 * message points at the later one. A path that is malformed is skipped (it is already reported), and
 * an exact duplicate is skipped (validate.ts reports it): this reports only the ambiguous ones.
 */
export function findPathCollisions(entries: readonly { path: string; at: string }[]): string[] {
  const issues: string[] = [];
  const exact = new Set<string>();
  const byIdentity = new Map<string, { path: string; at: string }>();
  const unique: { path: string; at: string }[] = [];

  for (const entry of entries) {
    if (pathProblem(entry.path) !== null || exact.has(entry.path)) continue;
    exact.add(entry.path);
    unique.push(entry);

    const earlier = byIdentity.get(identityOf(entry.path));
    if (earlier) {
      const by = usesEscapes(entry.path, earlier.path) ? "case, Unicode form or percent-encoding" : "case or Unicode form";
      issues.push(
        `${entry.at}.path ${shown(entry.path)} is the same file as ${earlier.at}.path ${shown(earlier.path)}, differing only in ${by}`,
      );
    } else {
      byIdentity.set(identityOf(entry.path), entry);
    }
  }

  // A file and a folder of the same name cannot both exist: "a" is a file, so "a/b" has nowhere to live.
  for (const entry of unique) {
    const segments = entry.path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const folder = segments.slice(0, length).join("/");
      const file = byIdentity.get(identityOf(folder));
      if (file) {
        issues.push(`${entry.at}.path ${shown(entry.path)} is inside ${file.at}.path ${shown(file.path)}, which is a file, not a folder`);
        break;
      }
    }
  }
  return issues;
}
