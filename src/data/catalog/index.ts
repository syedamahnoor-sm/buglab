/*
 * THE CHALLENGE REGISTRATION POINT.
 *
 * To add a challenge: create its scenario and listing under src/data/<id>/ and
 * add one entry here, and its answer key to src/server/content/index.ts (see
 * docs/authoring/challenges.md). The catalog validates it, and once its listing status is
 * "published" it appears in the Challenge Library, gets a route, and passes the
 * proxy's allow-list, with no change to any page or component. A "draft" or
 * "archived" entry is listed nowhere public and cannot be opened.
 *
 * Public data only: answer keys live in *.server.ts modules and are never
 * registered here.
 */
import { challenge001 } from "@/data/challenge-001";
import { listing as challenge001Listing } from "@/data/challenge-001/listing";
import { challenge002 } from "@/data/challenge-002";
import { challenge003 } from "@/data/challenge-003";
import { challenge004 } from "@/data/challenge-004";
import { challenge005 } from "@/data/challenge-005";
import { challenge006 } from "@/data/challenge-006";
import { challenge007 } from "@/data/challenge-007";
import { challenge008 } from "@/data/challenge-008";
import { challenge009 } from "@/data/challenge-009";
import { challenge010 } from "@/data/challenge-010";
import { challenge011 } from "@/data/challenge-011";
import { challenge012 } from "@/data/challenge-012";
import { challenge013 } from "@/data/challenge-013";
import { challenge014 } from "@/data/challenge-014";
import { challenge015 } from "@/data/challenge-015";
import { challenge016 } from "@/data/challenge-016";
import { challenge017 } from "@/data/challenge-017";
import { challenge018 } from "@/data/challenge-018";
import { challenge019 } from "@/data/challenge-019";
import { challenge020 } from "@/data/challenge-020";
import { challenge021 } from "@/data/challenge-021";
import { challenge022 } from "@/data/challenge-022";
import { challenge024 } from "@/data/challenge-024";
import { challenge025 } from "@/data/challenge-025";
import { challenge026 } from "@/data/challenge-026";
import { challenge028 } from "@/data/challenge-028";
import { challenge029 } from "@/data/challenge-029";
import { challenge030 } from "@/data/challenge-030";
import type { CatalogEntry } from "@/types/catalog";

export const REGISTERED_CHALLENGES: readonly CatalogEntry[] = [
  { scenario: challenge001, listing: challenge001Listing },
  challenge002,
  challenge003,
  challenge004,
  challenge005,
  challenge006,
  challenge007,
  challenge008,
  challenge009,
  challenge010,
  challenge011,
  challenge012,
  challenge013,
  challenge014,
  challenge015,
  challenge016,
  challenge017,
  challenge018,
  challenge019,
  challenge020,
  challenge021,
  challenge022,
  challenge024,
  challenge025,
  challenge026,
  challenge028,
  challenge029,
  challenge030,
];
