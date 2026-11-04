/*
 * The strict file-path policy (paths.ts), proven one path and one message at a time.
 *
 * Every refusal is asserted as EXACTLY ONE issue at EXACTLY ONE path with its own message, so a
 * rule cannot pass by being covered for the wrong reason by another one. Every rule also has the
 * values just inside it that must still be accepted, and the policy is shown not to narrow
 * languages: any extension, and none, is a file.
 *
 * Percent signs are literal (approved): "50%20off.md" is a valid name. The editor does decode them,
 * though, so the protections are also applied to the decoded form, and that is checked against
 * Monaco's own URI parser rather than against this module's idea of it.
 *
 * Characters that are easy to corrupt in source (controls, combining marks, fullwidth forms) are
 * built from code points, never typed.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFileTree } from "@/lib/file-tree";
import { decodePercentEscapes, findPathCollisions, pathProblem } from "@/server/challenges/paths";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { shown } from "@/server/challenges/text";
import { draftOf } from "./helpers";
import { PREFIX, accepted, exactly, freeFile, issuesFor, loose } from "./mutation-helpers";

const chars = (...codes: number[]) => String.fromCharCode(...codes);
const BACKSLASH = chars(0x5c);

/** Two unreferenced files, so a collision between them is the only thing wrong. */
function twoFreeFiles(d: ReturnType<typeof draftOf>): [number, number] {
  const indexes = d.scenario.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.path !== d.scenario.entryFilePath && !d.scenario.network.some((request) => request.initiator === file.path))
    .map(({ index }) => index);
  assert.ok(indexes.length >= 2, "the fixture needs two unreferenced files");
  return [indexes[0], indexes[1]];
}

/** Sets a free file's path and expects exactly one issue, with this message after the quoted path. */
function refused(value: string, problem: string): void {
  const index = freeFile(draftOf());
  exactly((d) => (loose(d.scenario.files[index]).path = value), `scenario.files[${index}].path ${shown(value)} ${problem}`);
}

const MESSAGES = {
  blank: "must not be blank",
  invisible: "must not contain control, invisible or direction-changing characters",
  backslash: 'must not contain a backslash; separate folders with "/"',
  nfc: "must be written in Unicode NFC form",
  drive: 'must be relative: it must not start with a drive letter such as "C:"',
  empty: 'must not have an empty segment (no leading, trailing or doubled "/", so it is relative)',
  dot: 'must not contain a "." or ".." segment',
  lookalike: 'must not use look-alike characters for "/", "\\" or "."',
  padded: "must not have a segment with leading or trailing whitespace",
  trailingDot: "must not have a segment that ends with a dot",
  length: "must be at most 128 characters long",
  depth: "must be at most 8 folders deep",
  segment: "must have no segment longer than 64 characters",
};

describe("a path is a string with visible content", () => {
  for (const value of ["", " ", "   ", "\t"]) {
    test(`${JSON.stringify(value)} is refused`, () => {
      // A tab is also a control character; blankness is reported first.
      refused(value, MESSAGES.blank);
    });
  }
});

describe("control, invisible and direction-changing characters", () => {
  const cases: [string, string][] = [
    ["a NUL byte", `a${chars(0)}b.md`],
    ["a newline", "a\nb.md"],
    ["a carriage return", "a\rb.md"],
    ["a tab inside a name", "tab\there.md"],
    ["DEL", `a${chars(0x7f)}b.md`],
    ["a C1 control (NEL)", `a${chars(0x85)}b.md`],
    ["a zero-width space", `a${chars(0x200b)}b.md`],
    ["a right-to-left override", `gnp.${chars(0x202e)}exe`],
    ["a byte-order mark", `${chars(0xfeff)}a.md`],
    ["a soft hyphen", `a${chars(0xad)}b.md`],
    ["a line separator", `a${chars(0x2028)}b.md`],
    ["a paragraph separator", `a${chars(0x2029)}b.md`],
  ];
  for (const [label, value] of cases) {
    test(`${label} is refused`, () => refused(value, MESSAGES.invisible));
  }
  test("ordinary non-ASCII letters, CJK and emoji are accepted", () => {
    for (const value of [`r${chars(0xe9)}sum${chars(0xe9)}.md`, `${chars(0x6587, 0x6863)}/${chars(0x8bf4, 0x660e)}.md`, `${chars(0xd83d, 0xdc1b)}.md`]) {
      accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
    }
  });
});

