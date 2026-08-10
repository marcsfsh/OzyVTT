# The weapon-mastery program — plan

**Written 2026-08-10 against HEAD `6278e5a`; re-measured 2026-08-10 against HEAD `36b5a1f` on
`claude/feature-impl-program-exec-ekmevw`** (the branch it was written on merged as PR #55 and is
gone). Every count and every `file:line` below was opened and checked at that second HEAD, after
batch 0 landed §2's two prerequisites. Where this document and
[`area-2-plan.md`](area-2-plan.md)'s Wave 6 disagree, **this document is the measurement and that one is
the memory** — its ordering and sizing are superseded by
[`remaining-program-plan.md`](remaining-program-plan.md), and four of its Wave 6 citations are stale
(§10).

This plan is governed by [`remaining-program-plan.md`](remaining-program-plan.md). It obeys its batch
order, its serialization points, its 4-agent ceiling and its verification bar without restating them.

---

## 1. The state, measured

Eight mastery slugs exist. **Two do anything.**
`IMPLEMENTED_MASTERIES` is a two-member Set — `apps/server/src/equipment-derivation.ts:247`,
`new Set(["graze", "sap"])` — and `masteryReaches` (`:257`) is the single gate the derivation consults
at `:653`. A slug outside the Set is omitted from `masteryByActionId` entirely, so it is inert rather
than half-wired. That honesty is the one good thing about the current state and this program must not
spend it.

Authors, counted by walking `packages/content-srd-5.2.1/bundles/weapons.v1.json` (38 rows, every row
carries exactly one `mastery`):

| slug | weapons | which |
| --- | ---: | --- |
| `vex` | **8** | blowgun, dart, hand-crossbow, handaxe, pistol, rapier, shortbow, shortsword |
| `slow` | **7** | club, javelin, light-crossbow, longbow, musket, sling, whip |
| `sap` | 6 | flail, longsword, mace, morningstar, spear, war-pick — **implemented** |
| `topple` | **5** | battleaxe, lance, maul, quarterstaff, trident |
| `nick` | **4** | dagger, light-hammer, scimitar, sickle |
| `push` | **4** | greatclub, heavy-crossbow, pike, warhammer |
| `graze` | 2 | glaive, greatsword — **implemented** |
| `cleave` | **2** | greataxe, halberd |

**30 of 38 weapons carry a mastery that does nothing.** Six behaviour units close that; the seventh
(U38) opens the slug to homebrew once they have.

Baseline, re-measured at `36b5a1f`: `npx vitest run test/weapon-mastery.test.ts --root apps/server` →
**1 file, 12 tests passed** (0.95 s). `npx vitest run src/homebrew/vocabulary-parity.mirror.test.ts
--root apps/client --project node` → **1 file, 51 tests passed** (2.33 s). The counts are what a later
run is compared against; the wall times move with the box and prove nothing.

### Unit ids

The two new units carry program-local ids (`M0`, `M1`, `M2`) rather than `U39`/`U40`, so they cannot
collide with an id another program claims. `M0` is a refactor and **not a unit** — the same standing
`R1` has in [`area-2-plan.md`](area-2-plan.md).

| id | slug | authors | what is missing | size |
| --- | --- | ---: | --- | --- |
| **M0** | — | — | the dispatch seam (a refactor, not a unit) | S |
| **U34** | `topple` | 5 | reader | **S** |
| **U36** | `cleave` | 2 | reader | **L** — dedicated agent |
| **U37** | `push` | 4 | reader | **M** — dedicated agent (up from S; §7.2) |
| **U35a** | — | — | the Light-property extra attack (prerequisite; §4.6) | **L** |
| **U35b** | `nick` | 4 | content + reader | **M** (XL as one unit; split) |
| **M1** | `vex` | 8 | everything; blocked on U22 | **M** |
| **M2** | `slow` | 7 | everything; blocked on U18 | **M** |
| **U38** | `weapon.mastery` | 38 | control only | **S** — closer, gated on all eight |

---

## 2. The prerequisites this program does not own

§2.1 and §2.2 were batch 0's and **both landed in `36b5a1f`**. §2.3 is still owed by two other
planners' units and still hard-blocks two units of this one.

### 2.1 `mastery` has an ETL home — SATISFIED at `36b5a1f`

The defect, for the record: `build-bundle.ts` built `weaponRecords` without ever emitting `mastery`,
so a rebuild silently dropped the column from all 38 rows — `WeaponReferenceSchema.mastery` is
`.optional()` (`packages/content-srd-5.2.1/src/schemas.ts:125`), so `validateBundle` passed with the
column gone.

It now joins from the vendored markdown SRD's printed Weapons table.
`packages/content-srd-5.2.1/scripts/build-bundle.ts:585-618` parses that table into a per-weapon
`{ properties, mastery }` map and cross-checks every slug against the 17 `WeaponProperty` fixtures
(`:607-616`); `:620-641` emits both columns on every row (`mastery` at `:632`, `properties` at `:635`)
and **fails closed** when a weapon has no table row (`:626`); `:642-645` fails closed in the other
direction too, when a table row matched no weapon.

The regenerated bundle's diff is the proof the transcription is faithful: **143 insertions, zero
deletions** — re-measured with `git show --stat 36b5a1f -- packages/content-srd-5.2.1/bundles/weapons.v1.json`
— so all 38 `mastery` values come back byte-identical. `packages/content-srd-5.2.1/test/bundle.test.ts:224`
now pins all 38 by name, so a future drop is a red test rather than silence.

The column still flows bundle → equipment row (`packages/content-srd-5.2.1/src/index.ts:115`) →
`masteryByActionId` (`apps/server/src/equipment-derivation.ts:650`), and it is still this program's
entire data basis. **No agent of this program may run `npm run build-bundle` or regenerate
`packages/content-srd-5.2.1/bundles/weapons.v1.json` at any point** — batch 0 owns that file and it is
done. If an agent needs a bundle change, it stops and reports.

### 2.2 `properties` reaches the reader — SATISFIED at `36b5a1f`; U35a/U35b unblocked

