# Current state

**Read this at session start.** What ships today, what is in flight, what is known broken —
and nothing else. It is a snapshot: **edit it in place** when something real changes, and
only then. Most sessions change nothing here.

- Not a changelog. If you want to write a dated entry, it belongs in `docs/archive/`.
- Not a bug tracker. Individual defects live in `known-bugs.md`; this page names only the
  gaps that change how you'd plan work.
- Not an inventory. `docs/app-map.md` (generated) has the state shape, command catalog and
  HTTP surface; `docs/api-reference.md` (generated) has the API. Both are freshness-tested.

## Ships today

**Combat table.** Battlemap upload with 3×3 grid-drag calibration and gridless/regional
scale (`apps/server/src/grid-calibration.ts`, `grid-calibration-wizard.ts`);
server-authoritative token sizing, snapping and movement (`token-placement.ts`); initiative,
turns and rounds (`encounter.ts`); drawings, measurements and pings (`annotations.ts`);
GM-painted manual fog (`fog.ts`, ADR-0022); staged scenes that park and resume an encounter
(`scenes.ts`).

**5e rules engine** (ADR-0020, server-owned). Action resolution, typed damage, persistent
effects and conditions, saving throws, reactions and opportunity attacks, concentration,
spell slots and pact slots, hit dice, short/long rests, legendary actions, death saves —
`apps/server/src/` `action-resolution.ts` · `effects.ts` · `condition-rules.ts` ·
`saving-throws.ts` · `reactions.ts` · `spellcasting.ts` · `rests.ts` · `death-saves.ts` ·
`turn-economy.ts`.

**Character sheet and guided builder.** An interactive play sheet
(`apps/client/src/encounter/CharacterSheet.tsx`, ADR-0021) plus a full-page guided builder
with a server-side assembler (`apps/client/src/builder/`, `apps/server/src/character-build.ts`).
The builder is GM-gated today (`apps/client/src/main.tsx`); the table's allowed ability
methods are a GM policy on `GameState.builderPolicy`.

**Content.** SRD 5.2.1 canonical bundles (`packages/content-srd-5.2.1`, ADR-0015); GM
homebrew authoring with its own store, router and change ping
(`apps/server/src/homebrew-store.ts`, `homebrew-http.ts`, client route `/homebrew`); D&D
Beyond PDF sheet ingestion (`packages/dndbeyond-pdf`, `apps/client/src/pdfImport/`,
ADR-0018) including player-submitted imports and a GM approval queue
(`GameState.pendingImports`).

**Table viewer / second screen.** Pairing codes exchanged for a hashed cookie session, an
SSE presentation feed, and a player-safe projection that never carries `GameState`
(`apps/server/src/viewer-http.ts`, `viewer-presentation.ts`, `apps/client/viewer.html`).
See `docs/ai-context/viewer-mode.md`.

**Worldbuilding Codex.** Typed pages and folders, atlas maps and markers, journal and
timeline, sessions with prep and recap, quests, a fantasy calendar with deadlines and
downtime, party standing, a reveal audit, one connection model with a relationship graph,
search, page revisions, and export/import backup. Every player-facing read goes through
`apps/server/src/codex-projections.ts`. See `docs/ai-context/codex.md`.

**Public integration API v1** (ADR-0016, Accepted). Versioned envelopes over the same
handlers as the UI, GM-minted scoped credentials, and an OpenAPI document served at
`/api/v1/openapi.json` (`packages/api-contract`).

**Realtime and persistence.** One command pipeline: zod-validate → authorize per command
from the signed token → commit receipt + event + projection in one SQLite transaction →
broadcast a per-role projection. Idempotent by `commandId`, revision-checked, with presence
and reconnect grace. Embedded SQLite plus a separate integration-credentials database and
on-disk asset roots (`apps/server/src/index.ts`, `server.ts`).

**Claude tooling.** Skills, subagents, path-scoped rules and hooks under `.claude/` —
roster in `.claude/README.md`.

## In flight

- **This branch (`claude/ozyvtt-docs-sync-zvzdah`)** is a documentation and instruction-layer
  repair: the docs had drifted behind the code and the ledger had become a changelog.
- **Server-held character drafts (builder Phase 3).** The wizard parks drafts in
  `localStorage` behind `loadDraft`/`saveDraft`/`clearDraft`; the swap to a server-held store
  is designed and deliberately not built (`apps/client/src/builder/draft.ts`).
- **Rules engine follow-ups.** Difficult terrain and a server-authoritative movement preview
  are unimplemented (no `difficultTerrain` or `movement.preview` symbol exists), and the
  reaction trigger vocabulary is still `["hit-by-attack", "leaves-reach"]`
  (`packages/domain/src/index.ts`), so damage-taken and AC-response reactions are out.

No phase exit gate has been claimed. `BUILD_PLAN.md` carries the roadmap.

## Known broken

Individual defects are in `known-bugs.md` — every entry there is broken at HEAD or it is
deleted. The four structural gaps worth knowing before you plan:

- **`apps/server/test/` is not typechecked.** `apps/server/tsconfig.json` has
  `"include": ["src"]`, so `npm run check` never sees the server test suite. Same shape in
  the client: `apps/client/tsconfig.app.json` includes only `src`, so
  `apps/client/test/setup.ts` (loaded by `apps/client/vitest.config.ts`) is unchecked.
- **`packages/ui` has no tests.** Its `package.json` declares `check` only, and there is no
  test file in it. `npm run test` skips it silently via `--if-present`, so a green run says
  nothing about the shared primitives.
- **No browser baseline and no physical-device pass.** No `browserslist`, no Vite
  `build.target`, no degraded-browser fallback, and no iOS/Android acceptance run
  (BUILD_PLAN GAP-001). Don't claim device coverage you haven't run.
- **PixiJS is a dependency nothing renders.** `apps/client/src/scene/RendererProof.tsx` is
  its only importer and has zero import sites; the shipping map surface is SVG/DOM. Any doc
  that points gesture or high-DPI work at that file is pointing at dead code.

## How to change this page

Edit the line that is wrong. Delete the line that is no longer true. If a claim here and the
code disagree, the code wins and the line is a defect — fix it in the same change. Do not
append. If you want the history, it is in git and in
`docs/archive/ai-ledger/current-state-history-2026-08-01.md`.
