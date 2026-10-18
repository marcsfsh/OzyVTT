---
paths:
  - "apps/server/src/projections.ts"
  - "apps/server/src/viewer-*.ts"
  - "apps/server/src/replay-projection.ts"
  - "apps/server/src/scene-preview.ts"
  - "apps/server/src/combat-log.ts"
  - "apps/server/src/codex-projections.ts"
  - "apps/server/src/codex-http.ts"
  - "apps/server/src/codex/{visibility,player-reads,first-shown,blocks,find}.ts"
  - "apps/server/src/vision/audience.ts"
  - "apps/server/src/{content-library,homebrew-store,homebrew-player}.ts"
  - "apps/server/src/commands/{pipeline,reads}.ts"
  - "packages/domain/src/{views,codex-wire}.ts"
  - "apps/client/src/viewer/**"
---

# Projections

These files decide what players, the table screen and the Codex player view receive. A field reaches
them only if everything it carries is already public to that audience: no exact quantity, and no
identity, position or existence of a hidden thing.

- Build a player or viewer shape from an explicit allow-list. Never spread a GM object and delete keys.
- Ask `hiddenFrom` (`vision/audience.ts`) whether a creature is hidden. `visibility === "gm-only"`
  alone misses fog and dynamic vision.
- Codex: a hidden block, a Hidden field or another character's objective leaves no gap, search hit,
  moved date or ETag. A hidden record is a 404, never a 403. A `[[link]]` the reader can't open is
  plain text (`plainUnopenableLinks`). Players get `firstShownAt` and `playerUpdatedAt`, never
  `createdAt` or `updatedAt`.
- Every player Codex read is built per reader in `codex/player-reads.ts`, and the `codex:changed` ping
  hashes it. A GM-only write must leave every player's read unchanged, and a reveal to one character
  must leave the others' unchanged. `apps/server/test/codex-conventions.test.ts` and
  `realtime-presence.test.ts` pin both; extend them for a new read.
- Homebrew: a player read takes `ContentLibrary.forAudience` for that reader, never the GM's catalog
  or `play`. No pack name, audience or reveal date reaches a player. A player command that adds a
  record checks it against that player's catalog.
