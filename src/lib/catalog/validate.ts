/*
 * The catalog metadata contract. validateCatalogEntry lists every problem with
 * an entry; a published entry must have none. The checks are about what the
 * Challenge Library shows and whether the workspace can open the challenge,
 * not about how it is evaluated (that is server-side).
 */
import { CATEGORY_IDS } from "@/data/catalog/categories";
import type { CatalogEntry } from "@/types/catalog";

export interface ListingIssue {
  field: string;
  message: string;
}

export const LISTING_LIMITS = {
  titleLength: 80,
  descriptionLength: { min: 20, max: 240 },
  technologies: { min: 1, max: 8, length: 32 },
  tags: { max: 8, length: 32 },
  estimatedMinutes: { min: 1, max: 600 },
} as const;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBER = /^\d{3,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);
const STATUSES = new Set(["draft", "published", "archived"]);

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && value === value.trim();

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function checkList(issues: ListingIssue[], field: string, values: unknown, limits: { min?: number; max: number; length: number }) {
  if (!Array.isArray(values)) {
    issues.push({ field, message: "must be a list" });
    return;
  }
  if (limits.min !== undefined && values.length < limits.min) issues.push({ field, message: `needs at least ${limits.min}` });
  if (values.length > limits.max) issues.push({ field, message: `allows at most ${limits.max}` });
  const seen = new Set<string>();
  for (const value of values) {
    if (!isText(value) || value.length > limits.length) {
      issues.push({ field, message: `each must be non-blank text of at most ${limits.length} characters` });
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) issues.push({ field, message: `"${value}" is listed twice` });
    seen.add(key);
  }
}

/** Every problem with an entry, empty when it may be published. */
export function validateCatalogEntry(entry: CatalogEntry): ListingIssue[] {
  const issues: ListingIssue[] = [];
  const { challenge } = entry.scenario;
  const { listing } = entry;

  if (!isText(challenge.id) || !ID.test(challenge.id)) issues.push({ field: "id", message: "must be lowercase letters, digits and single hyphens" });
  if (listing.slug !== challenge.id) issues.push({ field: "slug", message: "must equal the challenge ID" });
  if (!isText(challenge.number) || !NUMBER.test(challenge.number)) issues.push({ field: "number", message: "must be at least three digits" });
  if (!isText(challenge.title) || challenge.title.length > LISTING_LIMITS.titleLength) {
    issues.push({ field: "title", message: `must be non-blank text of at most ${LISTING_LIMITS.titleLength} characters` });
  }
  if (!isText(challenge.incident)) issues.push({ field: "incident", message: "must be non-blank text" });
  if (!DIFFICULTIES.has(challenge.difficulty)) issues.push({ field: "difficulty", message: "must be beginner, intermediate or advanced" });
  const minutes = challenge.estimatedMinutes;
  if (!Number.isInteger(minutes) || minutes < LISTING_LIMITS.estimatedMinutes.min || minutes > LISTING_LIMITS.estimatedMinutes.max) {
    issues.push({ field: "estimatedMinutes", message: "must be a whole number of minutes from 1 to 600" });
  }
  checkList(issues, "tags", challenge.tags, LISTING_LIMITS.tags);

  const { min, max } = LISTING_LIMITS.descriptionLength;
  if (!isText(listing.description) || listing.description.length < min || listing.description.length > max) {
    issues.push({ field: "description", message: `must be ${min} to ${max} characters, without surrounding spaces` });
  }
  if (!CATEGORY_IDS.has(listing.category)) issues.push({ field: "category", message: "must be one of the defined categories" });
  checkList(issues, "technologies", listing.technologies, LISTING_LIMITS.technologies);
  if (!STATUSES.has(listing.status)) issues.push({ field: "status", message: "must be draft, published or archived" });
  if (listing.featured !== undefined && typeof listing.featured !== "boolean") issues.push({ field: "featured", message: "must be true or false" });
  if (listing.publishedAt !== undefined && !isCalendarDate(listing.publishedAt)) {
    issues.push({ field: "publishedAt", message: "must be a calendar date (YYYY-MM-DD)" });
  }
  if (listing.status === "published" && listing.publishedAt === undefined) {
    issues.push({ field: "publishedAt", message: "is required to publish" });
  }

  // Playable: the workspace can open it and the learner can submit a diagnosis.
  const { files, entryFilePath, rootCauseOptions } = entry.scenario;
  if (!Array.isArray(files) || files.length === 0) issues.push({ field: "files", message: "a playable challenge needs at least one file" });
  else if (!files.some((file) => file.path === entryFilePath)) issues.push({ field: "entryFilePath", message: "must be one of the challenge's files" });
  if (!Array.isArray(rootCauseOptions) || rootCauseOptions.length < 2) {
    issues.push({ field: "rootCauseOptions", message: "a diagnosis needs at least two root-cause options" });
  }
  if (challenge.completion !== "diagnosis") issues.push({ field: "completion", message: "only diagnosis challenges can be played today" });

  return issues;
}
