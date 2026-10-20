/**
 * Checks that checkout docs (especially heading-scoped practices that never
 * repeat the keyword) make it into the repo lens when a PR hits or skips the
 * seam, and stay out when the change set is unrelated.
 *
 * Run with `npm run check:repo-lens`.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPracticeItems,
  formatRepoLens,
  loadRepoLens,
} from "../server/repoLens.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const CACHING_DOC = `# Guide

## Caching

- Keys must include the site id and the requesting user
- After a write, delete the matching key rather than waiting for TTL

## Something else

- This bullet is about the release train schedule and should not be harvested
`;

const items = extractPracticeItems(CACHING_DOC, "AGENTS.md");
check(
  "heading-scoped cache bullets are kept without repeating 'cache'",
  items.some((i) => i.text.includes("site id")) &&
    items.some((i) => i.text.includes("delete the matching key")) &&
    items.every((i) => i.seam === "cache"),
  items.map((i) => i.text).join(" | "),
);
check(
  "unrelated bullets are not harvested",
  !items.some((i) => i.text.includes("release train")),
);

const keywordBullet = extractPracticeItems(
  "- If this data is cached or shared across routes, what invalidates it?\n",
  "CONTRIBUTING.md",
);
check(
  "a keyword bullet still counts without a heading",
  keywordBullet.length === 1 && keywordBullet[0]?.seam === "cache",
);

async function withFixture(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, body);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withFixture(
  {
    "package.json": JSON.stringify({
      dependencies: { next: "15.0.0", redis: "4.0.0" },
    }),
    "AGENTS.md": CACHING_DOC,
    "src/api/articles.ts": "export function save() {}",
  },
  async (root) => {
    const lens = await loadRepoLens(root, ["src/api/articles.ts"]);
    check(
      "an API change pulls AGENTS caching practices",
      lens.practices.some((p) => p.text.includes("site id")),
      lens.practices.map((p) => p.text).join(" | ") || "(none)",
    );
    check(
      "a write-shaped PR with no cache files gets a miss watch",
      lens.watch.some((w) => /invalidation|divergence/i.test(w)),
      lens.watch.join(" | "),
    );
    const note = formatRepoLens(lens) ?? "";
    check(
      "formatted lens names group practices as a Be careful source",
      note.includes("Group practices") && note.includes("AGENTS.md"),
    );
    check(
      "formatted lens stays under 4k characters (prompt budget)",
      note.length < 4000,
      `len=${note.length}`,
    );
  },
);

await withFixture(
  {
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    "AGENTS.md": CACHING_DOC,
    "README.md": "hello",
  },
  async (root) => {
    const lens = await loadRepoLens(root, ["README.md"]);
    check(
      "an unrelated path does not pull cache practices",
      lens.practices.length === 0,
      lens.practices.map((p) => p.text).join(" | "),
    );
    check(
      "an unrelated path does not raise a cache-miss watch",
      !lens.watch.some((w) => /invalidation|divergence/i.test(w)),
    );
  },
);

await withFixture(
  {
    "package.json": JSON.stringify({
      dependencies: { next: "15.0.0", redis: "4.0.0" },
    }),
    "AGENTS.md": CACHING_DOC,
    "src/userSettings.ts": "export const x = 1;",
    "src/alternative.ts": "export const y = 2;",
  },
  async (root) => {
    const user = await loadRepoLens(root, ["src/userSettings.ts"]);
    check(
      "userSettings is not treated as a use* hook (false adjacent)",
      user.practices.length === 0,
      user.practices.map((p) => p.text).join(" | "),
    );
    const alt = await loadRepoLens(root, ["src/alternative.ts"]);
    check(
      "alternative.ts is not treated as a native/bridge hit",
      !alt.practices.some((p) => p.seam === "bridge") &&
        !alt.watch.some((w) => /native bridge/i.test(w)),
      alt.practices.map((p) => p.seam).join(",") || "(none)",
    );
  },
);

await withFixture(
  {
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    "packages/charts/AGENTS.md": `## Caching

- Never share a chart payload cache key across sites
`,
    "packages/charts/src/handler.ts": "export function handle() {}",
    "apps/site/src/page.tsx": "export default function Page() {}",
  },
  async (root) => {
    const nested = await loadRepoLens(root, [
      "packages/charts/src/handler.ts",
    ]);
    check(
      "a nested AGENTS.md applies when that package changed",
      nested.practices.some((p) => p.text.includes("chart payload")),
      nested.practices.map((p) => p.rel + ": " + p.text).join(" | ") || "(none)",
    );
    const other = await loadRepoLens(root, ["apps/site/src/page.tsx"]);
    check(
      "a nested AGENTS.md does not leak to another app",
      !other.practices.some((p) => p.text.includes("chart payload")),
    );
  },
);

if (failed) throw new Error(`${failed} repo-lens check(s) failed`);
console.log("all repo-lens checks passed");
