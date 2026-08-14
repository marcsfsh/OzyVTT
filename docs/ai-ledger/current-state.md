# Current state

**Read this at session start.** What ships today, what is in flight, what is known broken — and
nothing else. It is a snapshot: **edit it in place** when something real changes, and only then.

- Not a changelog (dated entries go to `docs/archive/`); not a bug tracker (`known-bugs.md` holds the
  defects — this page names only the gaps that change how you'd plan work); not an inventory
  (`docs/app-map.md` and `docs/api-reference.md` are generated and freshness-tested).

## Ships today

**Combat table.** Battle-map upload with 3×3 grid-drag calibration and gridless/regional scale
(`apps/server/src/grid-calibration.ts`); server-authoritative token sizing, snapping and movement
(`token-placement.ts`); initiative, turns and rounds (`encounter.ts`); drawings, measurements and pings
(`annotations.ts`); GM-painted manual fog (`fog.ts`, ADR-0022); staged scenes that park and resume a
fight (`scenes.ts`). Every map tool reaches the GM through **one collapsible toolbar**
(`apps/client/src/scene/MapToolbar.tsx`), collapsing to one `Tools` button at ≤560px. The map
**pinch-zooms**, and a second finger aborts the gesture under it committing nothing — measured per gesture kind by `scripts/pinch-zoom-audit.mjs` (emulation only; GAP-001 stands).

**5e rules engine** (ADR-0020, server-owned). Action resolution, typed damage, persistent effects and
conditions, saves, reactions and opportunity attacks, concentration, spell and pact slots, hit dice,
rests, legendary actions, death saves (`apps/server/src/action-resolution.ts` and its neighbours). How
strictly it polices is a **standing table policy** (`GameState.rulesPolicy`, set in Settings → The
table) each fight inherits at `encounter.start`, plus per-family exceptions (`combat.ruleExceptions`,
`effectiveModeFor` in `rules-families.ts`) so "don't police movement" doesn't also switch off the
action economy. A GM override is one tap, remembered per family for the turn. `rules.ask` parks the
exact command in `combat.pendingRuleAsks` (`rule-asks.ts`) and `rules.answer` replays or declines it;
a player sees only their own ask, without its payload. B1's client half (Ask row, waiting rows, GM
Allow/Deny) is driven both ways; the parked command commits (`apps/client/src/encounter/rule-ask.test.tsx`).
**Typed damage is typed everywhere** (`4a`/`4b`/D7, 2026-08-08). `applyDamageDetailed` (`hit-points.ts`) stays the one entry point and all six call sites now narrate the adjustment. Six defence sources: definition RVI, effects, items, Petrified/Underwater, flat `damage-reduction` riders (last, per total, floored at 0) and rest-time re-choices (`choice-overrides.ts` — Fiendish Resilience really works). Vulnerability has three channels, not one (`damage-vulnerability` on `EffectModifierSchema`).
Entering a number no longer discards its type: `actor.apply-damage` takes an optional `damageType` (absent/`"untyped"` = the old exact fast path) and a `damageOverride` that re-weights the rolled types to it; `save.answer` takes the same override before the success halving, and a player may amend only their own character's save. **Both overrides now have client halves** (D7/4b, 2026-08-10): `damageType` on the sheet, the token menu and the initiative row-tools popover; `damageOverride` on the action runner's Apply (`ActionRunner.tsx`) and on the save prompt's amend, which re-asks the server with `commit: false` and prints its projection — PRE-defence, so a resistant target loses less than the line says (`known-bugs.md`).

**One table feed** (D11). The combat-log store IS the feed (`apps/server/src/combat-log.ts`): every
roll lands there as a `kind: "roll"` row carrying the whole `RollRecord`, attributed to its character,
beside the narration it always held. `GameState.rolls` stays the 200-roll hot window and shares
`RollRecord.id` so readers dedupe; one writer (`roll-history.ts` `recordRoll`) feeds both. Delivery is
per socket, and the roller's session id is stripped for every recipient (`projectFeedRow`).

**The tap is the attack** (D10, server-side). `action.use` routes a sheet tap itself — resolved in the
fight on its own turn, refused off turn with the overridable and askable `economy.not-your-turn`, or
loose attributed dice with no fight running (`tap-routing.ts`). `save.roll` answers a matching pending
save through the tracker's own path. Both are purely additive — the older commands are untouched.

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

**Homebrew keeps its promises** (D21), and since 2026-08-09 the editor's vocabulary is under a guard
(`apps/client/src/homebrew/authoring-harness.ts` + `vocabulary-parity.mirror.test.ts` — every control
driven from both ends, a census of still-owed keys). Parity Waves 0–2 landed 17 units — monster
attacks publish, effects change numbers, granted spells / recharge / class-resource uses /
multi-block choices / extraPicks / replaces / spell windows are authorable — and **all twelve
classes build and level 1–20** (Extra Attack swings, capstones reach their DCs).

**Replays** (D25/D26/D3). `replay.launch` parks the live table as a scene switch does and makes one
recorded moment live, cloning everyone under new ids (`replay-launch.ts`). The clone is **kept and
hidden** (D3): scene-scoped, off every roster, unclaimable, deleted with the scene — a launch no
longer spends a scene slot forever, and both refusals name their way out. An archive stays hidden
until shared; a player then reads a COMPUTED replay (`replay-projection.ts`) — no session ids,
journal, raw states or stat blocks, that fight's map and no other. Unshared reads 404, never 403.
One component serves both roles (`replay/ReplayPanel.tsx`).

**Content.** SRD 5.2.1 bundles (`packages/content-srd-5.2.1`, ADR-0015); GM homebrew authoring with its
own store, router and change ping (`homebrew-store.ts`, `homebrew-http.ts`); D&D Beyond PDF ingestion
(`packages/dndbeyond-pdf`, ADR-0018). The example party are ordinary characters.

