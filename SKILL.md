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

Teach the change set so the reviewer’s approval is earned, not skimmed.
This is not an automated defect hunt and not a ship checklist — but it
**is** preparation for the real GitHub approve / request-changes step.

Two postures, one walk. On a repo they already own, slightly bend uh-ohs
toward the questions they are expected to catch (isolation, cache, the
seams that matter *here*). On a repo they are catching up on, spend that
same attention on the teachable big picture — what kind of app this is,
how data and failures move — not only local trivia. Derive that bias
from the checkout (docs, stack). Do not invent house law.

Wiring among changed files is the default graph so the walk stays
teachable. Unchanged callers of a changed contract are still in play:
watch for them, offer a thin opt-in chase, do not auto-queue the rest of
the repo, and do not read “no importers in walk scope” as unused.

Stay read-only on **code and review comments**. Do not post GitHub review
comments, push, or fix code unless they explicitly ask. **Exception:**
optional GitHub “Viewed” flags as navigation (see Focus the file list).
Do not submit Approve / Comment / Request changes. Do not auto-invoke
defect-hunting review agents; offer a defect pass or their own checklist
only after wrap-up if useful.

Copy the output shapes from [templates.md](templates.md).

## Workflow

1. Put the workspace on the PR (clean tree, then fetch/checkout). Do not
   start the walkthrough until local HEAD matches the PR tip. Disk must
   match so they can open and click through the real files — not only
   hunks.
2. Resolve the change set from that checkout. If it is large, **stop**
   and offer quit / core-only / walk all. Do not start the overview
   until they pick.
3. Opening turn: robust overview (what / why / dependencies /
   connections / repo kind + Watch for) + ordered file queue. Stop. Do
   not start file 1 until they say go / start.
4. One file card per turn (what / why / role in PR / wiring / links /
   look closer / could have / uh oh), plus a **per-file** GitHub **Diff**
   link when useful. Open the **local file** in the editor beside the chat.
   Huge generated files: hunks only.
5. Teach-back gate: do not advance until they explain the file in their
   own words. Side questions are allowed; do not make them recap a file
   they already explained.
6. After the last file: lingering uh-ohs, then a **final teach-back** —
   they summarise the whole PR. Do not dump a second full recap first.
7. Offer to return them to the branch they were on before checkout.

## Checkout the PR locally (hard gate)

Checkout is the **primary** path even when GitHub/`gh` can supply diffs.
Hunks alone are not enough — they need the full file on disk to click
into, follow callers, and read surrounding context.

Do this **before** the overview.

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

- Prefer `gh pr view <n> --json url,baseRefName,headRefOid,id`. Keep
  `url` for per-file Diff links; `id` if using Viewed flags.
- Else: `git fetch origin pull/<n>/merge` (no local branch) and use that
  commit’s **first parent** as the base tip.

Fetch that base. After checkout, the change set is
`git diff origin/<base>...HEAD` (three-dot) plus
`git diff --name-status` / `--shortstat` against the same merge-base.
Do **not** use `git log origin/main..HEAD` — that lists every commit not
in local main and inflates the PR when histories diverged or the PR is
behind.

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
  tests if they change behavior), **then append** any other changed
  files whose diffs look high-risk (auth/secrets/exec/`innerHTML`/
  removed guards, sensitive paths, huge non-test churn, etc.). The
  queue may grow past 8 for those pins — do not batch a file that
  looks like a real bug or antipattern. List remaining low-risk paths
  as batched. Teach-back still applies to every file in the queue,
  plus the final summary.
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
- **Repo** — what this checkout is (mobile app, website front-end,
  backend, mixed), from manifests and docs — not a guess. Then **Watch
  for**: 0–5 seams from `AGENTS.md` / `CONTRIBUTING` / Cursor rules, or
  from that kind (isolation, cache, client vs server, offline, authz).
  Bias later uh-ohs when the hunk hits the seam. Not a new teach-back
  gate. Do not invent house rules that are not in the docs or implied
  by the stack.
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

- **New:** whole file is in play. Open the local file at a sensible start
  (`#L1` or the export/handler).
- **Modified:** list **Focus** as the changed line ranges (from diff
  hunks, coalesced). Open the local file at
  `file:///abs/path#L<first>-L<last>` when the host can (e.g. Cursor
  `open_resource`). Many hosts jump but cannot highlight a selection.
- **Deleted:** do not open; say it was removed and show the old path.
- **Renamed:** say old → new, then treat as modified (or new, if the
  body is a rewrite).

Open the **local** current file beside the chat **before** the card
(host file-open tool, or path + focus lines). That is the primary view —
full file, clickable definitions, surrounding context. If the host cannot
open files, the card must stand alone.

**Diff** (secondary, not teach-back): if this is a GitHub PR, also put a
link to *this path’s* hunks for side-by-side comparison. Resolve `url`
once (`gh pr view <n> --json url`, or the PR URL they pasted).
Percent-encode the path. Then:

