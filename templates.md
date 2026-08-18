# Output templates

Use these shapes verbatim. Fill the brackets; do not add extra sections.

## Overview (opening turn)

```markdown
**On:** `[branch]` (local HEAD matches PR tip)

**What's happening:** [short paragraph: concrete behavior after merge — who calls it, what comes back]

**Why:** [the problem or request this PR exists for]

**Dependencies:** [upstream systems, packages, config, endpoints this relies on; what has to exist first]

**How it connects:** [call chain / data flow across the queued files]

**Queue** (dependency order):
1. `path/to/file.ts`
2. `path/to/other.ts`
3. …

**Assets** (skipped unless you say otherwise): `foo.svg`, `bar.jpg` — [one line: what they are / who uses them]

Noise I would skip or batch unless you want it: [lockfile / generated / none]

Say **start** when you want file 1.
```

## Assets (skip by default)

Not a teach-back turn. List in the overview only, unless they ask.

```markdown
**Assets** (skipped unless you say otherwise): `mobile-hero.jpg`, `headline.svg` — new lede art wired from [component]. Say if you want to look.
```

## Blocked: large PR

Do not start the overview. Wait.

```markdown
This PR is large: **[N] files**, **[+X/−Y]** (excluding [lockfile / generated / n/a]).

A full file-by-file walk will take a while. Pick one:

- **quit** — stop here
- **core only** — walk up to **8** load-bearing files (I’ll list them), batch the rest
- **walk all** — every file, same teach-back as usual

Core-only is still a real review of the spine, not a skim past the gate.
```

## Blocked: dirty tree

Do not checkout. Wait.

```markdown
Working tree isn’t clean (`[short status]`). Switch to a clean branch
(or tell me to stash) before I check out this PR. I won’t move files
until then.
```

## File card

```markdown
**File [n] of [total]:** `path/to/file.ts` — **modified** (or **new** / **deleted** / **renamed** `old` → `new`)
**Focus:** L35–L38 [, L80–L92]  (omit Focus on a new file; say “whole file”)

**What:** [concrete change in this file]

**Why:** [why this file had to change for the PR’s goal]

**Links:** [already covered: …] [upcoming: …]

**Look closer:** [`parseNextCursorFromLinkHeader` — [why to understand it]] or **none**

**Could have:** [0–2 design forks: alternative + tradeoff vs what shipped, or **none**]

**Uh oh:** [0–3 might-be-wrong watch-outs, or “none”]

---

Before we continue: in your own words, what does this file change do, and why was it needed? Reply with that (or questions). Say **next** only after you’ve explained it — I won’t advance on “next” alone.
```

When Look closer is not none, replace the last paragraph with:

```markdown
Before we continue: in your own words, what does this file change do, and why was it needed? Also: what does `[Name]` do, and why is it shaped that way? Reply with that (or questions). Say **next** only after you’ve explained it — I won’t advance on “next” alone.
```

## Teach-back: inadequate

Stay on the same file (or the final summary). One short correction, then re-prompt.

```markdown
Close, but [the missing or wrong piece in one sentence].

Try that part again in your own words — still this file / still the whole PR, not done.
```

## Teach-back: question after a good paraphrase

Answer. Do not recap the file. Then the next card, wrap-up, or a short
“say **next** when you want to continue” if they might have more questions.

```markdown
[Direct answer.]

That’s enough on this file unless you want to stay. **Next** when you’re ready.
```

## Teach-back: question, then re-prompt

They have **not** paraphrased yet. Answer the question, then re-prompt.
Do not advance.

```markdown
[Direct answer.]

Still this file: in your own words, what does it change, and why was it needed?
```

## Teach-back: adequate → advance

One line of confirmation, then immediately the next file card (or wrap-up
if the queue is empty). Do not recap the whole file.

```markdown
That’s the idea.

[Next file card, or wrap-up]
```

## Skip

Only when they explicitly skip.

```markdown
Skipped `path/to/file.ts`.

[Next file card, or wrap-up]
```

## Quit (large-PR gate or they end early)

Offer to restore the starting branch. Do not switch if dirty.

```markdown
Stopping here. Want me to check out `[starting-branch]` again?
```

## Wrap-up

Do not restate the opening overview. Uh-ohs, then their summary.

```markdown
**Lingering uh-ohs:** [compact list, or “none”]

**Design forks:** [only if any file had Could have — file + fork in one line each, or omit section]

That’s the files. In your own words: what does this PR do, why does it exist, and how do the pieces (and their dependencies) connect? I won’t close out on “done” alone.
```

## Wrap-up: adequate

```markdown
That’s the idea.

Want me to check out `[starting-branch]` again?

If you want a defect pass next, say so. I won’t start one unless you ask.
```
