import "server-only";
import type { VerifiedAccount } from "@/server/auth/verified-account";
import type { LinkOutcome, LinkStatus } from "@/lib/account/link";

/**
 * Habin owns the implementation. It must resolve the provider's verified account
 * through the server-issued VerifiedAccount contract, validate the live anonymous cookie and
 * retire its hash atomically. No body ids, imports of local solves, or parallel
 * persistence are permitted. No default adapter or learner migration is supplied.
 */
export interface SharedLearnerIntegration {
  status(request: Request, account: VerifiedAccount): Promise<LinkStatus>;
  link(request: Request, account: VerifiedAccount, consent: true): Promise<{ outcome: LinkOutcome; clearAnonymousCookie: boolean }>;
}
