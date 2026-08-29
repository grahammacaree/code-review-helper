import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dummyArgs, functionsIn } from "../functionAtLine";
import { Prose } from "../prose";
import type { Annotation, FnBlock, LineRange, LookCloser, UhOh } from "../types";
import { ThreadBox, ThreadReply } from "./NoteThread";

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
  onLookCloser,
  composer,
  composerAfter,
  walkNote,
  onCloseWalkNote,
  renderNote,
  onAskSpot,
  busy,
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
  onLookCloser: (hotspot: LookCloser) => void;
  composer?: ReactNode;
  composerAfter?: number;
  walkNote?: LookCloser | null;
  onCloseWalkNote?: () => void;
  /** Thread for a note, rendered under the last line it covers. */
  renderNote?: (note: Annotation) => ReactNode;
  /** A question typed into a hotspot thread, kept on that hotspot's range. */
  onAskSpot?: (spot: LookCloser, text: string) => void;
  busy?: boolean;
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
    host.querySelector(".composer, .note-thread.open")?.scrollIntoView({
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
  const here = annotations.filter((a) => a.path === path);
  const openNotes = here.filter((a) => a.status === "open");
  // Anchored to the last line the note covers, clamped so a note past the end
  // of the file still has somewhere to sit.
  const threads = new Map<number, Annotation[]>();
  for (const a of here) {
    const at = Math.min(Math.max(a.endLine, 1), lines.length);
    threads.set(at, [...(threads.get(at) ?? []), a]);
  }
  // Hotspots read as threads too, anchored the same way, so the walk note the
  // gutter icon opens is the box already sitting under the range.
  const spots = new Map<number, Hotspot[]>();
  for (const h of lookCloser) addSpot(spots, lines.length, h, "look");
  for (const u of uhOh) {
    addSpot(
      spots,
      lines.length,
      {
        name: "Be careful",
        startLine: u.startLine,
        endLine: u.endLine,
        why: u.text,
      },
      "uh",
    );
  }

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
                {notes[0] && (
                  <span
                    className={header ? "note-mark shifted" : "note-mark"}
                    aria-label={`${notes[0].kind} on this line`}
                  >
                    {notes[0].kind === "question" ? "?" : "·"}
                  </span>
                )}
                {header && (
                  <button
                    type="button"
                    className="run-mark"
                    title={`Run ${header.name}`}
                    aria-label={`Run ${header.name}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFunction(header);
                    }}
                  >
                    ▸
                  </button>
                )}
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
                        aria-label={`Be careful: ${u.text}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onLookCloser({
                            name: "Be careful",
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
                  {line || " "}
                </span>
              </div>
              {spots.get(n)?.map(({ spot, tone }) => {
                const isOpen = Boolean(walkNote && sameSpot(walkNote, spot));
                return (
                  <div
                    key={`${tone}-${spot.startLine}-${spot.name}`}
                    className="inline-composer inline-thread"
                    onMouseUp={(e) => e.stopPropagation()}
                  >
                    <ThreadBox
                      tone={tone}
                      label={`${tone === "uh" ? "Be careful with" : "Look closer at"} ${range(spot)}`}
                      open={isOpen}
                      peek={tone === "uh" ? spot.why : spot.name}
                      onToggle={() => {
                        if (isOpen) onCloseWalkNote?.();
                        else onLookCloser(spot);
                      }}
                    >
                      {tone === "look" && <h3>{spot.name}</h3>}
                      <Prose text={spot.why} />
                      {onAskSpot && (
                        <ThreadReply
                          disabled={Boolean(busy)}
                          placeholder="Ask about this"
                          submitLabel="Ask"
                          onSubmit={(text) => onAskSpot(spot, text)}
                          actions={
                            onCloseWalkNote && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={onCloseWalkNote}
                              >
                                Got it
                              </button>
                            )
                          }
                        />
                      )}
                    </ThreadBox>
                  </div>
                );
              })}
              {renderNote
                ? threads.get(n)?.map((a) => (
                    <div
                      key={a.id}
                      className="inline-composer inline-thread"
                      onMouseUp={(e) => e.stopPropagation()}
                    >
                      {renderNote(a)}
                    </div>
                  ))
                : null}
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

interface Hotspot {
  spot: LookCloser;
  tone: "look" | "uh";
}

function addSpot(
  spots: Map<number, Hotspot[]>,
  lineCount: number,
  spot: LookCloser,
  tone: "look" | "uh",
): void {
  const at = Math.min(Math.max(spot.endLine, 1), lineCount);
  spots.set(at, [...(spots.get(at) ?? []), { spot, tone }]);
}

function range(spot: LookCloser): string {
  return spot.startLine === spot.endLine
    ? `L${spot.startLine}`
    : `L${spot.startLine}–L${spot.endLine}`;
}

function sameSpot(a: LookCloser, b: LookCloser): boolean {
  return (
    a.startLine === b.startLine && a.endLine === b.endLine && a.why === b.why
  );
}

export function defaultArgsJson(fn: FnBlock): string {
  return JSON.stringify(dummyArgs(fn.params), null, 2);
}