The defect, for the record: 0 of 38 rows carried `properties`, and the column existed on neither
`WeaponReferenceSchema` nor `EquipmentWeaponStatsSchema`. The live side was already plumbed —
`ItemWeaponSchema.properties` (`packages/schemas/src/index.ts:354`) and `weaponAction` reading it at
`apps/server/src/equipment-derivation.ts:997` for `thrown` and `reach` (`:1011`) — so the property list
was readable and always empty.

**It had to land on four shapes, not one, or it never reached the reader. All four landed:**

1. `WeaponReferenceSchema.properties` — `packages/content-srd-5.2.1/src/schemas.ts:139` (schema
   `:105-140`),
2. `EquipmentWeaponStatsSchema.properties` — `:260` (schema `:245-261`),
3. the ETL emit — `packages/content-srd-5.2.1/scripts/build-bundle.ts:635`,
4. the catalog→inventory copy — `apps/server/src/character-build.ts:1591`, which now copies a sixth
   weapon field, omitting the key entirely when the catalog records none.

**The acceptance this program asked of batch 0, re-run at `36b5a1f`:**

```
npx vitest run test/character-build.test.ts --root apps/server \
  -t "copies the catalog's weapon properties"
→ 1 file, 1 passed | 56 skipped, 0.99 s
```

That test is `apps/server/test/character-build.test.ts:357-365`, and its line `:362` is this plan's own
sentence as an assertion — `expect(weaponPropertiesOf("dagger", definition.startingInventory ?? []))
.toContain("light")`, on the inventory a real `buildCharacterDefinition` produced. The union of keys
across all 38 bundle rows is now `id, name, category, improvised, mastery, properties, damage,
rangeFeet, longRangeFeet`, 70 property assignments in total, and all four `nick` weapons carry `light`
(dagger, light-hammer, scimitar, sickle).

**Consequence for this plan:** U35a and U35b were blocked here and are no longer. U35a's remaining
blocker is a ruling, not a column (§4.6).

### 2.3 What this program needs from another planner's units

Neither is a soft dependency; **`vex` and `slow` are hard-blocked** and there is no honest degraded
form of either.

- **M1 `vex` ← U22 (target-scoped effects).** Vex is "Advantage on your next attack roll **against that
  creature**." `EffectInstanceSchema` has no field naming the creature an effect applies against, and
  the attacker roll-mode collector at `apps/server/src/action-resolution.ts:544-552` reads
  `effect.modifiers` with no target in hand. A degraded vex — a plain `attack-advantage` — would grant
  advantage against *everyone*, which is a rules bug that looks exactly like the feature working. **No
  fallback. M1 waits for U22.** What M1 needs from U22, precisely: (a) a field on the effect naming the
  target actor, (b) a gate consuming it in `attackRollSources` beside the `onOwnTurn` gate at
  `action-resolution.ts:546`, (c) that field stripped in `playerEffect`
  (`apps/server/src/projections.ts:138-139`), which already strips `sourceActorId` for exactly this
  reason.
- **M2 `slow` ← U18 (runtime `speed` effect modifier).** Slow is "−10 feet Speed until the start of your
  next turn." `EffectModifierSchema` (`packages/schemas/src/index.ts:232-255`, **12 members**) has no
  speed member, and — the part U18's own description does not cover — `effectiveSpeedFeet`
  (`apps/server/src/condition-rules.ts:44-50`) reads `actor.speedFeet`, exhaustion,
  `SPEED_ZERO_CONDITIONS` and the `dashing` tag, and **never looks at `actor.effects[].modifiers` at
  all.** So U18 must ship both the modifier *and* the read, or `slow` has a field nothing consumes.
  **M2 must not paper over this by writing `actor.speedFeet` directly** — that is destructive and
  unrecoverable. **No fallback. M2 waits for U18.**

---

## 3. M0 — the dispatch seam (a refactor, not a unit)

**Why it exists:** four of the six behaviour units (`topple`, `push`, `vex`, `slow`) are all "on a hit,
do something to the target", and the only place that shape exists today is the Sap block at
`apps/server/src/action-resolution.ts:1058-1079`. Four agents appending a branch after line 1079 is a
genuine merge conflict in one ~20-line region, not merely the same file (§5).

**What it does, and nothing more:** move the Graze branch (`:948-951`) and the Sap branch
(`:1058-1079`) into a new leaf module beside `apps/server/src/action-resolution.ts` — basename
`weapon-mastery.ts` — exposing two entry points (an on-miss hook returning bonus-damage entries, an
on-hit hook returning applied effects), with one registry object keyed by slug. `action-resolution.ts`
calls the two hooks at the two lines the branches occupied.

**Three design constraints M0 must honour:**

1. **`IMPLEMENTED_MASTERIES` becomes derived**, not authored: `new Set(Object.keys(MASTERY_HANDLERS))`.
   This is what removes it as a merge point (§6). It preserves the client's ruling in substance — a slug
   still joins the Set in the same commit that adds its behaviour, because *adding the handler is what
   joins it* — and it strengthens the coupling: a slug cannot be in the Set without a handler.
2. **The registry must stay importable by `equipment-derivation.ts` without a cycle.** That module's own
   docblock (`apps/server/src/equipment-derivation.ts:215-217`) records that it imports no other server
   module on purpose. So the *registry* (the slug keys) is a leaf; the *handlers* (which import
   `effects.ts` and `saving-throws.ts`) must not be reachable from it. If a clean split proves awkward,
   the fallback is to leave `IMPLEMENTED_MASTERIES` at `equipment-derivation.ts:247` as a hand-written
   literal and accept it as a serialization point — say so and stop, do not invent a cycle.
3. **Behaviour must not change.** The proof is
   `apps/server/test/weapon-mastery.test.ts` passing **unchanged**, all 12 tests, with no edit to that
   file in M0's commit. If a single assertion has to move, M0 was not a refactor.

**M0 is serial and blocks everything else in this program.**

---

## 4. The seven units

Each names its four parts, its far-end proof, both non-vacuity probes, and whether it needs a 375px
pass. The done bar throughout: **a far-end engine outcome driven from a weapon record** — not "the
value survived derivation."

### 4.1 U34 — `topple` (5 weapons) · size S

> On a hit, the target makes a Constitution saving throw against DC 8 + your ability modifier +
> proficiency bonus, or has the Prone condition.

