import type { ReactNode } from "react";
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
  if (!diff?.trim()) {
    return (
      <p className="muted">No diff for <code>{path}</code>.</p>
    );
  }

  const lines = diff.replace(/\n$/, "").split("\n");
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

  return (
    <pre
      className={isProsePath(path) ? "code diff wrap" : "code diff"}
      aria-label={`Diff ${path}`}
    >
      {lines.map((line, i) => (
        <div key={i}>
          <div className={diffClass(line)}>{line || " "}</div>
          {renderNote
            ? threads.get(i)?.map((a) => (
                <div key={a.id} className="inline-composer inline-thread">
                  {renderNote(a)}
                </div>
              ))
            : null}
        </div>
      ))}
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

/**
 * Index of the diff line that shows `line` of the new file, walking the hunk
 * headers. Notes on lines the diff never touches have nowhere to sit.
 */
function anchorInDiff(lines: string[], line: number): number | undefined {
  let newNo = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      newNo = Number(hunk[1]) - 1;
      continue;
    }
    if (newNo === 0) continue; // header noise, before the first hunk
    if (text.startsWith("-")) continue; // only in the old file
    if (text.startsWith("\\")) continue; // "\ No newline at end of file"
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
