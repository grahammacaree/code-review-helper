export function DiffPane({
  path,
  diff,
}: {
  path: string;
  diff?: string;
}) {
  if (!diff?.trim()) {
    return (
      <p className="muted">No diff for <code>{path}</code>.</p>
    );
  }

  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="code diff" aria-label={`Diff ${path}`}>
      {lines.map((line, i) => (
        <div key={i} className={diffClass(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function diffClass(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return undefined;
}
