# Output templates

Use these shapes verbatim. Fill the brackets; do not add extra sections.

## Overview (opening turn)

```markdown
**On:** `[branch]` (local HEAD matches PR tip) — [PR url if any]

**What's happening:** [short paragraph: concrete behavior after merge — who calls it, what comes back]

**Why:** [the problem or request this PR exists for]

**Dependencies:** [upstream systems, packages, config, endpoints this relies on; what has to exist first]

**How it connects:** [call chain / data flow across the queued files]

**Repo:** [mobile app / website front-end / backend / mixed / unclear] — [evidence from package.json, native dirs, or docs]

**Watch for** (bias uh-ohs when the hunk hits the seam; not a quiz):
- [doc bullet or kind-level question]
- …

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
- **core only** — walk ~**8** load-bearing files, **plus** any other changed files with high-risk diff signals (queue may exceed 8); batch the rest
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
**Diff:** [{pr}/files?file-filters[]=path:{path}#diff-{sha256} — optional hunks link; omit if no PR URL]

**What:** [concrete change in this file]

**Why:** [why this file had to change for the PR’s goal]

**Role in PR:** [one short paragraph: this file’s purpose in the whole PR — stated + implicit motivation; not a repeat of What/Why]

**Concept:** [optional, 2–4 sentences — the system this hunk sits on in this checkout (cache tier + what invalidates it, query-key boundary, shared-package contract, flag evaluation, device schema, native denial, job idempotency, migration order): the strategy here, what it buys, how it breaks. Pitch to the depth tag the host supplies for that system — scaffold: define it and gloss the jargon; build: skip the definition, add one new dimension; deepen: straight to the tradeoff and the easy miss. Omit unless the hunk is actually on that seam. Never a gate, never mention the tag.]

**Wiring:**
- **Into this file:** [{symbols} from `path/in/pr` or key package, …] or **none**
- **Out of this file:** [{export} → `consumer/in/pr`, …] or **none**
- **Outside this PR:** [`caller/not/in/pr` still imports `{changedExport}`, …] or **none found** — say **chase** for a thin card (opt-in; not an auto-queue)

**Links:** [already covered: …] [upcoming: …]

**Look closer:** [`parseNextCursorFromLinkHeader` L42–L68 — [why]] or **none**
**Map:** [optional — in-file: how Look closer pieces connect; **or** sibling: how this screen’s refresh/error path differs from `path/to/sibling.tsx` — only if useful; else omit]

**Could have:** [0–2 design forks: alternative + tradeoff vs what shipped, or **none**]

**Uh oh:** [0–3 might-be-wrong watch-outs, or “none”]

---

Before we continue: in your own words, what does this file change do, and why was it needed? Reply with that (or questions). Say **next** only after you’ve explained it — I won’t advance on “next” alone.
```

## Chase card (opt-in, thin)

Unchanged file. No full teach-back unless they keep going.

```markdown
**Chase** (not in this PR): `path/to/caller.ts` — still imports `{changedExport}` from `path/in/pr`

**Why we're looking:** [contract that changed — signature / error shape / flag meaning]

**What this site still assumes:** [one short paragraph + look-closer line range if you have it]

**Uh oh:** [only if the new contract does not hold here, or **none**]

---

Skip or **done looking** when you have seen enough. No paraphrase required.
```

When Look closer is a **behavior pivot** (semantic flag/signal choice), prefer a teach-back that invites the wrong alternative:

```markdown
Before we continue: in your own words, what does this file change do, and why was it needed? In particular, why `[symbol]` rather than the obvious alternative — what breaks if you use the wrong signal? Reply with that (or questions). Say **next** only after you’ve explained it — I won’t advance on “next” alone.
```

When Look closer is not none (and not only a pivot nudge), you **may** add a milder hotspot nudge (still not a hard gate on non-pivot files):

```markdown
Before we continue: in your own words, what does this file change do, and why was it needed? If it helps, say what `[Name]` (around L[n]) does — naming it is a plus, not required if the file-level explanation is solid. Reply with that (or questions). Say **next** only after you’ve explained it — I won’t advance on “next” alone.
```