- **reader** — a handler in M0's on-hit registry calling `createPendingSaves`
  (`apps/server/src/saving-throws.ts:164-192`) with `ability: "con"`, `conditionId: "prone"`,
  `proposedDamage: 0`, `halfOnSuccess: false`.
- **content** — 5 SRD weapons (battleaxe, lance, maul, quarterstaff, trident). No authoring needed.
- **control** — **none, and that is correct.** `weapon.mastery` is a closed 8-slug enum; implementing a
  slug adds no authorable vocabulary. The control is U38's job and U38's alone.
- **test** — a level-3 Fighter with `topple` picked on the quarterstaff hits; a pending Constitution
  save appears on the foe at the right DC; answering it below the DC applies **the Prone condition on
  the foe actor**.

**Far-end proof:** `state.combat.pendingSaves` carries the prompt, and after a failed answer the foe
carries `prone` in `actor.conditions`. Not "the handler was called."

**Why S:** the pattern already exists ~100 lines away. The builtin shove at
`apps/server/src/action-resolution.ts:1163-1185` computes exactly this DC
(`8 + abilityModifier(str) + proficiencyBonus`, `:1166`) and passes `conditionId: "prone"` (`:1178`).
Topple reuses that shape with `con` and the mastery's own `abilityModifier` (which
`masteryByActionId` already carries — `apps/server/src/equipment-derivation.ts:654`, and it is there
precisely because the finesse/ranged choice belongs to `weaponAction`, not to the resolver).

**Probes.** *Control:* remove `topple` from the handler registry → the derivation stops advertising it,
the swing produces no pending save, and the honesty test in `weapon-mastery.test.ts` fails naming the
slug. *Value:* keep the handler, change the save ability from `con` to `str` → the far-end assertion on
the prompt's ability fails. Report exact counts and messages; restore after each.

**375px:** no. Server-only.

### 4.2 U36 — `cleave` (2 weapons) · size L · **dedicated agent + viewer-safety audit**

> On a hit with a melee attack, make an attack roll with the same weapon against a second creature
> within 5 feet of the first and within your reach. On a hit the second creature takes the weapon's
> damage without your ability modifier. Once per turn.

- **reader** — a second attack roll and damage roll inside one resolution, plus a relaxation of the
  one-target guard (below).
- **content** — 2 SRD weapons (greataxe, halberd), both melee. No authoring needed.
- **control** — none (see U34).
- **test** — a Fighter with `cleave` on the greataxe hits foe A; **foe B takes a second rolled damage
  number**, with the ability modifier absent from it; a second cleave in the same turn is refused.

**The authorization defect, and the fix.** `canPlayerTarget`
(`apps/server/src/authorization.ts:35-38`) has **exactly one production call site**:
`apps/server/src/game-operations.ts:1238`, inside a loop over `resolvedTargetIds`. A server-chosen
second target does not go through it, which is a role-boundary defect (CLAUDE.md rule 4) as much as a
feature — the function's own docblock (`authorization.ts:27-34`) says resolving against a hidden actor
leaks its name, AC and outcome back through the resolve ack, which bypasses the player projection.

**Ruling: the second target is client-supplied in `targetIds[1]`, not server-chosen.** The existing
loop at `game-operations.ts:1238` then covers it **for free**, with no new gate and no new wire field.
The alternative — a new `cleaveTargetId` on `ActionResolveSchema` — creates a second target path that
loop does not iterate, which is precisely the ungated hole. Reuse the gate; do not add one beside it.

**There are TWO one-target gates, not one, and relaxing only the first is worse than relaxing
neither.** Both must change together:

1. `apps/server/src/action-resolution.ts:678` — `if (action.attack && targets.length !== 1) throw new
   CommandRejectedError("An attack roll resolves against exactly one target.")`. This is the loud one.
2. `apps/server/src/action-resolution.ts:811` — `if (action.attack && targets.length === 1) {`, which
   opens the **entire attack-roll block** (`:811-905`). This one is silent. Relax `:678` alone and a
   two-target cleave sails past the throw, skips the whole block, leaves `attack` null, rolls no
   damage, and fires no mastery branch at all — Graze (`:949`) and Sap (`:1058`) both require
   `attack !== null`. The result is a swing that resolves, reports nothing, and reviews as working:
   exactly the built-but-unwired shape this program exists to close.

Relax both to permit **exactly two** targets and **only** when the action's in-force mastery is
`cleave`; keep each relaxation as narrow as the rule. Everything downstream keeps reading `targets[0]`
— the block's own `const target = targets[0]` (`:812`), the on-hit riders (`:1011`), Sap (`:1059`),
the grant recipient (`:1086`), the reaction prompt (`:1122`) and the builtin saves (`:1165`) all take
index 0 and stay correct.

**What stays a server decision (CLAUDE.md rule 2):** the *legality* of the second target — within 5
feet of the first and within the attacker's reach — is computed server-side from
`deps.distanceFeet`, never trusted from the client. An illegal second target is a **warning and a
skipped cleave**, not a rejected attack. Once-per-turn rides the existing turn-scoped counter
(`apps/server/src/action-resolution.ts:1233-1236`, `plan.spendUse.per === "turn"`).

**Far-end proof:** two damage totals in one `ActionResolution`, the second one lower than the first by
exactly the ability modifier, against a named second foe.

**Probes.** *Control:* remove `cleave` from the registry → one attack roll, one damage number, and the
resolve refuses a second target id at `:678` with its own message. *Value:* keep the handler and add
the ability modifier to the second damage formula → the "second total is lower by the modifier"
assertion fails. Report counts and messages.

**Viewer-safety audit before merge.** Two specific questions, both answered in writing: (a) does a
player-initiated cleave against a `gm-only` second target refuse at `game-operations.ts:1238` before
any name, AC or outcome is computed? (b) does the refusal message differ between "no such actor" and
"hidden actor" — i.e. is it an existence oracle? At HEAD the answer to (b) is **no**: `canPlayerTarget`
returns `false` for both cases and the single call site throws one message, *"You can only target
combatants you can see."* So a difference is a regression U36 introduced, not a pre-existing hole —
prove it stayed one message. Pair with
`apps/server/test/docs-viewer-safety.test.ts` and add a case to
`apps/server/test/authorization.test.ts`.

