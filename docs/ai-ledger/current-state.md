# Current state

**Read this at session start.** What ships today, what is in flight, what is known broken — and
nothing else. It is a snapshot: **edit it in place** when something real changes, and only then.

- Not a changelog. A dated entry belongs in `docs/archive/`.
- Not a bug tracker. Individual defects live in `known-bugs.md`; this page names only the gaps that
  change how you'd plan work.
- Not an inventory. `docs/app-map.md` (generated) has the state shape, command catalog and HTTP
  surface; `docs/api-reference.md` (generated) has the API. Both are freshness-tested.

## Ships today

**Combat table.** Battle-map upload with 3×3 grid-drag calibration and gridless/regional scale
(`apps/server/src/grid-calibration.ts`); server-authoritative token sizing, snapping and movement
(`token-placement.ts`); initiative, turns and rounds (`encounter.ts`); drawings, measurements and pings
(`annotations.ts`); GM-painted manual fog (`fog.ts`, ADR-0022); staged scenes that park and resume a
fight (`scenes.ts`). Every map tool reaches the GM through **one collapsible toolbar**
(`apps/client/src/scene/MapToolbar.tsx`), collapsing to one `Tools` button at ≤560px.

**5e rules engine** (ADR-0020, server-owned). Action resolution, typed damage, persistent effects and
conditions, saves, reactions and opportunity attacks, concentration, spell and pact slots, hit dice,
rests, legendary actions, death saves (`apps/server/src/action-resolution.ts` and its neighbours). How
strictly it polices is a **standing table policy** (`GameState.rulesPolicy`, set in Settings → The
table) each fight inherits at `encounter.start`, plus per-family exceptions (`combat.ruleExceptions`,
`effectiveModeFor` in `rules-families.ts`) so "don't police movement" doesn't also switch off the
action economy. A GM override is one tap, remembered per family for the turn. A blocked player is no
dead end: `rules.ask` parks the exact command in `combat.pendingRuleAsks` (`rule-asks.ts`) and
`rules.answer` replays it under GM authority with the override injected — or declines it; a player sees
only their own ask, without its payload.

**One table feed** (D11). The combat-log store IS the feed (`apps/server/src/combat-log.ts`): every
roll lands there as a `kind: "roll"` row carrying the whole `RollRecord`, attributed to its character,
beside the narration it always held. `GameState.rolls` stays the 200-roll hot window and shares
`RollRecord.id` so readers dedupe; one writer (`roll-history.ts` `recordRoll`) feeds both. Delivery is
per socket, and the roller's session id is stripped for every recipient (`projectFeedRow`).

**The tap is the attack** (D10, server-side). `action.use` routes a sheet tap itself — resolved in the
fight on its own turn, refused off turn with the overridable and askable `economy.not-your-turn`, or
loose attributed dice with no fight running (`tap-routing.ts`). `save.roll` answers a matching pending
save through the tracker's own path. Both are additive; `action.resolve`, `save.answer` and `dice.roll`
are unchanged.

