import type { Annotation, SessionSnapshot } from "./types";

/** Markdown review notes for clipboard / paste into a GH review. */
export function reviewNotesMarkdown(session: SessionSnapshot): string {
  const title =
    session.prUrl ||
    (session.prRef ? `PR ${session.prRef}` : "PR walkthrough");
  const lines: string[] = [`# Review notes — ${title}`, ""];

  if (session.prUrl) lines.push(`- PR: ${session.prUrl}`);
  lines.push(`- Repo: \`${session.repoPath}\``);
  if (session.covered.length) {
    lines.push(`- Files walked: ${session.covered.length}`);
  }
  lines.push("");

  const uh = splitLines(session.wrapup?.lingeringUhOhs).filter(
    (line) => !/^No lingering/i.test(line),
  );
  lines.push("## Lingering uh-ohs", "");
  if (uh.length) {
    for (const line of uh) lines.push(`- ${line}`);
  } else {
    lines.push("_None captured._");
  }
  lines.push("");

  const forks = splitLines(session.wrapup?.designForks);
  if (forks.length) {
    lines.push("## Design forks", "");
    for (const line of forks) lines.push(`- ${line}`);
    lines.push("");
  }

  const open = session.annotations.filter((a) => a.status === "open");
  const resolved = session.annotations.filter((a) => a.status === "resolved");
  lines.push("## Notes", "");
  if (!session.annotations.length) {
    lines.push("_No inline questions or comments._", "");
  } else {
    if (open.length) {
      lines.push("### Open", "");
      for (const a of open) lines.push(...formatAnnotation(a), "");
    }
    if (resolved.length) {
      lines.push("### Resolved", "");
      for (const a of resolved) lines.push(...formatAnnotation(a), "");
    }
  }

  if (session.covered.length) {
    lines.push("## Files covered", "");
    for (const path of session.covered) lines.push(`- \`${path}\``);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function formatAnnotation(a: Annotation): string[] {
  const range =
    a.startLine === a.endLine
      ? `L${a.startLine}`
      : `L${a.startLine}–L${a.endLine}`;
  const head = `- **${a.kind}** \`${a.path}\` ${range} (${a.status})`;
  const out = [head];
  if (a.selectedText.trim()) {
    out.push(`  > ${a.selectedText.trim().replace(/\n/g, "\n  > ")}`);
  }
  out.push(`  ${a.body.trim()}`);
  for (const reply of a.replies) {
    const who = reply.role === "assistant" ? "assistant" : "you";
    out.push(`  - _${who}:_ ${reply.text.trim()}`);
  }
  return out;
}

function splitLines(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
