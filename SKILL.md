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

1. Put the workspace on the PR (clean tree, then fetch/checkout). Do not
   start the walkthrough until local HEAD matches the PR tip.
2. Resolve the change set from that checkout. If it is large, **stop**
   and offer quit / core-only / walk all. Do not start the overview
   until they pick.
3. Opening turn: robust overview (what / why / dependencies /
   connections) + ordered file queue. Stop. Do not start file 1 until
   they say go / start.
4. One file card per turn (what / why / links / look closer / could have /
   uh oh). Open that file in the editor when the host allows. Huge
   generated files: hunks only.
5. Teach-back gate: do not advance until they explain the file in their
   own words. Side questions are allowed; do not make them recap a file
   they already explained.
6. After the last file: lingering uh-ohs, then a **final teach-back** —
   they summarise the whole PR. Do not dump a second full recap first.
7. Offer to return them to the branch they were on before checkout.

## Checkout the PR locally (hard gate)

Disk must match the PR so file cards can open the real version in the
editor. Do this **before** the overview.

Record `git branch --show-current` **before** switching. That is the
branch to offer back at the end.

1. `git status`. If the working tree is dirty, **stop**. Ask them to
   switch to a clean branch (or confirm a stash). Do not stash, reset, or
   checkout until the tree is clean or they confirm stash.
2. Once clean, put them on the PR:
   - Prefer `gh pr checkout <n>` when `gh` works.
   - Else: `git fetch origin pull/<n>/head` then
     `git checkout -B pr-<n> FETCH_HEAD`. Only `-B` that dedicated
     `pr-<n>` branch — never `-B` `main` / `master` / their current
     feature branch.
3. Confirm `HEAD` matches the PR tip. If the host exposes active-branch
   metadata (e.g. Cursor `SetActiveBranch`), set it to the checkout name.
4. Branch-name or “current branch vs base” reviews: still require a
   clean tree. If they are already on the branch to review and it
   matches, skip the extra checkout.

Do not create extra local refs (`pr-*-merge`, `pr-*-walkthrough`). Fetch
merge metadata into `FETCH_HEAD` if needed, then drop it.

Do not start the overview from a detached fetch, a mismatched branch, or
a dirty tree.

On **quit**, wrap-up complete, or they end the walkthrough: offer
`git checkout <starting-branch>`. Do not switch if the tree is dirty.
Do not delete `pr-<n>` unless they ask.

## Resolve the change set

Accept a PR URL/number, a branch name, or “current branch vs base”.

For a **PR number/URL**, resolve the **PR’s base branch**, not “whatever
local `main` is”:

- Prefer `gh pr view <n> --json baseRefName,headRefOid`.
- Else: `git fetch origin pull/<n>/merge` (no local branch) and use that
  commit’s **first parent** as the base tip.

Fetch that base. The change set is `git diff origin/<base>...HEAD`
(three-dot) plus `git diff --name-status` / `--shortstat` against the
same merge-base. Do **not** use `git log origin/main..HEAD` — that lists
every commit not in local main and inflates the PR when histories
diverged or the PR is behind.

If `gh` is unavailable for metadata, still fetch `pull/<n>/head` for
checkout, and `pull/<n>/merge` only to read the first parent.

For a branch name or “current vs base”: merge-base with the repo’s
default/base branch is fine.

Build the full changed-file list once. Do not dump every diff in the first
turn.

## Large PR gate

File-by-file teach-back of a generated megadiff recreates the glaze this
skill exists to prevent. After the file list exists, count **non-noise**
files and churn (`insertions + deletions` from `git diff --shortstat`,
excluding lockfiles, generated dirs, and pure assets unless the PR is
about those).

Treat it as **large** if either:

- ≥ 20 non-noise files, or
- ≥ 1500 lines of non-noise churn

Then **stop** before the overview. Report the counts. Offer exactly:

- **Quit** — end. No cards, no fake LGTM. Offer to restore their
  starting branch.
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
card from `git diff` hunks only (path, a few operation/schema names,
focus line ranges). Teach-back may be one sentence (“generated contract
for X”).

