import type { Score, ScoringRules, SessionState } from "../types";

export function maxScore(rules: ScoringRules): number {
  return rules.diagnosisPoints + rules.visibleFixPoints + rules.hiddenFixPoints;
}

export function computeScore(state: SessionState, rules: ScoringRules): Score {
  const diagnosis = state.diagnosed
    ? Math.max(
        0,
        rules.diagnosisPoints - state.wrongDiagnoses * rules.wrongDiagnosisPenalty,
      )
    : 0;
  const visibleFix =
    state.passedVisible || state.passedAll ? rules.visibleFixPoints : 0;
  const hiddenFix = state.passedAll ? rules.hiddenFixPoints : 0;
  const hintPenalty = rules.hintCosts
    .slice(0, state.hintsUsed)
    .reduce((sum, cost) => sum + cost, 0);

  return {
    total: Math.max(0, diagnosis + visibleFix + hiddenFix - hintPenalty),
    max: maxScore(rules),
    breakdown: { diagnosis, visibleFix, hiddenFix, hintPenalty },
  };
}