**375px:** no server-side. **But the runner must be able to pick the second target**, and if U36 adds
any client affordance for that, it needs a 375px touch pass and a `node scripts/tap-audit.mjs 375`
run whose count must not rise.

### 4.3 U37 — `push` (4 weapons) · size M · **dedicated agent + viewer-safety audit**

> On a hit, you can push the target 10 feet straight away from yourself.

- **reader** — a handler that writes a token position.
- **content** — 4 SRD weapons (greatclub, heavy-crossbow, pike, warhammer). No authoring needed.
- **control** — none (see U34).
- **test** — a Fighter with `push` on the warhammer hits; **the foe's token position changes**, by 10
  feet, directly away, snapped.

**The token-writer problem, and the fix.** Today the only production writers of
`state.combat.tokens[].position` are `moveSceneToken` and `moveEncounterToken`
(`apps/server/src/token-placement.ts:139-165`), and the ownership check lives **not** in either of them
but in the command handler: `apps/server/src/game-operations.ts:705-708` —
`if (!isGmGrade(principal)) { … "You may only move your claimed character token." }`. `action.resolve`
writing a position therefore bypasses that check by construction.

**Two things must be true and they are different things.**

1. **A player must not be able to move a token by choosing where.** Push takes **no client input** —
   not a destination, not a direction, not a distance. The direction is derived server-side from the
   two token positions and the distance is the SRD's fixed 10 feet. This is server authority
   (CLAUDE.md rule 2) held correctly: there is nothing for the client to assert.
2. **The move must still be legitimate.** Push moves a token the actor does not own, which is a game
   rule, not a violation — but only against a target the actor was already allowed to attack. That is
   already guaranteed: `canPlayerTarget` ran over every target id at `game-operations.ts:1238` before
   the resolve. **Push must therefore only ever move `targets[0]`, never an arbitrary actor id**, and
   the handler's signature should make that structurally true rather than checked.

**The seam.** `apps/server/src/action-resolution.ts` has no geometry and must not grow an import of
`token-placement.ts`. `geometry` is already fetched inside `actionResolve` at
`apps/server/src/game-operations.ts:1195`, so the clean shape is a new optional dependency on
`ResolveDependencies` (`action-resolution.ts:54-76`) — a callback the operation constructs and that
calls `moveEncounterToken` internally. That reuses the same snapping the GM's own drag uses
(`token-placement.ts:77-97` via `:160`), which is what `docs/ai-context/map-grid.md` requires: the
server owns all snapping and there is exactly one implementation of it. Note the geometry there is
`TokenMapGeometry | null` — a null one is the unmeasurable case below, not a crash.

**Three rulings this unit needs, stated so the agent does not have to invent them:**

- **Forced movement does not route through `applyMovementRules`.** Calling `moveEncounterToken`
  directly skips it, and that is correct rather than an oversight: SRD forced movement provokes no
  opportunity attacks and spends none of the target's movement. `applyMovementRules` is called only
  from `tokenMove` (`apps/server/src/game-operations.ts:717`), never from `moveEncounterToken`, so the
  correct behaviour is the default. Say this in the code comment or the next reader will "fix" it.
- **Unmeasurable degrades to a warning, never to a rejection.** On a gridless and unscaled map
  `mapDistance` returns null (`apps/server/src/movement-narration.ts:33-44`), and a token with no
  position cannot be pushed. The precedent is one file away and is exactly right: the builtin shove at
  `apps/server/src/action-resolution.ts:1183` pushes a warning — *"is pushed 5 feet - move the
  token."* Push copies that sentence shape. **It must not throw**; `moveEncounterToken` throws when the
  token is absent, so guard before calling.
- **The fog claim in [`area-2-plan.md`](area-2-plan.md) is stale — delete it, do not implement it.**
  That plan requires push to route through "the same fog recomputation (`apps/server/src/fog.ts`)".
  Measured: `apps/server/src/fog.ts` reads no token anywhere — the word appears once in the module, in
  a docblock at `:13` naming the token-move *pattern*, and never in a code path. Its only production
  importer is `apps/server/src/game-operations.ts:36` (`paintFog`, `resetFog`, `setFogEnabled`), all
  GM paint commands. **No code path recomputes fog from token positions.** There is nothing to route
  through and U37 must not build one.

**Far-end proof:** the foe's `state.combat.tokens[].position` before and after, with the measured
distance between them equal to 10 feet through `mapDistance`, and the direction away from the attacker.
A snapped destination, not a raw one.

**Probes.** *Control:* remove `push` from the registry → the position is byte-identical before and
after, and no warning is emitted. *Value:* keep the handler and change the push distance from 10 feet
to 0 → the measured-distance assertion fails at the far end. Report counts and messages.

**Viewer-safety audit before merge.** The honest scope here is narrower than
[`area-2-plan.md`](area-2-plan.md) claims and should be stated as such: **push introduces no new wire
field.** Token positions already ship to players and the viewer, filtered to public actors at
`apps/server/src/projections.ts:76`. The audit's real questions are (a) can a player cause a token they
do not own to move — yes, and that is the rule, but only `targets[0]` and only after
`canPlayerTarget`; (b) can a player cause a **hidden** actor's token to move, which would be an
existence oracle through the revision bump — answer via `game-operations.ts:1238`, and prove it.

**375px:** **yes.** A forced move can land a token off the visible viewport on a phone, which is a
mobile-parity failure the desktop never sees (CLAUDE.md rule 5, `docs/ai-context/mobile-ux.md`). Verify
at 375px that a pushed token remains findable, and run `node scripts/tap-audit.mjs 375` — the count
must not rise.

### 4.4 M1 — `vex` (8 weapons) · size M · **blocked on U22**

> On a hit, you have Advantage on your next attack roll **against that creature** before the end of
> your next turn.

Written to the same four-part contract as U34–U37.

- **reader** — a handler in M0's on-hit registry applying an effect to **the attacker** carrying an
  attack-advantage modifier scoped to the target actor, consumed by the collector at
  `apps/server/src/action-resolution.ts:544-552`.
