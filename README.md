# Code review helper

A file-by-file PR walkthrough with a teach-back gate, so you actually understand the change set before you put your name on the approval.

This repo has two surfaces that share the same workflow:

- A **Cursor skill** (`SKILL.md`) you can run in the IDE (or paste into another coding agent).
- A **local app** (`npm run dev`) that leverages and expands on the ideas in that skill: the host owns the gates (dirty tree, large PR, one file, teach-back) and adds a dedicated UI (map, file/diff, inline notes, function probe). The agent still writes the cards.

Built and tested in [Cursor](https://cursor.com). The skill works in any coding agent with git access; the app drives a **local Cursor agent** via `@cursor/sdk` (spend hits your Cursor account).

## Motivation

Code reviews are perhaps the most challenging part of modern software engineering. Reviewing well forces you to spend your time and energy understanding something you didn't write yourself, solving a problem you may not fully understand. That's difficult to do, and if you're anything like me you might let your eyes glaze over or flail around blindly for a segment of code you do understand. Not being the reviewer I **should** be has been weighing on me, and with reviews becoming more and more of the job as AI-assisted coding proliferates, I decided I needed a solution.

One possibility was to find a way to automate reviews entirely, but that's an undesirable shortcut: code reviews are how we learn what our colleagues are doing and how the whole system works, **and** how we take responsibility for merging — not just a pass/fail test running through the reviewer. Instead, I've chosen to **force** reviewer attentiveness by building a review assistant skill in Cursor that forces you to walk through the PR diff and engage in back-and-forth queries until the system is satisfied that you know how each file works, the motivations behind the structure, and how the PR connects as a whole. On large PRs it still refuses to batch past diffs that look like real foot-guns, and the app can hand you review notes to paste when you're ready to approve or request changes. This is, perversely, AI tooling that makes everything take longer — but the outcome is better code, an honest thumbs-up, and, on my end, a better engineer.

## Design principles

**What a code review is for.** A review is not mainly a lint pass or a merge gate with a comment box. It is how a team shares context, catches mistakes before they land, and takes shared responsibility for what ships. The reviewer should be able to explain the change — what it does, why it exists, how it fits the rest of the system — well enough to stand behind an approval or a targeted request for changes.

**Code is connected.** A diff line in isolation rarely tells the story. Changes propagate through call chains, imports and exports, shared types, config, and the PR’s stated goal. Good review is systems thinking: how this file serves the whole change, who calls what, what broke if this assumption is wrong. Tools should foreground that connectivity — map before file-by-file, role in the PR, wiring between paths — not encourage file-at-a-time amnesia.

**Amplify, don't replace.** AI tooling is good at shortcuts: summarize diffs, flag patterns, skip to “looks fine.” Shortcuts save time, but they can also train you out of the work that reviews are for. Useful assistants **prepare** (map the change set, order files by dependency, surface how pieces connect, flag evidence-backed risks), **structure** (one file at a time with links back to the queue and the overview), and **support** (answer questions, export notes for the real GitHub review). They should not **substitute** for understanding or for the act of approving.

**Keep the human on the hook.** The model can propose; the reviewer still paraphrases, prioritizes, and signs off. Gates that block “lgtm” without explanation, separation of defect-hunting from the walk, and notes that feed into an official review — all of that keeps AI in a collaborator role rather than an autopilot.

**When in doubt, prefer depth over speed.** Large PRs get a honest size gate, not a silent skim. High-risk diffs stay in the walk even in core-only mode. The goal is a reviewer who is *better* after using the tool, not one who has outsourced judgment to it.

## Why this shape

GitHub’s diff UI is built for scanning. That is useful for “did anyone typo the config key?” It is a poor teacher. You can approve a PR and still not be able to explain it to a teammate.

So the walkthrough:

1. Checks out the PR locally (clean tree first) so you see the **real files** — clickable, with surrounding context — not only hunks. GitHub/`gh` can still supply metadata; checkout stays the primary path.
2. Gives a **map** first — what happens after merge, why the PR exists, dependencies, how the files connect — then an ordered queue. Not GitHub’s alphabetical dump.
3. Covers **one file per turn**: the **local** file at the changed lines (primary view — clickable, full context). Optionally adds a GitHub **Diff** link for that path’s hunks only (`file-filters` + `#diff-…`; never opens the whole Files tab). Then what / why / **role in PR** / **wiring** (imports and exports among changed files) / links / a few evidence-backed watch-outs (“uh ohs”). The right column also has **Role** and **Wiring** tabs for the same connection context. Complex or novel hotspots that are central to the change get a **Look closer** callout with **name + line range** (especially on big files) so you can find them; naming them in teach-back is a plus, not a hard gate when the file-level explanation is solid. On interlocking files, there may be a short **Map** of how those pieces connect. On files with a real, evidenced design fork, **Could have** names a plausible alternative and tradeoff (counterfactual review, not a teach-back gate). Uh ohs are the highest-leverage risks implied by *this* file, not a tour of every review dimension.
4. **Will not advance** on “next”, “lgtm”, or a nod. You explain the file in your own words. Wrong or thin: it corrects one beat and stays put. A question is answered without counting as teach-back (in the app, switch to **Ask**). Skip exists if you are stuck. Teach-back is what / why well enough to tell a teammate. It does not quiz you on Could have, uh ohs, or a review checklist. Map is not a separate gate.
5. At the end you summarise the whole PR. It does not recap the opening for you to parrot. Design forks from the walk are collected in wrap-up if any came up. In the app, **Copy review notes** gathers uh-ohs and your inline notes for the GitHub review where your approval actually lands. Then it offers to restore your home branch.

Review texture (contracts, risk, size, counterfactuals) lives in those existing buckets when the file actually has it. The overview / large-PR gate is where size and split-worthiness show up. Tests, ops, and rollout belong in a later defect pass unless they *are* the reason something is in Look closer or Uh oh. Optional GitHub **Viewed** flags can quiet the PR file tree; they are not a substitute for checkout.

Uh ohs are not a bot review. They are “look at this if you are going to thumbs-up.” Automated defect hunting is a different pass, afterward, if you want it.

## Cursor skill

Clone into Cursor’s personal skills directory (any repo you open will see it):

```bash
git clone git@github.com:grahammacaree/code-review-helper.git ~/.cursor/skills/pr-file-walkthrough
```

If that folder already exists, it *is* this project — pull instead of cloning. `SKILL.md` lives at the repo root, so Cursor still discovers the skill even though the repo also contains the app.

Requires `git` and ideally the GitHub CLI (`gh`) for PR checkout. Without `gh`, the skill fetches `refs/pull/<n>/head` itself.

In Cursor, paste a PR URL or say **walk me through this PR** / **pr-file-walkthrough**. You need a **clean working tree**. Dirty? Switch or stash first; the skill will not checkout over your work. Having GitHub connected does **not** skip checkout — local files are required. Then say **start** after the overview.

If the PR is large (≥ 20 files or ≥ 1500 lines of real churn, ignoring lockfiles/generated/images), it stops and asks **quit**, **core only** (about 8 load-bearing files, plus any other changed files whose diffs look high-risk — the queue may grow), or **walk all**. That is for AI-sized diffs: forcing every generated file would recreate the glaze. Core-only is not a shortcut past understanding the spine or past obvious foot-guns. When you finish or quit, it offers to put you back on the branch you started from.

New SVGs, jpgs, and other pure assets are listed once and skipped. No teach-back on “what is an SVG.”

The review method is not Cursor-specific. `SKILL.md` and `templates.md` are the portable spec:

- **Claude Code / Codex / etc.** — paste into project instructions, or `@`-include the files when reviewing.
- **Cursor** — install as above; the agent auto-discovers the skill from `~/.cursor/skills/` or `.cursor/skills/`.

The host opens the checked-out file beside the chat when it can — that is the primary surface. On a GitHub PR, each card may also link **that path’s** Diff for hunks (not the whole Files tab). Teach-back and gates still work if the host cannot open files; checkout still happens so disk matches the PR.

## Local app

The app is a dedicated two-column UI for the same walkthrough. It does not reuse your Cursor desktop login.

1. Mint a user API key at [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api)
2. `cp .env.example .env`
3. Set `CURSOR_API_KEY`

Optional: `CURSOR_MODEL` (default `composer-2.5`).

```bash
git clone git@github.com:grahammacaree/code-review-helper.git
cd code-review-helper
npm install
npm run dev
```

UI: [http://127.0.0.1:5173](http://127.0.0.1:5173)  
API: [http://127.0.0.1:8787](http://127.0.0.1:8787)

You need `git` and ideally `gh` on `PATH`. Point the form at a **local clone** and a PR URL or number. The app checks out the PR tip in that repo (clean tree first). Prefer running the app from a projects checkout, not from `~/.cursor/skills/`, if you want that skills folder to stay lean.

Walks persist across refresh and server restart (`data/sessions/`, gitignored; the browser remembers the session id). **New File** / **Reset** starts over. The function probe looks for Jest/spec samples and typed fixtures (`const foo: Type = { … }`), not only inline literals. Each file card includes **Role in PR** (agent) and **Wiring** (parsed imports/exports among queued and covered files); the right column exposes the same as **Role** and **Wiring** tabs beside **File** and **Diff**. At wrap-up (and when done), **Copy review notes** puts lingering uh-ohs, design forks, and your inline questions/comments on the clipboard as Markdown for pasting into a GitHub review.

## What it is not

- Not a replacement for GitHub review comments (it stays read-only unless you ask it to comment).
- Not Bugbot / an automated bug finder.
- Not a ship checklist for your own diffs, and not a full code-review rubric on every file.
- The app does not post GitHub review comments, edit or commit in the repo under review, or piggyback on the Cursor app session.



## Files


| Path                                | Role                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `SKILL.md`                          | Agent instructions (Cursor skill format; usable elsewhere)       |
| `templates.md`                      | Output shapes (overview, file card, teach-back, wrap-up)         |
| `server/`                           | Walkthrough host (checkout, gates, agent, function probe)        |
| `server/wiring.ts`                  | Static import/export graph for the **Wiring** tab and card notes |
| `web/`                              | Local UI                                                         |
| `web/src/components/RolePane.tsx`   | **Role** tab — PR motivation + file role                         |
| `web/src/components/WiringPane.tsx` | **Wiring** tab — parsed imports/exports in walk scope            |


In Cursor the skill id is `pr-file-walkthrough` so existing triggers keep working. This repo is named `code-review-helper`.

## License

MIT. See [LICENSE](LICENSE).
