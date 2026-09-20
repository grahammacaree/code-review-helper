import { choice } from "@typesafe-ai/sdk";
import type { FileCard, TeachbackKind, TeachbackResult } from "../types.js";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

/**
 * Grade a teach-back with TypeSafe Choice (+ speculative gap for stay messages).
 * Returns undefined when TypeSafe is off, uncertain, or unreachable — callers
 * fall back to the Cursor agent grader.
 */
export async function gradeTeachbackTypesafe(opts: {
  text: string;
  stage: "file" | "wrapup";
  card?: FileCard;
  prior?: { path: string; text: string }[];
}): Promise<TeachbackResult | undefined> {
  const state = {
    stage: opts.stage,
    path: opts.card?.path ?? null,
    card_what: opts.card?.what ?? null,
    card_why: opts.card?.why ?? null,
    card_role: opts.card?.roleInPr ?? null,
    behavior_pivots: (opts.card?.lookCloser ?? [])
      .filter((h) => /vs |instead of|wrong |must not|would /i.test(h.why))
      .map((h) => `${h.name}: ${h.why}`)
      .slice(0, 3),
    already_explained: (opts.prior ?? []).map((p) => ({
      path: p.path,
      text: p.text.slice(0, 300),
    })),
    reviewer_said: opts.text.slice(0, 2_000),
  };

  const result = await systemOne(state, {
    kind: choice(
      opts.stage === "file"
        ? {
            task: "Grade this PR-file teach-back.",
            pass_when:
              "They explained what this file does and why it changed, in their own words, well enough to tell a teammate. Credit earlier paraphrases — do not demand they repeat a contract already explained upstream. Concept framing on the card is optional teaching, not a pass requirement.",
            thin_when:
              "A high-level piece is missing (what, why, or a behavior pivot named on this file that they have not covered upstream). One gap is enough.",
            question_before_when:
              "They asked a question about the file without yet paraphrasing what it does and why.",
            question_after_when:
              "They already gave an adequate paraphrase and then asked a follow-up question.",
          }
        : {
            task: "Grade this final PR wrap-up summary.",
            pass_when:
              "A teammate could retell the PR from this summary plus what they already said on files. Need a named glue piece (shared gate/hook) and a user outcome somewhere in the walk — not necessarily restated if earlier wrap-up already had it.",
            thin_when:
              "Product-only with no glue named anywhere, or one high-level gap they never said.",
            question_before_when:
              "They asked a question without summarizing the PR.",
            question_after_when:
              "They already gave an adequate wrap-up and then asked a follow-up.",
          },
      {
        adequate:
          "Pass — explainable to a teammate; advance the walk.",
        thin: "Stay — one high-level piece is missing; do not advance.",
        question_before:
          "They asked before paraphrasing; answer later, do not count as teach-back.",
        question_after:
          "Adequate paraphrase then a question; credit the paraphrase.",
      },
    ),
    gap: choice(
      {
        task: "If the teach-back is thin, which single high-level piece is missing? Speculative — only used when kind is thin.",
        ignore_when_adequate:
          "If the paraphrase is adequate, pick none.",
      },
      {
        what: "What the file does / concrete change is missing or too vague.",
        why: "Why the file had to change / motivation is missing.",
        pivot:
          "A behavior pivot on this file (wrong alternative vs right signal) was never engaged.",
        glue: "Wrap-up: shared gate/hook or how pieces connect was never named in the walk.",
        none: "Nothing missing, or not a thin grade.",
      },
    ),
  });

  if (!result) return undefined;
  const kindAns = result.answers.kind;
  if (kindAns.confidence < ACT_CONFIDENCE) return undefined;

  const kind = kindAns.choice as TeachbackKind;
  const gap =
    kind === "thin" && result.answers.gap.confidence >= ACT_CONFIDENCE
      ? result.answers.gap.choice
      : "none";

  return {
    adequate: kind === "adequate" || kind === "question_after",
    kind,
    message: messageFor(kind, gap, opts.stage, opts.card?.path),
  };
}

function messageFor(
  kind: TeachbackKind,
  gap: string,
  stage: "file" | "wrapup",
  path?: string,
): string {
  const where = path ? ` for \`${path}\`` : "";
  if (kind === "adequate") {
    return stage === "wrapup"
      ? "That’s enough to retell the PR — wrap-up is solid."
      : `You’ve got the right shape${where}.`;
  }
  if (kind === "question_after") {
    return "Paraphrase credited. Ask mode will take the question next — or send another teach-back to advance.";
  }
  if (kind === "question_before") {
    return "Answer the question in Ask mode if you want — teach-back still needs what this does and why, in your own words.";
  }
  return thinMessage(gap, stage);
}

function thinMessage(gap: string, stage: "file" | "wrapup"): string {
  if (stage === "wrapup") {
    if (gap === "glue") {
      return "Stay on the wrap-up: name the shared gate or hook that ties the pieces together (or point at one you already named on a file).";
    }
    return "Stay on the wrap-up: one high-level beat is still missing for a teammate to retell the PR.";
  }
  switch (gap) {
    case "what":
      return "Stay on this file: say what it does (the concrete change), in your own words.";
    case "why":
      return "Stay on this file: say why it had to change — the motivation, not only what moved.";
    case "pivot":
      return "Stay on this file: engage the behavior pivot (the wrong alternative vs the signal this hunk chose).";
    default:
      return "Say what this file does and why it changed. next / ok / lgtm is not a teach-back.";
  }
}
