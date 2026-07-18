# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-18 — Public Open API v1 core (PR F) + Time Machine v2 (`claude/open-api-core-m75t9d`)

Owner-directed: RESTful API foundation with core endpoints working, maximum integration openness;
webhooks explicitly deferred; archive should save as much fight data as possible in the current format.

- **Operations extraction.** All core combat capabilities moved out of the Socket.IO handlers into
  `game-operations.ts` (shared zod schemas in `game-commands.ts`); sockets + new `game-http.ts` REST
  routes are now thin adapters over identical functions — "same path, never a fork" is structural.
  Socket behavior/messages preserved exactly (whole suite passes unchanged).
- **API surface.** `GET /game` (GM-full / `?view=player`, weak-ETag polling), `GET /game/log`, ~30
  typed command routes, generic `POST /game/commands` tunnel + discoverable catalog, `/content/*`
  reads, `/encounters` archives under integration scopes. Principals: GM session, player session
  (player-limited), scoped integration credentials (GM authority). 409-conflict error contract with
  `currentRevision` + `needsConfirm`; idempotent `commandId` writes; CORS open on `/api`.
- **Time Machine v2.** Migration v5 journal table: every command while a fight is live journaled
  in-transaction with payload + principal; archive v2 adds `journal`, `finalState`, complete `rolls`,
  `definitions` (+`attribution`), strictly additive.
- **Contract.** OpenAPI 3.1 documents the entire surface (61 paths), served byte-identical;
  capabilities advertise `gameApi`/`commandTunnel`/`encounterArchives`; contract tests pin scopes.
- **Architecture review (subagent) — no blockers; fixes landed:** CORS wildcard scoped down to
  `/api/v1` only (wildcard on `/api/gm/login` would have let any web page relay password guesses
  through a LAN browser — negative tests added); per-command scopes single-sourced as
  `GAME_COMMAND_SCOPES` in `@vtt/api-contract` (registry + typed routes + doc all derive/pinned by
  test); `playerAuth` security scheme documented on exactly the player-usable operations;
  idempotency contract stated in the API description; per-verification credential audit writes
  throttled to one "used" row / 60s (polling would otherwise bloat the audit table). Dead credential
  `gameId` plumbing recorded in known-bugs (pre-existing).
- **API reference:** `docs/api-reference.md` is GENERATED from the contract
  (`packages/api-contract/src/reference.ts`, `npm run docs:generate -w @vtt/api-contract`); a
  freshness test fails whenever the contract changes without regenerating, so the reference cannot
  drift. Linked from README.
- **Verified:** `check`/`test` (284 total: 243 server incl. 8-test HTTP integration suite + journal
  unit tests + CORS/scope-drift tests, 16 contract incl. reference freshness)/`build` green; live
  smoke against the running service passed 17/17 external-integration steps (credential → discovery
  → map upload → snapshot views → REST encounter → ETag 304 → tunnel → idempotent retry → archive v2
  journal → revocation cutoff).
- **Follow-up slice landed the same session — full coverage:** claims (player-principal-only, GM
  force-release), token image/size cosmetics, and staged scenes (create/rename/remove/activate/
  combatants, `scene:write` scope) moved into the operations layer with typed routes + tunnel
  entries; `POST /api/v1/sessions/player` mirrors the socket's open join so pure-HTTP player
  clients exist. Every game command now has both adapters; the socket-only list is empty. 10 new
  commands in the catalog (40 total), contract + generated reference updated, 2 new end-to-end
  test blocks (claim lifecycle over HTTP incl. contested claim + force-release; scene staging incl.
  active-scene-removal rejection). 286 tests green across all workspaces.
- **Remaining follow-ups:** SSE stream, webhooks, rate limiting, credential `gameId` plumbing
  (known-bugs).

## 2026-07-18 — Encounter Replay + movement tracking + bonus-action toasts (same branch)

Owner asks: a GM-only "encounter replay" study tool; bonus actions missing from toasts; movement
absent from the Time Machine (wanted distance moved + old/new range to each creature).

- **Movement narration** (`movement-narration.ts` + `tokenMove` op): every live move logs a
  `movement` combat-log line — "Borin moved 20 ft — Mirena 5 ft → 15 ft." — measured like the
  ruler (Chebyshev × distancePerCell; gridless uses the saved scale; neither → numberless).
  Entering/leaving the map narrate too. Hidden combatants' ranges split into a GM-only line;
  a hidden mover is entirely GM-only. Lands in live log + archives. New log kind `movement`.
