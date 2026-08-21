import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { projectRoot } from "./env.js";
import type { ProbeResult } from "./types.js";

const execFileAsync = promisify(execFile);

const JS_FN =
  /^(\s*)(export\s+default\s+|export\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
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
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== "this" && p !== "self" && p !== "cls");
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
  const params = parseParams(
    kind === "fn" ? match[5] : arrowParams(lines, headerIdx),
  );
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

function arrowParams(lines: string[], headerIdx: number): string {
  const slice = lines.slice(headerIdx, Math.min(lines.length, headerIdx + 8)).join(" ");
  const m = slice.match(/=\s*(?:async\s*)?\(([^)]*)\)/);
  return m?.[1] ?? "";
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

export async function runFunction(opts: {
  repoPath: string;
  path: string;
  fileText: string;
  line: number;
  args: unknown[];
}): Promise<ProbeResult> {
  const fn = functionAtLine(opts.fileText, opts.line, opts.path);
  if (!fn) {
    return {
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
    name: fn.name,
    path: opts.path,
    startLine: fn.startLine,
    endLine: fn.endLine,
    exported: fn.exported,
    language: fn.language,
    params: fn.params,
    header: fn.header,
    args: opts.args,
  };
  try {
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
function __print(value) {
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
}
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
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
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
