import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { projectRoot } from "./env.js";
import { dummyArgs, functionAtLine } from "./probe.js";
import type { ProbeArgSuggestion } from "./types.js";

const execFileAsync = promisify(execFile);

const SKIP_TYPES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Map",
  "Number",
  "Object",
  "Omit",
  "Partial",
  "Pick",
  "Promise",
  "Readonly",
  "Record",
  "Set",
  "String",
]);

const TEST_GLOBS = [
  "*.test.ts",
  "*.test.tsx",
  "*.test.js",
  "*.test.jsx",
  "*.spec.ts",
  "*.spec.tsx",
  "*.spec.js",
  "*_test.py",
  "test_*.py",
];

export async function suggestArgs(opts: {
  repoPath: string;
  path: string;
  fileText: string;
  line: number;
  signal?: AbortSignal;
}): Promise<ProbeArgSuggestion> {
  const fn = functionAtLine(opts.fileText, opts.line, opts.path);
  const fallback = dummyArgs(fn?.params ?? []);
  if (!fn) {
    return {
      args: fallback,
      note: "No function found at that line; using placeholders.",
      kind: "placeholder",
    };
  }

  const testHits = await findTestHits(
    opts.repoPath,
    opts.path,
    fn.name,
    opts.signal,
  );
  const types = fn.params.flatMap(typeNames);
  const builders = unique(types.flatMap(builderNames));
  const snippets = new Map<string, string>();
  const fromCall = await sampleFromTestCalls(fn.name, testHits, snippets);
  if (fromCall !== undefined) {
    return {
      args: [fromCall, ...fallback.slice(1)],
      note: testHits[0]
        ? `Sample argument from a test (${rel(opts.repoPath, testHits[0].file)}:${testHits[0].line}).`
        : "Sample argument from a test.",
      source: testHits[0]?.file,
      kind: "test",
    };
  }

  const typeName = types[0];
  if (typeName) {
    const typeHits = await findTestHits(
      opts.repoPath,
      opts.path,
      typeName,
      opts.signal,
    );
    const fromType = await sampleFromTypeFixture(typeName, typeHits, snippets);
    if (fromType !== undefined) {
      const hit = typeHits[0];
      return {
        args: [fromType, ...fallback.slice(1)],
        note: hit
          ? `Sample ${typeName} from ${rel(opts.repoPath, hit.file)}:${hit.line}.`
          : `Sample ${typeName} from a test fixture.`,
        source: hit?.file,
        kind: "test",
      };
    }
  }

  let fixtureMiss: string | undefined;
  const nameAlt = builders.map(escapeRe).join("|");
  const exportHits =
    builders.length === 0
      ? []
      : await grep(
          opts.repoPath,
          `export[[:space:]]+(async[[:space:]]+)?(function|const)[[:space:]]+(${nameAlt})([^A-Za-z0-9_]|$)`,
          ["*.ts", "*.tsx", "*.js", "*.jsx"],
          opts.signal,
        );
  const builderCalls =
    builders.length === 0
      ? []
      : await grep(
          opts.repoPath,
          `(${nameAlt})[[:space:]]*\\(`,
          TEST_GLOBS,
          opts.signal,
        );
  for (const name of builders) {
    const named = exportHits.filter((h) => exportName(h.text) === name);
    const hit = named.find((h) => /fixture/i.test(h.file)) ?? named[0];
    if (!hit) continue;
    const callArgs = await builderCallArgs(name, builderCalls, snippets);
    const value = await evalExport(hit.file, name, callArgs, opts.signal);
    if (value === undefined || value === null) {
      fixtureMiss = `${name}() in ${rel(opts.repoPath, hit.file)}`;
      continue;
    }
    return {
      args: [value, ...fallback.slice(1)],
      note: testHits.length
        ? `No inline test argument for ${fn.name}; loaded ${name}() from ${rel(opts.repoPath, hit.file)}.`
        : `No tests call ${fn.name}. Loaded ${name}() from ${rel(opts.repoPath, hit.file)}.`,
      source: hit.file,
      kind: "fixture",
    };
  }

  const typeLabel = types[0] ?? "this argument";
  if (fixtureMiss) {
    return {
      args: fallback,
      note: `No tests call ${fn.name}. Found ${fixtureMiss} but could not evaluate it in isolation. Placeholders only (${typeLabel} is ${JSON.stringify(fallback[0] ?? null)}).`,
      kind: "placeholder",
    };
  }
  if (testHits.length) {
    return {
      args: fallback,
      note: `Tests mention ${fn.name} (${rel(opts.repoPath, testHits[0].file)}:${testHits[0].line}) but no sample object was extracted. Placeholders only (${typeLabel} is ${JSON.stringify(fallback[0] ?? null)}).`,
      source: testHits[0].file,
      kind: "placeholder",
    };
  }
  return {
    args: fallback,
    note: `No tests call ${fn.name}, and no fixture builder was found for ${typeLabel}. Placeholders only (${typeLabel} is ${JSON.stringify(fallback[0] ?? null)}).`,
    kind: "placeholder",
  };
}

