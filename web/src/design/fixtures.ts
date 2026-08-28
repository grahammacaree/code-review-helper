import type { FileTab } from "../components/FileInspect";
import type {
  Annotation,
  ChatMessage,
  FileCard,
  FileEntry,
  FileWiring,
  FnBlock,
  FunctionBrief,
  Overview,
  ProbeArgSuggestion,
  SessionSnapshot,
} from "../types";

/**
 * Fixture states for design mode. Hand-written to look like a real walk, so
 * layout, wrapping, and density can be judged without burning an agent run.
 * Never imported by the app itself.
 *
 * The repo is invented — `northwind/atlas`, a multi-network publishing monorepo
 * whose networks (`apps/atlas-network-*`) share `packages/atlas-framework`, with
 * a third-party reader-profile service called Starling. It is shaped like the
 * real thing (shared package plus two call sites, a fail-open bugfix, tests,
 * an asset) precisely so nothing here has to come from anyone's codebase, and
 * screenshots can be published freely.
 */
export interface Scenario {
  id: string;
  label: string;
  /** What this state is for, and what to look at. */
  note: string;
  session: SessionSnapshot | null;
  /** Open straight onto a pane, for reviewing Diff / Role / Wiring. */
  tab?: FileTab;
  /** Opens the sandbox modal over the walk. */
  fn?: FnBlock;
  /** Which sandbox pane to open on, for reviewing About without a live agent. */
  fnPane?: "source" | "about";
  busy?: boolean;
  error?: string;
}

const REPO = "/Users/graham/code/atlas";

const FILES: FileEntry[] = [
  {
    path: "apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts",
    kind: "modified",
    noise: false,
    asset: false,
  },
  {
    path: "packages/atlas-framework/src/starling/utils/api-url-override.ts",
    kind: "modified",
    noise: false,
    asset: false,
  },
  {
    path: "apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.test.ts",
    kind: "new",
    noise: false,
    asset: false,
  },
  {
    path: "packages/atlas-framework/src/starling/utils/request.test.ts",
    kind: "modified",
    noise: false,
    asset: false,
  },
  {
    path: "packages/atlas-framework/src/starling/index.ts",
    kind: "modified",
    noise: true,
    asset: false,
  },
  {
    path: "apps/atlas-network-lanternpost/public/og-follows.png",
    kind: "new",
    noise: false,
    asset: true,
  },
];

const QUEUE = FILES.filter((f) => !f.noise && !f.asset).map((f) => f.path);

const OVERVIEW: Overview = {
  branch: "fix/follows-starling-not-found",
  prUrl: "https://github.com/northwind/atlas/pull/482",
  whatsHappening:
    "A new user with no follows made Starling answer with a `StarlingNotFoundError`, and `getFollows` treated that as an upstream failure — so the whole follows surface 502'd instead of rendering an empty state. This PR treats not-found as an empty list, and separately relaxes the override-URL guard so the same code path can be exercised against a local Starling.",
  why: "Nobody who had never followed anything could follow anything: the read that powers the follow button failed before the write was ever offered. It shipped as a 502, so it read as an outage rather than a missing-record case.",
  dependencies:
    "`@northwind/atlas-framework` supplies the Starling client and the error classes. No new packages; the framework change is additive (a widened allowlist), so existing callers keep their behavior.",
  howItConnects:
    "`follow-server.utils.ts` is the fix. `api-url-override.ts` is what made the fix reproducible locally. The two test files lock each half: one proves not-found becomes `[]`, the other proves loopback overrides parse.",
  queue: QUEUE,
  repoNote:
    "Atlas is a multi-network monorepo: `packages/` is shared by every network, `apps/atlas-network-*` is one network. A change under `packages/` has blast radius past this PR's queue.",
  assetsNote:
    "`public/og-follows.png` is an asset — nothing to read line by line, so it is out of the walk.",
  noiseNote:
    "`starling/index.ts` is a re-export line for the new error class. Bookkeeping, so it is out of the queue.",
};