- **Toast fix:** `turn.use` with `used=true` now broadcasts "X used an action / a bonus action."
  (mirrors reactions; unmarking stays silent; hidden actor → GM-only). Verified over a live socket.
- **Encounter Replay:** new GM "Replays" tab; step/scrub/auto-play through an archive's turns —
  map + tokens per boundary (hidden dashed + HIDDEN tag), initiative with HP/conditions, per-turn
  log slice with GM-only tags; v2 archives add an Aftermath step. GM-gated endpoints only.
- **Verified:** check/test/build green (293 tests: +5 narration unit, +1 movement-log HTTP
  integration, +1 socket toast); live Playwright smoke drove the real built client end-to-end
  (seed fight via API → Replays tab → watch → step → mobile viewport), 0 console errors,
  screenshots captured. TokenMapGeometry gained optional `scale` so gridless distances work.

---

## 2026-07-17 — UX bug sweep, batch 2 (owner retest)

Second round from the owner's retest, same branch:

- **Ping expiry — real root cause.** Batch 1's re-arm was necessary but insufficient: `projectGmView`
  spread state verbatim and **never filtered expired annotations**, so a ping only vanished from the
  GM's own screen on the next add, not on the scheduled expiry re-broadcast (only the player/viewer
  projections filtered). `projectGmView` now takes `now` and filters expired annotations like the
  others. Regression test added.
- **#12 regression fix.** The batch-1 "dice fills the sidebar" change let the roll history grow
  unbounded and `align-items: stretch` stretched the whole row → huge dead space under the map.
  Reverted the fill; desktop grid is now `align-items: start` so a short column no longer forces
  dead space.
- **Markdown in reference text.** SRD descriptions carry `**bold**`, newlines, and `- ` bullets that
  showed raw in the CharacterSheet traits/actions and the tap-to-read reference rows. New inline-safe
  `RichText` (bold/br/bullets only) renders them.
- **Actions on the creature's row.** The current combatant's economy + `ActionRunner` moved from a
  detached block at the panel bottom to inline under that combatant's initiative row; dropped the
  redundant economy-strip name (which was being truncated by the Action/Bonus/Reaction buttons).
- **Above-map clutter.** "Preview what players see" moved below the map.

Verified: check / test (224, +2 GM-expiry regression) / build green. Browser pass is the owner's.

## 2026-07-17 — UX bug sweep (owner test pass, batch 1 of the UX/UI PR)

Six fixes from the owner's testing pass, on `claude/srd-content-pipeline` (kept on the same
branch per the owner):

- **#3 wheel scroll** — the map's `wheel` listener zoomed even when the pointer was over a
  docked panel; added the same `.closest()` guard the pointer-down handler already uses
  (`.encounter-map-dock/-overlay/-menu/-shape-editor`), so a docked initiative tracker scrolls
  on wheel instead of zooming the map.
- **#9 ping expiry** — `scheduleAnnotationExpiry` (and the viewer's `schedulePingExpiry`) armed
  only the *soonest* expiry and never re-armed, so a second staggered ping lingered until
  unrelated activity re-broadcast. Now it keeps one timer, clears stale ones, and re-arms from
  the callback → every ping/measurement drops at its own expiry.
- **#19 statblock z-index** — a docked panel's `.encounter-map-dock` (z-index 2) is a stacking
  context that trapped the sheet's fixed `.confirm-overlay` (z-50) beneath the map controls
  (z 3–6); `CharacterSheet` now `createPortal`s to `<body>` so it covers everything.
- **#10 turn nav** — Previous/Next moved above the initiative order (reachable without
  scrolling past the list).
- **#6 reference actions** — dashed reference-only action rows (no structured attack/save/
  damage) were dead on click; they're now buttons that expand the SRD reference text (touch-
  friendly, no hover-only tooltip) — reference level per ADR-0008.
- **#12 dice column** — on desktop the dice section now fills the sidebar beneath the panel and
  bottom-aligns with the map column (roll history grows instead of a fixed 19rem). *Needs an
  eyeball for exact top-of-map alignment.*

Verified: check / test (222) / build green. Browser pass is the owner's (their test loop).