describe("backslashes", () => {
  for (const value of [`a${BACKSLASH}b.md`, `dir${BACKSLASH}sub${BACKSLASH}f.ts`, `..${BACKSLASH}x.md`, `C:${BACKSLASH}x.md`, `${BACKSLASH}abs.md`, `a/b${BACKSLASH}c.md`]) {
    test(`${JSON.stringify(value)} is refused`, () => refused(value, MESSAGES.backslash));
  }
});

describe("percent signs are literal: nothing is decoded, and ordinary names containing them are valid (approved)", () => {
  const legitimate = [
    "50%20off.md",
    "100%.md",
    "50%/x.md",
    "a%zz.md",
    "%.md",
    "a%2.md",
    "caf%C3%A9.md",
    "%E4%B8%AD%E6%96%87.md",
    "a%20b/c%20d.md",
    "%41.md",
    "100%25.md",
    "report%281%29.md",
    // Not valid UTF-8, so nothing decodes them: they stay exactly as written, in the editor too.
    "%c0%ae%c0%ae/x.md",
    "%e4%b8.md",
  ];

  for (const value of legitimate) {
    test(`${value} is accepted`, () => {
      accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
    });
  }

  test("each is published exactly as written, never decoded", () => {
    for (const value of legitimate) {
      const registry = createChallengeRegistry([
        draftOf((d) => {
          d.scenario.files[freeFile(d)].path = value;
        }),
      ]);
      const published = registry.getPublic("challenge-001")!.files.map((file) => file.path);
      assert.ok(published.includes(value), `${value} is published as written`);
    }
  });

  test("the workspace's file tree keeps each as one literal name, in the folder it was written in", () => {
    const tree = buildFileTree([
      { path: "50%20off.md", content: "" },
      { path: "dir%20a/x%41.md", content: "" },
    ]);
    const root = tree.find((node) => node.name === "50%20off.md");
    const folder = tree.find((node) => node.name === "dir%20a");

    assert.ok(root && root.kind === "file" && root.path === "50%20off.md");
    assert.ok(folder && folder.kind === "folder");
    assert.deepEqual(folder.kind === "folder" ? folder.children.map((child) => child.name) : [], ["x%41.md"]);
    assert.equal(tree.length, 2, "no file was decoded into another folder or name");
  });
});

describe("a percent-escape is refused only when the editor's decoding would make the path something this policy refuses", () => {
  const decodesTo = (next: string, rest: string) => `must not contain a percent-escape that decodes to ${shown(next)}, which ${rest}`;
  const intoSlash = (next: string) => `must not contain a percent-escape that decodes to "/" (it would become ${shown(next)})`;

  const cases: [string, string][] = [
    // Traversal: the editor would see a dot segment.
    ["%2e%2e/x.md", decodesTo("../x.md", MESSAGES.dot)],
    ["a/%2E%2E/b.md", decodesTo("a/../b.md", MESSAGES.dot)],
    ["%2e/x.md", decodesTo("./x.md", MESSAGES.dot)],
    ["%252e%252e/x.md", decodesTo("../x.md", MESSAGES.dot)],
    ["%25252e%25252e/x.md", decodesTo("../x.md", MESSAGES.dot)],
    // Separators: the editor would see another folder, or a backslash.
    ["a%2fb.md", intoSlash("a/b.md")],
    ["a%2Fb.md", intoSlash("a/b.md")],
    ["%2fx.md", intoSlash("/x.md")],
    ["a%5cb.md", decodesTo(`a${BACKSLASH}b.md`, MESSAGES.backslash)],
    ["a%5Cb.md", decodesTo(`a${BACKSLASH}b.md`, MESSAGES.backslash)],
    // Everything else the policy refuses, hidden in an escape.
    ["x%00.md", decodesTo(`x${chars(0)}.md`, MESSAGES.invisible)],
    ["a%0ab.md", decodesTo("a\nb.md", MESSAGES.invisible)],
    ["%e2%80%8b.md", decodesTo(`${chars(0x200b)}.md`, MESSAGES.invisible)],
    ["a%ef%bc%8fb.md", decodesTo(`a${chars(0xff0f)}b.md`, MESSAGES.lookalike)],
    ["cafe%CC%81.md", decodesTo(`cafe${chars(0x301)}.md`, MESSAGES.nfc)],
    ["%43:/x.md", decodesTo("C:/x.md", MESSAGES.drive)],
    ["a%20/b.md", decodesTo("a /b.md", MESSAGES.padded)],
    ["dir/%20x.md", decodesTo("dir/ x.md", MESSAGES.padded)],
    ["file%2e", decodesTo("file.", MESSAGES.trailingDot)],
  ];
  for (const [value, problem] of cases) {
    test(`${value} is refused`, () => refused(value, problem));
  }

  test("nesting deeper than four levels is refused as such, however it ends", () => {
    const encoded = (levels: number) => `%${"25".repeat(levels - 1)}2e%${"25".repeat(levels - 1)}2e/x.md`;
    refused(encoded(4), decodesTo("../x.md", MESSAGES.dot));
    refused(encoded(5), "must not nest percent-escapes more than 4 levels deep");
    refused(encoded(9), "must not nest percent-escapes more than 4 levels deep");
  });

  test("an escape that decodes to something harmless is accepted, however it is cased", () => {
    for (const value of ["50%20off.md", "50%20OFF.md", "%2D%5F.md", "a%7Eb.md", "caf%c3%a9.md", "caf%C3%A9.md"]) {
      accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
    }
  });
});

