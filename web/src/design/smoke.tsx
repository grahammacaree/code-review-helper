import React from "react";
import { renderToString } from "react-dom/server";
import { Sandbox } from "../components/Sandbox";
import { functionAtLine } from "../functionAtLine";
import { WalkView, type WalkActions } from "../components/WalkView";
import type { FunctionBrief, ProbeArgSuggestion } from "../types";
import {
  AUTH_MISSING,
  AUTH_OK,
  FIX_BRIEF,
  FIX_SAMPLES,
  SCENARIOS,
} from "./fixtures";

/**
 * Headless check that every design-mode state still renders, and that the pane
 * a scenario asks for is the pane that opens. Catches fixture rot without a
 * browser: `npm run design:check`.
 */
const actions: WalkActions = {
  onRepoPath: () => undefined,
  onPr: () => undefined,
  onCheckout: () => undefined,
  onSend: () => undefined,
  onAction: () => undefined,
  onInterrupt: () => undefined,
  onBrowse: () => undefined,
  onChase: () => undefined,
  onAnnotate: () => undefined,
  onReply: () => undefined,
  onResolve: () => undefined,
  onProbe: () => undefined,
  onSuggestArgs: (): Promise<ProbeArgSuggestion> =>
    Promise.resolve({ args: [], note: "", kind: "fixture" }),
  onExplainFunction: (): Promise<FunctionBrief> => Promise.resolve(FIX_BRIEF),
};

let failures = 0;

function fail(id: string, why: string): void {
  failures += 1;
  console.log(`FAIL ${id}: ${why}`);
}

/** True when the first status paragraph sits inside the submit button's row. */
function inRepoActions(html: string): boolean {
  const row = html.indexOf('class="repo-actions"');
  const status = html.indexOf('class="status');
  return row !== -1 && status > row;
}

/** The scenario notes live here rather than in the UI, so they stay visible. */
function report(id: string, what: string, note: string): void {
  console.log(`ok   ${id.padEnd(16)} ${what}`);
  console.log(`     ${note}`);
}