const FIX_CARD: FileCard = {
  path: "apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts",
  kind: "modified",
  focus: [{ start: 41, end: 58 }],
  diffUrl: "https://github.com/northwind/atlas/pull/482/files#diff-1",
  what: "`valueFromSettledPromise` now treats a rejected settled promise as an empty list when the rejection is a `StarlingNotFoundError`, alongside the HTTP 404 case it already tolerated. Everything else still propagates.",
  why: "This is the read behind the follow button. A user with no Starling record is a normal state, not a failure, and the old code could not tell the two apart — so a first-time follower got a 502.",
  roleInPr:
    "The behavioral core of the PR. Every other file either proves this change or made it possible to reproduce the bug locally; this is the only hunk that changes what a reader sees.",
  concept:
    "This sits on the **fail-open vs fail-closed** boundary for an upstream dependency. Atlas's rule of thumb is that a *missing record* is data and should degrade to an empty state, while a *broken dependency* must stay loud — because silently swallowing the second class turns an outage into a slow, invisible drop in engagement. The risk in widening a catch like this is always the same: the predicate is the safety mechanism, so `instanceof StarlingNotFoundError` is doing real work that a `catch {}` or a string match on the message would not. Watch what else can reach this branch — if Starling ever throws not-found for an auth failure, this line converts a security-relevant error into a cheerful empty list.",
  wiringNote:
    "Pulls `StarlingNotFoundError` from the framework's Starling module; exports `getFollows`, which the follows server components call.",
  links:
    "Covered: none yet. Upcoming: packages/atlas-framework/src/starling/utils/api-url-override.ts, apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.test.ts",
  lookCloser: [
    {
      name: "valueFromSettledPromise",
      startLine: 41,
      endLine: 58,
      why: "The whole PR is this predicate. Note that it widens the tolerated set rather than replacing the 404 check — both paths must stay.",
    },
    {
      name: "getFollows",
      startLine: 62,
      endLine: 79,
      why: "Calls the helper twice (follows and blocked) via `allSettled`; worth checking both call sites get the same treatment.",
    },
  ],
  map: "Request comes in → `getFollows` fires both Starling reads through `Promise.allSettled` → each result goes through `valueFromSettledPromise`, which is the only place a rejection is classified → callers get arrays and never see the error class.",
  couldHave: [
    "Classify once at the client boundary instead of at each consumer, so a second caller cannot forget the not-found case.",
    "Return a discriminated result (`{ status: 'empty' }` vs `{ status: 'error' }`) so the caller decides the UI rather than inferring it from an empty array.",
  ],
  uhOh: [
    {
      text: "An empty array now means both 'no follows' and 'Starling said not found'. If a later feature needs to distinguish them (say, to show onboarding), that information is already gone by the time it reaches the component.",
      startLine: 52,
      endLine: 55,
    },
  ],
  index: 1,
  total: 4,
};

const FIX_FILE_TEXT = `import { StarlingNotFoundError } from '@northwind/atlas-framework/starling';
import { getStarlingClient } from './client';
import type { FollowEntity, FollowsResponse } from '../types';

const EMPTY: FollowEntity[] = [];

function isNotFound(reason: unknown): boolean {
  if (reason instanceof StarlingNotFoundError) return true;
  return isHttpStatus(reason, 404);
}

function isHttpStatus(reason: unknown, status: number): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'status' in reason &&
    (reason as { status?: number }).status === status
  );
}

/**
 * A settled promise from Starling means one of three things: a value, a missing
 * record, or a genuine failure. Only the middle case degrades to an empty list.
 */
function valueFromSettledPromise<T>(
  settled: PromiseSettledResult<T[]>,
  label: string,
): T[] {
  if (settled.status === 'fulfilled') {
    return settled.value;
  }
  if (isNotFound(settled.reason)) {
    return EMPTY as T[];
  }
  throw new Error(\`Starling \${label} read failed\`, { cause: settled.reason });
}

export async function getFollows(userId: string): Promise<FollowsResponse> {
  const client = getStarlingClient();
  const [follows, blocked] = await Promise.allSettled([
    client.listFollows(userId),
    client.listBlocked(userId),
  ]);
  return {
    follows: valueFromSettledPromise(follows, 'follows'),
    blocked: valueFromSettledPromise(blocked, 'blocked'),
  };
}
`;

