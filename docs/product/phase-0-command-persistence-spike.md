# Phase 0 command, persistence, and idempotency spike

## What this proof establishes

- Every state-changing command carries a unique command ID.
- The server serializes commands, records one receipt and one event, increments a monotonic game revision, and persists the snapshot and journal locally.
- Retrying the same command returns the current accepted result without executing it twice.
- A command carrying an outdated expected revision is explicitly rejected.
- JSON files use write-then-rename to avoid a partially written individual file.

## Current scope and limitations

This is a deliberately small, file-backed proof using character claim/release commands. It is **not** the final durable store: Phase 1 will replace the two JSON files with SQLite transactions, migrations, bounded event history, and snapshots. The contract—command ID, expected revision, event receipt, and authoritative state revision—remains the same.

## Automated evidence

`apps/server/test/game-store.test.ts` verifies one accepted command, a duplicate retry, persisted event receipt, and a stale revision conflict.
