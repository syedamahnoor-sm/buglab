import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChallengeCard } from "@/components/challenge/ChallengeCard";
import { ChallengeOverview } from "@/components/challenge/ChallengeOverview";
import { difficultyDisplay } from "@/components/challenge/difficulty";
import { challenge001 } from "@/data/challenge-001";
import type { ChallengeSummary, Difficulty } from "@/types/workspace";

const render = (challenge: ChallengeSummary) =>
  renderToStaticMarkup(createElement(ChallengeCard, { challenge }));

/** The text a reader sees, with tags removed and whitespace collapsed. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const challenge = challenge001.challenge;

describe("ChallengeCard", () => {
  test("shows the challenge's public summary", () => {
    const markup = render(challenge);
    assert.ok(markup.includes(`Challenge ${challenge.number}`));
    assert.ok(markup.includes(challenge.title));
    assert.ok(markup.includes(challenge.incident));
    assert.ok(markup.includes(`~${challenge.estimatedMinutes} min`));
    for (const tag of challenge.tags) assert.ok(markup.includes(`>${tag}<`), tag);
  });

  test("shows nothing beyond the summary fields and its own fixed labels", () => {
    // Everything visible is accounted for, so no spoiler can slip in.
    const expected = [
      `Challenge ${challenge.number}`,
      challenge.title,
      "Incident report",
      challenge.incident,
      "Difficulty",
      difficultyDisplay[challenge.difficulty].label,
      "Est. time",
      `~${challenge.estimatedMinutes} min`,
      "Topics",
      ...challenge.tags,
    ].join(" ");
    assert.equal(visibleText(render(challenge)), expected);
  });

  test("never shows Challenge 001's root-cause options", () => {
    const text = visibleText(render(challenge));
    for (const option of challenge001.rootCauseOptions) {
      assert.ok(!text.includes(option.label), option.id);
      assert.ok(!text.includes(option.description), option.id);
    }
  });

  test("is presentational: no links, buttons or form controls", () => {
    assert.doesNotMatch(render(challenge), /<(a|button|input|select|textarea|form)\b/);
  });

  test("is an article named by its title, with an ID unique to the challenge", () => {
    const markup = render(challenge);
    const titleId = `challenge-card-${challenge.id}-title`;
    assert.match(markup, new RegExp(`<article aria-labelledby="${titleId}"`));
    assert.match(markup, new RegExp(`<h2 id="${titleId}"`));
    assert.ok(!render({ ...challenge, id: "challenge-002" }).includes(titleId));
  });

  test("uses the same difficulty labels and colours as the challenge overview", () => {
    const levels: Difficulty[] = ["beginner", "intermediate", "advanced"];
    for (const difficulty of levels) {
      const { label, tone } = difficultyDisplay[difficulty];
      const card = render({ ...challenge, difficulty });
      const overview = renderToStaticMarkup(
        createElement(ChallengeOverview, { challenge: { ...challenge, difficulty }, status: "not-started" }),
      );
      const badge = new RegExp(`border-${tone}/30 bg-${tone}/10 text-${tone} ">${label}<`);
      assert.match(card, badge, difficulty);
      assert.match(overview, badge, difficulty);
    }
  });

  test("keeps the difficulty labels and tones the workspace has always used", () => {
    assert.deepEqual(difficultyDisplay, {
      beginner: { label: "Beginner", tone: "success" },
      intermediate: { label: "Intermediate", tone: "warning" },
      advanced: { label: "Advanced", tone: "danger" },
    });
  });

  test("shows an optional action after the metadata and can use a lower heading level", () => {
    const markup = renderToStaticMarkup(
      createElement(ChallengeCard, { challenge, titleAs: "h3", action: createElement("span", null, "Open investigation") }),
    );
    assert.match(markup, new RegExp(`<h3 id="challenge-card-${challenge.id}-title"`));
    assert.doesNotMatch(markup, /<h2\b/);
    assert.match(markup, /<\/dl><div class="mt-auto"><span>Open investigation<\/span><\/div>/);
    assert.doesNotMatch(render(challenge), /Open investigation|mt-auto/, "no action unless one is given");
  });

  test("depends only on public types and shared display code", () => {
    const card = readFileSync(new URL("../../src/components/challenge/ChallengeCard.tsx", import.meta.url), "utf8");
    const imports = [...card.matchAll(/from "([^"]+)"/g)].map(([, from]) => from);
    assert.deepEqual(imports, ["react", "@/components/ui/Badge", "@/components/ui/icons", "@/types/workspace", "./difficulty"]);
  });
});
