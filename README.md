# Code review helper

A [Cursor](https://cursor.com) skill that walks a pull request **file by file**, with a teach-back gate, so you actually understand the change set instead of skimming GitHub.

## Motivation

Code reviews are perhaps the most challenging part of modern software engineering. Reviewing well forces you to spend your time and energy understanding something you didn't write yourself, solving a problem you may not fully understand. That's difficult to do, and if you're anything like me you might let your eyes glaze over or flail around blindly for a segment of code you do understand. Not being the reviewer I **should** be has been weighing on me, and with reviews becoming more and more of the job as AI-assisted coding proliferates, I decided I needed a solution.

One possibility was to find a way to automate reviews entirely, but that's an undesirable shortcut: code reviews are a way we can learn what our colleagues are doing and how the whole system works, not just a pass/fail test running through the reviewer. Instead, I've chosen to **force** reviewer attentiveness by building a review assistant skill in Cursor that forces you to walk through the PR diff and engage in back-and-forth queries until the system is satisfied that you know how each file works, the motivations behind the structure, and how the PR connects as a whole. This is, perversely, AI tooling that makes everything take longer — but the outcome is better code and, on my end, a better engineer.

## Why this shape

GitHub’s diff UI is built for scanning. That is useful for “did anyone typo the config key?” It is a poor teacher. You can approve a PR and still not be able to explain it to a teammate.

So the agent:

1. Checks out the PR locally (clean tree first) so the editor shows the real files, not whatever branch you were on.
2. Gives a **map** first — what happens after merge, why the PR exists, dependencies, how the files connect — then an ordered queue. Not GitHub’s alphabetical dump.
3. Covers **one file per turn**: new vs modified, which lines to look at, what / why / links / a few evidence-backed watch-outs (“uh ohs”). Complex or novel functions get a **Look closer** callout, and you have to explain those by name — not just the file.
4. **Will not advance** on “next”, “lgtm”, or a nod. You explain the file in your own words. Wrong or thin: it corrects one beat and stays put. A question before you’ve explained the file is answered, then it asks again. A question after you’ve already explained it does not make you recap. Skip exists if you are stuck.
5. At the end you summarise the whole PR. It does not recap the opening for you to parrot.

Uh ohs are not a bot review. They are “look at this if you are going to thumbs-up.” Automated defect hunting is a different pass, afterward, if you want it.

## Install

Clone into Cursor’s personal skills directory (any repo you open will see it):

```bash
git clone git@github.com:grahammacaree/code-review-helper.git ~/.cursor/skills/pr-file-walkthrough
```

If that folder already exists, it *is* this project — pull instead of cloning.

Requires Cursor, `git`, and ideally the GitHub CLI (`gh`) for PR checkout. Without `gh`, the skill fetches `refs/pull/<n>/head` itself.

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
| `SKILL.md` | Instructions the agent follows |
| `templates.md` | Output shapes (overview, file card, teach-back, wrap-up) |

The skill name in Cursor is still `pr-file-walkthrough` so existing triggers keep working. This repo is `code-review-helper`.

## License

MIT. See [LICENSE](LICENSE).
