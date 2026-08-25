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

export function commentaryPromptBlock(
  bundle: CommentaryBundle | undefined,
): string {
  if (!bundle || (!bundle.userMarkdown.trim() && !bundle.repoMarkdown.trim())) {
    return "";
  }
  return [
    "Private notes live in the walkthrough app (`data/commentary/`), never in the git checkout under review.",
    "Two files, two jobs: user.md is about Graham’s review craft; repos/*.md is a map of this checkout. Do not mix them.",
    bundle.repoMarkdown.trim()
      ? [
          "Checkout map: tilt uh-ohs / Look closer toward **What matters here** and **Watch next** when this file hits those seams.",
          "That file is about the codebase (packages, opt-in callers, fail-open). Not a grade of the reviewer. Do not quiz teach-back on it.",
          `Checkout map:\n${clip(bundle.repoMarkdown, 5000)}`,
        ].join("\n\n")
      : "",
    bundle.userMarkdown.trim()
      ? [
          "Craft notes: tilt explanations toward **Working on** when this file actually hits that gap. **Do not hammer** (and quiet gaps) stay quiet unless the hunk hits that seam again.",
          "Do not add card sections. Do not teach-back the notes. Do not invent character flaws. Do not quote unless a nudge is directly relevant.",
          `Craft notes (Graham):\n${clip(bundle.userMarkdown, 3500)}`,
        ].join("\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function emptyUserTemplate(): string {
  return `# Craft notes (Graham)

Private. Walkthrough app only. Kind, firm, specific. Never contempt.
About how Graham reviews — not a map of any one repo.
Patterns are portable habits. Merge; do not log walks, filenames, or vendor class names.

## Patterns worth keeping

(none yet)

## Working on

Gaps with fresh evidence. Tag quiet walks as (quiet: 0). If a walk does not show the gap, increment quiet. After two quiet walks, move to Do not hammer. After it stays quiet there, drop it. Do not keep a weakness forever.

(none yet)

## Do not hammer

Cooled-off gaps. Do not nag cards about these unless this walk hits the seam again — then they can return to Working on.

(none yet)
`;
}

export function emptyRepoTemplate(opts: {
  origin?: string;
  repoPath: string;
}): string {
  const who = opts.origin || basename(opts.repoPath);
  return `# ${who}

Private map of this checkout from walks. Not part of the git repo.
About the codebase — not a diary of teach-back or a PR changelog.
Each walk should merge new facts into this map.

## Snapshot

- Last walk: none yet

## What matters here

Durable architecture and review seams. Merge what this walk taught; drop what a later walk disproved. Group by how the system works (opt-in vs global, where code runs, fail-open, what tests prove). Do not keep a per-PR log.

(none yet)

## Watch next

When a future PR touches a related seam, look at these — not recitation prompts.

(none yet)
`;
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
