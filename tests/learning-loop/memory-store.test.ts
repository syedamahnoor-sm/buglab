import { MemoryLearningLoopStore } from "../../src/server/learning-loop/memory-store";
import { runLearningLoopStoreContract } from "./store-contract";

// The shared contract (also run against PostgreSQL in tests/postgres/learning-loop-store.test.ts).
runLearningLoopStoreContract("MemoryLearningLoopStore", async () => {
  let n = 0;
  return {
    store: new MemoryLearningLoopStore(),
    // The memory store has no foreign keys, so opaque ids are enough.
    learner: async () => `L${++n}`,
    session: async (learnerId, challengeId) => `S-${learnerId}-${challengeId}`,
  };
});
