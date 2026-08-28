import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { projectRoot } from "./env.js";
import { balanced } from "./strings.js";
import type { ProbeResult } from "./types.js";

const execFileAsync = promisify(execFile);

// Header only: parameters can run over many lines, so they are read by
// balancing the parentheses rather than matched here.
const JS_FN =
  /^(\s*)(export\s+default\s+|export\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/;
const JS_ARROW =
  /^(\s*)(export\s+default\s+|export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\(/;
const PY_DEF = /^(\s*)(async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/;

export interface FnBlock {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  language: "js" | "ts" | "py" | "unknown";
  params: string[];
  header: string;
  source: string;
}

export function languageFor(path: string): FnBlock["language"] {
  if (/\.tsx?$/.test(path)) return "ts";
  if (/\.jsx?$/.test(path) || /\.mjs$/.test(path) || /\.cjs$/.test(path)) {
    return "js";
  }
  if (/\.py$/.test(path)) return "py";
  return "unknown";
}

export function functionAtLine(text: string, line: number, path: string): FnBlock | undefined {
  const lines = text.split("\n");
  if (line < 1 || line > lines.length) return undefined;
  const language = languageFor(path);
  if (language === "py") return pythonAt(lines, line);
  if (language === "unknown") return undefined;
  return jsAt(lines, line, language);
}

export function dummyArgs(params: string[]): unknown[] {
  return params.filter((p) => p !== "this").map((p) => dummyFor(p));
}

function dummyFor(raw: string): unknown {
  const name = raw.split("=")[0].split(":")[0].replace(/^\.\.\./, "").trim();
  const lower = name.toLowerCase();
  if (!name || name === "_") return null;
  if (/^(n|i|j|k|count|index|len|size|limit|offset|port)$/.test(lower)) return 0;
  if (/id$/.test(lower) && !/uuid/.test(lower)) return 1;
  if (/^(s|str|string|name|path|key|msg|message|url|text|query)$/.test(lower)) {
    return "";
  }
  if (
    /^(ok|flag|enabled|disabled)$/.test(lower) ||
    /^(is|has|should|can)[A-Z]/.test(name)
  ) {
    return false;
  }
  if (/list|arr|items|ids/.test(lower)) return [];
  if (/opt|cfg|config|opts|options|props|ctx|context|req|res|obj/.test(lower)) {
    return {};
  }
  return null;
}

function parseParams(raw: string): string[] {
  return splitParams(raw)
    .map((p) => p.trim())
    .filter((p) => p && p !== "this" && p !== "self" && p !== "cls");
}

/** Parameter text between the balanced parentheses opening at the header. */
function paramsAt(lines: string[], headerIdx: number, afterCol: number): string {
  const src = lines
    .slice(headerIdx, Math.min(lines.length, headerIdx + 40))
    .join("\n");
  const open = src.indexOf("(", Math.max(0, afterCol - 1));
  if (open < 0) return "";
  return balanced(src, open, "(", ")") ?? "";
}

/** Commas inside an object type or default value do not start a parameter. */
function splitParams(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  out.push(raw.slice(start));
  return out;
}


function jsAt(
  lines: string[],
  line: number,
  language: "js" | "ts",
): FnBlock | undefined {
  let headerIdx = -1;
  let match: RegExpMatchArray | null = null;
  let kind: "fn" | "arrow" = "fn";
  for (let i = Math.max(0, line - 1); i >= 0; i -= 1) {
    const fn = lines[i].match(JS_FN);
    const arrow = lines[i].match(JS_ARROW);
    if (fn) {
      headerIdx = i;
      match = fn;
      kind = "fn";
      break;
    }
    if (arrow) {
      headerIdx = i;
      match = arrow;
      kind = "arrow";
      break;
    }
  }
  if (headerIdx < 0 || !match) return undefined;
  const end = jsEnd(lines, headerIdx);
  if (line < headerIdx + 1 || line > end) return undefined;
  const params = parseParams(paramsAt(lines, headerIdx, match[0].length));
  return {
    name: match[4],
    startLine: headerIdx + 1,
    endLine: end,
    exported: Boolean(match[2]),
    language,
    params,
    header: lines[headerIdx].trim(),
    source: lines.slice(headerIdx, end).join("\n"),
  };
}

function jsEnd(lines: string[], headerIdx: number): number {
  let depth = 0;
  let seen = false;
  for (let i = headerIdx; i < lines.length; i += 1) {
    const line = lines[i].replace(/\/\/.*$/, "");
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        seen = true;
      } else if (ch === "}") {
        depth -= 1;
        if (seen && depth <= 0) return i + 1;
      }
    }
    if (!seen && line.includes("=>") && !line.includes("{") && line.trim().endsWith(";")) {
      return i + 1;
    }
  }
  return Math.min(lines.length, headerIdx + 80);
}

function pythonAt(lines: string[], line: number): FnBlock | undefined {
  let headerIdx = -1;
  let match: RegExpMatchArray | null = null;
  for (let i = Math.max(0, line - 1); i >= 0; i -= 1) {
    const m = lines[i].match(PY_DEF);
    if (m) {
      headerIdx = i;
      match = m;
      break;
    }
  }
  if (headerIdx < 0 || !match) return undefined;
  const indent = match[1].length;
  let end = headerIdx + 1;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) {
      end = i + 1;
      continue;
    }
    const lead = raw.match(/^(\s*)/)?.[1].length ?? 0;
    if (lead <= indent) break;
    end = i + 1;
  }
  if (line < headerIdx + 1 || line > end) return undefined;
  return {
    name: match[3],
    startLine: headerIdx + 1,
    endLine: end,
    exported: true,
    language: "py",
    params: parseParams(match[4]),
    header: lines[headerIdx].trim(),
    source: lines.slice(headerIdx, end).join("\n"),
  };
}

