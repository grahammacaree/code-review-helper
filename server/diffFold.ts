/**
 * Semantic-ish folds over a unified diff + agent budget helpers.
 * Inspired by Whiteboard (/dev/fast) + diffr — see docs/whiteboard-credit.md.
 * Diff pane imports via web/src/diffFold.ts re-export.
 */

export type DiffFoldKind = "imports" | "pseudocode" | "noise";

export interface DiffFold {
  /** Inclusive index into the split diff lines. */
  start: number;
  end: number;
  kind: DiffFoldKind;
  label: string;
  summary?: string[];
}

const IMPORT_LINE =
  /^[+-]\s*(import\s|export\s+\*\s+from\s|export\s+\{[^}]*\}\s+from\s)/;
const ADDED_FN_START =
  /^\+\s*(export\s+)?(async\s+)?(function\s*\*?|const\s+\w+\s*=\s*(async\s*)?\(|class\s+\w+)/;
const MIN_PSEUDO_LINES = 12;
const MIN_IMPORT_LINES = 4;

export function foldUnifiedDiff(diff: string): DiffFold[] {
  if (!diff.trim()) return [];
  const lines = diff.replace(/\n$/, "").split("\n");
  const folds: DiffFold[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("@@")
    ) {
      i += 1;
      continue;
    }

    if (IMPORT_LINE.test(line) || isImportish(line)) {
      const start = i;
      while (i < lines.length && isImportish(lines[i]!)) i += 1;
      const end = i - 1;
      if (end - start + 1 >= MIN_IMPORT_LINES) {
        folds.push({
          start,
          end,
          kind: "imports",
          label: `${end - start + 1} import lines`,
        });
      }
      continue;
    }

    if (line.startsWith("+") && ADDED_FN_START.test(line)) {
      const start = i;
      const header = line.slice(1).trim();
      i += 1;
      let depth = parenDelta(line);
      let braces = braceDelta(line);
      while (i < lines.length) {
        const L = lines[i]!;
        if (L.startsWith("@@") || L.startsWith("diff ")) break;
        if (
          braces <= 0 &&
          depth <= 0 &&
          i > start &&
          L.startsWith("+") &&
          ADDED_FN_START.test(L)
        ) {
          break;
        }
        if (L.startsWith("+") || L.startsWith(" ")) {
          depth += parenDelta(L);
          braces += braceDelta(L);
        }
        i += 1;
        if (braces <= 0 && depth <= 0 && i > start + 1) break;
      }
      const end = i - 1;
      const span = end - start + 1;
      if (span >= MIN_PSEUDO_LINES) {
        const body = lines
          .slice(start, end + 1)
          .filter((l) => l.startsWith("+"));
        folds.push({
          start,
          end,
          kind: "pseudocode",
          label: `+${body.length} · ${shortHeader(header)}`,
          summary: pseudocodeFromAdded(body),
        });
      }
      continue;
    }

    i += 1;
  }

  return mergeOverlaps(folds);
}

/**
 * Collapse import runs and large added bodies into compact markers so a
 * character budget keeps the mechanism, not only the head of the file.
 */
