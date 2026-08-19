---
name: pr-file-walkthrough
description: >-
  Walk a pull request file by file so the reviewer understands what each
  change does, why it is necessary, and how the files interconnect. One
  file per turn, with a teach-back gate before advancing, plus
  evidence-backed watch-outs. Use when they ask to walk through a PR, do
  a file-by-file review, learn a PR, review with them, or name
  pr-file-walkthrough or code-review-helper.
---

# PR file walkthrough

Teach the change set. This is not a defect hunt and not a ship checklist.

Stay read-only. Do not post GitHub review comments, push, or fix code unless
they explicitly ask. Do not auto-invoke defect-hunting review agents; offer
a defect pass or their own checklist only after wrap-up if useful.

Copy the output shapes from [templates.md](templates.md).

## Workflow

1. Resolve the PR **without switching branches**. Fetch metadata and
   diffs (`gh` / `git fetch`). Leave their working tree alone.
2. If the change set is large, **stop** and offer quit / core-only /
   walk all. Do not start the overview until they pick.
3. Opening turn: robust overview (what / why / dependencies /
   connections) + ordered file queue. Stop. Do not start file 1 until
   they say go / start.
4. One file card per turn (what / why / links / look closer / could have /
   uh oh), plus a **per-file** GitHub **Diff** link (path filter + hash).
   Open that URL in the host when it can — never the whole Files tab.
   Huge generated files: hunks only.
5. Teach-back gate: do not advance until they explain the file in their
   own words. Side questions are allowed; do not make them recap a file
   they already explained.
6. After the last file: lingering uh-ohs, then a **final teach-back** —
   they summarise the whole PR. Do not dump a second full recap first.
7. Checkout only as a **fallback** (diffs unavailable, or they want to
   run the code). If you did check out, offer to restore their starting
   branch at the end.

## Resolve the change set (no checkout by default)

Accept a PR URL/number, a branch name, or “current branch vs base”.

Do **not** checkout, stash, or require a clean tree just to walk the
PR. Dirty work is fine. The agent reads the PR from GitHub/`gh`/fetched
objects; the human reads hunks from the host’s GitHub/PR diff view (or
the **Diff** link).

For a **PR number/URL**, resolve the **PR’s base**, not “whatever local
`main` is”:

- Prefer `gh pr view <n> --json url,baseRefName,headRefOid`. Keep
  `url` for per-file Diff links.
- File list and hunks: `gh pr diff <n>` / `gh pr diff <n> --name-only`,
  and per file `gh pr diff <n> -- path/to/file`. Churn from
  `gh pr view <n> --json additions,deletions,changedFiles` (or
  `--shortstat` against fetched OIDs), not local `HEAD`.
- Or `git fetch origin pull/<n>/head` (no local branch) and
  `git diff origin/<base>...<headRefOid>` (three-dot) plus
  `--name-status` / `--shortstat` against that merge-base.
  Read a file at the PR tip with `git show <headRefOid>:path` after
  that fetch — **not** the workspace copy.
- Else: `git fetch origin pull/<n>/merge` (no local branch) and use that
  commit’s **first parent** as the base tip, then fetch `pull/<n>/head`
  for the tip.

Do **not** use `git log origin/main..HEAD` — that lists every commit
not in local main and inflates the PR when histories diverged or the PR
is behind. Do not create extra local refs (`pr-*-merge`,
`pr-*-walkthrough`). Fetch into `FETCH_HEAD` if needed, then drop it.

For a branch name or “current vs base”: merge-base with the repo’s
default/base branch is fine. If they are already on that branch, local
`git diff` is enough.

Build the full changed-file list once. Do not dump every diff in the first
turn.

## Checkout fallback (only if needed)

Checkout (clean tree, then switch) **only** when:

- the host cannot show this PR’s diffs (no GitHub integration, `gh`
  failed, and you cannot fetch the patch), or
- they explicitly want the branch on disk (run tests, follow unchanged
  callers, etc.).

