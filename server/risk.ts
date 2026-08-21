import { diffNumstat, fileDiff } from "./git.js";
import type { FileEntry } from "./types.js";

export const RISK_PIN_SCORE = 8;

const PATH_HOTSPOT =
  /(^|\/)(auth|oauth|sso|session|permission|rbac|acl|billing|payment|stripe|crypto|secret|password|token|migrate|migration|sql|firewall|csrf|cors)(\/|$|\.)/i;

/** Patterns on added (+) lines that often mean real review risk. */
const ADDED_RISK: { re: RegExp; weight: number; label: string }[] = [
  { re: /\beval\s*\(/, weight: 10, label: "eval" },
  { re: /\bnew\s+Function\s*\(/, weight: 10, label: "new Function" },
  { re: /\binnerHTML\s*=/, weight: 8, label: "innerHTML" },
  { re: /dangerouslySetInnerHTML/, weight: 8, label: "dangerouslySetInnerHTML" },
  { re: /\bdocument\.write\s*\(/, weight: 8, label: "document.write" },
  { re: /\bchild_process\b|\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/, weight: 9, label: "shell exec" },
  { re: /rejectUnauthorized\s*:\s*false/i, weight: 10, label: "TLS verify off" },
  { re: /NODE_TLS_REJECT_UNAUTHORIZED/, weight: 10, label: "TLS reject disabled" },
  { re: /rm\s+-rf|unlinkSync|fs\.rm\(/, weight: 6, label: "destructive fs" },
  {
    re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i,
    weight: 10,
    label: "hardcoded secret",
  },
  { re: /Access-Control-Allow-Origin['":\s]+['"]?\*/i, weight: 7, label: "CORS *" },
  { re: /SELECT\s+.+\s*\+|query\s*\(\s*[`'"].*\$\{/i, weight: 9, label: "SQL concat" },
  { re: /@ts-ignore|@ts-expect-error/, weight: 4, label: "ts-ignore" },
  { re: /eslint-disable/, weight: 3, label: "eslint-disable" },
  { re: /\bas\s+any\b|:\s*any\b/, weight: 3, label: "any" },
  { re: /\bTODO\b|\bFIXME\b|\bHACK\b/, weight: 2, label: "TODO/FIXME" },
];

const REMOVED_GUARD =
  /^\-.*(auth|authorize|permission|csrf|captcha|rate.?limit|validate|sanitize|escape)/i;

export interface RiskHit {
  path: string;
  score: number;
  reasons: string[];
}

export async function scoreChangedFiles(opts: {
  repoPath: string;
  baseRef: string;
  files: FileEntry[];
  signal?: AbortSignal;
}): Promise<RiskHit[]> {
  const candidates = opts.files.filter((f) => !f.noise && !f.asset);
  if (!candidates.length) return [];

  const numstat = await diffNumstat(
    opts.repoPath,
    opts.baseRef,
    opts.signal,
  );

  const hits: RiskHit[] = [];
  for (const file of candidates) {
    const churn = numstat.get(file.path) ?? { added: 0, deleted: 0 };
    const base = pathAndChurnScore(file.path, churn);
    let score = base.score;
    const reasons = [...base.reasons];

    // Deep-diff only when path/churn already looks interesting or file would
    // otherwise be easy to skip (non-test source with real churn).
    const worthDiff =
      score >= 4 ||
      (churn.added + churn.deleted >= 40 && !isTestPath(file.path));
    if (worthDiff) {
      try {
        const diff = await fileDiff(opts.repoPath, opts.baseRef, file.path, {
          context: 0,
          maxChars: 60_000,
        });
        const fromDiff = scoreDiff(diff);
        score += fromDiff.score;
        reasons.push(...fromDiff.reasons);
      } catch {
        /* numstat-only score still useful */
      }
    }

    if (score > 0) {
      hits.push({ path: file.path, score, reasons: unique(reasons) });
    }
  }

  hits.sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path),
  );
  return hits;
}

function pathAndChurnScore(
  path: string,
  churn: { added: number; deleted: number },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (PATH_HOTSPOT.test(path)) {
    score += 5;
    reasons.push("sensitive path");
  }
  const total = churn.added + churn.deleted;
  if (!isTestPath(path) && total >= 200) {
    score += 5;
    reasons.push(`large churn (+${churn.added}/-${churn.deleted})`);
  } else if (!isTestPath(path) && total >= 80) {
    score += 3;
    reasons.push(`notable churn (+${churn.added}/-${churn.deleted})`);
  }
  return { score, reasons };
}

function scoreDiff(diff: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const seen = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const rule of ADDED_RISK) {
        if (rule.re.test(line) && !seen.has(rule.label)) {
          seen.add(rule.label);
          score += rule.weight;
          reasons.push(rule.label);
        }
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (REMOVED_GUARD.test(line) && !seen.has("removed guard")) {
        seen.add("removed guard");
        score += 7;
        reasons.push("removed guard");
      }
    }
  }
  return { score, reasons };
}

function isTestPath(path: string): boolean {
  return (
    /\.(test|spec)\./.test(path) ||
    /(^|\/)(__tests__|tests?|spec)\//.test(path)
  );
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
