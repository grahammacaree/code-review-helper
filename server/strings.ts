/**
 * Small text helpers shared by the source-reading modules (samples, shapes,
 * session facts). Kept in one place so a fix to the bracket walker or the
 * literal sandbox lands everywhere at once.
 */

export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Text between the balanced pair opening at `openIdx`, quotes respected.
 * Returns undefined when the pair never closes.
 */
export function balanced(
  src: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): string | undefined {
  if (src[openIdx] !== openCh) return undefined;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

/**
 * Evaluates a source literal in a fresh scope. Anything that could run code
 * from the reviewed tree — functions, imports — is refused rather than run.
 */
export function evalLiteral(src: string): unknown {
  if (/=>|\bfunction\b|\bimport\b|\brequire\b/.test(src)) return undefined;
  try {
    return Function(`"use strict"; return (${src});`)() as unknown;
  } catch {
    return undefined;
  }
}
