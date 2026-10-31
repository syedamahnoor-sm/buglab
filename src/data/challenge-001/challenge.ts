import type { ChallengeSummary } from "@/types/workspace";

export const challenge: ChallengeSummary = {
  id: "challenge-001",
  number: "001",
  title: "Broken User Sessions",
  incident:
    "Users can log in successfully, but subsequent authenticated requests fail.",
  difficulty: "intermediate",
  status: "in-progress",
  tags: ["Authentication", "HTTP", "Backend"],
  estimatedMinutes: 30,
};
