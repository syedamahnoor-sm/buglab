/*
 * The public challenge catalog contract: listing metadata registered with each
 * challenge, and the public view of a published challenge that pages and the
 * Challenge Library receive. Public data only: nothing here describes how a
 * challenge is evaluated.
 */
import type { ChallengeSummary, Difficulty, WorkspaceScenario } from "./workspace";

export type PublicationStatus = "draft" | "published" | "archived";

export type CategoryId = "authentication" | "api" | "frontend" | "database" | "performance" | "infrastructure";

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  description: string;
}

/** Public listing metadata, registered alongside a challenge's scenario. */
export interface ChallengeListing {
  /** URL segment. Must equal the challenge ID until slugs and IDs are routed separately. */
  slug: string;
  /** One or two sentences: the situation, never the cause. */
  description: string;
  category: CategoryId;
  /** Languages, runtimes and frameworks in the challenge's codebase. */
  technologies: string[];
  status: PublicationStatus;
  featured?: boolean;
  /** Calendar date (YYYY-MM-DD) the challenge was first published. Required when published. */
  publishedAt?: string;
}

/** What a challenge registers: its playable scenario and its listing. */
export interface CatalogEntry {
  scenario: WorkspaceScenario;
  listing: ChallengeListing;
}

/** A published challenge as discovery shows it. Safe to send to the browser. */
export interface PublicChallenge extends ChallengeSummary {
  slug: string;
  description: string;
  category: CategoryId;
  technologies: string[];
  featured: boolean;
  publishedAt: string;
}

export type { Difficulty };