**Queued (same 20-item list, later batches):** B — tracker docking (dock from enlarged map;
left/right-only + drag-resize). C — combat interaction (clickable targeting, AOE auto-apply,
right-click token menu, per-target saving-throw prompts, event toasts, off-turn reactions,
occupied-cell move cost). D — scenes/GM prep (#7). E — assets (token upload #13, map
save/organize #14). Parked: #17 (manual economy already ships), #11 (reference repos to
evaluate). Full triage in the session scratchpad backlog.

## 2026-07-17 — Post-A–G polish: token footprints, condition/health badges, PC sheet import

Three deferred slices, on `claude/srd-content-pipeline` atop phases A–G:

- **Token footprints.** `Actor.sizeCells` (1–4, derived from the definition's token
  footprint) drives multi-cell tokens: large 2×2, huge 3×3, gargantuan 4×4. The server owns
  the geometry — `encounterTokenAppearance`/`snappedPosition` size the token to the footprint
  and snap odd footprints centered on a cell (offset 0.5) vs even footprints on a grid
  intersection (offset 0); the client drag preview mirrors the same offset so placement is
  WYSIWYG. `EncounterTokenSchema` and start-encounter/roster wiring carry `sizeCells`.
- **Condition + health badges.** Map tokens gain a bloodied/down status dot and up to three
  condition-initial badges (+N overflow); the same coarse health band + condition labels now
  show in the **viewer** initiative and on viewer tokens. Viewer safety held: only bands and
  condition labels are projected — exact HP never reaches the public screen, and hidden
  actors are excluded (test-asserted no-leak).
- **PC sheet import.** GM imports a canonical `ActorDefinition` JSON from the roster
  (`actor:import-definition`, GM-only, 256 KB cap, schema-validated) as a claimable
  player-character. The stat block is stored in `GameState.definitions` and projected **only
  to the owning player**; `CharacterSheet` prefers the owned definition over a fetch so a
  player sees their full imported sheet while strangers see nothing. `removeActor` refuses a
  claimed PC and garbage-collects an orphaned imported definition.

Verified: check / test (222: +2 footprint, +3 import, viewer-safety + no-leak assertions
updated) / build all green. Browser pass deferred to the owner's manual test (their stated
plan) — the server-boot smoke was declined this session; viewer-safety and projection
invariants are covered by the automated suite.

**Follow-up:** owner tests these three, then merges `claude/srd-content-pipeline`. Next PR is
API + UX/UI (public API parity per PR F, plus UX polish).

## 2026-07-17 — Phase G: character sheet (track, never build) — plan complete

`CharacterSheet` overlay: live actor state (HP with in-sheet Dmg/Heal/Temp[/Set], the
shared ConditionEditor) over the immutable stat block — six abilities with modifiers and
save bonuses, AC + armor detail, speeds, senses/passive Perception, languages,
vulnerabilities/resistances/immunities, proficiency, traits and actions as full rules text,
CC-BY attribution line. Data via GM-gated `content:monster-sheet` (full ActorDefinition;
inert content). GM opens any combatant by tapping its initiative name; a player opens only
their own sheet from the you-are-playing card — a player token calling the stat-block fetch
directly is rejected (smoke-probed live). PC sheets show live data + a "no imported sheet
yet" note until character import (ADR-018 path) lands. Sheet typeline verified against 2024
rules quirks (goblins are Small fey, CR shown as 1/4).

Verified: check/test (216)/build green; live Playwright — goblin sheet renders all
sections, in-sheet heal 5 → 8/10 then damage 2 → 6/10 with the initiative chip tracking,
PC sheet note shown, player own-sheet works, player stat-block probe rejected ("Only the
GM can read stat blocks."); zero page errors.

**This completes phases A–G of the SRD combat-content integration** — offline bundle →
instantiate → HP → conditions → economy/End Turn → action resolution → sheets. Known
deferred items: token footprints/condition badges on tokens, viewer HP/condition display,
PC imports (ADR-018), API parity (PR F), movement enforcement.

## 2026-07-17 — Phase F: targeting + stat-block action resolution

The convergence phase: content + dice + HP + economy meet. Server
(`action-resolution.ts`, `action:resolve`, GM-only): resolves a definition action — d20 +
bonus vs the target's AC (nat 20 = crit with dice-only doubling via parsed-term transform,
nat 1 = fumble, AC-less targets report "unknown" but still propose damage), save actions
surface DC+ability across up to 20 targets with one damage roll, typed damage parts rolled
with the authoritative grammar. Every roll lands in the shared history attributed to the
attacker (visibility gm-only when the attacker is hidden). Economy auto-marks
(action/bonus on own turn, reactions any time). Damage is PROPOSED, never auto-applied —
application is an explicit `actor:apply-damage` tap (BUILD_PLAN Propose→Apply ladder), so
temp-HP absorption etc. ride the existing pipeline. `content:monster-actions` read feeds
the client. Client: `ActionRunner` under the GM economy strip — stat-block action list
(structured summary chips; unstructured actions shown as reference rows), radio/checkbox
target picker with ACs, result card (outcome, damage breakdown, Apply / per-target
Full-Half-None for saves).

