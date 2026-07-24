---
name: vtt-orientation
description: Get oriented fast in this repo - the app's state shape, command/HTTP surface, and where things live. Use at the start of a session or task when you need the lay of the land, are adding or changing a command, ask "what's the socket/HTTP surface", "where does X live", or "where does this data flow", or are onboarding to the codebase. Points at the generated app map first, then the command pipeline and the projection/viewer-safety rules.
---

# vtt-orientation

The fast path to understanding this codebase without reading the whole tree. Start with the
generated map, then use the checklists below when you touch the command or projection surfaces.

## Start here (in order)

1. **`docs/app-map.md`** — generated, always fresh (a freshness test fails if it drifts). It lists
   the `GameState` top-level shape, the full **command catalog** (type -> required scope), every
   **HTTP path**, and a curated "where things live" file index. Regenerate any time with
   `npm run map`; never hand-edit it.
2. **`CLAUDE.md`** — the constitutional index: product identity, non-negotiable rules, and pointers.
3. **`docs/ai-ledger/current-state.md`** and **`known-bugs.md`** (both short) — what exists now and
   what's already broken.
4. Then route into `docs/ai-context/` with the **`vtt-context-router`** skill — read only the 2-4
   subsystem briefs the task actually touches.

## Adding or changing a command (the pipeline)

Every server mutation is one command that walks the same path. Touch all of these or it won't work
across both transports:

1. Payload type in `ClientToServerEvents` — `packages/domain/src/index.ts`.
2. Zod validation schema — `apps/server/src/game-commands.ts`.
3. Required integration scope in `GAME_COMMAND_SCOPES` **and** an OpenAPI operation —
   `packages/api-contract/src/index.ts` (the served OpenAPI doc must stay byte-identical).
4. Handler + `gameCommandRegistry` entry — `apps/server/src/game-operations.ts`.
5. Socket adapter line — `apps/server/src/server.ts`.
6. HTTP route + path constant — `apps/server/src/game-http.ts` (+ `GAME_PATHS`).
7. Projection decision — `apps/server/src/projections.ts` (and the viewer files if viewer-relevant).

Then run `npm run map` (the command/HTTP surface changed) and `npm run check`/`npm run test`.
Closest copy-me template for a player-allowed, own-character command: `actor.spend-hit-dice`.

## The projection / viewer-safety rule (a hard invariant)

Projection is the security boundary — get it wrong and you leak GM data.

- **`projectPlayerView`** (`apps/server/src/projections.ts`) strips sensitive fields in one
  destructure, then re-adds owner-only fields with `...(mine ? {…} : {})`. A player's own
  `ActorDefinition` rides `ownDefinition` **only when `mine`**. Any new owner-only live field on
  `Actor` must be stripped-then-re-added-when-`mine` (copy how `actionUses`/`hitDice` are handled).
- **The public viewer** (`apps/server/src/viewer-encounter.ts`, `viewer-presentation.ts`) reads an
  allowlist from `actor` and never touches `definitions`. Re-read both files whenever you add a
  projectable field, and add a leak test (a second player + the viewer must never receive another
  character's private data).

## Rules

- The app map is a **map, not the territory** — it points at real source; when a curated line number
  and the code disagree, the code wins.
- **Server authority** — never move a game decision (dice, snapping, visibility, turn order) to the
  client; never trust client input for authorization.
- Regenerate `docs/app-map.md` (`npm run map`) whenever you change the state/command/HTTP surface;
  the freshness test enforces it.
