/*
 * Rejects challenge URLs that are not exactly a catalog challenge's path, before
 * Next.js reads or writes its route cache. That cache stores each challenge URL
 * as a file named after the URL, so on a case-insensitive file system (Windows,
 * default macOS) a cached 404 for /challenges/CHALLENGE-001 overwrites the page
 * for /challenges/challenge-001. Rejecting here also stops unknown IDs from
 * adding a cache entry each. The page keeps its own notFound() check.
 */
import { NextResponse, type NextRequest } from "next/server";
import { listChallengeSummaries } from "@/lib/challenge-catalog";
import { challengePath } from "@/lib/challenge-routes";

/** Every playable challenge path, compared as requested: no decoding, exact case. */
const CHALLENGE_PATHS: ReadonlySet<string> = new Set(listChallengeSummaries().map(({ id }) => challengePath(id)));

export function proxy(request: NextRequest) {
  if (CHALLENGE_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  return new NextResponse("Challenge not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export const config = {
  matcher: "/challenges/:challengeId",
};