describe("two paths that the editor would open as one file collide, whatever they are written like", () => {
  const same = (first: number, firstPath: string, second: number, secondPath: string) =>
    `scenario.files[${second}].path ${shown(secondPath)} is the same file as scenario.files[${first}].path ${shown(firstPath)}, differing only in case, Unicode form or percent-encoding`;

  const pair = (firstPath: string, secondPath: string, expected: (first: number, second: number) => string) => {
    const [first, second] = twoFreeFiles(draftOf());
    exactly((d) => {
      d.scenario.files[first].path = firstPath;
      d.scenario.files[second].path = secondPath;
    }, expected(first, second));
  };

  test("an escaped space and a real space, in either order", () => {
    pair("50%20off.md", "50 off.md", (a, b) => same(a, "50%20off.md", b, "50 off.md"));
    pair("50 off.md", "50%20off.md", (a, b) => same(a, "50 off.md", b, "50%20off.md"));
  });

  test("an escaped letter and the letter, with case ignored too", () => {
    pair("%41.md", "a.md", (a, b) => same(a, "%41.md", b, "a.md"));
  });

  test("an escaped accented letter and the accented letter", () => {
    const composed = `caf${chars(0xe9)}.md`;
    pair("caf%C3%A9.md", composed, (a, b) => same(a, "caf%C3%A9.md", b, composed));
  });

  test("a double-encoded name collides with what it finally decodes to", () => {
    pair("50%2520off.md", "50 off.md", (a, b) => same(a, "50%2520off.md", b, "50 off.md"));
  });

  test("a file and a folder collide through an escape too", () => {
    const [first, second] = twoFreeFiles(draftOf());
    exactly((d) => {
      d.scenario.files[first].path = "50 off";
      d.scenario.files[second].path = "50%20off/x.md";
    }, `scenario.files[${second}].path "50%20off/x.md" is inside scenario.files[${first}].path "50 off", which is a file, not a folder`);
  });

  test("names that merely look alike are accepted: a different letter, a different extension, a different escape", () => {
    for (const [first, second] of [["50%20off.md", "50%20off.txt"], ["50%20off.md", "50%21off.md"], ["a%20b.md", "a%20c.md"], ["%41.md", "%42.md"]]) {
      accepted((d) => {
        const [i, j] = twoFreeFiles(d);
        d.scenario.files[i].path = first;
        d.scenario.files[j].path = second;
      });
    }
  });
});