/** Stable across edits, because the range on disk does not move. */
export function probeId(path: string, startLine: number): string {
  return `${path}:${startLine}`;
}

export async function runFunction(opts: {
  repoPath: string;
  path: string;
  fileText: string;
  line: number;
  args: unknown[];
  /** Edited function source. Runs instead of the version on disk. */
  source?: string;
}): Promise<ProbeResult> {
  const edited = opts.source?.trim() ? opts.source : undefined;
  const onDisk = functionAtLine(opts.fileText, opts.line, opts.path);
  // Name and params come from what will actually run; the range stays the one
  // on disk, because that is what the edit replaces.
  const fn = edited
    ? functionAtLine(edited, firstBodyLine(edited), opts.path)
    : onDisk;
  if (!fn || !onDisk) {
    return {
      id: probeId(opts.path, opts.line),
      name: "?",
      path: opts.path,
      startLine: opts.line,
      endLine: opts.line,
      exported: false,
      language: languageFor(opts.path),
      params: [],
      header: "",
      args: opts.args,
      error: "No function found at that line (JS/TS/Python only).",
    };
  }
  const abs = join(opts.repoPath, opts.path);
  const base: ProbeResult = {
    id: probeId(opts.path, onDisk.startLine),
    name: fn.name,
    path: opts.path,
    startLine: onDisk.startLine,
    endLine: onDisk.endLine,
    exported: fn.exported,
    language: fn.language,
    params: fn.params,
    header: fn.header,
    args: opts.args,
    source: edited ?? fn.source,
  };
  try {
    if (edited) {
      return {
        ...base,
        ...(await runEdited({
          abs,
          repoPath: opts.repoPath,
          fn,
          args: opts.args,
          module: spliceLines(
            opts.fileText,
            onDisk.startLine,
            onDisk.endLine,
            edited,
          ),
        })),
      };
    }
    if (fn.language === "py") {
      return { ...base, ...(await runPython(abs, opts.repoPath, fn, opts.args)) };
    }
    return { ...base, ...(await runJs(abs, opts.repoPath, fn, opts.args)) };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** First line of the edited text that looks like a function header. */
function firstBodyLine(source: string): number {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (JS_FN.test(lines[i]) || JS_ARROW.test(lines[i]) || PY_DEF.test(lines[i])) {
      return i + 1;
    }
  }
  return 1;
}

/** The file with the function's lines swapped for the edited version. */
function spliceLines(
  fileText: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const lines = fileText.split("\n");
  return [
    ...lines.slice(0, startLine - 1),
    replacement,
    ...lines.slice(endLine),
  ].join("\n");
}

/**
 * Edited source runs from a scratch copy of the whole file, written beside the
 * original so its imports and siblings still resolve. The copy is always
 * removed again, even when the run throws.
 */
async function runEdited({
  abs,
  repoPath,
  fn,
  args,
  module,
}: {
  abs: string;
  repoPath: string;
  fn: FnBlock;
  args: unknown[];
  module: string;
}): Promise<{ result?: string; stdout?: string; error?: string }> {
  const py = fn.language === "py";
  const ext = py ? "py" : extname(abs).slice(1) || "ts";
  const scratch = join(
    dirname(abs),
    `${py ? "_crw_sandbox_" : ".crw-sandbox-"}${randomUUID().slice(0, 8)}.${ext}`,
  );
  const body = `${module}\n\n${py ? pyHarness(fn.name, args) : jsHarness(fn.name, args)}`;
  await writeFile(scratch, body, "utf8");
  try {
    if (py) return await execProbe("python3", [scratch], repoPath);
    const tsx = join(projectRoot(), "node_modules/tsx/dist/cli.mjs");
    return await execProbe(process.execPath, [tsx, scratch], repoPath);
  } finally {
    await rm(scratch, { force: true });
  }
}

function jsHarness(name: string, args: unknown[]): string {
  // Wrapped rather than top-level await: the scratch file inherits the target
  // repo's module format, and CJS has no top-level await.
  return `${PRINT_JS}
void (async () => {
  const __args = ${JSON.stringify(args)};
  try {
    const __fn = ${name};
    if (typeof __fn !== "function") throw new Error("${name} is not a function");
    __print({ ok: true, result: await Promise.resolve(__fn(...__args)) });
  } catch (err) {
    __print({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
`;
}

function pyHarness(name: string, args: unknown[]): string {
  return `import json as __json
__args = __json.loads(${JSON.stringify(JSON.stringify(args))})
try:
    __value = ${name}(*__args)
    print("__PROBE__" + __json.dumps({"ok": True, "result": __value}, default=str))
except Exception as __e:
    print("__PROBE__" + __json.dumps({"ok": False, "error": f"{type(__e).__name__}: {__e}"}))
`;
}

const PRINT_JS = `function __print(value) {
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
}`;

async function runJs(
  abs: string,
  repoPath: string,
  fn: FnBlock,
  args: unknown[],
): Promise<{ result?: string; stdout?: string; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "crw-probe-"));
  const harness = join(dir, "probe.mts");
  const importUrl = pathToFileURL(abs).href;
  const inline = fn.source
    .replace(/^export\s+default\s+/, "")
    .replace(/^export\s+/, "");
  const body = `const __args = ${JSON.stringify(args)};
${PRINT_JS}
async function __fromImport() {
  const mod = await import(${JSON.stringify(importUrl)});
  const fn = mod[${JSON.stringify(fn.name)}] ?? mod.default;
  if (typeof fn !== "function") throw new Error("export " + ${JSON.stringify(fn.name)} + " is not a function");
  return fn(...__args);
}
async function __fromInline() {
  ${inline}
  const resolved = ${fn.name};
  if (typeof resolved !== "function") throw new Error("Could not evaluate ${fn.name} in isolation");
  return resolved(...__args);
}
try {
  let value;
  try {
    value = await __fromImport();
  } catch {
    value = await __fromInline();
  }
  __print({ ok: true, result: await Promise.resolve(value) });
} catch (err) {
  __print({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
`;
  await writeFile(harness, body, "utf8");
  const tsx = join(projectRoot(), "node_modules/tsx/dist/cli.mjs");
  return execProbe(process.execPath, [tsx, harness], repoPath);
}

