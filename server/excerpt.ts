import { functionAtLine } from "./probe.js";
import { escapeRe } from "./strings.js";

/**
 * Pulls the parts of a file that mention a name, rather than its first N chars.
 *
 * A chase asks whether an unchanged caller still holds up now an export has
 * changed, and that answer lives at the call site. Sending the head of the file
 * pays for imports and unrelated functions, and in a large caller it can cut
 * the call off entirely — so the excerpt follows the names instead.
 */
export interface Excerpt {
  text: string;
  /** What the excerpt is, said plainly enough to put in a prompt. */
  note: string;
}

interface Range {
  start: number;
  end: number;
}

/** Lines either side of a hit when there is no function to expand to. */
const WINDOW = 12;

export function excerptAround(
  text: string,
  path: string,
  names: string[],
  opts: { maxChars: number; maxRegions?: number; definitionsOnly?: boolean },
): Excerpt {
  const lines = text.split("\n");
  const maxRegions = opts.maxRegions ?? 3;
  const hits = findHits(lines, names, opts.definitionsOnly);

  if (!hits.length) {
    // Nothing matched — a renamed export, a re-export, a generated file. The
    // head of the file is a poor excerpt but it beats sending nothing.
    return {
      text: clip(text, opts.maxChars),
      note: `no mention of ${names.join(", ") || "the export"} found; first lines of the file`,
    };
  }

  const regions = merge(
    hits.map((line) => regionFor(text, lines, path, line)),
  ).slice(0, maxRegions);

  const shown: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const region of regions) {
    const body = lines.slice(region.start - 1, region.end).join("\n");
    const block = `--- lines ${region.start}-${region.end} ---\n${body}`;
    if (used + block.length > opts.maxChars) {
      dropped += 1;
      continue;
    }
    shown.push(block);
    used += block.length;
  }

  if (!shown.length) {
    // One region bigger than the whole budget: keep its opening.
    const region = regions[0];
    const body = lines.slice(region.start - 1, region.end).join("\n");
    return {
      text: `--- lines ${region.start}-${region.end} ---\n${clip(body, opts.maxChars)}`,
      note: `the ${opts.definitionsOnly ? "definition" : "call site"}, truncated`,
    };
  }

  const what = opts.definitionsOnly ? "definition" : "call site";
  const count = shown.length === 1 ? `the ${what}` : `${shown.length} ${what}s`;
  const rest = dropped ? `, ${dropped} more not shown` : "";
  const total = hits.length > regions.length ? ` of ${hits.length} mentions` : "";
  return {
    text: shown.join("\n\n"),
    note: `${count}${total} with the surrounding function${rest}`,
  };
}

/**
 * Lines mentioning any of the names. In-memory regex rather than git grep,
 * matching how `samples.hitsInFiles` searches text it already holds.
 */
function findHits(
  lines: string[],
  names: string[],
  definitionsOnly?: boolean,
): number[] {
  if (!names.length) return [];
  const body = names.map((n) => escapeRe(n)).join("|");
  const re = definitionsOnly
    ? new RegExp(
        `(?:function|const|let|var|class|def)\\s+(?:${body})\\b|\\b(?:${body})\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function)`,
      )
    : new RegExp(`\\b(?:${body})\\b`);
  const out: number[] = [];
  let inImport = false;
  lines.forEach((line, i) => {
    // An import proves nothing about use, and its names often sit on their own
    // lines in a braced list — so the whole statement is skipped, not just the
    // line that says `import`.
    const opens = /^\s*(import|export)\b/.test(line);
    const closes = /\bfrom\b|;\s*$/.test(line);
    const skip = !definitionsOnly && (inImport || opens);
    inImport = (inImport || opens) && !closes;
    if (skip) return;
    if (re.test(line)) out.push(i + 1);
  });
  return out;
}

/** The function containing the hit, or a window when there is not one. */
function regionFor(
  text: string,
  lines: string[],
  path: string,
  line: number,
): Range {
  const fn = functionAtLine(text, line, path);
  if (fn) return { start: fn.startLine, end: fn.endLine };
  return {
    start: Math.max(1, line - WINDOW),
    end: Math.min(lines.length, line + WINDOW),
  };
}

/** Overlapping or touching regions become one, so nothing is sent twice. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    out.push({ ...range });
  }
  return out;
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}
