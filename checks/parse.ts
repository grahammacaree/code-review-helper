/**
 * Checks on the two text passes a chase and the sandbox both lean on: finding
 * the function around a line, and excerpting a file down to the parts that
 * mention a name. Fixtures are inline so they cannot drift with the repo.
 *
 * Run with `npm run check:parse`.
 */
import { excerptAround } from "../server/excerpt.js";
import { functionAtLine } from "../server/probe.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `   ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const INLINE_TYPE = `import { thing } from "./thing.js";

export function withInlineType(
  path: string,
  opts: { maxChars: number; deep?: boolean },
): string {
  const out = thing(path);
  return out.slice(0, opts.maxChars);
}

export function after(): void {}
`;

// The braces in `opts: { … }` are a parameter type, not the body. Counting them
// as the body ended the function on its own signature.
const inline = functionAtLine(INLINE_TYPE, 7, "a.ts");
check(
  "inline object parameter does not end the function",
  inline?.startLine === 3 && inline?.endLine === 9,
  `got ${inline?.startLine}-${inline?.endLine}, want 3-9`,
);
check(
  "inline object parameter keeps both parameters",
  inline?.params.length === 2,
  `got ${inline?.params.length ?? 0}`,
);

const MULTILINE_IMPORT = `import {
  generateChaseCard,
  other,
} from "./agent.js";

async function advance(): Promise<void> {
  await generateChaseCard({ index: 0 });
}
`;

// The name sits on its own line inside a braced import, so the statement has to
// be skipped as a whole or the excerpt is just the import block.
const call = excerptAround(MULTILINE_IMPORT, "a.ts", ["generateChaseCard"], {
  maxChars: 2_000,
});
check(
  "multi-line import is not mistaken for a call site",
  call.text.includes("async function advance") && !call.text.includes("from "),
  call.text.split("\n")[1] ?? "",
);

const noHit = excerptAround(MULTILINE_IMPORT, "a.ts", ["notPresent"], {
  maxChars: 40,
});
check(
  "a name that is absent falls back to the head of the file",
  noHit.note.includes("no mention") && noHit.text.length <= 80,
  noHit.note,
);

const def = excerptAround(INLINE_TYPE, "a.ts", ["withInlineType"], {
  maxChars: 2_000,
  definitionsOnly: true,
});
check(
  "definitions-only finds the export, body and all",
  def.text.includes("export function withInlineType") &&
    def.text.includes("opts.maxChars"),
  def.note,
);

const TWO_CALLS = `function one(): void {
  target(1);
}

function filler(): void {}

function two(): void {
  target(2);
}
`;

const both = excerptAround(TWO_CALLS, "a.ts", ["target"], { maxChars: 2_000 });
check(
  "several call sites come through without the code between them",
  both.text.includes("function one") &&
    both.text.includes("function two") &&
    !both.text.includes("function filler"),
  both.note,
);

if (failed) throw new Error(`${failed} parse check(s) failed`);
console.log("\nall parse checks ok");