export function renderFoldedDiff(diff: string): string {
  if (!diff.trim()) return diff;
  const lines = diff.replace(/\n$/, "").split("\n");
  const folds = foldUnifiedDiff(diff);
  const foldAt = new Map<number, DiffFold>();
  for (const f of folds) foldAt.set(f.start, f);

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const fold = foldAt.get(i);
    if (fold) {
      if (fold.kind === "imports") {
        out.push(`… [${fold.label} folded]`);
      } else if (fold.kind === "pseudocode") {
        out.push(`… [${fold.label} — pseudocode:]`);
        for (const s of fold.summary ?? []) {
          out.push(`+ // ${s}`);
        }
        out.push(`… [end folded body]`);
      } else {
        out.push(`… [${fold.label} folded]`);
      }
      i = fold.end + 1;
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}

export type DiffBudgetMode = "full" | "folded" | "folded_truncated" | "head_truncated";

export interface DiffBudgetResult {
  text: string;
  mode: DiffBudgetMode;
  rawChars: number;
  sentChars: number;
}

/**
 * Fit a unified diff into maxChars for an agent prompt.
 * Prefer fold compression over a naive head cut when over budget.
 */
export function budgetDiffForAgent(
  diff: string,
  maxChars: number,
): DiffBudgetResult {
  const rawChars = diff.length;
  if (rawChars <= maxChars) {
    return { text: diff, mode: "full", rawChars, sentChars: rawChars };
  }

  const folded = renderFoldedDiff(diff);
  const noteFolded = `\n…[diff folded for budget: imports collapsed, large adds as pseudocode — ${rawChars}→${folded.length} chars]`;
  if (folded.length + noteFolded.length <= maxChars) {
    const text = folded + noteFolded;
    return {
      text,
      mode: "folded",
      rawChars,
      sentChars: text.length,
    };
  }

  if (folded.length < rawChars) {
    const room = Math.max(0, maxChars - 120);
    const text = `${folded.slice(0, room)}\n…[truncated folded diff; raw ${rawChars} chars, folded ${folded.length}]`;
    return {
      text,
      mode: "folded_truncated",
      rawChars,
      sentChars: text.length,
    };
  }

  // Nothing useful to fold — fall back to head truncate.
  const text = `${diff.slice(0, maxChars)}\n…[truncated ${rawChars - maxChars} chars]`;
  return { text, mode: "head_truncated", rawChars, sentChars: text.length };
}

function isImportish(line: string): boolean {
  if (line.startsWith("@@") || line.startsWith("diff ")) return false;
  const body =
    line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")
      ? line.slice(1)
      : line;
  return (
    /^\s*import\s/.test(body) ||
    /^\s*export\s+\*\s+from\s/.test(body) ||
    /^\s*export\s+\{[^}]*\}\s+from\s/.test(body) ||
    (/^\s*from\s+['"]/.test(body) && line.startsWith("+")) ||
    (/^\s*['"][^'"]+['"];?\s*$/.test(body) && line.startsWith("+"))
  );
}

function parenDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "(") d += 1;
    else if (ch === ")") d -= 1;
  }
  return d;
}

function braceDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "{") d += 1;
    else if (ch === "}") d -= 1;
  }
  return d;
}

function shortHeader(header: string): string {
  const m =
    /(?:function\s*\*?\s*|const\s+|class\s+)([A-Za-z_$][\w$]*)/.exec(header) ||
    /([A-Za-z_$][\w$]*)\s*=/.exec(header);
  return m?.[1] ?? header.slice(0, 40);
}

function pseudocodeFromAdded(addedLines: string[]): string[] {
  const out: string[] = [];
  for (const raw of addedLines) {
    const line = raw.slice(1).trim();
    if (!line || line === "{" || line === "}" || line === ");") continue;
    if (/^\/\//.test(line) || /^\*/.test(line) || /^\/\*/.test(line)) continue;
    if (/^(import|export)\s/.test(line)) continue;
    if (
      /^(if|else|for|while|switch|try|catch|finally|return|throw|await|const|let|var)\b/.test(
        line,
      ) ||
      /\bawait\b/.test(line) ||
      /\breturn\b/.test(line) ||
      /^(async\s+)?function\b/.test(line)
    ) {
      let s = line.replace(/\{$/, "").replace(/;$/, "");
      if (s.length > 72) s = `${s.slice(0, 70)}…`;
      out.push(s);
    }
  }
  const budget = Math.max(3, Math.ceil(addedLines.length / 5));
  if (out.length <= budget) return out.slice(0, 12);
  const step = out.length / budget;
  const picked: string[] = [];
  for (let i = 0; i < budget; i += 1) {
    picked.push(out[Math.floor(i * step)]!);
  }
  return picked;
}

function mergeOverlaps(folds: DiffFold[]): DiffFold[] {
  if (folds.length < 2) return folds;
  const sorted = [...folds].sort((a, b) => a.start - b.start);
  const out: DiffFold[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1]!;
    const next = sorted[i]!;
    if (next.start <= prev.end) continue;
    out.push(next);
  }
  return out;
}
