import { useEffect, useRef, useState } from "react";
import type {
  FnBlock,
  FunctionBrief,
  ProbeArgSuggestion,
  ProbeResult,
} from "../types";
import { Octicon, type OcticonName } from "./Octicon";

/**
 * A room to play in: the function's source and its arguments are both editable,
 * and Run executes what is on screen rather than what is on disk. Nothing here
 * touches the working tree.
 */
type Pane = "source" | "about";

export function Sandbox({
  fn,
  path,
  fileText,
  probe,
  busy,
  error,
  argsJson,
  sampleNote,
  sampleKind,
  brief,
  briefBusy,
  briefError,
  initialPane = "source",
  onExplain,
  onArgsJson,
  onRun,
  onClose,
}: {
  fn: FnBlock;
  path: string;
  fileText?: string;
  probe?: ProbeResult;
  busy: boolean;
  /** A failed request — the modal covers the bar that would otherwise show it. */
  error?: string | null;
  argsJson: string;
  sampleNote?: string | null;
  sampleKind?: ProbeArgSuggestion["kind"] | "loading" | null;
  brief?: FunctionBrief | null;
  briefBusy?: boolean;
  briefError?: string | null;
  /** Design mode opens straight onto About; the walk starts on the source. */
  initialPane?: Pane;
  /** Asked for only when About is opened: it costs an agent round trip. */
  onExplain: (refresh?: boolean) => void;
  onArgsJson: (json: string) => void;
  onRun: (args: unknown[], source: string) => void;
  onClose: () => void;
}) {
  const onDisk = sourceOf(fileText, fn);
  const [source, setSource] = useState(onDisk);
  const [pane, setPane] = useState<Pane>(initialPane);
  const [argsError, setArgsError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSource(onDisk);
  }, [onDisk]);

  // Focus lands on the panel once, on open. Re-running this on every render
  // would pull focus out of whichever editor you are typing in.
  useEffect(() => {
    panel.current?.focus();
    // Opening straight onto About means the reviewer asked for it already.
    if (initialPane === "about") onExplain();
  }, []);

  const latest = useRef({ run, onClose });
  latest.current = { run, onClose };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") latest.current.onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        latest.current.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run() {
    let args: unknown[] = [];
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      args = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      setArgsError(err instanceof Error ? err.message : "Arguments are not JSON.");
      return;
    }
    setArgsError(null);
    onRun(args, source === onDisk ? "" : source);
  }

  const edited = source !== onDisk;
  // Matched on the target, not the name: two functions in one file can share a
  // name, and neither a result nor a brief must land in the wrong sandbox.
  const target = `${path}:${fn.startLine}`;
  const mine = probe?.id === target ? probe : undefined;
  const mineBrief = brief?.id === target ? brief : undefined;

  function openPane(next: Pane) {
    setPane(next);
    if (next === "about" && !mineBrief && !briefBusy) onExplain();
  }

  return (
    <div className="sandbox-backdrop" onMouseDown={onClose}>
      <div
        className="sandbox"
        role="dialog"
        aria-modal="true"
        aria-label={`Sandbox for ${fn.name}`}
        tabIndex={-1}
        ref={panel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sandbox-head head-row">
          <h2>
            <code>{fn.name}</code>
            {edited && <span className="kind-label">edited</span>}
          </h2>
          <p className="head-sub">
            {path} · L{fn.startLine}–L{fn.endLine}
          </p>
          <button
            type="button"
            className="sandbox-close"
            aria-label="Close sandbox"
            onClick={onClose}
          >
            <Octicon name="x" />
          </button>
        </header>

        <div className="sandbox-body">
          <section className="sandbox-pane tabbed" aria-label="Function source">
            <div className="sandbox-pane-head head-row">
              <div className="tabs" role="tablist" aria-label="Function views">
                {PANES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    id={`sandbox-tab-${p.id}`}
                    aria-controls="sandbox-pane-panel"
                    aria-selected={pane === p.id}
                    className={pane === p.id ? "tab current" : "tab"}
                    onClick={() => openPane(p.id)}
                  >
                    <Octicon name={p.icon} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              {pane === "source" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!edited}
                  onClick={() => setSource(onDisk)}
                >
                  Revert edits
                </button>
              )}
            </div>
            <div
              className="sandbox-pane-panel"
              role="tabpanel"
              id="sandbox-pane-panel"
              aria-labelledby={`sandbox-tab-${pane}`}
            >
              {pane === "source" ? (
                <textarea
                  className="code sandbox-source"
                  spellCheck={false}
                  value={source}
                  disabled={busy}
                  onChange={(e) => setSource(e.target.value)}
                />
              ) : (
                <About
                  brief={mineBrief}
                  busy={Boolean(briefBusy)}
                  error={briefError}
                  onExplain={onExplain}
                />
              )}
            </div>
          </section>

          <section className="sandbox-side" aria-label="Arguments and result">
            <div className="sandbox-pane">
              <div className="sandbox-pane-head head-row">
                <h3>Arguments</h3>
                <p className="head-sub">JSON array</p>
              </div>
              {sampleNote && (
                <p
                  className={
                    sampleKind === "placeholder"
                      ? "status warn"
                      : sampleKind === "loading" || sampleKind === "shape"
                        ? "muted"
                        : "status ok"
                  }
                >
                  {sampleNote}
                </p>
              )}
              <textarea
                className="code sandbox-args"
                spellCheck={false}
                value={argsJson}
                disabled={busy}
                onChange={(e) => onArgsJson(e.target.value)}
              />
              {argsError && <p className="status error">{argsError}</p>}
            </div>

            <div className="sandbox-pane sandbox-out" aria-live="polite">
              <div className="sandbox-pane-head head-row">
                <h3>Result</h3>
                {mine?.args && (
                  <p className="head-sub">
                    {fn.name}({JSON.stringify(mine.args).slice(1, -1)})
                  </p>
                )}
              </div>
              {error && <p className="status error">{error}</p>}
              {busy && <p className="muted">Running…</p>}
              {!mine && !error && !busy && (
                <p className="muted">Run to see what comes back.</p>
              )}
              {mine?.error && <p className="status error">{mine.error}</p>}
              {mine?.result && <pre className="code">{mine.result}</pre>}
              {mine?.stdout && <pre className="code muted">{mine.stdout}</pre>}
            </div>
          </section>
        </div>

        <footer className="sandbox-foot">
          <button type="button" disabled={busy} onClick={run}>
            {busy ? "Running…" : "Run"}
          </button>
          <p className="muted">
            {edited
              ? "Runs your edited copy beside the real file, so its imports still resolve."
              : "Runs the version on disk. Edit the function to try a change."}
          </p>
        </footer>
      </div>
    </div>
  );
}