async function runPython(
  abs: string,
  repoPath: string,
  fn: FnBlock,
  args: unknown[],
): Promise<{ result?: string; stdout?: string; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "crw-probe-"));
  const harness = join(dir, "probe.py");
  const body = `import importlib.util, json, sys
sys.path.insert(0, ${JSON.stringify(repoPath)})
sys.path.insert(0, ${JSON.stringify(dirname(abs))})
args = json.loads(${JSON.stringify(JSON.stringify(args))})
def dump(obj):
    print("__PROBE__" + json.dumps(obj, default=str))
try:
    spec = importlib.util.spec_from_file_location("probe_mod", ${JSON.stringify(abs)})
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fn = getattr(mod, ${JSON.stringify(fn.name)})
    value = fn(*args)
    dump({"ok": True, "result": value})
except Exception as e:
    dump({"ok": False, "error": f"{type(e).__name__}: {e}"})
`;
  await writeFile(harness, body, "utf8");
  return execProbe("python3", [harness], repoPath);
}

async function execProbe(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ result?: string; stdout?: string; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      // Our own tsx flags must not follow the child into the target repo,
      // where the tsconfig path would not resolve.
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        TSX_TSCONFIG_PATH: "",
      },
    });
    return parseProbe(stdout, stderr);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (e.stdout || e.stderr) return parseProbe(e.stdout ?? "", e.stderr ?? "");
    return { error: e.message || "Probe failed." };
  }
}

function parseProbe(
  stdout: string,
  stderr: string,
): { result?: string; stdout?: string; error?: string } {
  const marker = stdout.lastIndexOf("__PROBE__");
  if (marker >= 0) {
    const json = stdout.slice(marker + "__PROBE__".length).trim().split("\n")[0];
    try {
      const parsed = JSON.parse(json) as {
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      if (parsed.ok) {
        return {
          result: JSON.stringify(parsed.result, null, 2),
          stdout:
            [stdout.slice(0, marker), stderr].filter(Boolean).join("\n").trim() ||
            undefined,
        };
      }
      return {
        error: parsed.error || "Function threw.",
        stdout: stderr || undefined,
      };
    } catch {
      return { error: "Could not parse probe output.", stdout };
    }
  }
  return {
    error: stderr.trim() || stdout.trim() || "No result from probe.",
    stdout: stdout || undefined,
  };
}
