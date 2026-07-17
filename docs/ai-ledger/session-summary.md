# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

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
