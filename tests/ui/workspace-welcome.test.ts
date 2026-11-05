/*
 * The workspace page without an open challenge: a welcome screen, never a dead
 * end, a redirect or a randomly picked challenge. "Continue" appears only when
 * a resumable challenge is supplied, which nothing does yet (progress is not
 * kept beyond the open challenge page).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceWelcome } from "@/components/workspace/WorkspaceWelcome";
import { ROUTES } from "@/lib/challenge-routes";

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
const render = (props: Parameters<typeof WorkspaceWelcome>[0] = {}) => renderToStaticMarkup(createElement(WorkspaceWelcome, props));

describe("the workspace welcome screen", () => {
  const markup = render();

  test("explains the workspace and leads to the library", () => {
    assert.equal(ROUTES.workspace, "/workspace");
    assert.match(markup, /<h1 id="workspace-welcome-heading"[^>]*>Your investigation starts here\.<\/h1>/);
    assert.ok(markup.includes("Explore a debugging challenge, examine the evidence, and uncover what went wrong."));
    assert.match(markup, /<a [^>]*href="\/challenges"[^>]*>Browse Challenges/);
  });

  test("offers no Continue without a resumable challenge, and links to no challenge", () => {
    assert.doesNotMatch(markup, /Continue/);
    assert.doesNotMatch(markup, /href="\/challenges\/challenge-/, "never picks a challenge for the learner");
  });

  test("offers Continue for a resumable challenge when one is supplied", () => {
    const resumed = render({ resume: { id: "challenge-016", number: "016", title: "Revenue Too Good to Be True" } });
    assert.match(resumed, /<a [^>]*href="\/challenges\/challenge-016"[^>]*>Continue Last Challenge/);
    assert.match(resumed, /<span class="sr-only">: <\/span>Challenge 016/);
  });

  test("is marked as the workspace in the header, with Challenges one click away", () => {
    assert.match(markup, /<span aria-current="page"[^>]*>Workspace<\/span>/);
    assert.match(markup, /<a [^>]*href="\/challenges"[^>]*>Challenges<\/a>/);
  });

  test("is accessible: a labelled main, a skip link, and visible focus on its actions", () => {
    assert.match(markup, /<main aria-labelledby="workspace-welcome-heading"/);
    assert.match(markup, /href="#workspace-welcome"/);
    assert.match(markup, /id="workspace-welcome"/);
    assert.equal(markup.match(/focus-visible:outline-accent/g)!.length >= 3, true);
  });

  test("uses theme tokens only, so it follows light and dark", () => {
    for (const path of ["components/workspace/WorkspaceWelcome.tsx", "components/workspace/WorkspacePreview.tsx"]) {
      assert.doesNotMatch(source(path), /#[0-9a-f]{3,8}\b|rgb\(/i, path);
    }
  });

  test("shows the workflow as one connected sequence: Explore, Investigate, Diagnose", () => {
    const start = markup.indexOf('<section aria-labelledby="workflow-heading"');
    const list = markup.slice(start, markup.indexOf("</section>", start));
    assert.deepEqual([...list.matchAll(/<span class="font-medium text-foreground">([^<]+)<\/span>/g)].map(([, title]) => title), ["Explore", "Investigate", "Diagnose"]);
    assert.match(list, /<ol class="[^"]*rounded-2xl[^"]*">/, "one panel, not three cards");
  });
});

describe("the workspace preview", () => {
  const markup = render();
  const start = markup.indexOf('<figure aria-labelledby="workspace-preview-caption"');
  const preview = markup.slice(start, markup.indexOf("</figure>", start));

  test("is one labelled picture with a visible caption saying it is a preview", () => {
    assert.ok(start >= 0);
    assert.match(preview, /<div role="img" aria-label="Preview of the BugLab workspace: [^"]+"/);
    assert.match(preview, /<figcaption id="workspace-preview-caption"[^>]*>[\s\S]*Illustrative preview\. Open a challenge to start a real investigation\.<\/figcaption>/);
    assert.ok(preview.includes(">Preview<"), "labelled in the frame too");
  });

  test("contains nothing to click or type into, and no progress", () => {
    assert.doesNotMatch(preview, /<(a|button|input|select|textarea)\b|tabindex/i);
    assert.doesNotMatch(preview, /Continue|in progress|Resolved|Submitted|%|score/i);
  });

  test("uses a made-up sample incident, not text from any challenge", () => {
    assert.ok(preview.includes("Uploads over 10 MB fail with a generic error."));
    // The sample's distinctive content (generic code keywords naturally appear everywhere).
    const parts = ["Uploads over 10 MB", "POST /upload", "file size=12.4 MB", "limits.maxBytes", "upload.ts", "Root cause: decided after you investigate"];
    for (const part of parts) assert.ok(preview.includes(part), `the preview shows "${part}"`);
    const dataDir = new URL("../../src/data/", import.meta.url);
    for (const id of readdirSync(dataDir).filter((name) => name.startsWith("challenge-"))) {
      const dir = new URL(`${id}/`, dataDir);
      const challenge = readdirSync(dir)
        .map((file) => readFileSync(new URL(file, dir), "utf8"))
        .join("\n");
      for (const part of parts) assert.ok(!challenge.includes(part), `${id} contains "${part}"`);
    }
  });
});

describe("the workspace route", () => {
  // The code only: comments explain what the page does not do and would match the checks below.
  const page = source("app/workspace/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("renders the welcome screen and never redirects (no loops, nothing to break on refresh)", () => {
    assert.match(page, /return <WorkspaceWelcome \/>;/);
    assert.doesNotMatch(page, /redirect|permanentRedirect|notFound|useRouter/);
  });

  test("does not invent progress: no storage, cookies or session reads", () => {
    for (const path of ["app/workspace/page.tsx", "components/workspace/WorkspaceWelcome.tsx"]) {
      assert.doesNotMatch(source(path), /localStorage|sessionStorage|cookies\(|document\.cookie|fetch\(/, path);
    }
  });

  test("the site footer stays out of the interactive challenge workspace", () => {
    assert.doesNotMatch(source("components/challenge/ChallengeWorkspacePage.tsx"), /SiteFooter/);
  });
});
