import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export type RepoKind = "mobile" | "web" | "backend" | "mixed" | "unknown";

export interface PracticeItem {
  text: string;
  rel: string;
  seam: string;
}

export interface RepoLens {
  kind: RepoKind;
  label: string;
  evidence: string[];
  /** Kind-level questions, plus a miss alert when the change set skipped a seam. */
  watch: string[];
  /** Established group practices copied from checkout docs, not invented. */
  practices: PracticeItem[];
}

const ROOT_DOCS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

const NESTED_DOC_NAMES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"];

const NAMED_PRACTICE =
  /(cache|caching|invalidat|stale|authz|authoriz|offline|isolat|migrat|feature.?flag|observab|testing|review)/i;

const MAX_DOC_FILES = 24;
const MAX_DOC_CHARS = 32_000;
const MAX_PRACTICES = 6;

/**
 * Words that mark a line (or a heading it sits under) as a review seam.
 * Heading-scoped bullets do not have to repeat the keyword — that is how
 * "Keys must include the site id" under ## Caching used to be dropped.
 */
const SEAMS: { id: string; name: string; re: RegExp }[] = [
  {
    id: "cache",
    name: "caching",
    re: /\b(cach(?:e|ed|es|ing)|stale|invalidat\w*|ttl|redis|surrogate|revalidat\w*)\b/i,
  },
  {
    id: "isolation",
    name: "error isolation",
    re: /\b(error boundar|isolat(?:e|ion))\b/i,
  },
  {
    id: "offline",
    name: "offline",
    re: /\b(offline)\b/i,
  },
  {
    id: "authz",
    name: "authorization",
    re: /\b(authz|authoriz|permission)\b/i,
  },
  {
    id: "idempotency",
    name: "idempotency",
    re: /\b(idempoten)\b/i,
  },
  {
    id: "migration",
    name: "migrations",
    re: /\b(migrat)\b/i,
  },
  {
    id: "flags",
    name: "feature flags",
    re: /\b(feature flag|rollout)\b/i,
  },
  {
    id: "bridge",
    name: "native bridge",
    re: /\b(bridge|crash|navigat)\b/i,
  },
];

const DOC_HINT = new RegExp(
  SEAMS.map((s) => s.re.source.replace(/^\(|\)$/g, "")).join("|"),
  "i",
);

const KIND_WATCH: Record<Exclude<RepoKind, "unknown" | "mixed">, string[]> = {
  mobile: [
    "If this screen, list, or native call can fail, does the failure stay on this surface?",
    "If data is cached or used offline, is stale vs fresh obvious?",
    "Navigation / permissions / bridge: what happens when the OS says no?",
  ],
  web: [
    "If this is a page module or partial, does its failure take down the page?",
    "If this data is cached or shared across routes, what invalidates it?",
    "Client vs server: is this running where the change assumes it runs?",
  ],
  backend: [
    "New or changed endpoints: who is allowed to call this?",
    "Writes: partial failure, retries, and idempotency.",
    "Schema / migration changes: what happens to existing data?",
  ],
};

/**
 * Deps that mean the checkout actually runs this seam. Overlaps
 * `concepts.ts` SPECS on purpose (lens decides relevance; concepts teach) —
 * keep names aligned when either side gains a package.
 */
const SYSTEM_DEPS: Record<string, string[]> = {
  cache: [
    "redis",
    "ioredis",
    "@voxmedia/duet-redis",
    "memcached",
    "@tanstack/react-query",
    "react-query",
    "swr",
    "@apollo/client",
    "urql",
    "@urql/core",
    "relay-runtime",
    "next",
    "remix",
    "@remix-run/node",
  ],
  isolation: [],
  offline: [
    "@react-native-async-storage/async-storage",
    "react-native-mmkv",
    "expo-sqlite",
  ],
  authz: ["next-auth", "@auth/core", "passport", "jsonwebtoken"],
  idempotency: ["bullmq", "bull", "sidekiq"],
  migration: ["prisma", "knex", "typeorm", "drizzle-orm"],
  flags: [
    "launchdarkly-js-client-sdk",
    "launchdarkly-node-server-sdk",
    "@statsig/js-client",
  ],
  bridge: ["react-native", "expo"],
};

