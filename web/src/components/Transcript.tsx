import { useEffect, useRef } from "react";
import { Inline, NoteList, parseLinkField, PathList, Prose } from "../prose";
import type { ChatMessage, FileCard, LookCloser, Overview, Wrapup } from "../types";

export function Transcript({
  messages,
  onLookCloser,
}: {
  messages: ChatMessage[];
  onLookCloser: (hotspot: LookCloser) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="transcript" role="log" aria-live="polite">
      {messages.length === 0 && (
        <article className="bubble assistant" data-kind="status">
          <p>
            Drop in a local clone and a PR URL (or number), then check it out.
            I’ll map the change set here; the file you’re walking stays on the
            right.
          </p>
        </article>
      )}
      {messages.map((msg) => (
        <article
          key={msg.id}
          className={`bubble ${msg.role}`}
          data-kind={msg.kind}
        >
          {msg.kind === "overview" && msg.overview ? (
            <OverviewBody overview={msg.overview} />
          ) : msg.kind === "file" && msg.card ? (
            <FileBody card={msg.card} onLookCloser={onLookCloser} />
          ) : msg.kind === "wrapup" && msg.wrapup ? (
            <WrapupBody wrapup={msg.wrapup} />
          ) : msg.kind === "large" && msg.large ? (
            <LargeBody
              files={msg.large.files}
              churn={msg.large.churn}
              excluded={msg.large.excluded}
            />
          ) : msg.kind === "dirty" || msg.kind === "status" || msg.kind === "probe" ? (
            <pre className="bubble-pre">{msg.text}</pre>
          ) : (
            <Prose text={msg.text} />
          )}
        </article>
      ))}
      <div ref={end} />
    </div>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  return (
    <>
      <p className="muted">
        On <code>{overview.branch}</code>
        {overview.prUrl ? (
          <>
            {" "}
            — <a href={overview.prUrl}>{overview.prUrl}</a>
          </>
        ) : null}
      </p>
      <h2>What’s happening</h2>
      <Prose text={overview.whatsHappening} />
      <h2>Why</h2>
      <Prose text={overview.why} />
      <h2>Dependencies</h2>
      <Prose text={overview.dependencies} />
      <h2>How it connects</h2>
      <Prose text={overview.howItConnects} />
      <h2>Queue</h2>
      <ol className="queue">
        {overview.queue.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ol>
      {overview.assetsNote && (
        <>
          <h2>Assets</h2>
          <Prose text={overview.assetsNote} />
        </>
      )}
      {overview.noiseNote && (
        <>
          <h2>Noise</h2>
          <Prose text={overview.noiseNote} />
        </>
      )}
      <p className="muted">Say start when you want file 1.</p>
    </>
  );
}

function FileBody({
  card,
  onLookCloser,
}: {
  card: FileCard;
  onLookCloser: (hotspot: LookCloser) => void;
}) {
  const links = parseLinkField(card.links);
  return (
    <>
      <h2>
        File {card.index} of {card.total}: <code>{card.path}</code> — {card.kind}
        {card.oldPath ? (
          <>
            {" "}
            (<code>{card.oldPath}</code> → <code>{card.path}</code>)
          </>
        ) : null}
      </h2>
      {card.focus.length > 0 && (
        <p className="muted">
          Focus: {card.focus.map((r) => `L${r.start}–L${r.end}`).join(", ")}
        </p>
      )}
      {card.diffUrl && (
        <p>
          <a href={card.diffUrl}>GitHub Diff for this path</a>
        </p>
      )}
      <h3>What</h3>
      <Prose text={card.what} />
      <h3>Why</h3>
      <Prose text={card.why} />
      <h3>Links</h3>
      <p className="muted">Already covered</p>
      <PathList items={links.covered} />
      <p className="muted">Upcoming</p>
      <PathList items={links.upcoming} />
      <h3>Look closer</h3>
      {card.lookCloser.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {card.lookCloser.map((h) => (
            <li key={`${h.name}-${h.startLine}`}>
              <button
                type="button"
                className="hotspot"
                onClick={() => onLookCloser(h)}
              >
                <code>{h.name}</code> L{h.startLine}–L{h.endLine}
              </button>
              {" — "}
              <Inline text={h.why} />
            </li>
          ))}
        </ul>
      )}
      {card.map && (
        <>
          <h3>Map</h3>
          <Prose text={card.map} />
        </>
      )}
      <h3>Could have</h3>
      <NoteList items={card.couldHave} />
      <h3>Uh oh</h3>
      {card.uhOh.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {card.uhOh.map((u) => (
            <li key={`${u.startLine}-${u.text}`}>
              <button
                type="button"
                className="hotspot"
                onClick={() =>
                  onLookCloser({
                    name: "Uh oh",
                    startLine: u.startLine,
                    endLine: u.endLine,
                    why: u.text,
                  })
                }
              >
                L{u.startLine}–L{u.endLine}
              </button>
              {" — "}
              <Inline text={u.text} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WrapupBody({ wrapup }: { wrapup: Wrapup }) {
  const uh = wrapup.lingeringUhOhs
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("No lingering"));
  const forks = (wrapup.designForks || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <>
      <h2>Lingering uh-ohs</h2>
      <NoteList items={uh} />
      {forks.length > 0 && (
        <>
          <h2>Design forks</h2>
          <NoteList items={forks} />
        </>
      )}
      <p className="muted">
        In your own words: what does this PR do, why does it exist, and how do
        the pieces connect? When you are ready, use{" "}
        <strong>Copy review notes</strong> below for the GitHub review where
        your approval actually lands.
      </p>
    </>
  );
}

function LargeBody({
  files,
  churn,
  excluded,
}: {
  files: number;
  churn: string;
  excluded: string;
}) {
  return (
    <>
      <h2>This PR is large</h2>
      <p>
        <strong>{files} files</strong>, {churn} (excluding {excluded}).
      </p>
      <p>A full file-by-file walk will take a while. Pick one from the chips.</p>
    </>
  );
}
