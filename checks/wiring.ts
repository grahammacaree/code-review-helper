/**
 * Alias resolution and outside-importer binding checks (no live API).
 * Run: npm run check:wiring
 */
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAliasMap,
  normalizeModulePath,
  resolveAliasCandidates,
} from "../server/aliases.js";
import { findOutsideImporters } from "../server/wiring.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  const map = {
    baseUrl: "src",
    paths: [{ pattern: "@/*", targets: ["./*"] }],
  };
  const hit = resolveAliasCandidates(
    "src/app/index.tsx",
    "@/identity/AuthContext",
    map,
  );
  check(
    "alias @/* resolves under baseUrl",
    hit[0] === "src/identity/AuthContext",
    `got=${hit[0]}`,
  );
  check(
    "normalize strips ext and index",
    normalizeModulePath("src/foo/index.tsx") === "src/foo",
  );

  const root = await mkdtemp(join(tmpdir(), "wiring-"));
  try {
    await exec("git", ["init"], { cwd: root });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
    );
    await mkdir(join(root, "src/identity"), { recursive: true });
    await mkdir(join(root, "src/app"), { recursive: true });
    await mkdir(join(root, "src/barrel"), { recursive: true });
    await writeFile(
      join(root, "src/identity/AuthContext.tsx"),
      `export function AuthProvider() {}\nexport const AuthContext = {};\n`,
    );
    await writeFile(
      join(root, "src/barrel/index.ts"),
      `export { AuthProvider, AuthContext } from "../identity/AuthContext";\n`,
    );
    await writeFile(
      join(root, "src/app/onboarding.tsx"),
      `import { AuthContext } from "@/identity/AuthContext";\nexport const x = AuthContext;\n`,
    );
    await writeFile(
      join(root, "src/app/account.tsx"),
      `import { AuthProvider } from "../barrel";\nexport const y = AuthProvider;\n`,
    );
    await exec("git", ["add", "."], { cwd: root });
    await exec(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
      { cwd: root },
    );

    const loaded = await loadAliasMap(root);
    check(
      "loadAliasMap reads paths from tsconfig",
      loaded.paths.some((p) => p.pattern === "@/*"),
      JSON.stringify(loaded.paths),
    );

    const found = await findOutsideImporters({
      repoPath: root,
      targetPath: "src/identity/AuthContext.tsx",
      exportNames: ["AuthProvider", "AuthContext"],
      exclude: new Set(["src/identity/AuthContext.tsx"]),
    });
    const paths = found.map((f) => f.path).sort();
    check(
      "finds alias importer",
      paths.includes("src/app/onboarding.tsx"),
      `found=${paths.join(", ")}`,
    );
    check(
      "finds barrel consumer",
      paths.includes("src/app/account.tsx"),
      `found=${paths.join(", ")}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (failed) throw new Error(`${failed} wiring check(s) failed`);
  console.log("\nall wiring checks ok");
}

main();