/** Paths that *are* the seam (this PR already touches it). */
const SEAM_HIT: Record<string, RegExp> = {
  cache: /(^|\/)(cache|redis|memcach)|invalidat|revalidat|\bstale\b/i,
  isolation: /(error-boundar|errorboundar)/i,
  offline: /(offline|mmkv|async-storage)/i,
  authz: /(authz|authoriz|(^|\/)guard|permission)/i,
  idempotency: /(idempoten|(^|\/)(queue|worker)(\/|$))/i,
  migration: /(migrat|(^|\/)schema(\/|$))/i,
  flags: /(feature.?flag|launchdarkly|statsig)/i,
  bridge: /(^|\/)(ios|android)(\/|$)|\bnative\b|\bbridge\b/i,
};

/**
 * Paths that often *ought* to follow the seam even when they do not name it
 * (a new fetch on a cached site; a write with no invalidate).
 * Keep path-segment anchors — bare `use[A-Z]` matched `userSettings`.
 */
const SEAM_ADJACENT: Record<string, RegExp> = {
  cache:
    /(^|\/)(api|hooks?|queries|mutations?|fetch|pages?|routes?|loaders?|handlers?|services?)(\/|$)|(^|\/)use[A-Z][A-Za-z]+\./,
  isolation: /(^|\/)(page|layout|screen|route)\./i,
  offline: /(^|\/)(storage|persist|hydrat)/i,
  authz: /(^|\/)(session|login|cookie|token)/i,
  idempotency: /(^|\/)(job|enqueue|consumer)/i,
  migration: /(^|\/)(model|entity)(\/|$)|\.sql$/i,
  flags: /(experiment|variant|(^|\/)gate(\/|$))/i,
  bridge: /(permission|notification|deep-?link)/i,
};

export function formatRepoLens(lens: RepoLens): string | undefined {
  if (
    lens.kind === "unknown" &&
    lens.watch.length === 0 &&
    lens.practices.length === 0
  ) {
    return undefined;
  }
  const bits = [`${lens.label}.`];
  if (lens.evidence.length) {
    bits.push(`From: ${lens.evidence.slice(0, 3).join("; ")}.`);
  }
  if (lens.watch.length) {
    bits.push(
      `Watch for (only when the hunk hits the seam — not a quiz):\n${lens.watch
        .map((w) => `- ${w}`)
        .join("\n")}`,
    );
  }
  if (lens.practices.length) {
    bits.push(
      `Group practices (from checkout docs — Be careful if this PR fights or skips them):\n${lens.practices
        .map((p) => `- ${p.text} (${p.rel})`)
        .join("\n")}`,
    );
  }
  return bits.join("\n\n");
}

export async function loadRepoLens(
  repoPath: string,
  changedPaths: string[],
): Promise<RepoLens> {
  const manifests = await collectManifests(repoPath, changedPaths);
  const scores = { mobile: 0, web: 0, backend: 0 };
  const evidence: string[] = [];

  for (const m of manifests) {
    addManifestSignals(m, scores, evidence);
  }
  await addTreeSignals(repoPath, changedPaths, scores, evidence);

  const kind = pickKind(scores);
  const systems = systemsFromManifests(manifests);
  const harvested = await harvestPractices(repoPath, changedPaths, systems);
  const kindWatch =
    kind === "unknown"
      ? []
      : kind === "mixed"
        ? dedupe([...KIND_WATCH.mobile, ...KIND_WATCH.web]).slice(0, 4)
        : KIND_WATCH[kind];
  const misses = missedSeams(changedPaths, harvested);
  const watch = dedupe([...misses, ...kindWatch]).slice(0, 5);

  return {
    kind,
    label: kindLabel(kind),
    evidence: dedupe(evidence).slice(0, 4),
    watch,
    practices: harvested,
  };
}

