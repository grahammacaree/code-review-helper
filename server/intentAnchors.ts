/**
 * Pull author intents from a PR body so file cards can anchor
 * "they asked for X → this hunk is where X landed".
 * Inspired by Whiteboard TraceQuote (/dev/fast) — see docs/whiteboard-credit.md.
 */

const QUOTE = /[""]([^""]{12,200})[""]|'([^']{12,200})'/g;
const WANT =
  /^(?:[-*•]\s+)?(?:please\s+|we\s+should\s+|i\s+want\s+|need(?:s)?\s+to\s+|must\s+|should\s+)?(.{16,180})$/i;

/** Best-effort intents from PR markdown. Deduped, capped. */
export function extractAuthorIntents(prBody: string | undefined): string[] {
  if (!prBody?.trim()) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
    if (t.length < 12 || t.length > 180) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    // Skip headings / URLs / checkboxes chrome.
    if (/^https?:\/\//i.test(t)) return;
    if (/^(summary|description|test plan|checklist)\b/i.test(t)) return;
    seen.add(key);
    found.push(t);
  };

  for (const m of prBody.matchAll(QUOTE)) {
    push(m[1] || m[2] || "");
  }

  for (const line of prBody.split("\n")) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) continue;
    if (/^\[[ x]\]/i.test(trimmed)) {
      push(trimmed.replace(/^\[[ x]\]\s*/i, ""));
      continue;
    }
    const bullet = WANT.exec(trimmed);
    if (bullet && /^[-*•]/.test(trimmed)) push(bullet[1] || "");
  }

  return found.slice(0, 8);
}

/**
 * Pick intents that likely involve this file (path stem / export-ish tokens
 * appear in the quote). Used when the agent leaves intentAnchors empty.
 */
export function matchIntentsToPath(
  intents: string[],
  path: string,
  cardText: string,
): { quote: string; note: string }[] {
  if (!intents.length) return [];
  const stem = path.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  const tokens = stem
    .split(/[-_.]/)
    .filter((t) => t.length > 3)
    .map((t) => t.toLowerCase());
  const hay = `${cardText}\n${path}`.toLowerCase();
  const out: { quote: string; note: string }[] = [];
  for (const quote of intents) {
    const q = quote.toLowerCase();
    const pathHit = tokens.some((t) => q.includes(t));
    const words = q.split(/\s+/).filter((w) => w.length > 4);
    const overlap = words.filter((w) => hay.includes(w)).length;
    if (pathHit || overlap >= 2) {
      out.push({
        quote,
        note: "Author intent from the PR body — check this file is where it landed.",
      });
    }
    if (out.length >= 2) break;
  }
  return out;
}
