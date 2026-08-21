import { useEffect, useRef, useState } from "react";
import { api, createSession, getAuth } from "./api";
import { ChatColumn } from "./components/ChatColumn";
import type { ChipAction } from "./components/CommandBox";
import { FileInspect, type FileTab } from "./components/FileInspect";
import { InspectSplit } from "./components/InspectSplit";
import { RepoMap } from "./components/RepoMap";
import { loadRecentRepos, rememberRepo, displayRepo } from "./recents";
import type { AuthStatus, LookCloser, SessionSnapshot } from "./types";

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [recentRepos, setRecentRepos] = useState<string[]>(() =>
    loadRecentRepos(),
  );
  const [pr, setPr] = useState("");
  const [tab, setTab] = useState<FileTab>("file");
  const [focusLine, setFocusLine] = useState<number | undefined>();
  const [walkNote, setWalkNote] = useState<LookCloser | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getAuth()
      .then(setAuth)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  useEffect(() => {
    setFocusLine(session?.focusLine);
  }, [session?.card?.path, session?.focusLine]);

  useEffect(() => {
    setWalkNote(null);
  }, [session?.card?.path]);

  useEffect(() => {
    if (session?.card?.path) setTab("file");
  }, [session?.card?.path]);

  useEffect(() => {
    if (!busy || !session?.id) return;
    const id = session.id;
    const timer = window.setInterval(() => {
      void api
        .get(id, { lite: true })
        .then((next) => setSession((prev) => mergeLiteSnapshot(prev, next)))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [busy, session?.id]);

  async function run(
    fn: (signal: AbortSignal) => Promise<SessionSnapshot>,
  ): Promise<void> {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      setSession(await fn(ac.signal));
    } catch (err) {
      if (ac.signal.aborted) {
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function onInterrupt() {
    abortRef.current?.abort();
    if (session) {
      void api.cancel(session.id).then(setSession).catch(() => undefined);
    }
    setBusy(false);
  }

  function onLookCloser(hotspot: LookCloser) {
    setTab("file");
    setFocusLine(hotspot.startLine);
    setWalkNote((cur) =>
      cur &&
      cur.startLine === hotspot.startLine &&
      cur.endLine === hotspot.endLine &&
      cur.why === hotspot.why
        ? null
        : hotspot,
    );
  }

  function onSend(text: string) {
    if (!session) return;
    void run((signal) => api.teachback(session.id, text, signal));
  }

  function onAction(action: ChipAction) {
    if (action === "reset") {
      setSession(null);
      setError(null);
      return;
    }
    if (!session) return;
    const id = session.id;
    if (action === "stash") void run((signal) => api.stash(id, signal));
    else if (action === "quit") void run((signal) => api.quit(id, signal));
    else if (action === "core") void run((signal) => api.large(id, "core", signal));
    else if (action === "all") void run((signal) => api.large(id, "all", signal));
    else if (action === "start") void run((signal) => api.start(id, signal));
    else if (action === "skip") void run((signal) => api.skip(id, signal));
    else if (action === "next") void run((signal) => api.next(id, signal));
    else if (action === "restore") void run((signal) => api.restore(id, signal));
  }

  const working = busy || Boolean(session?.busy);

  return (
    <div className="app">
      <ChatColumn
        auth={auth}
        session={session}
        error={error}
        busy={working}
        workLabel={session?.workingOn}
        repoPath={repoPath}
        recentRepos={recentRepos}
        pr={pr}
        onRepoPath={setRepoPath}
        onPr={setPr}
        onCheckout={() => {
          void run(async (signal) => {
            const snap = await createSession({ repoPath, pr }, signal);
            setRecentRepos(rememberRepo(snap.repoPath));
            setRepoPath(displayRepo(snap.repoPath));
            return snap;
          });
        }}
        onSend={onSend}
        onAction={onAction}
        onInterrupt={onInterrupt}
        onLookCloser={onLookCloser}
      />
      <InspectSplit
        top={
          <RepoMap
            files={session?.files ?? []}
            queue={session?.queue ?? []}
            covered={session?.covered ?? []}
            currentPath={session?.card?.path}
            howItConnects={session?.overview?.howItConnects}
          />
        }
        bottom={
          <FileInspect
            card={session?.card}
            fileText={session?.fileText}
            diffText={session?.diffText}
            focusLine={focusLine}
            walkNote={walkNote}
            tab={tab}
            annotations={session?.annotations ?? []}
            probe={session?.probe}
            busy={working}
            onTab={setTab}
            onAnnotate={(input) => {
              if (!session?.card) return;
              void run((signal) =>
                api.annotate(
                  session.id,
                  { ...input, path: session.card!.path },
                  signal,
                ),
              );
            }}
            onReply={(annotationId, text) => {
              if (!session) return;
              void run((signal) =>
                api.replyAnnotation(session.id, annotationId, text, signal),
              );
            }}
            onResolve={(annotationId) => {
              if (!session) return;
              void run(() => api.resolveAnnotation(session.id, annotationId));
            }}
            onProbe={(line, args) => {
              if (!session) return;
              void run((signal) => api.probe(session.id, line, args, signal));
            }}
            onSuggestArgs={(line, signal) => {
              if (!session) {
                return Promise.reject(new Error("No session."));
              }
              return api.probeArgs(session.id, line, signal);
            }}
            onLookCloser={onLookCloser}
            onCloseWalkNote={() => setWalkNote(null)}
          />
        }
      />
    </div>
  );
}

function mergeLiteSnapshot(
  prev: SessionSnapshot | null,
  next: SessionSnapshot,
): SessionSnapshot {
  if (!prev || prev.id !== next.id) return next;
  return {
    ...next,
    fileText: next.fileText ?? prev.fileText,
    diffText: next.diffText ?? prev.diffText,
  };
}
