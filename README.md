# Code review helper

An agent skill for walking a pull request **file by file**, with a teach-back gate, so you actually understand the change set instead of skimming GitHub. Built and tested in [Cursor](https://cursor.com); the workflow works in any coding agent with git access.

## Motivation

Code reviews are perhaps the most challenging part of modern software engineering. Reviewing well forces you to spend your time and energy understanding something you didn't write yourself, solving a problem you may not fully understand. That's difficult to do, and if you're anything like me you might let your eyes glaze over or flail around blindly for a segment of code you do understand. Not being the reviewer I **should** be has been weighing on me, and with reviews becoming more and more of the job as AI-assisted coding proliferates, I decided I needed a solution.

One possibility was to find a way to automate reviews entirely, but that's an undesirable shortcut: code reviews are a way we can learn what our colleagues are doing and how the whole system works, not just a pass/fail test running through the reviewer. Instead, I've chosen to **force** reviewer attentiveness by building a review assistant skill in Cursor that forces you to walk through the PR diff and engage in back-and-forth queries until the system is satisfied that you know how each file works, the motivations behind the structure, and how the PR connects as a whole. This is, perversely, AI tooling that makes everything take longer — but the outcome is better code and, on my end, a better engineer.

## Why this shape

GitHub’s diff UI is built for scanning. That is useful for “did anyone typo the config key?” It is a poor teacher. You can approve a PR and still not be able to explain it to a teammate.

So the agent:

1. Checks out the PR locally (clean tree first) so the editor shows the real files, not whatever branch you were on.
2. Gives a **map** first — what happens after merge, why the PR exists, dependencies, how the files connect — then an ordered queue. Not GitHub’s alphabetical dump.
3. Covers **one file per turn**: new vs modified, which lines to look at, what / why / links / a few evidence-backed watch-outs (“uh ohs”). Complex or novel functions get a **Look closer** callout, and you have to explain those by name — not just the file. On files with a real design fork, **Could have** names a plausible alternative and tradeoff (counterfactual review, not a teach-back gate).
4. **Will not advance** on “next”, “lgtm”, or a nod. You explain the file in your own words. Wrong or thin: it corrects one beat and stays put. A question before you’ve explained the file is answered, then it asks again. A question after you’ve already explained it does not make you recap. Skip exists if you are stuck.
5. At the end you summarise the whole PR. It does not recap the opening for you to parrot. Design forks from the walk are collected in wrap-up if any came up.

Uh ohs are not a bot review. They are “look at this if you are going to thumbs-up.” Automated defect hunting is a different pass, afterward, if you want it.

## Install (Cursor)

Clone into Cursor’s personal skills directory (any repo you open will see it):

```bash
git clone git@github.com:grahammacaree/code-review-helper.git ~/.cursor/skills/pr-file-walkthrough
```

If that folder already exists, it *is* this project — pull instead of cloning.

Requires `git` and ideally the GitHub CLI (`gh`) for PR checkout. Without `gh`, the skill fetches `refs/pull/<n>/head` itself.

## Other agents

The review method is not Cursor-specific. `SKILL.md` and `templates.md` are the portable spec:

- **Claude Code / Codex / etc.** — paste into project instructions, or `@`-include the files when reviewing.
- **Cursor** — install as above; the agent auto-discovers the skill from `~/.cursor/skills/` or `.cursor/skills/`.

Editor “open this file at line 42” is optional. Without it, the agent gives path + focus range in each card. Teach-back, checkout, and gates still work.

## Use

In Cursor, paste a PR URL or say **walk me through this PR** / **pr-file-walkthrough**.

You need a **clean working tree**. Dirty? Switch or stash first; the skill will not checkout over your work. Then say **start** after the overview.

If the PR is large (≥ 20 files or ≥ 1500 lines of real churn, ignoring lockfiles/generated/images), it stops and asks **quit**, **core only** (at most 8 load-bearing files, still with teach-back), or **walk all**. That is for AI-sized diffs: forcing every generated file would recreate the glaze. Core-only is not a shortcut past understanding the spine. When you finish or quit, it offers to put you back on the branch you started from.

New SVGs, jpgs, and other pure assets are listed once and skipped. No teach-back on “what is an SVG.”

## What it is not

- Not a replacement for GitHub review comments (it stays read-only unless you ask it to comment).
- Not Bugbot / an automated bug finder.
- Not a ship checklist for your own diffs.

## Files

| File | Role |
|---|---|
| `SKILL.md` | Agent instructions (Cursor skill format; usable elsewhere) |
| `templates.md` | Output shapes (overview, file card, teach-back, wrap-up) |

In Cursor the skill id is `pr-file-walkthrough` so existing triggers keep working. This repo is named `code-review-helper`.

## License

MIT. See [LICENSE](LICENSE).
