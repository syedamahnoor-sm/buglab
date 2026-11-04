/*
 * What the admin area shows about a challenge. Built server-side for an
 * authorised admin only (src/server/admin). Public listing metadata and
 * readiness, never evaluation data: answer keys stay in *.server.ts modules
 * and the admin area does not read them.
 */
import type { ChallengeListing, PublicationStatus } from "./catalog";
import type { ChallengeSummary } from "./workspace";

export interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  /** Why it failed, when it did. */
  detail: string | null;
}

export interface AdminChallengeRow {
  id: string;
  number: string;
  title: string;
  status: PublicationStatus;
  featured: boolean;
  /** True when every readiness check passes. */
  ready: boolean;
  failedChecks: number;
}

export interface AdminChallengeDetail {
  row: AdminChallengeRow;
  summary: ChallengeSummary;
  listing: ChallengeListing;
  checks: ReadinessCheck[];
}
