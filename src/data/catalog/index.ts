/*
 * THE CHALLENGE REGISTRATION POINT.
 *
 * To add a challenge: create its scenario and listing under src/data/<id>/ and
 * add one entry here. The catalog validates it, and once its listing status is
 * "published" it appears in the Challenge Library, gets a route, and passes the
 * proxy's allow-list, with no change to any page or component. A "draft" or
 * "archived" entry is listed nowhere public and cannot be opened.
 *
 * Public data only: answer keys live in *.server.ts modules and are never
 * registered here.
 */
import { challenge001 } from "@/data/challenge-001";
import { listing as challenge001Listing } from "@/data/challenge-001/listing";
import type { CatalogEntry } from "@/types/catalog";

export const REGISTERED_CHALLENGES: readonly CatalogEntry[] = [{ scenario: challenge001, listing: challenge001Listing }];
