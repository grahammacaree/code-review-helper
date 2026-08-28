import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  answerAnnotation,
  createReviewAgent,
  generateFileCard,
  generateChaseCard,
  generateOverview,
  gradeTeachback,
  answerFileQuestion,
  explainFunction as explainFunctionProse,
  updateWalkCommentary,
} from "./agent.js";
import {
  functionAtLine,
  probeId,
  runFunction,
  type FnBlock,
} from "./probe.js";
import { findCallers, suggestArgs } from "./samples.js";
import { escapeRe } from "./strings.js";
import {
  changedFiles,
  checkoutBranch,
  checkoutPr,
  confirmHead,
  currentBranch,
  defaultBranch,
  fileDiff,
  isGitRepo,
  largePrGate,
  parsePrRef,
  porcelainStatus,
  readWorktreeFile,
  stash,
} from "./git.js";
import {
  assetsNote,
  isTestPath,
  localThinTeachback,
  looksLikeQuestion,
  noiseNote,
  pendingTestPaths,
  skipIntent,
  walkQueue,
  wrapupFromCards,
} from "./scaffold.js";
import { formatRepoLens, loadRepoLens } from "./repoLens.js";
import {
  conceptsForPath,
  conceptsMentioned,
  conceptsNote,
  loadRepoConcepts,
  type RepoConcept,
} from "./concepts.js";
import {
  conceptDepth,
  loadConceptMemory,
  recordConceptWalk,
  saveConceptMemory,
  type ConceptForCard,
} from "./conceptMemory.js";
import {
  loadCommentary,
  type CommentaryBundle,
} from "./commentary.js";
import type { RiskHit } from "./risk.js";
import { readAllSessions, writeSession } from "./store.js";
import type {
  Annotation,
  AnnotationKind,
  ChatMessage,
  ChaseCandidate,
  FileCard,
  FileEntry,
  FileWiring,
  FunctionBrief,
  MessageKind,
  MessageRole,
  Phase,
  ProbeArgSuggestion,
  ProbeResult,
  SessionSnapshot,
  TeachbackResult,
} from "./types.js";
import { analyzeFileWiring, buildImportIndex, findOutsideImporters, formatWiringNote } from "./wiring.js";
import type { WiringImport } from "./wiring.js";

type LocalAgent = Awaited<ReturnType<typeof createReviewAgent>>;

interface Session {
  id: string;
  phase: Phase;
  repoPath: string;
  homeBranch: string;
  /** Branch checked out when the walk started (feature WIP), not necessarily main. */
  prRef: string;
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  baseRef?: string;
  /** PR tip OID after checkout — inspect/browse refuse wrong worktrees. */
  headOid?: string;
  dirtyStatus?: string;
  large?: { files: number; churn: string; excluded: string };
  files: FileEntry[];
  queue: string[];
  covered: string[];
  overview?: SessionSnapshot["overview"];
  card?: FileCard;
  cards: FileCard[];
  wrapup?: SessionSnapshot["wrapup"];
  teachback?: TeachbackResult;
  fileText?: string;
  diffText?: string;
  fileWiring?: FileWiring;
  focusLine?: number;
  messages: ChatMessage[];
  annotations: Annotation[];
  probe?: ProbeResult;
  busy: boolean;
  workingOn?: string;
  error?: string;
  agent?: LocalAgent;
  paraphrasedCurrent: boolean;
  paraphrases: { path: string; text: string }[];
  homeRestored: boolean;
  commentaryWritten: boolean;
  conceptsRecorded: boolean;
  cancel?: AbortController;
  wiringImportIndex?: Map<string, WiringImport[]>;
  wiringImportScopeKey?: string;
  commentary?: CommentaryBundle;
  chaseCandidates: ChaseCandidate[];
  concepts?: RepoConcept[];
  /** Sandbox explanations, keyed path:startLine. Rebuilt after a restart. */
  briefs?: Map<string, FunctionBrief>;
}

const sessions = new Map<string, Session>();

function persist(s: Session): void {
  const {
    agent,
    cancel,
    fileText,
    diffText,
    fileWiring,
    wiringImportIndex,
    wiringImportScopeKey,
    commentary,
    concepts,
    briefs,
    busy,
    workingOn,
    ...rest
  } = s;
  void writeSession(s.id, {
    ...rest,
    busy: false,
    workingOn: undefined,
  }).catch(() => undefined);
}

export async function restoreSessions(): Promise<void> {
  for (const raw of await readAllSessions()) {
    const s = hydrate(raw);
    if (!s) continue;
    if (!s.homeBranch) {
      try {
        s.homeBranch = await defaultBranch(s.repoPath);
      } catch {
        s.homeBranch = "main";
      }
    }
    if (s.card) {
      try {
        if (s.headOid && !(await confirmHead(s.repoPath, s.headOid))) {
          s.fileText =
            "// Worktree is no longer on this PR tip — Restore or re-check out before browsing files.";
          s.diffText = undefined;
          s.fileWiring = undefined;
        } else {
          s.fileText = await readWorktreeFile(s.repoPath, s.card.path);
          if (s.baseRef) {
            s.diffText = await fileDiff(s.repoPath, s.baseRef, s.card.path);
          }
          s.fileWiring = await computeFileWiring(s);
        }
      } catch {
        /* file may have moved */
      }
    }
    sessions.set(s.id, s);
  }
}

function hydrate(raw: unknown): Session | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<Session>;
  if (typeof o.id !== "string" || typeof o.repoPath !== "string") {
    return undefined;
  }
  return {
    id: o.id,
    phase: o.phase ?? "overview",
    repoPath: o.repoPath,
    homeBranch: o.homeBranch || "main",
    prRef: o.prRef ?? "",
    prUrl: o.prUrl,
    prTitle: o.prTitle,
    prBody: o.prBody,
    baseRef: o.baseRef,
    headOid: typeof o.headOid === "string" ? o.headOid : undefined,
    dirtyStatus: o.dirtyStatus,
    large: o.large,
    files: o.files ?? [],
    queue: o.queue ?? [],
    covered: o.covered ?? [],
    chaseCandidates: Array.isArray(o.chaseCandidates)
      ? o.chaseCandidates
      : [],
    overview: o.overview,
    card: o.card,
    cards: o.cards ?? [],
    wrapup: o.wrapup,
    teachback: o.teachback,
    focusLine: o.focusLine,
    messages: o.messages ?? [],
    annotations: o.annotations ?? [],
    probe: o.probe,
    busy: false,
    error: o.error,
    paraphrasedCurrent: Boolean(o.paraphrasedCurrent),
    paraphrases: Array.isArray(o.paraphrases)
      ? o.paraphrases.filter(
          (p): p is { path: string; text: string } =>
            Boolean(p) &&
            typeof p === "object" &&
            typeof (p as { path?: unknown }).path === "string" &&
            typeof (p as { text?: unknown }).text === "string",
        )
      : [],
    commentaryWritten: Boolean(o.commentaryWritten),
    conceptsRecorded: Boolean(o.conceptsRecorded),
    homeRestored:
      Boolean(o.homeRestored) ||
      (o.messages ?? []).some(
        (m) => typeof m.text === "string" && /^Back on /.test(m.text),
      ),
  };
}

