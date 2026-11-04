/*
 * Builds the catalog from registered entries. Only published entries are
 * discoverable or playable; drafts and archived entries are kept for the admin
 * inventory only. A published entry that fails validation stops the build, so
 * an incomplete challenge can never ship as playable.
 */
import type { CatalogEntry, PublicChallenge } from "@/types/catalog";
import type { ChallengeSummary, WorkspaceScenario } from "@/types/workspace";
import { validateCatalogEntry, type ListingIssue } from "./validate";

export interface InventoryItem {
  id: string;
  number: string;
  title: string;
  status: CatalogEntry["listing"]["status"];
  featured: boolean;
  issues: ListingIssue[];
}

/** Catalog order: challenge number compared numerically, then ID. */
export function byCatalogOrder(a: Pick<ChallengeSummary, "number" | "id">, b: Pick<ChallengeSummary, "number" | "id">): number {
  return a.number.localeCompare(b.number, "en", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function toPublic(entry: CatalogEntry): PublicChallenge {
  const { listing } = entry;
  return {
    ...structuredClone(entry.scenario.challenge),
    slug: listing.slug,
    description: listing.description,
    category: listing.category,
    technologies: [...listing.technologies],
    featured: listing.featured === true,
    publishedAt: listing.publishedAt!,
  };
}

export function createCatalog(entries: readonly CatalogEntry[]) {
  const ids = new Set<string>();
  for (const { scenario } of entries) {
    if (ids.has(scenario.challenge.id)) throw new Error(`Duplicate challenge ID in the catalog: ${scenario.challenge.id}`);
    ids.add(scenario.challenge.id);
  }

  const checked = entries.map((entry) => ({ entry, issues: validateCatalogEntry(entry) }));
  const broken = checked.filter(({ entry, issues }) => entry.listing.status === "published" && issues.length > 0);
  if (broken.length > 0) {
    const detail = broken
      .map(({ entry, issues }) => `${entry.scenario.challenge.id}: ${issues.map((issue) => `${issue.field} ${issue.message}`).join("; ")}`)
      .join("\n");
    throw new Error(`Published challenges must pass catalog validation:\n${detail}`);
  }

  const published = checked
    .filter(({ entry }) => entry.listing.status === "published")
    .map(({ entry }) => entry)
    .sort((a, b) => byCatalogOrder(a.scenario.challenge, b.scenario.challenge));
  const publishedById = new Map(published.map((entry) => [entry.scenario.challenge.id, entry]));

  return {
    /** Published challenges, in catalog order. New copies on every call. */
    listPublished(): PublicChallenge[] {
      return published.map(toPublic);
    },
    /** The playable scenario of a published challenge (exact ID), or null. */
    getPublishedScenario(id: string): WorkspaceScenario | null {
      return publishedById.get(id)?.scenario ?? null;
    },
    /** Every registered entry with its status and problems. For the admin inventory only. */
    inventory(): InventoryItem[] {
      return checked
        .map(({ entry, issues }) => ({
          id: entry.scenario.challenge.id,
          number: entry.scenario.challenge.number,
          title: entry.scenario.challenge.title,
          status: entry.listing.status,
          featured: entry.listing.featured === true,
          issues: issues.map((issue) => ({ ...issue })),
        }))
        .sort(byCatalogOrder);
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
