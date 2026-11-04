/*
 * THE ANSWER-KEY REGISTRATION POINT. Server-only.
 *
 * Every challenge authored with src/lib/authoring has one entry here, in the
 * same order as src/data/catalog/index.ts. Both the live diagnosis registry
 * and the challenge registry load this list, so a challenge registered here is
 * submittable once the catalog publishes it. tests/content/registration.test.ts
 * fails if the two lists disagree. See docs/authoring/challenges.md.
 */
import "server-only";
import { answerKey as challenge002 } from "@/data/challenge-002/answer-key.server";
import { answerKey as challenge003 } from "@/data/challenge-003/answer-key.server";
import { answerKey as challenge004 } from "@/data/challenge-004/answer-key.server";
import { answerKey as challenge005 } from "@/data/challenge-005/answer-key.server";
import { answerKey as challenge006 } from "@/data/challenge-006/answer-key.server";
import { answerKey as challenge007 } from "@/data/challenge-007/answer-key.server";
import { answerKey as challenge008 } from "@/data/challenge-008/answer-key.server";
import { answerKey as challenge009 } from "@/data/challenge-009/answer-key.server";
import { answerKey as challenge010 } from "@/data/challenge-010/answer-key.server";
import { answerKey as challenge011 } from "@/data/challenge-011/answer-key.server";
import { answerKey as challenge012 } from "@/data/challenge-012/answer-key.server";
import { answerKey as challenge013 } from "@/data/challenge-013/answer-key.server";
import { answerKey as challenge014 } from "@/data/challenge-014/answer-key.server";
import { answerKey as challenge015 } from "@/data/challenge-015/answer-key.server";
import { answerKey as challenge016 } from "@/data/challenge-016/answer-key.server";
import { answerKey as challenge017 } from "@/data/challenge-017/answer-key.server";
import { answerKey as challenge018 } from "@/data/challenge-018/answer-key.server";
import { answerKey as challenge019 } from "@/data/challenge-019/answer-key.server";
import { answerKey as challenge020 } from "@/data/challenge-020/answer-key.server";
import { answerKey as challenge021 } from "@/data/challenge-021/answer-key.server";
import { answerKey as challenge022 } from "@/data/challenge-022/answer-key.server";
import { answerKey as challenge024 } from "@/data/challenge-024/answer-key.server";
import { answerKey as challenge025 } from "@/data/challenge-025/answer-key.server";
import { answerKey as challenge026 } from "@/data/challenge-026/answer-key.server";
import { answerKey as challenge028 } from "@/data/challenge-028/answer-key.server";
import { answerKey as challenge029 } from "@/data/challenge-029/answer-key.server";
import { answerKey as challenge030 } from "@/data/challenge-030/answer-key.server";
import type { AuthoredChallenge } from "./define-answer-key";

export const AUTHORED_CHALLENGES: readonly AuthoredChallenge[] = [
  challenge002,
  challenge003,
  challenge004,
  challenge005,
  challenge006,
  challenge007,
  challenge008,
  challenge009,
  challenge010,
  challenge011,
  challenge012,
  challenge013,
  challenge014,
  challenge015,
  challenge016,
  challenge017,
  challenge018,
  challenge019,
  challenge020,
  challenge021,
  challenge022,
  challenge024,
  challenge025,
  challenge026,
  challenge028,
  challenge029,
  challenge030,
];

const HINTS: ReadonlyMap<string, readonly string[]> = new Map(
  AUTHORED_CHALLENGES.map((authored) => [authored.scenario.challenge.id, authored.investigationHints]),
);

/** A challenge's investigation hints for incorrect diagnoses, or undefined to use the generic ones. */
export function investigationHintsFor(challengeId: string): readonly string[] | undefined {
  return HINTS.get(challengeId);
}
