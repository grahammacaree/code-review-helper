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
}

export interface FileCard {
  path: string;
  kind: FileKind;
  oldPath?: string;
  focus: LineRange[];
  diffUrl?: string;
  what: string;
  why: string;
  links: string;
  lookCloser: LookCloser[];
  map?: string;
  couldHave: string[];
  uhOh: UhOh[];
  index: number;
  total: number;
}

export interface Wrapup {
  lingeringUhOhs: string;
  designForks?: string;
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

export interface ProbeArgSuggestion {
  args: unknown[];
  note: string;
  source?: string;
  kind: "test" | "fixture" | "placeholder";
}

export interface ProbeResult {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  language: "js" | "ts" | "py" | "unknown";
  params: string[];
  header: string;
  args?: unknown[];
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
  startingBranch: string;
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
  focusLine?: number;
  files: FileEntry[];
  queue: string[];
  covered: string[];
  messages: ChatMessage[];
  annotations: Annotation[];
  probe?: ProbeResult;
  busy: boolean;
  workingOn?: string;
  error?: string;
  agentId?: string;
}

export interface AuthStatus {
  hasKey: boolean;
  configured: boolean;
  models?: string[];
  error?: string;
}
