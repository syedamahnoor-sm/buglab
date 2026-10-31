/*
 * Challenge 001 scenario: everything the workspace renders for this
 * challenge. Learner-visible content only; the answer key is kept in
 * answer-key.server.ts and must not be imported from here.
 */
import type { WorkspaceScenario } from "@/types/workspace";
import { challenge } from "./challenge";
import { scenarioFiles } from "./files";
import { incidentLogs } from "./logs";

export const challenge001: WorkspaceScenario = {
  challenge,
  files: scenarioFiles,
  logs: incidentLogs,
  entryFilePath: "INCIDENT.md",
};