Until then, do not touch `HEAD`. Do not open workspace files as if they
were the PR — local paths may be a different branch.

If you must checkout:

1. Record `git branch --show-current`. That is the branch to offer back.
2. `git status`. If dirty, **stop**. Ask them to switch or confirm a
   stash. Do not stash, reset, or checkout until the tree is clean or
   they confirm stash.
3. Prefer `gh pr checkout <n>`. Else: `git fetch origin pull/<n>/head`
   then `git checkout -B pr-<n> FETCH_HEAD`. Only `-B` that dedicated
   `pr-<n>` branch — never `-B` `main` / `master` / their current
   feature branch.
4. Confirm `HEAD` matches the PR tip. If the host exposes active-branch
   metadata (e.g. Cursor `SetActiveBranch`), set it to the checkout name.

On **quit** / wrap-up **after a checkout**: offer
`git checkout <starting-branch>`. Do not switch if dirty. Do not delete
`pr-<n>` unless they ask. If you never checked out, do not offer this.

## Large PR gate

File-by-file teach-back of a generated megadiff recreates the glaze this
skill exists to prevent. After the file list exists, count **non-noise**
files and churn (`insertions + deletions` from `gh pr view` JSON or
`git diff --shortstat` against **fetched PR OIDs**, not local `HEAD`).
Exclude lockfiles, generated dirs, and pure assets unless the PR is
about those.

Treat it as **large** if either:

- ≥ 20 non-noise files, or
- ≥ 1500 lines of non-noise churn

Then **stop** before the overview. Report the counts. Offer exactly:

- **Quit** — end. No cards, no fake LGTM. Offer to restore their
  starting branch **only if you checked out**.
- **Core only** — propose at most **8** load-bearing files (the ones
  needed to explain the PR: types/config → core logic → a caller →
  tests if they change behavior). If the spine is bigger, pick 8 and
  say what you left out. List the rest as batched. Teach-back still
  applies to every file in that shortened queue, plus the final
  summary.
- **Walk all** — full queue, same gates.

Do not invent a fourth option that drops teach-back. “Skim” means a
shorter queue, not faster nodding.

## Opening turn

A map of the change set, not a file dump. Read title, body, commits, and
enough of the diffs to describe the system-level story. Use the overview
shape in [templates.md](templates.md):

- **What's happening** — concrete behavior after merge (who calls it,
  what comes back). A short paragraph, not one vague sentence.
- **Why** — the problem or request this PR exists for.
- **Dependencies** — upstream systems, packages, config, or endpoints
  this relies on; what has to exist first.
- **How it connects** — the call chain / data flow across the queued
  files (e.g. route → handler → client → registry → tests → docs).
- **Queue** — dependency / call-chain order: types/config → core logic →
  callers → tests → docs. Not GitHub’s alphabetical order.
- Skip or batch noise only after they confirm (lockfile churn, generated
  files unless the PR is about codegen).
- **Pure assets** (`.svg` / `.png` / `.jpg` / `.jpeg` / `.webp` / `.gif`
  / `.ico` / fonts / similar binaries): do **not** put them in the
  numbered teach-back queue. One line in the overview (what they are,
  who references them if you know). Skip by default. Do not ask them to
  explain what an SVG is. If they want to look, then a one-liner card
  and no teach-back unless they keep going.

Exception: an SVG/asset that is actually code (inline component with
logic) is a real file card. A PR that *is* the asset (license, a11y,
wrong dimensions) can be one card if they ask — still no “what is a
jpg” gate.

Exclude pure assets from the large-PR file/churn counts (same as
lockfile/generated).

For **huge generated files** (swagger, lockfiles, snapshots, generated
GraphQL, minified bundles): never open or read the whole file. Build the
card from `gh pr diff` / `git diff` hunks only (path, a few
operation/schema names, focus line ranges). Teach-back may be one
sentence (“generated contract for X”).

Do not steal the file cards: no per-file what/why here.

Stop. Wait for go / start.

## File card (one file = one turn)

Cover only the current file. Cite small ranges when they help; do not paste
the whole file.

