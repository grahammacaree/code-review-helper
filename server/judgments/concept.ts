import { choice } from "@typesafe-ai/sdk";
import type { ConceptForCard } from "../conceptMemory.js";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

/**
 * When several architectural systems hit the same path, pick the one the hunk
 * actually teaches on this card. Returns the filtered list (primary first) or
 * undefined to keep the heuristic order.
 */
export async function pickPrimaryConcept(opts: {
  path: string;
  concepts: ConceptForCard[];
  what?: string;
  why?: string;
  evidence?: string;
}): Promise<ConceptForCard[] | undefined> {
  if (opts.concepts.length <= 1) return undefined;

  const criteria: Record<string, string> = {
    none: "No listed system is clearly the teaching beat for this hunk.",
  };
  for (const c of opts.concepts) {
    criteria[c.id] = `${c.name}: ${c.teach.slice(0, 180)}`;
  }

  const result = await systemOne(
    {
      path: opts.path,
      card_what: opts.what?.slice(0, 400) ?? null,
      card_why: opts.why?.slice(0, 400) ?? null,
      evidence: opts.evidence?.slice(0, 3_000) ?? null,
      candidates: opts.concepts.map((c) => ({
        id: c.id,
        name: c.name,
        depth: c.depth,
      })),
    },
    {
      primary: choice(
        {
          task: "Which architectural system should this file card teach on?",
          prefer:
            "The system the hunk actually touches — not every system that merely exists in the repo.",
        },
        criteria,
      ),
    },
  );
  if (!result) return undefined;
  const ans = result.answers.primary;
  if (ans.confidence < ACT_CONFIDENCE) return undefined;
  if (ans.choice === "none") return [];

  const primary = opts.concepts.find((c) => c.id === ans.choice);
  if (!primary) return undefined;
  const rest = opts.concepts.filter((c) => c.id !== primary.id);
  return [primary, ...rest];
}