`{url}/files?file-filters[]=path:{path}#diff-{sha256}`

`sha256` is the SHA-256 of the path from the repo root, no leading
slash, **no trailing newline** (`printf '%s' 'apps/foo/bar.ts' | shasum -a 256`).
Use the new path after a rename; the old path for a delete. Optional:
append `R{firstFocusLine}` after the hash.

Omit **Diff** when there is no GitHub PR URL. Do not invent an org/repo.
Do **not** open the PR root or unfiltered `/files` via `open_resource` —
that dumps every file. Prefer the local file; leave the Diff link in the
card for them to click if they want hunks.

## Focus the file list (optional)

If they are also using the GitHub/Cursor PR changes tree and it is
noisy, you **may** mark other paths Viewed so **Hide viewed files** can
collapse them. Resolve `gh pr view <n> --json id` once. Before a card:

1. `unmarkFileAsViewed` for the current path.
2. `markFileAsViewed` for other changed paths (or just the file you left).

```bash
gh api graphql -f query='mutation($id:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$id,path:$path}){clientMutationId}}' -f id="$PR_ID" -f path="$PATH"
```

Same shape with `unmarkFileAsViewed`. If GraphQL fails, skip — do not
block the walk. This is optional navigation, not a substitute for
checkout or for opening the local file.

| Section | Content |
|---|---|
| **What** | Concrete change in this file (behavior, API, structure). Not a line dump. |
| **Why** | Why this file had to change for the PR’s goal. |
| **Role in PR** | One short paragraph: this file’s job in the **whole PR story** — stated motivation (title/body) **and** implicit motivation (what the overview’s “how it connects” implies this file must do). Not a repeat of What/Why. |
| **Wiring** | Import/export graph **within this PR’s change set** (the default graph): what this file pulls in (symbols + from which changed paths or key packages) and what it exports to which other changed files. Read `import`/`export` lines; resolve relative paths against the queued/covered list. External packages only when they are the point (new dependency, auth client, etc.). For non-code paths or when nothing parses, say **none** or one line. **“No importers in walk scope” means none in this walk, not unused in the product.** If a modified export looks like a contract change (signature, return/error shape, flag meaning) and callers may live outside the queue, say so and offer a **chase** — do not silently skip blast radius. |
| **Links** | Queue context: files already covered and upcoming in the walk — complements Wiring (narrative order vs import graph). |
| **Look closer** | 0–3 **named** functions/methods (or other hotspots) that are complex or novel, and are central to understanding this change. Each entry: **name + line range + why** (new protocol, dense control flow, non-obvious invariant, first of its kind here). On large files, line ranges are **required** — a bare name is not enough to find the spot. If none, say “none”. Not thin wrappers, re-exports, or routine CRUD. **Behavior pivots:** when the hunk is tiny but the whole point is a semantic choice (e.g. `isRefetching` vs `isFetching`, manual refresh flag vs query `isRefetching`), prefer a Look closer entry on that symbol — even a one-liner — with why the wrong alternative fails. Do not leave Look closer as “none” on those files. |
| **Could have** | 0–2 **design forks** on this file only when there was a real choice (API shape, layer, library, sync vs async), and when the code or surrounding context gives evidence that this was an intentional design choice. One line each: plausible alternative + short tradeoff vs what they shipped. If the file is obvious or there's no fork, say “none”. Not a teach-back requirement — counterfactual review, not “you should have done X.” |
| **Uh oh** | 0–3 watch-outs: bugs, missing tests, risky edges, surprising coupling. Prioritize the highest-leverage risks implied by the code. If the overview named repo Watch for items, prefer those when this hunk actually hits that seam. Might be wrong. If none, say “none”. Do not invent. |

**Map** (optional under Look closer) — two shapes; use when useful, omit when not:

1. **In-file Map** — when Look closer is not none and the file is hard to hold in one mental model (several interlocking helpers, a state machine, parse → transform → emit, etc.): 2–5 lines of how those pieces call each other or order the work. Only when the names alone would leave the behavior opaque.
2. **Sibling Map** — when this file is one of two or more call sites that solve the **same** PR UX differently (e.g. home binds refresh to `isRefetching`, article uses local manual refresh to avoid mount flash): 2–4 lines naming the sibling path(s) and the divergence. Put this on the later sibling (or both if needed). Do not invent architecture diagrams for simple files.

**Map** is connection narrative (in-file control flow or cross-surface strategy). **Wiring** is import/export graph — use both when useful, not as duplicates of the same sentence. Styles/barrel files: prefer Role/Wiring (“presentation contract for EmptyState used by offline/not-found in `withQueryStates`”) over inventing an in-file Map of layout rules.