/**
 * One suggestion per function in FIX_FILE_TEXT, keyed by the line its header
 * sits on. Keyed rather than constant because the arguments box is only worth
 * reviewing when it holds a value that fits the signature it is sitting under.
 */
export const FIX_SAMPLES: Record<number, ProbeArgSuggestion> = {
  7: {
    args: [{ status: 404 }],
    note: "From the test that pins the 404 case.",
    kind: "test",
    source: "follow-server.utils.test.ts:14",
  },
  12: {
    args: [{ status: 404 }, 404],
    note: "Built from the parameter types; no test calls this directly.",
    kind: "shape",
  },
  25: {
    args: [{ status: "rejected", reason: { status: 404 } }, "follows"],
    note: "From the test that proves not-found becomes an empty list.",
    kind: "test",
    source: "follow-server.utils.test.ts:29",
  },
  38: {
    args: ["usr_8134"],
    note: "From the call site in the follows page.",
    kind: "callsite",
    source: "src/follows/page.tsx:22",
  },
};

const FIX_DIFF = `diff --git a/apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts b/apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts
index 8a1c2f4..3d9e77b 100644
--- a/apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts
+++ b/apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts
@@ -1,4 +1,5 @@
+import { StarlingNotFoundError } from '@northwind/atlas-framework/starling';
 import { getStarlingClient } from './client';
 import type { FollowEntity, FollowsResponse } from '../types';
 
@@ -6,8 +7,13 @@ const EMPTY: FollowEntity[] = [];
 
-function isNotFound(reason: unknown): boolean {
-  return isHttpStatus(reason, 404);
-}
+function isNotFound(reason: unknown): boolean {
+  if (reason instanceof StarlingNotFoundError) return true;
+  return isHttpStatus(reason, 404);
+}
`;

const FIX_WIRING: FileWiring = {
  imports: [
    {
      names: ["StarlingNotFoundError"],
      from: "@northwind/atlas-framework/starling",
      resolvedPath: "packages/atlas-framework/src/starling/index.ts",
      external: false,
      line: 1,
    },
    {
      names: ["getStarlingClient"],
      from: "./client",
      external: false,
      line: 2,
    },
  ],
  exports: [
    {
      name: "getFollows",
      kind: "function",
      line: 62,
      consumers: [
        "apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.test.ts",
      ],
    },
  ],
  note: "One import comes from the shared framework, so the error class is a cross-package contract.",
};

const OVERRIDE_CARD: FileCard = {
  path: "packages/atlas-framework/src/starling/utils/api-url-override.ts",
  kind: "modified",
  focus: [{ start: 18, end: 34 }],
  what: "The override-URL guard now accepts `http` when the host is a loopback address (`localhost`, `127.0.0.1`, `::1`), instead of requiring `https` for every override.",
  why: "The old guard rejected local overrides at parse time, so pointing a dev box at a local Starling failed before any request was made. That is why the not-found bug was hard to reproduce.",
  roleInPr:
    "Not the fix — the reason the fix could be verified. It is also the only file in this PR that lives in shared framework code.",
  concept:
    "This is a **shared-package contract** in a multi-network monorepo: `packages/atlas-framework` is consumed by every `apps/atlas-network-*`, so its blast radius is the whole estate rather than this PR's queue. The change is *additive* (it widens an allowlist), which is the cheap, reversible direction — no existing caller loses a behavior. The direction that would need a migration plan is narrowing: tightening this predicate later breaks callers you cannot see from here. Note the security shape too, since relaxing a scheme check is exactly where SSRF-flavored bugs live: the reason this is defensible is that the exemption is pinned to loopback hosts, not to a dev-mode flag someone could set in production.",
  wiringNote:
    "No imports from this PR's change set; exported helper is consumed by the Starling request builder, which every network uses.",
  links:
    "Covered: apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts. Upcoming: apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.test.ts, packages/atlas-framework/src/starling/utils/request.test.ts",
  lookCloser: [
    {
      name: "assertOverrideUrl",
      startLine: 18,
      endLine: 34,
      why: "The allowlist is both the feature and the guard. Check that the loopback exemption is keyed on hostname, not on a substring of the URL.",
    },
  ],
  couldHave: [
    "Gate the loopback exemption behind `NODE_ENV !== 'production'` as well as the host check, so it cannot be reached from a deployed box at all.",
  ],
  uhOh: [
    {
      text: "`::1` needs bracket handling in a URL (`http://[::1]:8080`). If the host check compares the raw authority rather than `url.hostname`, the bracketed form slips past.",
      startLine: 27,
      endLine: 31,
    },
  ],
  index: 2,
  total: 4,
  chase: false,
};

