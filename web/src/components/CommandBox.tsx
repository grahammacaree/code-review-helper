import { useState } from "react";
import { reviewNotesMarkdown } from "../exportNotes";
import type { Phase, SessionSnapshot } from "../types";

export type ChipAction =
  | "stash"
  | "quit"
  | "core"
  | "all"
  | "start"
  | "skip"
  | "skipTests"
  | "chase"
  | "next"
  | "restore"
  | "reset";

export function CommandBox({
  session,
  disabled,
  onSend,
  onAction,
  onInterrupt,
}: {
  session: SessionSnapshot | null;
  disabled: boolean;
  onSend: (text: string, mode: "ask" | "teachback") => void;
  onAction: (action: ChipAction) => void;
  onInterrupt: () => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"ask" | "teachback">("teachback");
  const [copied, setCopied] = useState(false);
  const phase = session?.phase;
  const textMode = canSubmitText(phase);
  const canSend = textMode && text.trim().length > 0;
  const chips = chipsFor(session);
  const prompt = textMode ? promptFor(session) : undefined;
  const canExport = phase === "wrapup" || phase === "done";
  const showBar = !disabled && (chips.length > 0 || textMode || canExport);
  const showForm = textMode && !disabled;

  async function copyNotes() {
    if (!session) return;
    const md = reviewNotesMarkdown(session);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="command-box">
      {disabled && (
        <div className="work-row" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{session?.workingOn || "Working…"}</span>
          <button type="button" className="secondary" onClick={onInterrupt}>
            Interrupt
          </button>
        </div>
      )}
      {!disabled && showBar && (
        <div className="command-bar">
          {chips.length > 0 && (
            <div className="chips" role="group" aria-label="Walkthrough actions">
              {chips.map((chip) => (
                <button
                  key={chip.action}
                  type="button"
                  className={chip.primary ? undefined : "secondary"}
                  disabled={disabled}
                  onClick={() => onAction(chip.action)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          {canExport && (
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => void copyNotes()}
            >
              {copied ? "Copied" : "Copy review notes"}
            </button>
          )}
        </div>
      )}
      {showForm && (
        <>
          {/* Prompt left, tabs right, both on the input's top edge. The prompt
              is dropped by a container query when the row gets tight. */}
          <div className="compose-head">
            <label className="compose-prompt" htmlFor="command">
              {mode === "ask" ? "Question about this file" : prompt}
            </label>
            <div
              className="command-mode"
              role="tablist"
              aria-label="Message type"
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  id={`mode-${m.id}`}
                  aria-controls="command-panel"
                  aria-selected={mode === m.id}
                  className={mode === m.id ? "tab current" : "tab"}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="compose-panel"
            role="tabpanel"
            id="command-panel"
            aria-labelledby={`mode-${mode}`}
          >
            <textarea
              id="command"
              rows={3}
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend && !disabled) {
                    onSend(text, mode);
                    setText("");
                  }
                }
              }}
            />
            <div className="row">
              <button
                type="button"
                disabled={disabled || !canSend}
                onClick={() => {
                  onSend(text, mode);
                  setText("");
                }}
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const MODES: { id: "teachback" | "ask"; label: string }[] = [
  { id: "teachback", label: "Teach-back" },
  { id: "ask", label: "Ask" },
];

function canSubmitText(phase: Phase | undefined): boolean {
  return phase === "file" || phase === "wrapup";
}

function promptFor(session: SessionSnapshot | null): string {
  if (session?.phase === "wrapup") {
    return "What does this PR do, why does it exist, and how do the pieces connect?";
  }
  if (session?.card?.chase) {
    return "Optional notes — or Done looking. No paraphrase required.";
  }
  return "What does this file change, and why was it needed?";
}

function chipsFor(
  session: SessionSnapshot | null,
): { action: ChipAction; label: string; primary?: boolean }[] {
  if (!session) return [];
  switch (session.phase) {
    case "blocked_dirty":
      return [
        { action: "stash", label: "Stash and continue", primary: true },
        { action: "quit", label: "Quit" },
      ];
    case "blocked_large":
      return [
        { action: "quit", label: "Quit" },
        { action: "core", label: "Core only", primary: true },
        { action: "all", label: "Walk all" },
      ];
    case "overview":
      return [
        { action: "start", label: "Start file 1", primary: true },
        { action: "quit", label: "Quit" },
      ];
    case "file": {
      const pending = (session.chaseCandidates ?? []).filter(
        (c) => !session.queue.includes(c.path) && !session.covered.includes(c.path),
      );
      const chasing = Boolean(session.card?.chase);
      const pendingTests = (session.queue ?? []).filter(
        (p) =>
          !(session.covered ?? []).includes(p) &&
          (/\.(test|spec)\./i.test(p) ||
            /(^|\/)(__tests__|tests?|spec)\//i.test(p)),
      );
      return [
        ...(session.teachback?.kind === "question_after"
          ? [{ action: "next" as const, label: "Next file", primary: true }]
          : []),
        ...(!chasing && pending.length
          ? [
              {
                action: "chase" as const,
                label:
                  pending.length === 1
                    ? "Chase outside caller"
                    : `Chase ${pending.length} outside callers`,
                primary: true,
              },
            ]
          : []),
        ...(pendingTests.length > 1 ||
        (pendingTests.length === 1 && session.card?.path !== pendingTests[0])
          ? [
              {
                action: "skipTests" as const,
                label:
                  pendingTests.length === 1
                    ? "Skip remaining test"
                    : `Skip ${pendingTests.length} remaining tests`,
              },
            ]
          : []),
        {
          action: "skip" as const,
          label: chasing ? "Done looking" : "Skip this file",
          primary: chasing,
        },
        { action: "quit" as const, label: "Quit" },
      ];
    }
    case "wrapup":
      return [{ action: "quit", label: "Quit" }];
    case "done":
      return [
        ...(!session.homeRestored
          ? [
              {
                action: "restore" as const,
                label: `Restore ${session.homeBranch || "main"}`,
                primary: true,
              },
            ]
          : []),
        {
          action: "reset",
          label: "New walkthrough",
          primary: Boolean(session.homeRestored),
        },
      ];
    default:
      return [];
  }
}
