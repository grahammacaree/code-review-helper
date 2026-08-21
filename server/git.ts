import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { FileEntry, FileKind } from "./types.js";

const execFileAsync = promisify(execFile);

const ASSET_RE =
  /\.(svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|eot)$/i;
const NOISE_PATH_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun.lockb|Cargo.lock|go\.sum|poetry.lock|composer.lock)$|(^|\/)(dist|build|coverage|\.next|generated)\/|\.(min|bundle)\.(js|css)$|\.snap$/i;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

async function run(
  cwd: string,
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      signal,
    });
    return stdout;
  } catch (err) {
    const e = err as {
      stderr?: string;
      message?: string;
      code?: string | number;
      killed?: boolean;
    };
    if (e.code === "ABORT_ERR" || signal?.aborted) {
      throw new GitError("Interrupted.");
    }
    if (e.killed || e.code === "ETIMEDOUT") {
      throw new GitError(`${command} timed out after 120s.`);
    }
    throw new GitError(
      (e.stderr || e.message || `${command} failed`).trim(),
    );
  }
}

export async function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return run(cwd, "git", args, signal);
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ["branch", "--show-current"])).trim();
}

export async function porcelainStatus(cwd: string): Promise<string> {
  return (await git(cwd, ["status", "--porcelain"])).trim();
}

export function parsePrRef(input: string): {
  number?: string;
  url?: string;
} {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i,
  );
  if (urlMatch) {
    return { number: urlMatch[1], url: trimmed.split("#")[0] };
  }
  if (/^\d+$/.test(trimmed)) {
    return { number: trimmed };
  }
  return {};
}

export async function checkoutPr(
  cwd: string,
  prNumber: string,
  signal?: AbortSignal,
): Promise<{
  prUrl?: string;
  baseRef: string;
  headOid: string;
  title?: string;
  body?: string;
}> {
  let prUrl: string | undefined;
  let baseRef = "main";
  let headOid = "";
  let title: string | undefined;
  let body: string | undefined;

  try {
    const json = await run(cwd, "gh", [
      "pr",
      "view",
      prNumber,
      "--json",
      "url,baseRefName,headRefOid,number,title,body",
    ], signal);
    const meta = JSON.parse(json) as {
      url?: string;
      baseRefName?: string;
      headRefOid?: string;
      title?: string;
      body?: string;
    };
    prUrl = meta.url;
    if (meta.baseRefName) baseRef = meta.baseRefName;
    if (meta.headRefOid) headOid = meta.headRefOid;
    title = meta.title;
    body = meta.body;
  } catch {
    // gh optional; fall back to refs/pull
  }

  try {
    await run(cwd, "gh", ["pr", "checkout", prNumber], signal);
  } catch {
    await git(cwd, ["fetch", "origin", `pull/${prNumber}/head`], signal);
    await git(cwd, ["checkout", "-B", `pr-${prNumber}`, "FETCH_HEAD"], signal);
  }

  if (!headOid) {
    headOid = (await git(cwd, ["rev-parse", "HEAD"], signal)).trim();
  }

  try {
    await git(cwd, ["fetch", "origin", baseRef], signal);
  } catch {
    await git(cwd, ["fetch", "origin", `pull/${prNumber}/merge`], signal);
    const merge = (await git(cwd, ["rev-parse", "FETCH_HEAD"], signal)).trim();
    const firstParent = (
      await git(cwd, ["rev-parse", `${merge}^1`], signal)
    ).trim();
    return { prUrl, baseRef: firstParent, headOid, title, body };
  }

  return { prUrl, baseRef, headOid, title, body };
}

export async function confirmHead(
  cwd: string,
  headOid: string,
): Promise<boolean> {
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  return head === headOid || head.startsWith(headOid);
}

export function classifyPath(path: string): {
  noise: boolean;
  asset: boolean;
} {
  return {
    noise: NOISE_PATH_RE.test(path),
    asset: ASSET_RE.test(path),
  };
}