describe("the decoding rules are the editor's own, checked against Monaco's URI parser", () => {
  const ROOT = fileURLToPath(new URL("../../", import.meta.url));

  async function monacoPathOf() {
    const href = pathToFileURL(join(ROOT, "node_modules/monaco-editor/esm/vs/base/common/uri.js")).href;
    const { URI } = (await import(href)) as { URI: { parse(value: string): { path: string } } };
    // MonacoEditor.tsx opens each file under `file:///<path>`. Monaco THROWS for some decoded paths (one that
    // would begin with "//", say), which is null here: the editor could not even open such a file.
    return (path: string): string | null => {
      try {
        return URI.parse(`file:///${path}`).path.slice(1);
      } catch {
        return null;
      }
    };
  }

  /**
   * A fixed pseudo-random corpus of short strings. By default each piece is one character of the kind that
   * matters. With `whole` set, each piece is a whole escape (valid, invalid UTF-8, not even hex) or a
   * separator, which makes the awkward mixtures, such as a valid escape next to a broken one, common.
   */
  function corpus(count: number, whole = false): string[] {
    const characters = ["a", "B", "%", "2", "e", "E", "f", "F", "5", "c", "C", "0", "1", "4", "3", "8", "z", "/", " ", "-", "."];
    const escapes = ["%41", "%c0", "%ae", "%e4", "%b8", "%zz", "%2e", "%2E", "%2f", "%20", "%25", "%c3", "%a9", "%e4%b8%ad", "a", "b", "/", " ", "."];
    const alphabet = whole ? escapes : characters;
    let seed = whole ? 77 : 20261104;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const out: string[] = [];
    while (out.length < count) {
      const length = 1 + (next() % 9);
      let text = "";
      for (let i = 0; i < length; i += 1) text += alphabet[next() % alphabet.length];
      if (!text.startsWith("/")) out.push(text);
    }
    return out;
  }

  test("one round of decoding gives exactly what Monaco makes of the path, for 4,000 strings", async () => {
    const monaco = await monacoPathOf();
    const mismatches = corpus(4000).filter((text) => {
      const seen = monaco(text);
      return seen !== null && decodePercentEscapes(text) !== seen;
    });

    assert.deepEqual(mismatches.slice(0, 5), []);
  });

  test("and for the escapes that matter, by name, including a valid escape beside a broken one", async () => {
    const monaco = await monacoPathOf();
    const names = [
      "50%20off.md", "a%2fb.md", "%2e%2e/x.md", "a%5cb.md", "x%00.md", "100%.md", "%c0%ae.md", "%e4%b8.md", "caf%C3%A9.md", "%41%42.md",
      "%41%c0.md", "%2e%zz.md", "a%41%zzb.md", "%e4%b8%41.md", "%zz%41.md", "%c3%a9%c3.md", "%e4%b8%ad%e4.md", "%25%41.md",
    ];
    for (const text of names) assert.equal(decodePercentEscapes(text), monaco(text), text);
  });

  test("and for 4,000 strings made of whole escapes, valid, broken and in every mixture", async () => {
    const monaco = await monacoPathOf();
    const mismatches = corpus(4000, true).filter((text) => {
      const seen = monaco(text);
      return seen !== null && decodePercentEscapes(text) !== seen;
    });

    assert.deepEqual(mismatches.slice(0, 5), []);
  });

  test("every path the loader accepts stays the same shape in the editor: it opens, with the same folders, no dot segment, no backslash, no control character", async () => {
    const monaco = await monacoPathOf();
    const acceptedPaths = [...corpus(6000), ...corpus(6000, true)].filter((text) => pathProblem(text) === null);
    assert.ok(acceptedPaths.length > 500, `a meaningful number of paths were accepted (${acceptedPaths.length})`);

    for (const text of acceptedPaths) {
      const seen = monaco(text);
      assert.notEqual(seen, null, `${text}: the editor could not open it`);
      const segments = (seen as string).split("/");
      assert.equal(segments.length, text.split("/").length, `${text} -> ${seen}: the folders changed`);
      assert.ok(!segments.some((segment) => segment === "." || segment === ".."), `${text} -> ${seen}: a dot segment appeared`);
      assert.ok(!(seen as string).includes(BACKSLASH), `${text} -> ${seen}: a backslash appeared`);
      assert.ok(![...(seen as string)].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), `${text} -> ${seen}: a control character appeared`);
    }
  });

  test("a path that makes the editor throw is always refused", async () => {
    const monaco = await monacoPathOf();
    const throwing = [...corpus(6000), ...corpus(6000, true), "%2fx.md", "%2f%2fx.md"].filter((text) => monaco(text) === null);

    assert.ok(throwing.length > 10, `the corpus contains paths the editor cannot open (${throwing.length})`);
    for (const text of throwing) assert.notEqual(pathProblem(text), null, `${text} crashes the editor, so it must be refused`);
  });

  test("and the paths the loader refuses include the ones the editor would turn into something else", async () => {
    const monaco = await monacoPathOf();
    const dangerous = ["%2e%2e/x.md", "a%2fb.md", "a%5cb.md", "x%00.md"];
    for (const text of dangerous) {
      const seen = monaco(text) as string;
      const changed = seen.split("/").length !== text.split("/").length || seen.split("/").some((s) => s === "..") || seen.includes(BACKSLASH) || seen.includes(chars(0));
      assert.ok(changed, `${text} really is dangerous in the editor (${JSON.stringify(seen)})`);
      assert.notEqual(pathProblem(text), null, `${text} is refused`);
    }
  });
});

