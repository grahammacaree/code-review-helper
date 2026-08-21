import type { ReactNode } from "react";

const TOKEN =
  /(`[^`]+`)|(\b(?:[\w.-]+\/)+[\w.-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|svg|html|d\.ts)\b)/g;

export function Prose({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").map((line) => line.trim());
  const bullets = lines.filter(Boolean);
  if (bullets.length > 1 && bullets.every((line) => /^[-*•]/.test(line))) {
    return (
      <ul>
        {bullets.map((line) => (
          <li key={line}>{inline(line.replace(/^[-*•]\s*/, ""))}</li>
        ))}
      </ul>
    );
  }
  if (bullets.length > 1 && bullets.every((line) => /^\d+[.)]/.test(line))) {
    return (
      <ol>
        {bullets.map((line) => (
          <li key={line}>{inline(line.replace(/^\d+[.)]\s*/, ""))}</li>
        ))}
      </ol>
    );
  }
  return (
    <>
      {lines.filter(Boolean).map((line, i) => (
        <p key={i}>{inline(line)}</p>
      ))}
    </>
  );
}

export function PathList({
  items,
  empty = "none",
}: {
  items: string[];
  empty?: string;
}) {
  if (!items.length) return <p>{empty}</p>;
  return (
    <ul>
      {items.map((path) => (
        <li key={path}>
          <code>{path}</code>
        </li>
      ))}
    </ul>
  );
}

export function NoteList({ items }: { items: string[] }) {
  if (!items.length) return <p>none</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{inline(item)}</li>
      ))}
    </ul>
  );
}

export function parseLinkField(links: string): {
  covered: string[];
  upcoming: string[];
} {
  const match = /already covered:\s*(.*?)\s*;\s*upcoming:\s*(.*)/is.exec(
    links,
  );
  if (!match) return { covered: [], upcoming: [] };
  return {
    covered: splitComma(match[1]),
    upcoming: splitComma(match[2]),
  };
}

function splitComma(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return [];
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const raw = match[0];
    const body = raw.startsWith("`") ? raw.slice(1, -1) : raw;
    nodes.push(<code key={`${at}-${body}`}>{body}</code>);
    last = at + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