export async function changedFiles(
  cwd: string,
  baseRef: string,
): Promise<{ files: FileEntry[]; shortstat: string }> {
  const range = baseRef.startsWith("origin/")
    ? `${baseRef}...HEAD`
    : `origin/${baseRef}...HEAD`;
  let nameStatus: string;
  try {
    nameStatus = await git(cwd, ["diff", "--name-status", range]);
  } catch {
    nameStatus = await git(cwd, ["diff", "--name-status", `${baseRef}...HEAD`]);
  }

  const files: FileEntry[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0][0];
    let kind: FileKind = "modified";
    let path = parts[1];
    let oldPath: string | undefined;
    if (code === "A") kind = "new";
    else if (code === "D") kind = "deleted";
    else if (code === "R") {
      kind = "renamed";
      oldPath = parts[1];
      path = parts[2];
    }
    const { noise, asset } = classifyPath(path);
    files.push({ path, oldPath, kind, noise, asset });
  }

  let shortstat: string;
  try {
    shortstat = (await git(cwd, ["diff", "--shortstat", range])).trim();
  } catch {
    shortstat = (
      await git(cwd, ["diff", "--shortstat", `${baseRef}...HEAD`])
    ).trim();
  }

  return { files, shortstat };
}

export function largePrGate(files: FileEntry[], shortstat: string): {
  large: boolean;
  files: number;
  churn: string;
  excluded: string;
} {
  const real = files.filter((f) => !f.noise && !f.asset);
  const insert = Number(/(\d+) insertion/.exec(shortstat)?.[1] ?? 0);
  const del = Number(/(\d+) deletion/.exec(shortstat)?.[1] ?? 0);
  // shortstat includes noise; still use it as a coarse gate plus file count
  const large = real.length >= 20 || insert + del >= 1500;
  const excludedBits: string[] = [];
  if (files.some((f) => f.noise)) excludedBits.push("lockfile/generated");
  if (files.some((f) => f.asset)) excludedBits.push("assets");
  return {
    large,
    files: real.length,
    churn: shortstat || `${insert} insertions / ${del} deletions`,
    excluded: excludedBits.join(" / ") || "n/a",
  };
}

export async function fileDiff(
  cwd: string,
  baseRef: string,
  path: string,
  opts?: { context?: number; maxChars?: number },
): Promise<string> {
  const context = opts?.context ?? 20;
  const range = `origin/${baseRef}...HEAD`;
  let out: string;
  try {
    out = await git(cwd, ["diff", `-U${context}`, range, "--", path]);
  } catch {
    out = await git(cwd, [
      "diff",
      `-U${context}`,
      `${baseRef}...HEAD`,
      "--",
      path,
    ]);
  }
  const cap = opts?.maxChars;
  if (cap && out.length > cap) {
    return `${out.slice(0, cap)}\n…[truncated ${out.length - cap} chars]`;
  }
  return out;
}

export function parseFocusFromDiff(diff: string): { start: number; end: number }[] {
  const raw: { start: number; end: number }[] = [];
  for (const match of diff.matchAll(
    /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const start = Number(match[1]);
    const len = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isFinite(start) || len <= 0) continue;
    raw.push({ start, end: start + len - 1 });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export async function readWorktreeFile(
  cwd: string,
  path: string,
): Promise<string> {
  return git(cwd, ["show", `HEAD:${path}`]);
}

export async function stash(cwd: string, signal?: AbortSignal): Promise<void> {
  await git(cwd, ["stash", "push", "-u", "-m", "code-review-walkthrough"], signal);
}

export async function checkoutBranch(
  cwd: string,
  branch: string,
): Promise<void> {
  const dirty = await porcelainStatus(cwd);
  if (dirty) {
    throw new GitError(
      "Working tree is dirty; will not switch branches.",
    );
  }
  await git(cwd, ["checkout", branch]);
}

export function githubDiffUrl(
  prUrl: string | undefined,
  path: string,
): string | undefined {
  if (!prUrl) return undefined;
  const hash = createHash("sha256").update(path).digest("hex");
  const encoded = encodeURIComponent(path);
  return `${prUrl}/files?file-filters[]=path:${encoded}#diff-${hash}`;
}
