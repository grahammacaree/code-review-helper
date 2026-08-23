import type { ChaseCandidate, FileWiring, WiringExport, WiringImport } from "../types";

export function WiringPane({
  wiring,
  chaseCandidates,
  onChase,
  disabled,
}: {
  wiring?: FileWiring;
  chaseCandidates?: ChaseCandidate[];
  onChase?: (path: string) => void;
  disabled?: boolean;
}) {
  if (!wiring) {
    return (
      <p className="muted context-pane">
        Wiring is computed when a file is opened.
      </p>
    );
  }

  if (wiring.note && !wiring.imports.length && !wiring.exports.length) {
    return <p className="muted context-pane">{wiring.note}</p>;
  }

  return (
    <div className="context-pane">
      {wiring.note && <p className="muted">{wiring.note}</p>}
      <h3>Into this file</h3>
      {wiring.imports.length === 0 ? (
        <p>None parsed.</p>
      ) : (
        <ul className="wiring-list">
          {wiring.imports.map((imp) => (
            <ImportRow key={`${imp.line}-${imp.from}`} imp={imp} />
          ))}
        </ul>
      )}
      <h3>Out of this file</h3>
      {wiring.exports.length === 0 ? (
        <p>None parsed.</p>
      ) : (
        <ul className="wiring-list">
          {wiring.exports.map((exp) => (
            <ExportRow key={`${exp.line}-${exp.name}`} exp={exp} />
          ))}
        </ul>
      )}
      <p className="muted wiring-foot">
        Consumers listed here are other queued or covered files in this walk.
        Unchanged callers live outside this graph.
      </p>
      {chaseCandidates && chaseCandidates.length > 0 && onChase && (
        <>
          <h3>Outside this walk</h3>
          <ul className="wiring-list">
            {chaseCandidates.map((c) => (
              <li key={c.path}>
                <code title={c.path}>{shortPath(c.path)}</code>
                <span className="muted"> still imports </span>
                {c.names.map((n, i) => (
                  <span key={n}>
                    {i > 0 ? ", " : null}
                    <code>{n}</code>
                  </span>
                ))}
                <button
                  type="button"
                  className="secondary chase-btn"
                  disabled={disabled}
                  aria-label={`Chase ${c.path}`}
                  onClick={() => onChase(c.path)}
                >
                  Chase
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ImportRow({ imp }: { imp: WiringImport }) {
  const target = imp.external ? imp.from : imp.resolvedPath || imp.from;
  return (
    <li>
      <code>{formatNames(imp.names)}</code>
      <span className="muted"> from </span>
      {imp.external ? (
        <code>{target}</code>
      ) : (
        <code title={imp.from}>{shortPath(target)}</code>
      )}
      <span className="muted"> · L{imp.line}</span>
    </li>
  );
}

function ExportRow({ exp }: { exp: WiringExport }) {
  return (
    <li>
      <code>{exp.name}</code>
      <span className="muted"> · {kindLabel(exp.kind)} · L{exp.line}</span>
      {exp.consumers.length > 0 ? (
        <>
          <span className="muted"> → </span>
          {exp.consumers.map((path, i) => (
            <span key={path}>
              {i > 0 ? ", " : null}
              <code title={path}>{shortPath(path)}</code>
            </span>
          ))}
        </>
      ) : (
        <span className="muted"> · no importers in walk scope</span>
      )}
    </li>
  );
}

function formatNames(names: string[]): string {
  if (!names.length) return "(unparsed bindings)";
  if (names.length === 1 && names[0] === "*") return "(side effect)";
  if (names.includes("default")) {
    const rest = names.filter((n) => n !== "default");
    return rest.length
      ? `{ default, ${rest.join(", ")} }`
      : "default";
  }
  return `{ ${names.join(", ")} }`;
}

function kindLabel(kind: WiringExport["kind"]): string {
  switch (kind) {
    case "component":
      return "component";
    case "function":
      return "function";
    case "class":
      return "class";
    case "type":
      return "type";
    case "default":
      return "default export";
    case "reexport":
      return "re-export";
    default:
      return "export";
  }
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}
