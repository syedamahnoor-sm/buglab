import { ChallengeWorkspacePage } from "@/components/challenge/ChallengeWorkspacePage";
import { challenge001 } from "@/data/challenge-001";

export default function Home() {
  return <ChallengeWorkspacePage scenario={challenge001} />;
}
