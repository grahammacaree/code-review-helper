import { choice } from "@typesafe-ai/sdk";
import type { SkipIntent } from "../scaffold.js";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

export type CommandIntent =
  | SkipIntent
  | "teachback"
  | "question"
  | "unknown";

/**
 * Classify what the reviewer meant when regex gates are inconclusive.
 * Low confidence or no key → undefined (caller keeps existing heuristics).
 */
export async function classifyCommandIntent(opts: {
  text: string;
  phase: "file" | "wrapup";
  pendingTests: number;
  askMode: boolean;
}): Promise<CommandIntent | undefined> {
  if (opts.askMode) return "question";

  const result = await systemOne(
    {
      phase: opts.phase,
      pending_test_files: opts.pendingTests,
      reviewer_said: opts.text.slice(0, 1_000),
    },
    {
      intent: choice(
        {
          task: "What should the walkthrough host do with this message?",
          context:
            "Teach-back mode expects a paraphrase of the current file (or wrap-up). Skip intents remove files without grading. A question should be answered, not graded as teach-back.",
        },
        {
          teachback:
            "They are explaining the file or PR in their own words (even if imperfect).",
          question:
            "They are asking a question about the code or PR, not paraphrasing yet.",
          this: "Skip only the current file and move on.",
          busywork:
            "Skip remaining low-value / string-change / bookkeeping test files (or similar busywork), not the whole walk.",
          rest: "Skip the rest of the walk / remaining files and go to wrap-up.",
          unknown: "None of the above, or too ambiguous to act.",
        },
      ),
    },
  );

  if (!result) return undefined;
  const ans = result.answers.intent;
  if (ans.confidence < ACT_CONFIDENCE) return undefined;
  if (ans.choice === "unknown") return undefined;
  if (ans.choice === "teachback") return "teachback";
  if (ans.choice === "question") return "question";
  if (ans.choice === "this") return "this";
  if (ans.choice === "busywork") return "busywork";
  if (ans.choice === "rest") return "rest";
  return undefined;
}
