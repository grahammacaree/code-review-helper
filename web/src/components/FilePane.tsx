import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dummyArgs, functionsIn } from "../functionAtLine";
import { Prose } from "../prose";
import type { Annotation, FnBlock, LineRange, LookCloser, UhOh } from "../types";

export function FilePane({
  path,
  kind,
  text,
  focus,
  lookCloser,
  uhOh,
  focusLine,
  annotations,
  onSelect,
  onFunction,
  onOpenAnnotation,
  onLookCloser,
  composer,
  composerAfter,
  walkNote,
  onCloseWalkNote,
}: {
  path: string;
  kind: string;
  text?: string;
  focus: LineRange[];
  lookCloser: LookCloser[];
  uhOh: UhOh[];
  focusLine?: number;
  annotations: Annotation[];
  onSelect: (sel: {
    startLine: number;
    endLine: number;
    text: string;
  }) => void;
  onFunction: (fn: FnBlock) => void;
  onOpenAnnotation: (id: string) => void;
  onLookCloser: (hotspot: LookCloser) => void;
  composer?: ReactNode;
  composerAfter?: number;
  walkNote?: LookCloser | null;
  onCloseWalkNote?: () => void;
}) {
  const target = useRef<HTMLSpanElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const prevPath = useRef(path);
  const [plus, setPlus] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (prevPath.current !== path) {
      prevPath.current = path;
      const el = pre.current;
      if (el) {
        el.scrollTop = 0;
        el.closest(".file-inspect-body")?.scrollTo({ top: 0 });
      }
      return;
    }
    if (focusLine == null) return;
    target.current?.scrollIntoView({ block: "center" });
  }, [path, focusLine]);

  useEffect(() => {
    if (composerAfter == null) setPlus(null);
  }, [composerAfter]);

  useEffect(() => {
    if (composerAfter == null && !walkNote) return;
    const host = pre.current;
    if (!host) return;
    const lineNo = walkNote?.endLine ?? composerAfter;
    const line = host.querySelector(`[data-line="${lineNo}"]`);
    line?.scrollIntoView({ block: "nearest" });
    host.querySelector(".composer, .walk-note")?.scrollIntoView({
      block: "nearest",
    });
  }, [composerAfter, walkNote?.endLine, walkNote?.why]);

  const source = text ?? "";
  const fns = useMemo(() => functionsIn(source, path), [source, path]);
  const byHeader = useMemo(
    () => new Map(fns.map((f) => [f.startLine, f])),
    [fns],
  );

  if (kind === "deleted") {
    return (
      <p className="muted">
        <code>{path}</code> was deleted. Use the Diff tab for the old hunks.
      </p>
    );
  }

  const lines = source.split("\n");
  const hits = new Set<number>();
  for (const r of focus) {
    for (let n = r.start; n <= r.end; n += 1) hits.add(n);
  }
  const lookLines = new Set<number>();
  for (const h of lookCloser) {
    for (let n = h.startLine; n <= h.endLine; n += 1) lookLines.add(n);
  }
  const uhLines = new Set<number>();
  for (const u of uhOh) {
    for (let n = u.startLine; n <= u.endLine; n += 1) uhLines.add(n);
  }
  const jump = focusLine ?? lookCloser[0]?.startLine ?? [...hits][0] ?? 1;
  const openNotes = annotations.filter(
    (a) => a.path === path && a.status === "open",
  );

  function lineOfNode(node: Node | null): number | undefined {
    let el: HTMLElement | null =
      node instanceof HTMLElement ? node : node?.parentElement ?? null;
    while (el && el !== pre.current) {
      const n = el.dataset.line;
      if (n) return Number(n);
      el = el.parentElement;
    }
    return undefined;
  }

  return (
    <div className="file-pane">
      <pre
        ref={pre}
        className="code"
        aria-label={`Source ${path}`}
        onMouseUp={() => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || !pre.current?.contains(sel.anchorNode)) {
            setPlus(null);
            return;
          }
          const a = lineOfNode(sel.anchorNode);
          const b = lineOfNode(sel.focusNode);
          if (!a || !b) return;
          const startLine = Math.min(a, b);
          const endLine = Math.max(a, b);
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const host = pre.current.getBoundingClientRect();
          const top = rect.top - host.top + pre.current.scrollTop;
          const left = Math.min(
            rect.right - host.left + pre.current.scrollLeft + 6,
            host.width - 36,
          );
          setPlus({ top, left });
          onSelect({
            startLine,
            endLine,
            text: sel.toString(),
          });
        }}
      >
        {lines.map((line, i) => {
          const n = i + 1;
          const isJump = n === jump;
          const header = byHeader.get(n);
          const covering = fns.find((f) => n >= f.startLine && n <= f.endLine);
          const lookHere = lookCloser.filter((h) => n === h.startLine);
          const uhHere = uhOh.filter((u) => n === u.startLine);
          const notes = openNotes.filter(
            (a) => n >= a.startLine && n <= a.endLine,
          );
          const classes = [
            hits.has(n) ? "hit" : "",
            lookLines.has(n) ? "look-range" : "",
            uhLines.has(n) ? "uh-range" : "",
            notes.length ? "noted" : "",
            covering ? "in-fn" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={n}>
              <div className={classes || undefined} data-line={n}>
                <span className="ln">{n}</span>
                {(lookHere.length > 0 || uhHere.length > 0) && (
                  <span className="gutter-marks">
                    {lookHere.map((h) => (
                      <button
                        key={`look-${h.name}-${h.startLine}`}
                        type="button"
                        className="gutter-mark look"
                        title={`${h.name} — ${h.why}`}
                        aria-label={`Look closer: ${h.name}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onLookCloser(h);
                        }}
                      >
                        ?
                      </button>
                    ))}
                    {uhHere.map((u) => (
                      <button
                        key={`uh-${u.startLine}-${u.text}`}
                        type="button"
                        className="gutter-mark uh"
                        title={u.text}
                        aria-label={`Uh oh: ${u.text}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onLookCloser({
                            name: "Uh oh",
                            startLine: u.startLine,
                            endLine: u.endLine,
                            why: u.text,
                          });
                        }}
                      >
                        !
                      </button>
                    ))}
                  </span>
                )}
                <span
                  className="line-src"
                  ref={isJump ? target : undefined}
                  onClick={() => {
                    if (header) onFunction(header);
                  }}
                >
                  {notes[0] && (
                    <button
                      type="button"
                      className="note-mark"
                      title={notes[0].body}
                      aria-label={`${notes[0].kind} on this line`}
                      onClick={() => onOpenAnnotation(notes[0].id)}
                    >
                      {notes[0].kind === "question" ? "?" : "·"}
                    </button>
                  )}
                  {header && (
                    <button
                      type="button"
                      className="run-mark"
                      title={`Run ${header.name}`}
                      aria-label={`Run ${header.name}`}
                      onClick={() => onFunction(header)}
                    >
                      ▸
                    </button>
                  )}
                  {line || " "}
                </span>
              </div>
              {walkNote && n === walkNote.endLine ? (
                <div
                  className={`inline-composer walk-note${walkNote.name === "Uh oh" ? " uh" : " look"}`}
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  <p className="muted">
                    {walkNote.name === "Uh oh" ? "Uh oh" : "Look closer"} L
                    {walkNote.startLine}–L{walkNote.endLine}
                  </p>
                  {walkNote.name !== "Uh oh" && <h3>{walkNote.name}</h3>}
                  <Prose text={walkNote.why} />
                  {onCloseWalkNote && (
                    <div className="row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={onCloseWalkNote}
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
              {composer && n === composerAfter ? (
                <div
                  className="inline-composer"
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  {composer}
                </div>
              ) : null}
            </div>
          );
        })}
      </pre>
      {plus && (
        <button
          type="button"
          className="plus-btn"
          style={{ top: plus.top, left: plus.left }}
          aria-label="Add question or comment"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            document.getElementById("note-draft")?.focus();
          }}
        >
          +
        </button>
      )}
    </div>
  );
}

export function defaultArgsJson(fn: FnBlock): string {
  return JSON.stringify(dummyArgs(fn.params), null, 2);
}
