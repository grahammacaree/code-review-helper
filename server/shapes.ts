import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { balanced, escapeRe, evalLiteral } from "./strings.js";

/**
 * Builds a usable argument out of a TypeScript type when no test or fixture
 * offers a real one. Interfaces and type aliases are followed through relative
 * imports, so a parameter typed as a local shape comes back as an object with
 * its required fields filled, not `null`.
 */

export interface Shaped {
  value: unknown;
  /** True when the type told us something; false when we guessed. */
  known: boolean;
  /** What the shape came from, for the note in the UI. */
  from?: string;
}

const PRIMITIVES: Record<string, unknown> = {
  string: "",
  number: 0,
  bigint: 0,
  boolean: false,
  true: true,
  false: false,
  null: null,
  undefined: null,
  void: null,
  never: null,
  object: {},
  Date: "1970-01-01T00:00:00.000Z",
};

const EMPTY_CONTAINERS: Record<string, unknown> = {
  Record: {},
  Map: {},
  WeakMap: {},
  Set: [],
  WeakSet: [],
};

const MAX_DEPTH = 4;

interface Ctx {
  fileText: string;
  absPath: string;
  cache: Map<string, string>;
}

export async function shapeArgs(
  params: string[],
  fileText: string,
  absPath: string,
): Promise<Shaped[]> {
  const ctx: Ctx = { fileText, absPath, cache: new Map() };
  const out: Shaped[] = [];
  for (const param of params) {
    out.push(await shapeParam(param, ctx));
  }
  return out;
}

async function shapeParam(param: string, ctx: Ctx): Promise<Shaped> {
  const withoutDefault = param.split("=");
  const declared = withoutDefault[0];
  const literalDefault = withoutDefault.slice(1).join("=").trim();
  const colon = splitOnce(declared, ":");
  if (!colon) {
    // No annotation: a default value is the only signal we have.
    const value = literalDefault ? evalLiteral(literalDefault) : undefined;
    return value === undefined
      ? { value: null, known: false }
      : { value, known: true, from: "default value" };
  }
  const type = colon[1].trim();
  const shaped = await shapeType(type, ctx, 0);
  if (shaped.known) return shaped;
  if (literalDefault) {
    const value = evalLiteral(literalDefault);
    if (value !== undefined) {
      return { value, known: true, from: "default value" };
    }
  }
  return shaped;
}

async function shapeType(raw: string, ctx: Ctx, depth: number): Promise<Shaped> {
  const type = clean(raw);
  if (!type || depth > MAX_DEPTH) return { value: null, known: false };

  const union = splitTop(type, "|").map((t) => clean(t));
  if (union.length > 1) {
    const real = union.filter((t) => t !== "undefined" && t !== "null");
    const literals = real.map(literalValue);
    if (literals.every((v) => v !== undefined)) {
      return { value: literals[0], known: true, from: "literal union" };
    }
    for (const branch of real) {
      const shaped = await shapeType(branch, ctx, depth + 1);
      if (shaped.known) return shaped;
    }
    return { value: null, known: false };
  }

  // Intersections merge, which is what an object spread would do anyway.
  const parts = splitTop(type, "&").map((t) => clean(t));
  if (parts.length > 1) {
    const merged: Record<string, unknown> = {};
    let known = false;
    for (const part of parts) {
      const shaped = await shapeType(part, ctx, depth + 1);
      if (shaped.known && isRecord(shaped.value)) {
        Object.assign(merged, shaped.value);
        known = true;
      }
    }
    return known
      ? { value: merged, known: true, from: "intersection" }
      : { value: null, known: false };
  }

  const literal = literalValue(type);
  if (literal !== undefined) {
    return { value: literal, known: true, from: "literal type" };
  }

  if (type in PRIMITIVES) {
    return { value: PRIMITIVES[type], known: true, from: "primitive" };
  }

  if (type.endsWith("[]")) {
    const inner = await shapeType(type.slice(0, -2), ctx, depth + 1);
    return {
      value: inner.known ? [inner.value] : [],
      known: true,
      from: "array",
    };
  }

  const generic = /^([A-Za-z_$][\w$.]*)\s*<([\s\S]*)>$/.exec(type);
  if (generic) {
    const name = generic[1];
    const args = splitTop(generic[2], ",").map((t) => clean(t));
    if (name === "Array" || name === "ReadonlyArray") {
      const inner = await shapeType(args[0] ?? "", ctx, depth + 1);
      return {
        value: inner.known ? [inner.value] : [],
        known: true,
        from: "array",
      };
    }
    if (name === "Promise" || name === "Awaited" || name === "Readonly") {
      return shapeType(args[0] ?? "", ctx, depth + 1);
    }
    if (name === "Partial") {
      // Every field optional, so an empty object is valid and honest.
      return { value: {}, known: true, from: "Partial" };
    }
    if (name in EMPTY_CONTAINERS) {
      return { value: EMPTY_CONTAINERS[name], known: true, from: name };
    }
    if (name === "PromiseSettledResult") {
      const inner = await shapeType(args[0] ?? "", ctx, depth + 1);
      return {
        value: { status: "fulfilled", value: inner.known ? inner.value : null },
        known: true,
        from: "PromiseSettledResult",
      };
    }
    // An unknown generic still has a declaration worth reading.
    return declaredShape(name, ctx, depth);
  }

  if (type.startsWith("{")) {
    return membersShape(inner(type, "{", "}") ?? "", ctx, depth, "inline type");
  }

  if (/^[A-Za-z_$][\w$]*$/.test(type)) {
    if (type.length <= 2 && type === type.toUpperCase()) {
      return { value: null, known: false }; // T, K, V: a generic parameter
    }
    return declaredShape(type, ctx, depth);
  }

  return { value: null, known: false };
}