function snapshot(s: Session): SessionSnapshot {
  return {
    id: s.id,
    phase: s.phase,
    repoPath: s.repoPath,
    homeBranch: s.homeBranch,
    prRef: s.prRef,
    prUrl: s.prUrl,
    baseRef: s.baseRef,
    dirtyStatus: s.dirtyStatus,
    large: s.large,
    overview: s.overview,
    card: s.card,
    wrapup: s.wrapup,
    teachback: s.teachback,
    fileText: s.fileText,
    diffText: s.diffText,
    fileWiring: s.fileWiring,
    focusLine: s.focusLine,
    files: s.files,
    queue: s.queue,
    covered: s.covered,
    chaseCandidates: s.chaseCandidates,
    messages: s.messages,
    annotations: s.annotations,
    probe: s.probe,
    busy: s.busy,
    workingOn: s.workingOn,
    error: s.error,
    agentId: s.agent?.agentId,
    homeRestored: s.homeRestored,
  };
}

function wiringScope(s: Session): string[] {
  const paths = new Set<string>();
  for (const p of [...s.queue, ...s.covered]) paths.add(p);
  if (s.card?.path) paths.add(s.card.path);
  return [...paths];
}

function wiringScopeKey(paths: string[]): string {
  return paths.slice().sort().join("\0");
}

async function wiringImportIndex(
  s: Session,
): Promise<Map<string, WiringImport[]>> {
  const scope = wiringScope(s);
  const key = wiringScopeKey(scope);
  if (s.wiringImportScopeKey === key && s.wiringImportIndex) {
    return s.wiringImportIndex;
  }
  const known = new Set(scope);
  const preload =
    s.fileText && s.card?.path
      ? new Map([[s.card.path, s.fileText]])
      : undefined;
  const index = await buildImportIndex({
    repoPath: s.repoPath,
    scopePaths: scope,
    known,
    preload,
  });
  s.wiringImportScopeKey = key;
  s.wiringImportIndex = index;
  return index;
}

function invalidateWiringIndex(s: Session): void {
  s.wiringImportIndex = undefined;
  s.wiringImportScopeKey = undefined;
}

async function computeFileWiring(s: Session): Promise<FileWiring | undefined> {
  if (!s.card?.path) return undefined;
  const scope = wiringScope(s);
  const importIndex = await wiringImportIndex(s);
  const wiring = await analyzeFileWiring({
    repoPath: s.repoPath,
    path: s.card.path,
    fileText: s.fileText,
    scopePaths: scope,
    importIndex,
  });
  s.card = {
    ...s.card,
    wiringNote: s.card.chase
      ? s.card.wiringNote
      : formatWiringNote(wiring),
  };
  s.chaseCandidates = [];
  if (!s.card.chase && s.card.kind !== "deleted") {
    const names = wiring.exports
      .filter((exp) => exp.kind !== "reexport")
      .map((exp) => exp.name);
    if (names.length) {
      try {
        s.chaseCandidates = await findOutsideImporters({
          repoPath: s.repoPath,
          targetPath: s.card.path,
          exportNames: names,
          exclude: new Set(wiringScope(s)),
          signal: signalOf(s),
        });
      } catch {
        s.chaseCandidates = [];
      }
    }
  }
  return wiring;
}

function push(
  s: Session,
  msg: {
    role: MessageRole;
    kind: MessageKind;
    text: string;
    overview?: ChatMessage["overview"];
    card?: FileCard;
    wrapup?: ChatMessage["wrapup"];
    large?: ChatMessage["large"];
    annotationId?: string;
  },
): void {
  s.messages.push({
    id: randomUUID(),
    at: Date.now(),
    ...msg,
  });
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown session.");
  return s;
}

function signalOf(s: Session): AbortSignal | undefined {
  return s.cancel?.signal;
}

function throwIfAborted(s: Session): void {
  if (s.cancel?.signal.aborted) {
    throw new Error("Interrupted.");
  }
}

async function withAgent<T>(
  s: Session,
  fn: (agent: LocalAgent) => Promise<T>,
): Promise<T> {
  if (!s.agent) {
    s.agent = await createReviewAgent(s.repoPath);
  }
  try {
    return await fn(s.agent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/authentication error/i.test(msg)) throw err;
    try {
      await s.agent.close();
    } catch {
      /* replace anyway */
    }
    s.agent = await createReviewAgent(s.repoPath);
    return fn(s.agent);
  }
}

async function withBusy(
  s: Session,
  fn: () => Promise<void>,
  label = "Working…",
): Promise<SessionSnapshot> {
  if (s.busy) throw new Error("Session is already working.");
  s.busy = true;
  s.error = undefined;
  s.workingOn = label;
  s.cancel = new AbortController();
  try {
    await fn();
  } catch (err) {
    const aborted = s.cancel.signal.aborted;
    const message = aborted
      ? "Interrupted."
      : err instanceof Error
        ? err.message
        : String(err);
    s.error = aborted ? undefined : message;
    if (message) {
      push(s, { role: "assistant", kind: "status", text: message });
    }
  } finally {
    s.busy = false;
    s.workingOn = undefined;
    s.cancel = undefined;
    persist(s);
  }
  return snapshot(s);
}

async function resolveRepoPath(input: string): Promise<string> {
  const trimmed = input.trim().replace(/^~(?=\/|$)/, homedir());
  if (!trimmed) {
    throw new Error("Need a repository path.");
  }
  if (isAbsolute(trimmed)) {
    if (await isGitRepo(trimmed)) return trimmed;
    throw new Error("That path is not a git repository.");
  }
  const home = homedir();
  const candidates = [
    join(home, trimmed),
    join(home, "my-projects", trimmed),
    join(home, "my-projects", "apps", trimmed),
  ];
  const unique = [...new Set(candidates)];
  for (const candidate of unique) {
    if (await isGitRepo(candidate)) return candidate;
  }
  throw new Error(
    `Not a git repo under ${home}. Tried ${unique.join(", ")}.`,
  );
}

