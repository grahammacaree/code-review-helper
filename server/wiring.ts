import { dirname, join } from "node:path";
import {
  loadAliasMap,
  normalizeModulePath,
  resolveAliasCandidates,
  type AliasMap,
} from "./aliases.js";
import { blobContainsHit, blobReaderFor } from "./blobBatch.js";
import { gitGrepFiles, readWorktreeFile } from "./git.js";
import { escapeRe } from "./strings.js";

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
const CODE_GLOBS = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"];

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

  const aliases = await loadAliasMap(opts.repoPath);
  const known = new Set(opts.scopePaths);
  known.add(opts.path);
  const imports = parseImports(text, opts.path, known, aliases);
  const exports = parseExports(text);

  const index =
    opts.importIndex ??
    (await buildImportIndex({
      repoPath: opts.repoPath,
      scopePaths: opts.scopePaths,
      known,
      aliases,
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
  aliases?: AliasMap;
  preload?: Map<string, string>;
}): Promise<Map<string, WiringImport[]>> {
  const aliases = opts.aliases ?? (await loadAliasMap(opts.repoPath));
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
    index.set(path, parseImports(text, path, opts.known, aliases));
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

export interface OutsideImporter {
  path: string;
  names: string[];
  /** How the binding was established. */
  via?: "resolved" | "bound" | "barrel";
  from?: string;
}

const MAX_CHASE_GREP = 120;
/** How many outside importers to collect before TypeSafe ranks the offer. */
const MAX_CHASE_CANDIDATES = 20;
/** Default offer size when ranking is off or declines. */
export const MAX_CHASE_OFFER = 3;

/**
 * Unchanged files (outside walk scope) that import this module.
 * Greps export *symbols* and the module stem, resolves `@/` aliases, and
 * follows one barrel re-export hop. Used for opt-in chase + Wiring "outside".
 */
export async function findOutsideImporters(opts: {
  repoPath: string;
  targetPath: string;
  exportNames: string[];
  exclude: Set<string>;
  signal?: AbortSignal;
  /** Cap on returned importers (default 20 — rank down to 3 for the chip). */
  limit?: number;
}): Promise<OutsideImporter[]> {
  if (!isWiringCodePath(opts.targetPath) || opts.exportNames.length === 0) {
    return [];
  }
  const limit = opts.limit ?? MAX_CHASE_CANDIDATES;
  const aliases = await loadAliasMap(opts.repoPath);
  const targetNorm = normalizeModulePath(opts.targetPath);
  const exportSet = new Set(opts.exportNames.filter((n) => n !== "default"));

  const patterns = searchPatterns(opts.targetPath, opts.exportNames);
  const hitSet = new Set<string>();
  for (const pattern of patterns) {
    const hits = await gitGrepFiles(
      opts.repoPath,
      pattern,
      CODE_GLOBS,
      opts.signal,
    );
    for (const h of hits.slice(0, MAX_CHASE_GREP)) hitSet.add(h);
  }

  const known = new Set([opts.targetPath]);
  const out: OutsideImporter[] = [];
  const barrels: { path: string; names: string[] }[] = [];
  const ambiguous: {
    path: string;
    from: string;
    names: string[];
    resolvedPath?: string;
  }[] = [];

  for (const path of hitSet) {
    if (path === opts.targetPath || opts.exclude.has(path)) continue;
    if (!isWiringCodePath(path)) continue;
    let text: string;
    try {
      const blob = await blobReaderFor(opts.repoPath).read(path);
      if (blob == null) continue;
      text = blob;
    } catch {
      continue;
    }
    // Hydrate check: at least one export name (or module stem) still in blob.
    const stem = opts.targetPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
    const needles = [...opts.exportNames, stem].filter(Boolean);
    if (!needles.some((n) => blobContainsHit(text, n))) continue;
    const imports = parseImports(text, path, known, aliases);
    const names = new Set<string>();
    let via: OutsideImporter["via"] = "resolved";
    let fromSpec: string | undefined;

    for (const imp of imports) {
      const bound = bindsToTarget(imp, targetNorm);
      if (bound === "yes") {
        for (const n of imp.names) {
          if (n === "*") {
            for (const exp of opts.exportNames) names.add(exp);
          } else if (exportSet.has(n) || n === "default") {
            names.add(n);
          }
        }
        fromSpec = imp.from;
      } else if (bound === "maybe") {
        const overlap = imp.names.filter(
          (n) => n === "*" || exportSet.has(n) || n === "default",
        );
        if (overlap.length) {
          ambiguous.push({
            path,
            from: imp.from,
            names: overlap.includes("*") ? [...opts.exportNames] : overlap,
            resolvedPath: imp.resolvedPath,
          });
        }
      }
    }

    // One hop: this file re-exports our symbols from a path that binds to us.
    const reexports = parseReexports(text);
    for (const re of reexports) {
      const fake: WiringImport = {
        names: re.names,
        from: re.from,
        resolvedPath: resolveSpec(path, re.from, known, aliases),
        external: !re.from.startsWith("."),
        line: re.line,
      };
      if (bindsToTarget(fake, targetNorm) === "yes") {
        const exported = re.names.includes("*")
          ? [...opts.exportNames]
          : re.names.filter((n) => exportSet.has(n) || n === "default");
        if (exported.length) {
          barrels.push({ path, names: exported });
        }
      }
    }

    if (names.size) {
      out.push({
        path,
        names: [...names],
        via,
        from: fromSpec,
      });
    }
  }

  // Second wave: who imports the barrels that re-export us?
  for (const barrel of barrels.slice(0, 6)) {
    if (out.length >= limit) break;
    const stem = importStem(barrel.path);
    const hits = await gitGrepFiles(
      opts.repoPath,
      wordPattern(stem),
      CODE_GLOBS,
      opts.signal,
    );
    for (const path of hits.slice(0, 40)) {
      if (out.length >= limit) break;
      if (
        path === opts.targetPath ||
        path === barrel.path ||
        opts.exclude.has(path) ||
        out.some((o) => o.path === path)
      ) {
        continue;
      }
      if (!isWiringCodePath(path)) continue;
      let text: string;
      try {
        const blob = await blobReaderFor(opts.repoPath).read(path);
        if (blob == null) continue;
        text = blob;
      } catch {
        continue;
      }
      const imports = parseImports(text, path, known, aliases);
      const names = new Set<string>();
      for (const imp of imports) {
        if (bindsToTarget(imp, normalizeModulePath(barrel.path)) !== "yes") {
          continue;
        }
        for (const n of imp.names) {
          if (n === "*" || barrel.names.includes(n)) {
            for (const exp of barrel.names) names.add(exp);
          }
        }
      }
      if (names.size) {
        out.push({
          path,
          names: [...names],
          via: "barrel",
          from: barrel.path,
        });
      }
    }
  }

  // TypeSafe bind for ambiguous alias / same-name hits.
  if (ambiguous.length && out.length < limit) {
    const { bindOutsideImports } = await import("./judgments/bind.js");
    const bound = await bindOutsideImports({
      targetPath: opts.targetPath,
      exportNames: opts.exportNames,
      ambiguous,
    });
    if (bound) {
      for (const b of bound) {
        if (out.some((o) => o.path === b.path)) continue;
        out.push({
          path: b.path,
          names: b.names,
          via: "bound",
          from: b.from,
        });
      }
    }
  }

  return out.slice(0, limit);
}

function searchPatterns(targetPath: string, exportNames: string[]): string[] {
  const patterns = new Set<string>();
  const stem = importStem(targetPath);
  if (stem) patterns.add(wordPattern(stem));
  for (const name of exportNames) {
    if (name === "default" || name.length < 2) continue;
    patterns.add(wordPattern(name));
  }
  return [...patterns].slice(0, 8);
}

/** POSIX ERE word edge — git grep has no \\b. */
function wordPattern(needle: string): string {
  const edge = "[^A-Za-z0-9_$]";
  return `(^|${edge})${escapeRe(needle)}(${edge}|$)`;
}

function bindsToTarget(
  imp: WiringImport,
  targetNorm: string,
): "yes" | "no" | "maybe" {
  if (
    imp.resolvedPath &&
    normalizeModulePath(imp.resolvedPath) === targetNorm
  ) {
    return "yes";
  }
  if (imp.from.startsWith(".")) return "no";
  // Bare package (react, lodash) — not our module.
  if (!imp.from.startsWith("@") && !imp.from.includes("/")) return "no";
  // Alias or deep path that did not resolve to the target — may still be a
  // barrel or an undeclared path mapping.
  return "maybe";
}

function importStem(path: string): string {
  const base = path.split("/").pop() || "";
  const noExt = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
  if (noExt === "index") {
    const parts = path.split("/").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2]! : noExt;
  }
  return noExt;
}

function consumersFromIndex(
  targetPath: string,
  index: Map<string, WiringImport[]>,
): Map<string, string[]> {
  const byName = new Map<string, Set<string>>();

  for (const [path, imports] of index) {
    if (path === targetPath) continue;
    for (const imp of imports) {
      if (!imp.resolvedPath) continue;
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
  aliases: AliasMap,
): WiringImport[] {
  const lines = text.split("\n");
  const out: WiringImport[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const side = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (side) {
      out.push(importRow(path, side[1], ["*"], i + 1, known, aliases));
      i += 1;
      continue;
    }
    if (!/^\s*import\b/.test(line)) {
      i += 1;
      continue;
    }

    let stmt = line;
    let end = i;
    if (!/\sfrom\s+['"]/.test(line)) {
      while (end + 1 < lines.length && !/\sfrom\s+['"]/.test(stmt)) {
        end += 1;
        stmt += ` ${lines[end].trim()}`;
      }
    }
    const startLine = i + 1;

    const from = stmt.match(
      /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+(\w+))|(\{[^}]+\})|(\w+))\s+from\s+['"]([^'"]+)['"]/,
    );
    if (from) {
      const names = from[3]
        ? parseNamed(from[3])
        : from[4]
          ? [from[4]]
          : [from[2] || "*"];
      out.push(importRow(path, from[5], names, startLine, known, aliases));
    } else {
      const def = stmt.match(
        /^\s*import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
      );
      if (def) {
        out.push(
          importRow(
            path,
            def[3],
            ["default", ...parseNamed(def[2])],
            startLine,
            known,
            aliases,
          ),
        );
      }
    }

    i = end + 1;
  }

  for (let j = 0; j < lines.length; j += 1) {
    const req = lines[j].match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (req) {
      out.push(importRow(path, req[1], ["*"], j + 1, known, aliases));
    }
  }
  return out;
}

function parseReexports(
  text: string,
): { from: string; names: string[]; line: number }[] {
  const out: { from: string; names: string[]; line: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const star = lines[i].match(/^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (star) {
      out.push({ from: star[1], names: ["*"], line: i + 1 });
      continue;
    }
    const named = lines[i].match(
      /^\s*export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
    );
    if (named) {
      out.push({ from: named[2], names: parseNamed(named[1]), line: i + 1 });
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
  aliases: AliasMap,
): WiringImport {
  const resolvedPath = resolveSpec(path, spec, known, aliases);
  const external = !spec.startsWith(".") && !resolvedPath;
  return {
    names,
    from: spec,
    resolvedPath,
    external,
    line,
  };
}

function resolveSpec(
  fromPath: string,
  spec: string,
  known: Set<string>,
  aliases: AliasMap,
): string | undefined {
  const candidates = spec.startsWith(".")
    ? [join(dirname(fromPath), spec).replace(/\\/g, "/")]
    : resolveAliasCandidates(fromPath, spec, aliases);
  if (!candidates.length) return undefined;

  for (const raw of candidates) {
    for (const k of known) {
      if (normalizeModulePath(k) === normalizeModulePath(raw)) return k;
    }
  }
  // Outside the known walk set: still return a concrete path so callers can
  // match against the changed module by normalized form.
  return candidates[0];
}

function parseNamed(raw: string): string[] {
  const inner = raw
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => parseImportBinding(part.trim()))
    .filter((n): n is string => Boolean(n));
}

function parseImportBinding(part: string): string | undefined {
  if (!part) return undefined;
  const m = part.match(/^(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/);
  return m?.[2] || m?.[1];
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

function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeModulePath(a) === normalizeModulePath(b);
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
