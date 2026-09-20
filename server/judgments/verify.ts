import { choice } from "@typesafe-ai/sdk";
import type { FileCard, LookCloser, UhOh } from "../types.js";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

/**
 * Drop Look closer / Be careful entries whose claims the hunk does not support.
 * Low-confidence answers keep the claim — better a soft false positive than
 * silently deleting a real footgun the model was unsure about.
 */
export async function verifyCardClaims(opts: {
  card: FileCard;
  /** Unified diff or file excerpt the claims must rest on. */
  evidence: string;
}): Promise<FileCard | undefined> {
  const looks = opts.card.lookCloser.slice(0, 3);
  const uhs = opts.card.uhOh.slice(0, 3);
  if (!looks.length && !uhs.length) return undefined;
  if (!opts.evidence.trim()) return undefined;

  const questions: Record<string, ReturnType<typeof choice>> = {};
  for (const [i, h] of looks.entries()) {
    questions[`look_${i}`] = claimChoice("Look closer hotspot", h.name, h.why);
  }
  for (const [i, u] of uhs.entries()) {
    questions[`uh_${i}`] = claimChoice("Be careful note", "be careful", u.text);
  }

  const result = await systemOne(
    {
      path: opts.card.path,
      card_what: opts.card.what,
      card_why: opts.card.why,
      evidence: opts.evidence.slice(0, 6_000),
      look_closer: looks.map((h) => ({
        name: h.name,
        lines: `${h.startLine}-${h.endLine}`,
        why: h.why,
      })),
      be_careful: uhs.map((u) => ({
        lines: `${u.startLine}-${u.endLine}`,
        text: u.text,
      })),
    },
    questions,
  );
  if (!result) return undefined;

  const nextLook: LookCloser[] = [];
  for (const [i, h] of looks.entries()) {
    if (keepClaim(result.answers[`look_${i}` as keyof typeof result.answers])) {
      nextLook.push(h);
    }
  }
  const nextUh: UhOh[] = [];
  for (const [i, u] of uhs.entries()) {
    if (keepClaim(result.answers[`uh_${i}` as keyof typeof result.answers])) {
      nextUh.push(u);
    }
  }

  if (
    nextLook.length === looks.length &&
    nextUh.length === uhs.length
  ) {
    return undefined; // nothing changed
  }

  return {
    ...opts.card,
    lookCloser: nextLook,
    uhOh: nextUh,
  };
}

function claimChoice(kind: string, name: string, claim: string) {
  return choice(
    {
      task: `Does the evidence support this ${kind} claim?`,
      name,
      claim,
    },
    {
      supports:
        "The evidence states or clearly implies the claim (including a named wrong alternative for a behavior pivot).",
      overstates:
        "The evidence is related but the claim goes further than what is shown.",
      unsupported:
        "The evidence does not address the claim, or contradicts it.",
    },
  );
}

function keepClaim(ans: unknown): boolean {
  if (!ans || typeof ans !== "object") return true;
  const a = ans as { choice?: string; confidence?: number };
  if (typeof a.confidence !== "number" || a.confidence < ACT_CONFIDENCE) {
    return true; // uncertain → keep
  }
  return a.choice === "supports";
}
