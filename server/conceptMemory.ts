import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "./env.js";
import type { RepoConcept } from "./concepts.js";

/**
 * How much scaffolding Graham needs on a system, from how often the walks have
 * already taught it and whether he engaged with it in his own words. Private to
 * this app (`data/commentary/`), never written into a reviewed checkout.
 */
export type ConceptDepth = "scaffold" | "build" | "deepen";

export interface ConceptRecord {
  /** Walks whose cards taught this system. */
  taught: number;
  /** Walks where he paraphrased or asked about it, not just read it. */
  engaged: number;
  /** ms epoch of the last walk that taught it. */
  lastSeen: number;
  /** Commentary keys (repos) where it came up. */
  repos: string[];
}

export interface ConceptMemory {
  version: 1;
  concepts: Record<string, ConceptRecord>;
}

export interface ConceptForCard extends RepoConcept {
  depth: ConceptDepth;
  seenIn: string[];
}

/** Long enough that a system genuinely needs re-grounding, not a nag. */
const STALE_MS = 120 * 24 * 60 * 60 * 1000;

function memoryPath(): string {
  return join(projectRoot(), "data", "commentary", "concepts.json");
}

export async function loadConceptMemory(): Promise<ConceptMemory> {
  try {
    const raw = await readFile(memoryPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const bag = (parsed as { concepts?: unknown }).concepts;
      if (bag && typeof bag === "object") {
        return { version: 1, concepts: sanitize(bag as Record<string, unknown>) };
      }
    }
  } catch {
    /* first walk, or hand-edited into nonsense */
  }
  return { version: 1, concepts: {} };
}

export async function saveConceptMemory(memory: ConceptMemory): Promise<void> {
  await mkdir(join(projectRoot(), "data", "commentary"), { recursive: true });
  await writeFile(memoryPath(), `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

export function conceptDepth(
  memory: ConceptMemory,
  id: string,
  now = Date.now(),
): ConceptDepth {
  const rec = memory.concepts[id];
  if (!rec || rec.taught <= 0) return "scaffold";
  const stale = now - rec.lastSeen > STALE_MS;
  const level: ConceptDepth =
    rec.engaged >= 2 || rec.taught >= 3 ? "deepen" : "build";
  if (!stale) return level;
  return level === "deepen" ? "build" : "scaffold";
}

/** Bump counts for what a walk actually taught and what he engaged with. */
export function recordConceptWalk(
  memory: ConceptMemory,
  input: {
    taught: string[];
    engaged: string[];
    repoKey: string;
    now?: number;
  },
): ConceptMemory {
  const now = input.now ?? Date.now();
  const engaged = new Set(input.engaged);
  const concepts = { ...memory.concepts };
  for (const id of new Set(input.taught)) {
    const prior = concepts[id];
    const repos = prior ? [...prior.repos] : [];
    if (input.repoKey && !repos.includes(input.repoKey)) {
      repos.push(input.repoKey);
    }
    concepts[id] = {
      taught: (prior?.taught ?? 0) + 1,
      engaged: (prior?.engaged ?? 0) + (engaged.has(id) ? 1 : 0),
      lastSeen: now,
      repos: repos.slice(-6),
    };
  }
  return { version: 1, concepts };
}

function sanitize(
  bag: Record<string, unknown>,
): Record<string, ConceptRecord> {
  const out: Record<string, ConceptRecord> = {};
  for (const [id, value] of Object.entries(bag)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Partial<ConceptRecord>;
    out[id] = {
      taught: numberOr(v.taught, 0),
      engaged: numberOr(v.engaged, 0),
      lastSeen: numberOr(v.lastSeen, 0),
      repos: Array.isArray(v.repos)
        ? v.repos.filter((r): r is string => typeof r === "string").slice(-6)
        : [],
    };
  }
  return out;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
