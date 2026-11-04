/* Answer key for Challenge 029: The Retry Storm. Server-only; registered in src/server/content. */
import "server-only";
import { challenge029 } from "@/data/challenge-029";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge029, {
  revision: "1",
  correctRootCauseId: "retries-multiply-load",
  resolutionSummary:
    "checkout-api retries each stock check up to five times, immediately (attempts are exactly 500 ms apart: the timeout, then " +
    "straight into the next try), and the gateway retries each quote up to twice more on 503 or timeout. One quote can therefore " +
    "become 3 x 5 = 15 stock checks. During the 20-second failover every check timed out, so inventory traffic jumped from 29 " +
    "to over 400 requests per second, well above the four pods' capacity of about 240. Once overloaded, requests took seconds, " +
    "which tripped the 500 ms timeout and caused yet more retries, so the overload sustained itself long after the database " +
    "recovered (p99 6 ms at 10:00:20). Customer traffic stayed at 29 rps at the gateway throughout, and four pods handle normal " +
    "load easily, as the 09:59 and 10:42 figures show. Retrying at one layer only, with exponential backoff and jitter, a retry " +
    "budget and a circuit breaker, fixes it.",
  observations: [
    { id: "immediate-retries", why: "Five attempts exactly one timeout apart, with no backoff", logs: [3, 4, 5, 6, 7] },
    { id: "amplified-load", why: "Inventory traffic is ~15x the gateway's, which stayed flat", logs: [11, 13] },
    { id: "database-recovered", why: "The database recovered within 20 seconds", logs: [10] },
    { id: "normal-capacity-fine", why: "The same pods handle normal load easily before and after", logs: [1, 16] },
    { id: "requests-pile-up", why: "Requests pile up in the inventory service", logs: [12] },
    { id: "gateway-retries-too", why: "The gateway retries the failed quote itself", logs: [8] },
    { id: "customers-see-503", why: "Customers get 503 after about 7.5 seconds", logs: [9, 14], requests: [1, 2] },
  ],
  investigationHints: [
    "Compare the request rate at the gateway, at checkout-api and at the inventory service during the outage. Where does it grow?",
    "Look at the timing between consecutive attempts, and at how many layers decide to try again.",
  ],
});
