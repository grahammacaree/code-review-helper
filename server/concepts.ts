import { collectManifests } from "./repoLens.js";

/**
 * Architectural systems a staff engineer would already have in their head for
 * this checkout: what the strategy is, what it buys, and how it usually breaks.
 * Detection is dependency- and path-based; teaching only fires when a hunk
 * actually lands on the seam.
 */
export interface RepoConcept {
  id: string;
  name: string;
  teach: string;
  evidence: string;
}

interface ConceptSpec {
  id: string;
  name: string;
  /** Dependency names that prove this system is in play. */
  deps: string[];
  /** Changed paths that usually sit on this seam. */
  seam: RegExp;
  /** Higher wins when several systems claim one path — specific beats broad. */
  weight: number;
  /** Matches the reviewer's own prose when he engages the system. */
  talk: RegExp;
  teach: string;
}

const SPECS: ConceptSpec[] = [
  {
    id: "query-cache",
    name: "Client query cache",
    deps: ["@tanstack/react-query", "react-query", "swr"],
    seam: /(quer(y|ies)|(^|\/)hooks?\/|use[A-Z]|fetch|(^|\/)api\/|mutation)/,
    weight: 5,
    talk: /(quer(y|ies)\s*key|cache\s*key|stale\s*time|staletime|invalidat|refetch|cached?)/i,
    teach:
      "Reads are cached per query key, so the key *is* the cache boundary: anything that changes what a request returns must be in the key or two screens share one entry. staleTime decides how long a mount trusts cached data without a network trip, and invalidation after writes is what makes a mutation visible elsewhere. Typical failures are a missing key input (stale data for another user or filter), an invalidate that names a different key than the one that cached it, and mixing loading flags — first-load vs background refetch drive different UI.",
  },
  {
    id: "graphql-cache",
    name: "Normalized GraphQL cache",
    deps: ["@apollo/client", "urql", "@urql/core", "relay-runtime"],
    seam: /(graphql|gql|fragment|mutation)/i,
    weight: 6,
    talk: /(normali[sz]ed|apollo|urql|fragment|cache\s*polic|graphql\s*cache)/i,
    teach:
      "The client keeps a normalized store keyed by type and id, so one entity is shared across every view that asked for it. That means a mutation response missing a field can blank it everywhere, and a query without an id cannot be merged into what is already cached. Watch for fragments that widen what a component needs, and cache policies that decide whether a screen waits for the network or renders what is already local.",
  },
  {
    id: "server-cache",
    name: "Server render cache",
    deps: ["next", "remix", "@remix-run/node", "gatsby"],
    seam: /(page|route|layout|loader|middleware|revalidat|isr)/i,
    weight: 4,
    talk: /(revalidat|isr|render\s*cache|cache\s*tag|static(ally)?\s*(render|generat)|ssr|server\s*render)/i,
    teach:
      "Rendered output and fetches are cached server-side with an explicit revalidate window or tag, so the question is never just \"is this correct?\" but \"how long can it be wrong, and what clears it?\" Tagged or path-based revalidation is the write path; without it a fix ships and readers still see the old render until the window expires. Requests that opt out of caching move cost to render time, so relaxing a cache here is a latency and load decision as much as a freshness one.",
  },
  {
    id: "shared-cache",
    name: "Shared cache tier (Redis)",
    deps: ["redis", "ioredis", "@voxmedia/duet-redis", "memcached"],
    seam: /(cache|redis|memcach|ttl|invalidat)/i,
    weight: 6,
    talk: /(redis|memcach|ttl|cache\s*key|invalidat|stampede|thunder|shared\s*cache|cache\s*tier)/i,
    teach:
      "A shared cache is cross-request and cross-instance, so a bad entry outlives the request that wrote it and is visible to everyone. Three things decide whether a change is safe: what the key includes (missing an input leaks one caller's data to another), the TTL (how long a wrong value survives), and who is allowed to invalidate. Also worth asking what happens on a miss storm — if the cache empties, does every instance hit upstream at once, and does upstream survive that?",
  },
  {
    id: "cdn-cache",
    name: "CDN / edge cache",
    deps: ["fastly", "@fastly/js-compute", "cloudflare", "varnish"],
    seam: /(header|surrogate|purge|edge|cache-control|middleware)/i,
    weight: 5,
    talk: /(cache[- ]control|surrogate|purge|cdn|fastly|edge\s*cache|vary)/i,
    teach:
      "Cache-control and surrogate headers hand ownership of freshness to the edge, which serves most readers without touching origin. A response that varies by user, geography, or experiment but is cached publicly will be served to the wrong person, so the vary and key rules matter more than the handler logic. Purge is the escape hatch: if this changes what a URL returns, someone has to say what invalidates the already-cached copies.",
  },
  {
    id: "flags",
    name: "Feature flags",
    deps: [
      "launchdarkly-js-client-sdk",
      "launchdarkly-node-server-sdk",
      "@optimizely/optimizely-sdk",
      "statsig-js",
      "@statsig/js-client",
      "@splitsoftware/splitio",
      "unleash-client",
    ],
    seam: /(flag|experiment|toggle|gate)/i,
    weight: 7,
    talk: /(feature\s*flag|flag(ged|ging)?\b|experiment|variant|rollout|toggle|launchdarkly|statsig)/i,
    teach:
      "A flag makes the code path a runtime decision, so both branches ship and both have to work — including the default a client gets before flags resolve. The interesting questions are what happens on that first uncached evaluation, whether server and client agree (a mismatch hydrates as a flicker or a layout jump), and how the losing branch gets deleted later. Flags that gate data shape, not just UI, also decide what lands in caches keyed without the flag.",
  },
  {
    id: "rsc-boundary",
    name: "Server / client boundary",
    deps: ["next", "react-server-dom-webpack"],
    seam: /(use-client|provider|(^|\/)(layout|page|client)\.(tsx|jsx)$)/i,
    weight: 4,
    talk: /(use client|server\s*component|client\s*component|hydrat|serializ|rsc|runs on the (server|client))/i,
    teach:
      "Modules run on the server unless something marks them as client, and that line decides what is even available: no browser APIs or event handlers above it, no secrets or direct data access below it. Props crossing the boundary have to serialize, so passing a function or class instance is a build-time or runtime error rather than a style choice. Pulling one client-only import into a shared module can drag a whole subtree to the client and quietly grow the bundle.",
  },
  {
    id: "monorepo-boundary",
    name: "Monorepo package boundary",
    deps: [],
    seam: /^packages\//,
    weight: 8,
    talk: /(shared\s*(package|module|framework)|blast\s*radius|consumers?|every\s*(app|network)|contract|additive|breaking\s*change)/i,
    teach:
      "Code in a shared package has consumers you are not looking at, so its exported surface is a contract rather than local detail: a signature, return shape, or flag meaning that changes here changes every app that imports it. That is why the safe version of a shared change is usually additive with a default, and why the blast radius question (who else calls this?) matters more than in app code. App-level code can be opinionated; package-level code has to be boring.",
  },
  {
    id: "offline-store",
    name: "Offline / device storage",
    deps: [
      "@react-native-async-storage/async-storage",
      "react-native-mmkv",
      "expo-sqlite",
      "@nozbe/watermelondb",
      "react-native-mmkv-storage",
    ],
    seam: /(storage|persist|offline|hydrat|(^|\/)store|sync|mmkv|sqlite)/i,
    weight: 7,
    talk: /(offline|persist|async\s*storage|mmkv|sqlite|migrat|stale\s*(vs|versus|data)|on\s*device|upgrade)/i,
    teach:
      "Persisted data outlives the app process and the app version, so anything written here is a schema you will have to read back after an upgrade. Migration and versioning matter more than write correctness: old shapes on device are the normal case, not the edge case. The other half is presentation — if a screen can render persisted data while the network is unavailable or slow, the user needs to be able to tell stale from fresh, and a failed refresh should not blank what already works.",
  },
  {
    id: "native-bridge",
    name: "Native bridge / OS permissions",
    deps: [
      "react-native",
      "expo",
      "expo-modules-core",
      "expo-notifications",
      "react-native-permissions",
    ],
    seam: /(native|bridge|permission|(^|\/)(ios|android)\/|notification|linking|deep-?link)/i,
    weight: 7,
    talk: /(permission|denied|native|bridge|settings|prebuild|config\s*plugin|dev\s*client|store\s*build)/i,
    teach:
      "Calls across the native bridge are async, platform-specific, and can be denied by the OS rather than failing like a network error: the user may have said no once, permanently, in Settings. So the branch that matters is usually \"denied or unavailable\", not \"threw\". Behavior also diverges by platform and by whether the build is a dev client or a store build, which is why config plugins and app config are part of the change rather than incidental.",
  },
  {
    id: "background-jobs",
    name: "Background jobs / queues",
    deps: ["bullmq", "bull", "sidekiq", "@aws-sdk/client-sqs", "celery", "agenda"],
    seam: /(job|queue|worker|task|consumer|producer|schedule|cron)/i,
    weight: 7,
    talk: /(idempoten|retr(y|ies)|backoff|at[- ]least[- ]once|queue|worker|enqueue|poison|dead\s*letter)/i,
    teach:
      "Work that leaves the request means at-least-once delivery: a job can run twice, run late, or run against data that moved since it was enqueued, so handlers want to be idempotent and to re-read state rather than trust the payload. Retries with no backoff turn one upstream blip into a stampede, and a poison message with infinite retries blocks everything behind it. What the user sees while the job is pending is a product decision, not just plumbing.",
  },
  {
    id: "migrations",
    name: "Schema migrations",
    deps: ["prisma", "knex", "typeorm", "drizzle-orm", "sequelize", "alembic"],
    seam: /(migrat|schema|prisma|(^|\/)models?\/|entity|\.sql$)/i,
    weight: 8,
    talk: /(migrat|backfill|nullable|expand.{0,12}contract|lock(ing|s)?\b|existing\s*(rows|data)|schema)/i,
    teach:
      "Deploys are not atomic with migrations, so for a window old code runs against the new schema (or the reverse). That is what makes expand-then-contract the default: add nullable, backfill, switch reads, drop later — rather than rename in one step. Locking and table size decide whether a migration is a blip or an outage, and \"what happens to rows that already exist\" is the question the diff rarely answers on its own.",
  },
  {
    id: "auth-session",
    name: "Auth and session",
    deps: [
      "next-auth",
      "@auth/core",
      "jsonwebtoken",
      "passport",
      "@clerk/nextjs",
      "firebase-auth",
    ],
    seam: /(auth|session|token|login|cookie|guard|permission)/i,
    weight: 6,
    talk: /(auth|session|token|refresh|expir|authori[sz]|claim|per[- ]user|leak)/i,
    teach:
      "Identity decides both what renders and what is allowed, so the seam to check is where a claim becomes an authorization decision — and whether that decision is made anywhere a client can skip. Tokens expire mid-session, which makes refresh and retry ordinary paths rather than error handling. Anything user-specific that touches a cache also becomes a leak question: keyed per user, or shared?",
  },
  {
    id: "observability",
    name: "Error reporting ownership",
    deps: [
      "@sentry/react-native",
      "@sentry/nextjs",
      "@sentry/node",
      "@react-native-firebase/crashlytics",
      "datadog-lambda-js",
    ],
    seam: /(monitor|sentry|crash|instrument|error-boundary|telemetry)/i,
    weight: 7,
    talk: /(sentry|crashlytics|source\s*map|symbolicat|release|dsn|grouping|owns?\s*(native|crash))/i,
    teach:
      "Reporting is only useful if the release, environment, and ownership lines are right: events that group under the wrong release or project are noise, and two tools claiming the same signal double-count incidents. Symbolication is a build-time concern (source maps uploaded with the release), so a correct runtime config can still produce unreadable stacks. Worth checking what is deliberately *not* captured here, since that is usually another tool's job.",
  },
];