/** Finds `interface X`, `type X =`, or `enum X` here or through an import. */
async function declaredShape(
  name: string,
  ctx: Ctx,
  depth: number,
): Promise<Shaped> {
  const local = await shapeFromText(ctx.fileText, name, ctx, depth);
  if (local.known) return local;

  const source = importSource(ctx.fileText, name);
  if (!source || !source.startsWith(".")) return { value: null, known: false };
  const abs = resolveImport(ctx.absPath, source);
  if (!abs) return { value: null, known: false };
  const text = await read(abs, ctx.cache);
  if (!text) return { value: null, known: false };
  return shapeFromText(text, name, { ...ctx, fileText: text, absPath: abs }, depth);
}

async function shapeFromText(
  text: string,
  name: string,
  ctx: Ctx,
  depth: number,
): Promise<Shaped> {
  const iface = new RegExp(
    `\\binterface\\s+${escapeRe(name)}\\b[^{]*\\{`,
  ).exec(text);
  if (iface && iface.index !== undefined) {
    const body = inner(text.slice(iface.index + iface[0].length - 1), "{", "}");
    if (body !== undefined) {
      return membersShape(body, ctx, depth, `interface ${name}`);
    }
  }

  const alias = new RegExp(
    `\\btype\\s+${escapeRe(name)}\\b[^=]*=\\s*`,
  ).exec(text);
  if (alias && alias.index !== undefined) {
    const rest = text.slice(alias.index + alias[0].length);
    const end = rest.search(/;\s*(?:\n|$)/);
    const body = (end >= 0 ? rest.slice(0, end) : rest.split("\n\n")[0]).trim();
    if (body) {
      const shaped = await shapeType(body, ctx, depth + 1);
      if (shaped.known) return { ...shaped, from: `type ${name}` };
    }
  }

  const enumDecl = new RegExp(`\\benum\\s+${escapeRe(name)}\\s*\\{`).exec(text);
  if (enumDecl && enumDecl.index !== undefined) {
    const body =
      inner(text.slice(enumDecl.index + enumDecl[0].length - 1), "{", "}") ?? "";
    const first = splitTop(body, ",")
      .map((m) => m.trim())
      .filter(Boolean)[0];
    if (first) {
      const [key, value] = first.split("=").map((p) => p.trim());
      const parsed = value ? literalValue(value) : undefined;
      return {
        value: parsed !== undefined ? parsed : key,
        known: true,
        from: `enum ${name}`,
      };
    }
  }

  return { value: null, known: false };
}

/** Required members only: optional ones would be noise in the editor. */
async function membersShape(
  body: string,
  ctx: Ctx,
  depth: number,
  from: string,
): Promise<Shaped> {
  const out: Record<string, unknown> = {};
  for (const member of splitMembers(body)) {
    const m = /^(?:readonly\s+)?(?:\[[^\]]*\]|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))(\?)?\s*:\s*([\s\S]+)$/.exec(
      member.trim(),
    );
    if (!m) continue;
    const key = m[1] ?? m[2] ?? m[3];
    if (!key || m[4]) continue; // no name, or optional
    const shaped = await shapeType(m[5], ctx, depth + 1);
    out[key] = shaped.value;
  }
  return Object.keys(out).length > 0
    ? { value: out, known: true, from }
    : { value: {}, known: true, from };
}

function splitMembers(body: string): string[] {
  return splitTop(body.replace(/\/\/[^\n]*/g, ""), ";").flatMap((chunk) =>
    splitTop(chunk, ",").flatMap((part) =>
      part.includes(":") ? [part] : part.trim() ? [] : [],
    ),
  );
}

function literalValue(type: string): unknown {
  const t = clean(type);
  if (/^'[^']*'$/.test(t) || /^"[^"]*"$/.test(t) || /^`[^`]*`$/.test(t)) {
    return t.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return undefined;
}

function importSource(text: string, name: string): string | undefined {
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const names = m[1]
      .split(",")
      .map((n) => clean(n.replace(/^type\s+/, "").split(" as ")[0]));
    if (names.includes(name)) return m[2];
  }
  return undefined;
}

function resolveImport(fromFile: string, source: string): string | undefined {
  const base = resolve(dirname(fromFile), source);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.d.ts"),
  ];
  return candidates.find((c) => existsSync(c) && !c.endsWith("/"));
}

async function read(
  abs: string,
  cache: Map<string, string>,
): Promise<string | undefined> {
  const hit = cache.get(abs);
  if (hit !== undefined) return hit || undefined;
  try {
    const text = await readFile(abs, "utf8");
    cache.set(abs, text);
    return text;
  } catch {
    cache.set(abs, "");
    return undefined;
  }
}

/** Splits on a separator that is not inside brackets, braces, or quotes. */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
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
    else if (ch === sep && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out.filter((part) => part.trim() !== "");
}

/** Text inside the first balanced pair found in `src`. */
function inner(src: string, open: string, close: string): string | undefined {
  const start = src.indexOf(open);
  if (start < 0) return undefined;
  return balanced(src, start, open, close);
}

function splitOnce(src: string, sep: string): [string, string] | undefined {
  const parts = splitTop(src, sep);
  if (parts.length < 2) return undefined;
  return [parts[0], parts.slice(1).join(sep)];
}

function clean(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*readonly\s+/, "")
    .replace(/^\s*\.\.\./, "")
    .trim()
    .replace(/^\((.*)\)$/s, "$1")
    .trim();
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

