# ADR-0013 closing record: transactional command/event log with snapshots

## Status

Accepted by implementation — recorded 2026-08-01. **Closes** ADR-0013 ("Transactional
command/event log with snapshots and bounded undo"), which had no file and stood as
*Proposed* in `docs/adr/README.md`.

> **Skeleton — structure only.** Plan A owns this file's existence and its numbering
> (D13 + MASTER-PLAN §9 O-1). Plan B §5.4 (Developer 2) writes the prose.

## What happened

_Awaiting Plan B §5.4 (Developer 2): each accepted command writes its idempotency receipt, its
ordered domain event and the new state projection in one SQLite transaction
(`apps/server/src/game-store.ts`), with `command_receipts` keyed by `commandId` and periodic
snapshots bounding replay._

## Recorded outcome

_Awaiting Plan B §5.4 (Developer 2)._

## What is still open

_Awaiting Plan B §5.4 (Developer 2): "bounded undo" did not ship as described. What exists is
turn-boundary time travel (`apps/server/src/combat-history.ts`); a general per-command undo
remains undecided and would need its own ADR._
