# Code review helper

A file-by-file PR walkthrough with a teach-back gate, so you actually understand the change set instead of skimming GitHub.

This repo has two surfaces that share the same workflow:

- A **Cursor skill** (`SKILL.md`) you can run in the IDE (or paste into another coding agent).
- A **local app** (`npm run dev`) that leverages and expands on the ideas in that skill: the host owns the gates (dirty tree, large PR, one file, teach-back) and adds a dedicated UI (map, file/diff, inline notes, function probe). The agent still writes the cards.

Built and tested in [Cursor](https://cursor.com). The skill works in any coding agent with git access; the app drives a **local Cursor agent** via `@cursor/sdk` (spend hits your Cursor account).

## Motivation

Code reviews are perhaps the most challenging part of modern software engineering. Reviewing well forces you to spend your time and energy understanding something you didn't write yourself, solving a problem you may not fully understand. That's difficult to do, and if you're anything like me you might let your eyes glaze over or flail around blindly for a segment of code you do understand. Not being the reviewer I **should** be has been weighing on me, and with reviews becoming more and more of the job as AI-assisted coding proliferates, I decided I needed a solution.

One possibility was to find a way to automate reviews entirely, but that's an undesirable shortcut: code reviews are a way we can learn what our colleagues are doing and how the whole system works, not just a pass/fail test running through the reviewer. Instead, I've chosen to **force** reviewer attentiveness by building a review assistant skill in Cursor that forces you to walk through the PR diff and engage in back-and-forth queries until the system is satisfied that you know how each file works, the motivations behind the structure, and how the PR connects as a whole. This is, perversely, AI tooling that makes everything take longer — but the outcome is better code and, on my end, a better engineer.

## Why this shape

GitHub’s diff UI is built for scanning. That is useful for “did anyone typo the config key?” It is a poor teacher. You can approve a PR and still not be able to explain it to a teammate.

So the walkthrough:

1. Checks out the PR locally (clean tree first) so you see the **real files** — clickable, with surrounding context — not only hunks. GitHub/`gh` can still supply metadata; checkout stays the primary path.
2. Gives a **map** first — what happens after merge, why the PR exists, dependencies, how the files connect — then an ordered queue. Not GitHub’s alphabetical dump.
3. Covers **one file per turn**: the **local** file at the changed lines (primary view — clickable, full context). Optionally adds a GitHub **Diff** link for that path’s hunks only (`file-filters` + `#diff-…`; never opens the whole Files tab). Then what / why / links / a few evidence-backed watch-outs (“uh ohs”). Complex or novel hotspots that are central to the change get a **Look closer** callout with **name + line range** (especially on big files) so you can find them; naming them in teach-back is a plus, not a hard gate when the file-level explanation is solid. On interlocking files, there may be a short **Map** of how those pieces connect. On files with a real, evidenced design fork, **Could have** names a plausible alternative and tradeoff (counterfactual review, not a teach-back gate). Uh ohs are the highest-leverage risks implied by *this* file, not a tour of every review dimension.
4. **Will not advance** on “next”, “lgtm”, or a nod. You explain the file in your own words. Wrong or thin: it corrects one beat and stays put. A question is answered without counting as teach-back (in the app, switch to **Ask**). Skip exists if you are stuck. Teach-back is what / why well enough to tell a teammate. It does not quiz you on Could have, uh ohs, or a review checklist. Map is not a separate gate.
5. At the end you summarise the whole PR. It does not recap the opening for you to parrot. Design forks from the walk are collected in wrap-up if any came up. Then it offers to restore the branch you started from.

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

If the PR is large (≥ 20 files or ≥ 1500 lines of real churn, ignoring lockfiles/generated/images), it stops and asks **quit**, **core only** (at most 8 load-bearing files, still with teach-back), or **walk all**. That is for AI-sized diffs: forcing every generated file would recreate the glaze. Core-only is not a shortcut past understanding the spine. When you finish or quit, it offers to put you back on the branch you started from.

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

UI: http://127.0.0.1:5173  
API: http://127.0.0.1:8787

You need `git` and ideally `gh` on `PATH`. Point the form at a **local clone** and a PR URL or number. The app checks out the PR tip in that repo (clean tree first). Prefer running the app from a projects checkout, not from `~/.cursor/skills/`, if you want that skills folder to stay lean.

Walks persist across refresh and server restart (`data/sessions/`, gitignored; the browser remembers the session id). **New File** / **Reset** starts over. The function probe looks for Jest/spec samples and typed fixtures (`const foo: Type = { … }`), not only inline literals.

## What it is not

- Not a replacement for GitHub review comments (it stays read-only unless you ask it to comment).
- Not Bugbot / an automated bug finder.
- Not a ship checklist for your own diffs, and not a full code-review rubric on every file.
- The app does not post GitHub review comments, edit or commit in the repo under review, or piggyback on the Cursor app session.

## Files

| Path | Role |
|---|---|
| `SKILL.md` | Agent instructions (Cursor skill format; usable elsewhere) |
| `templates.md` | Output shapes (overview, file card, teach-back, wrap-up) |
| `server/` | Walkthrough host (checkout, gates, agent, function probe) |
| `web/` | Local UI |

In Cursor the skill id is `pr-file-walkthrough` so existing triggers keep working. This repo is named `code-review-helper`.

## License

MIT. See [LICENSE](LICENSE).