export function loadRepoConcepts(
  repoPath: string,
  changedPaths: string[],
): Promise<RepoConcept[]> {
  return detect(repoPath, changedPaths);
}

async function detect(
  repoPath: string,
  changedPaths: string[],
): Promise<RepoConcept[]> {
  const manifests = await collectManifests(repoPath, changedPaths);
  const out: RepoConcept[] = [];
  for (const spec of SPECS) {
    const hit = spec.deps.length
      ? manifests.find((m) =>
          m.deps.some((dep) => spec.deps.includes(dep.toLowerCase())),
        )
      : changedPaths.some((p) => spec.seam.test(p))
        ? { rel: "the change set" }
        : undefined;
    if (!hit) continue;
    out.push({
      id: spec.id,
      name: spec.name,
      teach: spec.teach,
      evidence: hit.rel,
    });
  }
  return out;
}

/** Concepts whose seam this path sits on, most specific first. */
export function conceptsForPath(
  concepts: RepoConcept[],
  path: string,
): RepoConcept[] {
  const specs = new Map(SPECS.map((s) => [s.id, s]));
  return concepts
    .filter((c) => specs.get(c.id)?.seam.test(path))
    .sort(
      (a, b) =>
        (specs.get(b.id)?.weight ?? 0) - (specs.get(a.id)?.weight ?? 0),
    )
    .slice(0, 2);
}

/** Which of these systems the reviewer engaged with in his own words. */
export function conceptsMentioned(
  concepts: RepoConcept[],
  text: string,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const specs = new Map(SPECS.map((s) => [s.id, s]));
  return concepts
    .filter((c) => specs.get(c.id)?.talk.test(trimmed))
    .map((c) => c.id);
}

/** Names only, for the opening overview. */
export function conceptsNote(concepts: RepoConcept[]): string | undefined {
  if (!concepts.length) return undefined;
  const names = concepts.map((c) => c.name).slice(0, 6);
  return `Systems in play here: ${names.join(", ")}. I will teach the one a file actually touches — not all of them.`;
}
