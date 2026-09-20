import { noul } from "@typesafe-ai/sdk";
import { ACT_CONFIDENCE, systemOne } from "../typesafe.js";

export interface BindCandidate {
  path: string;
  /** Import specifier as written in the file. */
  from: string;
  names: string[];
  /** Deterministic resolution, if any. */
  resolvedPath?: string;
}

/**
 * When grep finds a symbol but path binding is ambiguous (alias we could not
 * fully resolve, or a barrel), ask whether each hit actually imports *this*
 * changed module. Returns the subset that bind, or undefined to keep all.
 */
export async function bindOutsideImports(opts: {
  targetPath: string;
  exportNames: string[];
  ambiguous: BindCandidate[];
}): Promise<BindCandidate[] | undefined> {
  const ambiguous = opts.ambiguous.slice(0, 10);
  if (!ambiguous.length) return [];

  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const [i, c] of ambiguous.entries()) {
    questions[`b${i}`] = noul({
      task: "Does this import bind to the changed module (not a different file that happens to export a similar name)?",
      importer: c.path,
      import_from: c.from,
      imported_names: c.names,
      changed_module: opts.targetPath,
      changed_exports: opts.exportNames,
      resolved_hint: c.resolvedPath ?? null,
      yes_means:
        "The import is of this module, a barrel that re-exports it, or an alias that resolves to it.",
      no_means:
        "Same symbol name, different module — or only a type/doc mention without importing this file.",
    });
  }

  const result = await systemOne(
    {
      changed_module: opts.targetPath,
      changed_exports: opts.exportNames,
      candidates: ambiguous,
    },
    questions,
  );
  if (!result) return undefined;

  const keep: BindCandidate[] = [];
  for (const [i, c] of ambiguous.entries()) {
    const ans = result.answers[`b${i}` as keyof typeof result.answers] as
      | { noul: number }
      | undefined;
    if (ans && ans.noul >= ACT_CONFIDENCE) keep.push(c);
  }
  return keep;
}
