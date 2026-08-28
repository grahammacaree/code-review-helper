import { useEffect, useRef, useState } from "react";
import { Octicon } from "../components/Octicon";
import { WalkView, type WalkActions } from "../components/WalkView";
import type { FunctionBrief, ProbeArgSuggestion } from "../types";
import { AUTH_MISSING, AUTH_OK, FIX_BRIEF, SCENARIOS } from "./fixtures";

/**
 * Design mode: every walk state on fixtures, with no agent and no server.
 * Reachable at `?design`.
 *
 * It renders the real `WalkView` at full size — the state picker floats above
 * it so nothing here changes the layout being reviewed.
 */
export function DesignMode() {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const scenario = SCENARIOS[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === "]") setIndex((i) => (i + 1) % SCENARIOS.length);
      else if (e.key === "[")
        setIndex((i) => (i - 1 + SCENARIOS.length) % SCENARIOS.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const actions: WalkActions = {
    onRepoPath: () => undefined,
    onPr: () => undefined,
    onCheckout: () => undefined,
    onSend: () => undefined,
    onAction: () => undefined,
    onInterrupt: () => undefined,
    onBrowse: () => undefined,
    onChase: () => undefined,
    onAnnotate: () => undefined,
    onReply: () => undefined,
    onResolve: () => undefined,
    onProbe: () => undefined,
    onSuggestArgs: (): Promise<ProbeArgSuggestion> =>
      Promise.resolve({
        args: [{ status: 404 }],
        note: "Design mode: fixture argument, nothing was executed.",
        kind: "fixture",
        source: "follow-server.utils.test.ts",
      }),
    onExplainFunction: (): Promise<FunctionBrief> =>
      Promise.resolve(FIX_BRIEF),
  };

  return (
    <>
      <WalkView
        // Remount per scenario so pane state starts from the fixture.
        key={scenario.id}
        auth={scenario.id === "no-key" ? AUTH_MISSING : AUTH_OK}
        session={scenario.session}
        error={scenario.error ?? null}
        busy={Boolean(scenario.busy)}
        repoPath="/Users/graham/code/atlas"
        recentRepos={["/Users/graham/code/atlas", "/Users/graham/code/harbor-mobile"]}
        pr="https://github.com/northwind/atlas/pull/482"
        initialFn={scenario.fn}
        initialFnPane={scenario.fnPane}
        initialTab={scenario.tab ?? "file"}
        actions={actions}
      />
      <div className="design-dock" ref={panel}>
        {open && (
          <div className="design-panel" role="dialog" aria-label="Design states">
            <ul className="design-list">
              {SCENARIOS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={i === index ? "design-item current" : "design-item"}
                    aria-current={i === index}
                    onClick={() => {
                      setIndex(i);
                      setOpen(false);
                    }}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="design-hint">
              <kbd>[</kbd> <kbd>]</kbd> to step · fixtures only, controls inert
            </p>
          </div>
        )}
        <button
          type="button"
          className="design-fab"
          aria-expanded={open}
          aria-label={
            open ? "Close design states" : `Design states — ${scenario.label}`
          }
          title={scenario.label}
          onClick={() => setOpen((v) => !v)}
        >
          <Octicon name={open ? "x" : "plus"} size={20} />
        </button>
      </div>
    </>
  );
}
