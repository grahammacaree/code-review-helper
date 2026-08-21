import { useState } from "react";
import type { Phase, SessionSnapshot } from "../types";

export type ChipAction =
  | "stash"
  | "quit"
  | "core"
  | "all"
  | "start"
  | "skip"
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
  const phase = session?.phase;
  const textMode = canSubmitText(phase);
  const canSend = textMode && text.trim().length > 0;
  const chips = chipsFor(session);
  const prompt = textMode ? promptFor(session) : undefined;

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
      {!disabled && (chips.length > 0 || textMode) && (
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
          {textMode && (
            <div
              className="chips command-mode"
              role="group"
              aria-label="Message type"
            >
              <button
                type="button"
                className={mode === "teachback" ? undefined : "secondary"}
                onClick={() => setMode("teachback")}
              >
                Teach-back
              </button>
              <button
                type="button"
                className={mode === "ask" ? undefined : "secondary"}
                onClick={() => setMode("ask")}
              >
                Ask
              </button>
            </div>
          )}
        </div>
      )}
      {textMode && !disabled && (
        <>
          <label htmlFor="command">
            {mode === "ask" ? "Question about this file" : prompt}
          </label>
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
              {mode === "ask" ? "Ask" : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function canSubmitText(phase: Phase | undefined): boolean {
  return phase === "file" || phase === "wrapup";
}

function promptFor(session: SessionSnapshot | null): string {
  if (session?.phase === "wrapup") {
    return "What does this PR do, why does it exist, and how do the pieces connect?";
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
    case "file":
      return [
        ...(session.teachback?.kind === "question_after"
          ? [{ action: "next" as const, label: "Next file", primary: true }]
          : []),
        { action: "skip", label: "Skip this file" },
        { action: "quit", label: "Quit" },
      ];
    case "wrapup":
      return [{ action: "quit", label: "Quit" }];
    case "done":
      return [
        {
          action: "restore",
          label: `Restore ${session.startingBranch}`,
          primary: true,
        },
        { action: "reset", label: "New walkthrough" },
      ];
    default:
      return [];
  }
}
