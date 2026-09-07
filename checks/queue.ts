/**
 * Checks on core-queue selection: harness files must not eat the spine of a
 * product PR, and isTestPath must agree across the helpers that use it.
 *
 * Run with `npm run check:queue`.
 */
import { isTestPath } from "../server/paths.js";
import { coreSpine, orderQueue } from "../server/scaffold.js";
import type { FileEntry } from "../server/types.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const HARNESS = [
  "src/test-utils/renderWithAuth.tsx",
  "src/test-utils/renderWithMutableAuth.tsx",
  "jest.setup.ts",
  "src/app/__tests__/root-layout.test.tsx",
  "src/components/LoadingScreen/LoadingScreen.stories.tsx",
];

const PRODUCT = [
  "src/app/_layout.tsx",
  "src/identity/AuthContext.tsx",
  "src/identity/AuthPanel.tsx",
  "src/onboarding/OnboardingContext.tsx",
  "src/onboarding/storage.ts",
  "src/app/(onboarding)/index.tsx",
  "src/app/(onboarding)/_layout.tsx",
  "src/app/(onboarding)/interests.tsx",
  "src/components/LoadingScreen/LoadingScreen.tsx",
  "src/components/brand/VergeLogo.tsx",
];

for (const path of HARNESS) {
  check(`harness is a test path: ${path}`, isTestPath(path));
}
for (const path of PRODUCT) {
  check(`product is not a test path: ${path}`, !isTestPath(path));
}

function entry(path: string): FileEntry {
  return { path, kind: "modified", noise: false, asset: false };
}

const mixed = [...HARNESS, ...PRODUCT].map(entry);
const ordered = orderQueue(mixed);
check(
  "ordered queue puts product before harness",
  ordered.indexOf("src/identity/AuthContext.tsx") <
    ordered.indexOf("src/test-utils/renderWithAuth.tsx"),
  `first=${ordered[0]}`,
);

const spine = coreSpine(ordered);
const harnessInSpine = spine.filter((p) => isTestPath(p));
check(
  "core spine has no harness when product fills the limit",
  harnessInSpine.length === 0,
  `spine=${spine.join(", ")}`,
);
check(
  "core spine is eight product files",
  spine.length === 8 && spine.every((p) => !isTestPath(p)),
  `len=${spine.length}`,
);

const onlyHarness = coreSpine(orderQueue(HARNESS.map(entry)));
check(
  "a harness-only PR still walks those files (no empty core)",
  onlyHarness.length === HARNESS.length &&
    onlyHarness.every((p) => isTestPath(p)),
  `spine=${onlyHarness.join(", ")}`,
);

if (failed) throw new Error(`${failed} queue check(s) failed`);
console.log("\nall queue checks ok");
