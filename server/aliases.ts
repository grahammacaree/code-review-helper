import { readFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

/**
 * Path-alias map from a checkout's tsconfig/jsconfig. Used so outside-caller
 * search can bind `@/foo` the same way the app does, not only relative imports.
 */
export interface AliasMap {
  /** Absolute or repo-relative base for non-relative specs (tsconfig baseUrl). */
  baseUrl: string;
  /** Longest-prefix first: alias pattern → target pattern (both with * or concrete). */
  paths: { pattern: string; targets: string[] }[];
}

const CONFIG_NAMES = [
  "tsconfig.json",
  "tsconfig.base.json",
  "jsconfig.json",
];

/**
 * Load the first tsconfig/jsconfig with `compilerOptions.paths` under the repo
 * root. Missing or unreadable configs yield an empty map (relative imports only).
 */
export async function loadAliasMap(repoPath: string): Promise<AliasMap> {
  for (const name of CONFIG_NAMES) {
    const map = await readConfig(join(repoPath, name), repoPath);
    if (map?.paths.length) return map;
  }
  return { baseUrl: ".", paths: [] };
}

async function readConfig(
  configPath: string,
  repoPath: string,
): Promise<AliasMap | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return undefined;
  }
  // Strip // and /* */ so a commented paths block does not break JSON5-ish files.
  const json = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  let data: {
    extends?: string;
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }

  const opts = data.compilerOptions ?? {};
  let paths = opts.paths ? Object.entries(opts.paths) : [];
  let baseUrl = opts.baseUrl ?? ".";

  if (data.extends && !paths.length) {
    const parent = data.extends.endsWith(".json")
      ? data.extends
      : `${data.extends}.json`;
    const parentPath = join(dirname(configPath), parent);
    const inherited = await readConfig(parentPath, repoPath);
    if (inherited?.paths.length) {
      paths = inherited.paths.map((p) => [p.pattern, p.targets] as const);
      baseUrl = inherited.baseUrl;
    }
  }

  if (!paths.length) return { baseUrl, paths: [] };

  const mapped = paths
    .map(([pattern, targets]) => ({
      pattern,
      targets: (targets ?? []).map((t) => t.replace(/\\/g, "/")),
    }))
    .sort((a, b) => b.pattern.length - a.pattern.length);

  // baseUrl is relative to the config file's directory.
  const configDir = relative(repoPath, dirname(configPath)).replace(/\\/g, "/") || ".";
  const resolvedBase =
    baseUrl === "."
      ? configDir
      : join(configDir, baseUrl).replace(/\\/g, "/");

  return { baseUrl: resolvedBase, paths: mapped };
}

/**
 * Resolve an import specifier to a repo-relative path candidate list (no ext).
 * Relative specs stay relative to `fromPath`; aliases use the map; bare package
 * names return [].
 */
export function resolveAliasCandidates(
  fromPath: string,
  spec: string,
  aliases: AliasMap,
): string[] {
  const normalized = spec.replace(/\\/g, "/");
  if (normalized.startsWith(".")) {
    const dir = dirname(fromPath).replace(/\\/g, "/");
    return [join(dir, normalized).replace(/\\/g, "/")];
  }

  for (const { pattern, targets } of aliases.paths) {
    const matched = matchAlias(pattern, normalized);
    if (!matched) continue;
    return targets.map((t) =>
      join(aliases.baseUrl, applyStar(t, matched)).replace(/\\/g, "/"),
    );
  }

  // baseUrl fallback: `@/x` already handled by paths; plain `foo` under baseUrl
  // is rare for app code and would collide with node_modules — skip.
  return [];
}

function matchAlias(pattern: string, spec: string): string | undefined {
  if (pattern.includes("*")) {
    const [pre, post] = pattern.split("*");
    if (!spec.startsWith(pre ?? "")) return undefined;
    if (post && !spec.endsWith(post)) return undefined;
    return spec.slice(pre!.length, post ? spec.length - post.length : undefined);
  }
  return spec === pattern ? "" : undefined;
}

function applyStar(target: string, star: string): string {
  return target.includes("*") ? target.replace("*", star) : target;
}

/** Normalize a resolved path for comparison (drop ext / trailing index). */
export function normalizeModulePath(path: string): string {
  return normalize(path)
    .replace(/\\/g, "/")
    .replace(/(\/index)?\.(tsx?|jsx?|mjs|cjs)$/i, "");
}