Look closer, Could have, and Uh oh are different buckets. The same
function may appear in Look closer and Uh oh; Could have is about
choices, not defects. Map is part of Look closer’s explanation, not a
separate teach-back gate. Role in PR and Wiring are connection context —
include them in the card, not as extra teach-back gates.

Review texture lives in those buckets — do not add extra card
sections or extra teach-back questions. Put it where it belongs,
only when this file actually has it:

- **Overview / large-PR gate:** size, split-worthiness, generated noise;
  repo kind + Watch for (docs or stack — not invented house law).
- **Role in PR / Wiring:** where this file sits in the PR story and who
  imports whom among changed paths — before diving into hotspots.
- **Look closer:** the behavioral contract (inputs, outputs, invariants,
  why it is shaped that way), with line ranges on large files; optional
  Map when interlocking pieces need a path through the file **or** when
  sibling call sites diverge on the same UX; behavior-pivot symbols belong
  here even if the hunk is one line.
- **Uh oh:** highest-leverage risks implied by the code (correctness,
  missing coverage, coupling) — not a tour of every review dimension.
- **Could have:** evidenced design forks only.

If a dimension is not central here, omit it. Tests, ops, consistency,
and rollout belong in a later defect pass unless they *are* the uh-oh
or the reason a function is in Look closer.

For huge generated files: hunks only (see Opening turn). Do not open a
10k-line swagger/lockfile whole.

If **Look closer** is not none and the host can open files, jump to the
first hotspot’s line range (`#L<start>` or `#L<start>-L<end>`) as well as
the file’s Focus ranges.

End every file turn with the teach-back prompt from [templates.md](templates.md).
Match depth to **file role** (styles stay in the walk — lighter bar, not skipped):

| File role | Teach-back bar |
|---|---|
| **Behavior pivot** (tiny hunk, semantic API choice — wrong flag/signal would regress UX) | Prefer they name the **wrong alternative** and why it fails. Nudge the Look closer symbol. Treat “what + why” that misses the pivot as thin. |
| **Shared gate / wiring** (HOC, shared query wrapper, central module) | what + why + roughly who consumes it / Empty vs Error (or equivalent) split. |
| **Screen / route** | what the user sees + which signal drives refresh/retry if this PR touches that. |
| **Styles / barrel** | Tokens vs magic numbers, shared layout with sibling state components, barrel as public entry — not property-by-property. |
| **Test / spec locking a helper** | What this file guards and why (awkward E2E, regression). Do not re-quiz the helper’s full contract if they already explained it. |

**Role in PR** and **Wiring** help them place the file — welcome in the paraphrase but not required verbatim. If Look closer named hotspots, **prefer** asking about them by name (and may point at the line range). On **behavior pivots**, naming the pivot (or the wrong alternative) is expected for a pass when Look closer called it out. On other files, hotspot names remain a plus, not a hard gate when the file-level explanation is solid. If a Map (in-file or sibling) was given, how the pieces connect is welcome in the same paraphrase, not a separate gate. Do not advance on “next” / “lgtm” alone.

## Blast radius (opt-in chase)

The parsed wiring graph is the walk (queued + covered). Checkout exists so they can follow definitions **outside** that graph.

When this file changes an exported contract and Wiring has no in-walk importers — or you know unchanged call sites exist — **explicitly watch** for blast radius. Do not auto-insert every consumer into the numbered queue.

Offer a **chase**: they opt in. Insert at most a few unchanged paths after the current file. Chase cards are **thin** (why we are looking, what this site still assumes, uh-oh only if the new contract does not hold). No full what/why/role teach-back unless they want it. Skip / done-looking is enough. Do not recurse chase-on-chase.

Side questions (“who else calls `foo`?”) remain the lighter path when they only want an answer, not a card.

## Teach-back gate (hard blocker)

Do **not** advance on “next”, “ok”, “lgtm”, or emoji alone.

**Per file:** require a real paraphrase of **what** + **why**, scaled to file role
(table above). Role in PR, Wiring, and Map connections are a **plus** on most
files. On **behavior pivots**, missing the semantic choice (e.g. treating
`isRefetching` as “just a loading flag” with no contrast to `isFetching`) is
**thin** — correct once and stay. On styles/barrels, pass a solid intent-level
explanation without demanding every style key. Line ranges are there so they
can dig in. Connections to other files are optional but encouraged.

**Final:** require a real paraphrase of the whole PR — use the wrap-up
checklist in [templates.md](templates.md) (user outcome → shared gate →
surface differences → optional open question).

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
recited the card. **Credit earlier files.** If they already explained a
contract (boolean polarity, flag meaning, return shape) upstream, do not
fail a later test/caller/wrapper for not repeating it — they need to say
what *this* file does relative to that contract. Do not fail a solid
what/why on a normal file only because Look closer names were skipped.
Do fail (as thin) a pivot-file teach-back that never engages the
wrong-alternative **and** they have not already explained that pivot.
Stay messages: one missing high-level piece, not a checklist of internals
(TTL, off-by-one, skip flags) unless that *is* this file’s pivot.
Do not require them to cover Could have, Uh oh, or review-checklist items
that were not in the card.

