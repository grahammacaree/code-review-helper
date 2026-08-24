import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { projectRoot } from "./env.js";
import { originUrl } from "./git.js";

export interface CommentaryBundle {
  key: string;
  origin?: string;
  repoPath: string;
  userMarkdown: string;
  repoMarkdown: string;
}

const MAX_FILE_CHARS = 12_000;

function commentaryDir(): string {
  return join(projectRoot(), "data", "commentary");
}

function userPath(): string {
  return join(commentaryDir(), "user.md");
}

function repoPathFor(key: string): string {
  return join(commentaryDir(), "repos", `${key}.md`);
}

async function commentaryKey(
  repoPath: string,
): Promise<{ key: string; origin?: string }> {
  const origin = await originUrl(repoPath);
  if (origin) return { key: slug(origin), origin };
  const base = basename(repoPath) || "local";
  const hash = createHash("sha256")
    .update(repoPath)
    .digest("hex")
    .slice(0, 8);
  return { key: slug(`${base}-${hash}`) };
}

export async function loadCommentary(
  repoPath: string,
): Promise<CommentaryBundle> {
  const { key, origin } = await commentaryKey(repoPath);
  const [userMarkdown, repoMarkdown] = await Promise.all([
    readOptional(userPath()),
    readOptional(repoPathFor(key)),
  ]);
  return { key, origin, repoPath, userMarkdown, repoMarkdown };
}

export async function saveCommentary(opts: {
  key: string;
  userMarkdown: string;
  repoMarkdown: string;
}): Promise<void> {
  await mkdir(join(commentaryDir(), "repos"), { recursive: true });
  await writeFile(userPath(), clip(opts.userMarkdown), "utf8");
  await writeFile(repoPathFor(opts.key), clip(opts.repoMarkdown), "utf8");
}

/** Short block for the overview UI — not the full private files. */
export function coachNoteForUi(bundle: CommentaryBundle): string | undefined {
  const watch = extractSection(bundle.repoMarkdown, ["Watch next"]);
  const matters = extractSection(bundle.repoMarkdown, ["What matters"]);
  const bits = [matters, watch].filter(Boolean);
  if (bits.length) return bits.join("\n\n").slice(0, 1600);
  if (!bundle.repoMarkdown.trim()) return undefined;
  return "You have a private map of this checkout from earlier walks.";
}

export function commentaryPromptBlock(
  bundle: CommentaryBundle | undefined,
): string {
  if (!bundle?.repoMarkdown.trim()) return "";
  return [
    "Private checkout map lives in the walkthrough app (`data/commentary/repos/`), never in the git checkout under review.",
    "Tilt uh-ohs / Look closer toward **What matters here** and **Watch next** when this file actually hits those seams.",
    "Those notes are about the repo (packages, opt-in callers, fail-open, GSSP vs middleware). They are not a grade of the reviewer. Do not quiz teach-back on them.",
    "Do not add card sections. Do not invent house law. Do not quote the notes unless a seam is directly relevant.",
    `Checkout map:\n${clip(bundle.repoMarkdown, 5000)}`,
  ].join("\n\n");
}

export function emptyUserTemplate(): string {
  return `# Craft notes

Unused. Checkout maps live in \`repos/\`. Do not grade the reviewer here.
`;
}

export function emptyRepoTemplate(opts: {
  origin?: string;
  repoPath: string;
}): string {
  const who = opts.origin || basename(opts.repoPath);
  return `# ${who}

Private map of this checkout from walks. Not part of the git repo.
About the codebase — not a diary of teach-back.

## Snapshot

- Last walk: none yet

## What matters here

Durable architecture and review seams. Merge new facts; drop what a later walk disproved.

(none yet)

## Walks

Newest first. One short entry per PR: what it revealed about this repo, not how the walk went.

(none yet)

## Watch next

When a future PR touches a related seam, look at these — not recitation prompts.

(none yet)
`;
}

function extractSection(markdown: string, titles: string[]): string {
  if (!markdown.trim()) return "";
  const lines = markdown.split("\n");
  const want = titles.map((t) => t.toLowerCase());
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const h = lines[i].match(/^#{1,3}\s+(.+)/);
    if (h && want.some((t) => h[1].toLowerCase().includes(t))) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

function slug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "repo";
}

function clip(text: string, max = MAX_FILE_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return `${t}\n`;
  return `${t.slice(0, max)}\n\n…[truncated]\n`;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
