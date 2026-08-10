# The engine-and-vocabulary program — U17 through U33

**Written 2026-08-10 by PLANNER-ENGINE against HEAD `6278e5a`; re-verified 2026-08-10 against HEAD
`36b5a1f` on `claude/feature-impl-program-exec-ekmevw`** (PR #55 merged; batch 0 landed the weapons
ETL home, `properties` on all four shapes, and the catalog-picker fix). Every `file:line` below was
re-opened at `36b5a1f`; the ones that had moved are corrected in place.

This plan governs **U17–U33 only**. It obeys
[`remaining-program-plan.md`](remaining-program-plan.md), which is the governing document for the
whole remaining program; where this plan and that one disagree, the disagreement is **named in §9
with the measurement that produced it**. [`area-2-plan.md`](area-2-plan.md) Waves 3–5 carry these
units' original arguments and are worth reading for the reasoning; its ordering, sizing and 58 of its
citations are superseded. [`vocabulary-parity-audit.md`](vocabulary-parity-audit.md) remains the
per-row evidence and is being regenerated from the parity guard by the API program — depend on that,
do not hand-edit it.

**Every count and every `file:line` below was re-measured at HEAD.** Where a number contradicts an
earlier document the contradiction is stated rather than quietly corrected. Sizes: **S** ≈ half a day
· **M** ≈ 1 day · **L** ≈ 1.5–2 days · **XL** ≈ 3 days.

> **The carriers named below are PLANNER-CONTENT's, reserved with SRD text, count and module line.**
> Cite them; do not author your own and do not re-derive them. **Author the carrier in the unit's own
> commit, never earlier** — a rider authored before its reader ships is an inert rider, which is the
> failure this whole program exists to close. Item-side carriers come from the content program's
> **C7** lanes, which give `equipment.v1.json`'s rider blocks their **first SRD authors ever** —
> re-counted at HEAD across all 132 records: `modifiers` 0, `effects` 0, `actions` 0, `casts` 0,
> `grants` 0, `grantsFeatIds` 0, `uses` 0. Re-verified at HEAD: `fighter.studied-attacks`,
> `ranger.precise-hunter` and `evoker.empowered-evocation` carry **no** rider keys, so U22's, U23's
> and U30's overlay adds are clean; `bard.magical-secrets` and `evoker.evocation-savant` each carry a
> `choice`, and both are overlay collisions.

---

## 1. What re-measurement changed

Seventeen rows came in. Nineteen go out, in a different shape.

| change | what | why |
| --- | --- | --- |
| **new unit `E0`** | the effect-side rider gate | a measured live bug that makes U22, U27 and U29 vacuous before they start |
| **U21 splits** | `U21a` control · `U21b` reader | the 126 authors and the missing reader are two different mechanisms |
| **U23 + U30 merge** | one unit | one SRD record; and U30 needs a reader, not only content |
| **U31 re-scoped** | L → **S** | its reader shipped; the governing plan's premise is false at HEAD |
| **U33 re-scoped** | copy sweep → a mechanism | there is no way to label an OPTION today; `SelectOption` has no `note` |
| **U18 grows** | schema + control → **schema + control + the READ** | `effectiveSpeedFeet` never touches `actor.effects[].modifiers`; without the sweep the row is inert and mastery `slow` cannot ship |
| **U17 unblocked** | schedulable | **D-ENGINE-1 was ruled** on 2026-08-10 (`decision-log.md:59`–`:61`), option 1 — see §7 |
| **new prep `R2`** | split `RiderEditor.tsx` | 8 of 19 units need a control in one 1365-line file (decision **D-ENGINE-2**, §7, still open) |
| **U23 grows** | S → M | the reader's `?? damage[0].type` fallback is unreachable; the schema refuses what the form seeds |
| **U27 grows** | M → L | there is no advantage machinery on the check path at all, and its one author is effect-side |
| **U29 grows** | S → M | it depends on `E0`, and `attackKinds` is built on one branch only |
| **U30 grows** | content → reader + content | nothing in the repo sets `RiderContext.spellSchool` or `.spellLevel` |

Totals after the re-baseline: **19 shippable units** (17 named U-rows, `E0`, `R2`) — **3 S · 7 M ·
6 L · 1 XL**, plus `R2` (S–M) and `U17` (L, and the last thing gating it lifted on 2026-08-10).

---

## 2. The units, re-verified at HEAD

Each row names its four parts. "ships" means I read the code that does it. New files a unit creates
are named by basename only; their home is stated in prose.

### E0 — the effect-side rider gate · **S** · *new, and it lands first*

| part | at HEAD |
| --- | --- |
| **reader** | **broken.** `apps/server/src/action-resolution.ts:545`–`:559` walks `effect.modifiers` through `toRollModes()` and **never evaluates `modifier.when`**, although `RollModeVariantSchema` spreads `riderGate` (`packages/schemas/src/index.ts:216`–`:221`) and the comment three lines above claims *"The general `roll-mode` variant carries its own `when`."* |
| **content** | n/a — this is a bug fix, not a vocabulary. |
| **control** | ships (`apps/client/src/homebrew/RiderEditor.tsx:829` mounts `whenField` nowhere inside an effect; the gate is authorable on the record's own modifiers today and on an effect's the day this lands). |
| **test** | a gated effect rider that fires on the attack it names and **not** on the one it does not. |

**Why it is first.** U29's natural carrier is Innate Sorcery — *"Advantage on the attack rolls of
Sorcerer spells you cast"* — which is an **effect**. Under the bug that rider fires on every attack,
so U29's far-end assertion would pass for the wrong reason and its value-level non-vacuity probe
would not move. Same for U22 (an effect narrowed to one foe) and U27 (Rage's Strength-check
advantage, measured below as the *only* `roll-mode: check` author in the SRD).

**The SRD author already wrote this bug down, and that is the strongest evidence E0 is real.**
`packages/content-srd-5.2.1/scripts/class-mechanics/sorcerer.ts:61`–`:73` declines to author Innate
Sorcery's advantage and names both blockers verbatim: *"An effect's modifiers are normalised through
`toRollModes`, which returns `{roll, mode}` and DROPS the `when` list, so a `roll-mode` gated on
`attack-kind-is: ["spell"]` inside an effect would be read as advantage on every attack roll the
Sorcerer makes — a dagger swing included"*, and *"`attackKindsOf` derives
melee/ranged/thrown/unarmed/reaction and nothing in the codebase ever announces `"spell"`, so the
filter fails closed."* Those are E0 and U29 exactly, written by the content lane that hit them.
**The comment moves with the fix** — leaving it in place after E0 and U29 land is a false honesty
note.

**Also measured, and it bounds the fix:** `attackRollSources` is the **only** consumer of effect-side
`roll-mode` anywhere. `apps/server/src/saving-throws.ts:52`–`:58` handles only the legacy
`save-advantage`/`save-disadvantage` variants and never calls `toRollModes`;
`apps/server/src/encounter.ts` and `apps/server/src/death-saves.ts` read no effect modifiers at all.
So an effect's `roll-mode` for `save`, `check`, `initiative`, `death-save` or `concentration` is
**inert everywhere**. E0 fixes the gate on the one live path; U27 and U32 open the others.

---

### U17 — `widensPicks` · **L** · *D-ENGINE-1 ruled 2026-08-10; schedulable*

| part | at HEAD |
| --- | --- |
| **reader** | **nothing.** The string `widensPicks` appears exactly **once** in the whole tree: the census row at `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts:3417`. |
| **content** | Bard's Magical Secrets is **mis-wired, not empty** — `packages/content-srd-5.2.1/scripts/build-class-bundle.ts:344` authors `"magical-secrets": { kind: "spell", choose: 2, fromCatalog: "bard-spells" }` inside `CONFIG.bard.choices`. `packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts:75`–`:93` declines to author it and names both blockers in writing. Second carrier, from PLANNER-CONTENT: `college-of-lore.magical-discoveries`. |
| **control** | none. |
| **test** | none. |

**Extra, measured, and not in any earlier document:** the overlay's `FeatureMechanics` type
(`packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts:77`–`:85`) is a
`Partial<Pick<FeatureInput, …>>` over ten named keys (`:78`). `widensPicks` is not among them, so
**the ruled option widens that Pick union too.** And
`apps/server/test/cleric-druid-bard-mechanics.test.ts:153`–`:154` pins the current mis-wiring (a
level-10 Bard recording two `kind: "spell"` picks under `payload.featureId: "magical-secrets"`); it
moves with the fix.

**Far-end proof.** A prepared-spell budget whose **source list grew** — the same count of prepared
spells, drawn from Bard + Cleric + Druid + Wizard from level 10 — never a budget whose capacity grew
(that is `extraPicks`, which already ships).

**Non-vacuity.** *Control:* drop the `widensPicks` field from the choice panel → the mirror file
fails at `hasControl`. *Value:* keep the control, write `addCatalogs: []` → the offer's option list is
identical to the level-9 list and the far-end assertion fails on the **list**, not the field.

**375px:** yes — a new `rows` field on the choice panel.

---

### U18 — `speed` as an **effect** modifier · **M**

**Half-shipped, and the shipped half is the trap.**

| part | at HEAD |
| --- | --- |
| **reader** | **the build-time form ships**: `type: "speed"` is variant 3 of `FeatureModifierSchema` (`packages/content-srd-5.2.1/src/character-content.ts:191`), summed at `apps/server/src/character-build.ts:563` into `speedBonus` and baked into `speedFeet` at `:1612`. **The runtime form does not exist, and it is two things missing, not one.** `EffectModifierSchema` is **12 variants** (probed at HEAD: `.options.length === 12`) and has no `speed`; **and** `effectiveSpeedFeet` (`apps/server/src/condition-rules.ts:44`–`:49`) reads `actor.speedFeet`, exhaustion, `SPEED_ZERO_CONDITIONS` and the `dashing` **tag**, and **never touches `actor.effects[].modifiers`** at all. |
| **content** | **3 SRD authors, measured** — `classes.v1.json` ×2 (`amount: 10`), `species.v1.json` ×1 (`amount: 5`). All three are the build-time form. The runtime form needs its own carrier from the content program. |
| **control** | goes in `EFFECT_MODIFIER_TYPES` / `effectModifiersField` (`RiderEditor.tsx:813`, `:829`) — **not** in `modifiersField`, which already carries `speed` at `:293` with its own ±30/60 amount row at `:408`. |
| **test** | both paths end at a movement budget that **changes when the effect is applied and reverts when it ends**. |

