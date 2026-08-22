import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  answerAnnotation,
  createReviewAgent,
  generateFileCard,
  generateOverview,
  gradeTeachback,
  answerFileQuestion,
} from "./agent.js";
import { runFunction } from "./probe.js";
import { suggestArgs } from "./samples.js";
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
  localThinTeachback,
  looksLikeQuestion,
  noiseNote,
  walkQueue,
  wrapupFromCards,
} from "./scaffold.js";
import type { RiskHit } from "./risk.js";
import { readAllSessions, writeSession } from "./store.js";
import type {
  Annotation,
  AnnotationKind,
  ChatMessage,
  FileCard,
  FileEntry,
  FileWiring,
  MessageKind,
  MessageRole,
  Phase,
  ProbeArgSuggestion,
  ProbeResult,
  SessionSnapshot,
  TeachbackResult,
} from "./types.js";
import { analyzeFileWiring, buildImportIndex, formatWiringNote } from "./wiring.js";
import type { WiringImport } from "./wiring.js";

type LocalAgent = Awaited<ReturnType<typeof createReviewAgent>>;

interface Session {
  id: string;
  phase: Phase;
  repoPath: string;
  homeBranch: string;
  prRef: string;
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  baseRef?: string;
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
  homeRestored: boolean;
  cancel?: AbortController;
  wiringImportIndex?: Map<string, WiringImport[]>;
  wiringImportScopeKey?: string;
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
    try {
      s.homeBranch = await defaultBranch(s.repoPath);
    } catch {
      s.homeBranch = s.homeBranch || "main";
    }
    if (s.card) {
      try {
        s.fileText = await readWorktreeFile(s.repoPath, s.card.path);
        if (s.baseRef) {
          s.diffText = await fileDiff(s.repoPath, s.baseRef, s.card.path);
        }
        s.fileWiring = await computeFileWiring(s);
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
    dirtyStatus: o.dirtyStatus,
    large: o.large,
    files: o.files ?? [],
    queue: o.queue ?? [],
    covered: o.covered ?? [],
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
    wiringNote: formatWiringNote(wiring),
  };
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

  const homeBranch = await defaultBranch(repoPath);
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
    cards: [],
    messages: [],
    annotations: [],
    busy: false,
    paraphrasedCurrent: false,
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
  if (index >= s.queue.length) {
    s.workingOn = "Writing wrap-up…";
    s.wrapup = wrapupFromCards(s.cards);
    s.card = undefined;
    s.fileText = undefined;
    s.diffText = undefined;
    s.fileWiring = undefined;
    s.focusLine = undefined;
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
  const card = await withAgent(s, (agent) =>
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

  if (looksLikeQuestion(trimmed)) {
    return withBusy(s, () => replyToQuestion(s, trimmed));
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
        if (s.card) s.covered.push(s.card.path);
        await advanceToFile(s, s.covered.length);
      } else if (result.kind === "question_after" && s.paraphrasedCurrent) {
        // stay; UI shows the answer and a Next control
      } else if (result.kind === "question_after") {
        s.paraphrasedCurrent = true;
      }
    } else if (result.kind === "adequate" || result.kind === "question_after") {
      s.phase = "done";
      push(s, {
        role: "assistant",
        kind: "status",
        text: `That’s the walk. Restore ${restoreTarget(s)} if the tree is clean.`,
      });
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
    await advanceToFile(s, s.covered.length);
  });
}

export async function skipFile(id: string): Promise<SessionSnapshot> {
  const s = get(id);
  if (s.phase !== "file" || !s.card) {
    throw new Error("No file to skip.");
  }
  push(s, {
    role: "user",
    kind: "text",
    text: `Skip ${s.card.path}`,
  });
  s.covered.push(s.card.path);
  s.teachback = {
    adequate: true,
    kind: "adequate",
    message: `Skipped ${s.card.path}.`,
  };
  push(s, {
    role: "assistant",
    kind: "teachback",
    text: s.teachback.message,
  });
  return withBusy(s, async () => {
    await advanceToFile(s, s.covered.length);
  });
}

function restoreTarget(s: Session): string {
  // Stacked PRs base on a parent feature branch; send them home to the
  // repo default (usually main), not the PR base.
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

export async function probeFunction(
  id: string,
  input: { line: number; args: unknown[] },
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
  s.phase = "done";
  await s.agent?.close();
  s.agent = undefined;
  push(s, {
    role: "assistant",
    kind: "status",
    text: `Stopped. Restore ${restoreTarget(s)} if the tree is clean.`,
  });
  persist(s);
  return snapshot(s);
}
