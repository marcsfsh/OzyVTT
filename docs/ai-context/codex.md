# Worldbuilding Codex

**Read this when:** touching anything under `apps/server/src/codex-store.ts`,
`apps/server/src/codex-projections.ts`, `apps/server/src/codex-http.ts` or
`apps/client/src/codex/`, or any player-facing worldbuilding read. The Codex is the second
product pillar, not a notes pane: it has its own authoritative store and its own security
boundary.

> **Skeleton — structure only.** Plan A owns this file's existence (D12); Plan B §3.5
> (Developer 2) writes the body of every section below. The headings, the reading trigger and
> the code pointers are fixed here so the six documents that cite this file
> (`CLAUDE.md`, `auth-roles.md`, `viewer-mode.md`, `map-grid.md`,
> `.claude/rules/viewer-safety.md`, `.claude/skills/vtt-context-router/SKILL.md`) have a real
> target to point at. **Rules that point at code — never an inventory** (D2).

## Key files

- `apps/server/src/codex-store.ts` — the authoritative store. Owns its own revision counter.
- `apps/server/src/codex-projections.ts` — **the security boundary.** Every player-facing read
  projects through it.
- `apps/server/src/codex-http.ts` — the router: authorization, ETags, envelopes, error mapping.
- `apps/client/src/codex/` — the GM shell, the player shell, and the views.
- The route surface is in the generated `docs/api-reference.md`; client addresses are in
  `apps/client/src/router.ts`.

## Core model

_Awaiting Plan B §3.5 (Developer 2): the two-layer record, and why the Codex is authoritative
in its own right rather than part of `GameState`._

## Invariants

_Awaiting Plan B §3.5 (Developer 2): project-never-filter; reveal is a graph, not a flag; a
hidden record is a 404 and never a 403; ETags scoped to revision, role grade and resource; the
GM previews as a real player principal; writes role-gated at the router, reads grade-gated._

## Gotchas

_Awaiting Plan B §3.5 (Developer 2)._

## Relevant ADRs

_Awaiting Plan B §3.5 (Developer 2). Codex-specific decisions are dated in
`docs/ai-ledger/decision-log.md` rather than in an ADR._
