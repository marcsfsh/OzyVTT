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

## Active work

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
- **Cycle 4 remaining PRs** (see `NEXT-STEPS.md`):
  - **PR D** — configurable dock position + Initiative declutter **merged as PR #32**;
    gridless saveable/toggleable grid overlay (D-3) still open.
  - **PR E** — multi-scene staging (prepare maps privately, switch the live scene
    non-destructively). Large data-model refactor across domain/server/projections/viewer.
  - **PR F** — complete the public Open API so Socket.IO capabilities (`encounter:*`,
    `initiative:*`, `token:move`, `annotation:*`, `dice:*`) are reachable + documented via
    `/api/v1`, reusing the same command/authorization/projection path (never a fork).

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