- **content** — 8 SRD weapons, the largest single mastery. No authoring needed.
- **control** — none (see U34).
- **test** — a Fighter with `vex` on the rapier hits foe A; the **next attack against foe A rolls 2d20
  and keeps the higher**; the next attack against foe B rolls **one** die.

**Why this is a unit and not a rider on U22.** U22's four parts are: the advantage collector; an SRD
"advantage against a creature you hit" record; one row in the `modifiersField` nest; a test ending at
an advantage that applies against one named foe and not another. None of those four is a mastery branch
in `apps/server/src/action-resolution.ts`, none is `vex` joining the implemented set, and none is a test
driven from a weapon record. **U22 unblocks vex; it does not implement it.** U22 could pass every one of
its own acceptance criteria with all 8 vex weapons still inert.

**Far-end proof:** the two-die roll on the *next* attack, read off `rollMode` and `attack.naturalRoll`
— the shape the Sap test already proves at `apps/server/test/weapon-mastery.test.ts:244-246`, which is
the model to copy: prove it on the die that gets rolled later, not on the effect that was applied.

**Probes.** *Control:* remove `vex` from the registry → no effect on the attacker, one die on the next
attack. *Value:* keep the handler and point the effect's target scope at foe B instead of foe A → the
"advantage against A, single die against B" pair inverts and the far-end assertion fails.

**Viewer safety:** this rides U22's field, and U22 carries the audit. This unit's own obligation is to
confirm the field it writes is the one `apps/server/src/projections.ts:138-139` strips — a check, not a
new decision.

**375px:** no.

### 4.5 M2 — `slow` (7 weapons) · size M · **blocked on U18**

> On a hit, the target's Speed is reduced by 10 feet until the start of your next turn.

Written to the same four-part contract as U34–U37.

- **reader** — a handler applying an effect to the **target** carrying U18's runtime `speed` modifier
  at `−10`, with `duration: { type: "until-source-next-turn" }` — the same duration Sap uses
  (`apps/server/src/action-resolution.ts:1068`) and the same one Reckless Attack and Dodge use —
  consumed by `effectiveSpeedFeet` (`apps/server/src/condition-rules.ts:44-50`).
- **content** — 7 SRD weapons. No authoring needed.
- **control** — none (see U34).
- **test** — a Fighter with `slow` on the club hits; the foe's **movement budget on its own turn is 10
  feet smaller**, and the effect expires at the start of the attacker's next turn.

**Why this is a unit and not a rider on U18.** Same argument as M1: U18's four parts end at "a movement
budget that changed" driven from an SRD *effect* record, not from a *weapon* record, and none of them
adds a mastery branch or the slug. **U18 unblocks slow; it does not implement it.**

**Far-end proof:** the movement budget, read where the engine enforces it —
`apps/server/src/movement-rules.ts:68` calls `effectiveSpeedFeet`. The test must end at a refused or
narrated over-budget move, not at "the effect has a −10 modifier."

**Probes.** *Control:* remove `slow` from the registry → the foe's budget is unchanged. *Value:* keep
the handler and change the amount from −10 to 0 → the budget assertion fails at the far end.

**Note for the agent:** stacking is a real question and the answer is the engine's existing one — the
effect is keyed by `${commandId}:mastery:slow:${targetId}` following Sap's key shape
(`apps/server/src/action-resolution.ts:1061`), so two different attackers each apply their own. Whether
two −10s stack is the SRD's problem, not this unit's; do not invent a cap.

**375px:** no.

### 4.6 U35a / U35b — the Light extra attack, then `nick` (4 weapons)

**This is where the governing plan's sizing is wrong, and it is not a small correction.**

`nick` reads: *"When you make the extra attack of the Light property, you can make it as part of the
Attack action instead of as a Bonus Action."* Re-measured at `36b5a1f`, after batch 0: **there is still
no Light-property extra attack anywhere in this codebase.** A case-insensitive grep for `two-weapon`,
`twoWeapon`, `offhand` and `off-hand` across `apps/server/src`, `apps/client/src` and
`packages/rules-5e/src` returns **zero hits**, and a grep for a `light` weapon branch returns nothing
but armour weight (`packages/rules-5e/src/riders.ts:18` and `:280`, plus the editor's armour-weight
options at `apps/client/src/homebrew/RiderEditor.tsx:225`). The bonus-action economy exists
(`apps/server/src/action-resolution.ts:255-257`) and nothing puts a weapon swing into it —
`weaponAction` hard-codes `activation: "action"` at
`apps/server/src/equipment-derivation.ts:1007`. **Batch 0 landing `properties` did not change this**:
8 weapons now carry `light` (club, dagger, hand-crossbow, handaxe, light-hammer, scimitar, shortsword,
sickle) and nothing reads it for an extra attack. That is the column arriving, not the mechanism.