export async function startSession(input: {
  repoPath: string;
  pr: string;
  allowStash?: boolean;
}): Promise<SessionSnapshot> {
  const repoPath = await resolveRepoPath(input.repoPath);
  const parsed = parsePrRef(input.pr);
  if (!parsed.number) {
    throw new Error("Pass a GitHub PR URL or number.");
  }

  const onBranch = await currentBranch(repoPath);
  const homeBranch =
    onBranch ||
    (await defaultBranch(repoPath).catch(() => "main"));
  let dirty = await porcelainStatus(repoPath);
  if (dirty && input.allowStash) {
    await stash(repoPath);
    dirty = await porcelainStatus(repoPath);
  }

  const id = randomUUID();
  const s: Session = {
    id,
    phase: dirty ? "blocked_dirty" : "overview",
    repoPath,
    homeBranch,
    prRef: parsed.number,
    prUrl: parsed.url,
    dirtyStatus: dirty || undefined,
    files: [],
    queue: [],
    covered: [],
    chaseCandidates: [],
    cards: [],
    messages: [],
    annotations: [],
    busy: false,
    paraphrasedCurrent: false,
    paraphrases: [],
    commentaryWritten: false,
    conceptsRecorded: false,
    homeRestored: false,
  };
  sessions.set(id, s);
  persist(s);
  push(s, {
    role: "user",
    kind: "text",
    text: `Check out PR ${parsed.number} in ${repoPath}`,
  });

  if (dirty) {
    push(s, {
      role: "assistant",
      kind: "dirty",
      text: `Working tree isn’t clean (${dirty}). Switch to a clean branch yourself, or stash and continue. The app will not checkout over dirty files unless you stash.`,
    });
    persist(s);
    return snapshot(s);
  }

  return withBusy(s, async () => {
    await checkoutAndMaybeGate(s);
  }, "Checking out the PR…");
}

async function checkoutAndMaybeGate(
  s: Session,
  mode: "all" | "core" | "pending_large" = "pending_large",
): Promise<void> {
  s.workingOn = "Checking out the PR…";
  const meta = await checkoutPr(s.repoPath, s.prRef, signalOf(s));
  throwIfAborted(s);
  s.prUrl = s.prUrl || meta.prUrl;
  s.prTitle = s.prTitle || meta.title;
  s.prBody = s.prBody || meta.body;
  s.baseRef = meta.baseRef;
  s.headOid = meta.headOid;
  const ok = await confirmHead(s.repoPath, meta.headOid);
  if (!ok) {
    throw new Error("Local HEAD does not match the PR tip after checkout.");
  }
  s.phase = "overview";
  s.workingOn = "Reading the change set…";
  const { files, shortstat } = await changedFiles(
    s.repoPath,
    meta.baseRef,
  );
  s.files = files;
  const gate = largePrGate(files, shortstat);
  if (mode === "pending_large" && gate.large) {
    s.large = gate;
    s.phase = "blocked_large";
    push(s, {
      role: "assistant",
      kind: "large",
      text: `This PR is large: ${gate.files} files, ${gate.churn} (excluding ${gate.excluded}). Pick quit, core only, or walk all.`,
      large: gate,
    });
    return;
  }
  const walkMode = mode === "core" ? "core" : "all";
  await runOverview(s, walkMode);
}

async function runOverview(s: Session, mode: "all" | "core"): Promise<void> {
  throwIfAborted(s);
  s.workingOn =
    mode === "core"
      ? "Picking the core walk and scanning for risky diffs…"
      : "Mapping the PR…";
  const { queue, batched, riskPinned } = await walkQueue({
    files: s.files,
    mode,
    repoPath: s.repoPath,
    baseRef: s.baseRef || "main",
    signal: signalOf(s),
  });
  throwIfAborted(s);
  s.workingOn = "Mapping the PR…";
  const branch = await currentBranch(s.repoPath);
  const paths = s.files.map((f) => f.path);
  const lens = await loadRepoLens(s.repoPath, paths);
  s.concepts = await loadRepoConcepts(s.repoPath, paths);
  const repoNote = [formatRepoLens(lens), conceptsNote(s.concepts)]
    .filter(Boolean)
    .join("\n\n") || undefined;
  const commentary = await ensureCommentary(s);
  s.overview = await withAgent(s, (agent) =>
    generateOverview({
      agent,
      files: s.files,
      queue,
      branch,
      prUrl: s.prUrl,
      prTitle: s.prTitle,
      prBody: s.prBody,
      assetsNote: assetsNote(s.files),
      noiseNote: noiseNote(s.files, batched, riskPinned),
      repoNote,
      commentary,
    }),
  );
  s.queue = s.overview.queue;
  invalidateWiringIndex(s);
  s.phase = "overview";
  push(s, {
    role: "assistant",
    kind: "overview",
    text: s.overview.whatsHappening,
    overview: s.overview,
  });
}

export function getSession(id: string, lite = false): SessionSnapshot {
  const snap = snapshot(get(id));
  if (!lite) return snap;
  return { ...snap, fileText: undefined, diffText: undefined };
}

export async function chooseLarge(
  id: string,
  choice: "quit" | "core" | "all",
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "blocked_large") {
    throw new Error("Not waiting on a large-PR choice.");
  }
  const labels = { quit: "Quit", core: "Core only", all: "Walk all" };
  push(s, { role: "user", kind: "text", text: labels[choice] });
  if (choice === "quit") {
    s.phase = "done";
    push(s, {
      role: "assistant",
      kind: "status",
      text: `Stopped. Restore ${restoreTarget(s)} if the tree is clean.`,
    });
    persist(s);
    return snapshot(s);
  }
  return withBusy(s, async () => {
    await runOverview(s, choice === "core" ? "core" : "all");
  }, "Mapping the PR…");
}

export async function stashAndContinue(
  id: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "blocked_dirty") {
    throw new Error("Not waiting on a dirty tree.");
  }
  push(s, { role: "user", kind: "text", text: "Stash and continue" });
  return withBusy(s, async () => {
    s.workingOn = "Stashing the working tree…";
    await stash(s.repoPath, signalOf(s));
    throwIfAborted(s);
    s.dirtyStatus = undefined;
    s.workingOn = "Checking out the PR…";
    await checkoutAndMaybeGate(s);
  }, "Stashing the working tree…");
}

