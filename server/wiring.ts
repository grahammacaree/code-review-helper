import { dirname, join } from "node:path";
import { readWorktreeFile } from "./git.js";

/** Static import/export graph for one file within a PR walk scope. */
export type WiringSymbolKind =
  | "function"
  | "class"
  | "component"
  | "const"
  | "type"
  | "default"
  | "reexport";

export interface WiringImport {
  names: string[];
  from: string;
  resolvedPath?: string;
  external: boolean;
  line: number;
}

export interface WiringExport {
  name: string;
  kind: WiringSymbolKind;
  line: number;
  consumers: string[];
}

export interface FileWiring {
  imports: WiringImport[];
  exports: WiringExport[];
  note?: string;
}

const CODE_PATH = /\.(tsx?|jsx?|mjs|cjs)$/i;

export function isWiringCodePath(path: string): boolean {
  return CODE_PATH.test(path);
}

export async function analyzeFileWiring(opts: {
  repoPath: string;
  path: string;
  fileText?: string;
  scopePaths: string[];
  importIndex?: Map<string, WiringImport[]>;
}): Promise<FileWiring> {
  if (!isWiringCodePath(opts.path)) {
    return {
      imports: [],
      exports: [],
      note: "Import/export wiring is only parsed for JS/TS modules.",
    };
  }

  const text =
    opts.fileText ??
    (await readWorktreeFile(opts.repoPath, opts.path).catch(() => undefined));
  if (!text) {
    return {
      imports: [],
      exports: [],
      note: "Could not read this file from the worktree.",
    };
  }

  const known = new Set(opts.scopePaths);
  known.add(opts.path);
  const imports = parseImports(text, opts.path, known);
  const exports = parseExports(text);

  const index =
    opts.importIndex ??
    (await buildImportIndex({
      repoPath: opts.repoPath,
      scopePaths: opts.scopePaths,
      known,
      preload: new Map([[opts.path, text]]),
    }));

  const consumers = consumersFromIndex(opts.path, index);

  for (const exp of exports) {
    exp.consumers = consumers.get(exp.name) ?? [];
  }

  return { imports, exports };
}

/** Parse imports once per scope path; reuse across file turns in a session. */
export async function buildImportIndex(opts: {
  repoPath: string;
  scopePaths: string[];
  known: Set<string>;
  preload?: Map<string, string>;
}): Promise<Map<string, WiringImport[]>> {
  const codePaths = opts.scopePaths.filter(isWiringCodePath);
  const cache = new Map(opts.preload);
  await Promise.all(
    codePaths.map(async (path) => {
      if (cache.has(path)) return;
      try {
        cache.set(path, await readWorktreeFile(opts.repoPath, path));
      } catch {
        /* unreadable path */
      }
    }),
  );

  const index = new Map<string, WiringImport[]>();
  for (const path of codePaths) {
    const text = cache.get(path);
    if (!text) continue;
    index.set(path, parseImports(text, path, opts.known));
  }
  return index;
}