for (const s of SCENARIOS) {
  let html = "";
  try {
    html = renderToString(
      <WalkView
        auth={s.id === "no-key" ? AUTH_MISSING : AUTH_OK}
        session={s.session}
        error={s.error ?? null}
        busy={Boolean(s.busy)}
        repoPath="/Users/graham/code/atlas"
        recentRepos={["/Users/graham/code/atlas"]}
        pr="482"
        initialTab={s.tab ?? "file"}
        initialFn={s.fn}
        initialFnPane={s.fnPane}
        actions={actions}
      />,
    );
  } catch (err) {
    fail(s.id, err instanceof Error ? err.message : String(err));
    continue;
  }

  if (!s.session) {
    if (/role="tab"/.test(html)) fail(s.id, "empty state should have no tabs");
    // With the form open, a status belongs on the submit button's row, not
    // stacked under it where it would shift the form.
    if (/class="status/.test(html) && !inRepoActions(html)) {
      fail(s.id, "status is not on the submit button's row");
    }
    report(s.id, "empty state", s.note);
    continue;
  }

  const wantTab = s.tab ?? "file";
  const selected = new RegExp(
    `id="tab-${wantTab}"[^>]*aria-selected="true"`,
  ).test(html);
  const hasCard = Boolean(s.session.card);
  if (hasCard && !selected) fail(s.id, `${wantTab} tab did not open`);
  if (hasCard && !/class="tabs"/.test(html)) fail(s.id, "tab bar missing");
  if (/undefined|\[object Object\]/.test(html)) {
    fail(s.id, "rendered a placeholder value into the page");
  }
  // The sandbox is a modal over the walk: it must render, and it must show the
  // function's own source rather than an empty editor.
  if (s.fn) {
    if (!/role="dialog"/.test(html)) fail(s.id, "sandbox modal did not open");
    if (!html.includes("valueFromSettledPromise")) {
      fail(s.id, "sandbox opened without the function source");
    }
    // The result is matched to the run by id, so a seeded probe must show up.
    const want = s.session.probe;
    if (want?.result && !html.includes(want.result)) {
      fail(s.id, "sandbox did not show the result for this function");
    }
    // Function / About are tabs inside the modal, and a scenario can open
    // either. The brief itself arrives from an effect, so only the pane choice
    // is checkable without a browser.
    const wantPane = s.fnPane ?? "source";
    if (
      !new RegExp(`id="sandbox-tab-${wantPane}"[^>]*aria-selected="true"`).test(
        html,
      )
    ) {
      fail(s.id, `sandbox ${wantPane} pane did not open`);
    }
  }
  // Hotspots use the same anchored box as comments, collapsed until opened.
  const spots =
    wantTab === "file"
      ? (s.session.card?.lookCloser.length ?? 0) +
        (s.session.card?.uhOh.length ?? 0)
      : 0;
  const boxes = html.match(/class="note-thread (?:look|uh)/g)?.length ?? 0;
  if (spots !== boxes) {
    fail(s.id, `${spots} hotspot(s) but ${boxes} anchored box(es)`);
  }
  // Threads belong in the code at their anchor line, open when unresolved and
  // collapsed once resolved.
  for (const a of s.session.annotations) {
    if (a.path !== s.session.card?.path || wantTab !== "file") continue;
    const anchor = html.indexOf(`data-line="${a.endLine}"`);
    const thread = html.indexOf(`id="note-${a.id}"`);
    if (anchor === -1 || thread < anchor) {
      fail(s.id, `thread ${a.id} is not anchored at L${a.endLine}`);
    }
    const open = new RegExp(
      `id="note-${a.id}"[^]*?aria-expanded="${a.status === "open"}"`,
    ).test(html.slice(thread, thread + 600));
    if (!open) fail(s.id, `thread ${a.id} has the wrong default state`);
  }
  report(
    s.id,
    hasCard ? `${wantTab} pane` : s.session.phase,
    s.note,
  );
}

// Threads must survive a tab change: the diff is the other pane that shows
// code, so notes anchor there too rather than disappearing.
for (const s of SCENARIOS) {
  const notes = s.session?.annotations.filter(
    (a) => a.path === s.session?.card?.path,
  );
  if (!s.session || !notes?.length || !s.session.diffText) continue;
  const html = renderToString(
    <WalkView
      auth={AUTH_OK}
      session={s.session}
      error={null}
      busy={false}
      repoPath="/Users/graham/code/atlas"
      recentRepos={["/Users/graham/code/atlas"]}
      pr="482"
      initialTab="diff"
      actions={actions}
    />,
  );
  for (const a of notes) {
    if (!html.includes(`id="note-${a.id}"`)) {
      fail(s.id, `thread ${a.id} is missing from the diff pane`);
    }
  }
}

// The brief arrives from an effect, which server rendering never runs, so the
// filled About pane is checked by handing the Sandbox a brief directly.
{
  const scenario = SCENARIOS.find((s) => s.fnPane === "about");
  if (!scenario?.fn) {
    fail("sandbox-about", "no scenario opens the About pane");
  } else {
    const html = renderToString(
      <Sandbox
        fn={scenario.fn}
        path={scenario.session?.card?.path ?? ""}
        fileText={scenario.session?.fileText}
        busy={false}
        argsJson="[]"
        brief={FIX_BRIEF}
        initialPane="about"
        onExplain={() => undefined}
        onArgsJson={() => undefined}
        onRun={() => undefined}
        onClose={() => undefined}
      />,
    );
    for (const want of [
      "What it does",
      "Why it exists",
      FIX_BRIEF.conceptName ?? "",
      "Before you edit it",
      "From the checkout",
      FIX_BRIEF.facts[0],
    ]) {
      if (want && !html.includes(escapeHtml(want))) {
        fail("sandbox-about", `About pane is missing "${want}"`);
      }
    }
    // Prose, not code: the About pane must not inherit the editor's font.
    if (/class="code sandbox-about/.test(html)) {
      fail("sandbox-about", "About pane is styled as code");
    }
  }
}

// Waiting on the agent has to look like waiting, in both About states: with no
// brief yet, and with an old one still on screen while a fresh one is asked for.
{
  const scenario = SCENARIOS.find((s) => s.briefPending);
  if (!scenario?.fn) {
    fail("sandbox-asking", "no scenario leaves the brief pending");
  } else {
    for (const [what, brief] of [
      ["empty", undefined],
      ["refreshing", FIX_BRIEF],
    ] as const) {
      const html = renderToString(
        <Sandbox
          fn={scenario.fn}
          path={scenario.session?.card?.path ?? ""}
          fileText={scenario.session?.fileText}
          busy={false}
          argsJson="[]"
          brief={brief}
          briefBusy
          initialPane="about"
          onExplain={() => undefined}
          onArgsJson={() => undefined}
          onRun={() => undefined}
          onClose={() => undefined}
        />,
      );
      if (!html.includes('class="spinner"')) {
        fail("sandbox-asking", `${what} About pane shows no spinner while busy`);
      }
    }
  }
}

// A sample argument is only useful if it fits the signature it is offered
// under, so each one is checked against the parameters of the function actually
// at that line.
{
  const text = SCENARIOS.find((s) => s.session?.fileText)?.session?.fileText;
  const path = SCENARIOS.find((s) => s.session?.card)?.session?.card?.path;
  if (!text || !path) {
    fail("samples", "no scenario carries file text to check samples against");
  } else {
    for (const [line, sample] of Object.entries(FIX_SAMPLES)) {
      const fn = functionAtLine(text, Number(line), path);
      if (!fn) {
        fail("samples", `no function at line ${line}`);
        continue;
      }
      const params = fn.params.filter((p) => p !== "this");
      if (sample.args.length !== params.length) {
        fail(
          "samples",
          `${fn.name} takes (${params.join(", ")}) but its sample has ${sample.args.length} argument(s)`,
        );
      }
    }
  }
}

/** React escapes text nodes, so expected strings must be escaped to match. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

if (failures) {
  // Thrown rather than an exit code so this file stays inside the web
  // tsconfig, which has no node types.
  throw new Error(`${failures} design state(s) broken`);
}
console.log(`\nall ${SCENARIOS.length} states ok`);