export async function startFiles(id: string): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "overview") {
    throw new Error("Overview is not ready.");
  }
  push(s, { role: "user", kind: "text", text: "Start file 1" });
  return withBusy(s, async () => {
    await advanceToFile(s, 0);
  }, "Writing the first file card…");
}

async function advanceToFile(s: Session, index: number): Promise<void> {
  throwIfAborted(s);
  s.teachback = undefined;
  s.paraphrasedCurrent = false;
  if (s.headOid && !(await confirmHead(s.repoPath, s.headOid))) {
    throw new Error(
      "Worktree left the PR tip mid-walk. Check out the PR again or Restore your starting branch.",
    );
  }
  if (index >= s.queue.length) {
    s.workingOn = "Writing wrap-up…";
    s.wrapup = wrapupFromCards(s.cards);
    // Keep the last inspect pane open so wrap-up can name wiring / symbols.
    s.chaseCandidates = [];
    s.probe = undefined;
    s.phase = "wrapup";
    push(s, {
      role: "assistant",
      kind: "wrapup",
      text: s.wrapup.lingeringUhOhs,
      wrapup: s.wrapup,
    });
    return;
  }
  const path = s.queue[index];
  const entry = s.files.find((f) => f.path === path);
  if (!entry) throw new Error(`Unknown queued file: ${path}`);
  s.workingOn = `Writing file card ${index + 1}/${s.queue.length}…`;
  const commentary = await ensureCommentary(s);
  const concepts = entry.chase ? [] : await conceptsForCard(s, path);
  const card = entry.chase
    ? await withAgent(s, (agent) =>
        generateChaseCard({
          agent,
          cwd: s.repoPath,
          entry,
          index: index + 1,
          total: s.queue.length,
          queue: s.queue,
          covered: s.covered,
        }),
      )
    : await withAgent(s, (agent) =>
        generateFileCard({
          agent,
          cwd: s.repoPath,
          entry,
          index: index + 1,
          total: s.queue.length,
          queue: s.queue,
          covered: s.covered,
          baseRef: s.baseRef || "main",
          prUrl: s.prUrl,
          overview: s.overview,
          commentary,
          concepts,
        }),
      );
  s.card = card;
  s.phase = "file";
  try {
    s.diffText = await fileDiff(s.repoPath, s.baseRef || "main", path);
  } catch {
    s.diffText = undefined;
  }
  if (entry.kind === "deleted") {
    s.fileText = undefined;
    s.fileWiring = undefined;
    s.focusLine = undefined;
  } else {
    try {
      s.fileText = await readWorktreeFile(s.repoPath, path);
    } catch {
      s.fileText = "// Could not read this path from HEAD.";
    }
    s.fileWiring = await computeFileWiring(s);
    s.focusLine =
      card.lookCloser[0]?.startLine || card.focus[0]?.start || 1;
  }
  s.cards.push(s.card);
  push(s, {
    role: "assistant",
    kind: "file",
    text: s.card.what,
    card: s.card,
  });
}

export async function askAboutFile(
  id: string,
  text: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "file" && s.phase !== "wrapup") {
    throw new Error("Open a file (or wrap-up) before asking.");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Write a question first.");
  push(s, { role: "user", kind: "text", text: trimmed });
  return withBusy(s, () => replyToQuestion(s, trimmed));
}

function priorParaphrases(
  s: Session,
): { path: string; text: string }[] {
  const files = s.paraphrases.filter((p) => p.path !== "(wrap-up)").slice(-8);
  const wrapups = s.paraphrases.filter((p) => p.path === "(wrap-up)").slice(-4);
  return [...files, ...wrapups].map((p) => ({
    path: p.path,
    text: p.text.slice(0, 500),
  }));
}

function rememberParaphrase(s: Session, text: string): void {
  if (!s.card) return;
  if (s.paraphrases.some((p) => p.path === s.card!.path)) return;
  s.paraphrases.push({ path: s.card.path, text });
}

function rememberWrapupAttempt(s: Session, text: string): void {
  s.paraphrases.push({ path: "(wrap-up)", text });
}

export async function submitTeachback(
  id: string,
  text: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "file" && s.phase !== "wrapup") {
    throw new Error("Nothing to teach back right now.");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Write the paraphrase first.");

  push(s, { role: "user", kind: "text", text: trimmed });

  if (s.phase === "file" && s.card?.chase && !looksLikeQuestion(trimmed)) {
    return withBusy(s, async () => {
      s.teachback = {
        adequate: true,
        kind: "adequate",
        message: "Noted. Chase cards do not need a full teach-back.",
      };
      push(s, {
        role: "assistant",
        kind: "teachback",
        text: s.teachback.message,
      });
      s.paraphrasedCurrent = true;
      if (s.card && !s.covered.includes(s.card.path)) {
        s.covered.push(s.card.path);
      }
      await advanceToFile(s, nextQueueIndex(s));
    });
  }

  if (looksLikeQuestion(trimmed)) {
    return withBusy(s, () => replyToQuestion(s, trimmed));
  }

  if (s.phase === "file" && s.card) {
    const intent = skipIntent(trimmed, {
      pendingTests: pendingTestPaths(s.queue, s.covered).length,
    });
    if (intent === "this") {
      return skipCurrentFile(s, { alreadyPushed: true });
    }
    if (intent === "busywork") {
      return skipBusyworkFiles(s, { alreadyPushed: true });
    }
    if (intent === "rest") {
      return skipRestOfWalk(s, { alreadyPushed: true });
    }
  }

  return withBusy(s, async () => {
    const result =
      localThinTeachback(trimmed) ??
      (await withAgent(s, (agent) =>
        gradeTeachback({
          agent,
          text: trimmed,
          stage: s.phase === "wrapup" ? "wrapup" : "file",
          card: s.card,
          prior: priorParaphrases(s),
        }),
      ));
    s.teachback = result;
    push(s, {
      role: "assistant",
      kind: "teachback",
      text: result.message,
    });
    if (s.phase === "file") {
      if (result.kind === "adequate") {
        s.paraphrasedCurrent = true;
        if (s.card) {
          s.covered.push(s.card.path);
          rememberParaphrase(s, trimmed);
        }
        await advanceToFile(s, nextQueueIndex(s));
      } else if (result.kind === "question_after" && s.paraphrasedCurrent) {
        // stay; UI shows the answer and a Next control
      } else if (result.kind === "question_after") {
        s.paraphrasedCurrent = true;
        rememberParaphrase(s, trimmed);
      }
    } else if (result.kind === "adequate" || result.kind === "question_after") {
      s.phase = "done";
      await maybeWriteCommentary(s);
      push(s, {
        role: "assistant",
        kind: "status",
        text: `That’s the walk. Restore ${restoreTarget(s)} if the tree is clean.`,
      });
    } else if (result.kind === "thin") {
      rememberWrapupAttempt(s, trimmed);
    }
  });
}

