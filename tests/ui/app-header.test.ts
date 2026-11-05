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
    const items = navItems(render("challenges"));
    assert.deepEqual(items.map((item) => item.label), ["Challenges", "Workspace"], "only working sections are listed");
    const [challenges, workspace] = items;
    assert.deepEqual([challenges.tag, challenges.label], ["a", "Challenges"]);
    assert.match(challenges.attributes, /href="\/challenges"/);
    assert.match(challenges.attributes, /aria-current="page"/);

    assert.deepEqual([workspace.tag, workspace.label], ["span", "Workspace"]);
    assert.match(workspace.attributes, /aria-disabled="true"/);
    assert.match(workspace.attributes, /title="Open a challenge to use the workspace"/);
    assert.doesNotMatch(workspace.attributes, /aria-current/);
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

  test("exactly one item is current, and nothing unfinished is advertised", () => {
    for (const current of ["challenges", "workspace"] as const) {
      const markup = render(current);
      assert.equal(markup.match(/aria-current="page"/g)?.length, 1, current);
      assert.doesNotMatch(markup, /Soon|Not available yet|Demo Preview|Learn/, current);
      assert.equal(navItems(markup).filter((item) => item.tag === "a").length, 1, `${current}: one link`);
    }
  });

  test("the BugLab name links to the landing page", () => {
    assert.match(render("challenges"), /<a [^>]*href="\/"[^>]*>[\s\S]*?BugLab/);
  });
});