**The screen is the page** (D15/D30, refresh A1). `body` is locked and `<main>` is a 100dvh grid —
[connection row][tab bar][content pane] (`apps/client/src/styles.css`); every surface owns a real
frame; `/` is the title screen. **And the app wears a sky** (§9 reversal, decision log 2026-08-04):
`.pane-scene` + `.pane-sky` paint a literal scene off one `--sky-*` set, so the theme toggle changes
the *hour*. Settings, roster, scenes, replays, the builder gate and not-found stand on it; **the
table never does** (a horizon competes with the map), though its chrome takes the linework. AA is
structural: `.pane-scene > .scroll-y` reserves the bright band, so no row rests in it.

**Settings — one tab, three groups, one page** (A7/D24, `apps/client/src/settings/SettingsPage.tsx`).
*Mine* reaches every role; *The table* and *Players* are never rendered without a GM token. The rules
dial lives here and reads **Enforce / Advise / Off** (D6 — copy only; the wire stays
`strict|assisted|freeform`), one toggle per server rule family; `builderPolicy` gets its first client
control; `/setup` folded into *Access & integrations*. `SETTINGS_GROUPS` is data, pinned by
`settings-groups.test.ts`.

**Everything has an address** (D29, `apps/client/src/router.ts`): `/table` (both roles), `/settings`,
`/builder`, `/characters/<id>`, `/characters/<id>/level`, `/replays/<id>`, `/scenes/new`,
`/scenes/<id>`, `/scenes/maps`. `layerOf` reads back which layer is open, `litGmTab` keeps its owning
tab lit, and `/encounter` · `/setup` · `/scenes?view=maps` redirect rather than 404. `isGmOnlyPath`
shrank — table, settings, replays, sheets and builder are player-REACHABLE, and a data guard renders
not-found when the thing behind one is not theirs. Levelling is the same wizard aimed at a character
that exists (`builder/LevelFlow.tsx`), previewing what a level-down drops (`level-ledger.ts`).

**Coherence is enforced, not documented** (D28). One copy scanner (`apps/client/src/copy-scan.ts`)
serves both vocabulary locks (`codex/vocabulary.test.ts`, the play-wide `play-vocabulary.test.ts` —
everything under `apps/client/src` minus a pinned exclusion list, so a new directory is born locked);
a retired word fails `npm run test` with the replacement named. `design-conventions.test.ts` does the
same for glyphs, raw inputs, colours, breakpoints and undeclared scroll regions — shrink-only.

**Table viewer / second screen.** Pairing codes exchanged for a hashed cookie session, an SSE feed, and
a player-safe projection that never carries `GameState` (`apps/server/src/viewer-http.ts`,
`viewer-presentation.ts`; `docs/ai-context/viewer-mode.md`).

**Worldbuilding Codex.** Typed pages and folders, atlas, journal and timeline, sessions with prep and
recap (staged `sceneIds` GM-only always), quests, calendar, downtime, party standing, reveal audit,
relationship graph, search, revisions, backup. Every player-facing read goes through
`apps/server/src/codex-projections.ts` (`docs/ai-context/codex.md`).

**Public integration API v1** (ADR-0016). Versioned envelopes over the same handlers as the UI,
GM-minted scoped credentials, an OpenAPI document at `/api/v1/openapi.json` (`packages/api-contract`).

**Realtime and persistence.** One command pipeline: zod-validate → authorize per command from the
signed token → commit receipt + event + projection in one SQLite transaction → broadcast a per-role
projection. Idempotent by `commandId`, revision-checked, with presence and reconnect grace
(`apps/server/src/index.ts`, `server.ts`).

## In flight

- **The feature-implementations program (PR #55) — Waves 0–2 DONE, the rest planned, the branch
  splitting.** The 30 client-reported issues are closed; a 19-agent discovery pass (2026-08-10)
  re-measured the remaining 22 units (only two are "add a control" work) and found ~80
  API-authorable capabilities the editor cannot reach. **Read
  `docs/product/remaining-program-plan.md` FIRST** — it carries the twenty client rulings (decision
  log 2026-08-10); the four `plan-*-program.md` beside it carry every remaining unit with measured
  sizes, carriers and workflow scripts. Waves 0–2 merge to `main`; each next batch is its own PR.
- **"The screen is the page" refresh + round 2 — landed through wave 5, QA run.** Rulings:
  `docs/product/refresh-round-2-decisions.md` (66 — read before touching round-2 work); evidence and
  residue: `refresh-round-2-fixes.md`. The three P0s this page carried through 2026-08-08 were
  re-measured 2026-08-10 and are closed; the tap-floor audit runs 9 viewports, `/table` passes all 9.
- **Parked, designed, not built:** server-held character drafts (`apps/client/src/builder/draft.ts`);
  rules follow-ups (`packages/domain/src/index.ts`) — difficult terrain, movement preview, reactions.
- **No phase exit gate has been claimed.** `BUILD_PLAN.md` carries the roadmap.

## Known broken

Individual defects: `known-bugs.md` (every entry broken at HEAD, or deleted). The structural gaps:

- **No browser baseline and no physical-device pass.** No `browserslist`, no Vite `build.target`, no
  degraded-browser fallback, no iOS/Android acceptance run (BUILD_PLAN GAP-001).

## How to change this page

Edit the line that is wrong; delete the line that is no longer true. If a claim here and the code
disagree, the code wins and the line is a defect — fix it in the same change. Do not append. History
is in git and in `docs/archive/ai-ledger/current-state-history-2026-08-01.md`.