If a **sibling Map** was shown, you may invite the divergence in the same paraphrase — still one gate, not a second quiz.

When Look closer is none, keep the first teach-back paragraph. For **styles/barrel** files, the first paragraph is enough; do not demand property-by-property recitation. For **tests** locking a helper, what they guard and why is enough if the helper contract was already paraphrased upstream. Same-rename expectation updates: one line is enough; honor **skip remaining tests** / skip string-change files instead of another gate.

## Teach-back: inadequate

Stay on the same file (or the final summary). One short correction — the
highest-leverage missing piece, not a list of internals they already
covered upstream — then re-prompt.

```markdown
Close, but [the missing or wrong piece in one sentence].

Try that part again in your own words — still this file / still the whole PR, not done.
```

## Teach-back: question after a good paraphrase

Answer. Do not recap the file. **Review Q&A only** — no implementation offers.
Then the next card, wrap-up, or a short “say **next** when you want to continue”
if they might have more questions.

```markdown
[Direct answer — understanding only.]

That’s enough on this file unless you want to stay. **Next** when you’re ready.
```

## Teach-back: question, then re-prompt

They have **not** paraphrased yet. Answer the question, then re-prompt.
Do not advance. **Review Q&A only** — explain the code; do not offer to
change it or “do this in a follow-up” unless they explicitly asked for edits.

```markdown
[Direct answer — understanding only, no implementation offers.]

Still this file: in your own words, what does it change, and why was it needed?
```

## Inline note: question answered

For **Ask in chat** or an inline **question** on a line range. Explain only.

```markdown
[Direct answer about what the selected code does and why it is shaped this way. No offers to refactor or land follow-up changes.]

[Optional: one line they could paste into a GitHub review comment if they want to raise it — not “I can fix this”.]
```

## Inline note: comment acknowledged

```markdown
[Short acknowledgment — sharpen their note if helpful. Do not rewrite the code or offer to edit.]
```

## Teach-back: adequate → advance

One line of confirmation, then immediately the next file card (or wrap-up
if the queue is empty). Do not recap the whole file.

```markdown
That’s the idea.

[Next file card, or wrap-up]
```

## Skip

Only when they explicitly skip. Skip this file, **skip remaining tests**
(string-only / same-rename bookkeeping), or skip the rest of the walk.

```markdown
Skipped `path/to/file.ts`.

[Next file card, or wrap-up]
```

If they asked to skip remaining same-rename tests, list those paths (or
a count) and continue at the next non-test — do not open the next test
card.

## Quit (large-PR gate or they end early)

Offer to restore the starting branch. Do not switch if dirty.

```markdown
Stopping here. Want me to check out `[starting-branch]` again?
```

## Wrap-up

Do not restate the opening overview. Uh-ohs, then their structured summary.
Design forks: at most 1–2 high-value items, or omit the section.

```markdown
**Lingering uh-ohs:** [compact list, or “none”]

**Design forks:** [at most 1–2 — file + fork in one line each — or omit]

That’s the files. In your own words, cover:
1. **User outcome** — what this changes for someone using the app after merge
2. **Shared gate** — which module owns the shared contract (name it) and what that contract is
3. **Surface differences** — where call sites diverge, **if they do**. If this PR is one shared surface with no opt-in split, naming that path is enough — do not invent a framework-vs-network story.
4. **Open question** (optional) — one thing you’d still ask the author

I won’t close out on “done” alone.
```

A summary that only restates the product story and never names the shared
gate *anywhere in the walk* is thin — one short correction, stay. Credit
file paraphrases and earlier wrap-up tries: do not fail a later try for a
beat they already said, and do not pick a new beat after they fill a stay.

## Wrap-up: adequate

```markdown
That’s the idea.

Want me to check out `[starting-branch]` again?

If you are ready to approve or request changes on GitHub, take your notes
(uh-ohs, open questions) with you — do not treat this walk as the review
submission itself.

If you want a defect pass next, say so. I won’t start one unless you ask.
```
