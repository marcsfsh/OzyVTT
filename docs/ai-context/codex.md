# Worldbuilding Codex

**Read this when:** touching anything under `apps/server/src/codex-store.ts`,
`apps/server/src/codex-projections.ts`, `apps/server/src/codex-http.ts` or
`apps/client/src/codex/`, or any player-facing worldbuilding read. The Codex is the second
product pillar, not a notes pane: it has its own authoritative store and its own security
boundary.

## Key files

- `apps/server/src/codex-store.ts` — the authoritative store: records, migrations, search
  index, calendar maths, export/import. Owns its own revision counter.
- `apps/server/src/codex-projections.ts` — **the security boundary.** Every player-facing
  read projects through it.
- `apps/server/src/codex-http.ts` — the router: authorization, ETags, envelopes, error
  mapping.
- `apps/client/src/codex/` — the GM shell, the player shell, and the views.
- The route surface is in the generated `docs/api-reference.md`; client addresses are in
  `apps/client/src/router.ts`.

## Core model

**Everything is two-layer.** A record carries a player-facing half and a GM-secret half, plus
a reveal flag. The GM writes both; a player receives the player half of a revealed record and
nothing else — no GM body, no GM fields, no revision.

**The Codex is authoritative in its own right.** It is not part of `GameState` and does not go
through the game command pipeline. It has its own store, its own revision counter, its own
HTTP router, and a content-free `codex:changed` socket ping that carries only a revision.
Clients refetch their own projected view; the ping never carries content, because *which kind
of record the GM is editing* is itself GM information.

## Invariants

- **Project, never filter.** `codex-projections.ts` is the single audited choke point. Do the
  stripping there — never in the store, never in the router. A player-facing shape is built by
  an explicit allow-list, not by deleting keys from a GM row.
- **Reveal is a graph, not a flag.** A child record may not leak the identity of an unrevealed
  ancestor or target: a sub-map's `parentMapId` is nulled unless the parent is revealed, a
  marker's page links are filtered to the revealed subset, and a quest's entity ids likewise.
  A projection that needs a neighbour's reveal state takes it as an argument — the caller
  resolves it — so the panel and the graph are gated by one predicate rather than two.
- **Some GM fields are GM-only ALWAYS, not "until revealed."** A marker's `sceneIds` and a
  session's `sceneIds` (D31, ruling R2) never enter a player projection even when the record is
  revealed: revealing a session publishes its RECAP, and the fights the GM has staged for the
  evening are spoilers either way. Scenes are not player-addressable objects anywhere in the app.
- **A hidden record is a 404, never a 403.** Existence is itself information. The same rule
  governs conditional requests: the ETag is computed at serialization, after every
  authorization and existence gate, so a 304 can never confirm that a hidden record exists.
- **Every GET carries a weak ETag scoped to revision, role grade and resource.** A tag that is
  not scoped to one resource is not an ETag.
- **The GM previews as a real player.** `POST /api/v1/codex/preview-session` mints a genuine
  short-lived *player* principal. Never fake the player view by branching on role in the
  client — a preview that is not a real principal proves nothing.
- **Writes are role-gated at the router, reads are grade-gated.** `principalFor` resolves gm /
  player / integration / denied / none once per request and memoizes it, because credential
  verification writes an audit row and resolving twice double-counts a refusal.

## Gotchas

- Codex vocabulary and calendar maths are duplicated client-side on purpose (an accepted
  debt): the composer must preview a date for a record that does not exist yet. **Where a
  record exists, the server's answer wins** — read `calendarInstant` / `proposedDate` from the
  record rather than recomputing.
- The player calendar and the GM calendar are two clocks. Advancing the GM's campaign "now"
  never moves the players'; a campaign date reaches players only when it is published.
  **One exemption, and it is the only one (D6, 2026-08-09):** `writeCalendar` still
  auto-publishes the first date given to a codex that holds **no records at all** — the
  seeding case. K7 used to exempt the first date of *any* codex, which meant an existing
  campaign's first date was broadcast by a write that says nothing about publishing;
  `isUnusedCodex()` is what narrowed it.
- An era is **derived, never stored on a date** (`5f`). `CodexCalendar.eras` is a list inside
  `calendar_json`, and a date's era is the last era whose `startYear` its year has reached
  (`eraForYear`). There is no `in_world_era` column and there must not be one: it would make
  `calendar_instant` ambiguous and force a backfill to invent a value for every date already
  written. Changing the list re-labels dated records through `writeCalendar`'s reflow; it
  never moves one.
- Codex projections are a *second* boundary, separate from the table viewer's. If you are
  changing them, `.claude/rules/viewer-safety.md` is the rule to load, and
  `docs/ai-context/viewer-mode.md` covers the other half.

## Relevant ADRs

`0016` (public integration API — the Codex is credential-reachable at GM grade), `0007`
(additive versioned content), `0006` (SQLite). Codex-specific decisions are dated in
`docs/ai-ledger/decision-log.md` rather than in an ADR.
