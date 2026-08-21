import { scoreChangedFiles, RISK_PIN_SCORE } from "./risk.js";
import type {
  FileCard,
  FileEntry,
  TeachbackResult,
  Wrapup,
} from "./types.js";

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
}): Promise<{
  queue: string[];
  batched: string[];
  riskPinned: string[];
}> {
  const ordered = orderQueue(opts.files);
  if (opts.mode !== "core" || ordered.length <= CORE_LIMIT) {
    return { queue: ordered, batched: [], riskPinned: [] };
  }

  const spine = ordered.slice(0, CORE_LIMIT);
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
      : "No lingering uh-ohs from the file cards.",
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

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function queueRank(path: string): number {
  const p = path.toLowerCase();
  if (/\.(test|spec)\./.test(p) || /(^|\/)(__tests__|tests?|spec)\//.test(p)) {
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
