import type { ChallengeListing } from "@/types/catalog";

/** Challenge 001's public listing. The scenario itself is unchanged. */
export const listing: ChallengeListing = {
  slug: "challenge-001",
  description:
    "Users can log in, but every request after login is rejected. Trace the session through the server code, logs and network traffic.",
  category: "authentication",
  // From the scenario's own package.json and src/server.ts.
  technologies: ["TypeScript", "Node.js", "Express"],
  status: "published",
  featured: true,
  // First added to BugLab in commit a467b2a.
  publishedAt: "2026-10-31",
};
