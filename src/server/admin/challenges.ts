/*
 * Admin read access to the challenge catalog. Server-only.
 *
 * Every function takes the authenticated user and checks the permission
 * itself, so a page or route that forgets its guard still cannot read this.
 * Read-only by design: challenges are registered in code (src/data/catalog),
 * so there is nothing an admin form could truthfully save yet. Answer keys
 * are never read here.
 */
import "server-only";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { byCatalogOrder } from "@/lib/catalog/catalog";
import { validateCatalogEntry, type ListingIssue } from "@/lib/catalog/validate";
import { can } from "@/server/auth/permissions";
import type { AuthenticatedUser } from "@/server/auth/types";
import type { AdminChallengeDetail, AdminChallengeRow, ReadinessCheck } from "@/types/admin";
import type { CatalogEntry } from "@/types/catalog";

export class AdminAccessError extends Error {
  constructor() {
    super("Admin access is required.");
    this.name = "AdminAccessError";
  }
}

function assertAdmin(user: AuthenticatedUser | null): void {
  if (!can(user?.role ?? null, "admin:challenges:read")) throw new AdminAccessError();
}

/** The publication readiness checklist, grouped from the catalog's validation. */
const CHECK_GROUPS: { id: string; label: string; fields: string[] }[] = [
  { id: "identity", label: "ID, number and slug", fields: ["id", "slug", "number"] },
  { id: "listing", label: "Title, incident and description", fields: ["title", "incident", "description"] },
  { id: "classification", label: "Category, difficulty, technologies and tags", fields: ["category", "difficulty", "technologies", "tags"] },
  { id: "timing", label: "Estimated time and publish date", fields: ["estimatedMinutes", "publishedAt"] },
  { id: "playable", label: "Files and entry file", fields: ["files", "entryFilePath"] },
  { id: "diagnosis", label: "Root-cause options and completion mode", fields: ["rootCauseOptions", "completion"] },
  { id: "status", label: "Publication status and featured flag", fields: ["status", "featured"] },
];

export function readinessChecks(issues: readonly ListingIssue[]): ReadinessCheck[] {
  return CHECK_GROUPS.map((group) => {
    const failed = issues.filter((issue) => group.fields.includes(issue.field));
    return {
      id: group.id,
      label: group.label,
      passed: failed.length === 0,
      detail: failed.length ? failed.map((issue) => `${issue.field} ${issue.message}`).join("; ") : null,
    };
  });
}

function rowOf(entry: CatalogEntry, checks: ReadinessCheck[]): AdminChallengeRow {
  const failedChecks = checks.filter((check) => !check.passed).length;
  return {
    id: entry.scenario.challenge.id,
    number: entry.scenario.challenge.number,
    title: entry.scenario.challenge.title,
    status: entry.listing.status,
    featured: entry.listing.featured === true,
    ready: failedChecks === 0,
    failedChecks,
  };
}

/** Every registered challenge, drafts and archived included, for an admin. */
export function listAdminChallenges(user: AuthenticatedUser | null, entries: readonly CatalogEntry[] = REGISTERED_CHALLENGES): AdminChallengeRow[] {
  assertAdmin(user);
  return entries
    .map((entry) => rowOf(entry, readinessChecks(validateCatalogEntry(entry))))
    .sort(byCatalogOrder);
}

/** One challenge's metadata and readiness, for an admin, or null if no such challenge. */
export function getAdminChallenge(
  user: AuthenticatedUser | null,
  id: string,
  entries: readonly CatalogEntry[] = REGISTERED_CHALLENGES,
): AdminChallengeDetail | null {
  assertAdmin(user);
  const entry = entries.find((candidate) => candidate.scenario.challenge.id === id);
  if (!entry) return null;
  const checks = readinessChecks(validateCatalogEntry(entry));
  return {
    row: rowOf(entry, checks),
    summary: structuredClone(entry.scenario.challenge),
    listing: structuredClone(entry.listing),
    checks,
  };
}