Verified: check/test (216: +6 resolution tests — hit/miss/crit/fumble/unknown-AC, save
multi-target, hidden-attacker visibility, economy marking, validation)/build green; live
Playwright — the (GM-only) Goblin Boss's Scimitar hit Borin 19 vs AC 18, damage 3 applied
through temp HP first (24/28+8 → 24/28+5), rolls in history as "Goblin Boss · Just me
(GM)"; zero page errors.

**Follow-up:** Phase G (character-sheet panel). PCs still lack definitions, so the runner
is monster-only until sheet import lands (later phases per ADR-0018).

## 2026-07-17 — Phase E: turn economy + player End Turn

Action economy becomes tracked state (never enforced — ADR-0008). `CombatState` gains
`turn: {actionUsed, bonusActionUsed}` (current turn's actor, reset on any turn change) and
`reactionsUsed: actorId[]` (reactions are off-turn resources; an actor's id clears when
their own turn starts — 5e refresh timing, wired into next/previous/start/end reducers).
Server: `turn-economy.ts` — `setTurnSlot` (player only on their character's turn),
`setReactionUsed` (player only their own character, any time), `endTurn` (player End Turn =
the GM's Next gated to their own turn). Projection: a hidden combatant's turn stays opaque
(economy flags read idle; reactionsUsed filtered to public actors — test-asserted with a
no-leak JSON check). Client: GM Turn order gains an economy strip for the current actor
(Action/Bonus/Reaction, pressed = spent, strikethrough); players get their own strip —
Action/Bonus + End turn on their turn, Reaction always.

Verified: check/test (210: +4 turn-economy tests)/build green; live Playwright — GM toggles
action, Next resets it; player claims a PC, spends reaction OFF-turn, sees it refresh when
their turn starts, spends action, hits End turn and the GM's strip advances to the next
combatant; zero page errors. (Smoke infra: stale claims from prior runs now force-released
first.)

**Follow-up:** Phase F (targeting + action resolution through the dice engine) — the
convergence phase. Movement tracking/enforcement stays deferred per BUILD_PLAN.

## 2026-07-17 — Phase D: condition tracking (reference level)

Conditions become trackable state. `Actor.conditions` (additive: `{id, level?}` entries,
level = exhaustion 1-6). Server: `actor-conditions.ts` `setCondition` reducer (sorted,
idempotent, level rules) reusing the hp `ActorScope` (renamed from HpScope — GM anyone,
player own character); handler validates the id against the bundled 15 via ContentLibrary;
`content:conditions` read (any joined session — reference text is public). Per ADR-0008
this is reference level: displayed with SRD text, never auto-applied to rolls. Client:
shared `conditions.tsx` — `ConditionChips` (tooltips carry rules text) + `ConditionEditor`
(chips + 15-condition picker, exhaustion level stepper), used in GM initiative rows, player
initiative (client-side join from actors), roster cards, and the you-are-playing card
(player self-marking). The smoke exposed a cache-poisoning bug (a transient failed fetch
bricked condition names for the session) — replaced with a never-cache-failure pub-sub that
retries on picker open.

Verified: check/test (206: +3 condition tests — set/clear/sort/idempotence, exhaustion
levels + level rejection on others, player scoping + public projection)/build green; live
Playwright — GM sets/unsets conditions from the row picker, steps Exhaustion to 3 on a PC;
player sees the chips and self-marks Poisoned; tooltips loaded; narrow-viewport picker; zero
page errors.

**Follow-up:** Phase E (action economy + End Turn). Token condition badges + viewer
condition display deferred to a polish pass.

## 2026-07-17 — Phase C: hit-point tracking with band-safe projections

Server: `hit-points.ts` reducers — `applyDamage` (temp HP absorbs first, floor 0),
`healActor` (cap at max, never restores temp), `setTemporaryHp` (replace, not stack),
`setCurrentHp` (GM-only correction, clamped) — all scoped: GM adjusts anyone, a player only
their own claimed character. Four socket commands (`actor:apply-damage`/`heal`/
`set-temp-hp`/`set-hp`). **Projection change (viewer-safety relevant):** players now
receive exact hp only for player-characters; monsters/NPCs project as a `HealthBand`
("healthy" / "bloodied" ≤ half per 2024 rules / "down") — previously exact monster hp
reached players. `PlayerInitiativeEntry` gains `health`; the viewer picks fields explicitly
and a test asserts no health/hp key leaks there. Client: GM initiative rows get exact HP
chips (green/amber/red) expanding an inline Dmg/Heal/Temp/Set editor, down rows strike
through; player initiative shows Bloodied/Down chips; the you-are-playing card gains an
own-HP tracker (Damage/Heal/Temp).

Verified: check/test (203: +7 hit-point tests incl. band thresholds, ownership rejections,
viewer no-leak; 2 existing projection tests updated for the `health` field)/build green;
live Playwright — GM damages goblin 10/10→4/10 (bloodied) → temp 5 → heal 3 (7/10 +5) →
50 dmg → 0/10 struck-through Down; player claims PC, self-damages 28→24, sets temp +8;
player view shows only the band chip for the goblin with no exact "/10" anywhere in the
DOM; narrow-viewport HP editor pass; zero page errors.

**Follow-up:** Phase D (conditions). Dice→damage wiring is Phase F.

## 2026-07-17 — Phase B: SRD monsters instantiate into encounters

First consumer of the content bundle. Server: `ContentLibrary` (loads the monster bundle +
attribution once), reducers in `actor-roster.ts` (`addActorFromDefinition` — live HP=max,
AC, initiative bonus, name dedup "Goblin Warrior 2", `definitionId` provenance;
`removeActor` — refuses player-characters and active combatants, cleans stale inactive
initiative/token refs), three socket commands (`content:monsters` read, GM-gated;
`actor:add-from-definition` — commandId doubles as actorId for duplicate-safe acks, like
annotations; `actor:remove`). `Actor` schema gains optional `definitionId` (additive).
Client: `MonsterBrowser` overlay (search 330 monsters, CR/type/AC/HP rows, GM-only toggle,
CC-BY attribution footer) opened from encounter setup; per-row ✕ remove for non-PCs;
newly added actors auto-check into the combatant selection (found via live smoke — they
previously arrived unchecked and got left out of the fight).

Verified: check/test (196: +5 actor-roster incl. gm-only projection safety)/build green;
live Playwright end-to-end — browse→search→add×2 (dedup)→add hidden→remove→start
encounter→goblins in initiative; player context sees the public goblin, never the GM-only
boss; narrow-viewport pass; zero page errors.

**Follow-up:** Phase C (HP/damage/heal commands + sheet surface). Token footprints still
1×1 (definition retains the data). Content reads ride sockets; PR F owns API parity.

## 2026-07-17 — SRD 5.2.1 content pipeline (integration phase A, audited)

Reviewed 7 candidate content/tool repos with the owner; decision (ADR-0015): source SRD
content from **open5e `srd-2024` (CC BY 4.0)** — the only complete *structured* 2024
bestiary; 2014/OGL and third-party data excluded. Built the pipeline in
`packages/content-srd-5.2.1`: vendored fixtures, deterministic ETL/adapter (fail-closed
validation of every bundle), committed bundles, server-side loaders, 11 tests incl.
dice-grammar validation of every formula. `check`/`test` (189)/`build` green. Also merged
PR #32 (dock + declutter) after live verification.

Two audit passes then **cross-validated every statblock against an independent CC-BY copy
of the SRD text** — round 1: names/size/AC/HP/CR; round 2: all six ability scores, saving
throws, initiative, attack bonuses (both directions), all 339 spell headers, all 38 weapon
damage rows. Final result: **zero mismatches on every checked dimension**. Curation that
came out (documented in the package README + ETL tables): excluded `giant-fly` (no SRD
statblock), restored 25 Tiny sizes open5e flattens to small, fixed octopus CON/CHA +
mastiff/swarm-of-rats/octopus save values, restored greater-invisibility's empty
description, and added a **deterministic prose-attack parser** recovering 33 structured
attacks (mostly animals) that have no upstream attack rows. Bundles also carry **spells
(339, structured save/damage/upcast), weapons (38) + property/mastery texts (17), armor
(13, AC-derivation fields), skills (18), damage types (13), rules glossary (56)**.
Deliberately not bundled: classes/species/feats/backgrounds/magic items (char-builder/loot
scope). Attribution wording verified against the SRD's own Legal Information page. Runtime
proofs: package imports cleanly from the server source tree; live Playwright GM smoke green
with zero page errors; `npm ls` consistent; ETL hash-deterministic.

**Follow-up:** phase B — GM browses bundle + `actor:add-from-definition` command
instantiates monsters into encounters (then C HP/damage → D conditions → E action economy →
F targeting/resolution → G sheet panel).

## 2026-07-17 — Hooks + scheduled-workflow scaffold

Completed the remaining active outline items on the same branch:

- **Lifecycle hooks** (`.claude/settings.json` + `.claude/hooks/`, Node, fail-open):
  `danger-guard` (PreToolUse/Bash — deny catastrophic, ask on destructive),
  `scope-guard` (UserPromptSubmit — inject sensitive-area invariants as context),
  `stop-reminder` (Stop — non-blocking completion-hygiene nudge when code is
  uncommitted). Tested each with sample payloads. `.claude/hooks/README.md` documents
  them; `.gitignore` now ignores `.claude/settings.local.json`.
- **GitHub Actions schedule scaffold** (`.github/workflows/scheduled-ledger-drift.yml`):
  intentionally inert — cron commented out, `workflow_dispatch` only, placeholder job —
  the "bones" to configure later.

- **Optional reviewer subagents** (`.claude/agents/`): `ux-reviewer`, `test-reviewer`,
  `architecture-reviewer` — read-only, separate-context reviewers for large/cross-cutting
  changes, complementing the inline `vtt-ux-review` / `vtt-test-pass` skills. The outline
  marks these optional/sparing; delete them if you prefer inline-only review.

Opened PR #33 to `main`. This completes every item in the tooling outline except
configuring the (intentionally inert) scheduled workflow. Still no application code touched.

## 2026-07-17 — Claude Code tooling upgrade (foundation + scheduled slice)

Stood up the Claude Code tooling layer described in `docs/claude-code-tooling-outline.md`
(a small skill system, not a meta-agent). This session shipped the **foundation + scheduled
slice**:

- `CLAUDE.md` constitutional index (identity, commands, hard rules, context map).
- `docs/ai-context/` — 9 subsystem briefs seeded from a real code survey: product-vision,
  ux-principles, architecture, map-grid, viewer-mode, mobile-ux, realtime, auth-roles,
  testing.
- `docs/ai-ledger/` — current-state, decision-log, known-bugs, this file.
- `.claude/loop.md` — committed default `/loop` operator cadence.
- `.claude/skills/` — the full 9-skill roster: `vtt-task-packet`, `vtt-context-router`,
  `vtt-implement`, `vtt-qa-check`, `vtt-ledger-update`, `vtt-ux-review`, `vtt-test-pass`,
  `vtt-branch-safety`, `vtt-schedule` (the new scheduled-prompts/workflows item). This
  makes the packet → implement → QA → ledger workflow fully live.
- Added the **Scheduled prompts & workflows** section to the outline (key finding:
  session `/loop`/cron are runtime-only; `.claude/loop.md` + GitHub Actions `schedule:` are
  the code-committable pieces).

No application code touched — this is a tooling-only change on
`claude/code-improvements-outline-eqvh9n`.

**Follow-up:** hooks and the GitHub Actions scaffold were completed later the same day
(see the entry above).

## Before 2026-07-17 (context)

Cycle 4 merged to `main`: `#28` (batch A), `#29` (batch B), `#30` (PR C — per-drawing
colors, GM/player layer toggle, encounter pings). Cycle 4 PRs D/E/F planned in
`NEXT-STEPS.md`.
