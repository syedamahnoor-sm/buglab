/*
 * The catalog-compatibility and investigation-hints contracts on the in-memory store. The same contracts run on PostgreSQL
 * in tests/postgres/catalog-and-hints.test.ts.
 */
import { createAppServices, type AppServicesOptions } from "@/server/app-services";
import { MemoryStore } from "@/server/session/memory-store";
import { catalogAndHintsContract } from "./catalog-and-hints-contract";

catalogAndHintsContract("in memory", async () => {
  const store = new MemoryStore();
  return {
    store,
    compose: (options: Partial<AppServicesOptions> = {}) => createAppServices({ store, appOrigin: null, trustedProxyHops: 0, ...options }),
  };
});