## Questions and inline notes (review Q&A)

Side questions in chat (**Ask**) and inline **question** / **comment** notes
on a line range are **review Q&A**, not requests to change the PR.

- **Explain** — what the code does, why it is shaped this way, how tests or
  mocks relate to production patterns, tradeoffs. Help the reviewer decide
  what to think, not what to type.
- **Do not implement** — no offers to refactor, “slim this down”, “switch to
  `renderWithTheme`”, “happy to do in a follow-up”, or other coding-task
  language unless they explicitly ask you to edit the code.
- **Review observations** — if something might be worth raising on GitHub,
  phrase it as a note they could leave on the PR (“might be worth asking
  whether…”, “could note on the review that…”), not as work for the agent.
- **Comments** — acknowledge and sharpen their note; do not rewrite the PR.

Curiosity (“does Jest get tokens here?”) is not a change request. Treat it
as understanding the existing diff.

## Wrap-up (final teach-back)

After the last file, do **not** restate the opening overview. Give
lingering uh-ohs (compact, evidence-backed, or “none”). If any file had
a non-none **Could have**, add a short **Design forks** list — **at most
1–2** high-value forks (file + fork in one line each), not a catalog of
every Could have from the walk. Then ask for a structured summary in their
own words, covering all four beats (see [templates.md](templates.md)):

1. **User outcome** — what failed/empty/refresh (or equivalent) feels like after merge.
2. **Shared gate** — name the glue module (e.g. `withQueryStates`) and the main contract (`refetch`, Empty vs Error, etc.).
3. **Surface differences** — where call sites diverge (e.g. home vs article refresh signals).
4. **Open question** (optional) — one thing they would still ask the author.

A product-only summary that never names the shared gate or a real divergence
is **thin** — one short correction, stay on wrap-up.

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
- Do not skip checkout because GitHub/`gh` diffs are available — local
  files are the primary review surface.
- Do not start a walkthrough until local HEAD matches the PR (clean
  tree, then checkout).
- Do not open the PR root or unfiltered `/files` instead of the local
  file (that dumps every hunk).
- Do not invent a GitHub Diff URL when there is no PR (wrong org, guessed
  hash).
- Do not diff against local `main` when the PR names another base.
- Do not leave them on `pr-<n>` without offering to switch back.
- Do not silently shorten a large PR or drop teach-back to “get through it.”
- Do not give a second full recap at the end before they summarise.
- Do not make them recap a file they already explained after a side question.
- Do not re-quiz a boolean, return polarity, or helper contract they already
  paraphrased on an earlier file — tests and callers need this file’s job
  relative to that contract, not a recitation.
- Do not stay with a checklist of internals (TTL, off-by-one, skip flags)
  when they already have the high-level what/why; one missing piece.
- Do not advance without a teach-back (or an explicit skip).
- Do not confuse this skill with an automated defect hunt.
- Do not invent uh-ohs to look thorough.
- Do not invent Could have alternatives on obvious or thin files.
- Do not treat Look closer as Uh oh (or flag every new function).
- Do not give Look closer entries without line ranges on large files.
- Do not invent a Map on thin or obvious files.
- Do not omit a sibling Map when two screens in this PR solve the same UX
  with different signals — call the divergence out on at least one of them.
- Do not leave Look closer as “none” on a one-line behavior pivot whose
  whole point is the wrong alternative.
- Do not accept a wrap-up that only restates the product story with no
  shared gate and no surface divergence (treat as thin).
- Do not dump every Could have into wrap-up Design forks — at most 1–2.
- Do not duplicate Role in PR and What/Why with the same sentences.
- Do not paste every import line in Wiring — only paths/symbols that matter
  for understanding this PR.
- Do not treat “no importers in walk scope” as unused in the product.
- Do not auto-queue every unchanged caller — chase is opt-in and thin.
- Do not require full teach-back on a chase card unless they want it.
- Do not require teach-back on Could have (optional counterfactual).
- Do not invent extra review-checklist prompts (tests, ops, consistency,
  rollout) as card sections or teach-back gates.
- Do not invent repo-specific constraints that are not in docs or implied
  by the stack (mobile vs website vs backend). Kind-level Watch for items
  are questions at the seam, not laws. Do not quiz teach-back on them.
- Do not post GitHub comments unless asked.
- Do not submit a PR review (Approve / Comment / Request changes) as
  part of this walk. Viewed flags only, and only optionally.
- Do not answer review questions as if they were implementation requests
  (no “happy to refactor in a follow-up” unless they explicitly asked for edits).
