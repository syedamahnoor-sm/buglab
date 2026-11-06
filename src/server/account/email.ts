import "server-only";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AccountSettings } from "./settings";

export interface AccountEmail { to: string; subject: string; text: string }
export type EmailDelivery = (message: AccountEmail) => Promise<void>;

export function createEmailDelivery(settings: AccountSettings): EmailDelivery {
  if (settings.email.mode === "capture") {
    if (settings.production) throw new Error("Email capture is forbidden in production.");
    const directory = settings.email.directory ?? join(process.cwd(), ".buglab-dev-mail");
    return async (message) => {
      // Never printed, exported to session logs, or served over HTTP.
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
    };
  }
  const smtp = settings.email;
  const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure, auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined, connectionTimeout: 10_000, socketTimeout: 15_000 });
  return async (message) => { await transport.sendMail({ ...message, from: smtp.from }); };
}