describe("Unicode form", () => {
  test("a decomposed name (e + combining acute) is refused: the same name can be written two ways", () => {
    refused(`caf${chars(0x65, 0x301)}.md`, MESSAGES.nfc);
  });
  test("the composed name is accepted", () => {
    accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = `caf${chars(0xe9)}.md`));
  });
});

describe("look-alike separators and dots", () => {
  const cases: [string, string][] = [
    ["a fullwidth solidus", `a${chars(0xff0f)}b.md`],
    ["a fullwidth reverse solidus", `a${chars(0xff3c)}b.md`],
    ["fullwidth full stops as a dot segment", `${chars(0xff0e, 0xff0e)}/x.md`],
    ["a fullwidth full stop as a single dot segment", `a/${chars(0xff0e)}/x.md`],
  ];
  for (const [label, value] of cases) {
    test(`${label} is refused`, () => refused(value, MESSAGES.lookalike));
  }
  test("the division slash and the fraction slash are ordinary characters: the tree splits only on /", () => {
    for (const value of [`a${chars(0x2215)}b.md`, `a${chars(0x2044)}b.md`]) {
      accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
    }
  });
});

describe("absolute paths", () => {
  for (const value of ["C:/x.md", "c:x.md", "Z:", "d:/a/b.md"]) {
    test(`a drive letter (${value}) is refused`, () => refused(value, MESSAGES.drive));
  }
  for (const value of ["/abs/path.md", "/", "//host/share/x.md"]) {
    test(`a leading slash (${value}) is refused`, () => refused(value, MESSAGES.empty));
  }
  test("a colon that is not a drive letter is accepted", () => {
    for (const value of ["ab:c.md", "dir/c:d.md", "10:30.md"]) accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
  });
  test("a one-letter prefix before a colon is a drive in disguise, so it is refused even without a slash", () => {
    refused("a:b.md", MESSAGES.drive);
  });
});

describe("empty and dot segments", () => {
  for (const value of ["a//b.md", "dir/", "a/b//", "//"]) {
    test(`an empty segment (${value}) is refused`, () => refused(value, MESSAGES.empty));
  }
  for (const value of ["../x", "a/../b", "./a", "a/./b", "a/..", ".", ".."]) {
    test(`a dot segment (${value}) is refused`, () => refused(value, MESSAGES.dot));
  }
  test("names that merely contain or start with dots are accepted", () => {
    for (const value of [".env", ".github/workflows/ci.yml", "a..b.md", "..hidden", "v1.2.3/notes.md", "a/.b/c"]) {
      accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
    }
  });
});

