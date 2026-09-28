/**
 * Snap Look closer / Be careful ranges onto enclosing functions.
 * Structural-region idea from Whiteboard/diffr — see docs/whiteboard-credit.md;
 * we use the existing brace-balance finder rather than an AST aligner.
 *
 * Only expand *thin* pins (a few lines). Wide agent ranges are left alone so a
 * dense file does not light up an entire 200-line function.
 */
import { functionAtLine } from "./probe.js";
import type { LookCloser, UhOh } from "./types.js";

/** Pins already this wide (inclusive span) are treated as deliberate regions. */
const THIN_SPAN = 8;

export function snapLookCloser(
  items: LookCloser[],
  fileText: string,
  path: string,
): LookCloser[] {
  return items.map((item) => {
    if (item.endLine - item.startLine >= THIN_SPAN) return item;
    const mid = Math.round((item.startLine + item.endLine) / 2);
    const fn =
      functionAtLine(fileText, mid, path) ||
      functionAtLine(fileText, item.startLine, path);
    if (!fn) return item;
    const startLine = Math.min(item.startLine, fn.startLine);
    const endLine = Math.max(item.endLine, fn.endLine);
    const name =
      item.name && item.name !== "anonymous" ? item.name : fn.name;
    return { ...item, name, startLine, endLine };
  });
}

export function snapUhOh(
  items: UhOh[],
  fileText: string,
  path: string,
): UhOh[] {
  return items.map((item) => {
    if (item.endLine - item.startLine >= THIN_SPAN) return item;
    const mid = Math.round((item.startLine + item.endLine) / 2);
    const fn =
      functionAtLine(fileText, mid, path) ||
      functionAtLine(fileText, item.startLine, path);
    if (!fn) return item;
    return {
      ...item,
      startLine: Math.min(item.startLine, fn.startLine),
      endLine: Math.max(item.endLine, fn.endLine),
    };
  });
}
