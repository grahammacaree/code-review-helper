import type { AuthStatus, LookCloser, SessionSnapshot } from "../types";
import { CommandBox, type ChipAction } from "./CommandBox";
import { RepoBar } from "./RepoBar";
import { Transcript } from "./Transcript";

export function ChatColumn({
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
  onSend,
  onAction,
  onInterrupt,
  onLookCloser,
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
  onSend: (text: string) => void;
  onAction: (action: ChipAction) => void;
  onInterrupt: () => void;
  onLookCloser: (hotspot: LookCloser) => void;
}) {
  return (
    <section className="chat-column" aria-label="Walkthrough chat">
      <RepoBar
        auth={auth}
        session={session}
        error={error}
        busy={busy}
        workLabel={workLabel}
        repoPath={repoPath}
        recentRepos={recentRepos}
        pr={pr}
        onRepoPath={onRepoPath}
        onPr={onPr}
        onCheckout={onCheckout}
      />
      <Transcript
        messages={session?.messages ?? []}
        onLookCloser={onLookCloser}
      />
      <CommandBox
        session={session}
        disabled={busy}
        onSend={onSend}
        onAction={onAction}
        onInterrupt={onInterrupt}
      />
    </section>
  );
}
