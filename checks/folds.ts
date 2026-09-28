/**
 * Diff-fold + intent-anchor + structure snap checks (no live API).
 * Run: npm run check:folds
 */
import { budgetDiffForAgent, foldUnifiedDiff } from "../server/diffFold.js";
import { extractAuthorIntents, matchIntentsToPath } from "../server/intentAnchors.js";
import { snapLookCloser } from "../server/structure.js";
import { blobContainsHit } from "../server/blobBatch.js";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,8 @@
+import { a } from "./a";
+import { b } from "./b";
+import { c } from "./c";
+import { d } from "./d";
+import { e } from "./e";
@@ -10,0 +16,20 @@
+export async function createSession(user: User) {
+  const id = newSessionId();
+  const token = signAccess(user.id, id);
+  const refresh = signRefresh(id);
+  await db.transaction(async (tx) => {
+    await tx.insert("sessions", {
+      id,
+      userId: user.id,
+      refreshHash: hash(refresh),
+      expiresAt: addDays(now(), 30),
+    });
+  });
+  if (!token) return null;
+  return { token, refresh };
+}
`;

const folds = foldUnifiedDiff(diff);
check(
  "folds import block",
  folds.some((f) => f.kind === "imports" && f.end - f.start + 1 >= 4),
  `kinds=${folds.map((f) => f.kind).join(",")}`,
);
check(
  "folds large added function as pseudocode",
  folds.some((f) => f.kind === "pseudocode" && (f.summary?.length ?? 0) > 0),
  `pseudo=${folds.find((f) => f.kind === "pseudocode")?.label}`,
);

const intents = extractAuthorIntents(`
## Summary
Please "use one transaction for history and resume state".

- treat Starling not-found as an empty follows list
- allow loopback overrides for local repro
`);
check(
  "extracts quoted author intent",
  intents.some((q) => /transaction/i.test(q)),
  `intents=${intents.join(" | ")}`,
);
check(
  "extracts bullet intents",
  intents.some((q) => /Starling not-found/i.test(q)),
);

const matched = matchIntentsToPath(
  ["treat Starling not-found as an empty follows list", "unrelated billing tax"],
  "apps/lantern/src/follows/follow-server.utils.ts",
  "valueFromSettledPromise treats StarlingNotFoundError as empty follows list",
);
check(
  "matches intent to path/card text",
  matched.length >= 1 && /Starling/i.test(matched[0]!.quote),
  `matched=${matched.map((m) => m.quote).join(" | ")}`,
);

const file = `export function valueFromSettledPromise() {
  return [];
}

export function getFollows() {
  return valueFromSettledPromise();
}
`;
const snapped = snapLookCloser(
  [
    {
      name: "valueFromSettledPromise",
      startLine: 1,
      endLine: 1,
      why: "the predicate",
    },
  ],
  file,
  "follow.ts",
);
check(
  "snaps thin Look closer onto enclosing function",
  snapped[0]!.endLine >= snapped[0]!.startLine && snapped[0]!.endLine > 1,
  `range=${snapped[0]!.startLine}-${snapped[0]!.endLine}`,
);

const wide = snapLookCloser(
  [
    {
      name: "alreadyWide",
      startLine: 1,
      endLine: 20,
      why: "deliberate region",
    },
  ],
  `${"x\n".repeat(30)}`,
  "follow.ts",
);
check(
  "leaves wide Look closer alone",
  wide[0]!.startLine === 1 && wide[0]!.endLine === 20,
);

check(
  "blobContainsHit tolerates whitespace",
  blobContainsHit("import { Foo } from './x';\n", "import { Foo } from './x'"),
);

const fat = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,8 @@
+import { a } from "./a";
+import { b } from "./b";
+import { c } from "./c";
+import { d } from "./d";
+import { e } from "./e";
@@ -10,0 +16,20 @@
+export async function createSession(user: User) {
+  const id = newSessionId();
+  const token = signAccess(user.id, id);
+  const refresh = signRefresh(id);
+  await db.transaction(async (tx) => {
+    await tx.insert("sessions", {
+      id,
+      userId: user.id,
+      refreshHash: hash(refresh),
+      expiresAt: addDays(now(), 30),
+    });
+  });
+  if (!token) return null;
+  return { token, refresh };
+}
`;
const padded = fat + "\n" + "+ // pad\n".repeat(400);
const budgeted = budgetDiffForAgent(padded, 800);
check(
  "budgetDiff folds before truncating",
  budgeted.mode === "folded" || budgeted.mode === "folded_truncated",
  `mode=${budgeted.mode} raw=${budgeted.rawChars} sent=${budgeted.sentChars}`,
);
check(
  "budgetDiff stays under maxChars",
  budgeted.sentChars <= 800 + 5,
  `sent=${budgeted.sentChars}`,
);
check(
  "budgetDiff keeps createSession signal",
  /createSession|pseudocode|transaction/i.test(budgeted.text),
);
check(
  "budgetDiff full when under budget",
  budgetDiffForAgent(fat, 50_000).mode === "full",
);

if (failed) throw new Error(`${failed} fold/intent check(s) failed`);
console.log("\nall fold/intent checks ok");
