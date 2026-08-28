export type Phase =
  | "blocked_dirty"
  | "blocked_large"
  | "overview"
  | "file"
  | "wrapup"
  | "done";

export type FileKind = "new" | "modified" | "deleted" | "renamed";

export interface FileEntry {
  path: string;
  oldPath?: string;
  kind: FileKind;
  noise: boolean;
  asset: boolean;
  chase?: boolean;
  chaseFrom?: string;
  chaseNames?: string[];
}

export interface LookCloser {
  name: string;
  startLine: number;
  endLine: number;
  why: string;
}

export interface UhOh {
  text: string;
  startLine: number;
  endLine: number;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface Overview {
  branch: string;
  prUrl?: string;
  whatsHappening: string;
  why: string;
  dependencies: string;
  howItConnects: string;
  queue: string[];
  assetsNote?: string;
  noiseNote?: string;
  repoNote?: string;
}

export interface FileCard {
  path: string;
  kind: FileKind;
  oldPath?: string;
  focus: LineRange[];
  diffUrl?: string;
  what: string;
  why: string;
  roleInPr?: string;
  concept?: string;
  wiringNote?: string;
  links: string;
  lookCloser: LookCloser[];
  map?: string;
  couldHave: string[];
  uhOh: UhOh[];
  index: number;
  total: number;
  chase?: boolean;
  chaseFrom?: string;
  chaseNames?: string[];
}

export interface ChaseCandidate {
  path: string;
  names: string[];
}

export interface Wrapup {
  lingeringUhOhs: string;
  designForks?: string;
}

export type WiringSymbolKind =
  | "function"
  | "class"
  | "component"
  | "const"
  | "type"
  | "default"
  | "reexport";

export interface WiringImport {
  names: string[];
  from: string;
  resolvedPath?: string;
  external: boolean;
  line: number;
}

export interface WiringExport {
  name: string;
  kind: WiringSymbolKind;
  line: number;
  consumers: string[];
}

export interface FileWiring {
  imports: WiringImport[];
  exports: WiringExport[];
  note?: string;
}

export interface TeachbackResult {
  adequate: boolean;
  kind: "adequate" | "thin" | "question_before" | "question_after";
  message: string;
}

export type MessageRole = "user" | "assistant";

export type MessageKind =
  | "text"
  | "dirty"
  | "large"
  | "overview"
  | "file"
  | "wrapup"
  | "teachback"
  | "status"
  | "annotation"
  | "probe";

export type AnnotationKind = "question" | "comment";
export type AnnotationStatus = "open" | "resolved";

export interface AnnotationReply {
  id: string;
  role: MessageRole;
  text: string;
  at: number;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  status: AnnotationStatus;
  path: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  body: string;
  replies: AnnotationReply[];
  at: number;
}

/**
 * What a function does and why, for the sandbox's About tab. Facts are parsed
 * from the checkout; the prose is the agent reading those facts plus the repo's
 * concept and commentary notes.
 */
export interface FunctionBrief {
  /** path:startLine, so a result cannot land in the wrong sandbox. */
  id: string;
  name: string;
  what: string;
  why: string;
  /** The architectural system this function sits on, taught at his depth. */
  concept?: string;
  conceptName?: string;
  /** One evidence-backed caution, when there is one worth having. */
  watch?: string;
  /** Parsed from the checkout: signature, doc comment, callers, imports used. */
  facts: string[];
}

export interface ProbeArgSuggestion {
  args: unknown[];
  note: string;
  source?: string;
  kind: "test" | "fixture" | "callsite" | "shape" | "placeholder";
}

export interface ProbeResult {
  /** Identifies the run's target: path plus the function's line on disk. */
  id: string;
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  language: "js" | "ts" | "py" | "unknown";
  params: string[];
  header: string;
  args?: unknown[];
  /** The code that actually ran, edits included. */
  source?: string;
  result?: string;
  stdout?: string;
  error?: string;
}

export interface FnBlock {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  language: "js" | "ts" | "py" | "unknown";
  params: string[];
  header: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  at: number;
  overview?: Overview;
  card?: FileCard;
  wrapup?: Wrapup;
  large?: { files: number; churn: string; excluded: string };
  annotationId?: string;
}

export interface SessionSnapshot {
  id: string;
  phase: Phase;
  repoPath: string;
  homeBranch?: string;
  prRef: string;
  prUrl?: string;
  baseRef?: string;
  dirtyStatus?: string;
  large?: { files: number; churn: string; excluded: string };
  overview?: Overview;
  card?: FileCard;
  wrapup?: Wrapup;
  teachback?: TeachbackResult;
  fileText?: string;
  diffText?: string;
  fileWiring?: FileWiring;
  focusLine?: number;
  files: FileEntry[];
  queue: string[];
  covered: string[];
  chaseCandidates?: ChaseCandidate[];
  messages: ChatMessage[];
  annotations: Annotation[];
  probe?: ProbeResult;
  busy: boolean;
  workingOn?: string;
  error?: string;
  agentId?: string;
  homeRestored?: boolean;
}

export interface AuthStatus {
  hasKey: boolean;
  configured: boolean;
  models?: string[];
  error?: string;
}