const NOTES: Annotation[] = [
  {
    id: "a1",
    kind: "comment",
    status: "open",
    path: FIX_CARD.path,
    startLine: 32,
    endLine: 34,
    selectedText: "  if (isNotFound(settled.reason)) {",
    body: "Worth a follow-up: an empty array collapses 'no record' and 'no follows'. Fine for this fix, but onboarding will want to tell them apart.",
    replies: [
      {
        id: "r1",
        role: "assistant",
        text: "Agreed, and that is the Could have on this card. If you want it in the GitHub review, it belongs as a non-blocking note rather than a change request.",
        at: Date.now() - 60_000,
      },
    ],
    at: Date.now() - 120_000,
  },
  {
    id: "a2",
    kind: "question",
    status: "resolved",
    path: FIX_CARD.path,
    startLine: 25,
    endLine: 28,
    selectedText: "function valueFromSettledPromise<T>(",
    body: "Does this helper get called anywhere outside getFollows?",
    replies: [
      {
        id: "r2",
        role: "assistant",
        text: "Not in this change set — the Wiring tab shows `getFollows` as the only export with consumers. It is module-private.",
        at: Date.now() - 300_000,
      },
    ],
    at: Date.now() - 360_000,
  },
];

let seq = 0;
function msg(m: Omit<ChatMessage, "id" | "at">): ChatMessage {
  seq += 1;
  return { ...m, id: `m${seq}`, at: Date.now() - (100 - seq) * 1000 };
}

const OVERVIEW_MSGS: ChatMessage[] = [
  msg({ role: "assistant", kind: "overview", text: "", overview: OVERVIEW }),
];

const FILE_MSGS: ChatMessage[] = [
  ...OVERVIEW_MSGS,
  msg({ role: "user", kind: "text", text: "Start file 1" }),
  msg({ role: "assistant", kind: "file", text: "", card: FIX_CARD }),
];

function base(over: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    id: "design",
    phase: "file",
    repoPath: REPO,
    homeBranch: "main",
    prRef: "482",
    prUrl: "https://github.com/northwind/atlas/pull/482",
    baseRef: "main",
    files: FILES,
    queue: QUEUE,
    covered: [],
    messages: [],
    annotations: [],
    busy: false,
    ...over,
  };
}