describe("segments a Windows file system would silently change", () => {
  for (const value of [" padded.md", "padded.md ", "dir /f.md", "dir/ f.md", `a/${chars(0xa0)}b.md`, `a/b${chars(0x3000)}/c.md`]) {
    test(`leading or trailing whitespace in a segment (${JSON.stringify(value)}) is refused`, () => refused(value, MESSAGES.padded));
  }
  for (const value of ["file.", "dir./f.md", "a/b./c.md", "a."]) {
    test(`a segment ending in a dot (${value}) is refused`, () => refused(value, MESSAGES.trailingDot));
  }
  test("spaces and dots inside a name are accepted", () => {
    for (const value of ["a b/c d.md", "my file.v2.md", "a.b/c.d"]) accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = value));
  });
});

describe("length limits, with their boundaries", () => {
  const segment = (length: number, letter = "x") => letter.repeat(length);

  test("exactly 128 characters is accepted, 129 is refused", () => {
    const at128 = `${segment(63)}/${segment(64, "y")}`;
    assert.equal(at128.length, 128);
    accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = at128));
    const at129 = `${segment(64)}/${segment(64, "y")}`;
    assert.equal(at129.length, 129);
    refused(at129, MESSAGES.length);
  });
  test("a segment of exactly 64 is accepted, 65 is refused", () => {
    accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = segment(64)));
    refused(segment(65), MESSAGES.segment);
  });
  test("8 folders deep is accepted, 9 is refused", () => {
    accepted((d) => (loose(d.scenario.files[freeFile(d)]).path = "a/b/c/d/e/f/g/h"));
    refused("a/b/c/d/e/f/g/h/i", MESSAGES.depth);
  });
});

describe("the entry file path is held to the same policy", () => {
  test("a backslash in the entry path is reported at the entry path and at the file", () => {
    const entry = `a${BACKSLASH}b.md`;
    const issues = issuesFor((d) => {
      d.scenario.files[0].path = entry;
      d.scenario.entryFilePath = entry;
    });
    assert.ok(issues.includes(`${PREFIX}scenario.entryFilePath ${shown(entry)} ${MESSAGES.backslash}`), issues.join("\n"));
    assert.ok(issues.includes(`${PREFIX}scenario.files[0].path ${shown(entry)} ${MESSAGES.backslash}`), issues.join("\n"));
  });
});

describe("collisions between files", () => {
  test("two paths that differ only in case are refused, at the later one", () => {
    exactly((d) => {
      const [first, second] = twoFreeFiles(d);
      d.scenario.files[first].path = "Notes.md";
      d.scenario.files[second].path = "notes.md";
    }, `scenario.files[${twoFreeFiles(draftOf())[1]}].path "notes.md" is the same file as scenario.files[${twoFreeFiles(draftOf())[0]}].path "Notes.md", differing only in case or Unicode form`);
  });

  test("a path that differs only by a compatibility form (fullwidth letters) collides", () => {
    const fullwidth = chars(0xff4e, 0xff4f, 0xff54, 0xff45, 0xff53) + ".md"; // the five letters of "notes", fullwidth
    const [first, second] = twoFreeFiles(draftOf());
    exactly((d) => {
      d.scenario.files[first].path = "notes.md";
      d.scenario.files[second].path = fullwidth;
    }, `scenario.files[${second}].path ${shown(fullwidth)} is the same file as scenario.files[${first}].path "notes.md", differing only in case or Unicode form`);
  });

  test("a file and a folder of the same name collide, in either order", () => {
    const [first, second] = twoFreeFiles(draftOf());
    exactly((d) => {
      d.scenario.files[first].path = "docs";
      d.scenario.files[second].path = "docs/readme.md";
    }, `scenario.files[${second}].path "docs/readme.md" is inside scenario.files[${first}].path "docs", which is a file, not a folder`);
    exactly((d) => {
      d.scenario.files[first].path = "docs/readme.md";
      d.scenario.files[second].path = "docs";
    }, `scenario.files[${first}].path "docs/readme.md" is inside scenario.files[${second}].path "docs", which is a file, not a folder`);
  });

  test("a file and a folder collide even when only the case differs, and when deeper", () => {
    const [first, second] = twoFreeFiles(draftOf());
    exactly((d) => {
      d.scenario.files[first].path = "Docs";
      d.scenario.files[second].path = "docs/x.md";
    }, `scenario.files[${second}].path "docs/x.md" is inside scenario.files[${first}].path "Docs", which is a file, not a folder`);
    exactly((d) => {
      d.scenario.files[first].path = "a/b";
      d.scenario.files[second].path = "a/b/c/d.md";
    }, `scenario.files[${second}].path "a/b/c/d.md" is inside scenario.files[${first}].path "a/b", which is a file, not a folder`);
  });

  test("an exact duplicate is reported once, as a duplicate, and not also as a collision", () => {
    exactly((d) => {
      const [first, second] = twoFreeFiles(d);
      d.scenario.files[first].path = "dup.md";
      d.scenario.files[second].path = "dup.md";
    }, 'file path "dup.md" is used more than once');
  });

  test("sibling files and folders that merely share a prefix are accepted", () => {
    accepted((d) => {
      const [first, second] = twoFreeFiles(d);
      d.scenario.files[first].path = "docs/a.md";
      d.scenario.files[second].path = "docs-old/a.md";
    });
    accepted((d) => {
      const [first, second] = twoFreeFiles(d);
      d.scenario.files[first].path = "a/b.md";
      d.scenario.files[second].path = "a/b.md.bak";
    });
  });

  test("findPathCollisions skips malformed paths: they are reported once, elsewhere", () => {
    assert.deepEqual(
      findPathCollisions([
        { path: "A.md", at: "f[0]" },
        { path: "a.md" + BACKSLASH, at: "f[1]" },
        { path: "/A.md", at: "f[2]" },
      ]),
      [],
    );
  });
});

