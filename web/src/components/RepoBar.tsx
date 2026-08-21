import { useEffect, useState } from "react";
import { displayRepo } from "../recents";
import type { AuthStatus, SessionSnapshot } from "../types";

export function RepoBar({
  auth,
  session,
  error,
  busy,
  workLabel,
  repoPath,
  recentRepos,
  pr,
  onRepoPath,
  onPr,
  onCheckout,
}: {
  auth: AuthStatus | null;
  session: SessionSnapshot | null;
  error: string | null;
  busy: boolean;
  workLabel?: string;
  repoPath: string;
  recentRepos: string[];
  pr: string;
  onRepoPath: (value: string) => void;
  onPr: (value: string) => void;
  onCheckout: () => void;
}) {
  const [expanded, setExpanded] = useState(!session);
  const statusError = error || session?.error;
  const working = busy || session?.busy;
  const compact = Boolean(session);

  useEffect(() => {
    if (session) setExpanded(false);
  }, [session?.id]);

  const repoName = repoPath.replace(/\/$/, "").split("/").pop() || repoPath;
  const prLabel = session?.prRef ? `#${session.prRef}` : pr;

  return (
    <header className={`repo-bar${compact ? " compact" : ""}`}>
      {compact && !expanded ? (
        <button
          type="button"
          className="repo-summary"
          aria-expanded="false"
          aria-label={`Show repository form. ${repoName}${prLabel ? ` ${prLabel}` : ""}`}
          onClick={() => setExpanded(true)}
        >
          <span className="repo-title">PR walkthrough</span>
          <span className="muted">
            {repoName}
            {prLabel ? ` · ${prLabel}` : ""}
          </span>
        </button>
      ) : (
        <>
          <div className="repo-bar-top">
            <h1>PR walkthrough</h1>
            {compact && (
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded(false)}
              >
                Hide
              </button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCheckout();
            }}
          >
            <label htmlFor="repo">Local repository</label>
            <div className="path-field">
              <span className="path-prefix" aria-hidden="true">
                ~/
              </span>
              <input
                id="repo"
                name="repo"
                list="recent-repos"
                autoComplete="off"
                placeholder="apps/duet"
                value={repoPath}
                onChange={(e) => onRepoPath(displayRepo(e.target.value))}
              />
            </div>
            <datalist id="recent-repos">
              {recentRepos.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
            <label htmlFor="pr">PR URL or number</label>
            <input
              id="pr"
              name="pr"
              autoComplete="off"
              placeholder="https://github.com/org/repo/pull/123"
              value={pr}
              onChange={(e) => onPr(e.target.value)}
            />
            <button
              type="submit"
              disabled={
                working || !auth?.hasKey || !repoPath.trim() || !pr.trim()
              }
            >
              Check out and map
            </button>
          </form>
        </>
      )}
      {auth && !auth.hasKey && (
        <p className="status error" role="status">
          No <code>CURSOR_API_KEY</code>. Copy <code>.env.example</code> to{" "}
          <code>.env</code> and paste a key from{" "}
          <a href="https://cursor.com/dashboard/api">cursor.com/dashboard/api</a>
          .
        </p>
      )}
      {auth?.hasKey && auth.error && (
        <p className="status error" role="status">
          Key present but Cursor rejected it: {auth.error}
        </p>
      )}
      {statusError && (
        <p className="status error" role="alert">
          {statusError}
        </p>
      )}
      {working && (
        <p className="status working" role="status">
          <span className="spinner" aria-hidden="true" />
          {workLabel || session?.workingOn || "Working…"}
        </p>
      )}
    </header>
  );
}
