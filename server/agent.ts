import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";
import { cursorApiKey, cursorModel } from "./env.js";
import { fileDiff, githubDiffUrl, parseFocusFromDiff } from "./git.js";
import { fileLinks } from "./scaffold.js";
import type {
  FileCard,
  FileEntry,
  Overview,
  TeachbackKind,
  TeachbackResult,
} from "./types.js";

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
      "howItConnects: call chain / data flow across the queued files.",
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
      ].join("\n")
    : "";

  const run = await opts.agent.send(
    [
      `File ${opts.index}/${opts.total}: ${opts.entry.path} (${opts.entry.kind}${opts.entry.oldPath ? ` from ${opts.entry.oldPath}` : ""}).`,
      "Call publish_file_card once. Stay on this file.",
      "what: concrete change. why: why this file had to change.",
      "roleInPr: one short paragraph on this file's purpose relative to the PR's stated and implicit motivation — not a repeat of what/why.",
      "lookCloser: 0–3 named hotspots (complex/novel/central) with line ranges.",
      "couldHave: 0–2 evidenced design forks, or empty.",
      "uhOh: 0–3 evidence-backed watch-outs with line ranges, or empty. Do not invent.",
      opts.entry.kind === "deleted"
        ? "File was deleted; do not invent current contents."
        : "",
      overviewBits,
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

export async function gradeTeachback(opts: {
  agent: LocalAgent;
  text: string;
  stage: "file" | "wrapup";
  card?: FileCard;
}): Promise<TeachbackResult> {
  const holder: { value?: TeachbackResult } = {};
  const hotspot = opts.card?.lookCloser.map((h) => h.name).join(", ");
  const run = await opts.agent.send(
    [
      opts.stage === "file"
        ? `Grade this teach-back for ${opts.card?.path}. Pass if they explained what the file does and why it changed, in their own words, well enough to tell a teammate. Do not fail them for skipping Look closer names when the overall explanation is solid.${hotspot ? ` Mentioning ${hotspot} is a plus, not a gate.` : ""}`
        : "Grade the final PR summary: what it does, why it exists, how the pieces connect.",
      "Call grade_teachback once. adequate = could explain to a teammate. thin = stay. question_before = asked before paraphrasing. question_after = paraphrased then asked.",
      opts.card
        ? `Card what: ${opts.card.what}\nCard why: ${opts.card.why}`
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
