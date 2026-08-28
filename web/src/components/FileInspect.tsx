import { useEffect, useRef, useState } from "react";
import type {
  Annotation,
  ChaseCandidate,
  FileCard,
  FileWiring,
  FnBlock,
  LookCloser,
  Overview,
  FunctionBrief,
  ProbeArgSuggestion,
  ProbeResult,
} from "../types";
import { DiffPane } from "./DiffPane";
import { FilePane, defaultArgsJson } from "./FilePane";
import { NoteThread } from "./NoteThread";
import { Octicon, type OcticonName } from "./Octicon";
import { RolePane } from "./RolePane";
import { Sandbox } from "./Sandbox";
import { WiringPane } from "./WiringPane";

export type FileTab = "diff" | "file" | "role" | "wiring";

export function FileInspect({
  card,
  fileText,
  diffText,
  fileWiring,
  overview,
  focusLine,
  walkNote,
  tab,
  annotations,
  probe,
  busy,
  onTab,
  onAnnotate,
  onReply,
  onResolve,
  onProbe,
  onSuggestArgs,
  onLookCloser,
  onCloseWalkNote,
  chaseCandidates,
  onChase,
  openFn,
  openFnPane,
  onExplainFunction,
  error,
}: {
  card?: FileCard;
  fileText?: string;
  diffText?: string;
  fileWiring?: FileWiring;
  overview?: Overview;
  focusLine?: number;
  walkNote?: LookCloser | null;
  tab: FileTab;
  annotations: Annotation[];
  probe?: ProbeResult;
  busy: boolean;
  onTab: (tab: FileTab) => void;
  onAnnotate: (input: {
    kind: "question" | "comment";
    startLine: number;
    endLine: number;
    selectedText: string;
    body: string;
  }) => void;
  onReply: (id: string, text: string) => void;
  onResolve: (id: string) => void;
  onProbe: (line: number, args: unknown[], source?: string) => void;
  onSuggestArgs: (
    line: number,
    signal?: AbortSignal,
  ) => Promise<ProbeArgSuggestion>;
  onLookCloser: (hotspot: LookCloser) => void;
  onCloseWalkNote: () => void;
  chaseCandidates?: ChaseCandidate[];
  onChase?: (path: string) => void;
  /** Opens the sandbox on load, for design mode. */
  openFn?: FnBlock;
  openFnPane?: "source" | "about";
  onExplainFunction: (
    line: number,
    signal?: AbortSignal,
    refresh?: boolean,
  ) => Promise<FunctionBrief>;
  /** Last request failure, so the sandbox can report it over the modal. */
  error?: string | null;
}) {
  const [sel, setSel] = useState<{
    startLine: number;
    endLine: number;
    text: string;
  } | null>(null);
  const [kind, setKind] = useState<"question" | "comment">("question");
  const [draft, setDraft] = useState("");
  const [fn, setFn] = useState<FnBlock | null>(openFn ?? null);
  const [argsJson, setArgsJson] = useState(
    openFn ? defaultArgsJson(openFn) : "[]",
  );
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleKind, setSampleKind] = useState<
    ProbeArgSuggestion["kind"] | "loading" | null
  >(null);
  const [brief, setBrief] = useState<FunctionBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  // Per-thread open/closed overrides; the default comes from note status.
  const [threadOpen, setThreadOpen] = useState<Record<string, boolean>>({});
  const sampleGen = useRef(0);
  const sampleAbort = useRef<AbortController | null>(null);
  const briefGen = useRef(0);
  const briefAbort = useRef<AbortController | null>(null);

  // A new file clears the pane. Only a *change* of file, though: running this on
  // mount would close a sandbox opened straight onto a function and throw away
  // the brief that sandbox has just asked for.
  const shownPath = useRef(card?.path);

  useEffect(() => {
    if (shownPath.current === card?.path) return;
    shownPath.current = card?.path;
    sampleAbort.current?.abort();
    sampleGen.current += 1;
    setSel(null);
    setDraft("");
    setFn(null);
    setSampleNote(null);
    setSampleKind(null);
    setThreadOpen({});
    dropBrief();
  }, [card?.path]);

  // A sandbox opened straight onto a function still needs its sample argument;
  // only the click path used to ask for one.
  useEffect(() => {
    if (openFn) openSandbox(openFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFn?.startLine]);

  const here = annotations.filter((a) => a.path === card?.path);

  function thread(note: Annotation) {
    return (
      <NoteThread
        note={note}
        busy={busy}
        open={threadOpen[note.id] ?? note.status === "open"}
        onToggle={(next) =>
          setThreadOpen((prev) => ({ ...prev, [note.id]: next }))
        }
        onReply={(text) => onReply(note.id, text)}
        onResolve={() => onResolve(note.id)}
      />
    );
  }

  function dismissDraft() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setDraft("");
  }

  function closeProbe() {
    sampleAbort.current?.abort();
    sampleGen.current += 1;
    setFn(null);
    setSampleNote(null);
    setSampleKind(null);
    dropBrief();
  }

  /**
   * Opens the sandbox on a function and fills the arguments box with the best
   * sample the host can find, falling back to per-parameter placeholders while
   * that search runs.
   */
  function openSandbox(next: FnBlock) {
    const gen = ++sampleGen.current;
    sampleAbort.current?.abort();
    const ac = new AbortController();
    sampleAbort.current = ac;
    setFn(next);
    dropBrief();
    setArgsJson(defaultArgsJson(next));
    setSampleKind("loading");
    setSampleNote("Looking in tests and fixtures for a sample argument…");
    void onSuggestArgs(next.startLine, ac.signal)
      .then((sample) => {
        if (sampleGen.current !== gen) return;
        setArgsJson(JSON.stringify(sample.args, null, 2));
        setSampleKind(sample.kind);
        setSampleNote(sample.note);
      })
      .catch((err: unknown) => {
        if (sampleGen.current !== gen) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setSampleKind("placeholder");
        setSampleNote(
          err instanceof Error
            ? err.message
            : "Could not search tests; using placeholders.",
        );
      });
  }

  function dropBrief() {
    briefAbort.current?.abort();
    briefGen.current += 1;
    setBrief(null);
    setBriefBusy(false);
    setBriefError(null);
  }

  /** One agent round trip, so it only runs when About is actually opened. */
  function explain(line: number, refresh = false) {
    const gen = ++briefGen.current;
    briefAbort.current?.abort();
    const ac = new AbortController();
    briefAbort.current = ac;
    setBriefBusy(true);
    setBriefError(null);
    void onExplainFunction(line, ac.signal, refresh)
      .then((next) => {
        if (briefGen.current !== gen) return;
        setBrief(next);
        setBriefBusy(false);
      })
      .catch((err: unknown) => {
        if (briefGen.current !== gen) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setBriefBusy(false);
        setBriefError(
          err instanceof Error ? err.message : "Could not explain this function.",
        );
      });
  }

  function sameFn(a: FnBlock, b: FnBlock): boolean {
    return a.startLine === b.startLine && a.name === b.name;
  }

  return (
    <section
      className={card ? "file-inspect" : "file-inspect empty"}
      aria-label="Current file"
    >
      <header className="file-inspect-head">
        <h2 title={card?.path}>
          {card ? (
            <code>{shortFilePath(card.path)}</code>
          ) : (
            <span className="muted">No file chosen yet</span>
          )}
          {card ? <span className="kind-label">{card.kind}</span> : null}
        </h2>
        {card ? (
          <div className="tabs" role="tablist" aria-label="File views">
            {tabsFor(card, diffText, fileWiring).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-controls="file-view-panel"
                aria-selected={tab === t.id}
                className={tab === t.id ? "tab current" : "tab"}
                onClick={() => onTab(t.id)}
              >
                <Octicon name={t.icon} />
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className="counter">{t.count}</span>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {card ? (
        <div
          className="file-inspect-body"
          role="tabpanel"
          id="file-view-panel"
          aria-labelledby={
            tab === "diff"
              ? "tab-diff"
              : tab === "file"
                ? "tab-file"
                : tab === "role"
                  ? "tab-role"
                  : "tab-wiring"
          }
        >
          {tab === "diff" ? (
            <DiffPane
              path={card.path}
              diff={diffText}
              annotations={here}
              renderNote={thread}
            />
          ) : tab === "role" ? (
            <RolePane card={card} overview={overview} />
          ) : tab === "wiring" ? (
            <WiringPane
              wiring={fileWiring}
              chaseCandidates={card.chase ? [] : chaseCandidates}
              onChase={card.chase ? undefined : onChase}
              disabled={busy}
            />
          ) : (
          <FilePane
            path={card.path}
            kind={card.kind}
            text={fileText}
            focus={card.focus}
            lookCloser={card.lookCloser}
            uhOh={card.uhOh}
            focusLine={focusLine}
            walkNote={walkNote}
            onCloseWalkNote={onCloseWalkNote}
            annotations={here}
            onLookCloser={(hotspot) => {
              dismissDraft();
              onLookCloser(hotspot);
            }}
            onSelect={(next) => {
              setSel({
                startLine: next.startLine,
                endLine: next.endLine,
                text: next.text,
              });
              setDraft("");
            }}
            onFunction={(next) => {
              if (fn && sameFn(fn, next)) {
                closeProbe();
                return;
              }
              openSandbox(next);
            }}
            renderNote={thread}
            busy={busy}
            onAskSpot={(spot, body) =>
              onAnnotate({
                kind: "question",
                startLine: spot.startLine,
                endLine: spot.endLine,
                selectedText: "",
                body,
              })
            }
            composerAfter={sel?.endLine}
            composer={
              sel ? (
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!draft.trim()) return;
                    onAnnotate({
                      kind,
                      startLine: sel.startLine,
                      endLine: sel.endLine,
                      selectedText: sel.text,
                      body: draft,
                    });
                    dismissDraft();
                  }}
                >
                  <p className="muted">
                    L{sel.startLine}–L{sel.endLine}
                  </p>
                  <div className="chips">
                    <button
                      type="button"
                      className={kind === "question" ? undefined : "secondary"}
                      onClick={() => setKind("question")}
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      className={kind === "comment" ? undefined : "secondary"}
                      onClick={() => setKind("comment")}
                    >
                      Comment
                    </button>
                  </div>
                  <textarea
                    id="note-draft"
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      kind === "question"
                        ? "Question about this range"
                        : "Comment to keep until you resolve it"
                    }
                    disabled={busy}
                  />
                  <div className="row">
                    <button type="submit" disabled={busy || !draft.trim()}>
                      {kind === "question" ? "Ask in chat" : "Save comment"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={dismissDraft}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null
            }
          />
        )}
        </div>
      ) : null}

      {fn && (
        <Sandbox
          fn={fn}
          path={card?.path ?? ""}
          fileText={fileText}
          probe={probe}
          busy={busy}
          argsJson={argsJson}
          error={error}
          sampleNote={sampleNote}
          sampleKind={sampleKind}
          brief={brief}
          briefBusy={briefBusy}
          briefError={briefError}
          initialPane={openFnPane}
          onExplain={(refresh) => explain(fn.startLine, refresh)}
          onArgsJson={setArgsJson}
          onRun={(args, source) => onProbe(fn.startLine, args, source)}
          onClose={closeProbe}
        />
      )}

    </section>
  );
}

/**
 * Counters only where a real number exists — hunks in the diff, hotspots worth
 * a look, wiring edges. Role has no countable contents, so it gets none.
 */
function tabsFor(
  card: FileCard,
  diffText?: string,
  fileWiring?: FileWiring,
): {
  id: FileTab;
  label: string;
  icon: OcticonName;
  count?: number;
}[] {
  const hunks = diffText?.match(/^@@/gm)?.length || undefined;
  const edges =
    (fileWiring &&
      fileWiring.imports.length + fileWiring.exports.length) ||
    undefined;
  return [
    { id: "diff", label: "Diff", icon: "file-diff", count: hunks },
    {
      id: "file",
      label: "File",
      icon: "file-code",
      count: card.lookCloser.length || undefined,
    },
    { id: "role", label: "Role", icon: "book" },
    { id: "wiring", label: "Wiring", icon: "plug", count: edges },
  ];
}

function shortFilePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}
