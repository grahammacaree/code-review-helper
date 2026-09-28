/**
 * One-shot efficiency measure for TypeSafe (Jev) judgments.
 * Prints JSON lines; does not log secrets or full reviewer state.
 *
 * Run: npx tsx checks/jev-efficiency.ts
 */
import { readFileSync } from "node:fs";
import { gradeTeachbackTypesafe } from "../server/judgments/teachback.js";
import { classifyCommandIntent } from "../server/judgments/intent.js";
import { rankCoreSpine, filterBusyworkPaths } from "../server/judgments/busywork.js";
import { rankChaseCandidates } from "../server/judgments/chase.js";
import { verifyCardClaims } from "../server/judgments/verify.js";
import { pickPrimaryConcept } from "../server/judgments/concept.js";
import { bindOutsideImports } from "../server/judgments/bind.js";
import type { FileCard } from "../server/types.js";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) {
    process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function cursorTeachbackPromptChars(opts: {
  text: string;
  stage: "file" | "wrapup";
  card?: FileCard;
  prior?: { path: string; text: string }[];
}): number {
  const hotspot = (opts.card?.lookCloser ?? []).map((h) => h.name).join(", ");
  const pivotEntries = (opts.card?.lookCloser ?? []).filter((h) =>
    /vs |instead of|wrong |must not|would /i.test(h.why),
  );
  const pivotHint = pivotEntries.map((h) => `${h.name}: ${h.why}`).join("; ");
  const prior =
    opts.prior?.length
      ? opts.prior.map((p) => `- ${p.path}: ${p.text}`).join("\n")
      : "";
  return [
    [
      `Grade this teach-back for ${opts.card?.path}.`,
      "Pass if they explained what this file does and why it changed, in their own words, well enough to tell a teammate.",
      "Credit the walk so far. If they already explained a contract (boolean polarity, flag meaning, return shape) on an earlier file, do not fail this file for not repeating it. Tests, callers, and wiring of that helper: pass when they say what this file locks in and why it exists relative to that contract.",
      "Scale to file role: styles/barrels = intent, not every key. Tests = what they guard and why, not Redis/TTL/off-by-one internals unless this file's Look closer named that as a behavior pivot. If the hunk is only a renamed expectation string they already explained on config/bootstrap, pass a one-liner — do not stay for a distinct contract. If they asked to skip remaining string-only / same-rename tests, that is a skip, not thin.",
      "Shared gates/screens: what + why (+ roughly who consumes / which signal) is enough.",
      "Stay messages: one missing high-level piece. Do not dump a checklist of five omissions.",
      "The card's Concept beat is teaching, not a requirement: never grade thin for skipping the system framing, and never quiz cache keys, TTLs, or migration order they were told rather than asked. If they do engage the concept, credit it as a plus and build on it in one sentence.",
      pivotHint
        ? `Behavior pivot Look closer on THIS file — ${pivotHint}. If their paraphrase never engages that semantic choice (or the wrong alternative), and they have not already explained it upstream, grade thin.`
        : "Do not fail them for skipping Look closer names when the overall explanation is solid.",
      hotspot && !pivotHint
        ? `Mentioning ${hotspot} is a plus, not a gate.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    "Call grade_teachback once. adequate = could explain to a teammate. thin = stay. question_before = asked before paraphrasing. question_after = paraphrased then asked.",
    opts.card
      ? `Card what: ${opts.card.what}\nCard why: ${opts.card.why}`
      : "",
    prior
      ? `They already explained these earlier in the walk (credit; do not re-quiz). (wrap-up) lines are previous summary tries:\n${prior}`
      : "",
    "Reviewer said:",
    opts.text,
  ]
    .filter(Boolean)
    .join("\n\n").length;
}

async function timed(
  door: string,
  fn: () => Promise<unknown>,
): Promise<number> {
  const t0 = performance.now();
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    ok = r !== undefined && r !== null;
    if (Array.isArray(r)) detail = `n=${r.length}`;
    else if (r && typeof r === "object" && "kind" in r) {
      detail = `kind=${(r as { kind: string }).kind}`;
    } else if (typeof r === "string") detail = r;
    else detail = ok ? "hit" : "undefined";
  } catch (e) {
    detail = e instanceof Error ? e.message.slice(0, 100) : String(e);
  }
  const ms = Math.round(performance.now() - t0);
  console.log(JSON.stringify({ timing: { door, ms, ok, detail } }));
  return ms;
}

async function main() {
  const card: FileCard = {
    path: "src/test-utils/renderWithAuth.tsx",
    kind: "modified",
    focus: [],
    what: "Adds optional isNewUser to the fixed auth stub.",
    why: "Route tests need the same post-auth signal as AuthContext.",
    lookCloser: [],
    couldHave: [],
    uhOh: [],
    index: 1,
    total: 9,
    links: "",
  };
  const text =
    "This helper threads isNewUser through the fixed auth snapshot so onboarding route tests can assert returning skip vs interests push without real Duet — default stays null, not false.";
  const prior = [
    {
      path: "src/identity/AuthContext.tsx",
      text: "Sticky isNewUser from exchange with epoch guard; reset on sign-out. Keeps first resolved value.",
    },
    {
      path: "src/app/_layout.tsx",
      text: "Splash then overlay before releasing navigation.",
    },
    {
      path: "src/onboarding/storage.ts",
      text: "AsyncStorage interests-pending key.",
    },
    {
      path: "src/identity/AuthPanel.tsx",
      text: "Slides for new vs returning.",
    },
    {
      path: "src/app/(onboarding)/index.tsx",
      text: "Routes on sticky flag.",
    },
  ];

  const state = {
    stage: "file",
    path: card.path,
    card_what: card.what,
    card_why: card.why,
    card_role: null,
    behavior_pivots: [] as string[],
    already_explained: prior.map((p) => ({
      path: p.path,
      text: p.text.slice(0, 300),
    })),
    reviewer_said: text.slice(0, 2_000),
  };
  const { choice } = await import("@typesafe-ai/sdk");
  const questions = {
    kind: choice(
      {
        task: "Grade this PR-file teach-back.",
        pass_when:
          "They explained what this file does and why it changed, in their own words, well enough to tell a teammate. Credit earlier paraphrases — do not demand they repeat a contract already explained upstream. Concept framing on the card is optional teaching, not a pass requirement.",
        thin_when:
          "A high-level piece is missing (what, why, or a behavior pivot named on this file that they have not covered upstream). One gap is enough.",
        question_before_when:
          "They asked a question about the file without yet paraphrasing what it does and why.",
        question_after_when:
          "They already gave an adequate paraphrase and then asked a follow-up question.",
      },
      {
        adequate: "Pass — explainable to a teammate; advance the walk.",
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
        ignore_when_adequate: "If the paraphrase is adequate, pick none.",
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
  };

  const cursorChars = cursorTeachbackPromptChars({
    text,
    stage: "file",
    card,
    prior,
  });
  const jevStateChars = JSON.stringify(state).length;
  const jevQuestionsChars = JSON.stringify(questions).length;
  const jevTotal = jevStateChars + jevQuestionsChars;

  console.log(
    JSON.stringify({
      measured: "payload_chars",
      teachback: {
        cursorPromptChars: cursorChars,
        cursorApproxTokens: Math.round(cursorChars / 4),
        jevStateChars,
        jevQuestionsJsonChars: jevQuestionsChars,
        jevTotalChars: jevTotal,
        jevApproxTokens: Math.round(jevTotal / 4),
        inputCharRatio_cursor_over_jev: +(cursorChars / jevTotal).toFixed(2),
      },
      note: "Cursor path also carries agent conversation history + tool schema; cursorPromptChars underestimates Cursor cost.",
    }),
  );

  const msList: number[] = [];
  msList.push(
    await timed("teachback", () =>
      gradeTeachbackTypesafe({ text, stage: "file", card, prior }),
    ),
  );
  msList.push(
    await timed("intent", () =>
      classifyCommandIntent({
        text: "we can skip the remaining string-change tests",
        phase: "file",
        pendingTests: 4,
        askMode: false,
      }),
    ),
  );
  msList.push(
    await timed("core", () =>
      rankCoreSpine({
        orderedProduct: [
          "docs/readme.md",
          "src/identity/AuthContext.tsx",
          "src/app/(onboarding)/index.tsx",
          "src/components/brand/VergeLogo.tsx",
          "src/onboarding/storage.ts",
        ],
        prTitle: "Onboarding polish",
        prBody: "Returning users skip interests.",
        limit: 3,
      }),
    ),
  );
  msList.push(
    await timed("busywork", () =>
      filterBusyworkPaths({
        pending: [
          "src/app/__tests__/string-rename.test.tsx",
          "src/identity/__tests__/AuthContext.race.test.tsx",
        ],
        covered: ["src/identity/AuthContext.tsx"],
        paraphrases: [
          { path: "src/identity/AuthContext.tsx", text: "Sticky isNewUser." },
        ],
      }),
    ),
  );
  msList.push(
    await timed("chase", () =>
      rankChaseCandidates({
        targetPath: "src/identity/AuthContext.tsx",
        exportNames: ["AuthProvider", "AuthContext"],
        contractHint: "sticky isNewUser",
        candidates: [
          { path: "src/app/(onboarding)/index.tsx", names: ["AuthContext"] },
          {
            path: "src/components/account/DuetSessionPendingAccount.tsx",
            names: ["AuthContext"],
          },
          { path: "src/types/reexport.ts", names: ["AuthContext"] },
          {
            path: "documentation/docs/modules/auth.md",
            names: ["AuthContext"],
          },
          {
            path: "src/page-utils/account/queries.ts",
            names: ["AuthProvider"],
          },
        ],
        limit: 2,
      }),
    ),
  );
  msList.push(
    await timed("bind", () =>
      bindOutsideImports({
        targetPath: "src/identity/AuthContext.tsx",
        exportNames: ["AuthProvider", "AuthContext"],
        ambiguous: [
          {
            path: "src/app/onboarding.tsx",
            from: "@/identity/AuthContext",
            names: ["AuthContext"],
          },
          {
            path: "src/app/other.tsx",
            from: "@/identity/Other",
            names: ["AuthContext"],
          },
        ],
      }),
    ),
  );
  msList.push(
    await timed("verify", () =>
      verifyCardClaims({
        card: {
          ...card,
          path: "src/identity/AuthContext.tsx",
          lookCloser: [
            {
              name: "setIsNewUser",
              startLine: 176,
              endLine: 183,
              why: "vs overwriting every exchange",
            },
            {
              name: "phantom",
              startLine: 1,
              endLine: 2,
              why: "Deletes Firebase on refresh",
            },
          ],
          uhOh: [
            {
              text: "Dropping epoch guard",
              startLine: 166,
              endLine: 174,
            },
          ],
        },
        evidence:
          "+ setIsNewUser((previous) => (previous === null ? resolved : previous));",
      }),
    ),
  );
  msList.push(
    await timed("concept", () =>
      pickPrimaryConcept({
        path: "src/onboarding/storage.ts",
        concepts: [
          {
            id: "query-cache",
            name: "Client query cache",
            teach: "Reads cached per key",
            evidence: "package.json",
            depth: "build",
            seenIn: [],
          },
          {
            id: "offline-storage",
            name: "Offline / device storage",
            teach: "AsyncStorage survives restart",
            evidence: "async-storage",
            depth: "scaffold",
            seenIn: [],
          },
        ],
        what: "Adds interests-pending AsyncStorage key.",
        why: "Survive kill mid-onboarding.",
        evidence: "+ await AsyncStorage.setItem",
      }),
    ),
  );

  const sorted = [...msList].sort((a, b) => a - b);
  const mean = Math.round(msList.reduce((a, b) => a + b, 0) / msList.length);
  console.log(
    JSON.stringify({
      measured: "latency_ms_live_jev",
      n: msList.length,
      min: sorted[0],
      p50: sorted[Math.floor(sorted.length / 2)],
      mean,
      max: sorted[sorted.length - 1],
      sum: msList.reduce((a, b) => a + b, 0),
    }),
  );

  // Inferred walk scale — counts from host call sites, not production logs.
  const teachbacks = 10;
  const intents = 3;
  const chase = 4;
  const binds = 2;
  const verify = 10;
  const concept = 3;
  const core = 1;
  const busy = 1;
  const jevCalls =
    teachbacks + intents + chase + binds + verify + concept + core + busy;
  console.log(
    JSON.stringify({
      inferred: "ten_file_core_walk",
      jevCallsIfAllHit: jevCalls,
      jevWallSecIfSerialAtMean: +((jevCalls * mean) / 1000).toFixed(1),
      cursorTeachbackTurnsAvoidedIfConfident: teachbacks,
      otherDoorsMostlyReplaced: "heuristics or new capability — not 1:1 Cursor savings",
    }),
  );
}

main();
