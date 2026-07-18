# Current state

**Read this at session start.** Short source of truth for what exists *now*. Update it
(concisely) after real work lands — don't let it drift. This is a snapshot, not history;
history goes in `session-summary.md`, durable decisions in `decision-log.md`.

_Last seeded: 2026-07-17 (initial ledger seed from README / NEXT-STEPS / code survey)._

## What works today

- TypeScript monorepo: React/Vite client (`@vtt/web`) + authoritative Express + Socket.IO
  server (`@vtt/server`); packages `domain`, `rules-5e`, `schemas`, `api-contract`, `ui`,
  `content-srd-5.2.1`, `test-fixtures`.
- LAN-safe-by-design: no accounts/cloud. First-run GM password bootstrap is loopback-only;
  only a bcrypt hash + `tokenSecret` persist in `data/auth.json`.
- Server-owned session + character-claim model; separated GM/player projections; realtime
  state events with idempotency receipts and revision conflict handling.
- Embedded SQLite (WAL, versioned migrations); snapshots every 50 revisions.
- Authenticated map library with guided printed-grid (3×3 drag) / gridless setup and
  regional/world scales.
- Server-authoritative encounters: initiative, turns/rounds, token placement/movement with
  server snapping, per-drawing annotation colors, GM/player layer toggle, pings.
- Paired **table viewer** (second screen): pairing codes, "Present <map>", player-safe
  projection over SSE. Viewer bundle never receives full `GameState`.
- **Public integration API v1 (PR F) — core surface live.** All core combat capabilities are
  extracted into a transport-agnostic operations layer (`game-operations.ts` + shared schemas in
  `game-commands.ts`); Socket.IO handlers and the HTTP routes in `game-http.ts` are thin adapters
  over the same functions (ADR-0016, structural). Surface: `GET /api/v1/game` (GM-full or
  `?view=player` player-safe projection, weak-ETag polling), `GET /api/v1/game/log`, ~30 typed
  command routes (encounter lifecycle, initiative incl. timeline next/previous with 409
  `needsConfirm`, turn economy, token move, HP/conditions, roster add/import/remove, dice,
  action resolve, saves, annotations), a generic `POST /api/v1/game/commands` tunnel +
  `GET` catalog (type → required scope), `/api/v1/content/*` reads, and `/api/v1/encounters`
  archives (list/get behind `combat:read`, delete behind `admin`; legacy `/api/gm/encounters`
  kept). Auth per route: GM session, player session (player-limited, same reducer checks as the
  table), or GM-minted integration credential checked against per-route scopes; writes are
  idempotent by `commandId` with `expectedRevision` conflicts carrying `currentRevision`. CORS
  open on `/api` (bearer auth only), JSON body limit 512kb, OpenAPI 3.1 fully documents the
  surface (served byte-identical from `@vtt/api-contract`), capabilities advertise
  `gameApi`/`commandTunnel`/`encounterArchives`. No SSE/webhooks yet (deferred by design).
- **Time Machine v2 encounter archives.** Migration v5 `encounter_journal`: every accepted
  command while a fight is live is journaled in-transaction (type, payload, principal tag,
  revision, timestamp); `archiveSchemaVersion` 2 adds `journal[]` (start→end inclusive),
  `finalState`, complete `rolls[]`, full `definitions[]` (imported + bundled with CC-BY
  `attribution`) to the existing turns+log document. Shape documented in
  `apps/server/src/encounter-archive.ts`.

## Active work

- **Turn time-travel + persistent combat log (owner item #12)** — on branch
  `claude/pr34-work-6wg8n6`. The store keeps a turn-boundary snapshot at every advance in a
  new out-of-`GameState` `turn_snapshots` table (migration v3), written inside the command's
  transaction; `combat.historyCursor`/`historyDirty` (top-level combat only, never parked
  scenes) track the reviewed position and whether it changed. Previous rewinds the WHOLE table
  to the end state of the prior turn (combat + each actor's hp/conditions restored; rolls,
  claims, roster, scenes kept); Next steps forward undoing nothing until the return-point
  resumes live; a change made while rewound forces a GM confirm — Next rewrites history
  (truncating the undone future), Previous discards it in place. All navigation runs inside
  the store's serialized queue via `GameStore.executeTimeline`, so it can't race a command;
  `TimelineConfirmationRequired` bounces a command back with `needsConfirm` and burns no
  receipt. Lifecycle commands that would strand the timeline (`encounter:end`, `scene:activate`,
  `actor:remove`, player `turn:end`) reject while rewound; encounter start/end and scene
  switches truncate the timeline. A separate `CombatLogStore` (own SQLite table, capped ~1000)
  persists a role-filtered narrative feed (`log:entry`/`log:read`, GM-only lines never reach
  players); the GM view carries `turnHistory`, the player view a bare `rewound` flag (no
  labels). Client: GM Previous/Next confirm flow + review banner + contextual "Resume live
  play"; player "GM is reviewing" banner; a Combat log sidebar panel (module store, like the
  map toasts). Rolling turn-snapshot window is **250** boundaries. On `encounter:end` the fight
  auto-archives (turns + timestamped log) into a permanent, uncapped `encounter_archives` table
  (migration v4) atomically with the buffer truncation, exposed **GM-only** as machine-readable
  JSON (`GET/GET/DELETE /api/gm/encounters[/:id]`; shape in
  `apps/server/src/encounter-archive.ts`) for user-built integrations — the app never analyzes it.
  Also on this branch: three level-7 example PCs (full sheets in `state.definitions`), and an
  action-runner fix so a Multiattack/Extra Attack can be resolved repeatedly (list stays reachable
  + an "Again" button). `check`/`test` (270, incl. timeline + archive integration tests)/`build`
  green; production boot applies migrations 1–4; browser smokes render the combat-log panel and
  full PC sheets with no console errors.
