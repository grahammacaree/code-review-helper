import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type RepoKind = "mobile" | "web" | "backend" | "mixed" | "unknown";

export interface RepoLens {
  kind: RepoKind;
  label: string;
  evidence: string[];
  watch: string[];
}

const DOC_FILES = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING",
  ".cursorrules",
];

const DOC_HINT =
  /\b(cache|caching|stale|invalidat|error boundar|isolat(?:e|ion)|offline|crash|navigat|bridge|permission|authz|authoriz|idempoten|migrat|rollout|feature flag)\b/i;

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

export function formatRepoLens(lens: RepoLens): string | undefined {
  if (lens.kind === "unknown" && lens.watch.length === 0) return undefined;
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
  const docWatch = await collectDocWatch(repoPath);
  const kindWatch =
    kind === "unknown"
      ? []
      : kind === "mixed"
        ? dedupe([...KIND_WATCH.mobile, ...KIND_WATCH.web]).slice(0, 4)
        : KIND_WATCH[kind];

  return {
    kind,
    label: kindLabel(kind),
    evidence: dedupe(evidence).slice(0, 4),
    watch: dedupe([...docWatch.items, ...kindWatch]).slice(0, 5),
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
      if (parent === dir || !parent.startsWith(repoPath)) break;
      dir = parent;
    }
  }
  const out: Manifest[] = [];
  for (const file of files) {
    const json = await readJson(file);
    if (!json) continue;
    const rel = relative(repoPath, file) || "package.json";
    out.push({ rel, deps: depNames(json) });
  }
  return out;
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

async function collectDocWatch(
  repoPath: string,
): Promise<{ items: string[] }> {
  const items: string[] = [];
  const files = [...DOC_FILES];
  const rulesDir = join(repoPath, ".cursor", "rules");
  const ruleNames = await readdir(rulesDir).catch(() => [] as string[]);
  for (const name of ruleNames.filter((n) => /\.(md|mdc)$/i.test(n)).slice(0, 6)) {
    files.push(join(".cursor", "rules", name));
  }

  for (const rel of files) {
    const text = await readText(join(repoPath, rel));
    if (!text) continue;
    for (const line of text.split("\n")) {
      const bullet = line.match(/^\s*[-*]\s+(.+)/);
      if (!bullet) continue;
      const item = bullet[1].replace(/\s+/g, " ").trim();
      if (item.length < 24 || item.length > 180) continue;
      if (!DOC_HINT.test(item)) continue;
      items.push(`${item} (${rel})`);
      if (items.length >= 3) return { items };
    }
  }
  return { items };
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
    return await readFile(path, "utf8");
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