export interface Manifest {
  rel: string;
  deps: string[];
}

export async function collectManifests(
  repoPath: string,
  changedPaths: string[],
): Promise<Manifest[]> {
  const files = new Set<string>([join(repoPath, "package.json")]);
  for (const p of changedPaths.slice(0, 40)) {
    let dir = join(repoPath, dirname(p));
    for (let i = 0; i < 8; i += 1) {
      files.add(join(dir, "package.json"));
      const parent = dirname(dir);
      if (parent === dir || !underRepo(repoPath, parent)) break;
      dir = parent;
    }
  }
  const loaded = await Promise.all(
    [...files].map(async (file) => {
      const json = await readJson(file);
      if (!json) return undefined;
      const rel = relative(repoPath, file) || "package.json";
      return { rel, deps: depNames(json) } satisfies Manifest;
    }),
  );
  return loaded.filter((m): m is Manifest => Boolean(m));
}

/**
 * Pull review-seam bullets from a doc. A bullet under a matching heading
 * counts even when the bullet itself never repeats the keyword.
 */
export function extractPracticeItems(
  text: string,
  rel: string,
): PracticeItem[] {
  const items: PracticeItem[] = [];
  let sectionSeam: string | undefined;
  for (const raw of text.split("\n")) {
    const heading = raw.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      sectionSeam = seamOf(heading[1]);
      continue;
    }
    const bullet = raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)/);
    if (!bullet) continue;
    const item = bullet[1].replace(/\s+/g, " ").trim();
    if (item.length < 24 || item.length > 180) continue;
    const seam = seamOf(item) ?? sectionSeam;
    if (!seam) continue;
    items.push({ text: item, rel, seam });
  }
  return items;
}

function addManifestSignals(
  m: Manifest,
  scores: Record<"mobile" | "web" | "backend", number>,
  evidence: string[],
): void {
  const blob = m.deps.join(" ").toLowerCase();
  const hit = (needles: string[], kind: keyof typeof scores, label: string) => {
    if (needles.some((n) => blob.includes(n))) {
      scores[kind] += 2;
      evidence.push(`${label} in ${m.rel}`);
    }
  };
  hit(["react-native", "expo", "expo-router"], "mobile", "React Native/Expo");
  hit(
    ["next", "remix", "gatsby", "@sveltejs/kit", "nuxt"],
    "web",
    "web framework",
  );
  hit(["express", "fastify", "koa", "@nestjs/core"], "backend", "HTTP server");
  if (
    blob.includes("react") &&
    !blob.includes("react-native") &&
    (blob.includes("vite") || blob.includes("webpack"))
  ) {
    scores.web += 1;
    evidence.push(`React web tooling in ${m.rel}`);
  }
}

async function addTreeSignals(
  repoPath: string,
  changedPaths: string[],
  scores: Record<"mobile" | "web" | "backend", number>,
  evidence: string[],
): Promise<void> {
  const sample = changedPaths.slice(0, 80).join("\n");
  if (
    /(^|\/)(ios|android)(\/|$)/m.test(sample) ||
    /\.(swift|kt|java|m|mm)$/m.test(sample)
  ) {
    scores.mobile += 2;
    evidence.push("native ios/android paths in the change set");
  }
  if (/(^|\/)app\/.*\.(tsx|jsx)$/m.test(sample) && /page\.(tsx|jsx)$/m.test(sample)) {
    scores.web += 1;
    evidence.push("app-router page files in the change set");
  }
  if (/\.(go|rb|py)$/m.test(sample) && /(^|\/)(cmd|internal|app\/controllers)\//m.test(sample)) {
    scores.backend += 1;
    evidence.push("backend-shaped paths in the change set");
  }

  const rootNames = await readdir(repoPath).catch(() => [] as string[]);
  if (rootNames.includes("ios") && rootNames.includes("android")) {
    scores.mobile += 1;
    evidence.push("ios/ and android/ at repo root");
  }
  if (rootNames.includes("app.json") || rootNames.includes("app.config.js")) {
    const appJson = await readJson(join(repoPath, "app.json"));
    if (appJson && typeof appJson === "object" && "expo" in appJson) {
      scores.mobile += 2;
      evidence.push("Expo app.json");
    }
  }
}