describe("the policy does not narrow languages", () => {
  const files: [string, string][] = [
    ["src/Main.java", "public class Main {}"],
    ["db/schema.sql", "SELECT 1;"],
    ["app/main.py", "print(1)"],
    ["src/index.ts", "export {};"],
    ["src/index.js", "module.exports = {};"],
    ["cmd/main.go", "package main"],
    ["lib/app.rb", "puts 1"],
    ["src/lib.rs", "fn main() {}"],
    ["pom.xml", "<project/>"],
    ["Makefile", "all:"],
    ["Dockerfile", "FROM scratch"],
    ["no_extension", "x"],
  ];

  test("a challenge made of Java, SQL, Python, TypeScript, JavaScript, Go, Ruby, Rust and extensionless files is accepted and published unchanged", () => {
    const build = (d: ReturnType<typeof draftOf>) => {
      const keep = d.scenario.files.filter((file) => file.path === d.scenario.entryFilePath || d.scenario.network.some((r) => r.initiator === file.path));
      d.scenario.files = [...keep, ...files.map(([path, content]) => ({ path, content }))];
    };
    assert.deepEqual(issuesFor(build), []);
    const registry = createChallengeRegistry([draftOf(build)]);
    const published = registry.getPublic("challenge-001")!.files.map((file) => file.path);
    for (const [path] of files) assert.ok(published.includes(path), `${path} is published`);
  });
});

describe("pathProblem on its own", () => {
  test("accepts what Challenge 001 uses", () => {
    for (const { path } of draftOf().scenario.files) assert.equal(pathProblem(path), null, path);
  });
  test("is total: it never throws and always answers with a string or null", () => {
    for (const value of ["", "a", "\u0000", "a".repeat(10_000), "/".repeat(500), "%".repeat(100), chars(0xd800), `${chars(0xd83d)}`]) {
      const result = pathProblem(value);
      assert.ok(result === null || typeof result === "string");
    }
  });
  test("gives one answer per path, with the same message every time", () => {
    for (const value of ["a/../b", `a${BACKSLASH}b`, "%2e%2e", "C:/x"]) assert.equal(pathProblem(value), pathProblem(value));
  });
});

describe("what is reported for several bad paths at once", () => {
  test("every bad path is listed, each at its own index, in file order", () => {
    const issues = issuesFor((d) => {
      d.scenario.files[0].path = "../a";
      d.scenario.files[1].path = `b${BACKSLASH}c`;
      d.scenario.files[2].path = "%2e/d";
    });
    const paths = issues.filter((issue) => /scenario\.files\[\d+\]\.path/.test(issue)).map((issue) => /scenario\.files\[(\d+)\]/.exec(issue)![1]);
    assert.deepEqual(paths.slice(0, 3), ["0", "1", "2"]);
  });
});
