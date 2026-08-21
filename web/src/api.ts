import type { AuthStatus, ProbeArgSuggestion, SessionSnapshot } from "./types";

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || res.statusText);
  }
  return body;
}

export function getAuth(): Promise<AuthStatus> {
  return fetch("/api/auth").then((r) => parse<AuthStatus>(r));
}

export function createSession(
  input: {
    repoPath: string;
    pr: string;
    allowStash?: boolean;
  },
  signal?: AbortSignal,
): Promise<SessionSnapshot> {
  return fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  }).then((r) => parse<SessionSnapshot>(r));
}

export function getSession(
  id: string,
  opts?: { lite?: boolean; signal?: AbortSignal },
): Promise<SessionSnapshot> {
  const q = opts?.lite ? "?lite=1" : "";
  return fetch(`/api/sessions/${id}${q}`, { signal: opts?.signal }).then((r) =>
    parse<SessionSnapshot>(r),
  );
}

function post(
  id: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<SessionSnapshot> {
  return fetch(`/api/sessions/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
    signal,
  }).then((r) => parse<SessionSnapshot>(r));
}

export const api = {
  get: getSession,
  stash: (id: string, signal?: AbortSignal) => post(id, "stash", undefined, signal),
  large: (id: string, choice: "quit" | "core" | "all", signal?: AbortSignal) =>
    post(id, "large", { choice }, signal),
  start: (id: string, signal?: AbortSignal) => post(id, "start", undefined, signal),
  teachback: (id: string, text: string, signal?: AbortSignal) =>
    post(id, "teachback", { text }, signal),
  next: (id: string, signal?: AbortSignal) => post(id, "next", undefined, signal),
  skip: (id: string, signal?: AbortSignal) => post(id, "skip", undefined, signal),
  restore: (id: string, signal?: AbortSignal) =>
    post(id, "restore", undefined, signal),
  quit: (id: string, signal?: AbortSignal) => post(id, "quit", undefined, signal),
  cancel: (id: string) => post(id, "cancel"),
  annotate: (
    id: string,
    input: {
      kind: "question" | "comment";
      path: string;
      startLine: number;
      endLine: number;
      selectedText: string;
      body: string;
    },
    signal?: AbortSignal,
  ) => post(id, "annotations", input, signal),
  replyAnnotation: (
    id: string,
    annotationId: string,
    text: string,
    signal?: AbortSignal,
  ) => post(id, `annotations/${annotationId}/reply`, { text }, signal),
  resolveAnnotation: (id: string, annotationId: string) =>
    post(id, `annotations/${annotationId}/resolve`),
  probe: (id: string, line: number, args: unknown[], signal?: AbortSignal) =>
    post(id, "probe", { line, args }, signal),
  probeArgs: (
    id: string,
    line: number,
    signal?: AbortSignal,
  ): Promise<ProbeArgSuggestion> =>
    fetch(`/api/sessions/${id}/probe-args?line=${line}`, { signal }).then((r) =>
      parse<ProbeArgSuggestion>(r),
    ),
};
