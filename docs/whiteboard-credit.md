# Ideas from Whiteboard (/dev/fast)

**Credit:** several presentation and efficiency patterns here were adapted from [Whiteboard](https://dev.fast/) by [/dev/fast](https://dev.fast/about) — open source (MIT), [github.com/devdotfast/whiteboard](https://github.com/devdotfast/whiteboard). Their tagline fits this project too: *code is cheap, judgement isn’t.* They put judgment on an architect canvas; this walkthrough puts it on the reviewer via teach-back. Different product, shared era.

We did **not** vendor their desktop app, Code-OSS fork, or Rust [diffr](https://github.com/devdotfast/diffr) AST engine. What we took is the *shape* of a few ideas, reimplemented in TypeScript against our existing Diff pane, overview, and chase pipeline.

## What we adapted

| Whiteboard idea | What we shipped | Where |
| --- | --- | --- |
| Semantic / AST diff folds (imports, tests, **pseudocode** for large adds via diffr plugins) | Heuristic folds + **`budgetDiffForAgent`** for file-card prompts when over `AGENT_DIFF_CHARS` | `server/diffFold.ts` (web re-exports for Diff pane) |
| Authoring brief: what/why → **design** → implementation (+ README “examples”) | Overview sections **Design** and **Examples** between Why and How it connects | `server/agent.ts` `publish_overview`, Transcript, `templates.md` |
| **TraceQuote** — author/agent decision quotes pinned to implementation | **Author asked for** anchors: intents extracted from the PR body, attached to file cards when the hunk is where they landed | `server/intentAnchors.ts`, Role pane |
| Structural regions (fold/leaf alignment from diffr) | Snap Look closer / Be careful onto enclosing functions via existing `functionAtLine` | `server/structure.ts` |
| Persistent `git cat-file --batch` + hydrate hits against pinned blobs (`@dev.fast/local-vcs`) | Same batch-reader pattern for chase/wiring file reads; discard grep hits whose text no longer appears in the blob | `server/blobBatch.ts`, `server/wiring.ts` |

## What we deliberately did not take

- Spatial whiteboard / agent-drawn diagrams as the primary review surface — fights the one-file teach-back spine.
- Full agent-trajectory store and publish-time quote validation against JSONL sessions.
- Vendoring `diffr` / WASM plugins — optional later if heuristic folds are not enough.

## Efficiency note

**Shipped — agent tokens:** when a hunk exceeds `AGENT_DIFF_CHARS`, `budgetDiffForAgent` folds imports and large adds to pseudocode before truncating (`server/diffFold.ts` → `generateFileCard`).

**Shipped — disk / reload:** session JSON pins `headOid` + paths only; `fileText` / `diffText` are rehydrated from git on restore (Whiteboard pin pattern).

**Shipped — runtime:** `server/blobBatch.ts` (`git cat-file --batch`) for chase/wiring hydrate.

**Shipped — human attention:** Diff pane folds use the same finder.

See also [token-efficiency.md](./token-efficiency.md).

## License / upstream

Whiteboard and diffr are MIT-licensed. Our adaptations are original TypeScript in this repo; credit belongs with /dev/fast for the product thinking and the documented patterns we studied in their source. If you want the full architect canvas, use [Whiteboard](https://dev.fast/) itself.