function typeNames(param: string): string[] {
  const typePart = param.split("=")[0].split(":").slice(1).join(":");
  return [...typePart.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)]
    .map((m) => m[1])
    .filter((t) => !SKIP_TYPES.has(t));
}

function builderNames(type: string): string[] {
  const stripped = type.replace(/^Resolved/, "").replace(/^I(?=[A-Z])/, "");
  const names: string[] = [];
  for (const t of unique([type, stripped])) {
    names.push(`buildFixture${t}`, `build${t}`, `make${t}`, `create${t}`);
    names.push(`${t[0].toLowerCase()}${t.slice(1)}Fixture`);
  }
  return unique(names);
}

interface GrepHit {
  file: string;
  line: number;
  text: string;
}

async function findTestHits(
  repoPath: string,
  srcPath: string,
  needle: string,
  signal?: AbortSignal,
): Promise<GrepHit[]> {
  const pattern = `\\b${escapeRe(needle)}\\b`;
  const globHits = await grep(repoPath, pattern, TEST_GLOBS, signal);
  const scoped =
    globHits.length > 0
      ? globHits
      : (await grep(repoPath, pattern, [], signal)).filter((h) =>
          isTestPath(h.file),
        );
  const local = await hitsInFiles(colocatedTests(repoPath, srcPath), needle);
  return uniqueHits([...local, ...scoped]);
}

function isTestPath(file: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes("/__tests__/")
  );
}

function colocatedTests(repoPath: string, srcPath: string): string[] {
  const dir = dirname(join(repoPath, srcPath));
  const stem = basename(srcPath).replace(/\.[^.]+$/, "");
  return [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"].flatMap((ext) => [
    join(dir, `${stem}${ext}`),
    join(dir, "__tests__", `${stem}${ext}`),
  ]);
}

async function hitsInFiles(
  files: string[],
  needle: string,
): Promise<GrepHit[]> {
  const re = new RegExp(`\\b${escapeRe(needle)}\\b`);
  const out: GrepHit[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) {
        out.push({ file, line: i + 1, text: line });
      }
    });
  }
  return out;
}

function uniqueHits(hits: GrepHit[]): GrepHit[] {
  const seen = new Set<string>();
  const out: GrepHit[] = [];
  for (const hit of hits) {
    const key = `${hit.file}:${hit.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function exportName(line: string): string | undefined {
  return line.match(
    /export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/,
  )?.[1];
}

async function grep(
  repoPath: string,
  pattern: string,
  globs: string[],
  signal?: AbortSignal,
): Promise<GrepHit[]> {
  try {
    const argv = ["grep", "-n", "-E", "-I", pattern];
    if (globs.length > 0) argv.push("--", ...globs);
    const { stdout } = await execFileAsync("git", argv, {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      signal,
    });
    return parseGrep(repoPath, stdout);
  } catch (err) {
    if (signal?.aborted) throw err;
    const e = err as { code?: number | string; stdout?: string };
    if (e.code === 1) return [];
    if (typeof e.stdout === "string" && e.stdout) {
      return parseGrep(repoPath, e.stdout);
    }
    return [];
  }
}

function parseGrep(repoPath: string, stdout: string): GrepHit[] {
  const out: GrepHit[] = [];
  for (const raw of stdout.split("\n")) {
    const m = raw.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    out.push({
      file: join(repoPath, m[1]),
      line: Number(m[2]),
      text: m[3],
    });
  }
  return out;
}

async function sampleFromTestCalls(
  fnName: string,
  hits: GrepHit[],
  snippets: Map<string, string>,
): Promise<unknown> {
  for (const hit of hits.slice(0, 12)) {
    const block = await snippet(hit.file, hit.line, snippets);
    const arg = firstArg(block, fnName);
    if (!arg || arg === "null" || arg === "undefined") continue;
    if (
      /^[{\[]/.test(arg) ||
      /^['"`]/.test(arg) ||
      /^-?\d/.test(arg) ||
      arg === "true" ||
      arg === "false"
    ) {
      const value = evalLiteral(arg);
      if (value !== undefined && value !== null) return value;
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      const value = await resolveIdent(hit.file, arg, snippets);
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

async function builderCallArgs(
  name: string,
  hits: GrepHit[],
  snippets: Map<string, string>,
): Promise<string> {
  let fallbackObj: string | undefined;
  for (const hit of hits.slice(0, 8)) {
    const block = await snippet(hit.file, hit.line, snippets);
    const arg = firstArg(block, name);
    if (!arg || !arg.startsWith("{")) continue;
    if (!/no-latest-post|empty|missing/.test(arg)) return arg;
    fallbackObj ??= arg;
  }
  return fallbackObj ?? "{}";
}

async function snippet(
  file: string,
  line: number,
  cache: Map<string, string>,
): Promise<string> {
  const key = `${file}:${line}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    const from = Math.max(0, line - 1);
    const slice = lines.slice(from, Math.min(lines.length, from + 40)).join("\n");
    cache.set(key, slice);
    return slice;
  } catch {
    cache.set(key, "");
    return "";
  }
}

async function fileContents(
  file: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = `file:${file}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const text = await readFile(file, "utf8");
    cache.set(key, text);
    return text;
  } catch {
    cache.set(key, "");
    return "";
  }
}

