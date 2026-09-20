import { noul, score } from "@typesafe-ai/sdk";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

export interface ChaseRankInput {
  path: string;
  names: string[];
  via?: "resolved" | "bound" | "barrel";
  from?: string;
}

/**
 * Rank outside importers for an opt-in chase. Prefers callers where the changed
 * export's contract looks load-bearing; drops drive-by or type-only imports when
 * confidence is high enough. Returns undefined to keep the heuristic shortlist.
 */
export async function rankChaseCandidates(opts: {
  targetPath: string;
  exportNames: string[];
  /** Short note on what changed about the export (card what/why or hunk tip). */
  contractHint?: string;
  candidates: ChaseRankInput[];
  limit?: number;
}): Promise<ChaseRankInput[] | undefined> {
  const limit = opts.limit ?? 3;
  const candidates = opts.candidates.slice(0, 12);
  if (candidates.length <= limit) return undefined;

  const questions: Record<
    string,
    ReturnType<typeof score> | ReturnType<typeof noul>
  > = {};
  for (const [i, c] of candidates.entries()) {
    questions[`worth_${i}`] = score(
      {
        task: "How worth chasing is this unchanged caller for blast-radius review?",
        caller: c.path,
        imports: c.names,
        prefer:
          "High when the call site likely assumes the old signature, error shape, or flag meaning. Low for re-exports, type-only imports, or incidental name mentions.",
      },
      [
        "Skip — type-only, re-export, or unlikely to care about the contract change",
        "Maybe — uses the export but impact is unclear",
        "Chase — call site likely depends on the changed contract",
      ],
    );
  }

  const result = await systemOne(
    {
      changed_module: opts.targetPath,
      changed_exports: opts.exportNames,
      contract_hint: opts.contractHint?.slice(0, 500) ?? null,
      candidates: candidates.map((c) => ({ path: c.path, names: c.names })),
    },
    questions,
  );
  if (!result) return undefined;

  const ranked = candidates
    .map((c, i) => {
      const ans = result.answers[
        `worth_${i}` as keyof typeof result.answers
      ] as { score: number; confidence: number } | undefined;
      return {
        ...c,
        score: ans?.score ?? 0,
        confidence: ans?.confidence ?? 0,
      };
    })
    .filter((r) => r.confidence >= ACT_CONFIDENCE * 0.75)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  if (ranked.length < 1) return undefined;
  // Drop clear "skip" tier when we have enough stronger ones.
  const chaseTier = ranked.filter((r) => r.score >= 1.2);
  const picked = (chaseTier.length >= 1 ? chaseTier : ranked).slice(0, limit);
  return picked.map(({ path, names, via, from }) => ({ path, names, via, from }));
}
