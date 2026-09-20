/**
 * Smoke the three TypeSafe doors against a live key in .env.
 * Does not print the key or full reviewer state.
 *
 * Run: npx tsx checks/typesafe-smoke.ts
 */
import { gradeTeachbackTypesafe } from "../server/judgments/teachback.js";
import { classifyCommandIntent } from "../server/judgments/intent.js";
import { rankCoreSpine, filterBusyworkPaths } from "../server/judgments/busywork.js";
import { rankChaseCandidates } from "../server/judgments/chase.js";
import { verifyCardClaims } from "../server/judgments/verify.js";
import { pickPrimaryConcept } from "../server/judgments/concept.js";
import { hasTypesafe } from "../server/typesafe.js";
import type { FileCard } from "../server/types.js";
import type { ConceptForCard } from "../server/conceptMemory.js";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  check("TYPESAFE_API_KEY is set", hasTypesafe());
  if (!hasTypesafe()) {
    throw new Error("Set TYPESAFE_API_KEY in .env before running this smoke.");
  }

  const adequate = await gradeTeachbackTypesafe({
    text: "This helper threads isNewUser through the fixed auth snapshot so onboarding route tests can assert returning skip vs interests push without real Duet — default stays null, not false.",
    stage: "file",
    card: {
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
    },
  });
  check(
    "teach-back grades a solid paraphrase",
    Boolean(adequate && adequate.adequate),
    adequate ? `kind=${adequate.kind} msg=${adequate.message.slice(0, 60)}` : "no result",
  );

  const thin = await gradeTeachbackTypesafe({
    text: "AuthContext now exposes isNewUser. The sticky setter keeps the first resolved value so a later refresh cannot downgrade a new account to returning and skip interests. Sign-out clears it.",
    stage: "file",
    card: {
      path: "src/app/_layout.tsx",
      kind: "modified",
      focus: [],
      what: "Sequences native splash then AnimatedSplashOverlay before releasing root navigation.",
      why: "Branded cold open without flashing main UI under the logo draw.",
      lookCloser: [
        {
          name: "isAnimatedSplashDone",
          startLine: 75,
          endLine: 82,
          why: "vs dropping the hold while the overlay still mounts — main UI would flash underneath",
        },
      ],
      couldHave: [],
      uhOh: [],
      index: 4,
      total: 9,
      links: "",
    },
  });
  check(
    "teach-back does not pass a paraphrase about the wrong file",
    Boolean(!thin || thin.kind === "thin"),
    thin ? `kind=${thin.kind}` : "undefined (escalate to Cursor — ok)",
  );

  const intent = await classifyCommandIntent({
    text: "we can skip the remaining string-change tests",
    phase: "file",
    pendingTests: 4,
    askMode: false,
  });
  check(
    "intent routes skip-busywork phrasing",
    intent === "busywork",
    `got=${intent}`,
  );

  const ranked = await rankCoreSpine({
    orderedProduct: [
      "docs/readme.md",
      "src/identity/AuthContext.tsx",
      "src/app/(onboarding)/index.tsx",
      "src/components/brand/VergeLogo.tsx",
      "src/onboarding/storage.ts",
    ],
    prTitle: "Onboarding polish: returning skip + branded splash",
    prBody: "Returning users skip interests; new users still see follows. Branded splash and AuthPanel slides.",
    limit: 3,
  });
  check(
    "core rank prefers auth/routing over logo/docs",
    Boolean(
      ranked &&
        ranked.includes("src/identity/AuthContext.tsx") &&
        ranked[0] !== "docs/readme.md",
    ),
    `ranked=${ranked?.join(", ")}`,
  );

  const busy = await filterBusyworkPaths({
    pending: [
      "src/app/__tests__/string-rename.test.tsx",
      "src/identity/__tests__/AuthContext.race.test.tsx",
    ],
    covered: ["src/identity/AuthContext.tsx"],
    paraphrases: [
      {
        path: "src/identity/AuthContext.tsx",
        text: "Sticky isNewUser from exchange with epoch guard; reset on sign-out.",
      },
    ],
  });
  check(
    "busywork filter returns a list or undefined (live judgment)",
    busy === undefined || Array.isArray(busy),
    `busy=${busy?.join(", ") ?? "undefined"}`,
  );

  const chased = await rankChaseCandidates({
    targetPath: "src/identity/AuthContext.tsx",
    exportNames: ["AuthProvider", "AuthContext"],
    contractHint:
      "isNewUser is now sticky after first Duet exchange; late refresh must not flip new→returning.",
    candidates: [
      { path: "src/app/(onboarding)/index.tsx", names: ["AuthContext"] },
      { path: "src/components/account/DuetSessionPendingAccount.tsx", names: ["AuthContext"] },
      { path: "src/types/reexport.ts", names: ["AuthContext"] },
      { path: "documentation/docs/modules/auth.md", names: ["AuthContext"] },
      { path: "src/page-utils/account/queries.ts", names: ["AuthProvider"] },
    ],
    limit: 2,
  });
  check(
    "chase rank prefers real callers over docs/reexport",
    Boolean(
      chased &&
        chased.some((c) => c.path.includes("onboarding")) &&
        !chased.some((c) => c.path.includes("documentation")),
    ),
    `chased=${chased?.map((c) => c.path).join(", ")}`,
  );

  const bogusCard: FileCard = {
    path: "src/identity/AuthContext.tsx",
    kind: "modified",
    focus: [{ start: 170, end: 190 }],
    what: "Sticky isNewUser after exchange.",
    why: "Returning skip must not lose new-user interests.",
    lookCloser: [
      {
        name: "setIsNewUser",
        startLine: 176,
        endLine: 183,
        why: "vs overwriting every exchange — a late refresh would skip interests for a new account",
      },
      {
        name: "phantom",
        startLine: 1,
        endLine: 2,
        why: "Deletes the user's Firebase account on every token refresh",
      },
    ],
    couldHave: [],
    uhOh: [
      {
        text: "Dropping the epoch guard lets a stale false poison the next sign-in.",
        startLine: 166,
        endLine: 174,
      },
    ],
    index: 1,
    total: 1,
    links: "",
  };
  const evidence = `
@@ -166,20 +166,30 @@
+  if (!isAuthOperationCurrent(epoch)) return;
+  setIsNewUser((previous) => (previous === null ? resolved : previous));
+  // sticky first resolution; later refresh without signal must not flip
`;
  const verified = await verifyCardClaims({ card: bogusCard, evidence });
  check(
    "claim verify drops unsupported Look closer when confident",
    Boolean(
      verified &&
        verified.lookCloser.some((h) => h.name === "setIsNewUser") &&
        !verified.lookCloser.some((h) => h.name === "phantom"),
    ),
    verified
      ? `look=${verified.lookCloser.map((h) => h.name).join(",")}`
      : "no trim (kept all — ok if uncertain)",
  );

  const concepts: ConceptForCard[] = [
    {
      id: "query-cache",
      name: "Client query cache",
      teach: "Reads are cached per query key…",
      evidence: "package.json",
      depth: "build",
      seenIn: [],
    },
    {
      id: "offline-storage",
      name: "Offline / device storage",
      teach: "AsyncStorage flags survive process restart…",
      evidence: "async-storage",
      depth: "scaffold",
      seenIn: [],
    },
  ];
  const primary = await pickPrimaryConcept({
    path: "src/onboarding/storage.ts",
    concepts,
    what: "Adds interests-pending AsyncStorage key.",
    why: "New-user interests must survive kill mid-onboarding.",
    evidence: "+ ONBOARDING_INTERESTS_PENDING_KEY\n+ await AsyncStorage.setItem",
  });
  check(
    "concept pick prefers offline storage for AsyncStorage hunk",
    Boolean(primary && primary[0]?.id === "offline-storage"),
    `primary=${primary?.[0]?.id ?? "undefined"}`,
  );

  if (failed) throw new Error(`${failed} typesafe smoke check(s) failed`);
  console.log("\nall typesafe smoke checks ok");
}

main();