function pickKind(
  scores: Record<"mobile" | "web" | "backend", number>,
): RepoKind {
  const ranked = (Object.entries(scores) as [RepoKind, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [top, topScore] = ranked[0];
  const second = ranked[1][1];
  if (topScore === 0) return "unknown";
  if (second > 0 && topScore - second < 2) return "mixed";
  return top;
}

function kindLabel(kind: RepoKind): string {
  switch (kind) {
    case "mobile":
      return "This checkout looks like a mobile app";
    case "web":
      return "This checkout looks like a website front-end";
    case "backend":
      return "This checkout looks like a backend service";
    case "mixed":
      return "This checkout looks mixed (mobile + web signals)";
    default:
      return "Could not classify this checkout";
  }
}

function systemsFromManifests(manifests: Manifest[]): Set<string> {
  const deps = new Set(
    manifests.flatMap((m) => m.deps.map((d) => d.toLowerCase())),
  );
  const systems = new Set<string>();
  for (const [seam, names] of Object.entries(SYSTEM_DEPS)) {
    if (names.some((n) => deps.has(n))) systems.add(seam);
  }
  return systems;
}

async function harvestPractices(
  repoPath: string,
  changedPaths: string[],
  systems: Set<string>,
): Promise<PracticeItem[]> {
  const rels = await listPracticeDocs(repoPath, changedPaths);
  const chunks = await Promise.all(
    rels.map(async (rel) => {
      const text = await readText(join(repoPath, rel));
      return text ? extractPracticeItems(text, rel) : [];
    }),
  );
  const found = chunks.flat().slice(0, 40);
  const live = changedPaths.filter((p) => !isIgnorablePath(p));
  const relevant = found.filter((item) =>
    practiceApplies(item, live, systems),
  );
  return dedupePractices(relevant).slice(0, MAX_PRACTICES);
}

function practiceApplies(
  item: PracticeItem,
  changedPaths: string[],
  systems: Set<string>,
): boolean {
  const hit = SEAM_HIT[item.seam];
  const adjacent = SEAM_ADJACENT[item.seam];
  if (hit && changedPaths.some((p) => hit.test(p))) return true;
  const near =
    Boolean(adjacent) && changedPaths.some((p) => adjacent!.test(p));
  if (near && (systems.has(item.seam) || isCheckoutWideDoc(item.rel))) {
    return true;
  }
  const dir = dirname(item.rel);
  if (dir && dir !== ".") {
    const prefix = dir.split("\\").join("/") + "/";
    if (changedPaths.some((p) => p === dir || p.startsWith(prefix))) return true;
  }
  return false;
}

function isCheckoutWideDoc(rel: string): boolean {
  const n = rel.split("\\").join("/");
  return (
    !n.includes("/") ||
    n.startsWith(".cursor/") ||
    n.startsWith(".github/") ||
    n.startsWith("docs/") ||
    n.startsWith("documentation/")
  );
}

function missedSeams(
  changedPaths: string[],
  practices: PracticeItem[],
): string[] {
  const live = changedPaths.filter((p) => !isIgnorablePath(p));
  const out: string[] = [];
  const seam = "cache";
  const hasPractice = practices.some((p) => p.seam === seam);
  const hit = SEAM_HIT[seam];
  const adjacent = SEAM_ADJACENT[seam];
  if (
    hasPractice &&
    adjacent &&
    live.some((p) => adjacent.test(p)) &&
    hit &&
    !live.some((p) => hit.test(p))
  ) {
    const src = practices.find((p) => p.seam === seam)?.rel ?? "checkout docs";
    out.push(
      `This checkout documents ${SEAMS.find((s) => s.id === seam)?.name ?? seam} (${src}) and this PR changes fetch/API/render code, but no changed path obviously updates keys, TTLs, or invalidation. If this is a write or a new read shape, skipping those practices is a divergence — put it in Be careful when the hunk is the write/read.`,
    );
  }
  return out;
}

async function listPracticeDocs(
  repoPath: string,
  changedPaths: string[],
): Promise<string[]> {
  const rels: string[] = [];
  const seen = new Set<string>();
  const add = (rel: string) => {
    const n = rel.split("\\").join("/");
    if (!n || seen.has(n) || n.includes("..")) return;
    seen.add(n);
    rels.push(n);
  };

  for (const rel of ROOT_DOCS) add(rel);

  const rulesDir = join(repoPath, ".cursor", "rules");
  const ruleNames = await readdir(rulesDir).catch(() => [] as string[]);
  for (const name of ruleNames
    .filter((n) => /\.(md|mdc)$/i.test(n))
    .slice(0, 8)) {
    add(join(".cursor", "rules", name));
  }

  for (const dir of ["docs", "documentation", ".github"]) {
    const names = await readdir(join(repoPath, dir)).catch(() => [] as string[]);
    for (const name of names) {
      if (!/\.(md|mdc)$/i.test(name)) continue;
      if (!NAMED_PRACTICE.test(name) && !DOC_HINT.test(name)) continue;
      add(join(dir, name));
    }
  }

  for (const p of changedPaths.slice(0, 40)) {
    let dir = join(repoPath, dirname(p));
    for (let i = 0; i < 8; i += 1) {
      for (const name of NESTED_DOC_NAMES) add(relative(repoPath, join(dir, name)));
      const parent = dirname(dir);
      if (parent === dir || !underRepo(repoPath, parent)) break;
      dir = parent;
    }
  }

  const candidates = rels.slice(0, MAX_DOC_FILES * 2);
  const checked = await Promise.all(
    candidates.map(async (rel) => {
      const full = join(repoPath, rel);
      if (!insideRepo(repoPath, full)) return undefined;
      const info = await stat(full).catch(() => undefined);
      if (!info?.isFile() || info.size > MAX_DOC_CHARS * 4) return undefined;
      return rel;
    }),
  );
  return checked.filter((r): r is string => Boolean(r)).slice(0, MAX_DOC_FILES);
}

/** Path is this checkout or a file/dir inside it (not a sibling prefix match). */
function underRepo(repoPath: string, full: string): boolean {
  const root = repoPath.endsWith(sep) ? repoPath.slice(0, -1) : repoPath;
  return full === root || full.startsWith(root + sep);
}

function insideRepo(repoPath: string, full: string): boolean {
  const rel = relative(repoPath, full);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.split(sep).includes("..");
}

function seamOf(text: string): string | undefined {
  for (const s of SEAMS) {
    if (s.re.test(text)) return s.id;
  }
  return undefined;
}

function isIgnorablePath(path: string): boolean {
  return /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.+\.snap$)/.test(
    path,
  );
}

function depNames(json: Record<string, unknown>): string[] {
  const bags = [json.dependencies, json.devDependencies, json.peerDependencies];
  const names: string[] = [];
  for (const bag of bags) {
    if (bag && typeof bag === "object") names.push(...Object.keys(bag));
  }
  return names;
}

async function readJson(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* missing or invalid */
  }
  return undefined;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.length > MAX_DOC_CHARS ? raw.slice(0, MAX_DOC_CHARS) : raw;
  } catch {
    return undefined;
  }
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupePractices(items: PracticeItem[]): PracticeItem[] {
  const seen = new Set<string>();
  const out: PracticeItem[] = [];
  for (const item of items) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
