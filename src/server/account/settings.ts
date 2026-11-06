import "server-only";
import { parseTrustedProxyHops } from "@/server/diagnosis/client-ip";

export interface AccountSettings {
  origin: string;
  databaseUrl: string;
  secret: string;
  production: boolean;
  trustedProxyHops?: number;
  email: { mode: "smtp"; host: string; port: number; secure: boolean; user?: string; password?: string; from: string } | { mode: "capture"; directory?: string };
  google?: { clientId: string; clientSecret: string };
}

/** Explicit activation, never an implicit development account database. */
export function readAccountSettings(env: NodeJS.ProcessEnv = process.env): AccountSettings | null {
  if (env.BUGLAB_AUTH_PROVIDER !== "better-auth" || env.BUGLAB_ACCOUNTS_ENABLED !== "enabled") return null;
  const production = env.NODE_ENV === "production";
  if (production && env.BUGLAB_AUTH_PRODUCTION_VERIFIED !== "enabled") return null;
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || !env.BUGLAB_APP_ORIGIN) return null;
  const url = new URL(env.BUGLAB_APP_ORIGIN);
  if (url.origin !== env.BUGLAB_APP_ORIGIN || (production && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol)) throw new Error("BUGLAB_APP_ORIGIN must be an exact origin (HTTPS in production).");
  let email: AccountSettings["email"];
  if (env.BUGLAB_SMTP_HOST && env.BUGLAB_EMAIL_FROM) {
    const port = Number(env.BUGLAB_SMTP_PORT ?? "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP port.");
    email = { mode: "smtp", host: env.BUGLAB_SMTP_HOST, port, secure: port === 465, user: env.BUGLAB_SMTP_USER, password: env.BUGLAB_SMTP_PASSWORD, from: env.BUGLAB_EMAIL_FROM };
  } else if (!production && env.BUGLAB_EMAIL_MODE === "capture") email = { mode: "capture", directory: env.BUGLAB_DEV_MAIL_DIRECTORY };
  else return null;
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined;
  return { origin: url.origin, databaseUrl: env.DATABASE_URL, secret: env.BETTER_AUTH_SECRET, production, email, google, trustedProxyHops: parseTrustedProxyHops(env.BUGLAB_TRUSTED_PROXY_HOPS) };
}
