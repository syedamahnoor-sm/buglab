import type { BadgeTone } from "@/components/ui/Badge";
import type { Difficulty } from "@/types/workspace";

/** Label and badge tone for each difficulty, shared by every challenge view. */
export const difficultyDisplay: Record<Difficulty, { label: string; tone: BadgeTone }> = {
  beginner: { label: "Beginner", tone: "success" },
  intermediate: { label: "Intermediate", tone: "warning" },
  advanced: { label: "Advanced", tone: "danger" },
};
