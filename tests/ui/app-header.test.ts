import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHeader, type AppSection } from "@/components/layout/AppHeader";

const render = (current: AppSection) => renderToStaticMarkup(createElement(AppHeader, { current }));

/** The primary navigation's items: [tag, attributes, visible label]. */
function navItems(markup: string) {
  const nav = markup.match(/<nav aria-label="Primary"[\s\S]*?<\/nav>/)?.[0] ?? "";
  return [...nav.matchAll(/<li><(a|span)\b([^>]*)>([^<]+)/g)].map(([, tag, attributes, label]) => ({
    tag,
    attributes,
    label,
  }));
}

describe("AppHeader navigation", () => {
  test("on the library, Challenges is the current page and Workspace is unavailable", () => {
    const [challenges, workspace, learn] = navItems(render("challenges"));
    assert.deepEqual([challenges.tag, challenges.label], ["a", "Challenges"]);
    assert.match(challenges.attributes, /href="\/challenges"/);
    assert.match(challenges.attributes, /aria-current="page"/);

    assert.deepEqual([workspace.tag, workspace.label], ["span", "Workspace"]);
    assert.match(workspace.attributes, /aria-disabled="true"/);
    assert.match(workspace.attributes, /title="Open a challenge to use the workspace"/);
    assert.doesNotMatch(workspace.attributes, /aria-current/);

    assert.deepEqual([learn.tag, learn.label], ["span", "Learn"]);
    assert.match(learn.attributes, /aria-disabled="true"/);
  });

  test("in a workspace, Workspace is the current page and Challenges links back to the library", () => {
    const [challenges, workspace] = navItems(render("workspace"));
    assert.equal(challenges.tag, "a");
    assert.match(challenges.attributes, /href="\/challenges"/);
    assert.doesNotMatch(challenges.attributes, /aria-current/);
    assert.match(challenges.attributes, /focus-visible:outline-accent/);

    assert.deepEqual([workspace.tag, workspace.label], ["span", "Workspace"]);
    assert.match(workspace.attributes, /aria-current="page"/);
  });

  test("exactly one item is current, and Learn is never a link", () => {
    for (const current of ["challenges", "workspace"] as const) {
      const markup = render(current);
      assert.equal(markup.match(/aria-current="page"/g)?.length, 1, current);
      assert.match(markup, /title="Not available yet"[^>]*>Learn<span[^>]*>Soon<\/span>/, current);
      assert.equal(navItems(markup).filter((item) => item.tag === "a").length, 1, `${current}: one link`);
    }
  });
});