const PANES: { id: Pane; label: string; icon: OcticonName }[] = [
  { id: "source", label: "Function", icon: "file-code" },
  { id: "about", label: "About", icon: "info" },
];

/**
 * What the function does and why, and the system it sits on. Parsed facts sit
 * below the prose so the reviewer can check the reasoning against the checkout.
 */
function About({
  brief,
  busy,
  error,
  onExplain,
}: {
  brief?: FunctionBrief;
  busy: boolean;
  error?: string | null;
  onExplain: (refresh?: boolean) => void;
}) {
  if (!brief) {
    return (
      <div className="sandbox-about waiting" aria-busy={busy}>
        {busy ? (
          <p className="status working" role="status">
            <span className="spinner" aria-hidden="true" />
            Reading this function, its callers, and the repo notes…
          </p>
        ) : (
          <>
            {error && <p className="status error">{error}</p>}
            <button type="button" onClick={() => onExplain(Boolean(error))}>
              {error ? "Try again" : "Explain this function"}
            </button>
            <p className="muted">
              Asks the walkthrough agent what this does, why it exists, and
              which system it sits on. Takes a few seconds.
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="sandbox-about" aria-busy={busy}>
      {error && <p className="status error">{error}</p>}
      {/* The old answer stays readable while a fresh one is on its way, so the
          wait needs saying out loud rather than only on the button. */}
      {busy && (
        <p className="status working" role="status">
          <span className="spinner" aria-hidden="true" />
          Asking again…
        </p>
      )}
      <section>
        <h4>What it does</h4>
        <p>{brief.what}</p>
      </section>
      <section>
        <h4>Why it exists</h4>
        <p>{brief.why}</p>
      </section>
      {brief.concept && (
        <section className="sandbox-concept">
          <h4>{brief.conceptName ?? "The system it sits on"}</h4>
          <p>{brief.concept}</p>
        </section>
      )}
      {brief.watch && (
        <section className="sandbox-watch">
          <h4>Before you edit it</h4>
          <p>{brief.watch}</p>
        </section>
      )}
      <section>
        <h4>From the checkout</h4>
        <ul className="sandbox-facts">
          {brief.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>
      <div className="sandbox-about-foot">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => onExplain(true)}
        >
          {busy ? "Asking again…" : "Ask again"}
        </button>
      </div>
    </div>
  );
}

function sourceOf(fileText: string | undefined, fn: FnBlock): string {
  if (!fileText) return fn.header;
  return fileText
    .split("\n")
    .slice(fn.startLine - 1, fn.endLine)
    .join("\n");
}
