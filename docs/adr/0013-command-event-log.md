# ADR-0013 closing record: transactional command/event log with snapshots

## Status

Accepted by implementation — recorded 2026-08-01. **Closes** ADR-0013 ("Transactional
command/event log with snapshots and bounded undo"), which had no file and stood as
*Proposed* in `docs/adr/README.md`.

## What happened

Shipped. Each accepted command writes its idempotency receipt, its ordered domain event and
the new state projection in **one SQLite transaction** (`apps/server/src/game-store.ts`), with
`command_receipts` keyed by `commandId` so a replay returns the prior result rather than
re-applying, and periodic snapshots bounding replay. Stale `expectedRevision` is rejected with
a revision conflict rather than overwritten. `docs/ai-context/realtime.md` is the live
description.

## Recorded outcome

**The log and the snapshots shipped as described.** The pipeline is the one every server
mutation walks; `vtt-orientation` documents its seven touch points.

## What is still open

**"Bounded undo" did not ship as described.** What exists is turn-boundary time travel over a
separate `turn_snapshots` table (`apps/server/src/combat-history.ts`), which rewinds the table
to the end state of a prior turn and re-plans forward. That is a different feature from
per-command undo: it is scoped to combat, its unit is a turn rather than a command, and it
prompts before discarding a rewritten future. A general per-command undo remains **undecided**
— if it is wanted, it needs its own ADR rather than being read out of this one.
