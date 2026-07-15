# Phase 0 command, persistence, and idempotency spike

> Superseded by the accepted Phase 1 SQLite implementation in ADR-006. The command contract established here remains current.

## What this proof establishes

- Every state-changing command carries a unique command ID.
- The server serializes commands, records one receipt and one event, increments a monotonic game revision, and persists the snapshot and journal locally.
- Retrying the same command returns the current accepted result without executing it twice.
- A command carrying an outdated expected revision is explicitly rejected.
- JSON files use write-then-rename to avoid a partially written individual file.

## Original scope and limitations

This was a deliberately small, file-backed proof using character claim/release commands. Phase 1 has now replaced the two JSON files with one SQLite database providing transactional receipts, events, projections, ordered migrations, and periodic snapshots. The contract—command ID, expected revision, event receipt, and authoritative state revision—remains the same.

## Automated evidence

`apps/server/test/game-store.test.ts` now verifies initialization and migration, one accepted transactional command, a duplicate retry, a stale revision conflict, restart recovery, durable receipts/events, and periodic snapshots.