- **Phase 2 testing-MVP vertical slice** is under active implementation; no phase exit gate
  claimed yet (see `README.md`, `BUILD_PLAN.md`).
- **SRD combat-content integration (phases A–G).** Phase A (content pipeline) done and
  audited: `packages/content-srd-5.2.1` carries vendored open5e `srd-2024` fixtures
  (CC BY 4.0) and cross-validated canonical bundles — 330 `ActorDefinition` monsters (423
  structured attacks), spells/weapons/armor/skills/damage-types/rules references,
  attribution (ADR-0015). Phase B done: GM browses the bestiary in encounter setup
  (`MonsterBrowser`), `actor:add-from-definition`/`actor:remove`/`content:monsters`
  commands instantiate/remove monsters with live HP and provenance (`Actor.definitionId`).
  Phase C done: server-authoritative HP tracking (damage/heal/temp/set commands, GM +
  own-character player scopes) with band-safe player projections (exact PC hp, monster
  bands). Phase D done: condition tracking (`Actor.conditions`, `actor:set-condition`,
  15 bundled SRD conditions with exhaustion levels, chips + pickers across GM/player
  surfaces — reference level per ADR-0008). Phase E done: turn economy (`combat.turn`
  action/bonus reset on turn change; per-combatant `reactionsUsed` refreshing at own turn
  start; `turn:use`/`turn:use-reaction`/`turn:end` — player End Turn gated to their own
  turn; hidden-turn economy stays opaque to players). Phase F done: `action:resolve` —
  the GM runs a stat-block combatant's actions from the Turn order (attack vs target AC
  with 2024 crit doubling, save-DC surfacing, typed damage), rolls recorded in the shared
  history (gm-only for hidden attackers), economy auto-marked, damage applied by explicit
  tap through the existing hp commands (Propose→Apply). Phase G done: `CharacterSheet`
  overlay — live HP/conditions over the full immutable stat block (abilities+saves, senses,
  languages, immunities, traits, actions, CC-BY line) via GM-gated `content:monster-sheet`;
  GM opens any combatant from the initiative, a player only their own (server-rejected
  otherwise; PC sheets stay thin until import). **All seven phases (A–G) of the SRD
  combat-content integration are complete on `claude/srd-content-pipeline`.** Plan reviewed with the owner 2026-07-17.
  Three follow-on slices then landed on the same branch: **token footprints** (large/huge/
  gargantuan tokens size to `Actor.sizeCells` and snap even/odd footprints on the correct
  cell/intersection — server owns the geometry, client preview mirrors it); **condition
  badges + viewer health/conditions** (bloodied/down dot and condition-initial badges on map
  tokens, plus coarse health band + condition labels in the viewer initiative/tokens — bands
  only, exact HP never leaves for the public screen); **PC sheet import** (GM imports a
  canonical `ActorDefinition` JSON as a claimable player-character; the stat block is stored
  in `GameState.definitions` and projected only to the owning player, `actor:import-definition`).
- **Cycle 4 remaining PRs** (see `NEXT-STEPS.md`):
  - **PR D** — configurable dock position + Initiative declutter **merged as PR #32**;
    gridless saveable/toggleable grid overlay (D-3) still open.
  - **PR E** — multi-scene staging (prepare maps privately, switch the live scene
    non-destructively). Large data-model refactor across domain/server/projections/viewer.
  - **PR F** — **done on `claude/open-api-core-m75t9d`** (see "Public integration API v1" above).
    Remaining non-core follow-ups: scenes/claims/token-cosmetics over the API, SSE event stream,
    webhooks.

## Recently merged (Cycle 4)

`#28` batch A (labels, cone/line snap, Delete key, tray-drop, grid-wizard zoom/redo,
viewer reset/pop-out, "VTT Setup" rename) · `#29` batch B (free-direction cone/line, live
token grid-snap) · `#30` PR C (per-drawing colors, GM/player layer toggle, encounter pings
with sender name).

## Verification bar (project convention)

Every change ships `npm run check` + `npm test` + `npm run build` green, and UI changes get
a **live Playwright smoke** (seed a map + calibration + encounter via the API, then drive
the map inside the full-viewport "Enlarge map" overlay). See `docs/ai-context/testing.md`.

## Claude Code tooling

This repo now carries a Claude Code tooling layer (this upgrade): `CLAUDE.md` index,
`docs/ai-context/` subsystem briefs, this ledger, `.claude/loop.md`, the full
`.claude/skills/` roster (`vtt-task-packet`, `vtt-context-router`, `vtt-implement`,
`vtt-qa-check`, `vtt-ledger-update`, `vtt-ux-review`, `vtt-test-pass`, `vtt-branch-safety`,
`vtt-schedule`), and three lifecycle hooks in `.claude/settings.json` (`danger-guard`
PreToolUse, `scope-guard` UserPromptSubmit, `stop-reminder` Stop — see
`.claude/hooks/README.md`). Three optional read-only reviewer subagents live in `.claude/agents/` (`ux-reviewer`,
`test-reviewer`, `architecture-reviewer`) for large/cross-cutting changes. A GitHub Actions
schedule scaffold (`.github/workflows/scheduled-ledger-drift.yml`) is present but **inert** —
its cron is commented out and the job is a placeholder until configured. Design/roadmap in
`docs/claude-code-tooling-outline.md`.
