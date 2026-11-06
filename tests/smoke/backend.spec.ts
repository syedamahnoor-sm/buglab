import { test, expect } from "@playwright/test";

test("real authentication: login, restored identity, origin refusal, logout and protected API", async ({ playwright, baseURL }) => {
  test.skip(process.env.BUGLAB_SMOKE_AUTH !== "enabled", "Authentication integration is pending; explicitly enable only against a real configured staging backend.");
  expect(Boolean(process.env.BUGLAB_SMOKE_EMAIL && process.env.BUGLAB_SMOKE_PASSWORD), "Provide a dedicated, already verified test account through environment configuration.").toBe(true);
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL!).origin } });
  try {
    const anonymous = await api.get("/api/account/session");
    expect(anonymous.status()).toBe(200);
    expect((await anonymous.json()).session).toBeNull();
    expect((await api.patch("/api/account/profile", { data: { displayName: "Must never be written" } })).status()).toBe(401);
    const login = await api.post("/api/account/sign-in", { data: { email: process.env.BUGLAB_SMOKE_EMAIL, password: process.env.BUGLAB_SMOKE_PASSWORD } });
    expect(login.status()).toBe(200);
    const signedIn = (await login.json()).session;
    expect(signedIn.user.emailVerified).toBe(true);
    expect(["learner", "admin"]).toContain(signedIn.user.role);
    const restored = await api.get("/api/account/session");
    expect(restored.headers()["cache-control"]).toContain("no-store");
    expect((await restored.json()).session.user.id).toBe(signedIn.user.id);
    const crossOrigin = await api.post("/api/account/sign-out", { headers: { Origin: "https://untrusted.invalid" }, data: {} });
    expect(crossOrigin.status()).toBe(403);
    expect((await (await api.get("/api/account/session")).json()).session.user.id).toBe(signedIn.user.id);
    expect((await api.post("/api/account/sign-out", { data: {} })).status()).toBe(200);
    expect((await (await api.get("/api/account/session")).json()).session).toBeNull();
  } finally { await api.dispose(); }
});

test("real learner completions: explicit possession, authoritative shape and private caching", async ({ playwright, baseURL }) => {
  test.skip(process.env.BUGLAB_SMOKE_LEARNER !== "enabled", "Learner APIs are unpublished; enable only after Habin confirms their mounted contract.");
  expect(Boolean(process.env.BUGLAB_SMOKE_LEARNER_COOKIE), "Provide a dedicated test learner's complete Cookie header through the environment.").toBe(true);
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: process.env.BUGLAB_SMOKE_LEARNER_COOKIE! } });
  try {
    const response = await api.get("/api/learner/completions");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(body.learner.state).toBe("active");
    expect(Array.isArray(body.completions)).toBe(true);
    for (const completion of body.completions) {
      expect(typeof completion.challengeId).toBe("string");
      expect(Number.isFinite(Date.parse(completion.completedAt))).toBe(true);
      expect(typeof completion.contentVersion).toBe("string");
    }
  } finally { await api.dispose(); }
});