/** Compact wiring summary for the chat file card (matches skill template). */
export function formatWiringNote(w: FileWiring): string | undefined {
  if (w.note && !w.imports.length && !w.exports.length) return w.note;

  const into = w.imports
    .filter((imp) => imp.external || imp.resolvedPath)
    .slice(0, 6)
    .map((imp) => {
      const from = imp.external
        ? imp.from
        : imp.resolvedPath || imp.from;
      return `${formatNames(imp.names)} from \`${from}\``;
    });

  const out = w.exports
    .filter((exp) => exp.kind !== "reexport")
    .slice(0, 6)
    .map((exp) => {
      if (!exp.consumers.length) {
        return `\`${exp.name}\` (no importers in walk scope)`;
      }
      return `\`${exp.name}\` → ${exp.consumers.map((p) => `\`${p}\``).join(", ")}`;
    });

  const lines: string[] = [];
  lines.push(`- **Into this file:** ${into.length ? into.join("; ") : "none"}`);
  lines.push(`- **Out of this file:** ${out.length ? out.join("; ") : "none"}`);
  return lines.join("\n");
}

function consumersFromIndex(
  targetPath: string,
  index: Map<string, WiringImport[]>,
): Map<string, string[]> {
  const byName = new Map<string, Set<string>>();

  for (const [path, imports] of index) {
    if (path === targetPath) continue;
    for (const imp of imports) {
      if (imp.external || !imp.resolvedPath) continue;
      if (!pathsMatch(imp.resolvedPath, targetPath)) continue;
      for (const name of imp.names) {
        const key = name === "*" ? "default" : name;
        if (!byName.has(key)) byName.set(key, new Set());
        byName.get(key)!.add(path);
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const [name, paths] of byName) {
    out.set(name, [...paths].sort());
  }
  return out;
}

function parseImports(
  text: string,
  path: string,
  known: Set<string>,
): WiringImport[] {
  const lines = text.split("\n");
  const out: WiringImport[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const side = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (side) {
      out.push(importRow(path, side[1], ["*"], i + 1, known));
      continue;
    }
    const from = line.match(
      /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+(\w+))|(\{[^}]+\})|(\w+))\s+from\s+['"]([^'"]+)['"]/,
    );
    if (from) {
      const names = from[3]
        ? parseNamed(from[3])
        : from[4]
          ? [from[4]]
          : [from[2] || "*"];
      out.push(importRow(path, from[5], names, i + 1, known));
      continue;
    }
    const def = line.match(
      /^\s*import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
    );
    if (def) {
      out.push(
        importRow(
          path,
          def[3],
          ["default", ...parseNamed(def[2])],
          i + 1,
          known,
        ),
      );
      continue;
    }
    const req = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (req) {
      out.push(importRow(path, req[1], ["*"], i + 1, known));
    }
  }
  return out;
}

function importRow(
  path: string,
  spec: string,
  names: string[],
  line: number,
  known: Set<string>,
): WiringImport {
  const external = !spec.startsWith(".");
  const resolvedPath = external ? undefined : resolveImport(path, spec, known);
  return {
    names,
    from: spec,
    resolvedPath,
    external,
    line,
  };
}

function parseNamed(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => {
      const m = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      return m?.[2] || m?.[1];
    })
    .filter((n): n is string => Boolean(n));
}

function parseExports(text: string): WiringExport[] {
  const lines = text.split("\n");
  const out: WiringExport[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let m = line.match(
      /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/,
    );
    if (m) {
      out.push(exportRow(m[1], symbolKind(m[1], "function"), i + 1));
      continue;
    }
    m = line.match(/^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      out.push(exportRow(m[1], symbolKind(m[1], "class"), i + 1));
      continue;
    }
    m = line.match(
      /^\s*export\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    );
    if (m) {
      out.push(exportRow(m[1], symbolKind(m[1], "const"), i + 1));
      continue;
    }
    m = line.match(
      /^\s*export\s+(?:default\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/,
    );
    if (m) {
      out.push(exportRow(m[1], "type", i + 1));
      continue;
    }
    m = line.match(/^\s*export\s+\{([^}]+)\}/);
    if (m) {
      for (const name of parseNamed(m[1])) {
        out.push(exportRow(name, symbolKind(name, "const"), i + 1));
      }
      continue;
    }
    if (/^\s*export\s+default\s+/.test(line)) {
      out.push(exportRow("default", "default", i + 1));
      continue;
    }
    m = line.match(/^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      out.push(exportRow(`* from ${m[1]}`, "reexport", i + 1));
    }
  }
  return out;
}

function exportRow(
  name: string,
  kind: WiringSymbolKind,
  line: number,
): WiringExport {
  return { name, kind, line, consumers: [] };
}

function symbolKind(
  name: string,
  fallback: WiringSymbolKind,
): WiringSymbolKind {
  if (/^[A-Z]/.test(name) && fallback !== "type") return "component";
  return fallback;
}

function resolveImport(
  fromPath: string,
  spec: string,
  known: Set<string>,
): string | undefined {
  const dir = dirname(fromPath);
  const raw = join(dir, spec).replace(/\\/g, "/");
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.jsx`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
    `${raw}/index.js`,
  ];
  for (const c of candidates) {
    if (known.has(c)) return c;
  }
  for (const k of known) {
    if (stripExt(k) === stripExt(raw)) return k;
  }
  return undefined;
}

function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return stripExt(a) === stripExt(b);
}

function stripExt(path: string): string {
  return path.replace(/(\/index)?\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

function formatNames(names: string[]): string {
  if (names.length === 1 && names[0] === "*") return "(side effect)";
  if (names.includes("default")) {
    const rest = names.filter((n) => n !== "default");
    return rest.length
      ? `{ default, ${rest.join(", ")} }`
      : "default";
  }
  return `{ ${names.join(", ")} }`;
}