**Character sheet and guided builder.** An interactive play sheet (`encounter/CharacterSheet.tsx`,
ADR-0021) plus a full-page guided builder with a server-side assembler (`apps/client/src/builder/`,
`apps/server/src/character-build.ts`). `GameState.builderPolicy` holds the allowed ability methods,
custom formula, level cap (enforced on BOTH doors — the builder and the sheet's identity edit) and
`playerBuilder`, a real gate: while it is `open` a player runs `character.create` themselves
(auto-claimed, per-session cap) and `character.rebuild` levels their own character up, down or into a
respec. Builds record their rolled hit points in the choice ledger and a rebuild carries forward what
it does not re-roll, so a 5→3→5 round trip lands on the same maximum. `builder.roll-abilities` moves
the wizard's dice server-side into the feed. A player also dresses their own character:
`actor.set-token-image` and the token library's doors take a player session, curated by a GM-set
per-entry `hidden` flag — one picker for both roles (`tokens/TokenLibrary.tsx`). Archived characters
are out of play server-side — refused by claim, scene staging and fight start/add.

**Homebrew keeps its promises** (D21). Every field the item editor offers now reaches the fight
(`equipment-derivation.ts`, one test per formerly-inert field in
`apps/server/test/homebrew-inert-fields.test.ts`).

**Replays** (D25/D26). `replay.launch` parks the live table exactly as a scene switch does and makes
one recorded moment live, cloning everyone under new ids so tonight's characters are never rewritten
(`replay-launch.ts`). An archive stays hidden until the GM shares it; a player then reads a COMPUTED
replay (`replay-projection.ts`) that hides each character until the turn it was revealed and carries no
session ids, journal, raw states or stat blocks. Unshared reads 404, never 403. One component serves
both roles (`replay/ReplayPanel.tsx`): the GM list carries the per-replay reveal control (hidden by
default), *Launch from here* whose confirm says the live scene is **parked**, and a triad Delete.

**Content.** SRD 5.2.1 bundles (`packages/content-srd-5.2.1`, ADR-0015); GM homebrew authoring with its
own store, router and change ping (`homebrew-store.ts`, `homebrew-http.ts`); D&D Beyond PDF ingestion
(`packages/dndbeyond-pdf`, ADR-0018). The example party are ordinary characters.

**The shell holds no roster** (D15/D30). `/` is the centred wordmark, two Buttons, no subtext. The
party is the table's: a slim strip out of combat (`PartyStrip.tsx`), the pre-claim picker on the
player's table (`ClaimCharacter.tsx`), and create/import/approve/archive on the Roster tab.

**Settings — one tab, three groups, one page** (A7/D24, `apps/client/src/settings/SettingsPage.tsx`).
*Mine* (theme, "How you roll") reaches every role; *The table* and *Players* are GM-only and are not
rendered without a GM token, so a player's page holds one group rather than three with two hidden. The
rules dial lives here rather than in a mid-fight menu and reads **Enforce / Advise / Off** (D6 — copy
only; the wire stays `strict|assisted|freeform`), one toggle per server rule family. `builderPolicy`
gets its first client control, beside health display, staging defaults, players' hits and players'
initiative; `/setup` folded into *Access & integrations*. `SETTINGS_GROUPS` is data, pinned by
`settings-groups.test.ts`.

**Everything has an address** (D29, `apps/client/src/router.ts`): `/table` (both roles), `/settings`,
`/builder`, `/characters/<id>`, `/characters/<id>/level`, `/replays/<id>`, `/scenes/new`,
`/scenes/<id>`, `/scenes/maps`. `layerOf` reads back which layer is open, `litGmTab` keeps its owning
tab lit, and `/encounter` · `/setup` · `/scenes?view=maps` redirect rather than 404. `isGmOnlyPath`
shrank — table, settings, replays, sheets and builder are player-REACHABLE, and a data guard renders
not-found when the thing behind one is not theirs. Levelling is the same wizard aimed at a character
that exists (`builder/LevelFlow.tsx`), previewing what a level-down drops (`level-ledger.ts`).

**Coherence is enforced, not documented** (D28). One copy scanner (`apps/client/src/copy-scan.ts`)
serves both vocabulary locks — `codex/vocabulary.test.ts` and the play-wide `play-vocabulary.test.ts`,
which reads **everything under `apps/client/src` minus a pinned exclusion list** plus
`packages/ui/src/primitives`, so a new directory is born locked. A retired word ("actor", "combatant",
"Encounter" the place, the five dice phrasings) fails `npm run test` with the replacement named;
exemptions are (file, string) pairs and die when they rescue nothing; the words D28 KEEPS are asserted
present. `design-conventions.test.ts` does the same for glyphs, raw inputs, colours, feedback and
breakpoints — allowlists shrink-only, sized in `design-conventions-shape.ts`. The judgement half —
skills, subagents, path-scoped rules and hooks — is under `.claude/`, roster in `.claude/README.md`.

**Table viewer / second screen.** Pairing codes exchanged for a hashed cookie session, an SSE feed, and
a player-safe projection that never carries `GameState` (`apps/server/src/viewer-http.ts`,
`viewer-presentation.ts`). See `docs/ai-context/viewer-mode.md`.

**Worldbuilding Codex.** Typed pages and folders, atlas, journal and timeline, sessions with prep and
recap (staged `sceneIds` GM-only always), quests, calendar, downtime, party standing, reveal audit,
relationship graph, search, revisions, backup. Every player-facing read goes through
`apps/server/src/codex-projections.ts`. See `docs/ai-context/codex.md`.

**Public integration API v1** (ADR-0016). Versioned envelopes over the same handlers as the UI,
GM-minted scoped credentials, and an OpenAPI document at `/api/v1/openapi.json`
(`packages/api-contract`).

**Realtime and persistence.** One command pipeline: zod-validate → authorize per command from the
signed token → commit receipt + event + projection in one SQLite transaction → broadcast a per-role
projection. Idempotent by `commandId`, revision-checked, with presence and reconnect grace
(`apps/server/src/index.ts`, `server.ts`).

## In flight

- **This branch (`claude/ozyvtt-play-facing-unify-j0vhj3`)** unifies the play-facing half.
- **Server-held character drafts (builder Phase 3).** The wizard parks drafts in `localStorage` behind
  `loadDraft`/`saveDraft`/`clearDraft`; the swap to a server-held store is designed and deliberately
  not built (`apps/client/src/builder/draft.ts`).
- **Rules engine follow-ups.** Difficult terrain and a server-authoritative movement preview are
  unimplemented, and the reaction trigger vocabulary is still `["hit-by-attack", "leaves-reach"]`
  (`packages/domain/src/index.ts`), so damage-taken and AC-response reactions are out.

No phase exit gate has been claimed. `BUILD_PLAN.md` carries the roadmap.

## Known broken

Individual defects are in `known-bugs.md` — every entry there is broken at HEAD or it is
deleted. The structural gaps worth knowing before you plan:

- **`apps/server/test/` is not typechecked.** `apps/server/tsconfig.json` has `"include": ["src"]`, so
  `npm run check` never sees the server test suite; `apps/client/tsconfig.app.json` is the same shape.
- **No browser baseline and no physical-device pass.** No `browserslist`, no Vite `build.target`, no
  degraded-browser fallback, no iOS/Android acceptance run (BUILD_PLAN GAP-001).
- **PixiJS is a dependency nothing renders.** `apps/client/src/scene/RendererProof.tsx` is its only
  importer and has zero import sites; the map surface is SVG/DOM — that file is dead code.

## How to change this page

Edit the line that is wrong. Delete the line that is no longer true. If a claim here and the code
disagree, the code wins and the line is a defect — fix it in the same change. Do not append. History is
in git and in `docs/archive/ai-ledger/current-state-history-2026-08-01.md`.
