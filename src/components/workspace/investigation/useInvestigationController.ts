import { useReducer } from "react";
import { getEvidenceId } from "@/lib/evidence";
import type {
  EvidenceItem,
  EvidenceRef,
  Hypothesis,
  HypothesisStatus,
  Observation,
} from "@/types/investigation";

/*
 * Learner investigation state. In memory only for now: it resets on refresh.
 * This is the seam where the Challenge Engine can later load or receive it.
 */
export interface InvestigationState {
  evidence: EvidenceItem[];
  hypotheses: Hypothesis[];
  observations: Observation[];
  nextId: number;
}

type InvestigationAction =
  | { type: "add-evidence"; ref: EvidenceRef; at: number }
  | { type: "remove-evidence"; id: string }
  | { type: "set-evidence-note"; id: string; note: string }
  | { type: "add-hypothesis"; text: string; at: number }
  | { type: "set-hypothesis-status"; id: string; status: HypothesisStatus }
  | { type: "remove-hypothesis"; id: string }
  | { type: "add-observation"; text: string; at: number }
  | { type: "remove-observation"; id: string };

const initialState: InvestigationState = {
  evidence: [],
  hypotheses: [],
  observations: [],
  nextId: 1,
};

export function investigationReducer(
  state: InvestigationState,
  action: InvestigationAction,
): InvestigationState {
  switch (action.type) {
    case "add-evidence": {
      const id = getEvidenceId(action.ref);
      if (state.evidence.some((item) => item.id === id)) return state;
      return {
        ...state,
        evidence: [...state.evidence, { id, ref: action.ref, note: "", addedAt: action.at }],
      };
    }
    case "remove-evidence":
      return { ...state, evidence: state.evidence.filter((item) => item.id !== action.id) };
    case "set-evidence-note":
      return {
        ...state,
        evidence: state.evidence.map((item) =>
          item.id === action.id ? { ...item, note: action.note } : item,
        ),
      };

    case "add-hypothesis": {
      const text = action.text.trim();
      if (!text) return state;
      const hypothesis: Hypothesis = {
        id: `hypothesis-${state.nextId}`,
        text,
        status: "open",
        createdAt: action.at,
      };
      return { ...state, hypotheses: [...state.hypotheses, hypothesis], nextId: state.nextId + 1 };
    }
    case "set-hypothesis-status":
      return {
        ...state,
        hypotheses: state.hypotheses.map((item) =>
          item.id === action.id ? { ...item, status: action.status } : item,
        ),
      };
    case "remove-hypothesis":
      return { ...state, hypotheses: state.hypotheses.filter((item) => item.id !== action.id) };

    case "add-observation": {
      const text = action.text.trim();
      if (!text) return state;
      const observation: Observation = {
        id: `observation-${state.nextId}`,
        text,
        createdAt: action.at,
      };
      return {
        ...state,
        observations: [...state.observations, observation],
        nextId: state.nextId + 1,
      };
    }
    case "remove-observation":
      return {
        ...state,
        observations: state.observations.filter((item) => item.id !== action.id),
      };
  }
}

export function useInvestigationController() {
  const [state, dispatch] = useReducer(investigationReducer, initialState);

  return {
    evidence: state.evidence,
    hypotheses: state.hypotheses,
    observations: state.observations,
    isCollected: (ref: EvidenceRef) =>
      state.evidence.some((item) => item.id === getEvidenceId(ref)),
    addEvidence: (ref: EvidenceRef) => dispatch({ type: "add-evidence", ref, at: Date.now() }),
    removeEvidence: (id: string) => dispatch({ type: "remove-evidence", id }),
    setEvidenceNote: (id: string, note: string) =>
      dispatch({ type: "set-evidence-note", id, note }),
    addHypothesis: (text: string) => dispatch({ type: "add-hypothesis", text, at: Date.now() }),
    setHypothesisStatus: (id: string, status: HypothesisStatus) =>
      dispatch({ type: "set-hypothesis-status", id, status }),
    removeHypothesis: (id: string) => dispatch({ type: "remove-hypothesis", id }),
    addObservation: (text: string) => dispatch({ type: "add-observation", text, at: Date.now() }),
    removeObservation: (id: string) => dispatch({ type: "remove-observation", id }),
  };
}

export type InvestigationController = ReturnType<typeof useInvestigationController>;
