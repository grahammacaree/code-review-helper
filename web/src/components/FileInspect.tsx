import { useEffect, useRef, useState } from "react";
import type {
  Annotation,
  FileCard,
  FnBlock,
  LookCloser,
  ProbeArgSuggestion,
  ProbeResult,
} from "../types";
import { DiffPane } from "./DiffPane";
import { FilePane, defaultArgsJson } from "./FilePane";

export type FileTab = "diff" | "file";

export function FileInspect({
  card,
  fileText,
  diffText,
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
}: {
  card?: FileCard;
  fileText?: string;
  diffText?: string;
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
  onProbe: (line: number, args: unknown[]) => void;
  onSuggestArgs: (
    line: number,
    signal?: AbortSignal,
  ) => Promise<ProbeArgSuggestion>;
  onLookCloser: (hotspot: LookCloser) => void;
  onCloseWalkNote: () => void;
}) {
  const [sel, setSel] = useState<{
    startLine: number;
    endLine: number;
    text: string;
  } | null>(null);
  const [kind, setKind] = useState<"question" | "comment">("question");
  const [draft, setDraft] = useState("");
  const [fn, setFn] = useState<FnBlock | null>(null);
  const [argsJson, setArgsJson] = useState("[]");
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleKind, setSampleKind] = useState<
    ProbeArgSuggestion["kind"] | "loading" | null
  >(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const sampleGen = useRef(0);
  const sampleAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    sampleAbort.current?.abort();
    sampleGen.current += 1;
    setSel(null);
    setDraft("");
    setFn(null);
    setSampleNote(null);
    setSampleKind(null);
    setOpenId(null);
  }, [card?.path]);

  const here = annotations.filter((a) => a.path === card?.path);
  const openNote = here.find((a) => a.id === openId);

  function dismissDraft() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setDraft("");
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
        <div className="tabs" role="tablist" aria-label="File views">
          <button
            type="button"
            role="tab"
            id="tab-diff"
            aria-controls="file-view-panel"
            aria-selected={tab === "diff"}
            className={tab === "diff" ? undefined : "secondary"}
            onClick={() => onTab("diff")}
          >
            Diff
          </button>
          <button
            type="button"
            role="tab"
            id="tab-file"
            aria-controls="file-view-panel"
            aria-selected={tab === "file"}
            className={tab === "file" ? undefined : "secondary"}
            onClick={() => onTab("file")}
          >
            File
          </button>
        </div>
      </header>
      {card ? (
        <div
          className="file-inspect-body"
          role="tabpanel"
          id="file-view-panel"
          aria-labelledby={tab === "diff" ? "tab-diff" : "tab-file"}
        >
          {tab === "diff" ? (
            <DiffPane path={card.path} diff={diffText} />
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
              const gen = ++sampleGen.current;
              sampleAbort.current?.abort();
              const ac = new AbortController();
              sampleAbort.current = ac;
              setFn(next);
              setArgsJson(defaultArgsJson(next));
              setSampleKind("loading");
              setSampleNote(
                "Looking in tests and fixtures for a sample argument…",
              );
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
            }}
            onOpenAnnotation={setOpenId}
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
        <form
          className="probe-panel"
          onSubmit={(e) => {
            e.preventDefault();
            let args: unknown[] = [];
            try {
              const parsed = JSON.parse(argsJson) as unknown;
              args = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              return;
            }
            onProbe(fn.startLine, args);
          }}
        >
          <h3>
            Run <code>{fn.name}</code>
            <span className="muted">
              {" "}
              L{fn.startLine}–L{fn.endLine}
              {fn.exported ? "" : " · not exported — isolated eval"}
            </span>
          </h3>
          <p className="muted">{fn.header}</p>
          <label htmlFor="args">Arguments as JSON array</label>
          {sampleNote && (
            <p
              className={
                sampleKind === "placeholder"
                  ? "status warn"
                  : sampleKind === "loading"
                    ? "muted"
                    : "status ok"
              }
            >
              {sampleNote}
            </p>
          )}
          <textarea
            id="args"
            rows={sampleKind === "fixture" || sampleKind === "test" ? 10 : 4}
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            disabled={busy}
          />
          <div className="row">
            <button type="submit" disabled={busy}>
              Run locally
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                sampleAbort.current?.abort();
                sampleGen.current += 1;
                setFn(null);
                setSampleNote(null);
                setSampleKind(null);
              }}
            >
              Close
            </button>
          </div>
          {probe && probe.name === fn.name && (
            <div className="probe-out">
              {probe.error ? (
                <p className="status error">{probe.error}</p>
              ) : (
                <pre className="code">{probe.result}</pre>
              )}
              {probe.stdout && <pre className="code muted">{probe.stdout}</pre>}
            </div>
          )}
        </form>
      )}

      {here.length > 0 && (
        <div className="notes">
          <h3>Notes on this file</h3>
          <ul>
            {here.map((a) => (
              <li key={a.id} className={a.status}>
                <button
                  type="button"
                  className="hotspot"
                  onClick={() => setOpenId(a.id)}
                >
                  {a.kind} L{a.startLine}–L{a.endLine}
                  {a.status === "resolved" ? " · resolved" : ""}
                </button>
                {a.status === "open" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => onResolve(a.id)}
                  >
                    Resolve
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {openNote && (
        <div className="note-thread">
          <p>
            <strong>{openNote.kind}</strong> L{openNote.startLine}–L
            {openNote.endLine}
          </p>
          <p>{openNote.body}</p>
          {openNote.replies.map((r) => (
            <p key={r.id} className="muted">
              <strong>{r.role}:</strong> {r.text}
            </p>
          ))}
          {openNote.status === "open" && (
            <ReplyBox
              disabled={busy}
              onReply={(text) => onReply(openNote.id, text)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function shortFilePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}

function ReplyBox({
  disabled,
  onReply,
}: {
  disabled: boolean;
  onReply: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onReply(text);
        setText("");
      }}
    >
      <textarea
        rows={2}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder="Follow up"
      />
      <div className="row">
        <button type="submit" disabled={disabled || !text.trim()}>
          Reply
        </button>
      </div>
    </form>
  );
}