/** A brief as the agent would return it: prose over parsed facts. */
export const FIX_BRIEF: FunctionBrief = {
  id: `${FIX_CARD.path}:25`,
  name: "valueFromSettledPromise",
  what: "Takes one entry from a Promise.allSettled batch and flattens it to a value the caller can use. Fulfilled results hand back their value untouched; a rejection is inspected rather than rethrown, and a StarlingNotFoundError is treated as \u201cthis reader simply has no follows yet\u201d and answered with an empty array. Anything else still throws, so real outages stay loud.",
  why: "It is the seam that keeps one missing Starling record from failing the whole follows response. buildFollowsResponse fans out several Starling reads at once, and without this the first 404 for a brand-new reader collapsed every follow on the page. It exists so the batch can be partially empty without being broken.",
  concept: "Third-party read boundary. Every Starling call here is a network read you do not control, so the interesting question is which failures are data (\u201cnothing to show\u201d) and which are incidents (\u201cupstream is down\u201d). This function is where that line is drawn, and the cost of drawing it here is that a genuinely broken account looks identical to a new one \u2014 the empty array is indistinguishable from a real empty list downstream. The usual failure is widening the catch: swallow one more error type and an outage renders as a quiet, plausible-looking page of nothing.",
  conceptName: "Third-party read boundary",
  watch: "The empty-array branch only checks the error type, not which reader it was for, so a shared batch cannot tell you whose read failed.",
  facts: [
    "Signature: function valueFromSettledPromise<T>(",
    "Lines 25\u201336 of apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts (12 lines).",
    "Comment above it: Flattens one allSettled entry; a missing Starling record is an empty list, not a failure.",
    "Not exported: only this file can call it.",
    "Imports it uses: StarlingNotFoundError from @northwind/atlas-framework/starling.",
    "Called from: apps/atlas-network-lanternpost/src/follows/utils/follow-server.utils.ts:58, follow-server.utils.test.ts:29 (test) [changed in this PR].",
    "This PR changes lines inside this function.",
  ],
};

