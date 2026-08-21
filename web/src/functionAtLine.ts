import type { FnBlock } from "./types";

const JS_FN =
  /^(\s*)(export\s+default\s+|export\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
const JS_ARROW =
  /^(\s*)(export\s+default\s+|export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\(/;
const PY_DEF = /^(\s*)(async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/;

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

export function functionsIn(text: string, path: string): FnBlock[] {
  const language = languageFor(path);
  if (language === "unknown") return [];
  const lines = text.split("\n");
  const out: FnBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!looksLikeHeader(lines[i], language)) {
      i += 1;
      continue;
    }
    const fn = functionAtLine(text, i + 1, path);
    if (fn && fn.startLine === i + 1) {
      out.push(fn);
      i = fn.endLine;
    } else {
      i += 1;
    }
  }
  return out;
}

function looksLikeHeader(line: string, language: FnBlock["language"]): boolean {
  if (language === "py") return PY_DEF.test(line);
  return Boolean(line.match(JS_FN) || line.match(JS_ARROW));
}

function dummyFor(raw: string): unknown {
  const name = raw.split("=")[0].split(":")[0].replace(/^\.\.\./, "").trim();
  const lower = name.toLowerCase();
  if (!name || name === "_" ) return null;
  if (/^(n|i|j|k|count|index|len|size|limit|offset|port)$/.test(lower)) return 0;
  if (/id$/.test(lower) && !/uuid/.test(lower)) return 1;
  if (/^(s|str|string|name|path|key|msg|message|url|text|query)$/.test(lower)) {
    return "";
  }
  if (/^(ok|flag|enabled|disabled)$/.test(lower) || /^(is|has|should|can)[A-Z]/.test(name)) {
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
    .filter((p) => p && p !== "this");
}

function jsAt(
  lines: string[],
  line: number,
  language: "js" | "ts",
): FnBlock | undefined {
  let headerIdx = -1;
  let match: RegExpMatchArray | null = null;
  let kind: "fn" | "arrow" = "fn";
  const start = Math.max(0, line - 1);
  for (let i = start; i >= 0; i -= 1) {
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
  const exported = Boolean(match[2]);
  const name = kind === "fn" ? match[4] : match[4];
  const params = parseParams(kind === "fn" ? match[5] : arrowParams(lines, headerIdx));
  return {
    name,
    startLine: headerIdx + 1,
    endLine: end,
    exported,
    language,
    params,
    header: lines[headerIdx].trim(),
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
    const line = stripJsComment(lines[i]);
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

function stripJsComment(line: string): string {
  return line.replace(/\/\/.*$/, "");
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
    params: parseParams(match[4]).filter((p) => p !== "self" && p !== "cls"),
    header: lines[headerIdx].trim(),
  };
}
