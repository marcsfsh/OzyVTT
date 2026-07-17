---
name: vtt-implement
description: Use to turn an agreed task packet into actual code changes on this repo. Inspects existing implementation before adding structure, stays bounded to the packet, respects the hard invariants, verifies, and ends with an implementation summary. Follows vtt-task-packet; hand off to vtt-qa-check.
---

# vtt-implement

Execute a task packet into code — bounded, invariant-respecting, and verified. Assumes a
packet exists (`vtt-task-packet`); if the work is trivial enough not to need one, you don't
need this skill either.

## Sequence

1. **Route context.** Use `vtt-context-router` to read the 2-4 relevant `docs/ai-context`
   files for what the packet touches. Skim `known-bugs.md` for landmines in that area.
2. **Inspect before adding.** Read the existing implementation of the surface you're changing
   *before* proposing new structure. Match the surrounding code's patterns, naming, and
   idioms — this repo has strong conventions (server-authoritative commands, zod validation,
   projection boundaries, pointer-event gestures). Extend the existing shape; don't bolt on a
   parallel one.
3. **Implement bounded to the packet.** Change what the acceptance criteria require and no
   more. Anything outside *Relevant context* / into *Out of scope* is a deliberate decision,
   not drift — if you find you need it, stop and say so (see Blockers).
4. **Hold the hard invariants** (from `CLAUDE.md`) on every change:
   - Server owns `GameState` — no game logic, snapping, visibility, or authorization on the
     client; the client may render a *preview* but never the persisted value.
   - Viewer safety — nothing GM-only reaches the public viewer; re-check any new field added
     to a viewer projection.
   - Role boundaries — a player acts only on their claimed character; GM-only commands stay
     gated per command.
   - Mobile parity — new draggable/zoomable surfaces set `touch-action: none`; works at a
     narrow viewport.
   - Contract lives once in `packages/domain` — change it there and keep client + server in
     lockstep.
5. **Verify for real.** Run the tier the change warrants (`vtt-test-pass` / `testing.md`):
   at minimum `npm run check`; add `npm test` for logic; run the app + a narrow-viewport pass
   for UI; confirm viewer safety when projections change.
6. **Summarize.** End with: files changed, behavior added/changed, verification actually run
   (with results), and remaining risks or follow-ups.

## Blockers — stop instead of sprawling

If you hit a genuine blocker (the packet is under-specified in a way that changes the build,
a required change is out of scope, or an invariant conflicts with the ask), stop and surface
it — via `AskUserQuestion` if a decision is needed. Don't silently expand scope or weaken an
invariant to get unstuck.

## Branch discipline

Confirm branch + scope before major edits and before committing (`vtt-branch-safety`). Commit
only when the user asks; never put a raw model id in commit/PR text.

## Hand off

`vtt-implement → vtt-qa-check` (for meaningful work) `→ vtt-ledger-update` once it lands.
