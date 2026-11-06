import { categoryLabel } from "@/data/catalog/categories";
import type { ChallengeRecommendation, Reason } from "./types";

/** Templates depend only on public fields and explicit evidence; never free-form backend text. */
export function explainReason(reason: Reason, item?: ChallengeRecommendation): string {
  const category = reason.category ? categoryLabel(reason.category) : "this area";
  switch (reason.code) {
    case "starting-point": return "A beginner investigation from the published catalog: a place to start, not a skill assessment.";
    case "difficulty-fit": return item && item.challenge.difficulty !== reason.difficulty ? "A change of pace within your chosen range."
      : `${reason.difficulty ? reason.difficulty[0].toUpperCase() + reason.difficulty.slice(1) : "Selected"} difficulty within your practice range.`;
    case "goal-match": return `Matches your focus on ${category}.`;
    case "practice-request": return `You marked a related recall as needing practice in this browser (${category}).`;
    case "coverage-opportunity": return reason.basis === "server-verified"
      ? `${reason.completedCount} of ${reason.availableCount} published challenges in ${category} have verified completions. This adds practice coverage, not a proficiency score.`
      : `${reason.completedCount} of ${reason.availableCount} published challenges in ${category} have solves observed in this browser. This adds practice coverage.`;
    case "related-practice": return reason.basis === "server-verified" ? "Shares public topics with a recently verified-completed challenge."
      : "Shares public topics with a recent solve observed in this browser.";
    case "fits-time": return "The catalog's estimated time fits your selected budget; actual solving time can vary.";
    case "path-variety": return `Adds ${category} to this suggested sequence for a broader mix of practice.`;
    case "recall-due": return `Your browser-local reflection is due for recall on ${reason.dueOn}.`;
  }
}