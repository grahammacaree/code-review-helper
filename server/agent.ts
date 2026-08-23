import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";
import { cursorApiKey, cursorModel } from "./env.js";
import { fileDiff, githubDiffUrl, parseFocusFromDiff, readWorktreeFile } from "./git.js";
import { fileLinks } from "./scaffold.js";
import type {
  FileCard,
  FileEntry,
  Overview,
  TeachbackKind,
  TeachbackResult,
} from "./types.js";
import {
  commentaryPromptBlock,
  emptyRepoTemplate,
  emptyUserTemplate,
  saveCommentary,
  type CommentaryBundle,
} from "./commentary.js";

type LocalAgent = Awaited<ReturnType<typeof Agent.create>>;

const AGENT_DIFF_CHARS = 8_000;
const AGENT_BODY_CHARS = 4_000;

/** Shared guardrails for chat Ask and inline annotation replies during a review. */
const REVIEW_QA_RULES = [
  "You are helping a reviewer understand a pull request. This is a code review, not a coding exercise.",
  "The reviewer is reading PR code as proposed — not asking you to edit, refactor, test-drive changes, or land follow-ups unless they explicitly ask you to change/implement/fix something in the repo.",
  "Answer to build understanding: what the code does, why it is shaped this way, plausible tradeoffs, how it connects. Use the file card and selected range when provided.",
  "Do not offer to make changes, refactor, or say you can do something 'in a follow-up', 'happy to slim this down', or 'switch to X' — those read like implementation offers. If something is worth raising, frame it as a review observation they might put on GitHub, not work for you to do now.",
  "Do not grade teach-back in these replies.",
].join("\n");

export async function authStatus(): Promise<{
  configured: boolean;
  models?: string[];
  error?: string;
}> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    return { configured: false };
  }
  try {
    const models = await Cursor.models.list({ apiKey });
    return {
      configured: true,
      models: models.map((m) => m.id).slice(0, 20),
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function requireKey(): string {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is not set. Copy .env.example to .env and paste a key from https://cursor.com/dashboard/api",
    );
  }
  return apiKey;
}

export async function createReviewAgent(cwd: string): Promise<LocalAgent> {
  return Agent.create({
    apiKey: requireKey(),
    model: { id: cursorModel() },
    name: "PR walkthrough",
    // mcp only: customTools ride on the custom-user-tools MCP server.
    // No read/grep — the host already passed the change set / hunks.
    tools: ["mcp"],
    local: { cwd },
  });
}