export const SCENARIOS: Scenario[] = [
  {
    id: "empty",
    label: "Empty / checkout",
    note: "First run. Repo bar expanded, transcript placeholder, no file pane. Check the form is the only thing asking for attention.",
    session: null,
  },
  {
    id: "no-key",
    label: "No API key",
    note: "Auth failure state in the repo bar. The error should read as setup instructions, not as a crash.",
    session: null,
  },
  {
    id: "dirty",
    label: "Blocked: dirty tree",
    note: "Gate before checkout. Chips offer stash or quit; the status text has to make the risk to their work obvious.",
    session: base({
      phase: "blocked_dirty",
      dirtyStatus: " M apps/atlas-network-lanternpost/src/follows/page.tsx\n?? scratch.ts",
      files: [],
      queue: [],
      messages: [
        msg({
          role: "assistant",
          kind: "dirty",
          text: "Your tree has uncommitted work:\n\n```\n M apps/atlas-network-lanternpost/src/follows/page.tsx\n?? scratch.ts\n```\n\nI can stash it and restore it when we finish, or you can quit and come back.",
        }),
      ],
    }),
  },
  {
    id: "large",
    label: "Blocked: large PR",
    note: "Fork in the road on a big diff. Two chips, and the numbers need to be scannable.",
    session: base({
      phase: "blocked_large",
      large: { files: 63, churn: "+4,812 / −1,190", excluded: "lockfiles and assets" },
      files: [],
      queue: [],
      messages: [
        msg({
          role: "assistant",
          kind: "large",
          text: "",
          large: {
            files: 63,
            churn: "+4,812 / −1,190",
            excluded: "lockfiles and assets",
          },
        }),
      ],
    }),
  },
  {
    id: "overview",
    label: "Overview + map",
    note: "The long bubble. Worst case for reading density: six headings, a queue, and two footnotes. Map pane is expanded because no file is open.",
    session: base({
      phase: "overview",
      overview: OVERVIEW,
      messages: OVERVIEW_MSGS,
    }),
  },
  {
    id: "file-file",
    label: "File card · File pane",
    note: "The main working state: card on the left, source with focus ranges, hotspot gutters, and one open comment thread anchored at L34.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
      annotations: [NOTES[0]],
      covered: [],
    }),
    tab: "file",
  },
  {
    id: "file-diff",
    label: "File card · Diff pane",
    note: "Diff tab. Check add/del colours, hunk headers, that the tab counter matches the hunks shown, and that the L34 thread is still reachable below the hunks.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
      annotations: [NOTES[0]],
    }),
    tab: "diff",
  },
  {
    id: "file-role",
    label: "File card · Role pane",
    note: "Role tab: PR motivation plus this file's job, and the Concept beat. Longest prose in the UI — check measure and heading rhythm.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
    }),
    tab: "role",
  },
  {
    id: "file-wiring",
    label: "File card · Wiring pane",
    note: "Wiring tab with a cross-package import and an export that has consumers. Chase button appears on outside callers.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      chaseCandidates: [
        {
          path: "apps/atlas-network-tidewater/src/follows/utils/follow-server.utils.ts",
          names: ["valueFromSettledPromise"],
        },
      ],
      messages: FILE_MSGS,
    }),
    tab: "wiring",
  },
  {
    id: "concept-shared",
    label: "Concept · shared package",
    note: "Second file, framework change. Concept beat is the deeper 'blast radius' framing — compare its length against the card above it.",
    session: base({
      overview: OVERVIEW,
      card: OVERRIDE_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      covered: [FIX_CARD.path],
      messages: [
        ...FILE_MSGS,
        msg({
          role: "user",
          kind: "text",
          text: "This changes a rejected Starling read from a failure into an empty list, so a user with no record renders instead of 502ing.",
        }),
        msg({
          role: "assistant",
          kind: "teachback",
          text: "That is the change. One thing to carry forward: the predicate is the safety mechanism here, so the interesting question on the next file is what else can reach that branch.",
        }),
        msg({ role: "assistant", kind: "file", text: "", card: OVERRIDE_CARD }),
      ],
    }),
    tab: "role",
  },
  {
    id: "teachback-thin",
    label: "Teach-back · thin",
    note: "Graded as thin, with a stay message. Should feel like a nudge, not a fail state.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      teachback: {
        adequate: false,
        kind: "thin",
        message:
          "That is the what, but not the why it was broken. What did Starling return for a user with no record, and why did the old code treat that as a failure?",
      },
      messages: [
        ...FILE_MSGS,
        msg({ role: "user", kind: "text", text: "It changes the error handling in the follows util." }),
        msg({
          role: "assistant",
          kind: "teachback",
          text: "That is the what, but not the why it was broken. What did Starling return for a user with no record, and why did the old code treat that as a failure?",
        }),
      ],
    }),
  },
  {
    id: "notes",
    label: "Inline threads + probe",
    note: "Threads anchored in the code: an open one expanded with a reply at L34, a resolved one collapsed at L28, plus a probe result below.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      annotations: NOTES,
      probe: {
        id: `${FIX_CARD.path}:7`,
        name: "isNotFound",
        path: FIX_CARD.path,
        startLine: 7,
        endLine: 10,
        exported: false,
        language: "ts",
        params: ["reason"],
        header: "function isNotFound(reason: unknown): boolean",
        args: [{ status: 404 }],
        result: "true",
        stdout: "",
      },
      messages: [
        ...FILE_MSGS,
        msg({
          role: "user",
          kind: "annotation",
          text: "Comment on L32–L34",
          annotationId: "a1",
        }),
        msg({
          role: "assistant",
          kind: "probe",
          text: "isNotFound({ status: 404 })\n→ true",
        }),
      ],
    }),
  },
  {
    id: "sandbox",
    label: "Function sandbox",
    note: "The sandbox modal: function on the left is editable, arguments and result on the right. Check it covers enough of the screen to actually work in, and that Run reads as the primary action.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
      probe: {
        id: `${FIX_CARD.path}:25`,
        name: "valueFromSettledPromise",
        path: FIX_CARD.path,
        startLine: 25,
        endLine: 36,
        exported: false,
        language: "ts",
        params: ["settled", "label"],
        header: "function valueFromSettledPromise<T>(",
        args: [{ status: "rejected", reason: { status: 404 } }, "follows"],
        result: "[]",
      },
    }),
    fn: {
      name: "valueFromSettledPromise",
      startLine: 25,
      endLine: 36,
      exported: false,
      language: "ts",
      params: ["settled", "label"],
      header: "function valueFromSettledPromise<T>(",
    },
  },
  {
    id: "sandbox-about",
    label: "Function sandbox \u00b7 About",
    note: "The About tab: what the function does, why it exists, the system it sits on, and the facts parsed from the checkout. Check the prose reads as explanation rather than a diff summary, and that the facts list stays subordinate to it.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
    }),
    fn: {
      name: "valueFromSettledPromise",
      startLine: 25,
      endLine: 36,
      exported: false,
      language: "ts",
      params: ["settled", "label"],
      header: "function valueFromSettledPromise<T>(",
    },
    fnPane: "about",
  },
  {
    id: "chase",
    label: "Chase card",
    note: "Unchanged file pulled in because it still calls a changed export. Card drops Links and Could have; heading says Chase.",
    session: base({
      overview: OVERVIEW,
      card: {
        ...FIX_CARD,
        path: "apps/atlas-network-tidewater/src/follows/utils/follow-server.utils.ts",
        kind: "modified",
        chase: true,
        chaseFrom: "packages/atlas-framework/src/starling/index.ts",
        chaseNames: ["StarlingNotFoundError"],
        concept: undefined,
        index: 3,
        total: 4,
      },
      fileText: FIX_FILE_TEXT,
      diffText: undefined,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
    }),
    tab: "file",
  },
  {
    id: "working",
    label: "Working / interrupt",
    note: "Agent mid-flight. Spinner in the repo bar, work label in the command box, Interrupt available, chips gone.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
      busy: true,
      workingOn: "Reading api-url-override.ts and its callers…",
    }),
    busy: true,
  },
  {
    id: "error",
    label: "Error banner",
    note: "Server-side failure surfaced mid-walk. Check it does not push the transcript around or hide the chips.",
    session: base({
      overview: OVERVIEW,
      card: FIX_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      messages: FILE_MSGS,
      error: "Worktree is no longer on the PR tip (expected 9f2c1ab). Re-checkout before continuing.",
    }),
    error: "Worktree is no longer on the PR tip (expected 9f2c1ab). Re-checkout before continuing.",
  },
  {
    id: "wrapup",
    label: "Wrap-up (browseable map)",
    note: "End of the walk. Last file stays open, and every covered file in the map is clickable — that is the browse affordance.",
    session: base({
      phase: "wrapup",
      overview: OVERVIEW,
      card: OVERRIDE_CARD,
      fileText: FIX_FILE_TEXT,
      diffText: FIX_DIFF,
      fileWiring: FIX_WIRING,
      covered: QUEUE,
      wrapup: {
        lingeringUhOhs:
          "Empty array now means both 'no follows' and 'not found' — fine here, a problem for onboarding.\n`::1` needs bracket handling; check the host comparison uses `url.hostname`.",
        designForks:
          "Classify not-found once at the client boundary instead of per consumer.\nGate the loopback exemption on environment as well as host.",
      },
      messages: [
        ...FILE_MSGS,
        msg({
          role: "assistant",
          kind: "wrapup",
          text: "",
          wrapup: {
            lingeringUhOhs:
              "Empty array now means both 'no follows' and 'not found' — fine here, a problem for onboarding.\n`::1` needs bracket handling; check the host comparison uses `url.hostname`.",
            designForks:
              "Classify not-found once at the client boundary instead of per consumer.\nGate the loopback exemption on environment as well as host.",
          },
        }),
      ],
    }),
    tab: "role",
  },
  {
    id: "done",
    label: "Done / restored",
    note: "After restore. Copy review notes is the remaining action; map is still browseable.",
    session: base({
      phase: "done",
      overview: OVERVIEW,
      card: OVERRIDE_CARD,
      fileText: FIX_FILE_TEXT,
      fileWiring: FIX_WIRING,
      covered: QUEUE,
      homeRestored: true,
      messages: [
        ...FILE_MSGS,
        msg({
          role: "assistant",
          kind: "status",
          text: "Restored `main`. Your stash is back on top. Notes for this walk are written to `data/commentary/`.",
        }),
      ],
    }),
    tab: "role",
  },
];

export const AUTH_OK = { hasKey: true, configured: true, models: ["composer-1"] };
export const AUTH_MISSING = { hasKey: false, configured: false };
