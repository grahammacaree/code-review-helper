import { useEffect, useRef, useState } from "react";
import { api, createSession, getAuth, getSession } from "./api";
import type { ChipAction } from "./components/CommandBox";
import { WalkView } from "./components/WalkView";
import { loadRecentRepos, rememberRepo, displayRepo, loadSessionId, rememberSession, forgetSession } from "./recents";
import type { AuthStatus, SessionSnapshot } from "./types";

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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getAuth()
      .then(setAuth)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  useEffect(() => {
    const id = loadSessionId();
    if (!id) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        try {
          const snap = await getSession(id);
          if (cancelled) return;
          rememberSession(snap.id);
          setSession(snap);
          setRepoPath(displayRepo(snap.repoPath));
          setPr(snap.prUrl || snap.prRef);
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const gone = /unknown session/i.test(msg);
          if (gone && attempt === 0) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          if (gone) {
            forgetSession();
            return;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const snap = await fn(ac.signal);
      rememberSession(snap.id);
      setSession(snap);
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

  function onAction(action: ChipAction) {
    if (action === "reset") {
      forgetSession();
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
    else if (action === "skipTests")
      void run((signal) => api.skipTests(id, signal));
    else if (action === "chase") void run((signal) => api.chase(id, undefined, signal));
    else if (action === "next") void run((signal) => api.next(id, signal));
    else if (action === "restore") void run((signal) => api.restore(id, signal));
  }

  const working = busy || Boolean(session?.busy);

  return (
    <WalkView
      auth={auth}
      session={session}
      error={error}
      busy={working}
      repoPath={repoPath}
      recentRepos={recentRepos}
      pr={pr}
      actions={{
        onRepoPath: setRepoPath,
        onPr: setPr,
        onCheckout: () => {
          void run(async (signal) => {
            const snap = await createSession({ repoPath, pr }, signal);
            setRecentRepos(rememberRepo(snap.repoPath));
            setRepoPath(displayRepo(snap.repoPath));
            return snap;
          });
        },
        onSend: (text, mode) => {
          if (!session) return;
          void run((signal) =>
            mode === "ask"
              ? api.ask(session.id, text, signal)
              : api.teachback(session.id, text, signal),
          );
        },
        onAction,
        onInterrupt,
        onBrowse: (path) => {
          if (!session) return;
          void run((signal) => api.browse(session.id, path, signal));
        },
        onChase: (path) => {
          if (!session) return;
          void run((signal) => api.chase(session.id, [path], signal));
        },
        onAnnotate: (input) => {
          if (!session?.card) return;
          const path = session.card.path;
          void run((signal) =>
            api.annotate(session.id, { ...input, path }, signal),
          );
        },
        onReply: (annotationId, text) => {
          if (!session) return;
          void run((signal) =>
            api.replyAnnotation(session.id, annotationId, text, signal),
          );
        },
        onResolve: (annotationId) => {
          if (!session) return;
          void run(() => api.resolveAnnotation(session.id, annotationId));
        },
        onProbe: (line, args, source) => {
          if (!session) return;
          void run((signal) =>
            api.probe(session.id, line, args, source, signal),
          );
        },
        onSuggestArgs: (line, signal) => {
          if (!session) return Promise.reject(new Error("No session."));
          return api.probeArgs(session.id, line, signal);
        },
        onExplainFunction: (line, signal, refresh) => {
          if (!session) return Promise.reject(new Error("No session."));
          return api.functionBrief(session.id, line, signal, refresh);
        },
      }}
    />
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
    fileWiring: next.fileWiring ?? prev.fileWiring,
  };
}
