import "server-only";
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { createEmailDelivery, type EmailDelivery } from "./email";
import { readAccountSettings, type AccountSettings } from "./settings";

/** Provider tables have their own names; no learner tables/migrations are created here. */
export function createAccountEngine(settings: AccountSettings, pool: Pool, deliver: EmailDelivery = createEmailDelivery(settings)) {
  return betterAuth({
    appName: "BugLab",
    logger: { disabled: true },
    baseURL: settings.origin,
    basePath: "/api/auth",
    secret: settings.secret,
    database: pool,
    trustedOrigins: [settings.origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        await deliver({ to: user.email, subject: "Reset your BugLab password", text: `Choose a new password within 30 minutes:\n${settings.origin}/reset-password#token=${encodeURIComponent(token)}\n\nIf you did not request this, ignore this email.` });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, token }) => {
        await deliver({ to: user.email, subject: "Verify your BugLab email", text: `Confirm your email within one hour:\n${settings.origin}/verify-email#token=${encodeURIComponent(token)}` });
      },
    },
    user: {
      modelName: "buglab_auth_user",
      additionalFields: { role: { type: "string", required: true, defaultValue: "learner", input: false } },
    },
    account: { modelName: "buglab_auth_account", encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { modelName: "buglab_auth_session", expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 10, cookieCache: { enabled: false } },
    verification: { modelName: "buglab_auth_verification" },
    rateLimit: { enabled: true, storage: "database", modelName: "buglab_auth_rate_limit", window: 60, max: 30, customRules: { "/get-session": { window: 60, max: 300 }, "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 60, max: 3 }, "/request-password-reset": { window: 60, max: 3 }, "/send-verification-email": { window: 60, max: 3 } } },
    advanced: { cookiePrefix: "buglab_account", useSecureCookies: settings.production || settings.origin.startsWith("https:"), defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" }, ipAddress: { ipAddressHeaders: ["x-buglab-client-ip"] } },
    socialProviders: settings.google ? { google: { ...settings.google, requireEmailVerification: true, mapProfileToUser: (profile) => ({ name: profile.name?.trim().slice(0, 80) ?? "" }) } } : {},
  });
}

export type AccountEngine = ReturnType<typeof createAccountEngine>;
export interface AccountRuntime { settings: AccountSettings; pool: Pool; auth: AccountEngine }
let runtime: AccountRuntime | undefined;

export function getAccountRuntime(): AccountRuntime | null {
  const settings = readAccountSettings();
  if (!settings) return null;
  if (!runtime) {
    const pool = new Pool({ connectionString: settings.databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
    // Error details may contain database connection data. Never log them.
    pool.on("error", () => console.error("BugLab account database connection failed."));
    runtime = { settings, pool, auth: createAccountEngine(settings, pool) };
  }
  return runtime;
}
