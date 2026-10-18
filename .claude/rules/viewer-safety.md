---
paths:
  - "apps/server/src/projections.ts"
  - "apps/server/src/viewer-*.ts"
  - "apps/server/src/replay-projection.ts"
  - "apps/server/src/codex-projections.ts"
  - "apps/server/src/codex/visibility.ts"
  - "apps/server/src/codex/player-reads.ts"
  - "apps/server/src/codex/first-shown.ts"
  - "apps/server/src/codex/blocks.ts"
  - "apps/server/src/codex/find.ts"
  - "apps/server/src/codex-http.ts"
  - "apps/client/src/viewer/**"
  - "apps/server/src/vision/audience.ts"
---

# Projection safety

These files decide what players and the public table screen receive. A field may reach a player
or the viewer only if everything it carries is already public to them, and it carries no exact
quantity and no identity, position or existence of a hidden thing. When in doubt, omit it.

- Build player-facing shapes from an explicit allow-list. Never spread a GM-side object and
  delete keys from it.
- Fog and dynamic vision are part of the boundary (ADR-0023). A creature no player character
  perceives, or one wholly under fog, is left out of players' and the viewer's payloads exactly
  like a GM-only one. Anything else that might name it, bend a public die for it or point at it
  (narration, refusals, prompts, rules) asks `hiddenFrom` in `vision/audience.ts`, never
  `visibility === "gm-only"` alone.
- In the Codex a player gets the parts of a revealed record that reach their reader (the party
  characters the session claimed, or the ones a GM preview names) and nothing else. A hidden block,
  a Hidden field or an objective for another character leaves no trace: no text, no gap, no
  mention, no search hit, no moved date or ETag. A revealed child must not leak an unrevealed
  parent or target, and a `[[link]]` to a page the reader cannot open reads as plain text in any
  record text a player receives (`plainUnopenableLinks` in `codex-projections.ts`). A
  hidden record is a 404, never a 403. Every read a player can make of the Codex is built in
  `codex/player-reads.ts`, per reader; the router serves it and the players' `codex:changed` ping
  hashes it per audience, so a GM-only edit must leave its output unchanged, and a reveal to one
  character must leave every other reader's unchanged. Players see a record's first-shown date
  (`codex/first-shown.ts`), never when the GM made or edited it. The GM's preview only reads.

See the "Projections" section of `docs/ARCHITECTURE.md`.
