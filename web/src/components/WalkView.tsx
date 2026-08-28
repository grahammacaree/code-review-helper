import { useEffect, useRef, useState } from "react";
import type {
  AuthStatus,
  FnBlock,
  FunctionBrief,
  LookCloser,
  ProbeArgSuggestion,
  SessionSnapshot,
} from "../types";
import { ChatColumn } from "./ChatColumn";
import type { ChipAction } from "./CommandBox";
import { FileInspect, type FileTab } from "./FileInspect";
import { InspectSplit } from "./InspectSplit";
import { RepoMap } from "./RepoMap";

/** Everything the walk can do. The app wires these to the API; design mode stubs them. */
export interface WalkActions {
  onRepoPath: (value: string) => void;
  onPr: (value: string) => void;
  onCheckout: () => void;
  onSend: (text: string, mode: "ask" | "teachback") => void;
  onAction: (action: ChipAction) => void;
  onInterrupt: () => void;
  onBrowse: (path: string) => void;
  onChase: (path: string) => void;
  onAnnotate: (input: {
    kind: "question" | "comment";
    startLine: number;
    endLine: number;
    selectedText: string;
    body: string;
  }) => void;
  onReply: (annotationId: string, text: string) => void;
  onResolve: (annotationId: string) => void;
  onProbe: (line: number, args: unknown[], source?: string) => void;
  onSuggestArgs: (
    line: number,
    signal?: AbortSignal,
  ) => Promise<ProbeArgSuggestion>;
  onExplainFunction: (
    line: number,
    signal?: AbortSignal,
    refresh?: boolean,
  ) => Promise<FunctionBrief>;
}

/**
 * The whole two-column walk surface. Owns only view state (which tab, which
 * line is focused, which walk note is open) so the app and design mode cannot
 * drift apart visually.
 */
export function WalkView({
  auth,
  session,
  error,
  busy,
  repoPath,
  recentRepos,
  pr,
  initialTab = "file",
  initialFn,
  initialFnPane,
  actions,
}: {
  auth: AuthStatus | null;
  session: SessionSnapshot | null;
  error: string | null;
  busy: boolean;
  repoPath: string;
  recentRepos: string[];
  pr: string;
  initialTab?: FileTab;
  initialFn?: FnBlock;
  initialFnPane?: "source" | "about";
  actions: WalkActions;
}) {
  const [tab, setTab] = useState<FileTab>(initialTab);
  const [focusLine, setFocusLine] = useState<number | undefined>(
    session?.focusLine,
  );
  const [walkNote, setWalkNote] = useState<LookCloser | null>(null);
  const shownPath = useRef(session?.card?.path);
  const path = session?.card?.path;

  useEffect(() => {
    setFocusLine(session?.focusLine);
  }, [path, session?.focusLine]);

  // A new file resets the pane; re-renders of the same file leave it alone, so
  // design mode can open a scenario straight onto Diff, Role, or Wiring.
  useEffect(() => {
    if (shownPath.current === path) return;
    shownPath.current = path;
    setWalkNote(null);
    if (path) setTab("file");
  }, [path]);

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

  return (
    <div className="app">
      <ChatColumn
        auth={auth}
        session={session}
        error={error}
        busy={busy}
        workLabel={session?.workingOn}
        repoPath={repoPath}
        recentRepos={recentRepos}
        pr={pr}
        onRepoPath={actions.onRepoPath}
        onPr={actions.onPr}
        onCheckout={actions.onCheckout}
        onSend={actions.onSend}
        onAction={actions.onAction}
        onInterrupt={actions.onInterrupt}
        onLookCloser={onLookCloser}
      />
      <InspectSplit
        expandTop={!session?.card}
        top={
          <RepoMap
            files={session?.files ?? []}
            queue={session?.queue ?? []}
            covered={session?.covered ?? []}
            currentPath={session?.card?.path}
            howItConnects={session?.overview?.howItConnects}
            browseable={
              session?.phase === "wrapup" || session?.phase === "done"
            }
            onOpenFile={actions.onBrowse}
          />
        }
        bottom={
          <FileInspect
            card={session?.card}
            fileText={session?.fileText}
            diffText={session?.diffText}
            fileWiring={session?.fileWiring}
            overview={session?.overview}
            chaseCandidates={session?.chaseCandidates}
            onChase={actions.onChase}
            focusLine={focusLine}
            walkNote={walkNote}
            tab={tab}
            annotations={session?.annotations ?? []}
            probe={session?.probe}
            busy={busy}
            onTab={setTab}
            onAnnotate={actions.onAnnotate}
            onReply={actions.onReply}
            onResolve={actions.onResolve}
            onProbe={actions.onProbe}
            onSuggestArgs={actions.onSuggestArgs}
            onExplainFunction={actions.onExplainFunction}
            onLookCloser={onLookCloser}
            onCloseWalkNote={() => setWalkNote(null)}
            openFn={initialFn}
            openFnPane={initialFnPane}
            error={error}
          />
        }
      />
    </div>
  );
}
