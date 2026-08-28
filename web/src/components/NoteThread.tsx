import { useState, type ReactNode } from "react";
import { Prose } from "../prose";
import type { Annotation } from "../types";
import { Octicon } from "./Octicon";

/**
 * The box every anchored thread uses: comments, look-closer notes, uh-ohs. A
 * summary row that opens, so a line's worth of context never stacks up out of
 * sight at the bottom of the pane.
 */
export function ThreadBox({
  id,
  tone,
  label,
  resolved,
  open,
  peek,
  right,
  onToggle,
  children,
}: {
  id?: string;
  tone: "comment" | "look" | "uh";
  label: string;
  /** Settled threads stay visible but recede. */
  resolved?: boolean;
  open: boolean;
  peek: string;
  right?: ReactNode;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`note-thread ${tone}${resolved ? " resolved" : ""}${
        open ? " open" : ""
      }`}
      id={id}
    >
      <button
        type="button"
        className="note-thread-head"
        aria-expanded={open}
        aria-controls={id ? `${id}-body` : undefined}
        onClick={() => onToggle(!open)}
      >
        <Octicon name={open ? "chevron-down" : "chevron-right"} />
        <span className="note-thread-title">{label}</span>
        {right}
        {!open && <span className="note-thread-peek">{peek}</span>}
      </button>
      {open && (
        <div className="note-thread-body" id={id ? `${id}-body` : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A review thread anchored in the code, GitHub-style: a collapsed summary row
 * that opens onto the note, its replies, and the reply box. Resolved threads
 * start collapsed so they stay out of the way without disappearing.
 */
export function NoteThread({
  note,
  open,
  busy,
  onToggle,
  onReply,
  onResolve,
}: {
  note: Annotation;
  open: boolean;
  busy: boolean;
  onToggle: (open: boolean) => void;
  onReply: (text: string) => void;
  onResolve: () => void;
}) {
  const range =
    note.startLine === note.endLine
      ? `L${note.startLine}`
      : `L${note.startLine}–L${note.endLine}`;
  const label = note.kind === "question" ? "Question" : "Comment";
  const count = note.replies.length;

  return (
    <ThreadBox
      id={`note-${note.id}`}
      tone="comment"
      label={`${label} on ${range}`}
      resolved={note.status === "resolved"}
      open={open}
      peek={note.body}
      onToggle={onToggle}
      right={
        <>
          {count > 0 && <span className="counter">{count + 1}</span>}
          {note.status === "resolved" && (
            <span className="note-resolved">
              <Octicon name="check-circle" />
              Resolved
            </span>
          )}
        </>
      }
    >
      <NoteComment who="You" text={note.body} />
      {note.replies.map((r) => (
        <NoteComment
          key={r.id}
          who={r.role === "assistant" ? "Walkthrough" : "You"}
          text={r.text}
        />
      ))}
      {note.status === "open" && (
        <ThreadReply
          disabled={busy}
          placeholder="Write a reply"
          submitLabel="Reply"
          onSubmit={onReply}
          actions={
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onResolve}
            >
              Resolve comment
            </button>
          }
        />
      )}
    </ThreadBox>
  );
}

function NoteComment({ who, text }: { who: string; text: string }) {
  return (
    <div className="note-comment">
      <p className="note-who">{who}</p>
      <Prose text={text} />
    </div>
  );
}

/**
 * Input on its own full-width row, actions on a ruled row beneath it — the
 * shape GitHub uses, and the same for every kind of thread.
 */
export function ThreadReply({
  disabled,
  placeholder,
  submitLabel,
  actions,
  onSubmit,
}: {
  disabled: boolean;
  placeholder: string;
  submitLabel: string;
  actions?: ReactNode;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="note-thread-foot"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text);
        setText("");
      }}
    >
      <textarea
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="note-thread-actions">
        <button type="submit" disabled={disabled || !text.trim()}>
          {submitLabel}
        </button>
        {actions}
      </div>
    </form>
  );
}