async function replyToQuestion(s: Session, text: string): Promise<void> {
  const reply = await withAgent(s, (agent) =>
    answerFileQuestion({
      agent,
      text,
      card: s.card,
      stage: s.phase === "wrapup" ? "wrapup" : "file",
    }),
  );
  push(s, {
    role: "assistant",
    kind: "text",
    text: reply,
  });
}

export async function continueAfterQuestion(
  id: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "file" || !s.paraphrasedCurrent) {
    throw new Error("Explain the file before continuing.");
  }
  push(s, { role: "user", kind: "text", text: "Next file" });
  if (s.card && !s.covered.includes(s.card.path)) {
    s.covered.push(s.card.path);
  }
  return withBusy(s, async () => {
    await advanceToFile(s, nextQueueIndex(s));
  });
}

/** Concepts are cheap to detect but not persisted; rebuild after a restart. */
async function ensureConcepts(s: Session): Promise<RepoConcept[]> {
  if (!s.concepts) {
    s.concepts = await loadRepoConcepts(
      s.repoPath,
      s.files.map((f) => f.path),
    );
  }
  return s.concepts;
}

/**
 * Systems this path sits on, each tagged with how much scaffolding he needs
 * based on what earlier walks already taught him.
 */
async function conceptsForCard(
  s: Session,
  path: string,
): Promise<ConceptForCard[]> {
  const onPath = conceptsForPath(await ensureConcepts(s), path);
  if (!onPath.length) return [];
  const memory = await loadConceptMemory();
  const here = s.commentary?.key;
  return onPath.map((c) => {
    const seenIn = (memory.concepts[c.id]?.repos ?? []).filter(
      (repo) => repo !== here,
    );
    return {
      ...c,
      depth: conceptDepth(memory, c.id),
      seenIn: seenIn.slice(-3),
    };
  });
}

/** Concepts this walk taught, and the ones he engaged with in his own words. */
function conceptWalkTally(s: Session): { taught: string[]; engaged: string[] } {
  const concepts = s.concepts ?? [];
  if (!concepts.length) return { taught: [], engaged: [] };
  const taught: string[] = [];
  for (const card of s.cards) {
    if (!card.concept) continue;
    for (const c of conceptsForPath(concepts, card.path)) {
      if (!taught.includes(c.id)) taught.push(c.id);
    }
  }
  if (!taught.length) return { taught, engaged: [] };
  const hisWords = s.messages
    .filter((m) => m.role === "user" && typeof m.text === "string")
    .map((m) => m.text)
    .join("\n");
  const engaged = conceptsMentioned(
    concepts.filter((c) => taught.includes(c.id)),
    hisWords,
  );
  return { taught, engaged };
}

function nextQueueIndex(s: Session): number {
  const i = s.queue.findIndex((p) => !s.covered.includes(p));
  return i === -1 ? s.queue.length : i;
}

function coverPaths(s: Session, paths: string[]): string[] {
  const added: string[] = [];
  for (const path of paths) {
    if (!s.covered.includes(path)) {
      s.covered.push(path);
      added.push(path);
    }
  }
  return added;
}

function noteSkip(s: Session, message: string): void {
  s.teachback = {
    adequate: true,
    kind: "adequate",
    message,
  };
  push(s, {
    role: "assistant",
    kind: "teachback",
    text: s.teachback.message,
  });
}

async function finishSkip(
  s: Session,
  message: string,
): Promise<SessionSnapshot> {
  noteSkip(s, message);
  const current = s.card?.path;
  const next = nextQueueIndex(s);
  if (current && s.queue[next] === current) {
    return snapshot(s);
  }
  return withBusy(s, async () => {
    await advanceToFile(s, next);
  });
}

async function skipCurrentFile(
  s: Session,
  opts: { alreadyPushed: boolean },
): Promise<SessionSnapshot> {
  if (s.phase !== "file" || !s.card) {
    throw new Error("No file to skip.");
  }
  const path = s.card.path;
  if (!opts.alreadyPushed) {
    push(s, {
      role: "user",
      kind: "text",
      text: s.card.chase ? `Done looking at ${path}` : `Skip ${path}`,
    });
  }
  coverPaths(s, [path]);
  return finishSkip(
    s,
    s.card.chase ? `Done looking at ${path}.` : `Skipped ${path}.`,
  );
}

function busyworkPaths(s: Session): string[] {
  const paths = pendingTestPaths(s.queue, s.covered);
  if (s.card && isTestPath(s.card.path) && !paths.includes(s.card.path)) {
    return [s.card.path, ...paths];
  }
  return paths;
}

async function skipBusyworkFiles(
  s: Session,
  opts: { alreadyPushed: boolean },
): Promise<SessionSnapshot> {
  if (s.phase !== "file" || !s.card) {
    throw new Error("No file to skip.");
  }
  const paths = busyworkPaths(s);
  if (!paths.length) {
    if (!opts.alreadyPushed) {
      throw new Error("No remaining test files to skip.");
    }
    noteSkip(s, "No remaining test files to skip.");
    return snapshot(s);
  }
  if (!opts.alreadyPushed) {
    push(s, {
      role: "user",
      kind: "text",
      text: `Skip remaining tests (${paths.join(", ")})`,
    });
  }
  coverPaths(s, paths);
  const listed =
    paths.length <= 4
      ? paths.map((p) => `\`${p}\``).join(", ")
      : `${paths.length} test files`;
  return finishSkip(s, `Skipped ${listed}.`);
}