State **new / modified / deleted / renamed** up front. Wrong guesses are
worse than skipping — use `gh pr diff --name-only` / fetched
`--name-status` (and hunk headers) against the PR merge-base, not the
workspace.

The agent’s source for this file is the **PR patch**, not disk:

- `gh pr diff <n> -- path` (preferred), or `git show <headRefOid>:path`
  after fetch.
- Do **not** `Read` a workspace path unless `HEAD` is the PR tip. Missing
  or different local files are expected. That is not a blocker and not
  a reason to checkout.

- **New:** whole file is in play (from the patch). **Diff** URL; no
  local open.
- **Modified:** list **Focus** as the changed line ranges (from diff
  hunks, coalesced). **Diff** URL (optional `R{firstFocusLine}`).
- **Deleted:** say it was removed, show the old path, **Diff** URL.
- **Renamed:** say old → new, then treat as modified (or new, if the
  body is a rewrite).

**Diff** (navigation, not teach-back): if this is a GitHub PR, put a
link that shows **only this path**, not the whole Files tab. Resolve
`url` once (`gh pr view <n> --json url`, or the PR URL they pasted).
Percent-encode the path. Then:

`{url}/files?file-filters[]=path:{path}#diff-{sha256}`

Example: `…/pull/6384/files?file-filters[]=path:apps/foo/bar.ts#diff-{sha256}`

`sha256` is the SHA-256 of the path from the repo root, no leading
slash, **no trailing newline** (`printf '%s' 'apps/foo/bar.ts' | shasum -a 256`).
Use the new path after a rename; the old path for a delete. Optional:
append `R{firstFocusLine}` after the hash to land on that hunk.

Omit **Diff** when there is no GitHub PR URL. Do not invent an org/repo.

When the host can open URLs (e.g. Cursor `open_resource`), open **that
per-file URL** beside the chat **before** the card. Never open `{url}`,
`{url}/files`, or the GitHub PR overview — those dump every file. If the
host GitHub panel still shows the full change set, do not use it as the
file view; the card + filtered **Diff** link must stand alone. Do not
open a local `file://` path unless `HEAD` is the PR tip.

| Section | Content |
|---|---|
| **What** | Concrete change in this file (behavior, API, structure). Not a line dump. |
| **Why** | Why this file had to change for the PR’s goal. |
| **Links** | How it connects to files already covered and to upcoming files in the queue. |
| **Look closer** | 0–3 **named** functions/methods that are complex or novel, and are central to understanding this change. Understand this. One line each: name + why (new protocol, dense control flow, non-obvious invariant, first of its kind here). If none, say “none”. Not thin wrappers, re-exports, or routine CRUD. |
| **Could have** | 0–2 **design forks** on this file only when there was a real choice (API shape, layer, library, sync vs async), and when the code or surrounding context gives evidence that this was an intentional design choice. One line each: plausible alternative + short tradeoff vs what they shipped. If the file is obvious or there's no fork, say “none”. Not a teach-back requirement — counterfactual review, not “you should have done X.” |
| **Uh oh** | 0–3 watch-outs: bugs, missing tests, risky edges, surprising coupling. Prioritize the highest-leverage risks implied by the code. Might be wrong. If none, say “none”. Do not invent. |

Look closer, Could have, and Uh oh are different buckets. The same
function may appear in Look closer and Uh oh; Could have is about
choices, not defects.

Review texture lives in those buckets — do not add extra card
sections or extra teach-back questions. Put it where it belongs,
only when this file actually has it:

- **Overview / large-PR gate:** size, split-worthiness, generated noise.
- **Look closer:** the behavioral contract (inputs, outputs, invariants,
  why it is shaped that way).
- **Uh oh:** highest-leverage risks implied by the code (correctness,
  missing coverage, coupling) — not a tour of every review dimension.
- **Could have:** evidenced design forks only.

If a dimension is not central here, omit it. Tests, ops, consistency,
and rollout belong in a later defect pass unless they *are* the uh-oh
or the reason a function is in Look closer.