async function resolveIdent(
  file: string,
  name: string,
  cache: Map<string, string>,
): Promise<unknown> {
  const text = await fileContents(file, cache);
  return objectAfterAssignment(text, name);
}

async function sampleFromTypeFixture(
  typeName: string,
  hits: GrepHit[],
  snippets: Map<string, string>,
): Promise<unknown> {
  for (const hit of hits.slice(0, 20)) {
    const text = await fileContents(hit.file, snippets);
    const value = objectTypedAs(text, typeName);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function objectTypedAs(text: string, typeName: string): unknown {
  const re = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${escapeRe(typeName)}\\s*=\\s*`,
  );
  const m = re.exec(text);
  if (!m || m.index === undefined) return undefined;
  return objectAt(text, m.index + m[0].length);
}

function objectAfterAssignment(text: string, name: string): unknown {
  const re = new RegExp(
    `(?:const|let|var)\\s+${escapeRe(name)}(?:\\s*:\\s*[^=]+)?\\s*=\\s*`,
  );
  const m = re.exec(text);
  if (!m || m.index === undefined) return undefined;
  return objectAt(text, m.index + m[0].length);
}

function objectAt(text: string, start: number): unknown {
  const ch = text[start];
  if (ch !== "{" && ch !== "[") return undefined;
  const close = ch === "{" ? "}" : "]";
  const inner = takeBalanced(text, start, ch, close);
  if (inner === undefined) return undefined;
  if (/\.\.\./.test(inner)) return undefined;
  return evalLiteral(`${ch}${inner}${close}`);
}

function firstArg(src: string, name: string): string | undefined {
  const idx = src.search(new RegExp(`\\b${escapeRe(name)}\\s*\\(`));
  if (idx < 0) return undefined;
  const open = src.indexOf("(", idx);
  if (open < 0) return undefined;
  const inner = takeBalanced(src, open, "(", ")");
  if (inner === undefined) return undefined;
  const trimmed = inner.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{")) {
    const start = src.indexOf("{", open);
    const obj = start >= 0 ? takeBalanced(src, start, "{", "}") : undefined;
    return obj !== undefined ? `{${obj}}` : undefined;
  }
  if (trimmed.startsWith("[")) {
    const start = src.indexOf("[", open);
    const arr = start >= 0 ? takeBalanced(src, start, "[", "]") : undefined;
    return arr !== undefined ? `[${arr}]` : undefined;
  }
  const token = trimmed.split(",")[0]?.trim();
  return token || undefined;
}

function takeBalanced(
  src: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): string | undefined {
  if (src[openIdx] !== openCh) return undefined;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

function evalLiteral(src: string): unknown {
  if (/=>|\bfunction\b|\bimport\b|\brequire\b/.test(src)) return undefined;
  try {
    return Function(`"use strict"; return (${src});`)();
  } catch {
    return undefined;
  }
}

async function evalExport(
  absFile: string,
  exportName: string,
  callArgs: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "crw-sample-"));
  const harness = join(dir, "sample.mts");
  const pkg = nearestPackage(absFile);
  const body = `const mod = await import(${JSON.stringify(pathToFileURL(absFile).href)});
const fn = mod[${JSON.stringify(exportName)}];
if (typeof fn !== "function") throw new Error(${JSON.stringify(exportName)} + " is not a function");
const value = await fn(${callArgs});
const seen = new WeakSet();
const json = JSON.stringify(value, (_k, v) => {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function") return "[function]";
  if (v && typeof v === "object") {
    if (seen.has(v)) return "[circular]";
    seen.add(v);
  }
  return v;
});
console.log("__PROBE__" + json);
`;
  await writeFile(harness, body, "utf8");
  const tsx = join(projectRoot(), "node_modules/tsx/dist/cli.mjs");
  const tsconfig = join(pkg, "tsconfig.json");
  const argv = existsSync(tsconfig)
    ? [tsx, "--tsconfig", tsconfig, harness]
    : [tsx, harness];
  try {
    const { stdout } = await execFileAsync(process.execPath, argv, {
      cwd: pkg,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_NO_WARNINGS: "1", HOME: homedir() },
      signal,
    });
    return parseEval(stdout);
  } catch (err) {
    if (signal?.aborted) throw err;
    const e = err as { stdout?: string };
    return parseEval(e.stdout ?? "");
  }
}

function parseEval(stdout: string): unknown {
  const marker = stdout.lastIndexOf("__PROBE__");
  if (marker < 0) return undefined;
  const json = stdout.slice(marker + "__PROBE__".length).trim().split("\n")[0];
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

function nearestPackage(file: string): string {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dirname(file);
    dir = parent;
  }
}

function rel(repoPath: string, abs: string): string {
  return relative(repoPath, abs) || abs;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
