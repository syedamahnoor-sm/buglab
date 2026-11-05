import type { Metadata } from "next";
import { WorkspaceWelcome } from "@/components/workspace/WorkspaceWelcome";

export const metadata: Metadata = {
  title: "BugLab · Workspace",
  description: "Your debugging workspace: choose a challenge to start investigating.",
};

/**
 * The workspace without an open challenge. BugLab keeps no progress beyond
 * the open challenge page yet, so there is no unfinished challenge to resume
 * and the welcome screen is shown to everyone. It never redirects, so there
 * is no loop and nothing to break on refresh.
 */
export default function WorkspacePage() {
  return <WorkspaceWelcome />;
}
