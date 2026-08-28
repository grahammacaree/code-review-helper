import type {
  AuthStatus,
  FunctionBrief,
  ProbeArgSuggestion,
  SessionSnapshot,
} from "./types";

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || res.statusText);
  }
  return body;
}

/**
 * A refused connection means the API is not up. Say so, rather than leaving the
 * browser's "Failed to fetch" for the reviewer to decode.
 */
async function call<T>(
  input: string,
  init?: RequestInit,
  parseAs: (res: Response) => Promise<T> = (res) => parse<T>(res),
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(
      "Cannot reach the walkthrough API. Start it with `npm run dev`.",
    );
  }
  return parseAs(res);
}

export function getAuth(): Promise<AuthStatus> {
  return call<AuthStatus>("/api/auth");
}

export function createSession(
  input: {
    repoPath: string;
    pr: string;
    allowStash?: boolean;
  },
  signal?: AbortSignal,
): Promise<SessionSnapshot> {
  return call<SessionSnapshot>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export function getSession(
  id: string,
  opts?: { lite?: boolean; signal?: AbortSignal },
): Promise<SessionSnapshot> {
  const q = opts?.lite ? "?lite=1" : "";
  return call<SessionSnapshot>(`/api/sessions/${id}${q}`, {
    signal: opts?.signal,
  });
}

function post(
  id: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<SessionSnapshot> {
  return call<SessionSnapshot>(`/api/sessions/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
    signal,
  });
}

export const api = {
  get: getSession,
  stash: (id: string, signal?: AbortSignal) => post(id, "stash", undefined, signal),
  large: (id: string, choice: "quit" | "core" | "all", signal?: AbortSignal) =>
    post(id, "large", { choice }, signal),
  start: (id: string, signal?: AbortSignal) => post(id, "start", undefined, signal),
  ask: (id: string, text: string, signal?: AbortSignal) =>
    post(id, "ask", { text }, signal),
  teachback: (id: string, text: string, signal?: AbortSignal) =>
    post(id, "teachback", { text }, signal),
  next: (id: string, signal?: AbortSignal) => post(id, "next", undefined, signal),
  skip: (id: string, signal?: AbortSignal) => post(id, "skip", undefined, signal),
  skipTests: (id: string, signal?: AbortSignal) =>
    post(id, "skip-tests", undefined, signal),
  browse: (id: string, path: string, signal?: AbortSignal) =>
    post(id, "browse", { path }, signal),
  chase: (id: string, paths?: string[], signal?: AbortSignal) =>
    post(id, "chase", paths ? { paths } : {}, signal),
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
  probe: (
    id: string,
    line: number,
    args: unknown[],
    source?: string,
    signal?: AbortSignal,
  ) => post(id, "probe", { line, args, source }, signal),
  probeArgs: (
    id: string,
    line: number,
    signal?: AbortSignal,
  ): Promise<ProbeArgSuggestion> =>
    call<ProbeArgSuggestion>(`/api/sessions/${id}/probe-args?line=${line}`, {
      signal,
    }),
  functionBrief: (
    id: string,
    line: number,
    signal?: AbortSignal,
    refresh?: boolean,
  ): Promise<FunctionBrief> =>
    call<FunctionBrief>(
      `/api/sessions/${id}/function-brief?line=${line}${refresh ? "&refresh=1" : ""}`,
      { signal },
    ),
};
