# ADR-006: Embedded SQLite persistence

## Status

Accepted — 2026-07-15.

## Context and decision drivers

The local-host VTT needs transactions, migrations, ordered events, idempotency receipts, snapshots, simple backup, and minimal administration. A two-file JSON proof established the contract but could not atomically commit state and history together.

## Considered options

- JSON snapshots/journals: minimal dependency surface but inadequate cross-file transaction guarantees.
- External database service: robust but violates the single-service, low-administration product goal.
- SQLite through a native npm addon: mature, but adds platform-specific binary installation and upgrade concerns.
- Node's built-in `node:sqlite`: embedded, zero additional service/addon, and available in the selected Node 24 runtime.

## Decision

Use Node 24's built-in SQLite API. Store the current projection, command receipts, ordered domain events, migration history, and periodic snapshots in one local database. Enable foreign keys and WAL mode. Every consequential command commits its receipt, event, and projection in one transaction.

## Consequences and tradeoffs

The host has one obvious database file and no database service. Node 24 becomes the minimum runtime. The built-in SQLite API is still marked release-candidate/experimental across current Node release lines, so its compatibility must be reviewed before production packaging and pinned Node updates.

## Mobile, security, and visibility impact

None directly. Recipient-specific projections remain a server boundary; SQLite contains authoritative private state and must be included in protected backups.

## Migration / reversibility

Schema changes use ordered migrations. Backup/restore and downgrade policy remain Phase 1/Version 1 work. The `GameStore` boundary allows replacing the adapter without changing commands or clients.

## Validation evidence

Automated store tests cover migration/initialization, one transactional command, persisted receipt/event, duplicate retry, revision conflict, restart recovery, and periodic snapshots.