**The correction the governing plan already ruled, confirmed:** U6 (`381567d`) built
`effectModifiersField` as a **separate** field over its own 4-entry list precisely because
`FeatureModifierSchema` is **21 variants** and `EffectModifierSchema` is **12** (both probed at HEAD),
overlapping by exactly three (`AttackBonusVariantSchema`, `ExtraDamageVariantSchema`,
`RollModeVariantSchema`, declared once in `packages/schemas/src/index.ts` and spread into both).
Mounting `modifiersField` inside an effect offers eighteen variants an effect cannot hold.

**New measurement, not in any earlier document.** `EquipmentDerivation.speed`
(`apps/server/src/equipment-derivation.ts:678`, `sumRiders(standing, "speed")`) is consumed by
**nothing in production** — the only two references in the whole tree are
`apps/server/test/feat-riders.test.ts:408` and `apps/server/test/feature-riders.test.ts:547`, each
asserting it is `0`. So **Boots of Striding are as dead as the effect path.** U18 may close both;
if it closes only the effect path, it must say so and leave the item path labelled.

> **The schema member and the control are NOT enough — U18 must ship the READ.** Confirmed
> independently by PLANNER-MASTERY at HEAD. Adding `{type: "speed", amount}` to
> `EffectModifierSchema` and a row to `effectModifiersField` produces exactly the shape this whole
> program exists to close: authored, validated, stored, projected, and read by nothing.
> **The sweep inside `effectiveSpeedFeet` over `actor.effects[].modifiers` is part of U18**, and its
> far end is therefore *a movement budget that changes when an effect is applied and **reverts when it
> ends*** — not merely "a movement budget that changed", which the existing build-time feature path
> already satisfies.
>
> **`slow` is a hard consumer with no honest degraded form.** The mastery program's `slow` unit
> (7 weapons) needs "−10 Speed until the attacker's next turn"; writing `actor.speedFeet` directly is
> destructive (the base is the sheet's, and an effect that ends must restore it), so there is nothing
> for `slow` to fall back on. If U18 ships without the sweep, `slow` cannot ship at all.

**Architectural constraint the agent must respect.** `condition-rules.ts` opens with *"kept
dependency-free so any engine module can import it without cycles."* It may read `actor.effects`
(the effects are on the actor) but must **not** import `deriveEquipment`. So the effect half lands in
`condition-rules.ts`; an item half needs a different home, above the leaf.

**Order of operations inside `effectiveSpeedFeet`, so `slow` and Dash compose the way the SRD reads:**
base − 5×exhaustion → **+ the summed effect modifiers** → floor at 0 → Speed-0 conditions → ×2 while
Dashing. Pin that order in the test; a Dashing, slowed creature is the case that distinguishes it.
**Note the shape you are editing:** at HEAD the Speed-0 conditions are an *early return* at `:46`,
ahead of the exhaustion maths at `:47` — the sweep has to restructure that, not just insert a line.

**Far-end proof.** `apps/server/src/movement-rules.ts:76` refuses with *"…has N ft of movement left
(this move needs M ft)"*. Assert the **number in that message** moves with the effect and returns
when it ends. *"The value survived derivation" is not a test.*

**Non-vacuity.** *Control:* filter the `speed` entry out of `EFFECT_MODIFIER_TYPES` → the mirror file
fails at `hasControl("equipment", "type", ["effects", "modifiers"])`. *Value:* keep the control and
write `amount: 0` → the refusal message quotes the unchanged budget and the far-end assertion fails
on the **feet**, not the field.

**Unblocks:** mastery `slow` (7 weapons), whose deferral reason is written down verbatim at
`apps/server/src/equipment-derivation.ts:240` — *"the effect vocabulary has no speed modifier."*
**U18 is on the mastery program's critical path; it must not slip past batch E4.**

**375px:** yes — one number row inside a nested `rows` editor.

---

### U19 — the pool binding (`3b`(b)) · **L** · *touches a projection*

| part | at HEAD |
| --- | --- |
| **reader** | **ships.** `actionPools()` (`apps/server/src/effective-actions.ts:150`) keys on `uses.pool ?? action.id` — exactly the `actionUses` key the engine spends and re-arms — and `apps/server/src/projections.ts:311` emits `pools` under `resourcesVisible`. |
| **content** | **40 SRD authors, measured** — `classes.v1.json` 17, `species.v1.json` 17, `subclasses.v1.json` 6, `equipment.v1.json` **0**. |
| **control** | **missing, in three places.** `uses.pool` on a record (`RiderEditor.tsx:610`) and on an action (`:721`) are plain text; `resource-bonus.poolId` (`:434`) is `slugValidate` text with the placeholder `lay-on-hands`. A GM types `channel-divinity` from memory with no list and no validation. |
| **test** | both paths end at **a spend against the named pool**, and at a second action sharing that pool seeing the counter move. |

**The projection change is real, and here is why — measured.** `SchemaContext`
(`apps/client/src/homebrew/useSchemaContext.ts`) has no `pools` entry, and `ContentFeatureSummary`
(`packages/domain/src/index.ts:846`) carries `tags`, `choice`, `choices` and `grantedAtLevels` but
**no `uses` and no pool id**. So pool ids do not cross the wire in the content catalog at all. The
shipped `pools` field is the *actor's* live pools in a running game; the editor holds no actor.

**Viewer-safety argument, and it is favourable.** The three catalogs that carry class/subclass/species
features — `contentClasses`, `contentSubclasses`, `contentSpecies`
(`apps/server/src/game-operations.ts:373`, `:378`, `:383`) — are deliberately player-readable *and*
every one is already scoped through `catalogFor(principal)`
(`apps/server/src/game-operations.ts:230`) → `ContentLibrary.forAudience`
(`apps/server/src/content-library.ts:129`), which builds each audience's view from
`publishedFor(audience)`. **A pool id added to `ContentFeatureSummary` is audience-scoped by
construction, so a GM's unpublished draft pool cannot reach a player.** That is the argument the audit
must confirm, not assume. Prefer a `pool?: string` on the feature summary over a new top-level list:
it inherits the existing gate rather than needing a second one.

**Do not add a refusal.** An unmatched pool degrades to a private counter, which is already the
runtime behaviour, and a GM handing a paladin's item to a fighter is a normal table event.

**Far-end proof.** Two actions sharing `channel-divinity`, both authored through the picker: spend
one, and the *other* action's remaining count drops. Plus the same body authored from the SRD side.

**Non-vacuity.** *Control:* remove `pick`/`suggestions` from `uses.pool` → the mirror file fails at
the suggestion list. *Value:* keep the picker and write a pool id one character wrong → the second
action's counter does **not** move, and the far-end assertion fails on the **count**.

**Serialization it touches:** `apps/client/src/homebrew/vocabularies.test.ts:190` pins
`picks.length === 11`; three new pickers take it to 14 (or 13 if the two `uses.pool` sites are one
factory — measure before writing the number).

**375px:** yes — three combobox pickers, two inside nested `rows` editors.

---

### U20 — the weapon-swing override · **XL**

| part | at HEAD |
| --- | --- |
| **reader** | **nothing.** `weaponAction` (`apps/server/src/equipment-derivation.ts:994`–`:1016`) builds `damage: [{ formula: <weapon die ± ability>, type: weapon.damageType }]` with no rider pass; `weaponAbilityModifier` (`:984`–`:992`) is `finesse ? max(str,dex) : ranged ? dex : str` with no rider pass. |
| **content** | Monk's `martial-arts` column. The builder already reads it at `apps/server/src/character-build.ts:503` — but **only** to mint the **Unarmed Strike** (`martialArtsStrike`, `:502`–`:514`). A quarterstaff never sees it. |
| **control** | a new variant in `modifiersField`, scoped by `weapon-property-is` / category, carrying `die?` and `ability?`. |
| **test** | both paths end at **a quarterstaff swing that rolls the Monk die off Dexterity**. |

**The bug is already written down**, measured, at `docs/ai-ledger/known-bugs.md:247`–`:254`:
*"Measured on a real generated Monk 5 (DEX 15 / STR 12): `Quarterstaff +4 (1d6+1)` — Strength, and the
printed 1d8 nowhere."* U20 retires that clause.

**The constraint that makes it XL.** A swing is derived at **read** time by `deriveEquipment`, which
holds no class table — that is exactly why the known-bugs entry says *"Wants the die on the
definition (or the class row reachable from the derivation), **not** a hard-coded 'if monk' in
`weaponAbilityModifier`."* Treat that sentence as binding.

**Far-end proof.** The rolled damage expression on the sheet's quarterstaff row changes from
`1d6 + 1` to `1d8 + 2` for the same character, and the to-hit moves with it.

**Non-vacuity.** *Control:* remove the variant from `MODIFIER_TYPES` → the mirror file fails at
`hasControl`. *Value:* keep the control, author `die: "1d6"` (the weapon's own die) → the printed
formula is unchanged and the far-end assertion fails on the **dice**, not the field.

**375px:** yes.

---

### U21a — the `multiattack` control · **M** · *reader already ships*

| part | at HEAD |
| --- | --- |
| **reader** | **ships.** `evaluateActionEconomy` (`apps/server/src/action-resolution.ts:211`) opens a component instance from `action.multiattack` via `componentMap` / `multiattackParents`, decrements it per component resolve, and names the leftovers in its refusal — all of it in the `activation === "action"` branch at `:257`–`:301`. |
| **content** | **126 SRD authors, measured** (`monsters.v1.json`). |
| **control** | **none, deliberately** — `apps/client/src/homebrew/schemas.ts:866`–`:868` says the monster-only keys are withheld because *"a form that produced them without a composer constrained to sibling action ids would author references that resolve to nothing."* U21a builds that composer. |
| **test** | both paths end at **a second component swing refused after the plan is spent**, naming the leftovers. |

This is the census row at `vocabulary-parity.mirror.test.ts:3416`, and it is a control-only unit
with 126 SRD authors and a live reader — the shape the old plan claimed the whole of U21 had.

**Far-end proof.** Resolve two of the three declared claws, then the fourth → the refusal reads
*"…has no Claw left in this action - remaining: 1× Bite."* **That dash is a plain hyphen in the
template** (`action-resolution.ts:295`); an assertion written with an em dash fails for the wrong
reason.

**Non-vacuity.** *Control:* filter the composer out of the actions field → the mirror file fails at
`hasControl("monster", "multiattack", ["actions"])`. *Value:* keep the composer and point one
component at a sibling id that does not exist → the plan opens with the wrong count and the refusal
text is wrong; assert on the **message**.

**375px:** yes — a composer over sibling action ids.

---

### U21b — the bonus-action component pool · **M** · *re-baselined from "126 authors" to zero*

| part | at HEAD |
| --- | --- |
| **reader** | **missing.** `apps/server/src/action-resolution.ts:254`–`:257` — the bonus-action branch checks `turn.bonusActionUsed`, sets `markBonus = true`, and does nothing else. Every component-pool line lives in the `action` branch below it (`:257`–`:301`). |
| **content** | **zero authors today, and one record whose prose demands it.** Measured: **all 126** `multiattack` authors carry `activation: "action"`; **no** SRD record anywhere authors a bonus action with a `multiattack` or an `attack.count > 1` (76 bonus actions in `monsters.v1.json`, 11 in `classes.v1.json`, 5 each in `species`/`subclasses` — none with components). Flurry of Blows (`classes.v1.json`, `id: "flurry-of-blows"`) says *"make two Unarmed Strikes as a Bonus Action"* **in prose only**. It must be **authored** by the content program. |
| **control** | inherited from U21a. |
| **test** | both paths end at **two swings handed out on a bonus action**, and a third refused. |

**This is the re-baseline the governing plan asked for, sharpened by measurement.** The plan said
"126 authors → 1 that can exercise the reader". The true count is **0 authors** and **1 record to
author**. The 126 belong to U21a.

**Role-boundary invariant.** The economy is what refuses a player's off-turn action. Widening it must
not widen *who* may act: the `onOwnTurn` guard stays.

**Its known-bugs entry, verbatim** (`docs/ai-ledger/known-bugs.md:255`–`:260`): *"Declaring
`multiattack` on a bonus action would look wired and hand out nothing, which is worse than the
prose."* U21b retires it.

**Far-end proof.** A Monk spends a Focus Point, resolves two Unarmed Strikes on the bonus action, and
the third is refused by name.

**Non-vacuity.** *Control:* n/a (U21a owns it) — substitute a **content** probe: remove the authored
`multiattack` from Flurry of Blows → the second swing is refused. *Value:* keep the authoring and set
the component count to 1 → the second swing is refused; assert on the **swing count**.

**Unblocks:** mastery `nick`, whose deferral reason is at `equipment-derivation.ts:243`.

**375px:** no new UI.

---

### U22 — target-scoped effects · **L** · **viewer-safety change, dedicated agent, audit before merge**

| part | at HEAD |
| --- | --- |
| **reader** | **nothing.** The advantage collector is `attackRollSources` (`apps/server/src/action-resolution.ts:533`); it narrows by nothing target-specific. |
| **content** | **nothing exists to author it.** `EffectInstanceSchema` (`packages/schemas/src/index.ts:288`–`:317`) carries `sourceActorId` and no "against actor X" field; the `versus-*` triggers narrow by **size**, **condition** and **creature type** only (`packages/rules-5e/src/riders.ts:208`–`:213`). There is nowhere to hang "against this one foe." **The carrier is NOT an item** — PLANNER-CONTENT measured **0 of 258** SRD magic items authoring the shape. Use fighter `studied-attacks`, whose printed text is the shape exactly: *"If you make an attack roll against a creature and miss, you have Advantage on your next attack roll against that creature."* Seconds: ranger `precise-hunter`, barbarian Staggering Blow. |
| **control** | one row in `effectModifiersField`. |
| **test** | both paths end at **an advantage that applies against one named foe and not another**. |

> **The two leak mechanisms, both measured, and both are opt-out rather than opt-in.**
>
> 1. **Type level.** `PlayerEffect = Omit<EffectInstance, "sourceActorId" | "sourceActionId">`
>    (`packages/domain/src/index.ts:643`). A new field on `EffectInstanceSchema` joins the player type
>    automatically. **`tsc` will not say a word.**
> 2. **Runtime.** `playerEffect()` (`apps/server/src/projections.ts:137`–`:140`) is
>    `const { sourceActorId, sourceActionId: _, ...visible } = effect; return { ...visible, … }`.
>    A new field rides the spread to every player.
>
> **The precedent for the required treatment is in the same four lines.** `sourceName` is already
> masked to `"A hidden threat"` when `!publicActorIds.has(sourceActorId)`. An **id cannot be masked**
> — masking it would still confirm the secret exists — so the target id must be **omitted** from the
> player projection, and `PlayerEffect`'s `Omit` list must name it. When in doubt, omit it.

**Depends on E0.** Without the gate fix, a target-scoped rider on an effect fires against everyone
and the far end moves for the wrong reason.

**One carrier caveat, measured, and the U22 agent must know it before opening the overlay.** Fighter
is one of the three `HAND_AUTHORED` classes (`packages/content-srd-5.2.1/scripts/build-class-bundle.ts:33`
= fighter, wizard, cleric), so for `studied-attacks` the ETL writes the merged record **back over its
own input** — an overwrite there is un-revertable and unreviewable, which is why `applyMechanics`
fails the build rather than picking a winner. Re-verified at HEAD: `fighter.studied-attacks` carries
**no** rider key at all (none of `tags`/`actions`/`effects`/`modifiers`/`grants`/`uses`/`extraPicks`/
`replaces`/`choice`/`choices`), so this add is a clean insert. Confirm that is still true before
writing; if it has grown a key by then, move to `ranger.precise-hunter` (also re-verified rider-free,
and Ranger is generated). The client ruled the general collision on 2026-08-10 — a `clears` verb on
`FeatureMechanics`, idempotent, a build error unless the same feature re-authors the key
(`decision-log.md:56`–`:58`) — but that verb is **not in `overlay.ts` yet** (grep: zero hits), and it
belongs to the content program. Do not build it here; pick a rider-free carrier instead.

**Far-end proof.** Two foes, one effect: the attack against the named foe rolls `2d20kh1`; the attack
against the other rolls `1d20`. Both in the same test, one after the other.

**Non-vacuity.** *Control:* filter the row out of `effectModifiersField` → the mirror file fails at
`hasControl`. *Value:* keep the control and write the **other** foe's id → the advantage lands on the
wrong attack and the far-end assertion fails on the **die**, not the field.

**Viewer-safety audit before merge (blocking):** the player projection for a table holding a
`gm-only` monster must contain that monster's id **zero times**; assert on the serialized payload,
not on a field name.

**Unblocks:** mastery `vex`, whose deferral reason is at `equipment-derivation.ts:245`–`:246`.

**375px:** yes.

---

### U23 + U30 — "same type as the triggering damage", and the spell filters · **merged, L**

**They share one SRD record (Evoker's Empowered Evocation) and neither can land alone.** The old plan
put them two waves apart.

#### U23's half — and it is bigger than "an option beside the picker"

| part | at HEAD |
| --- | --- |
| **reader** | `apps/server/src/action-resolution.ts:983` already reads `rider.modifier.damageType ?? damage[0]?.type ?? "untyped"`. **That `??` is unreachable.** |
| **content** | **7 `extra-damage` authors, measured** (`classes.v1.json` 2, `subclasses.v1.json` 5). None can say "same type". Carriers: **Vicious Weapon** (item, from C7) and **Empowered Evocation**. |
| **control** | ships as a `pick` combobox at `RiderEditor.tsx:428`. |
| **test** | both paths end at **a rider whose damage type matches the weapon's**, and a second weapon of a different type proving it followed. |

> **Measured contradiction — this is a live defect, not a design note, and it is now logged**
> (`docs/ai-ledger/known-bugs.md:30`–`:35`, owner "engine program U23+U30 (merged)").
> `ExtraDamageVariantSchema.damageType` is `DamageTypeIdSchema` — `z.string().min(1).max(40)`,
> declared at `packages/schemas/src/index.ts:7` — and it is **required**
> (`packages/schemas/src/index.ts:205`). Probed at HEAD through the real schema:
> `{type:"extra-damage", formula:"1d6", damageType:""}` → `String must contain at least 1
> character(s)`; with the key absent → `Required`.
> Meanwhile `RiderEditor.tsx:422`–`:427` documents the empty box as *"a real authored answer here and
> not a blank … an absent type means 'the same type this weapon already deals'"*, and
> `blankModifier("extra-damage")` (`:320`) seeds exactly `damageType: ""`.
> **Consequence:** every extra-damage row the editor mints is unpublishable until the GM types a
> type, `apps/client/src/homebrew/validate.ts` has **no** message for it (grep at HEAD: only the
> spell message at `:421` and the weapon one at `:449`–`:450` exist), and what the GM meets is a raw
> server Zod refusal — the exact *"a form that produces a record the store rejects"* failure the
> editor exists to avoid.
> So U23 is a **schema** change (optional `damageType`, or an explicit sentinel) plus the control,
> plus the validate message, plus the content. **M, not S.**

#### U30's half — reader **and** content, not content

| part | at HEAD |
| --- | --- |
| **reader** | **missing.** `RiderContext.spellSchool` and `.spellLevel` (`packages/rules-5e/src/riders.ts:142`–`:143`) are evaluated by `passes` (`:203`, `:205`) and **set by nothing**. Grep across `apps/server/src`, `packages/rules-5e/src` and `packages/domain/src` at HEAD finds only the two declarations and the two reads. `riderFilters` (`apps/server/src/action-resolution.ts:810`) sets `sourceItemId`, `damageTypes` and `spellId` — never school or level. **Both filters fail closed 100% of the time.** |
| **content** | **0 authors, measured** (`spell-school-is` and `spell-level-is` appear zero times in every bundle). Carrier: **Empowered Evocation — the same record U23 uses.** That is the shared record, confirmed by PLANNER-CONTENT, and it is why these two are merged. |
| **control** | ships (`RiderEditor.tsx:255` schools; `:256` levels, with its own number `read`/`write`). |
| **test** | both paths end at **a school-gated rider that fires on an Evocation and not on an Abjuration**. |

`action-resolution.ts:800` already builds `spellFilter` from `action.spellId` and both branches of
`riderFilters` (`:810`, `:821`) spread it; the school and level are one catalog lookup from there.

**Do NOT scope U30 onto `evoker.evocation-savant`.** Re-verified at HEAD: it already carries a
`choice`, so it is a **second overlay collision** of the same shape as U17's. The client ruled that
collision on 2026-08-10 — adopt a `clears` verb on `FeatureMechanics` (`decision-log.md:56`–`:58`) —
but the verb is **not implemented** (grep in `overlay.ts` at HEAD: zero hits) and building it is the
content program's, not this unit's. `empowered-evocation` carries no rider key at all, so scoping
both halves onto it is clean and waits for nothing. If a second carrier is genuinely wanted, take it
from C7's item lanes instead.

**Far-end proof (both halves, one body).** Empowered Evocation adds the Wizard's Intelligence modifier
to an Evocation's damage, **typed as whatever that spell deals** — Fire for Fireball, Lightning for
Lightning Bolt — and adds nothing to an Abjuration.

**Non-vacuity.** *Control:* filter the "same type" option out → the mirror file fails at the option
list. *Value:* keep it and pin the type to `"fire"` → Lightning Bolt's rider lands as Fire and the
far-end assertion fails on the **type**. Second pair for U30: drop `schools` from the authored gate →
the rider fires on the Abjuration too; assert on the **damage total** of the Abjuration.

**Serialization it may touch:** `vocabularies.test.ts`'s ordered damage-type census (`:80`–`:90`) and
`picks.length` (`:190`) if the "same type" option changes the `damageType` field's shape.

**375px:** yes.

---

### U24 — the item's own `uses` block · **M**

| part | at HEAD |
| --- | --- |
| **reader** | **missing, and precisely.** `usesOf` (`apps/server/src/equipment-derivation.ts:828`) has exactly two call sites — an action's own uses (`:898`) and a cast's own uses (`:935`). The carrier loop over `active` (`:607`–`:632`) reads `modifiers`, `grants`, `effects`, `actions`, `casts` and `grantsFeatIds` and **never `record.uses`**. `weaponAction` (`:994`–`:1016`) builds its `ActorAction` with **no `uses` key at all**. |
| **content** | 0 — the client's mace, 1/short rest. |
| **control** | ships. |
| **test** | four far ends — a rolled number, a spent counter, a refusal naming `1/short rest`, and a re-arm on a short rest. |

**Cheaper than the old plan sized it, and the reason is still true at HEAD:** the carrier loop
destructures the catalog record at `:608` (`const { item, record } = entry;`) and the separate weapon
loop over `equipped` re-fetches it at `:650` (`catalog.equipmentRecord(entry.item.id)`, for the
weapon's mastery). Either way the record the fix needs is already in hand at the call site.

**Watch:** `rests.ts` and `encounter.ts` iterate `effectiveActions`, so a new `uses` re-arms for free
— but a `per: "recharge"` value now newly reaches the recharge roll.

**Non-vacuity.** *Control:* n/a (it ships) — substitute a **content** probe: remove `uses` from the
authored mace → no refusal, and the counter never appears. *Value:* keep the block and set
`limit: 99` → the refusal never fires; assert on the **message**, not the field.

**375px:** no new UI.

---

### U25 — the extra damage resolves and never renders · **L** · **fixes an inventory-row leak, dedicated agent, audit before merge**

| part | at HEAD |
| --- | --- |
| **reader** | three hops, all re-confirmed. (1) `withStandingRiders` (`apps/server/src/effective-actions.ts:44`–`:73`) folds `attack-bonus`, `critical-bonus-dice`, `spell-save-dc`, the uses bonus and extra attacks — and correctly **not** `extra-damage`, which `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts:300`) calls `"at-its-moment"`. So `srv.damage` is base-only. (2) `apps/client/src/encounter/CharacterSheet.tsx:805` rolls `rollFlat(part.formula)` with no riders, and `structuredAttacks` (`:228`) is false unless a fight is live **and** it is that player's turn. (3) `addFromCatalog` (`:548`). |
| **content** | 0 — the client's mace, +1d6 lightning. |
| **control** | ships. |
| **test** | the sheet shows both damage lines **before** the roll, and one resolution produces both bludgeoning and `{1d6, lightning, total}`. |

> **The leak, measured, and the prohibition is in the schema's own words.**
> `InventoryItemSchema` (`packages/schemas/src/index.ts:371`–`:385`) is `.strict()`, and its `magic`
> field reads *"Display-only marker so the sheet can offer Attune without the catalog; **NEVER the
> riders**."*
> `apps/server/src/projections.ts:317` ships `inventory: inventory.map((item) => ({ ...item }))` — a
> **whole-row shallow spread** under `resourcesVisible`. So anything added to the inventory row
> reaches every party member at the `sheet-and-resources` tier, and a GM's homebrew rider text
> becomes party-readable.
> **`extraDamage` must ride the DERIVED action, never the stored `InventoryItem`.** Fixing that is
> part of this unit, per the client's ruling.

**Do not fold it into `action.damage`** — that double-rolls. Expose
`extraDamage: readonly { formula, type, when }[]` through the derivation and render it beside the base
part, marked conditional. When `srv` exists, route the damage chip through the server.

**Far-end proof.** One resolution produces two typed entries with two totals, and the sheet prints two
lines **before** the roll for a freshly added, not-yet-equipped item.

**Non-vacuity.** *Control:* n/a — **content** probe: remove the `extra-damage` rider → one line, one
entry. *Value:* keep the rider and set `formula: "0d6"`-equivalent (or drop the type) → the second
entry's **total** is wrong; assert on the number.

**Viewer-safety audit before merge (blocking):** serialize a player projection for a character whose
inventory holds a rider-bearing homebrew item and assert the payload contains **no** rider text and
**no** `extraDamage` key on any inventory row.

**No ledger correction is owed any more.** An earlier draft asked U25 to hand the parent a fix for
*"Every field the item editor offers reaches the fight"* in `current-state.md`. That sentence was
deleted by `1263e34` and **does not exist at HEAD** (grep: zero hits in the file). The surviving D21
paragraph (`docs/ai-ledger/current-state.md:57`) claims only that the vocabulary is under a guard,
which is true. Leave it alone.

**375px:** yes — a second damage line on the sheet's weapon row.

---

### U26 — `spell-attack-bonus` · **M**

| part | at HEAD |
| --- | --- |
| **reader** | **missing, and the repo says so in writing.** Collected into `derivation.spellAttackBonus` at `apps/server/src/equipment-derivation.ts:682`; grep at HEAD finds **no consumer** (the only other `spellAttackBonus` hits are the unrelated pure function in `packages/rules-5e/src/character.ts:55`). `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts:302`) reads `"unread"` with the comment *"reaches derivation.spellAttackBonus; no spell-attack path reads it yet."* Its sibling `spell-save-dc` **is** folded — summed at `apps/server/src/effective-actions.ts:51` and applied to `action.save.dc` at `:70`. |
| **content** | **0 authors, measured.** Carriers: **5 items from C7** (a Wand of the War Mage is literally this rider and nothing else). |
| **control** | ships (`RiderEditor.tsx:290` type, `:407` amount, `:432` `classId`). |
| **test** | both paths end at **a spell attack roll that moved**. |

**Coupling that decides its schedule:** folding this needs *"is this action a spell attack"*, which is
exactly U29's predicate (`action.spellId !== undefined`). **Same agent, same lane, U29 first.**

**Non-vacuity.** *Control:* filter `spell-attack-bonus` out of `MODIFIER_TYPES` → the mirror file
fails at `hasControl`. *Value:* keep it and set `classId` to a class the sheet does not hold → the
bonus is not applied and the far-end assertion fails on the **to-hit**.

**375px:** no new UI (existing rows).

---

### U27 — `roll-mode: check` · **L** · *re-baselined from M*

| part | at HEAD |
| --- | --- |
| **reader** | **missing, and there is no advantage machinery on the check path at all.** The only rolled ability checks are `BUILTIN_CHECKS` (declared at `apps/server/src/action-resolution.ts:138`, run at `:736`) and `escape-grapple` (`:776`–`:791`), and both roll `resolveDice(parseDiceFormula("1d20 ± N"))` — a bare d20, no `aggregateRollMode`, no sources list. `checkRiderBonus` (`apps/server/src/equipment-derivation.ts:778`) collects at `on-ability-check` and sums **only** `check-bonus`; it feeds the sheet's display rows (`apps/server/src/actor-derived.ts:65`, `:91`, `:94`), not a roll. |
| **content** | **exactly 1 author, measured — and it is effect-side.** Barbarian's Rage, at bundle path `features(barbarian) → actions(rage) → grants(rage) → modifiers[1]`: `{type:"roll-mode", roll:"check", mode:"advantage", when:[{on-ability-check},{ability-is:["str"]}]}`. Re-read out of `classes.v1.json` at HEAD, index and all. |
| **control** | ships (`ROLL_MODE_ROLLS` at `RiderEditor.tsx:358` offers `check`, at `:360`). |
| **test** | both paths end at **an ability check rolled with advantage**. |

**Depends on E0** — the one SRD author carries a `when` on an **effect**, and the effect-side
collector ignores it. It also needs effect-side `roll-mode` to be read for `check` at all, which
today it is not, anywhere (see E0's second measurement).

**Far-end proof.** A raging Barbarian's Strength check rolls `2d20kh1` and its Dexterity check rolls
`1d20`, in the same test.

**Non-vacuity.** *Control:* remove `check` from `ROLL_MODE_ROLLS` → the mirror file fails at the
option list. *Value:* keep it and change the authored `ability-is` to `dex` → the Strength check rolls
`1d20`; assert on the **formula**, not the field.

**375px:** no new UI.

---

### U28 — `unarmored-defense.allowShield`, and the shipped `armorClassFromEquipment` bug · **L**

| part | at HEAD |
| --- | --- |
| **reader** | **missing.** `allowShield` is stored at `apps/server/src/character-build.ts:572` and dropped: `:1617` reads `interpreted.unarmoredDefense.ability` and nothing else. |
| **content** | **2 authors, measured, and they are the contrast the test needs** — Barbarian `{ability:"con", allowShield:true}` and Monk `{ability:"wis", allowShield:false}`, both in `classes.v1.json`. A third, Draconic Sorcery's `draconic-resilience` `{ability:"cha"}` in `subclasses.v1.json`, takes the default. |
| **control** | ships, **with its own honesty note** — `RiderEditor.tsx:419` carries `note: "Not read yet."`. **U28 deletes that note in the same commit.** |
| **test** | both paths end at **an AC that differs with a shield**, and differs the right way for each class. |

> **The live bug this unit absorbs — measured, reproduced, and now logged**
> (`docs/ai-ledger/known-bugs.md:24`–`:28`, owner "engine program **U28**", so it is no longer
> unowned).
> `armorClassFromEquipment` (`packages/rules-5e/src/character.ts:76`–`:84`) returns `null` only when
> there is neither body armour nor a shield: `if (!equippedArmor && shieldBonus === 0) return null;`
> (`:80`). With a **shield alone** it returns `10 + dex + shield` (`:82`–`:83`).
> `apps/server/src/character-build.ts:1624` is `(equipmentAc ?? unarmoredAc ?? 10 + dexModifier)`, so
> equipment AC **short-circuits unarmoured defence entirely**.
> Reproduced at HEAD against the real function, Barbarian CON 16 / DEX 14: `armorClassFromEquipment`
> returns `null` bare-handed (so AC = the unarmoured 15) and `14` holding one shield — **AC 15 → 14.
> Picking up a shield makes the character strictly worse.** The Monk case happens to come out right,
> which is why nobody noticed.

**Far-end proof.** Four numbers in one test: Barbarian without shield, Barbarian with shield
(+2 **on top of** CON), Monk without shield, Monk with shield (unarmoured defence correctly lost).

**Non-vacuity.** *Control:* n/a — **content** probe: flip Barbarian's `allowShield` to `false` → its
shielded AC drops to the Monk's rule; assert on the **number**. *Value:* keep both authorings and
make the reader ignore `allowShield` → the Monk's shielded AC gains CON-equivalent and the far-end
assertion fails on the **AC**.

**375px:** yes — one note removal, and the AC readout must still fit.

---

### U29 — `attack-kind-is: "spell"` · **M** · *re-baselined from S*

| part | at HEAD |
| --- | --- |
| **reader** | **missing.** `attackKindsOf` (`apps/server/src/action-resolution.ts:512`–`:528`) emits `melee`, `ranged`, `thrown`, `unarmed`, `reaction`. `AttackKind` (`packages/rules-5e/src/riders.ts:20`) already declares `"spell"`. An action with a `spellId` is a spell attack. |
| **content** | **1 author of `attack-kind-is`, measured, and it is `["melee","unarmed"]`** (`classes.v1.json`). **Zero** `"spell"` authors. Carriers: **7 items from C7** — plus Innate Sorcery, which is already an authored effect and only needs the rider (see below). |
| **control** | ships (`RiderEditor.tsx:248`, the `kinds` multiselect, offers `Spell`). |
| **test** | both paths end at **a rider gated on `["spell"]` that fires on a cantrip attack and not on a weapon swing**. |

**The E0 dependency, stated precisely.** With PLANNER-CONTENT's **item** carriers it is soft, not
hard: an item's riders reach the advantage collector through `collectRiders`
(`apps/server/src/action-resolution.ts:574`–`:583`), which **does** evaluate `when`. It becomes hard
the moment any carrier is **effect**-side — Innate Sorcery (*"Advantage on the attack rolls of
Sorcerer spells you cast"*) is the obvious one, and under the E0 bug its rider would fire on the
weapon swing too, so the *"and not on a weapon swing"* half would pass for the wrong reason.
E0 is scheduled ahead of U29 in the same lane regardless: it is the same file, the same agent, and S.

**The Innate Sorcery carrier is CHEAPER than "the content program supplies it" — measured.** The
record is already authored: `class-mechanics/sorcerer.ts:75`–`:88` ships `"innate-sorcery"` with a
bonus-action, a 2/long-rest `uses` block and a ten-round `grants` effect tagged `innate-sorcery` —
and **no `modifiers` array**, because `:61`–`:73` declines to author one and names E0 and U29 as the
two reasons. So U29's content half is *one array added to a shipped overlay entry that Ranger-style
generation already merges cleanly*, plus deleting the two bullets that are no longer true. It is not
a new record and it does not wait on C7.

**A second thing to decide inside the unit, measured.** `attackKinds` is built **only** inside
`if (action.attack && targets.length === 1)` (`action-resolution.ts:811`–`:822`); the outer
`riderFilters` (`:810`) carries `sourceItemId`, `damageTypes` and `spellId` only. So
`attack-kind-is` fails closed on the standing pass and on every save-only action. U4 widened
`damageTypes` out of that branch for exactly this reason and the same argument may apply here —
**decide it in the unit, in writing, and pin whichever way you go.**

**Non-vacuity.** *Control:* remove `Spell` from the `kinds` options → the mirror file fails at the
option list. *Value:* keep it and author `["melee"]` instead → the cantrip attack loses the advantage
and the far-end assertion fails on the **die**.

**375px:** no new UI.

---

### U31 — `on-taking-damage` + `damage-reduction` · **S** · *re-scoped: the reader already ships*

> **The governing plan's premise is false at HEAD, and so is the audit's.** The plan says *"No
> incoming-damage path collects riders at all"* and the audit repeats it at
> `docs/product/vocabulary-parity-audit.md:472` and `:478`. Measured:
> `damageReductionFor` (`apps/server/src/hit-points.ts:132`–`:136`) runs **two** passes —
> `moment: null` and `moment: "on-taking-damage"` with the incoming `damageTypes` handed in — and sums
> `damage-reduction` from both. Its own header says *"This is that collector, and it is the only one
> that runs on the RECEIVING side of a hit."* `CARRIER_RIDER_DISPOSITION`
> (`apps/server/src/character-build.ts:303`) already reads `"at-its-moment"` and names the function.

| part | at HEAD |
| --- | --- |
| **reader** | **ships** (above). |
| **content** | **0 authors, measured** — `damage-reduction` and `on-taking-damage` appear zero times in every bundle. Carriers: **Gloves of Missile Snaring** and **Ring of Warmth** (items, from C7). |
| **control** | ships — `damage-reduction` in `MODIFIER_TYPES` (`RiderEditor.tsx:285`), its amount row (`:413`), `on-taking-damage` in `TRIGGER_TYPES` (`:118`). |
| **test** | both paths end at **a hit that lands for less**, with the flat step named separately in the narration. |

So U31 is **content + a both-paths test + a stale-claim sweep**, and the sweep is the second half:
the audit rows above, and `RiderEditor.tsx`'s implicit promise. **S.**

**Far-end proof.** The damage narration
(`damageAdjustmentDetail`, `hit-points.ts:109`–`:116`) appends `then -N, reduction` at `:114`,
**after** the resistance step, per total, floored at 0. Assert on that string and on the resulting HP.

**Non-vacuity.** *Control:* remove `damage-reduction` from `MODIFIER_TYPES` → the mirror file fails at
`hasControl`. *Value:* keep it and gate the rider on a damage type the hit does not deal → the
reduction does not apply and the far-end assertion fails on the **HP**.

**375px:** no new UI.

---

### U32 — `on-death-save` + `roll-mode: death-save` · **S**

| part | at HEAD |
| --- | --- |
| **reader** | **missing.** `rollDeathSave` (`apps/server/src/death-saves.ts:37`–`:64`) reads only `options.rollMode`, the caller's chosen mode; the module imports no `collectRiders` and reads no effect modifiers. |
| **content** | **0 authors, measured.** Carriers: **Periapt of Wound Closure** and the **Mysterious Deck** (items, from C7). |
| **control** | ships — `on-death-save` (`RiderEditor.tsx:117`) and `death-save` in `ROLL_MODE_ROLLS` (`:358`, the entry at `:360`). |
| **test** | both paths end at **a death save rolled `2d20kh1`**. |

One new call site closes both, and death saves are exactly where a magic item wants to help. **Shares
the aggregation shape U27 builds** — schedule after U27 or hand the helper across.

**Non-vacuity.** *Control:* remove `death-save` from `ROLL_MODE_ROLLS` → the mirror file fails at the
option list. *Value:* keep it and author `mode: "disadvantage"` → the formula is `2d20kl1`; assert on
the **formula**.

**375px:** no new UI.

---

### U33 — the labelling sweep · **M** · *split applied, and it needs a mechanism first*

**Kept:** the relabelling. **Dropped** (client ruling 11, confirmed by measurement):

- **deleting `roll-mode: concentration` from the enum** — `RollModeVariantSchema.roll`
  (`packages/schemas/src/index.ts:218`) is a closed `z.enum`. Removing a member makes every stored
  published homebrew record carrying it stop **parsing**, in every catalog, rather than erroring
  loudly. Silent data loss.
- **removing `featureRiders.tags` from the wire** — **44 authors, measured** (`classes.v1.json` 23,
  `feats.v1.json` 16, `subclasses.v1.json` 5), and it crosses as `ContentFeatureSummary.tags`
  (`packages/domain/src/index.ts:846`). A player-readable contract.

> **The mechanism U33 needs does not exist, and this is why it is M rather than S.**
> `SelectOption` (`apps/client/src/homebrew/schema.ts:47`) is
> `{ value; label; disabled?; group? }` — **no `note`**. `FieldDef.note` (`:169`) is a plain `string`,
> not a function of the row. So today there is **no way to say "this OPTION parses and does
> nothing"**, which is exactly what `roll-mode: concentration` and the `on-spell-cast` moment need.
> U33's first commit widens `SelectOption` with `note?: string` and renders it in `FieldRenderer`
> beside the option — then uses it twice.

**The four existing notes, measured** (`RiderEditor.tsx:259`, `:417`, `:419`, `:436`):

| row | ruling |
| --- | --- |
| `unarmored-defense.allowShield` — *"Not read yet."* (`:419`) | **U28 deletes it.** Not U33's. |
| `darkvision` — *"Display only."* (`:417`) | **Keep.** True: there is no senses model; the trait prose carries it. 7 authors, measured. |
| `sense` — *"Display only."* (`:436`) | **Keep.** Same reason, 1 author. Rendering it on the sheet is a sheet feature with no vocabulary of its own — name it and leave it. |
| `versus-creature-type` — *"Not checked yet…"* (`:259`) | **Keep.** Closing it means promoting creature type to a first-class `ActorDefinition` field; it lives only in the `open5e.srd-2024` extension bag. |

**Two new option-level notes:** `roll-mode: concentration` (the concentration save is minted as a
plain CON save inside `applyDamage` at `apps/server/src/hit-points.ts:282`–`:298`, `ability: "con"` at
`:297`, and no rider is collected anywhere on that path) and the `on-spell-cast` moment (no spell-cast
pipeline collects riders; `spell-id-is` fires from the action path instead).

**One FALSE claim to fix, and fixing it makes the form more useful, not less.**
`effectsField`'s tag row says *"The sheet groups effects by these"* (`RiderEditor.tsx:907`). Measured,
effect tags are a **real mechanical gate**: the `while-effect-tag` trigger
(`packages/rules-5e/src/riders.ts:182`), `requiresEffectTag` on an action
(`apps/server/src/action-resolution.ts:230`, `apps/client/src/encounter/ActionRunner.tsx:51`),
`endsWithTag` cascades (`apps/server/src/effects.ts:123`), plus `dashing`
(`apps/server/src/condition-rules.ts:48`), `disengaged` (`apps/server/src/movement-rules.ts:89`),
`grapple`, `hidden` and `readied`. The copy **understates a live mechanism**.

**One TRUE-but-thin claim.** `tagsField`'s *"Grouping only — no mechanical effect."*
(`RiderEditor.tsx:775`) is correct for record-level tags. With the wire removal dropped, the honest
repair is to say the sheet does not group by them **yet** — and to name grouping the traits list by
tag as the sheet feature that would make it true.

**Runs last** — after U26, U27, U28, U29, U30, U31 and U32 have each retired or kept their own claim.

**Non-vacuity.** *Control:* remove the `note` render from the select → a test asserting the rendered
text fails. *Value:* keep the render and blank the note string → the same assertion fails on the
**text**. A labelling unit's far end is the rendered string, which the done bar explicitly admits.

**375px:** yes — a note under an option must not push the select off-screen.

---

## 3. Dependencies

Only these are real. Everything else is file contention, handled in §5.

```
E0  ──▶ U22
    ──▶ U29 ──▶ U26          (U26 needs U29's "is this a spell attack" predicate)
    ──▶ U27 ──▶ U32          (soft: U32 reuses U27's aggregation helper)

U21a ──▶ U21b                 (U21b inherits U21a's control)

U23 ══ U30                    (merged: one SRD record, one commit)

U26, U27, U28, U29, U30, U31, U32 ──▶ U33   (each retires or keeps its own claim first)

D-ENGINE-1 ──▶ U17            (a ruling, not a unit)
D-ENGINE-2 ──▶ R2 ──▶ every unit with a control (recommended, not required)

content program C7 (item riders) ──▶ U23, U26, U29, U31, U32   (their carriers are ITEMS)
content program (class overlay)  ──▶ U17, U18, U20, U21b, U22, U30
mastery program M0               ──▶ U22       (and U29 lands before M0 relaxes :678 — see §10)
API parity guard (governing plan batch 2) ──▶ everything here
```

**One rule about all of them:** the carrier is authored **in the unit's own commit**, never earlier.
A rider authored ahead of its reader is an inert rider, and this program exists to close those.

---

## 4. Serialization points this program touches

Measured at HEAD. Each is a merge conflict or silent data loss waiting to happen.

| point | units | note |
| --- | --- | --- |
| `apps/server/src/action-resolution.ts` | **6** — E0, U21b, U22, U23+U30, U27, U29 | the tightest. Different sites, one file. |
| `apps/client/src/homebrew/RiderEditor.tsx` | **8** — U18, U19, U20, U21a, U22, U23+U30, U28, U33 | 1365 lines, and **+4 more from the API program's lane β**. See D-ENGINE-2 and §10. |
| `apps/client/src/homebrew/schemas.ts` | **2** — U21a (`:863`–`:869`), U33 (`:312`, `:326`, `:393`) | both land **inside** an API program lane's range. See §10. |
| `packages/schemas/src/index.ts` | **4** — U18 (`EffectModifierSchema`), U22 (`EffectInstanceSchema`), U23 (`ExtraDamageVariantSchema`), U25 (`ActorAction`) | regions are far apart; the rule is still one owner per batch. |
| `apps/server/src/equipment-derivation.ts` | **3** — U20, U24, U25 | |
| `packages/domain/src/index.ts` | **3** — U19, U22, U25 | wire types. |
| `apps/server/src/effective-actions.ts` | **2** — U25, U26 | |
| `apps/server/src/character-build.ts` | **2** — U28, U17 | |
| `packages/content-srd-5.2.1/scripts/class-mechanics/monk.ts` | **2** — U20, U21b | both need Monk. |
| `apps/client/src/homebrew/vocabularies.test.ts` | **2** — U19 (`picks.length`), U23+U30 (possibly the damage-type census) | exact counts **and** an ordered list. |
| `vocabulary-parity.mirror.test.ts` census array | **2** — U17, U21a | see below. |

**The census array is narrower than the brief assumed — measured.** At HEAD it holds **three**
rows (`vocabulary-parity.mirror.test.ts:3415`–`:3417`, inside the `owed` literal opened at `:3413`):
`weapon.mastery` (U38, the mastery program's), `multiattack` (U21a, `:3416`) and `widensPicks`
(U17, `:3417`). U21a's and U17's rows are **adjacent lines**, so those two units must not run in the
same batch. Nothing else in this program touches it.

> **The finding that makes concurrency possible at all.**
> `apps/client/vitest.config.ts:37`'s node project declares `include: ["src/**/*.mirror.test.ts"]` —
> a **glob**, not a file list. **Four** mirror files already exist in **four** different directories
> (`builder/server-offers.mirror.test.ts`, `homebrew/vocabulary-parity.mirror.test.ts`,
> `replay/launch-refusal.mirror.test.ts`, and `encounter/catalog-add.mirror.test.ts`, which batch 0
> added). **So every unit writes its both-paths test in its OWN `*.mirror.test.ts` file**, beside
> `authoring-harness.ts` in `apps/client/src/homebrew/`, importing the harness and the server modules
> the way the precedent does. The 3423-line `vocabulary-parity.mirror.test.ts` stops being a
> serialization point for anything except its census array and its final guard block.
> **Re-measured at HEAD** (`npx vitest run --project node`, from `apps/client`): the whole node
> project is **4 files / 202 tests, green, in 2.6 s** — which is also the fastest inner loop in this
> program.

**Parent-only, never touched by a unit agent:** `docs/api-reference.md`, `docs/app-map.md`,
`docs/ai-ledger/current-state.md` (at its 150-line ceiling), `docs/product/vocabulary-parity-audit.md`
(regenerated by the API program's parity guard).

---

## 5. The batches

**Four agents maximum, one worktree each.** Within a lane an agent works serially and may hold the
same file across its own units. **Across lanes in one batch, no two agents share a file** — the
tables below prove it by listing each lane's whole file set.

**Never symlink `node_modules` into a worktree.** POSIX resolves the symlink first, so
`<wt>/node_modules/@vtt/domain` lands on the *original* tree and every cross-package unit produces a
green run that proves nothing about its own worktree. Hard-link: `cp -al`.

### Prep — R2 (solo, serial, no vocabulary) — see D-ENGINE-2

Split `RiderEditor.tsx` by rider family behind an unchanged barrel. Recommended, not required; §6
gives the schedule both ways.

### Batch E1 — the four cheapest readers

| lane | units | files it holds |
| --- | --- | --- |
| **A** | **E0 → U29 → U26** | `apps/server/src/action-resolution.ts`, `apps/server/src/effective-actions.ts`, `packages/content-srd-5.2.1/scripts/class-mechanics/sorcerer.ts` (U29's carrier edit + the comment that names E0 and U29) |
| **B** | **U24** | `apps/server/src/equipment-derivation.ts` |
| **C** | **U28** | `packages/rules-5e/src/character.ts`, `apps/server/src/character-build.ts`, the `modifiers` region of `RiderEditor.tsx` |
| **D** | **U32** | `apps/server/src/death-saves.ts` |

Disjoint. A owns both `action-resolution.ts` and `effective-actions.ts`, which is why U25 cannot be
here; its `sorcerer.ts` edit collides with no other lane in this batch (U31's class-mechanics carrier
is E2, a batch later). Each lane also creates its own new `*.mirror.test.ts`.

### Batch E2

| lane | units | files it holds |
| --- | --- | --- |
| **A** | **U27** | `apps/server/src/action-resolution.ts` |
| **B** | **U25** — *dedicated agent + viewer-safety audit* | `apps/server/src/equipment-derivation.ts`, `apps/server/src/effective-actions.ts`, `packages/schemas/src/index.ts`, `apps/client/src/encounter/CharacterSheet.tsx` |
| **C** | **U19** | `packages/domain/src/index.ts`, `apps/server/src/content-library.ts`, `apps/client/src/homebrew/useSchemaContext.ts`, `apps/client/src/homebrew/schema.ts`, the `uses` and `modifiers` regions of `RiderEditor.tsx`, `apps/client/src/homebrew/vocabularies.test.ts` |
| **D** | **U31** | `packages/content-srd-5.2.1/scripts/class-mechanics/` (its carrier) only |

B holds `packages/schemas/src/index.ts`; C holds `packages/domain/src/index.ts`; A holds
`action-resolution.ts`; D holds only content. Disjoint.

### Batch E3

| lane | units | files it holds |
| --- | --- | --- |
| **A** | **U22** — *dedicated agent + viewer-safety audit* | `apps/server/src/action-resolution.ts`, `apps/server/src/projections.ts`, `apps/server/src/effects.ts`, `packages/schemas/src/index.ts`, `packages/domain/src/index.ts`, the `effects` region of `RiderEditor.tsx` |
| **B** | **U20** | `apps/server/src/equipment-derivation.ts`, `packages/content-srd-5.2.1/src/character-content.ts`, `packages/content-srd-5.2.1/scripts/class-mechanics/monk.ts`, the `modifiers` region of `RiderEditor.tsx` |
| **C** | **U21a** | `apps/client/src/homebrew/schemas.ts`, the `actions` region of `RiderEditor.tsx`, the census array in `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` |
| **D** | mobile + QA back-fill over E1 and E2 | CSS and verification only; opens no source file another lane holds |

Without R2 the three `RiderEditor.tsx` regions in A, B and C are **one file** and this batch collapses
to one control lane. That is the whole of D-ENGINE-2.

### Batch E4

| lane | units | files it holds |
| --- | --- | --- |
| **A** | **U21b → U18** | `apps/server/src/action-resolution.ts`, `packages/content-srd-5.2.1/scripts/class-mechanics/monk.ts`, `apps/server/src/condition-rules.ts`, `packages/schemas/src/index.ts`, the `effects` region of `RiderEditor.tsx` |
| **B** | **U17** — *D-ENGINE-1 ruled 2026-08-10; no longer conditional* | `apps/server/src/character-build.ts`, `apps/client/src/homebrew/FeatureEditor.tsx`, `packages/content-srd-5.2.1/scripts/build-class-bundle.ts`, `packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts`, `packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts`, `packages/content-srd-5.2.1/src/character-content.ts`, the census array in `vocabulary-parity.mirror.test.ts`, `apps/server/test/cleric-druid-bard-mechanics.test.ts` |
| **C** | mobile + QA back-fill over E3 | as above |
| **D** | spare — content support, or U17's content half if B is blocked | |

A holds `monk.ts`; B holds `bard.ts` and `overlay.ts` — different files. A holds
`packages/schemas/src/index.ts`; B holds `packages/content-srd-5.2.1/src/character-content.ts`.
B holds the census array (U17's row); U21a took its row in E3, a batch earlier. Disjoint.

### Batch E5

| lane | units | files it holds |
| --- | --- | --- |
| **A** | **U23 + U30** (merged) | `apps/server/src/action-resolution.ts`, `packages/schemas/src/index.ts`, `apps/client/src/homebrew/validate.ts`, the `modifiers` region of `RiderEditor.tsx`, `apps/client/src/homebrew/vocabularies.test.ts` |
| **B** | mobile + QA back-fill over E4 | |
| **C/D** | overflow from any earlier lane that slipped | |

### Closer — U33 (solo)

Touches `apps/client/src/homebrew/schema.ts`, `apps/client/src/homebrew/FieldRenderer.tsx` and every
rider-field region. Runs alone, after all seven of its predecessors.

---

## 6. If D-ENGINE-2 is declined

Without R2, `RiderEditor.tsx` is one file and the rule *"no two agents share a file"* admits **one**
control unit per batch. Measured: **8 of the 19 units need a control there.** The program then runs
**E1 · E2 · E3′ … E8′ · closer** — eight batches with three lanes idle in most of them, instead of
five plus a closer. No code risk either way; the cost is calendar.

---

## 7. Decisions this program needs

### D-ENGINE-1 — how Bard's Magical Secrets gets `widensPicks` · **RULED 2026-08-10 · option 1**

**Settled.** `docs/ai-ledger/decision-log.md:59`–`:61`: *"U17's freeze is lifted: the Stage-4 CONFIG
freeze was documentation-only and Stage 4 is done. Delete the stale `magical-secrets` row from
`CONFIG.bard.choices` and author `widensPicks` through the overlay — the engine plan costs the
alternatives and cites why each loses."* The table below is the costing that ruling points at; it
stays so the reasoning is auditable, and **U17 is schedulable**.

**The collision, re-measured at HEAD.** `build-class-bundle.ts:344` still authors the mis-wired
choice `{kind: "spell", choose: 2, fromCatalog: "bard-spells"}` in `CONFIG.bard.choices` — the row to
delete is still there. `class-mechanics/bard.ts:75`–`:93` declines and names both blockers.
`applyMechanics` (`class-mechanics/overlay.ts:124`–`:162`) refuses to overwrite a non-absent value and
pushes an *"already authored on the record - remove it from one of the two homes"* message (`:140`)
that **fails the build** (`build-class-bundle.ts:855`–`:859`, `process.exit(1)`). Bard is **not** in
`HAND_AUTHORED` (`build-class-bundle.ts:33` = fighter, wizard, cleric), so for Bard the collision is
CONFIG-versus-overlay, not bundle-versus-overlay. The "frozen" claim was **documentation only** —
`docs/product/stage-4-authoring-assignments.md:24` and `:100` — with **no test enforcing it**, which
is what the ruling turned on.

| option | cost | verdict |
| --- | --- | --- |
| **1. Delete the row from `CONFIG.choices`; author `widensPicks` in `bard.ts`.** | one deleted line in `build-class-bundle.ts` (`:344`); one key added to `FeatureMechanics`' `Pick` union in `overlay.ts` (`:78`); ~15 lines in `bard.ts`; update `cleric-druid-bard-mechanics.test.ts:153`–`:154`. Schedule so one agent holds `build-class-bundle.ts`. | **RULED — this is the one taken.** The freeze's only reason was Stage-4 lane contention, which is over. The no-overwrite rule stays intact and un-weakened, and the record ends with **one** home for its mechanics — the overlay's whole thesis. |
| 2. Give the overlay an explicit "replaces" marker so it may overwrite. | changes a build-safety invariant; adds an authoring concept every future author must decide about. | **Reject.** For the three `HAND_AUTHORED` classes the ETL writes the merged record back over its own input, so an overwrite is un-revertable and unreviewable — `overlay.ts` says so in writing. Weakening the rule for Bard weakens it for Cleric, Fighter and Wizard. |
| 3. Move Bard to `HAND_AUTHORED`. | freezes Bard's **prose**; 242 records stop being derived from the source. | **Reject.** `overlay.ts`'s header argues against exactly this: *"trades a generated artifact for a manual one to gain a place to hang three lines of riders."* |
| 4. Author `widensPicks` on a homebrew-only carrier; leave Bard mis-wired. | zero build risk. | **Reject.** Violates the harness's test 2 (*"not a lone record"*) and leaves the client's own audit row 55 open. |

**Second half of the same ruling:** `widensPicks: [{ offer: <PickBudgetKey>, addCatalogs: [...] }]`
targets `NAMED_PICK_BUDGET_KEYS` — the **same** offer-key namespace `extraPicks` and `replaces`
already use (`packages/content-srd-5.2.1/src/character-content.ts`, imported at
`apps/server/src/character-build.ts:16`). Do not mint a second namespace; `83420fd` already ruled
against a narrower second list for exactly this reason.

**Already recorded** in `docs/ai-ledger/decision-log.md` (2026-08-10 entry). Nothing further is owed
before U17 is scheduled.

### D-ENGINE-2 — split `RiderEditor.tsx`? · **shapes every batch · STILL OPEN**

**Not in the 2026-08-10 rulings** — grep of `decision-log.md` for `RiderEditor` at HEAD: zero hits.
It is this program's to take, and it must be taken before batch E3.

**Measured:** 1365 lines at HEAD, 8 of 19 units need a control in it, and it already has clean factory
boundaries (`whenField`, `modifiersField` + `MODIFIER_TYPES` + `blankModifier`, `usesField` +
`actionUsesField`, `tagsField`, `actionsField`, `effectsField` + `effectModifiersField` +
`EFFECT_MODIFIER_TYPES` + `blankEffectModifier`, `GrantsEditor`).

| option | cost | verdict |
| --- | --- | --- |
| **A. R2 — split by rider family behind an unchanged barrel.** | S–M, zero behaviour change. `riderFieldsForTest`, `RIDER_FIELDS_FOR_TEST`, `ITEM_RIDERS`, `ALL_RIDERS`, `modifierLabel`, `triggerKindOf`, `slugValidate`, `grantRowsOf`, `grantsFromRows`, `attackReadout` and `riderSummary` all re-export unchanged, so `RecordDetail.tsx`, `validate.ts`, `authoring-harness.ts`, `vocabularies.test.ts`, `uses-mode.test.tsx` and the mirror file need **no** edit. | **RECOMMENDED.** Turns one 8-way bottleneck into a 4-way one (`modifiers`: U19, U20, U23+U30, U28) plus three 1–2-way ones. Precedent: R1 (`4f4815d`) is the same category — a refactor with no vocabulary of its own, taken because *"the five units behind this refactor would each have shipped with the fourth part of the rule — a test through BOTH paths — structurally unavailable."* |
| B. Leave it; one control unit per batch. | eight batches instead of five (§6). | acceptable, slower. |
| C. Allow same-file, different-region concurrency. | the client ruled against it. | out. |

**The one tax R2 must pay, measured:** `apps/client/src/play-vocabulary.test.ts:103`–`:109` (the
first entry of the `ALLOWED` array opened at `:102`) holds a `(file, string)` exemption pinned to
`apps/client/src/homebrew/RiderEditor.tsx` for *"Kinds of creature"*, and that file has a
dead-exemption check. Moving `whenField` makes the exemption dead. **Update it in the same commit.**

---

## 8. The verification bar

Unchanged, non-negotiable, and applied per unit in §2.

1. **A far-end proof.** The test ends at a rolled number, a spent counter, a refusal, a rendered
   string. *"The value survived derivation" is not a test.*
2. **Two non-vacuity probes.** Disable the **control** → a named failure → restore. Keep the control
   and change the **value** → the far-end assertion fails → restore. Report exact counts and messages.
   Where a control already ships, substitute a **content** probe and say so.
3. **A 375px touch pass** for anything with UI. Chromium is pre-installed at `/opt/pw-browsers`;
   **never run `playwright install`**.

**Measured baselines to diff against, re-run at HEAD `36b5a1f`.** The node (mirror) project
(`npx vitest run --project node`): **4 files / 202 tests / 2.6 s**, green.
`vocabularies.test.ts` + `publish-paths.test.ts` under the dom project: **2 files / 26 tests /
2.2 s**, green. Both from `apps/client`.

**Operational traps that have each cost an agent real time.** `npm run build` emits compiled output
under the server workspace and `npm run test` then collects those compiled tests too (185 → 204 files,
~11 spurious failures) — build only the client workspace and it never appears. Never run two full
suites concurrently: the server suite binds a live port. Read `docs/ai-ledger/known-bugs.md` before
calling a red test a regression.

---

## 9. What I measured that contradicts an earlier document

Every row was re-checked at HEAD; these are the ones where the answer differs.

| claim | where it is written | what HEAD says |
| --- | --- | --- |
| *"No incoming-damage path collects riders at all"* | `remaining-program-plan.md` §2.13 · `vocabulary-parity-audit.md:472`, `:478` | **False.** `apps/server/src/hit-points.ts:132`–`:136` runs a standing pass **and** an `on-taking-damage` pass and sums `damage-reduction`. U31 is content-only. |
| U30 is a **content** unit | the brief's table · `vocabulary-parity-audit.md:480` | **Reader missing too.** `RiderContext.spellSchool` / `.spellLevel` (`packages/rules-5e/src/riders.ts:142`–`:143`) are set by **nothing**; both filters fail closed 100%. |
| U21's reader has *"1"* author that can exercise it | `remaining-program-plan.md` §2.13 | **Zero.** All 126 `multiattack` authors are `activation: "action"`; no SRD record anywhere authors a bonus action with a component pool. Flurry of Blows is prose. The unit splits. |
| `unarmored-defense.allowShield` has **1** SRD author | `vocabulary-parity-audit.md:200` | **2**, and the pair is what makes the test non-vacuous: Barbarian `allowShield: true`, Monk `allowShield: false`. |
| an empty damage type means *"the same type this weapon already deals"* | `apps/client/src/homebrew/RiderEditor.tsx:422`–`:427` | **False.** `damageType` is `DamageTypeIdSchema` — `z.string().min(1).max(40)` at `packages/schemas/src/index.ts:7` — and **required** (`:205`). Re-probed at HEAD: `""` → *"String must contain at least 1 character(s)"*; absent → *"Required"*. So `action-resolution.ts:983`'s `?? damage[0]?.type` fallback is **unreachable**, and `blankModifier` (`:320`) seeds an unpublishable row with no client-side message. |
| U18's control is *"one row in U6's `modifiersField` nest"* | `area-2-plan.md` §U18 | Wrong nest — U6 built a **separate** `effectModifiersField` over a 4-entry list, because `FeatureModifierSchema` is **21** variants and `EffectModifierSchema` is **12** (both probed). Confirmed the governing plan's correction. |
| U27 is a *"one-line fix"* | `area-2-plan.md` Wave 5 table | There is **no advantage machinery on the check path at all** (`action-resolution.ts:736`–`:791` rolls a bare `1d20`), and the one SRD author is **effect-side** (Rage), so it also depends on E0. **L.** |
| the census array is a multi-unit conflict zone | the brief | **Three rows** at HEAD (`vocabulary-parity.mirror.test.ts:3415`–`:3417`), two of them mine (U17, U21a) and adjacent. Narrow, and handled by putting them in different batches. |
| the mirror test file is an unavoidable serialization point | implied by the brief | **It is not.** `apps/client/vitest.config.ts:37`'s node project includes `src/**/*.mirror.test.ts` as a **glob**; **four** such files already exist in four directories. Every unit gets its own. |
| `EquipmentDerivation.speed` is a live item channel | nowhere — this is new | Computed at `apps/server/src/equipment-derivation.ts:678` and consumed by **nothing in production**; the only two references are tests asserting it is `0`. The item speed path is as dead as the effect path. |
| effect-side `roll-mode` is read where it is authored | `apps/server/src/action-resolution.ts:542`'s own comment | **Only** `attackRollSources` (`:533`) reads it, and it ignores the rider's `when`. `toRollModes` has exactly two call sites in `apps/server/src`, both inside it (`:547`, `:555`). For `save`, `check`, `initiative`, `death-save` and `concentration` an effect's `roll-mode` is inert everywhere. Hence **E0**. |
| U33 is a copy sweep | `area-2-plan.md` §U33 | It needs a **mechanism** first: `SelectOption` (`apps/client/src/homebrew/schema.ts:47`) has no `note`, so an OPTION cannot be labelled at all today. And `effectsField`'s *"The sheet groups effects by these"* (`RiderEditor.tsx:907`) **understates** a live gate rather than overstating a dead one. |
| U25 must hand the parent a fix for `current-state.md:54` | this plan's own earlier draft · `area-2-plan.md:520`–`:521`, `:763` | **Gone.** *"Every field the item editor offers reaches the fight"* was deleted from `current-state.md` by `1263e34`; grep at HEAD finds it nowhere in that file. U25 owes the ledger nothing. |
| U29's and E0's blockers are undocumented in the content lane | nowhere — this is new | `class-mechanics/sorcerer.ts:61`–`:73` names **both** in writing (`toRollModes` "DROPS the `when` list"; `attackKindsOf` "never announces `"spell"`, so the filter fails closed") and declines to author Innate Sorcery's advantage because of them. The record itself is already shipped at `:75`–`:88` with no `modifiers`, so U29's content half is an edit, not a new carrier. |

---

## 10. Cross-program sequencing — three locks the execution phase must hold

Three files are contended **across programs**, not only inside this one. None of these can be
enforced from inside a batch table, because the three programs schedule independently — so they are
written down here, and repeated in the workflow script's header.

### `apps/server/src/action-resolution.ts` and the mastery program's M0

The mastery program is adding **M0**, a dispatch-seam refactor of the on-hit region and a relaxation
of the one-target guard for `cleave`. Both land in `apps/server/src/action-resolution.ts`, which is
this program's hottest file (6 units). Measured at HEAD, here is exactly who touches what.

| M0 region at HEAD | what is there | my units at that site |
| --- | --- | --- |
| `:678` — `if (action.attack && targets.length !== 1) throw …` | the one-target guard | **U29, indirectly.** U29 must decide whether `attackKinds` moves out of the `if (action.attack && targets.length === 1)` block at `:811`–`:822` (the way U4 moved `damageTypes`). Relaxing `:678` changes how many targets reach that block, so the two rulings interact. |
| `:1058`–`:1079` — the mastery on-hit effect application (Sap) | `addEffect` on `targets[0]` after a hit | **U22, directly.** Its natural content — *"advantage on your next attack against a creature you hit"* — applies an effect **on hit**, in this exact region, and `vex` is the mastery that consumes it. |

**Everything else in this program uses a different site**, re-verified at HEAD: E0 and U22's
collector `attackRollSources` at `:533`–`:559`; U21b's bonus-action branch at `:254`–`:257`; U27 at
`:736`–`:791`; U23+U30 at `:810` and the extra-damage rider block at `:963`–`:997` (adjacent to the
mastery region, not inside it); U29's `attackKindsOf` at `:512`–`:530`.
**U25 does not touch `action-resolution.ts` at all** — its three hops are `effective-actions.ts`,
`CharacterSheet.tsx` and `equipment-derivation.ts`.

**The sequencing rule, in one sentence: M0 lands before U22, and U29 lands before M0 relaxes `:678`.**

- **U22 after M0.** M0 is a seam refactor with no vocabulary; U22 adds a field that reaches every
  player. Rebasing a viewer-safety change onto a refactor is the wrong order — the audit would be run
  against a shape that then moves. U22 is scheduled in **batch E3**, so M0 must land by the end of
  **E2**. If it slips, U22 slips with it rather than the reverse.
- **U29 before M0's `:678` change.** U29's ruling on `attackKinds` is *"is this filter a property of
  the action or of the engagement"*, and it is cheaper to answer against the current single-target
  invariant and then let `cleave` inherit the answer than to answer it while the invariant is moving.
  U29 is in **batch E1**, which is already ahead of M0.
- **Neither program regenerates `IMPLEMENTED_MASTERIES`.** That Set literal
  (`apps/server/src/equipment-derivation.ts:247`, `new Set(["graze", "sap"])`) belongs to the mastery
  program alone; U18, U21b and U22
  each remove the *reason* a slug is excluded and say so in their commit message, and the mastery
  program moves the slug.

If M0 and any of my `action-resolution.ts` lanes end up in the same batch anyway, the lane yields:
the seam is shared, my sites are not, and a refactor that half-lands is worse than a unit that waits.

### `RiderEditor.tsx` is contended ACROSS programs, not only within this one

The API program's **lane β** puts four units in the same file (`onHit`, `legendary.cost`,
`damageByLevel`, `action.grants` — its C1–C4, run as one serial pipeline). This program has **eight**.
The two programs will otherwise schedule independently and collide on the single hottest file in the
repo.

> **Written down so the execution phase can enforce it: this program's `RiderEditor.tsx` units and
> the API program's lane β must never be in flight at the same time.** That covers phases **E1
> (U28), E2 (U19), E3 (U22, U20, U21a), E4 (U18), E5 (U23+U30)** and the **closer (U33)** — which is
> to say all six. Lane β takes the gaps between them, or it takes the whole file while this program
> works its server-side lanes.
>
> **R2 (D-ENGINE-2) is the only thing that makes the two programs genuinely parallel.** Lane β's four
> units are `actionsField` and `effectsField` work; this program's eight span `modifiers`, `uses`,
> `actions` and `effects`. After the split the collision narrows to `actions.tsx` (lane β's `onHit`
> and `legendary.cost` versus U21a) and `effects.tsx` (lane β's `action.grants` versus U18 and U22),
> and everything else runs concurrently. **That raises R2 from "this program's convenience" to a
> cross-program prerequisite** — factor it into D-ENGINE-2.

### `apps/client/src/homebrew/schemas.ts` — measured line ranges, and both of mine overlap

The API program holds `:813`–`:884` in lane **α** and `:302`–`:408` in lane **γ**. Measured at HEAD:

| my unit | my exact region | API lane it lands inside |
| --- | --- | --- |
| **U21a** | `:863`–`:869` — `MONSTER_SCHEMA`'s `actions` section, where the withheld monster-only keys are documented | **α (`:813`–`:884`)** — `MONSTER_SCHEMA` **begins** at `:813`, so α is the whole record. **Direct overlap.** |
| **U33** | `:312`, `:326`, `:393` — three of the four honesty `note`s | **γ (`:302`–`:408`)** — `SPECIES_SCHEMA` opens at `:302` and `BACKGROUND_SCHEMA` at `:374`. **All three inside.** U33's fourth note, `:237`, is in `CLASS_SCHEMA` and is outside both. |

**Sequence, not split:** U21a is a single insert into a section whose comment already names the reason
the keys are withheld, and U33 is three one-line edits. Both are cheaper to *wait* than to merge.
**U21a runs after lane α; U33 runs after lane γ** — and U33 is this program's closer anyway, so that
one is nearly free.

**Confirmed by PLANNER-API, and it holds:** `multiattack` stays with **U21a** — the API program
explicitly did not take it, because a live census row in
`apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` names this unit. And the API program's F3
serves its vocabularies from `packages/content-srd-5.2.1/src/enums.ts` constants specifically to stay
off `loadEquipment()`, so nothing in this program contends with it.

---

## 11. Out of scope

Owned elsewhere; depend on them, do not build them.

- **Prerequisites** — **already landed** in batch 0 (`36b5a1f`): the weapons ETL home for `mastery`,
  `properties` on all four shapes, and the catalog-picker fix. Do **not** regenerate
  `packages/content-srd-5.2.1/bundles/weapons.v1.json`; that column is settled.
- **Content** — the full SRD magic-item list, Wizard's Spell Mastery, the `clears` verb the
  2026-08-10 overlay ruling adopted (`decision-log.md:56`–`:58`; not in `overlay.ts` yet), **and every
  SRD carrier the zero-author units above need**. U29's Innate Sorcery half is the exception: the
  record already ships and this program edits it.
- **The API parity program** — the round-trip parity guard, the ~80 capability gaps, the three API
  defects, and the regeneration of `docs/product/vocabulary-parity-audit.md`.
- **The mastery program** — U34–U38 plus `vex` and `slow`. This program *unblocks* `slow` (U18),
  `nick` (U21b) and `vex` (U22); it does not implement them, and it must not touch
  `IMPLEMENTED_MASTERIES` in `apps/server/src/equipment-derivation.ts`.

The executable form of this plan is [`docs/product/workflows/engine-program.js`](workflows/engine-program.js).