async function skipRestOfWalk(
  s: Session,
  opts: { alreadyPushed: boolean },
): Promise<SessionSnapshot> {
  if (s.phase !== "file" || !s.card) {
    throw new Error("No file to skip.");
  }
  const rest = s.queue.filter((p) => !s.covered.includes(p));
  if (!opts.alreadyPushed) {
    push(s, {
      role: "user",
      kind: "text",
      text: "Skip remaining files",
    });
  }
  coverPaths(s, rest);
  return finishSkip(
    s,
    rest.length === 1
      ? `Skipped \`${rest[0]}\`.`
      : `Skipped ${rest.length} remaining files.`,
  );
}

export async function skipFile(id: string): Promise<SessionSnapshot> {
  return skipCurrentFile(get(id), { alreadyPushed: false });
}

export async function skipBusywork(id: string): Promise<SessionSnapshot> {
  return skipBusyworkFiles(get(id), { alreadyPushed: false });
}

/** Open a changed file in the inspect pane without moving the walk gate. */
export async function browseFile(
  id: string,
  path: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "wrapup" && s.phase !== "done") {
    throw new Error("Browse files from the map during wrap-up (or after).");
  }
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Pick a file path.");
  if (s.card?.path === trimmed && s.fileText !== undefined) {
    return snapshot(s);
  }
  return withBusy(
    s,
    async () => {
      await loadInspectFile(s, trimmed);
    },
    `Opening ${trimmed}…`,
  );
}

async function loadInspectFile(s: Session, path: string): Promise<void> {
  if (s.headOid && !(await confirmHead(s.repoPath, s.headOid))) {
    throw new Error(
      "Worktree is no longer on this PR tip. Restore your branch or re-check out the PR before browsing files.",
    );
  }
  const entry = s.files.find((f) => f.path === path);
  if (!entry) throw new Error(`Unknown changed file: ${path}`);
  const prior = [...s.cards].reverse().find((c) => c.path === path);
  s.card = prior ?? browseCard(entry, s);
  s.probe = undefined;
  s.chaseCandidates = [];
  try {
    s.diffText = await fileDiff(s.repoPath, s.baseRef || "main", path);
  } catch {
    s.diffText = undefined;
  }
  if (entry.kind === "deleted") {
    s.fileText = undefined;
    s.fileWiring = undefined;
    s.focusLine = undefined;
    return;
  }
  try {
    s.fileText = await readWorktreeFile(s.repoPath, path);
  } catch {
    s.fileText = "// Could not read this path from HEAD.";
  }
  s.fileWiring = await computeFileWiring(s);
  s.focusLine =
    s.card.lookCloser[0]?.startLine || s.card.focus[0]?.start || 1;
}

function browseCard(
  entry: FileEntry,
  s: Session,
): NonNullable<Session["card"]> {
  return {
    path: entry.path,
    kind: entry.kind,
    oldPath: entry.oldPath,
    focus: [],
    what: "Reference view — this path was not given a full walk card (often skipped).",
    why: "Open it from the map to check symbols and wiring while finishing the summary.",
    links: "",
    lookCloser: [],
    couldHave: [],
    uhOh: [],
    index: s.covered.indexOf(entry.path) + 1 || s.cards.length,
    total: s.queue.length || s.files.length,
    chase: entry.chase,
    chaseFrom: entry.chaseFrom,
    chaseNames: entry.chaseNames,
  };
}

export async function startChase(
  id: string,
  paths?: string[],
): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "file" || !s.card) {
    throw new Error("Open a file before chasing callers.");
  }
  if (s.card.chase) {
    throw new Error("Chase does not recurse. Finish this caller first.");
  }
  const wanted = paths?.length
    ? s.chaseCandidates.filter((c) => paths.includes(c.path))
    : s.chaseCandidates;
  const pending = wanted
    .filter((c) => !s.queue.includes(c.path) && !s.covered.includes(c.path))
    .slice(0, 3);
  if (!pending.length) {
    throw new Error("No outside callers left to chase.");
  }
  const from = s.card.path;
  const at = s.queue.indexOf(from);
  const insertAt = at >= 0 ? at + 1 : s.queue.length;
  const added: string[] = [];
  for (const hit of pending) {
    s.queue.splice(insertAt + added.length, 0, hit.path);
    added.push(hit.path);
    if (!s.files.some((f) => f.path === hit.path)) {
      s.files.push({
        path: hit.path,
        kind: "modified",
        noise: false,
        asset: false,
        chase: true,
        chaseFrom: from,
        chaseNames: hit.names,
      });
    }
  }
  invalidateWiringIndex(s);
  s.chaseCandidates = s.chaseCandidates.filter(
    (c) => !added.includes(c.path),
  );
  push(s, {
    role: "user",
    kind: "text",
    text: `Chase ${added.join(", ")}`,
  });
  push(s, {
    role: "assistant",
    kind: "status",
    text: `Queued chase after this file: ${added.map((p) => `\`${p}\``).join(", ")}. Thin cards — skip or done looking is enough.`,
  });
  persist(s);
  return snapshot(s);
}

async function ensureCommentary(s: Session): Promise<CommentaryBundle> {
  if (!s.commentary) {
    s.commentary = await loadCommentary(s.repoPath);
  }
  return s.commentary;
}

function commentaryEvidence(s: Session): string {
  const files = s.cards.map((c) => {
    const uhs = (c.uhOh ?? []).map((u) => u.text).join("; ");
    const what = (c.what || "").slice(0, 240);
    return `- ${c.path}: ${what}${uhs ? ` | uh-oh: ${uhs.slice(0, 200)}` : ""}`;
  });
  const skips = s.messages
    .filter(
      (m) =>
        m.role === "user" &&
        typeof m.text === "string" &&
        m.text.startsWith("Skip "),
    )
    .map((m) => m.text);
  const wrapIdx = s.messages.findIndex((m) => m.kind === "wrapup");
  const wrapParaphrase =
    wrapIdx >= 0
      ? s.messages
          .slice(wrapIdx + 1)
          .filter((m) => m.role === "user" && m.kind === "text")
          .map((m) => m.text)
          .join("\n")
          .slice(0, 2000)
      : "";
  const lingering = s.wrapup?.lingeringUhOhs || "";
  return [
    s.prTitle ? `PR: ${s.prTitle}` : "",
    s.prUrl ? `URL: ${s.prUrl}` : "",
    `Checkout: ${s.repoPath}`,
    s.overview
      ? `What's happening: ${s.overview.whatsHappening.slice(0, 600)}`
      : "",
    s.overview ? `Why: ${s.overview.why.slice(0, 400)}` : "",
    `Covered: ${s.covered.join(", ") || "(none)"}`,
    s.concepts?.length
      ? `Systems this checkout runs on (detected): ${s.concepts
          .map((c) => c.name)
          .join(", ")}`
      : "",
    `Files:\n${files.join("\n") || "(none)"}`,
    skips.length ? `Skipped:\n${skips.join("\n")}` : "",
    lingering ? `Lingering uh-ohs:\n${lingering.slice(0, 1500)}` : "",
    wrapParaphrase
      ? `Wrap-up from Graham:\n${wrapParaphrase}`
      : "(no wrap-up paraphrase yet)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Private notes stay in this app's data/ folder — never the reviewed tree. */