For huge generated files: hunks only (see Opening turn). Do not fetch or
paste a 10k-line swagger/lockfile.

If **Look closer** is not none, the **Diff** URL may use `R{start}` for
the first named function. Do not jump a local file unless `HEAD` is the
PR tip.

End every file turn with the teach-back prompt from [templates.md](templates.md). If Look closer named functions, the prompt must ask about those **by name**. Do not advance until they can explain what those functions do, not only the file’s job.

## Teach-back gate (hard blocker)

Do **not** advance on “next”, “ok”, “lgtm”, or emoji alone.

**Per file:** require a real paraphrase of **what** + **why**. If Look
closer named functions, they must cover those by name. Connections
are optional but encouraged.

**Final:** require a real paraphrase of the whole PR — what it does, why
it exists, and how the pieces connect (dependencies + call chain).

- Thin or wrong: correct the gap in one short beat, ask them to fill the
  missing piece, stay on the same file (or on the final summary).
- Clarifying question **before** a good paraphrase: answer, then
  re-prompt teach-back. Still no advance.
- Clarifying or **not-part-of-review** question **after** they already
  paraphrased well enough: answer, then continue (next file, or wait for
  **next**). Do not make them recap the whole file.
- Escape hatch only if they explicitly say skip / I’m stuck, skip this file.
  Note the skip and move on. (Final summary has no skip unless they end
  the walkthrough.)

“Good enough” means they could explain it to a teammate, not that they
recited the card. If Look closer named a function because of an
invariant or contract, a paraphrase that never touches that piece is
thin — still the existing gate, not a new one. Do not require them to
cover Could have, Uh oh, or review-checklist items that were not in
the card.

## Wrap-up (final teach-back)

After the last file, do **not** restate the opening overview. Give
lingering uh-ohs (compact, evidence-backed, or “none”). If any file had
a non-none **Could have**, add a short **Design forks** list (file +
fork in one line each). Then ask them to summarise the PR in their own
words: what it does, why, how the files and dependencies connect.

If the summary is thin or wrong: same gate as a file — one short
correction, stay here. When it’s good enough: one-line confirm, offer to
restore their starting branch **only if you checked out**, then offer a
defect-finding pass only if useful.

## Tone

Direct, concise, sparse bolding. Teaching, not performative nitpicking.
Uh-ohs are evidence-backed. Questions are the point — do not rush past
confusion.

## Anti-patterns

- Do not teach-back binaries or basic SVGs/images (batch + skip).
- Do not open or read entire swagger/lockfile/generated dumps.
- Do not treat workspace files as the PR. Disk may be another branch
  (or the path may not exist locally). Read `gh pr diff` / `git show
  <oid>:path`. A failed local `Read` is not a failure of the walk.
- Do not checkout, stash, or demand a clean tree because a file is
  missing locally.
- Do not start a walkthrough with no PR patch (`gh`, fetched OIDs, or
  checkout fallback).
- Do not diff against local `main` when the PR names another base.
- Do not leave them on `pr-<n>` without offering to switch back (only
  if you checked out).
- Do not silently shorten a large PR or drop teach-back to “get through it.”
- Do not give a second full recap at the end before they summarise.
- Do not make them recap a file they already explained after a side question.
- Do not advance without a teach-back (or an explicit skip).
- Do not confuse this skill with an automated defect hunt.
- Do not invent uh-ohs to look thorough.
- Do not invent Could have alternatives on obvious or thin files.
- Do not treat Look closer as Uh oh (or flag every new function).
- Do not require teach-back on Could have (optional counterfactual).
- Do not invent extra review-checklist prompts (tests, ops, consistency,
  rollout) as card sections or teach-back gates.
- Do not invent a GitHub Diff URL when there is no PR (wrong org, guessed
  hash).
- Do not open the PR root or `/files` without `file-filters[]=path:` and
  `#diff-{sha256}` — that is the whole change set, not this file.
- Do not post GitHub comments unless asked.