**You cannot move something that does not exist.** So the single "U35" of the old plan is two units,
and per the commit rule in [`area-2-plan.md`](area-2-plan.md) ("if a unit cannot be described in one
sentence naming its reader, its content, its control and its test, split it before starting") it must
be split before starting.

**Corroborating evidence that U35a is real work someone owes anyway:** the SRD fighting style
`two-weapon-fighting` ships in `packages/content-srd-5.2.1/bundles/feats.v1.json:302`, a Fighter can
pick it, its description is *"When you make an extra attack as a result of using a weapon that has the
Light property…"* — and it has **zero readers**. It is inert for exactly the same missing mechanism.

**U35a — the Light-property extra attack.** Size L. Not a mastery, and no other program owns it.
**This is a scope expansion and the parent's ruling is STILL OWED — nothing has ruled on it as of
`36b5a1f`.** Batch 0 unblocked its *data*; only the parent unblocks its *scope*. Do not schedule U35a
(and therefore U35b, and therefore U38) until that ruling is recorded in
`docs/ai-ledger/decision-log.md`.
- **reader** — a bonus-action swing offered when the attacker made the Attack action with a Light
  weapon and holds a second Light weapon, damage without the ability modifier.
- **content** — the `light` property on the SRD weapons that have it. **Landed in batch 0** (§2.2);
  nothing for this unit to author.
- **control** — none for the mechanism; the `properties` control, if any, was batch 0's.
- **test** — a Fighter holding two Light weapons gets a bonus-action swing that rolls damage; a Fighter
  holding one does not.

**U35b — `nick`.** Size M, **depends on U35a**.
- **reader** — a handler that, when the attacker's Light weapon has `nick` in force, folds U35a's
  bonus-action swing into the Attack action: the swing resolves without setting `bonusActionUsed`
  (`apps/server/src/action-resolution.ts:256`, `:1212`), once per turn.
- **content** — 4 SRD weapons (dagger, light-hammer, scimitar, sickle). All four carry `light` at
  `36b5a1f`; verified against the bundle, not assumed.
- **control** — none (see U34).
- **test** — a Fighter with `nick` on the dagger takes the Attack action, makes the extra swing, and
  **`state.combat.turn.bonusActionUsed` is still `false`** — then a bonus-action Dash still succeeds.
  The same Fighter without `nick` picked has `bonusActionUsed === true` and the Dash is refused.

**Far-end proof (U35b):** the refusal that does *not* happen. A spent-or-unspent bonus action is the
whole mechanic, and "the bonus action is still available" is only a real claim if something then
consumes it.

**Probes (U35b).** *Control:* remove `nick` from the registry → `bonusActionUsed` flips true and the
Dash is refused with `economy.bonus-action-used`. *Value:* keep the handler and leave the swing's
once-per-turn counter unset → a second nick swing in the same turn succeeds and the far-end assertion
fails.

**375px:** U35a — **yes** if it adds a runner affordance for the bonus swing, which it almost certainly
must. `node scripts/tap-audit.mjs 375`, count must not rise, and the new control checked at a narrow
viewport with touch.

### 4.7 U38 — `weapon.mastery` on a homebrew weapon · size S · **the closer**

- **reader** — `masteryByActionId` at `apps/server/src/equipment-derivation.ts:644-656`, which already
  requires *mastery ∧ unlocked ∧ implemented*. **Nothing to build.**
- **content** — all 38 SRD weapons already author it.
- **control** — **the only missing part.** One row in the weapon section of
  `apps/client/src/homebrew/schemas.ts`. Measured at `36b5a1f` the section is `:756-771` and its fields are
  `:764-769` — five rows (weapon kind, damage, damage type, range, long range) and **no mastery**.
- **test** — both paths end at the mastery firing on a homebrew weapon.

**Two things the implementing agent must get right:**

1. **It is a `select`, not a `pick`.** `weapon.mastery` is a closed 8-slug enum in the schema
   (`packages/content-srd-5.2.1/src/schemas.ts:252`, mirroring `:125`), so a free-entry control would let a GM type a
   slug that publishes clean and is silently inert — the failure mode this repo calls the hardest
   homebrew defect to diagnose. It joins the closed list in
   `apps/client/src/homebrew/vocabularies.test.ts:169-171` beside `equipment.slot`,
   `equipment.weapon.category` and `class.hitDie`, with `emptyValue: "omit"` (a homebrew weapon may
   legitimately have no mastery — see the schema's own note at
   `packages/content-srd-5.2.1/src/schemas.ts:120-123`).
2. **Do not use `ctx.weaponProperties`.** That list is properties *and* masteries merged —
   `apps/client/src/homebrew/schema.ts:136`, measured 9 + 8 = 17 slugs — assembled for the
   `weapon-property-is` trigger. Offering it here would let a GM set a weapon's mastery to `"finesse"`.
   `WEAPON_MASTERY_IDS` (`packages/content-srd-5.2.1/src/schemas.ts:143`) is the right list and is
   already imported into `apps/client/src/homebrew/useSchemaContext.ts:17`. Import it from
   `@vtt/content-srd-5.2.1/schemas` as that file already does: `schemas.ts` re-exports `enums.js`
   (`:45`), which publishes a *second* `WEAPON_MASTERY_IDS` (`enums.ts:72`) that the local export at
   `:143` shadows — same eight slugs, but do not reach past the subpath and pick the other one.

**The census line deletes in the same commit.** `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts:3415`
carries `["equipment", "weapon.mastery", [], "U38 — 38 SRD weapons, gated on all eight slugs reaching"]`
in the `owed` array, and the assertion at `:3419-3421` requires every owed key to still be unreachable.
**Adding the control without deleting that line fails the test.** That is the guard working, not a
regression.

**Far-end proof:** a GM authors a homebrew weapon with `mastery: "topple"`, a character unlocks it, and
a swing produces the Constitution save — through the editor's own `applyField`/`storedBody` path, the
way `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` proves every other control. Not "the
key round-tripped."

**Probes.** *Control:* delete the field → the census assertion at `:3419` goes green again *and* the
far-end mastery assertion fails with a named message. *Value:* keep the field and mangle the write so
it stores a different slug → the mastery that fires is the wrong one and the far-end assertion fails.
Report exact counts and messages.

**375px: yes, and it is mandatory.** This is the one unit in the program with UI. A `select` in the
equipment form at a narrow viewport with touch, plus `node scripts/tap-audit.mjs 375` — quote its
output; the count must not rise.

**The gate.** U38 must not ship until **all eight slugs reach**, or it offers a GM six choices that do
nothing. It depends on U34, U35b, U36, U37, M1 and M2 — all six.

---

## 5. Concurrency — which sites, and whether they truly conflict

The 4-agent ceiling is the box's, not this program's. Worktrees are hard-linked (`cp -al`), **never
symlinked** — POSIX resolves a symlinked `node_modules` first, so a cross-package unit gets a green run
that proves nothing about its own worktree.

**All six behaviour units add a branch to `apps/server/src/action-resolution.ts`. Measured, that is
three different things:**

| unit | site at HEAD | after M0 | genuine conflict? |
| --- | --- | --- | --- |
| U34 `topple` | on-hit, beside Sap `:1058-1079` | a handler in the registry module | **no** |
| U37 `push` | on-hit, beside Sap `:1058-1079` | a handler in the registry module | **no** |
| M1 `vex` | on-hit, beside Sap `:1058-1079` | a handler in the registry module | **no** |
| M2 `slow` | on-hit, beside Sap `:1058-1079` | a handler in the registry module | **no** |
| U36 `cleave` | **both** one-target gates, `:678` and `:811` + the attack-roll block `:811-905` + the damage block `:910-931` | unchanged | **no** — disjoint region |
| U35b `nick` | the economy plan `:255-257` and its commit `:1211-1215` | unchanged | **no** — disjoint region |

**Without M0 the answer is different and worse.** Four units appending after
`apps/server/src/action-resolution.ts:1079` is one ~20-line hunk touched four times — a genuine
conflict, and the dangerous kind, because a careless resolution drops a branch and leaves a slug in the
implemented set with no behaviour. **That is what M0 buys, and it is the whole reason M0 exists.**

Cleave and nick are in genuinely disjoint regions of the same file and can run concurrently with each
other and with the on-hit units. Two agents editing `action-resolution.ts` 400 lines apart is the same
file, not the same site.

**The proposed grouping**, obeying the ceiling and the two dedicated-agent rulings:

| batch | agents | units | gates |
| --- | ---: | --- | --- |
| **M-α** | 1 | **M0** the dispatch seam | after batch 0; serial; blocks all |
| **M-β** | 4 | **U34** · **U36** (dedicated) · **U37** (dedicated) · **U35a** | after M-α; batch 0's `properties` landed, but **U35a still needs the parent's scope ruling** (§4.6) |
| **M-γ** | 3 | **U35b** · **M1** (after U22) · **M2** (after U18) | U35b after U35a; M1/M2 after their blockers merge |
| **M-δ** | 1 | **U38** | after all eight slugs reach |

Each batch closes with the review layer folded in, per the governing plan's ruling 3: **an adversarial
reviewer hunting the two named failure modes only** — built-but-unwired mechanisms, and vacuous tests —
then a QA-fix pass, then polish. U36 and U37 additionally get a **viewer-safety audit before merge**
(§4.2, §4.3), not after.

**At most 2 full-suite runs concurrently** — the server suite binds a live port. And **build only the
client workspace**: `npm run build` emits compiled output under the server workspace and `npm run test`
then collects those compiled tests too (185 → 204 files, ~11 spurious failures).

---

## 6. How `IMPLEMENTED_MASTERIES` is sequenced across seven units

The governing plan lists `apps/server/src/equipment-derivation.ts`'s `IMPLEMENTED_MASTERIES` as a
serialization point — *"one Set literal, seven units."* Measured, it is **three** co-located edit
points, not one:

1. the Set literal itself (`apps/server/src/equipment-derivation.ts:247`),
2. `const built = ["graze", "sap"];` (`apps/server/test/weapon-mastery.test.ts:279`),
3. `const notYet = ["cleave", "nick", "push", "slow", "topple", "vex"];` (`:280`).

**M0 removes the first** by deriving the Set from the handler registry (§3). After M0, adding a handler
*is* joining the Set, so no unit edits a shared literal in production code at all.

**Points 2 and 3 stay, deliberately.** They are the honest hand-written claim. That test makes three
assertions over them (`apps/server/test/weapon-mastery.test.ts:281-284`); the first two pin each half
against `masteryReaches`, and it is **the third** that makes them safe under concurrent editing:

```
expect([...built, ...notYet].sort()).toEqual([...new Set(loadWeapons().map((weapon) => weapon.mastery))].sort());
```

Verified at `36b5a1f`: that assertion is at `:284`, it really does compare the union against the
bundle's own set, and the bundle really does carry all eight (38 rows, `mastery` on every one).
A merge that drops a slug from `notYet` without adding it to `built` fails loudly there — the union is
seven. A merge that adds it to both fails the same way — the sorted union is nine, with a duplicate.
And a slug that reaches `built` without a handler fails `:281` instead. **There is no silent bad
resolution here** — which is why this is the right place to keep the manual claim and the wrong place
to remove it.

**The operational rule for the seven agents:** the two arrays are the **one line each agent must
re-check after rebasing onto the merged trunk**, before its final verification run. One slug moves from
`notYet` to `built` per unit, in alphabetical position. The agent that lands last sees
`built = ["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]` and `notYet = []`, and
**that empty array is U38's green light.**

`masteryReaches` (`apps/server/src/equipment-derivation.ts:257`) stays the single public gate
throughout. No unit adds a second registry, and no unit checks a slug by string comparison outside the
registry module.

---

## 7. The two invariant units, restated as decisions

### 7.1 U36's authorization gap

**The defect:** `canPlayerTarget` has exactly one call site
(`apps/server/src/game-operations.ts:1238`), over `resolvedTargetIds`. A server-chosen second target
never reaches it, and the resolve ack bypasses the player projection.

**The decision:** cleave's second target arrives as `targetIds[1]` and is validated by the loop that
already exists. **Do not add a second gate; reuse the one.** The server still owns whether the target is
*legal* (within 5 feet, within reach) — that is a game decision and stays server-side per CLAUDE.md
rule 2 — but *who may be named at all* is answered by the existing check, which is the point of having
one.

**The cost:** one condition on **each of the two** one-target gates —
`apps/server/src/action-resolution.ts:678` (the throw) and `:811` (the gate that opens the attack-roll
block), both narrowed to the cleave case. Relaxing only `:678` is the trap: the resolve is accepted and
then silently produces no attack roll at all (§4.2). Both guards have been protecting a real invariant
and each relaxation must be as narrow as the rule.

### 7.2 U37's second token-position writer

**The defect:** the ownership check lives in the command handler
(`apps/server/src/game-operations.ts:705-708`), not in `moveEncounterToken`
(`apps/server/src/token-placement.ts:155-165`). A second caller inherits none of it.

**The decision:** push takes **no client input at all** — no destination, no direction, no distance —
and moves **only `targets[0]`**, which `canPlayerTarget` already cleared. The move is injected as a
dependency built in `actionResolve` where `geometry` already exists
(`apps/server/src/game-operations.ts:1195`), and it calls `moveEncounterToken` so there remains exactly
one snapping implementation. `action-resolution.ts` gains no import of `token-placement.ts`.

**Why this is not merely "as safe as `token.move`" but safer:** `token.move` accepts a client-supplied
destination and must check ownership. Push accepts nothing and derives everything, so there is no
client assertion to trust. That is server authority held correctly rather than re-checked.

**Size correction: S → M.** The brief sizes U37 at S. Measured, it needs a new dependency on
`ResolveDependencies`, a geometry-aware destination computation, an unmeasurable-map fallback, and a
375px pass — none of which topple needs. It is the same size as `vex` or `slow`, not the same size as
`topple`.

---

## 8. The verification bar, per unit

Non-negotiable and unchanged from [`remaining-program-plan.md`](remaining-program-plan.md) §6 and
`docs/ai-context/testing.md`:

1. **A far-end proof, driven from a weapon record.** Every unit above names one. A test that ends at
   "the handler ran" or "the modifier is present" is not a test — the two shipped masteries set the
   standard, and `apps/server/test/weapon-mastery.test.ts:244-246` (Sap proved on the die the *foe*
   rolls) is the model.
2. **Two non-vacuity probes, both reported with exact counts and messages, restored after each.**
   Every unit above names both.
3. **A 375px touch pass** for U38 (mandatory), U37 (mandatory — a pushed token off-viewport), U35a (if
   it adds an affordance) and U36 (if it adds one). `node scripts/tap-audit.mjs 375`; quote the output,
   never a number from a document; the count must not rise. Chromium is at `/opt/pw-browsers` —
   **never run `playwright install`**.

Read `docs/ai-ledger/known-bugs.md` before calling a red test a regression.

---

## 9. Generated and shared files

Parent-only, never touched by an agent of this program: `docs/api-reference.md`, `docs/app-map.md`,
`docs/ai-ledger/current-state.md` (re-measured at `36b5a1f`: still **exactly 150 lines**, its enforced
ceiling — zero headroom).

`packages/content-srd-5.2.1/bundles/weapons.v1.json` — batch 0 has landed and **regenerated it once,
deliberately**; no agent of this program regenerates it again, and none runs `npm run build-bundle`.

Shared and edited by this program, in order of contention:
`apps/server/test/weapon-mastery.test.ts` (all seven units, §6) ·
`apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` (U38 only) ·
`apps/client/src/homebrew/vocabularies.test.ts` (U38 only) ·
`apps/server/src/equipment-derivation.ts` (M0, U35a) ·
`apps/server/src/action-resolution.ts` (M0, U36, U35b, and the two hook call sites).

---

## 10. What I measured that contradicts the governing plan or its sources

Each of these is a claim I checked rather than carried, and each changes what an implementing agent
does.

1. **U35 is two units, not one, and one of them is not a mastery.** There is still no Light-property
   extra attack anywhere in the codebase — nick has nothing to move (§4.6). The SRD
   `two-weapon-fighting` fighting style (`packages/content-srd-5.2.1/bundles/feats.v1.json:302`) is
   inert for the same reason: re-grepped at `36b5a1f`, its id appears in no production module, only in
   `packages/content-srd-5.2.1/test/character-content.test.ts` (`:412`, `:655`) enumerating the
   fighting-style category. **This is a scope expansion and the ruling is still OWED.**
2. **U37's fog requirement is stale.** [`area-2-plan.md`](area-2-plan.md) requires push to route
   through `apps/server/src/fog.ts` recomputation. That file reads no token anywhere — one docblock
   mention at `:13`, no code path — and its only production importer is the GM's three paint commands.
   There is nothing to route through (§4.3).
3. **U37 is M, not S** (§7.2).
4. **`IMPLEMENTED_MASTERIES` is three edit points, not one** — and M0 removes the production one while
   the test's own third assertion (`apps/server/test/weapon-mastery.test.ts:284`) makes the remaining
   two safe to merge (§6).
5. **U36's fix costs no new gate, but it costs TWO guard relaxations.** Routing the second target
   through `targetIds[1]` reuses `canPlayerTarget`'s only call site, and the tempting alternative (a
   dedicated field) is what creates the ungated path (§7.1). The correction found on re-measurement:
   `apps/server/src/action-resolution.ts` has **two** one-target gates, `:678` (throws) and `:811`
   (opens the attack-roll block, `:811-905`). Relaxing only the loud one accepts the resolve and then
   produces no attack roll, no damage and no mastery branch at all — a built-but-unwired swing that
   reviews as working (§4.2).
