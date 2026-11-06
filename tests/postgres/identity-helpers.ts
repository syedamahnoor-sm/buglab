/*
 * Test helpers for the identity tests. Not a test file.
 *
 * `testProvider` stands in for a real authentication provider: it "verifies" a session the way a provider would, by looking at
 * ITS OWN session marker on the request (here a header only this test provider reads), and answers with an AuthSession. The
 * code under test never reads that header; it only ever asks the provider. That is exactly what the tests rely on.
 */
import type { AuthProvider } from "@/server/auth/provider";
import type { AuthSession } from "@/server/auth/types";
import { verifyAccount } from "@/server/identity/verified-account";
import type { VerifiedAccount } from "@/server/identity/types";

export const SIGNED_IN_AS = "x-test-signed-in-as";

export interface TestProviderOptions {
  /** Calls to getSession, so a test can see what the code under test asked the provider. */
  calls?: Request[];
  /** Overrides the session built for a signed-in request. */
  session?: (accountId: string) => AuthSession | null;
}

export function testProvider({ calls, session }: TestProviderOptions = {}): AuthProvider {
  return {
    name: "test",
    configured: true,
    async getSession(request) {
      calls?.push(request);
      const id = request.headers.get(SIGNED_IN_AS);
      if (!id) return null;
      // An override may deliberately answer null ("no session"), so test for its presence, not its result.
      if (session) return session(id);
      return {
        user: {
          id,
          email: `${id}@example.test`,
          emailVerified: true,
          displayName: null,
          role: "learner",
        },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    },
  };
}

/** A request the test provider treats as signed in as `accountId`, optionally carrying a learner cookie. */
export function requestAs(accountId: string | null, extra: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/link", {
    method: "POST",
    headers: { host: "localhost:3000", ...(accountId ? { [SIGNED_IN_AS]: accountId } : {}), ...extra },
  });
}

/** A VerifiedAccount, obtained the only way one can be: through the provider. */
export async function verified(accountId: string): Promise<VerifiedAccount> {
  const account = await verifyAccount(testProvider(), requestAs(accountId));
  if (!account) throw new Error("the test provider did not verify the account");
  return account;
}