Do not steal the file cards: no per-file what/why here.

Stop. Wait for go / start.

## File card (one file = one turn)

Cover only the current file. Cite small ranges when they help; do not paste
the whole file.

State **new / modified / deleted / renamed** up front. Wrong guesses are
worse than skipping — use `git diff --name-status` (and the hunk headers)
against the PR merge-base.

- **New:** whole file is in play. Open at a sensible start (`#L1` or the
  export/handler).
- **Modified:** list **Focus** as the changed line ranges (from diff
  hunks, coalesced). Jump to
  `file:///abs/path#L<first>-L<last>` when the host can open files at a
  line (e.g. Cursor `open_resource`; otherwise give path + range in the
  card). Many hosts jump but cannot highlight a selection.
- **Deleted:** do not open; say it was removed and show the old path.
- **Renamed:** say old → new, then treat as modified (or new, if the
  body is a rewrite).

Open the current file beside the chat **before** the card when possible
(host file-open tool, or path + focus lines). If the host cannot open
files, the card must stand alone.

| Section | Content |
|---|---|
| **What** | Concrete change in this file (behavior, API, structure). Not a line dump. |
| **Why** | Why this file had to change for the PR’s goal. |
| **Links** | How it connects to files already covered and to upcoming files in the queue. |
| **Look closer** | 0–3 **named** functions/methods that are complex or novel. Understand this. One line each: name + why (new protocol, dense control flow, non-obvious invariant, first of its kind here). If none, say “none”. Not thin wrappers, re-exports, or routine CRUD. |
| **Could have** | 0–2 **design forks** on this file only when there was a real choice (API shape, layer, library, sync vs async, where pagination lives), and when the code or surrounding context gives evidence that this was an intentional design choice. One line each: plausible alternative + short tradeoff vs what they shipped. If the file is obvious or there's no fork, say “none”. Not a teach-back requirement — counterfactual review, not “you should have done X.” |
| **Uh oh** | 0–3 watch-outs: bugs, missing tests, risky edges, surprising coupling. Might be wrong. If none, say “none”. Do not invent. |

Look closer, Could have, and Uh oh are different buckets. The same
function may appear in Look closer and Uh oh; Could have is about
choices, not defects.

For huge generated files: hunks only (see Opening turn). Do not open a
10k-line swagger/lockfile whole.

If **Look closer** is not none and the host can open files, jump to the
first named function (`#L<start>`) as well as the file’s focus range.

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
recited the card.

## Wrap-up (final teach-back)

After the last file, do **not** restate the opening overview. Give
lingering uh-ohs (compact, evidence-backed, or “none”). If any file had
a non-none **Could have**, add a short **Design forks** list (file +
fork in one line each). Then ask them to summarise the PR in their own
words: what it does, why, how the files and dependencies connect.

If the summary is thin or wrong: same gate as a file — one short
correction, stay here. When it’s good enough: one-line confirm, offer to
restore their starting branch, then offer a defect-finding pass only if
useful.

## Tone

Direct, concise, sparse bolding. Teaching, not performative nitpicking.
Uh-ohs are evidence-backed. Questions are the point — do not rush past
confusion.

## Anti-patterns

- Do not teach-back binaries or basic SVGs/images (batch + skip).
- Do not open or read entire swagger/lockfile/generated dumps.
- Do not diff against local `main` when the PR names another base.
- Do not leave them on `pr-<n>` without offering to switch back.
- Do not silently shorten a large PR or drop teach-back to “get through it.”
- Do not give a second full recap at the end before they summarise.
- Do not make them recap a file they already explained after a side question.
- Do not advance without a teach-back (or an explicit skip).
- Do not start a walkthrough until local HEAD matches the PR (clean
  tree, then checkout).
- Do not confuse this skill with an automated defect hunt.
- Do not invent uh-ohs to look thorough.
- Do not invent Could have alternatives on obvious or thin files.
- Do not treat Look closer as Uh oh (or flag every new function).
- Do not require teach-back on Could have (optional counterfactual).
- Do not post GitHub comments unless asked.