export async function generateOverview(opts: {
  agent: LocalAgent;
  files: FileEntry[];
  queue: string[];
  branch: string;
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  assetsNote?: string;
  noiseNote?: string;
  repoNote?: string;
  commentary?: CommentaryBundle;
}): Promise<Overview> {
  const holder: { prose?: Pick<
    Overview,
    "whatsHappening" | "why" | "dependencies" | "howItConnects"
  > } = {};
  const listed = opts.files
    .map(
      (f) =>
        `${f.kind}\t${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ""}${f.noise ? " [noise]" : ""}${f.asset ? " [asset]" : ""}`,
    )
    .join("\n");
  const body = (opts.prBody || "").trim().slice(0, AGENT_BODY_CHARS);

  const run = await opts.agent.send(
    [
      "Fill the overview card. Call publish_overview once. Chat text is ignored.",
      "whatsHappening: concrete behavior after merge.",
      "why: the problem or request this PR exists for.",
      "dependencies: upstream systems, packages, config, endpoints.",
      "howItConnects: call chain / data flow across the queued files. Do not repeat the repo watch list.",
      commentaryPromptBlock(opts.commentary),
      `Branch: ${opts.branch}`,
      opts.prUrl ? `PR URL: ${opts.prUrl}` : "No PR URL.",
      opts.prTitle ? `PR title: ${opts.prTitle}` : "",
      body ? `PR body:\n${body}` : "",
      `Queue (already chosen, do not reorder):\n${opts.queue.join("\n") || "(empty)"}`,
      `Changed paths:\n${listed}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      local: {
        customTools: {
          publish_overview: {
            description: "Publish overview prose. Call once.",
            inputSchema: {
              type: "object",
              properties: {
                whatsHappening: { type: "string" },
                why: { type: "string" },
                dependencies: { type: "string" },
                howItConnects: { type: "string" },
              },
              required: [
                "whatsHappening",
                "why",
                "dependencies",
                "howItConnects",
              ],
            },
            execute: (args) => {
              holder.prose = {
                whatsHappening: String(args.whatsHappening),
                why: String(args.why),
                dependencies: String(args.dependencies),
                howItConnects: String(args.howItConnects),
              };
              return "Overview recorded. Stop.";
            },
          },
        },
      },
    },
  );

  const result = await waitRun(run);
  if (!holder.prose) {
    throw new Error(missingTool("publish_overview", result));
  }
  return {
    branch: opts.branch,
    prUrl: opts.prUrl,
    ...holder.prose,
    queue: opts.queue,
    assetsNote: opts.assetsNote,
    noiseNote: opts.noiseNote,
    repoNote: opts.repoNote,
  };
}

export async function generateFileCard(opts: {
  agent: LocalAgent;
  cwd: string;
  entry: FileEntry;
  index: number;
  total: number;
  queue: string[];
  covered: string[];
  baseRef: string;
  prUrl?: string;
  overview?: Overview;
  commentary?: CommentaryBundle;
}): Promise<FileCard> {
  const hunks = await fileDiff(opts.cwd, opts.baseRef, opts.entry.path, {
    context: 0,
  });
  const focus = opts.entry.kind === "new" ? [] : parseFocusFromDiff(hunks);
  const diff =
    hunks.length > AGENT_DIFF_CHARS
      ? `${hunks.slice(0, AGENT_DIFF_CHARS)}\n…[truncated ${hunks.length - AGENT_DIFF_CHARS} chars]`
      : hunks;
  const links = fileLinks(
    opts.covered,
    opts.queue.slice(opts.index),
  );
  const diffUrl = githubDiffUrl(opts.prUrl, opts.entry.path);
  const holder: {
    prose?: Pick<
      FileCard,
      "what" | "why" | "roleInPr" | "lookCloser" | "map" | "couldHave" | "uhOh"
    >;
  } = {};

  const overviewBits = opts.overview
    ? [
        `PR why: ${opts.overview.why}`,
        `How the queued files connect: ${opts.overview.howItConnects}`,
        opts.overview.repoNote
          ? `Repo bias (tilt uh-ohs when this file hits the seam; do not invent rules; do not add sections):\n${opts.overview.repoNote}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const run = await opts.agent.send(
    [
      `File ${opts.index}/${opts.total}: ${opts.entry.path} (${opts.entry.kind}${opts.entry.oldPath ? ` from ${opts.entry.oldPath}` : ""}).`,
      "Call publish_file_card once. Stay on this file.",
      "what: concrete change. why: why this file had to change.",
      "roleInPr: one short paragraph on this file's purpose relative to the PR's stated and implicit motivation — not a repeat of what/why.",
      "lookCloser: 0–3 named hotspots (complex/novel/central) with line ranges. Behavior pivots: if the hunk is tiny but the point is a semantic choice (wrong flag/signal would regress UX), put that symbol in lookCloser and phrase why with the wrong alternative (e.g. 'vs isFetching — pagination would flash RefreshControl') — do not leave lookCloser empty on those files.",
      "map: optional. In-file: how lookCloser pieces connect when interlocking. Sibling: when this file and another queued/covered path solve the same UX differently, 2–4 lines naming the sibling and the divergence. Omit when not useful. Styles/barrels: prefer roleInPr over inventing a layout map.",
      "couldHave: 0–2 evidenced design forks, or empty.",
      "uhOh: 0–3 evidence-backed watch-outs with line ranges, or empty. Do not invent. If a repo watch list was given, use it only when this hunk actually hits that seam.",
      opts.entry.kind === "deleted"
        ? "File was deleted; do not invent current contents."
        : "",
      overviewBits,
      commentaryPromptBlock(opts.commentary),
      `Hunks:\n${diff || "(empty diff)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      local: {
        customTools: {
          publish_file_card: {
            description: "Publish file-card prose. Call once.",
            inputSchema: {
              type: "object",
              properties: {
                what: { type: "string" },
                why: { type: "string" },
                roleInPr: { type: "string" },
                lookCloser: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      startLine: { type: "number" },
                      endLine: { type: "number" },
                      why: { type: "string" },
                    },
                    required: ["name", "startLine", "endLine", "why"],
                  },
                },
                map: { type: "string" },
                couldHave: {
                  type: "array",
                  items: { type: "string" },
                },
                uhOh: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      startLine: { type: "number" },
                      endLine: { type: "number" },
                    },
                    required: ["text", "startLine", "endLine"],
                  },
                },
              },
              required: ["what", "why"],
            },
            execute: (args) => {
              const lookCloser = Array.isArray(args.lookCloser)
                ? (args.lookCloser as {
                    name: string;
                    startLine: number;
                    endLine: number;
                    why: string;
                  }[])
                : [];
              holder.prose = {
                what: String(args.what),
                why: String(args.why),
                roleInPr: args.roleInPr ? String(args.roleInPr) : undefined,
                lookCloser,
                map: args.map ? String(args.map) : undefined,
                couldHave: Array.isArray(args.couldHave)
                  ? (args.couldHave as string[])
                  : [],
                uhOh: Array.isArray(args.uhOh)
                  ? (args.uhOh as {
                      text: string;
                      startLine: number;
                      endLine: number;
                    }[])
                  : [],
              };
              return "File card recorded. Stop.";
            },
          },
        },
      },
    },
  );

  const result = await waitRun(run);
  if (!holder.prose) {
    throw new Error(missingTool("publish_file_card", result));
  }
  return {
    path: opts.entry.path,
    kind: opts.entry.kind,
    oldPath: opts.entry.oldPath,
    focus,
    diffUrl,
    links,
    index: opts.index,
    total: opts.total,
    ...holder.prose,
  };
}

export async function generateChaseCard(opts: {
  agent: LocalAgent;
  cwd: string;
  entry: FileEntry;
  index: number;
  total: number;
  queue: string[];
  covered: string[];
}): Promise<FileCard> {
  const from = opts.entry.chaseFrom || "the changed file";
  const names = (opts.entry.chaseNames || []).join(", ") || "the changed export";
  let caller = "";
  try {
    caller = await readWorktreeFile(opts.cwd, opts.entry.path);
  } catch {
    caller = "";
  }
  if (caller.length > AGENT_DIFF_CHARS) {
    caller = `${caller.slice(0, AGENT_DIFF_CHARS)}\n…[truncated]`;
  }
  let source = "";
  try {
    source = await readWorktreeFile(opts.cwd, from);
  } catch {
    source = "";
  }
  if (source.length > 4000) {
    source = `${source.slice(0, 4000)}\n…[truncated]`;
  }
  const links = fileLinks(
    opts.covered,
    opts.queue.slice(opts.index),
  );
  const holder: {
    prose?: Pick<FileCard, "what" | "why" | "lookCloser" | "uhOh">;
  } = {};

  const run = await opts.agent.send(
    [
      `Chase (unchanged caller, not in this PR): ${opts.entry.path}`,
      `Still imports {${names}} from ${from}.`,
      "Call publish_chase_card once. Stay thin.",
      "why: the contract that changed (signature, error shape, flag meaning).",
      "what: what this call site still assumes about that contract.",
      "lookCloser: 0–1 hotspot with line range if you can see the import/use, else empty.",
      "uhOh: only if the new contract does not hold here; otherwise empty. Do not invent.",
      "Do not write a full what/why/role teach-back card. No couldHave. No map.",
      source ? `Changed module (truncated):\n${source}` : "",
      caller ? `Caller (truncated):\n${caller}` : "Could not read the caller from disk.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      local: {
        customTools: {
          publish_chase_card: {
            description: "Publish a thin chase card. Call once.",
            inputSchema: {
              type: "object",
              properties: {
                why: { type: "string" },
                what: { type: "string" },
                lookCloser: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      startLine: { type: "number" },
                      endLine: { type: "number" },
                      why: { type: "string" },
                    },
                    required: ["name", "startLine", "endLine", "why"],
                  },
                },
                uhOh: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      startLine: { type: "number" },
                      endLine: { type: "number" },
                    },
                    required: ["text", "startLine", "endLine"],
                  },
                },
              },
              required: ["why", "what"],
            },
            execute: (args) => {
              holder.prose = {
                why: String(args.why),
                what: String(args.what),
                lookCloser: Array.isArray(args.lookCloser)
                  ? (args.lookCloser as {
                      name: string;
                      startLine: number;
                      endLine: number;
                      why: string;
                    }[])
                  : [],
                uhOh: Array.isArray(args.uhOh)
                  ? (args.uhOh as {
                      text: string;
                      startLine: number;
                      endLine: number;
                    }[])
                  : [],
              };
              return "Chase card recorded. Stop.";
            },
          },
        },
      },
    },
  );

  const result = await waitRun(run);
  if (!holder.prose) {
    throw new Error(missingTool("publish_chase_card", result));
  }
  const look = holder.prose.lookCloser;
  return {
    path: opts.entry.path,
    kind: opts.entry.kind,
    focus:
      look.length > 0
        ? look.map((h) => ({ start: h.startLine, end: h.endLine }))
        : [],
    links,
    index: opts.index,
    total: opts.total,
    chase: true,
    chaseFrom: opts.entry.chaseFrom,
    chaseNames: opts.entry.chaseNames,
    roleInPr: undefined,
    map: undefined,
    couldHave: [],
    wiringNote: `Unchanged caller of \`${from}\` (${names}). Not in this PR.`,
    ...holder.prose,
  };
}

/** Heuristic: Look closer "why" describes a wrong-alternative / signal choice. */
function isBehaviorPivotWhy(why: string): boolean {
  return /\b(vs\.?|versus|rather than|instead of|wrong|alternative|not\s+is[A-Z]|avoids?|would (?:flash|regress|break|spin))\b/i.test(
    why,
  );
}

export async function gradeTeachback(opts: {
  agent: LocalAgent;
  text: string;
  stage: "file" | "wrapup";
  card?: FileCard;
}): Promise<TeachbackResult> {
  const holder: { value?: TeachbackResult } = {};
  const hotspot = opts.card?.lookCloser.map((h) => h.name).join(", ");
  const pivotEntries = (opts.card?.lookCloser ?? []).filter((h) =>
    isBehaviorPivotWhy(h.why),
  );
  const pivotHint = pivotEntries
    .map((h) => `${h.name}: ${h.why}`)
    .join("; ");
  const siblingMap = opts.card?.map?.trim();
  const run = await opts.agent.send(
    [
      opts.stage === "file"
        ? [
            `Grade this teach-back for ${opts.card?.path}.`,
            "Pass if they explained what the file does and why it changed, in their own words, well enough to tell a teammate.",
            "Scale expectations to file role: styles/barrels need intent-level understanding (tokens, shared layout, public entry), not property-by-property recitation.",
            "Shared gates/screens: what + why (+ roughly who consumes / which signal) is enough.",
            pivotHint
              ? `Behavior pivot Look closer — ${pivotHint}. If their paraphrase never engages that semantic choice (or the wrong alternative), grade thin — do not pass a vague “loading flag” summary.`
              : "Do not fail them for skipping Look closer names when the overall explanation is solid.",
            hotspot && !pivotHint
              ? `Mentioning ${hotspot} is a plus, not a gate.`
              : "",
            siblingMap
              ? `A Map was on the card (may be sibling divergence). Connecting to other surfaces is a plus, not required if file-level explanation is solid.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : [
            "Grade the final PR summary.",
            "Pass only if they cover: (1) user outcome after merge, (2) the shared gate/module by name and its contract, (3) how call sites diverge if they do.",
            "Product-only summaries that never name the glue module or any surface divergence are thin.",
            "An optional open question for the author is welcome, not required.",
          ].join(" "),
      "Call grade_teachback once. adequate = could explain to a teammate. thin = stay. question_before = asked before paraphrasing. question_after = paraphrased then asked.",
      opts.card
        ? `Card what: ${opts.card.what}\nCard why: ${opts.card.why}${opts.card.roleInPr ? `\nRole in PR: ${opts.card.roleInPr}` : ""}${siblingMap ? `\nMap: ${siblingMap}` : ""}`
        : "",
      "Reviewer said:",
      opts.text,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      local: {
        customTools: {
          grade_teachback: {
            description: "Grade the reviewer's paraphrase.",
            inputSchema: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: [
                    "adequate",
                    "thin",
                    "question_before",
                    "question_after",
                  ],
                },
                message: { type: "string" },
              },
              required: ["kind", "message"],
            },
            execute: (args) => {
              const kind = String(args.kind) as TeachbackKind;
              holder.value = {
                adequate: kind === "adequate" || kind === "question_after",
                kind,
                message: String(args.message),
              };
              return "Grade recorded. Stop.";
            },
          },
        },
      },
    },
  );
  const result = await waitRun(run);
  if (!holder.value) {
    throw new Error(missingTool("grade_teachback", result));
  }
  return holder.value;
}

export async function answerFileQuestion(opts: {
  agent: LocalAgent;
  text: string;
  card?: FileCard;
  stage: "file" | "wrapup";
}): Promise<string> {
  const holder: { value?: string } = {};
  const run = await opts.agent.send(
    [
      REVIEW_QA_RULES,
      "Answer this reviewer question in the chat. Call publish_reply once.",
      opts.stage === "file"
        ? "End with one short line that teach-back is still required before advancing (unless they already paraphrased this file well enough)."
        : "",
      opts.stage === "file" && opts.card
        ? `Current file: ${opts.card.path}\nWhat: ${opts.card.what}\nWhy: ${opts.card.why}`
        : "Stage: wrap-up of the whole PR.",
      `Question:\n${opts.text}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      local: {
        customTools: {
          publish_reply: {
            description: "Publish the answer.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            execute: (args) => {
              holder.value = String(args.text);
              return "Reply recorded. Stop.";
            },
          },
        },
      },
    },
  );
  const result = await waitRun(run);
  if (!holder.value) {
    throw new Error(missingTool("publish_reply", result));
  }
  return holder.value;
}

export async function answerAnnotation(opts: {
  agent: LocalAgent;
  kind: "question" | "comment";
  path: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  body: string;
}): Promise<string> {
  const holder: { value?: string } = {};
  const run = await opts.agent.send(
    [
      REVIEW_QA_RULES,
      opts.kind === "question"
        ? "Answer this inline review question about a code range. Call publish_reply once. Explain only — do not treat the question as a request to change the code."
        : "Acknowledge this inline review comment. Call publish_reply once. Do not replace the comment or offer to edit the code.",
      `File: ${opts.path} L${opts.startLine}–L${opts.endLine}`,
      `Selected:\n${opts.selectedText.slice(0, 4000) || "(empty)"}`,
      `${opts.kind === "question" ? "Question" : "Comment"}:\n${opts.body}`,
    ].join("\n\n"),
    {
      local: {
        customTools: {
          publish_reply: {
            description: "Publish the reply to the reviewer.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            execute: (args) => {
              holder.value = String(args.text);
              return "Reply recorded. Stop.";
            },
          },
        },
      },
    },
  );
  const result = await waitRun(run);
  if (!holder.value) {
    throw new Error(missingTool("publish_reply", result));
  }
  return holder.value;
}

export async function updateWalkCommentary(opts: {
  agent: LocalAgent;
  bundle: CommentaryBundle;
  evidence: string;
}): Promise<void> {
  const priorUser = opts.bundle.userMarkdown.trim() || emptyUserTemplate();
  const priorRepo =
    opts.bundle.repoMarkdown.trim() ||
    emptyRepoTemplate({
      origin: opts.bundle.origin,
      repoPath: opts.bundle.repoPath,
    });
  const holder: { user?: string; repo?: string } = {};
  const run = await opts.agent.send(
    [
      "Rewrite Graham's private walkthrough notes after this PR walk.",
      "These files live only in the walkthrough app. They are never written into the git repo under review.",
      "Address Graham. Be kind and specific. Be firm about gaps. Never contemptuous, sarcastic, or demeaning. Do not call him stupid, lazy, or hopeless. Do not pile on. Prefer 'this still slips' over 'you always miss this.'",
      "Merge with prior notes: keep what still looks true, drop what this walk disproved, add at most a few new bullets. Keep each file under ~150 lines. No secrets, tokens, or pasted source.",
      "Weaknesses decay. Strengths (Patterns worth keeping / What you've picked up) may stay without fresh proof. Gaps need evidence from this walk.",
      "user.md Working on: if this walk showed the gap, keep it and set (quiet: 0). If it did not show, increment (quiet: N). After quiet: 2, move the bullet to Do not hammer. If it is already in Do not hammer and still quiet, drop it. If a cooled gap shows again, put it back in Working on at (quiet: 0). Never grow Working on from vibes.",
      "repo.md Still thin / Nudges: same decay — drop or cool items this walk did not touch. Do not carry a nag across walks that never hit it.",
      "user.md: cross-repo craft patterns — what he does well, what he is still working on. Not a repo diary.",
      "repo.md: this checkout only — PRs walked, what he has picked up here, what is still thin, nudges for the next walk (catch-mode vs catch-up).",
      "Call publish_commentary once with the full replacement markdown for both files.",
      `Prior user.md:\n${priorUser}`,
      `Prior repo.md:\n${priorRepo}`,
      `This walk:\n${opts.evidence}`,
    ].join("\n\n"),
    {
      local: {
        customTools: {
          publish_commentary: {
            description: "Publish updated private notes. Call once.",
            inputSchema: {
              type: "object",
              properties: {
                userMarkdown: { type: "string" },
                repoMarkdown: { type: "string" },
              },
              required: ["userMarkdown", "repoMarkdown"],
            },
            execute: (args) => {
              holder.user = String(args.userMarkdown);
              holder.repo = String(args.repoMarkdown);
              return "Notes recorded. Stop.";
            },
          },
        },
      },
    },
  );
  const result = await waitRun(run);
  if (!holder.user || !holder.repo) {
    throw new Error(missingTool("publish_commentary", result));
  }
  await saveCommentary({
    key: opts.bundle.key,
    userMarkdown: holder.user,
    repoMarkdown: holder.repo,
  });
}

type RunResult = Awaited<
  ReturnType<Awaited<ReturnType<LocalAgent["send"]>>["wait"]>
>;

function missingTool(name: string, result: RunResult): string {
  const text =
    typeof result.result === "string" ? result.result.trim().slice(0, 400) : "";
  return text
    ? `Agent finished without ${name}. Last text: ${text}`
    : `Agent finished without ${name}.`;
}

async function waitRun(
  run: Awaited<ReturnType<LocalAgent["send"]>>,
): Promise<RunResult> {
  try {
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(
        `Agent run failed (${run.id}): ${result.error?.message ?? "error"}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(
        `Cursor agent did not start: ${err.message} (retryable=${err.isRetryable})`,
      );
    }
    throw err;
  }
}