async function maybeWriteCommentary(s: Session): Promise<void> {
  if (s.commentaryWritten) return;
  if (!s.cards.length && !s.wrapup) return;
  try {
    const bundle = await ensureCommentary(s);
    await withAgent(s, (agent) =>
      updateWalkCommentary({
        agent,
        bundle,
        evidence: commentaryEvidence(s),
      }),
    );
    s.commentaryWritten = true;
    s.commentary = await loadCommentary(s.repoPath);
  } catch {
    // Best-effort. A failed notes rewrite must not fail the walk.
  }
  await maybeRecordConcepts(s);
}

/**
 * Mark what this walk taught against his profile so the next walk can pitch the
 * same system deeper instead of re-explaining it from scratch.
 */
async function maybeRecordConcepts(s: Session): Promise<void> {
  if (s.conceptsRecorded) return;
  const { taught, engaged } = conceptWalkTally(s);
  if (!taught.length) return;
  try {
    const memory = await loadConceptMemory();
    await saveConceptMemory(
      recordConceptWalk(memory, {
        taught,
        engaged,
        repoKey: s.commentary?.key ?? "",
      }),
    );
    s.conceptsRecorded = true;
  } catch {
    // Best-effort. Losing a tally must not fail the walk.
  }
}

function restoreTarget(s: Session): string {
  // Prefer the branch they were on when the walk started (often a WIP
  // feature branch). Never the PR tip; fall back to repo default.
  return s.homeBranch || "main";
}

export async function restoreBranch(
  id: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  const branch = restoreTarget(s);
  push(s, {
    role: "user",
    kind: "text",
    text: `Restore ${branch}`,
  });
  return withBusy(s, async () => {
    await maybeWriteCommentary(s);
    await checkoutBranch(s.repoPath, branch);
    s.phase = "done";
    s.homeRestored = true;
    await s.agent?.close();
    s.agent = undefined;
    push(s, {
      role: "assistant",
      kind: "status",
      text: `Back on ${branch}.`,
    });
  });
}

function getAnnotation(s: Session, annotationId: string): Annotation {
  const found = s.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error("Unknown annotation.");
  return found;
}

export async function createAnnotation(
  id: string,
  input: {
    kind: AnnotationKind;
    path: string;
    startLine: number;
    endLine: number;
    selectedText: string;
    body: string;
  },
): Promise<SessionSnapshot> {
  const s = get(id);
  const body = input.body.trim();
  if (!body) throw new Error("Write a question or comment first.");
  const annotation: Annotation = {
    id: randomUUID(),
    kind: input.kind,
    status: "open",
    path: input.path,
    startLine: input.startLine,
    endLine: input.endLine,
    selectedText: input.selectedText,
    body,
    replies: [],
    at: Date.now(),
  };
  s.annotations.push(annotation);
  push(s, {
    role: "user",
    kind: "annotation",
    text:
      input.kind === "question"
        ? `Q on ${input.path} L${input.startLine}–L${input.endLine}: ${body}`
        : `Comment on ${input.path} L${input.startLine}–L${input.endLine}: ${body}`,
    annotationId: annotation.id,
  });
  return withBusy(s, async () => {
    const reply = await withAgent(s, (agent) =>
      answerAnnotation({
        agent,
        kind: annotation.kind,
        path: annotation.path,
        startLine: annotation.startLine,
        endLine: annotation.endLine,
        selectedText: annotation.selectedText,
        body: annotation.body,
      }),
    );
    annotation.replies.push({
      id: randomUUID(),
      role: "assistant",
      text: reply,
      at: Date.now(),
    });
    push(s, {
      role: "assistant",
      kind: "annotation",
      text: reply,
      annotationId: annotation.id,
    });
  });
}

