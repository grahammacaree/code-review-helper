import { isTestPath } from "./paths.js";
import { scoreChangedFiles, RISK_PIN_SCORE } from "./risk.js";
import type {
  FileCard,
  FileEntry,
  TeachbackResult,
  Wrapup,
} from "./types.js";

export { isTestPath };

const CORE_LIMIT = 8;

const THIN_TEACHBACK =
  /^(next(?:\s+file)?|ok(?:ay)?|k|lgtm|continue|go|start|yep|yes|sure|done|👍|✅|👌|🔥|\.+|…|-)?$/iu;

export function orderQueue(files: FileEntry[]): string[] {
  return files
    .filter((f) => !f.noise && !f.asset)
    .sort(
      (a, b) =>
        queueRank(a.path) - queueRank(b.path) || a.path.localeCompare(b.path),
    )
    .map((f) => f.path);
}

export async function walkQueue(opts: {
  files: FileEntry[];
  mode: "all" | "core";
  repoPath: string;
  baseRef: string;
  signal?: AbortSignal;
  prTitle?: string;
  prBody?: string;
}): Promise<{
  queue: string[];
  batched: string[];
  riskPinned: string[];
}> {
  const ordered = orderQueue(opts.files);
  if (opts.mode !== "core" || ordered.length <= CORE_LIMIT) {
    return { queue: ordered, batched: [], riskPinned: [] };
  }

  // Product first: a polish PR often touches many harness files that sort
  // early (test-utils matches "util") and would eat the whole spine. Tests
  // stay reachable via Walk all or Skip-remaining-tests, not as Core only.
  const product = ordered.filter((p) => !isTestPath(p));
  const productPool = product.length ? product : ordered;
  let spine = productPool.slice(0, CORE_LIMIT);
  const { rankCoreSpine } = await import("./judgments/busywork.js");
  const ranked = await rankCoreSpine({
    orderedProduct: productPool,
    prTitle: opts.prTitle,
    prBody: opts.prBody,
    limit: CORE_LIMIT,
  });
  if (ranked?.length) spine = ranked;
  const hits = await scoreChangedFiles({
    repoPath: opts.repoPath,
    baseRef: opts.baseRef,
    files: opts.files,
    signal: opts.signal,
  });
  const riskPinned = hits
    .filter((h) => h.score >= RISK_PIN_SCORE && !spine.includes(h.path))
    .map((h) => h.path);

  const queue = [...spine, ...riskPinned];
  const queued = new Set(queue);
  const batched = ordered.filter((p) => !queued.has(p));
  return { queue, batched, riskPinned };
}

/**
 * The Core-only shortlist: product paths first, harness only when that is
 * all the PR has. Risk pins are appended later by walkQueue.
 */
export function coreSpine(
  ordered: string[],
  limit = CORE_LIMIT,
): string[] {
  const product = ordered.filter((p) => !isTestPath(p));
  return (product.length ? product : ordered).slice(0, limit);
}

export function assetsNote(files: FileEntry[]): string | undefined {
  const paths = files.filter((f) => f.asset).map((f) => f.path);
  if (!paths.length) return undefined;
  return `${paths.join(", ")} — skipped unless you ask.`;
}

export function noiseNote(
  files: FileEntry[],
  batched: string[],
  riskPinned: string[] = [],
): string | undefined {
  const bits: string[] = [];
  const noise = files.filter((f) => f.noise).map((f) => f.path);
  if (noise.length) bits.push(`noise: ${noise.join(", ")}`);
  if (riskPinned.length) {
    bits.push(
      `added to queue for risk signals: ${riskPinned.join(", ")}`,
    );
  }
  if (batched.length) bits.push(`batched (core only): ${batched.join(", ")}`);
  return bits.length ? bits.join(". ") : undefined;
}

export function fileLinks(covered: string[], upcoming: string[]): string {
  return `already covered: ${covered.join(", ") || "none"}; upcoming: ${upcoming.join(", ") || "none"}`;
}

export function wrapupFromCards(cards: FileCard[]): Wrapup {
  const uh = cards.flatMap((c) =>
    c.uhOh.filter((u) => u.text).map((u) => `${c.path}: ${u.text}`),
  );
  const forks = cards.flatMap((c) =>
    c.couldHave.filter(Boolean).map((f) => `${c.path}: ${f}`),
  );
  return {
    lingeringUhOhs: uh.length
      ? uh.join("\n")
      : "No lingering be careful notes from the file cards.",
    designForks: forks.length ? forks.join("\n") : undefined,
  };
}

export function localThinTeachback(text: string): TeachbackResult | null {
  const trimmed = text.trim();
  if (!trimmed || THIN_TEACHBACK.test(trimmed) || wordCount(trimmed) < 4) {
    return {
      adequate: false,
      kind: "thin",
      message:
        "Say what this file does and why it changed. next / ok / lgtm is not a teach-back.",
    };
  }
  return null;
}

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (/\?\s*$/.test(trimmed)) return true;
  return /^(do we|do you|does |is there|are there|can we|could we|should we|how do|how does|what if|where is|where's)\b/i.test(
    trimmed,
  );
}

export function pendingTestPaths(
  queue: string[],
  covered: string[],
): string[] {
  const done = new Set(covered);
  return queue.filter((p) => !done.has(p) && isTestPath(p));
}

export type SkipIntent = "this" | "busywork" | "rest";

export function skipIntent(
  text: string,
  ctx: { pendingTests: number },
): SkipIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (
    /^(skip(?: this(?: file)?)?|skip it|skip for now|i['’]?m stuck|stuck)\.?$/iu.test(
      trimmed,
    )
  ) {
    return "this";
  }
  if (
    /\b(string[- ]changes?|bookkeeping|low[- ]diff|busywork)\b/iu.test(trimmed) ||
    /\bskip(?:ping)?\s+(?:the\s+)?(?:remaining\s+|rest\s+of\s+(?:the\s+|these\s+)?)?tests?\b/iu.test(
      trimmed,
    ) ||
    /\bskip(?:ping)?\s+files\b/iu.test(trimmed) ||
    /\bwe can skip (?:files|those|the tests)\b/iu.test(trimmed)
  ) {
    return "busywork";
  }
  if (
    /\bskip(?:ping)?\s+(?:ahead(?:\s+to\s+wrap-?up)?|the\s+rest\s+of\s+(?:the\s+)?(?:walk|pr|queue)|remaining files)\b/iu.test(
      trimmed,
    )
  ) {
    return "rest";
  }
  if (
    /^(skip(?:ping)?\s+(?:the\s+)?(?:rest|remaining)(?:\s+files?)?)\.?$/iu.test(
      trimmed,
    )
  ) {
    return ctx.pendingTests > 0 ? "busywork" : "rest";
  }
  return null;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function queueRank(path: string): number {
  const p = path.toLowerCase();
  if (isTestPath(path)) {
    return 80;
  }
  if (/\.mdx?$/.test(p)) return 70;
  if (/\.(css|scss|sass|less)$/.test(p)) return 55;
  if (
    /(^|\/)(types?|schema|interfaces?)\//.test(p) ||
    /\.d\.ts$/.test(p) ||
    /types?\.(ts|tsx|js)$/.test(p)
  ) {
    return 10;
  }
  if (/config|constants|enum/.test(p)) return 15;
  if (/hook|util|helper|lib\//.test(p)) return 25;
  return 30 + p.split("/").length;
}
