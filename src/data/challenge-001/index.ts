/*
 * Challenge 001 scenario: everything the workspace renders for this
 * challenge. Learner-visible content only; the answer key is kept in
 * answer-key.server.ts and must not be imported from here.
 */
import type { WorkspaceScenario } from "@/types/workspace";
import { challenge } from "./challenge";
import { rootCauseOptions } from "./diagnosis-options";
import { scenarioFiles } from "./files";
import { INCIDENT_DATE, incidentLogs } from "./logs";
import { networkRequests } from "./network";

export const challenge001: WorkspaceScenario = {
  contractVersion: 1,
  challenge,
  files: scenarioFiles,
  incidentDate: INCIDENT_DATE,
  logs: incidentLogs,
  network: networkRequests,
  rootCauseOptions,
  entryFilePath: "INCIDENT.md",
};