export async function replyAnnotation(
  id: string,
  annotationId: string,
  text: string,
): Promise<SessionSnapshot> {
  const s = get(id);
  const annotation = getAnnotation(s, annotationId);
  if (annotation.status === "resolved") {
    throw new Error("That note is resolved.");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Write a follow-up first.");
  annotation.replies.push({
    id: randomUUID(),
    role: "user",
    text: trimmed,
    at: Date.now(),
  });
  push(s, {
    role: "user",
    kind: "annotation",
    text: trimmed,
    annotationId,
  });
  return withBusy(s, async () => {
    const reply = await withAgent(s, (agent) =>
      answerAnnotation({
        agent,
        kind: annotation.kind,
        path: annotation.path,
        startLine: annotation.startLine,
        endLine: annotation.endLine,
        selectedText: annotation.selectedText,
        body: `${annotation.body}\n\nFollow-up: ${trimmed}`,
      }),
    );
    annotation.replies.push({
      id: randomUUID(),
      role: "assistant",
      text: reply,
      at: Date.now(),
    });
    push(s, {
      role: "assistant",
      kind: "annotation",
      text: reply,
      annotationId,
    });
  });
}

export function resolveAnnotation(
  id: string,
  annotationId: string,
): SessionSnapshot {
  const s = get(id);
  const annotation = getAnnotation(s, annotationId);
  annotation.status = "resolved";
  push(s, {
    role: "user",
    kind: "annotation",
    text: `Resolved ${annotation.kind} on ${annotation.path} L${annotation.startLine}–L${annotation.endLine}`,
    annotationId,
  });
  persist(s);
  return snapshot(s);
}

export async function suggestProbeArgs(
  id: string,
  line: number,
  signal?: AbortSignal,
): Promise<ProbeArgSuggestion> {
  const s = get(id);
  if (!s.card || !s.fileText) {
    throw new Error("Open a file before probing a function.");
  }
  return suggestArgs({
    repoPath: s.repoPath,
    path: s.card.path,
    fileText: s.fileText,
    line,
    signal,
  });
}

/**
 * What a function does and why, for the sandbox's About tab. Facts come from the
 * checkout, the prose from the agent reading those facts alongside the repo's
 * concept and commentary notes. Cached per function: the reviewer will open the
 * tab more than once while editing.
 */
export async function explainFunction(
  id: string,
  line: number,
  signal?: AbortSignal,
  /** An explicit re-ask: skip the cache and put the question again. */
  refresh = false,
): Promise<FunctionBrief> {
  const s = get(id);
  if (!s.card || !s.fileText) {
    throw new Error("Open a file before asking about a function.");
  }
  const path = s.card.path;
  const fn = functionAtLine(s.fileText, line, path);
  if (!fn) {
    throw new Error("No function found at that line.");
  }
  const key = probeId(path, fn.startLine);
  const cached = refresh ? undefined : s.briefs?.get(key);
  if (cached) return cached;

  const source = s.fileText
    .split("\n")
    .slice(fn.startLine - 1, fn.endLine)
    .join("\n");
  const facts = await functionFacts(s, fn, signal);
  if (!s.agent) {
    throw new Error(
      "The walkthrough agent is not running. Check out a PR to get an explanation.",
    );
  }
  const concepts = await conceptsForCard(s, path);
  const prose = await explainFunctionProse({
    agent: s.agent,
    path,
    name: fn.name,
    source,
    facts,
    card: s.card,
    concepts,
    commentary: await ensureCommentary(s),
  });
  const brief: FunctionBrief = {
    id: key,
    name: fn.name,
    facts,
    ...prose,
    conceptName: prose.concept ? concepts[0]?.name : undefined,
  };
  s.briefs ??= new Map();
  s.briefs.set(key, brief);
  return brief;
}

/** Everything about the function we can establish without asking the model. */
async function functionFacts(
  s: Session,
  fn: FnBlock,
  signal?: AbortSignal,
): Promise<string[]> {
  const path = s.card!.path;
  const facts: string[] = [
    `Signature: ${fn.header.trim()}`,
    `Lines ${fn.startLine}–${fn.endLine} of ${path} (${fn.endLine - fn.startLine + 1} lines).`,
  ];

  const doc = docComment(s.fileText!, fn.startLine);
  if (doc) facts.push(`Comment above it: ${doc}`);

  const exported = s.fileWiring?.exports.find((e) => e.name === fn.name);
  facts.push(
    exported
      ? `Exported from this file (${exported.kind}), so callers outside it can reach it.`
      : "Not exported: only this file can call it.",
  );

  const body = s.fileText!
    .split("\n")
    .slice(fn.startLine - 1, fn.endLine)
    .join("\n");
  const used = (s.fileWiring?.imports ?? []).flatMap((imp) =>
    imp.names
      .filter((name) => new RegExp(`\\b${escapeRe(name)}\\b`).test(body))
      .map((name) => `${name} from ${imp.from}`),
  );
  if (used.length) {
    facts.push(`Imports it uses: ${used.slice(0, 6).join(", ")}.`);
  }

  const callers = await findCallers({
    repoPath: s.repoPath,
    path,
    name: fn.name,
    signal,
  });
  const inChange = new Set(s.files.map((f) => f.path));
  const real = callers.filter((c) => !c.test);
  facts.push(
    callers.length === 0
      ? "Nothing in the checkout calls it by name (it may be a handler, an export for another package, or called dynamically)."
      : `Called from: ${callers
          .slice(0, 6)
          .map(
            (c) =>
              `${c.path}:${c.line}${c.test ? " (test)" : ""}${inChange.has(c.path) ? " [changed in this PR]" : ""}`,
          )
          .join(", ")}${callers.length > 6 ? `, +${callers.length - 6} more` : ""}.`,
  );
  if (callers.length && real.length === 0) {
    facts.push("Every caller is a test: nothing in production calls it yet.");
  }

  const focus = s.card!.focus.some(
    (r) => r.start <= fn.endLine && r.end >= fn.startLine,
  );
  facts.push(
    focus
      ? "This PR changes lines inside this function."
      : "This PR does not change lines inside this function.",
  );
  return facts;
}

/** The JSDoc or comment block sitting directly above the header. */
function docComment(fileText: string, startLine: number): string | undefined {
  const lines = fileText.split("\n");
  const out: string[] = [];
  for (let i = startLine - 2; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) break;
    if (line.startsWith("//") || line.startsWith("#")) {
      out.unshift(line.replace(/^(\/\/|#)\s?/, ""));
      continue;
    }
    if (line.endsWith("*/") || line.startsWith("*") || line.startsWith("/*")) {
      out.unshift(line.replace(/^\/?\*+\/?/, "").replace(/\*\/$/, "").trim());
      if (line.startsWith("/*")) break;
      continue;
    }
    break;
  }
  const text = out.filter(Boolean).join(" ").trim();
  return text ? text.slice(0, 500) : undefined;
}

export async function probeFunction(
  id: string,
  input: { line: number; args: unknown[]; source?: string },
): Promise<SessionSnapshot> {
  const s = get(id);
  if (!s.card || !s.fileText) {
    throw new Error("Open a file before probing a function.");
  }
  return withBusy(s, async () => {
    const result = await runFunction({
      repoPath: s.repoPath,
      path: s.card!.path,
      fileText: s.fileText!,
      line: input.line,
      args: input.args,
      source: input.source,
    });
    s.probe = result;
    push(s, {
      role: "assistant",
      kind: "probe",
      text: result.error
        ? `${result.name} failed: ${result.error}`
        : `${result.name}(${JSON.stringify(result.args)}) → ${result.result}`,
    });
  });
} 

export async function cancelWork(id: string): Promise<SessionSnapshot> {
  const s = get(id);
  s.cancel?.abort();
  s.workingOn = s.busy ? "Stopping…" : undefined;
  try {
    await s.agent?.close();
  } catch {
    // already closed
  }
  s.agent = undefined;
  persist(s);
  return snapshot(s);
}

export async function quit(id: string): Promise<SessionSnapshot> {
  const s = get(id);
  push(s, { role: "user", kind: "text", text: "Quit" });
  return withBusy(s, async () => {
    s.phase = "done";
    await maybeWriteCommentary(s);
    await s.agent?.close();
    s.agent = undefined;
    push(s, {
      role: "assistant",
      kind: "status",
      text: `Stopped. Restore ${restoreTarget(s)} if the tree is clean.`,
    });
  }, "Updating private notes…");
}
