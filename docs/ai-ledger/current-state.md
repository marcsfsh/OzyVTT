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
- **Cycle 4 remaining PRs** (see `NEXT-STEPS.md`):
  - **PR D** — configurable dock position, Encounter/Initiative declutter, gridless
    saveable/toggleable grid overlay.
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
`.claude/hooks/README.md`). A GitHub Actions schedule scaffold
(`.github/workflows/scheduled-ledger-drift.yml`) is present but **inert** — its cron is
commented out and the job is a placeholder until configured. Design/roadmap in
`docs/claude-code-tooling-outline.md`.
