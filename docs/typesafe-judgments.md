# Typed judgments with TypeSafe (Jev)

**Huge thanks to [TypeSafe](https://typesafe.ai) and [Jev](https://docs.typesafe.ai/concepts/system-one.md).** This walkthrough leans on System One for the gates that need a *decision*, not another paragraph of prose — and Jev is the model that makes that feel like programming instead of prompt-and-parse roulette.

A review walk is full of small semantic calls: was that teach-back adequate, is this file on the spine, does that import actually bind to the module we changed? Those are not good jobs for a long-form coding agent (slow, expensive, easy to overfit into chatty grading). They *are* a natural fit for TypeSafe’s System One primitives — Choice, Noul, Score — over structured state, with confidence floors so uncertain answers fall through instead of inventing certainty.

Cursor still writes the cards, answers questions, and rewrites private notes. TypeSafe owns the programmable common sense in between.

Live docs: [typesafe.ai](https://typesafe.ai) · [System One](https://docs.typesafe.ai/concepts/system-one.md) · [JS SDK](https://docs.typesafe.ai/sdk/javascript.md). Set `TYPESAFE_API_KEY` in `.env` (see `.env.example`). Without the key, every judgment returns `undefined` and the host keeps the previous heuristic or Cursor fallback — the walk still runs.

## Why this split

| Layer | Who | Job |
| --- | --- | --- |
| Prose | Cursor agent (`@cursor/sdk`) | File cards, Q&A, commentary, chase explanations |
| Judgment | TypeSafe System One (**Jev**) | Grade, route, rank, bind, verify — typed answers + probabilities |
| Discovery | Local code | Grep, aliases, barrels, path classifiers — candidates before any model |

Code discovers; Jev decides among what code found. That is deliberate: never ask a model to invent the importer list, only to rank or bind it.

## The doors we use

Each lives under `server/judgments/` and goes through `server/typesafe.ts` (shared client, confidence floors). Smoke them live with `npm run check:typesafe`.

| Judgment | Primitive(s) | When it fires |
| --- | --- | --- |
| **Teach-back** | Choice (+ speculative gap) | Adequacy of the reviewer’s paraphrase before advancing |
| **Intent** | Choice | Skip / ask / teach-back routing of free-text commands |
| **Core** | Score | Which changed paths belong on a large-PR “core only” spine |
| **Busywork** | Score | Which pending test/spec paths are safe to batch-skip |
| **Chase** | Score | Which outside callers are worth offering on the Chase chip / Wiring list |
| **Bind** | Noul | Whether an ambiguous import (alias / same-name) really targets *this* module |
| **Verify** | Noul | Whether a Look closer / Be careful claim is supported by the hunk |
| **Concept** | Choice | Which architectural seam to teach when several match |

Missing key, low confidence, or API failure → `undefined` → host fallback. No silent “looks fine.”

## Outside callers (blast radius)

The Wiring tab’s **Outside this walk** list is the concrete payoff of that split:

1. **Code** (`server/wiring.ts` + `server/aliases.ts`) greps export symbols and the module stem, resolves `tsconfig`/`jsconfig` path aliases (`@/…`), and follows **one** barrel re-export hop.
2. **Jev** (`bind` then `chase`) keeps ambiguous hits that actually bind to the changed module, then ranks which callers are worth a thin chase card.
3. **UI** lists them without requiring the chip first; Chase still inserts at most a few paths, no chase-on-chase.

Alias / importer plumbing (no live API): `npm run check:wiring`.

Token and prompt budget notes for the Cursor side of the walk: [token-efficiency.md](./token-efficiency.md).

## Credit, again

Building this without System One would have meant either brittle heuristics or turning every gate into another Cursor round trip. Jev let the host stay a program: small questions, typed answers, confidence you can threshold. That is the shoutout — TypeSafe and Jev made the judgment layer feel like software.
