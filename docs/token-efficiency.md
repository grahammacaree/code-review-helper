# Token efficiency

A walk is not one prompt; it is a few dozen, and the reviewer waits on each one. Every character sent is paid twice — once in tokens, once in the seconds before the card appears. This is what each prompt sends, why that is the right amount, and the guards that keep a cheap prompt from producing a worse card.

Figures are marked **measured** or **inferred**. Measured ones come from counting the assembled prompt strings; inferred ones are arithmetic on top of those.

## The rule the techniques come from

A walk runs on **one agent and one conversation**. Everything already sent is still in the context window, so re-sending it buys nothing. Almost every technique here follows from taking that seriously — and the alternative is tempting precisely because a self-contained prompt looks obviously correct in isolation.

## Send the standing context once

`AgentPriming` in `server/agent.ts` tracks what a given agent has been told: the walk context (private notes, checkout map, PR overview) and which architectural concepts have been framed. The first card carries all of it; later cards carry a short reminder and their own diff.

**Measured: ~14,100 characters (~3,500 tokens) per file card after the first.** On a twelve-file walk that is **inferred: ~39,000 tokens.**

Two guards keep this from degrading the cards:

- **Re-priming.** `REPRIME_AFTER_CARDS` (6) sends the durable material again periodically. In a long walk with large diffs the opening notes drift far enough back that the model stops weighting them, and a card written without the private notes is a worse card. This deliberately gives back part of the saving.
- **Reset on replacement.** The priming state is dropped whenever the agent is replaced, including the auth-error retry path in `server/session.ts`, because a new agent has been told nothing. Priming state outliving its agent would quietly produce cards missing their context.

## Excerpt around the question, do not cut at the head

Where a prompt needs part of a file, it gets the part that answers the question. A chase card asks whether an unchanged call site still holds now an export has changed, so the answer is at the call site — which in a large caller is nowhere near the first few thousand characters. A prefix cut there can cost full price and still omit its own subject.

`server/excerpt.ts` follows the names: it finds mentions of the chased export, expands each to its enclosing function (via `functionAtLine`, so the excerpt is a whole call in context rather than an arbitrary window), merges overlapping regions, and does the same on the changed module restricted to definitions. Budgets are `AGENT_CHASE_CALLER_CHARS` (3,000) and `AGENT_CHASE_EXPORT_CHARS` (1,500).

**Measured: 9,450 characters across three realistic chases, against 33,523 for the same three files cut at their heads (~6,000 tokens).**

Three properties worth keeping:

- When no mention is found — a renamed export, a re-export, a generated file — it falls back to the head of the file. A worse excerpt beats an empty prompt.
- The excerpt says what it is (`the call site with the surrounding function`, `2 call sites of 5 mentions…`), so the model knows it is reading a selection rather than a whole file.
- Imports are skipped, including names sitting on their own line inside a braced import list. An import proves nothing about use.

A prefix cut is right where the head genuinely is the useful part: `AGENT_DIFF_CHARS` (8,000) on a diff, `AGENT_BODY_CHARS` (4,000) on a PR body, `AGENT_PATH_ROWS` (120) on the changed-path listing — enough of a large PR to see its shape without paying for every path.

## Send recent history, clipped

`priorParaphrases` in `server/session.ts` gives the teach-back grader the last five file paraphrases and the last two wrap-up attempts, each clipped to 300 characters. The grader needs to know a point was made recently; it does not need every word of it, and it does not need the start of the walk.

## Take the section, not the bundle

`checkoutMapBlock` in `server/commentary.ts` extracts just the repo map, because the function brief needs the map and not the craft notes or the hand-written best-practice commentary. A prompt takes the section it uses.

## Ask once and keep the answer

The function brief behind the sandbox's About tab costs a round trip, so nothing is fetched until the tab is opened and the result is cached per function (keyed `path:startLine`). **Ask again** is the only thing that bypasses the cache — an explicit request, so a stale answer cannot be served to someone who asked for a fresh one.

## Latency is a separate axis

Fewer tokens usually means a faster card, but two of these are purely about waiting:

- **The notes rewrite runs in the background.** Nothing the reviewer does next depends on it, so the walk can end while it finishes; only closing the agent awaits it.
- **Sends are serialized.** One agent and one conversation means two runs in flight would interleave, so `withAgent` queues them. Background work waits behind whatever the reviewer asked for rather than racing it.

## If you are adding a prompt

1. Ask what the agent has already been told this walk. If it is in the conversation, reference it instead of repeating it.
2. If you are about to truncate a file, ask whether the head is the part that answers your question. If not, excerpt around what does.
3. Take the section of the private notes your prompt uses, not the bundle.
4. Measure the assembled prompt before and after. A percentage without a measurement is a guess.
5. Cache anything a reviewer can trigger repeatedly, and give them an explicit way to bypass the cache.
