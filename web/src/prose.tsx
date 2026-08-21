import type { ReactNode } from "react";

const TOKEN =
  /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\b(?:[\w.-]+\/)+[\w.-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|svg|html|d\.ts)\b)/g;

export function Prose({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={key}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ul>,
      );
      key += 1;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ol key={key}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ol>,
      );
      key += 1;
      continue;
    }
    nodes.push(<p key={key}>{inline(line.trim())}</p>);
    key += 1;
    i += 1;
  }
  return <>{nodes}</>;
}

export function PathList({
  items,
  empty = "None.",
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
  if (!items.length) return <p>None.</p>;
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
    if (raw.startsWith("**")) {
      nodes.push(<strong key={`${at}-b`}>{inline(raw.slice(2, -2))}</strong>);
    } else {
      const body = raw.startsWith("`") ? raw.slice(1, -1) : raw;
      nodes.push(<code key={`${at}-${body}`}>{body}</code>);
    }
    last = at + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
