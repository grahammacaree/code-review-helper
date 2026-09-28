import { useEffect, useMemo, useState, type ReactNode } from "react";
import { foldUnifiedDiff, type DiffFold } from "../diffFold";
import { isProsePath } from "../paths";
import type { Annotation } from "../types";

export function DiffPane({
  path,
  diff,
  annotations = [],
  renderNote,
}: {
  path: string;
  diff?: string;
  annotations?: Annotation[];
  /** Thread for a note, rendered under the diff line it covers. */
  renderNote?: (note: Annotation) => ReactNode;
}) {
  const lines = useMemo(
    () => (diff?.trim() ? diff.replace(/\n$/, "").split("\n") : []),
    [diff],
  );
  const folds = useMemo(
    () => (diff?.trim() ? foldUnifiedDiff(diff) : []),
    [diff],
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setOpen({});
  }, [diff]);

  if (!diff?.trim() || lines.length === 0) {
    return (
      <p className="muted">
        No diff for <code>{path}</code>.
      </p>
    );
  }

  const threads = new Map<number, Annotation[]>();
  const offDiff: Annotation[] = [];
  for (const a of annotations) {
    if (a.path !== path) continue;
    const at = anchorInDiff(lines, a.endLine);
    if (at == null) {
      offDiff.push(a);
      continue;
    }
    threads.set(at, [...(threads.get(at) ?? []), a]);
  }

  const foldAt = new Map<number, DiffFold>();
  for (const f of folds) foldAt.set(f.start, f);

  const rows: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const fold = foldAt.get(i);
    if (fold) {
      const key = `${fold.kind}-${fold.start}`;
      const expanded = open[key] === true;
      rows.push(
        <div key={key} className="diff-fold">
          <button
            type="button"
            className="diff-fold-toggle"
            aria-expanded={expanded}
            onClick={() =>
              setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
            }
          >
            <span className="diff-fold-chevron" aria-hidden>
              {expanded ? "▾" : "▸"}
            </span>
            <span className="muted">{foldLabel(fold, expanded)}</span>
          </button>
          {!expanded && fold.summary && fold.summary.length > 0 && (
            <div className="diff-fold-pseudo" aria-label="Pseudocode summary">
              {fold.summary.map((s, j) => (
                <div key={j} className="diff-fold-pseudo-line">
                  {s}
                </div>
              ))}
            </div>
          )}
          {expanded &&
            lines.slice(fold.start, fold.end + 1).map((line, j) => {
              const idx = fold.start + j;
              return (
                <div key={idx}>
                  <div className={diffClass(line)}>{line || " "}</div>
                  {renderNote
                    ? threads.get(idx)?.map((a) => (
                        <div
                          key={a.id}
                          className="inline-composer inline-thread"
                        >
                          {renderNote(a)}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
        </div>,
      );
      i = fold.end + 1;
      continue;
    }

    const line = lines[i]!;
    rows.push(
      <div key={i}>
        <div className={diffClass(line)}>{line || " "}</div>
        {renderNote
          ? threads.get(i)?.map((a) => (
              <div key={a.id} className="inline-composer inline-thread">
                {renderNote(a)}
              </div>
            ))
          : null}
      </div>,
    );
    i += 1;
  }

  return (
    <pre
      className={isProsePath(path) ? "code diff wrap" : "code diff"}
      aria-label={`Diff ${path}`}
    >
      {rows}
      {renderNote && offDiff.length > 0 && (
        <div className="inline-composer inline-thread off-diff">
          <p className="muted">Notes on lines this diff does not touch</p>
          {offDiff.map((a) => (
            <div key={a.id}>{renderNote(a)}</div>
          ))}
        </div>
      )}
    </pre>
  );
}

function foldLabel(fold: DiffFold, expanded: boolean): string {
  const mark = expanded ? "expanded" : "folded";
  if (fold.kind === "imports") return `${fold.label} · ${mark}`;
  if (fold.kind === "pseudocode") return `${fold.label} · ${mark}`;
  return `${fold.label} · ${mark}`;
}

function anchorInDiff(lines: string[], line: number): number | undefined {
  let newNo = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      newNo = Number(hunk[1]) - 1;
      continue;
    }
    if (newNo === 0) continue;
    if (text.startsWith("-")) continue;
    if (text.startsWith("\\")) continue;
    newNo += 1;
    if (newNo === line) return i;
  }
  return undefined;
}

function diffClass(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return undefined;
}
