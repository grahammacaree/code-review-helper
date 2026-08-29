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
  const statusError = error || session?.error;
  const working = busy || session?.busy;
  // Once a walk is underway the form's only use is abandoning it, which is what
  // Quit then New walkthrough is for. So the bar becomes plain identity.
  const compact = Boolean(session);

  const repoName = repoPath.replace(/\/$/, "").split("/").pop() || repoPath;
  const prLabel = session?.prRef ? `#${session.prRef}` : pr;

  // Setup, failure, and progress all sit beside the submit button rather than
  // under it, so appearing does not move the form.
  const statuses = (
    <>
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
    </>
  );

  return (
    <header className={`repo-bar${compact ? " compact" : ""}`}>
      {compact ? (
        <div className="repo-summary head-row">
          <h1>PR walkthrough</h1>
          <span className="head-sub">
            {repoName}
            {prLabel ? ` · ${prLabel}` : ""}
          </span>
        </div>
      ) : (
        <>
          <div className="head-row">
            <h1>PR walkthrough</h1>
            {/* Field label sits on the title's row rather than above the input. */}
            <label className="head-sub" htmlFor="repo">
              Local repository
            </label>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCheckout();
            }}
          >
            <div className="path-field">
              <span className="path-prefix" aria-hidden="true">
                ~/
              </span>
              <input
                id="repo"
                name="repo"
                list="recent-repos"
                autoComplete="off"
                placeholder="~/code/your-repo"
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
            <div className="repo-actions">
              <button
                type="submit"
                disabled={
                  working || !auth?.hasKey || !repoPath.trim() || !pr.trim()
                }
              >
                Check out and map
              </button>
              <div className="repo-status">{statuses}</div>
            </div>
          </form>
        </>
      )}
      {compact && <div className="repo-status">{statuses}</div>}
    </header>
  );
}