6. **`properties` had to land on four shapes**, not on "the weapon schema", or U35 stayed blocked
   behind a green build. Batch 0 landed all four; re-verified at `36b5a1f` by re-running this plan's own
   acceptance (§2.2).
7. **U18 as scoped may not be enough for `slow`.** `effectiveSpeedFeet`
   (`apps/server/src/condition-rules.ts:44-50`) reads no effect modifiers at all, so U18 must ship the
   *read* as well as the modifier (§2.3).
8. **Four stale citations in [`area-2-plan.md`](area-2-plan.md)'s Wave 6 and its invariants table**,
   all still substantively right and all pointing at the wrong lines. The corrected four, each
   re-opened at `36b5a1f` and all four still exact: U38's control is at
   `apps/client/src/homebrew/schemas.ts:756-771` (fields `:764-769`), not `:739-746`;
   `masteryByActionId` is at `apps/server/src/equipment-derivation.ts:644-656`, not `:638-649`; U22's
   `sourceActorId` strip is at `apps/server/src/projections.ts:138-139`, not `:247`;
   `EffectModifierSchema` has **12** members (`packages/schemas/src/index.ts:232-255`), not ten.
9. **`CLAUDE.md` says "all 92 live documents"; measured, it is 109.** `git ls-files '*.md' | grep -vc
   '^docs/archive/'` → 109 at `36b5a1f` (it read 105 when this plan was written; the four program plans
   and their scripts are the difference). Nothing tests that number — `docs-support.ts`'s
   `liveMarkdownFloor` is a floor of **80**, not an equality (`apps/server/test/docs-support.ts:131`,
   asserted at `docs-paths.test.ts:83-89`) — so the claim is stale and untested. The same stale 92
   appears a second time, in the comment at `apps/server/test/docs-paths.test.ts:75`. Out of this
   program's scope; flagged for whoever owns `CLAUDE.md` next, both sites in one edit.

---

## 11. The workflow script

[`workflows/mastery-program.js`](workflows/mastery-program.js) drives this plan: batch 0 verification,
the M0 seam, the M-β fan-out with a dedicated agent each for U36 and U37, the blocked pair, and U38's
gate. It is a plan artifact, not a thing to run unattended — read it before executing it.
