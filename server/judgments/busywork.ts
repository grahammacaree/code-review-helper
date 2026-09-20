import { noul, score } from "@typesafe-ai/sdk";
import { isTestPath } from "../paths.js";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

const CORE_LIMIT = 8;

/**
 * Re-rank a Core-only product spine by how load-bearing each path is for
 * retelling the PR. Falls back to the heuristic order when TypeSafe is off
 * or uncertain.
 */
export async function rankCoreSpine(opts: {
  orderedProduct: string[];
  prTitle?: string;
  prBody?: string;
  limit?: number;
}): Promise<string[] | undefined> {
  const limit = opts.limit ?? CORE_LIMIT;
  const candidates = opts.orderedProduct.slice(0, Math.max(limit * 2, 12));
  if (candidates.length <= 1) return undefined;

  const questions: Record<string, ReturnType<typeof score>> = {};
  for (const [i, path] of candidates.entries()) {
    questions[`f${i}`] = score(
      {
        task: "How load-bearing is this changed file for understanding the PR after merge?",
        path,
        prefer:
          "High for auth/routing/state contracts and the user-visible spine. Low for pure docs polish, style-only, or harness that only mirrors a product change.",
      },
      [
        "Optional / polish — skippable in a core walk",
        "Supporting context — useful but not the spine",
        "Load-bearing — needed to retell what happens after merge",
      ],
    );
  }

  const result = await systemOne(
    {
      pr_title: opts.prTitle?.slice(0, 300) ?? null,
      pr_body: opts.prBody?.slice(0, 1_500) ?? null,
      files: candidates,
    },
    questions,
  );
  if (!result) return undefined;

  const ranked = candidates
    .map((path, i) => {
      const ans = result.answers[`f${i}` as keyof typeof result.answers] as
        | { score: number; confidence: number }
        | undefined;
      return {
        path,
        score: ans?.score ?? 0,
        confidence: ans?.confidence ?? 0,
      };
    })
    .filter((r) => r.confidence >= ACT_CONFIDENCE * 0.8)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  if (ranked.length < Math.min(3, candidates.length)) return undefined;
  return ranked.slice(0, limit).map((r) => r.path);
}

/**
 * Among pending test/harness paths, which look like bookkeeping given what
 * the reviewer already covered? High noul → safe to skip with busywork.
 */
export async function filterBusyworkPaths(opts: {
  pending: string[];
  covered: string[];
  paraphrases: { path: string; text: string }[];
}): Promise<string[] | undefined> {
  const pending = opts.pending.filter(isTestPath).slice(0, 12);
  if (!pending.length) return undefined;

  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const [i, path] of pending.entries()) {
    questions[`t${i}`] = noul({
      task: "Is this pending file busywork relative to what was already explained?",
      path,
      yes_means:
        "Mostly string renames, assertion updates, or harness mirroring a product contract already covered — safe to skip without a per-file teach-back.",
      no_means:
        "It likely locks a distinct behavior, race, or routing contract not yet explained.",
    });
  }

  const result = await systemOne(
    {
      covered: opts.covered.slice(-12),
      already_explained: opts.paraphrases.slice(-5).map((p) => ({
        path: p.path,
        text: p.text.slice(0, 200),
      })),
      pending,
    },
    questions,
  );
  if (!result) return undefined;

  const keep: string[] = [];
  for (const [i, path] of pending.entries()) {
    const ans = result.answers[`t${i}` as keyof typeof result.answers] as
      | { noul: number }
      | undefined;
    // Noul is P(yes). Treat clear busywork as skippable.
    if (ans && ans.noul >= 0.65) keep.push(path);
  }
  return keep.length ? keep : undefined;
}
