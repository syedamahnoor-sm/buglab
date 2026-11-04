/*
 * Test-only catalog entries. They reuse Challenge 001's scenario under another
 * id so they are valid and playable in shape; they are never registered in
 * src/data/catalog and never shipped.
 */
import { challenge001 } from "@/data/challenge-001";
import { listing as challenge001Listing } from "@/data/challenge-001/listing";
import type { CatalogEntry, ChallengeListing, PublicChallenge } from "@/types/catalog";
import type { ChallengeSummary } from "@/types/workspace";

export function fixtureEntry(
  id: string,
  options: { summary?: Partial<ChallengeSummary>; listing?: Partial<ChallengeListing> } = {},
): CatalogEntry {
  const number = id.replace(/\D/g, "").padStart(3, "0") || "900";
  return {
    scenario: {
      ...challenge001,
      challenge: { ...challenge001.challenge, id, number, title: `Fixture ${id}`, ...options.summary },
    },
    listing: { ...challenge001Listing, slug: id, featured: false, ...options.listing },
  };
}

export function fixtureChallenge(id: string, overrides: Partial<PublicChallenge> = {}): PublicChallenge {
  return {
    ...challenge001.challenge,
    id,
    number: id.replace(/\D/g, "").padStart(3, "0") || "900",
    title: `Fixture ${id}`,
    slug: id,
    description: "A fixture challenge used only by tests.",
    category: "api",
    technologies: ["Go"],
    featured: false,
    publishedAt: "2026-01-01",
    ...overrides,
  };
}
