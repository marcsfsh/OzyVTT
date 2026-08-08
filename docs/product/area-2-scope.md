# Area 2 scope — finish the classes and the homebrew work as one phase

**Written 2026-08-08 by INTAKE-AREA2, against HEAD `d811c46` on `claude/feature-implementations-intake-c5eyu1`.**

**This document supersedes the "Area 2 — Homebrew" plan in
[`feature-implementations-plan.md`](feature-implementations-plan.md).** That plan was written
2026-08-07, before Stage 3 and Stage 4 landed; read it for the client's original intent (`3a`–`3d`
Observed/Expected, and the two corrections it makes to the register), then work from here. Its Area 2
*ordering*, its `3b`(b) "gated on Area 1 Stage 3" note and its `extraPicks` "known limit" are all
stale. Its diagnoses of `3a`, `3d`, `3b`(a) and `3c` are **still accurate at HEAD** — I re-verified
each one line by line and the only thing that moved is line numbers.

## The organizing rule

> **One unit of work = an engine reader + SRD content authoring it + a homebrew editor control +
> a test through BOTH paths. Ship vocabulary complete, or don't ship it.**

That rule exists because "built-but-unwired" has bitten seven times this session, and it bit an
**eighth** time three days ago — see finding **N1** below. A mechanism exercised through one consumer
only is invisible to a green suite and a clean typecheck.

Three things get conflated and must not be. Every row in this document names which one is missing:

| | What it is | How it fails silently |
|---|---|---|
| **a field in a type** | a Zod member, an OpenAPI property | it validates, stores, projects, and nothing reads it |
| **a control in the editor** | a `FieldDef`, a React control | the value is unauthorable, so the reader never sees one |
| **a reader in the engine** | a consumer in the resolver/derivation | the value is authorable and changes nothing |

**Sizes below are claims.** Where I write *measured*, I ran something and say what. Where I write
*estimated*, I read the code and guessed. Nothing here was implemented.

---

## Part 1 — the client's four issues, re-diagnosed at HEAD

### `3a` — rarity. **Unchanged. Size S.**

Still `kind: "text"` + `suggestions` → an `<input list>` + `<datalist>` with no visible affordance
(`apps/client/src/homebrew/schemas.ts:649`, rendered by
`apps/client/src/homebrew/FieldRenderer.tsx:347-382`). `apps/client/src/homebrew/vocabularies.test.ts`
still deliberately pins it open so a GM can type "unique" — **measured: I ran that file, 6 tests
pass.** The plan's reading stands: the client wants it to *look and behave* like a dropdown, not to
close the enum.

**One thing the plan missed.** `RARITY_IDS` is a **client-local literal** at
`apps/client/src/homebrew/schemas.ts:596` with six values and no `varies`, and there is **no canonical
rarity list** in `packages/content-srd-5.2.1/src/enums.ts` the way `DAMAGE_TYPE_IDS` is. So `3a`
either moves the list into `enums.ts` or `3d`'s proposed pin ("no file under `apps/*/src` declares a
literal array holding three or more slugs") is violated by `3a`'s own file on the day it lands.
Decide that once, in `3a`.

### `3d` — damage types. **Unchanged. Size S. Nine sites, re-counted.**

Three `text` sites: `schemas.ts:743` (`weapon.damageType`), `schema.ts:316`
(`damagePartsField().type`), `RiderEditor.tsx:387` (`extra-damage.damageType`). Six tag sites:
`schemas.ts:491` (spell `damage.types`), `:813`/`:814`/`:815` (monster RVI ×3), `RiderEditor.tsx:229`
(`damage-type-is`), and the grant kinds resolved at `RiderEditor.tsx:596`.

`DAMAGE_TYPE_IDS` now reaches the client twice (`apps/client/src/homebrew/schema.ts:132` and
`apps/client/src/homebrew/useSchemaContext.ts:17`). **The plan's claim that the server reads it
nowhere is still true** — grep finds no import of it under `apps/server/src`. `normalizeDamageType()`
is still worth adding beside the constant.

### `3b` half (a) — "Uses are". **Unchanged. Still a five-line fix.**

`apps/client/src/homebrew/RiderEditor.tsx:428-451` defines the `mode` select with a `write` and no
`read`. The comment at `:432-433` still says "`mode` is NOT stored — it is read back out of the
shape"; **it never is.** `FieldRenderer.tsx:73` therefore falls through to `getAt(value, "mode")`, a
key the write path deliberately never persists, and the select renders
`<option value="">Not set</option>` (`FieldRenderer.tsx:188`) on every render.

`usesField` is one component mounted by items *and* features (`RiderEditor.tsx:770`), so the `read`
lands once and fixes both. The plan's proposed `read` body is correct against HEAD.

### `3b` half (b) — the pool binding. **No longer blocked. Size M.**

This is the one that genuinely changed. `uses.pool` (`RiderEditor.tsx:499`) and
`resource-bonus.poolId` (`:393`) are still free-form text — but the thing to bind them to now exists:
`actionPools()` at `apps/server/src/effective-actions.ts:150` (the plan says `:115`; stale) is emitted
as `pools` at `apps/server/src/projections.ts:294` under `resourcesVisible`. `id` is exactly the
`actionUses` key (`uses.pool ?? action.id`), which is the namespace the engine spends and re-arms.
So `3b`(b) has a real target and is no longer "gated on Area 1 Stage 3".

The plan's ruling still holds and should be kept: the editor has no character in hand, so the
buildable form is **every pool the merged catalog declares**, with an unmatched pool degrading to a
private counter — which is already the runtime behaviour. Do not add a refusal.

### `3c` — the mace. **Both bugs unchanged. Size L, but bug 1 got cheaper.**

**Bug 1 — the item's own `uses` block is read by nothing.** Confirmed at HEAD: `usesOf`
(`apps/server/src/equipment-derivation.ts:822`) has exactly two call sites, an *action's* own uses
(`:892`) and a *cast's* own uses (`:929`). The equipped loop (`:601-627`) reads `modifiers`, `grants`,
`effects`, `actions`, `casts` and `grantsFeatIds` and never `record.uses`; `weaponAction`
(`:988-1010`) builds its `ActorAction` with no `uses` key at all.

**What got cheaper:** the equipped loop now already calls `catalog.equipmentRecord(entry.item.id)` one
line below, at `:644`, for the weapon's mastery. The record the fix needs is in hand at the call site.

**Bug 2 — the extra damage resolves but never renders.** All four hops confirmed:
1. `withStandingRiders` (`apps/server/src/effective-actions.ts:44-73`) folds attack-bonus,
   critical-bonus-dice, spell-save-dc, `usesBonus` and `extraAttacksFor`. `extra-damage` is
   at-its-moment and correctly excluded — it is collected at `apps/server/src/action-resolution.ts:965`
   — so `srv.damage` is base-only and `apps/client/src/encounter/CharacterSheet.tsx:792` prints one line.
2. `CharacterSheet.tsx:803` rolls `rollFlat(part.formula)`, a bare roll with no riders, and
   `structuredAttacks` (`:228`) is false unless a fight is live **and** it is that player's turn.
3. `addFromCatalog` (`CharacterSheet.tsx:548-560`) sends no `equipped` for a new item, and
   `itemIsActive` (`equipment-derivation.ts:385-389`) requires `item.equipped` — so a freshly added
   item contributes nothing.

**D21's ledger claim is still overstated.** `docs/ai-ledger/current-state.md` says "Every field the
item editor offers reaches the fight." `apps/server/test/homebrew-inert-fields.test.ts` is 383 lines
over six rows: saves, damage resistance, four grant kinds, an item action's attack/save halves,
effects riders, and casts. **Item-level `uses`, `extra-damage` display, `armor.*`, `cursed`, `rarity`,
weapon range bands, `tags` and the brand-new `weapon.mastery` are all uncovered.** Fix the line when
`3c` lands, in the same change.

---

## Part 2 — the class residue, and the vocabulary each needs

### 2.1 Monk weapons — no Martial Arts die, no Dexterity

**Confirmed.** `weaponAbilityModifier` (`equipment-derivation.ts:978-986`) takes finesse →
max(str,dex), genuinely ranged → dex, everything else → str. A quarterstaff is neither, so it takes
Strength. `martialArtsStrike` (`apps/server/src/character-build.ts:503-515`) mints only the *Unarmed
Strike*, from the printed `martial-arts` column. **Measured from
`packages/content-srd-5.2.1/bundles/classes.v1.json`:** Monk's column is `1d6` / `1d8` / `1d10` /
`1d12` at levels 1 / 5 / 11 / 17. So a Monk 5 at DEX 15 / STR 12 gets `Quarterstaff +4 (1d6+1)` —
Strength, and the printed `1d8` nowhere. The ledger's number reproduces exactly.

**Vocabulary needed: a weapon-swing override — which die, and which ability.** A swing is derived at
read time by `deriveEquipment`, which holds no class table. The ledger's own constraint is right: it
wants the die on the definition (or the class row reachable from the derivation), never a
hard-coded "if monk" inside `weaponAbilityModifier`. Shape to reach for: a rider variant
(`weapon-swing`, scoped by `weapon-property-is`/category, carrying `die?` and
`ability?: "best-of-str-dex"`) collected by the same standing pass `extra-attack` already uses.

### 2.2 Flurry of Blows — two strikes that are prose

**Confirmed.** `evaluateActionEconomy` (`action-resolution.ts:255-301`) opens a component instance
only inside the `onOwnTurn && action.activation === "action"` branch. The bonus-action branch
(`:255-257`) only sets `bonusActionUsed`. Declaring `multiattack` on a bonus action would look wired
and hand out nothing.

**Vocabulary needed: a bonus-action component pool** — `ActionSchema.multiattack` honoured on
`activation: "bonus-action"`. Note the editor half is also absent: `RiderEditor.tsx:517` offers an
`activation` select but there is **no `multiattack` control anywhere in the homebrew editor**.

### 2.3 Row 55 — Bard's Magical Secrets, mis-wired

**Confirmed** at `packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts:74-94`. It is authored by
`packages/content-srd-5.2.1/scripts/build-class-bundle.ts`'s `CONFIG.choices` as
`{kind:"spell", choose:2, fromCatalog:"bard-spells"}` — wrong mechanic and wrong list. The real promise
**widens the source list of the class's existing prepared-spell budget** from level 10. Blocked twice:
`CONFIG` was frozen for Stage 4, and the overlay correctly refuses to overwrite a `choice` a record
already carries.

**Vocabulary needed: widening an existing budget's source list.** This is the third member of a family
whose other two already ship: `extraPicks` **raises capacity**
(`packages/content-srd-5.2.1/src/character-content.ts:314-350`) and `replaces` **re-opens a settled
row** (`:402-408`). Neither can say "same budget, more lists". Shape:
`widensPicks: [{ offer: <PickBudgetKey>, addCatalogs: [...] }]`, read by the same two consumers that
already read `maxSpellLevel` — the server's offer builder in `apps/server/src/character-build.ts` and
`apps/client/src/builder/build-payload.ts`'s `featurePickOffer`.

### 2.4 Row 24 — Warlock's Lessons of the First Ones, unauthorable

**Confirmed** at `packages/content-srd-5.2.1/scripts/class-mechanics/warlock.ts:156-171`. A
`{kind:"feat"}` nested in an option cannot be answered: `character-build.ts` settles feat-kinded rows
in **pass A** and chosen options in **pass A2**, so the offer this would create does not exist yet
when the feat row is matched; omitting the row fails the completeness check instead. Authoring it
would make the invocation *untakeable*.

**Vocabulary needed: none.** This is a **pass-ordering fix**, specified as ruling E in
`stage-4-authoring-assignments.md:246-257`. Top-level feat choices already work (nine Epic Boons prove
it); only the nested-in-an-option case is broken.

### 2.5 Weapon masteries — six of eight inert, over 30 of 38 weapons

`IMPLEMENTED_MASTERIES` is `{graze, sap}` (`equipment-derivation.ts:247`); `masteryReaches` (`:257`)
is the honest gate and `masteryByActionId` (`:638-649`) requires *mastery ∧ unlocked ∧ implemented*.
Graze fires at `action-resolution.ts:939-942`, Sap at `:1049-1070`.

**Measured from `packages/content-srd-5.2.1/bundles/weapons.v1.json`: all 38 weapons carry a mastery,
distributed vex 8 · slow 7 · sap 6 · topple 5 · nick 4 · push 4 · cleave 2 · graze 2. The six inert
slugs cover 30 of 38 weapons.** That number is in no document and it is the real size of the gap.

The previous agent's sizes, verified against HEAD:

| Mastery | Weapons | Blocker at HEAD | Size |
|---|---|---|---|
| `topple` | 5 | A Constitution save the **weapon** triggers; the save path is `action.save`-declared and `weaponAction` declares none. | ~½d *(estimated)* |
| `slow` | 7 | **Confirmed missing:** `EffectModifierSchema` (`packages/schemas/src/index.ts:232-247`) has ten members, none a speed modifier. | ~½–1d *(estimated)* |
| `vex` | 8 | **Confirmed:** `EffectInstanceSchema` (`packages/schemas/src/index.ts:280-309`) carries `sourceActorId` and no "against actor X" field; the `versus-*` triggers (`:104-106`) narrow by creature **type**, **size** and **condition**, never identity. Nowhere to hang "against this one foe". | ~1d *(estimated)* |
| `nick` | 4 | Moves the Light property's extra attack out of the bonus action — same turn-economy branch as **2.2**. | ~1d *(estimated)* |
| `cleave` | 2 | A second attack roll at a **different** creature inside one resolution. | ~1–1.5d *(estimated)* |
| `push` | 4 | The attack path must write a token position — movement, snapping, fog. | ~1.5d *(estimated)* |

**One correction to the previous agent's `slow` sizing.** It named `apps/server/src/movement-rules.ts`.
The actual reader is `effectiveSpeedFeet` at **`apps/server/src/condition-rules.ts:44-47`**, which folds
exhaustion and Speed-0 conditions; `movement-rules.ts:68` merely calls it. So `slow` is
`packages/schemas/src/index.ts` + `condition-rules.ts` + the sheet/projection — one file smaller than
claimed, and in a file with no movement logic in it.

### 2.6 From `known-bugs.md` — verified at HEAD, still true

- **Leveled spells mint no action**, so no `spellId`, and casting from the sheet is a client-side
  damage roll. Blocker measured in the entry: an action would need to carry `spellSlot`, and a Warlock
  5's only slots are level 3 while Ascendant Step's Levitate costs none. Wants a per-spell "which pool
  pays for this".
- **Cantrip damage does not scale with character level.** `castingOptions` rows exist and
  `spellEffectAt` consults them only above the spell's own level. Fix `spellEffectAt` and
  `cantripActionFor` together or the sheet prints two different numbers on one row.
- **`minSpellLevel` has no sibling to `maxSpellLevel`** (ruling H, `stage-4-authoring-assignments.md:285-292`);
  Warlock's four Mystic Arcanum rows stand on it.
- **`overlay.ts`'s `FeatureMechanics` exposes `choice` but not `choices`** — Wizard's Spell Mastery
  cannot be fixed from `wizard.ts`.
- **`ExtraDamageVariantSchema` requires `damageType`** with no "same type as the triggering damage"
  form — Evoker's Empowered Evocation has no correct type to author.
- **Two rider filters have no producer and fail closed:** `RiderContext.spellSchool`
  (`packages/rules-5e/src/riders.ts`) is set by nothing, so `spell-school-is` never matches; and
  `attackKindsOf` never yields `"spell"`, so `attack-kind-is: ["spell"]` never matches. **Both are
  authorable in the editor today** (`RiderEditor.tsx` renders both) — the mirror image of the usual
  defect.
- **A `damage-type-is` rider cannot fire on a save-only action** — `riderFilters.damageTypes` is
  populated only inside the `action.attack && targets.length === 1` branch of `action-resolution.ts`.
- **`weaponProficiencies` qualified slugs** `martial-light` and `martial-finesse-or-light` are consumed
  by nothing, and `WEAPON_GRANT_SUGGESTIONS` (`RiderEditor.tsx:606`) offers only
  `["simple-weapons", "martial-weapons"]`.

### 2.7 Three ledger/plan claims I measured as **stale** — fix or delete them

**These are findings, not tasks for this phase — but leaving them makes the next agent re-solve
something that is already done.**

- **`[content/feats]` "All seven Epic Boon feats … none of them sets `maximum`" is FALSE at HEAD.**
  Measured: all seven `boon-of-*` records in `packages/content-srd-5.2.1/bundles/feats.v1.json` carry
  `maximum: 30`. Delete the entry. Its claim that
  `apps/server/test/warlock-sorcerer-wizard.test.ts` "pins the current value at 20" also needs a
  re-read — that file's comments now describe the fixed behaviour.
- **`[testing]` "Only the choice-bearing ones (46 of 185) carry structured riders" is stale.**
  Measured at HEAD by walking the bundles: **176 class features + inline options, 120 carry a
  mechanic, 0 stubs**; **61 subclass features, 38 carry a mechanic, 0 stubs**. Rewrite with the real
  numbers or delete.
- **The plan's "`extraPicks` known limit: `amount` is a flat 1–5; level-scaled capacity is not yet
  expressible" is stale.** `ExtraPickSchema.scaling = {type: "class-resource-growth", id}` ships
  (`character-content.ts:314-350`, `packages/domain/src/pick-budget.ts`) and is authored by
  `warlock.ts:52`, `fighter.ts:23` and `barbarian.ts:70`.

---

## Part 3 — the split

**Definitions used here**, stated because the useful boundary is not the obvious one:

- **SHARED** — needs **new vocabulary** (a new field, or a new engine capability) that a class feature
  and a homebrew author both need. Build these as whole units: engine reader + SRD content + editor
  control + a test through both paths.
- **HOMEBREW-ONLY** — **no new vocabulary.** The gap is on the homebrew path alone. Each row names
  which half is missing, because both directions occur and they are not the same job.
- **CLASS-ONLY** — genuinely no homebrew analogue, or no homebrew *reach*: the shape cannot be
  authored from the editor at all today.

**Counts: 8 SHARED · 11 HOMEBREW-ONLY · 5 CLASS-ONLY.**

### SHARED — 8 units

| # | Unit | Unblocks (class) | Why a homebrew author wants it |
|---|---|---|---|
| **S1** | **`speed` effect modifier** — `EffectModifierSchema` + `condition-rules.ts:effectiveSpeedFeet` + projection + an editor row | mastery `slow` (7 weapons); every "your Speed changes" feature now prose — Monk's `unarmored-movement` column is `display: true` and read by nothing | Boots of Speed, a Slow spell, a cursed item. The single most obvious missing effect modifier. |
| **S2** | **Target-scoped effects** — an "applies against this creature" field on `EffectInstanceSchema`, honoured by the advantage collector, swept by `effects.ts` | mastery `vex` (8 weapons — the largest single mastery) | "Advantage on your next attack against a creature you hit." A whole SRD family. Today `versus-*` narrows by type/size/condition and never identity. |
| **S3** | **Weapon-swing override (die + ability)** | Monk weapons (2.1) — the largest visible class-content gap left | "This weapon rolls 1d8 in place of its normal damage"; "you may use Dexterity with this weapon." Exactly what a magic weapon says. |
| **S4** | **Bonus-action component pools** (`multiattack` on `activation: "bonus-action"`) + the **`multiattack` editor control, which does not exist at all** | Flurry of Blows (2.2), mastery `nick` (4 weapons) | "As a bonus action, make two attacks with this." An item action or homebrew feature says this constantly. |
| **S5** | **Widening a budget's source list** (`widensPicks`) | Row 55, Bard's Magical Secrets (2.3) | "My subclass may prepare from the Druid list too." The third member of the `extraPicks`/`replaces` family. |
| **S6** | **`minSpellLevel`** — plus **a `maxSpellLevel` control, which also does not exist** | Warlock's four Mystic Arcanum rows | "Choose a spell of exactly level N." Cheapest SHARED unit here. |
| **S7** | **`extra-damage` "same type as the triggering damage"** | Evoker's Empowered Evocation | "+2 damage of whatever type this weapon deals" — unsayable today, `damageType` is required. |
| **S8** | **Rider producers for `spell-school-is` and `attack-kind-is: ["spell"]`**, and **the `damage-type-is` filter set built for both branches** of `action-resolution.ts` | Innate Sorcery, Empowered Evocation, Draconic Sorcery's Elemental Affinity | **All three are authorable in the editor right now and silently do nothing.** The mirror-image defect: editor-complete, engine-starved. |

**Reasoning on the marginal calls.** S3 and S4 are SHARED rather than CLASS-ONLY because both are
*item-shaped* promises in the SRD's own language — a weapon that changes its die, an action that
buys two swings — and the homebrew editor is the natural place to say them. S6 and S7 are SHARED
because their homebrew half is a *control* that ships in the same unit as the schema, so splitting
them would guarantee a half-wired landing. S8 is SHARED because the class content and the homebrew
editor are equally affected and neither can be fixed without the other's test.

### HOMEBREW-ONLY — 11 units

**Missing half: a CONTROL** (the engine reads it; nothing can author it)

| # | Unit | Evidence | Size |
|---|---|---|---|
| **H1** | **Effect `modifiers`** — `effectsField` (`RiderEditor.tsx:542-562`) offers name, tags, duration, rounds, concentration and **nothing else**, so **every effect a GM authors is mechanically empty**, while `takeEffects` (`equipment-derivation.ts:583-597`) is a reader that starves | reader confirmed; also the only way a GM authors a damage resistance, which `3d`/`4a` make newly meaningful | M |
| **H2** | **`extraPicks` (+ `class-resource-growth` scaling)** — full engine reader, authored across the SRD bundles, **no control** | `character-content.ts:566`/`:638`; grep finds no `extraPicks` in `apps/client/src` | S–M |
| **H3** | **`replaces`** — wired end to end (`actor.rechoose` in `game-operations.ts:1890`, `actor.choiceOverrides`, cleared by `rests.ts:62-99`, projected at `projections.ts:283`, `apps/server/src/choice-overrides.ts`) — **no control** | grep finds no `replaces` in `apps/client/src` | S–M |
| **H4** | **`choices` (multi-pick)** — both consumers read it; `FeatureEditor.tsx` renders exactly one singular `choice` | see N2 | S |
| **H5** | **`weapon.mastery` on a homebrew weapon** — on the wire since `c2fef2e`, **no control** | see N1 | XS, **gate it** |
| **H6** | **`recharge` on `uses.per`** — the engine implements recharge fully; `RiderEditor.tsx:493` offers four options and not `recharge`. Item/action scope only — `FeatureUsesSchema.per` has no `recharge` member | the client's `3c` Expected names the recharge basis | S |
| **H7** | **`3a` rarity picker** | Part 1 | S |
| **H8** | **`3d` damage-type pickers ×9** | Part 1 | S |
| **H9** | **`3b`(a) "Uses are" `read`** | Part 1 | S (five lines) |
| **H10** | **`3b`(b) pool binding** — `uses.pool` **and** `resource-bonus.poolId`; leaving the second is a guaranteed re-open | Part 1 | M |

**Missing half: a READER** (the control exists; the engine never looks)

| # | Unit | Evidence | Size |
|---|---|---|---|
| **H11** | **`3c` — the mace.** Bug 1 (item-level `uses` unread) and bug 2 (extra damage resolves, never renders; and a freshly added item is never equipped) | Part 1 | L |

Also fix in whichever unit touches the file: **`maxRows: 1` on item effects** (`RiderEditor.tsx:547`)
cites an engine limit that is **real for features** (`character-build.ts:538` takes `effects[0]`) and
**false for items** (`takeEffects` iterates all). Make the cap scope-dependent and fix the copy.

### CLASS-ONLY — 5 units

| # | Unit | Why no homebrew analogue |
|---|---|---|
| **C1** | **Row 24 pass ordering** (ruling E's fourth pass) | **Measured:** the homebrew editor caps option depth at 1 — an option row carries riders but never its own nested `choice` (`FeatureEditor.tsx:555-556`, stated in its own comment). So this shape cannot be authored from the editor at all. If a nested-option choice control is ever added, it hits this wall on day one. |
| **C2** | **Masteries `topple`, `cleave`, `push`** | A closed 8-slug enum. Implementing them adds **no new authorable vocabulary** — it makes an existing slug work. H5's control is what turns them into homebrew value, which is exactly why H5 must not ship first. |
| **C3** | **Leveled-spell actions / "which pool pays for this spell"** | The homebrew item path **already models this** — a cast row carries `consumesSpellSlot` (`RiderEditor.tsx`, `newRow`). The character path does not. Copy the item's shape; do not invent a second one. |
| **C4** | **Cantrip damage scaling** (`spellEffectAt` + `cantripActionFor`) | The rows already exist in SRD content; the homebrew half (`castingOptions` on a homebrew spell) is deliberately deferred in the superseded plan and belongs with Area 1's spell work. |
| **C5** | **`overlay.ts` exposing `choices`; qualified `weaponProficiencies` slugs** | Both are ETL/content-pipeline shapes with no editor surface. |

---

## Part 4 — sequencing and risk

### The commit rule

**One vocabulary item per agent, per commit.** Three agents died mid-flight this session carrying too
much, and one nearly committed a non-vacuity probe that had deleted Druid's `primal-order`. Every unit
above is sized so a single agent can land it in one commit with its both-path test. **If a unit cannot
be described in one sentence naming its reader, its content, its control and its test, split it before
starting.** The only unit here that is over that line is **H11 (`3c`)**, which is two independent bugs
— split it as `3c`(1) and `3c`(2) and commit them separately.

### Recommended order

**Wave 0 — free wins that unblock the measuring (a day, one agent).**
1. **H9** `3b`(a) — five lines, and it makes every `uses` block in the phase testable by hand.
2. **S8's cheapest third** — build `riderFilters.damageTypes` once for both branches of
   `action-resolution.ts`. ~¼d, and it is the smallest real bug in the list.
3. **H7** `3a` — because it decides where `RARITY_IDS` lives, which **H8** then depends on.

**Wave 1 — the authoring surface, before anything is authored against it.**
4. **H8** `3d` — *must* land before Area 3's `4a`, or the damage engine is built against hand-typed
   data and there is no clean joint test.
5. **H1** effect `modifiers` — unblocks every subsequent unit that wants a GM-authored effect to
   prove itself, **S1** and **S2** included. Highest unblocking-per-day in the document.
6. **H6** recharge, **H4** `choices` — both ride the files H1 and H8 are already open in.

**Wave 2 — the vocabulary the classes are waiting on.**
7. **S6** `minSpellLevel` + the `maxSpellLevel` control — cheapest SHARED unit; closes four Warlock rows.
8. **S1** `speed` modifier — unblocks mastery `slow` (7 weapons) *and* an entire prose family.
9. **S5** `widensPicks` — closes row 55 and completes the `extraPicks`/`replaces` family, so the
   editor's pick-budget section can be built once rather than twice.
10. **H2** `extraPicks` + **H3** `replaces` controls — land immediately after S5, in the same section
    of the editor, so the family ships as a family.

**Wave 3 — combat surface.**
11. **H11** `3c`(1) then `3c`(2) — the client's own reported issue; do it once `uses` has a working
    "Uses are" control (H9) and recharge (H6) so the mace can actually be authored as reported.
12. **S3** weapon-swing override — closes Monk weapons.
13. **S4** bonus-action pools — closes Flurry of Blows *and* mastery `nick`.
14. **S2** target-scoped effects — closes mastery `vex` (8 weapons, the largest).
15. **S7** `extra-damage` same-type.

**Wave 4 — the remaining masteries, in ascending risk.**
16. **C2** `topple` → `cleave` → `push`. Then and only then, **H5** — the homebrew `weapon.mastery`
    control, which must not ship while it would offer six slugs that do nothing.

**Deferred / not this phase:** **C1** (row 24 pass ordering — a fourth build pass is its own change),
**C3**, **C4**, **C5**.

### Hard-invariant flags

| Unit | Invariant | What to watch |
|---|---|---|
| **C2 `push`** | **Server authority** + **projection** + **mobile parity** | The attack path would write a token position, which today only `apps/server/src/token-placement.ts` does. It must go through the same snapping, the same footprint rules and the same fog recomputation (`apps/server/src/fog.ts`) — a second position writer is how a client-authoritative move gets in. And a forced move that lands off-screen on a phone is a mobile-parity failure the desktop never sees. **Largest risk in the document; schedule it last and alone.** |
| **S2 target-scoped effects** | **Projection is the security boundary** | An effect that names a *target actor id* puts a new id on the wire. `projections.ts:247` already strips `sourceActorId` from player-visible effects; the new field needs the same treatment or a player learns which hidden monster the GM is aiming at. **Adding it is a viewer-safety change** — pair the unit with a `docs-viewer-safety` review. |
| **S1 `speed` modifier** | **Server authority** | Speed is consumed by the movement budget (`movement-rules.ts:68` → `condition-rules.ts:44`). The client must not recompute it; the derived value ships in the projection or nowhere. |
| **S4 bonus-action pools** | **Role boundaries** | The economy is the thing that refuses a player's off-turn action. Widening it must not widen *who* may act — the `onOwnTurn` guard stays. |
| **H10 pool binding** | **Projection** | The pool list must be scoped through `catalogFor(principal)` or a player learns the GM's unpublished homebrew pool names. |
| **H1, H8** | **Mobile parity** | Both add controls to `/homebrew`, which the round-2 route audit already reports red on. Re-run `node scripts/tap-audit.mjs 375`; the count must not rise. |

---

## Part 5 — findings neither the plan nor the ledger records

**N1 — `weapon.mastery` is on the wire with no editor control. The eighth built-but-unwired of the
session, and it is three days old.** Commit `c2fef2e` (two commits before HEAD) added `mastery` to
`EquipmentWeaponStatsSchema` (`packages/content-srd-5.2.1/src/schemas.ts:233`), which flows to
`HomebrewEquipmentWeapon` in the generated OpenAPI document
(`packages/api-contract/src/index.ts:2231`), and its own message says *"a GM authoring a homebrew
weapon should be able to give it a mastery."* **There is no such field.** The weapon block in
`apps/client/src/homebrew/schemas.ts:739-746` is five rows — category, damage dice, damage type, range,
long range — and none is `mastery`. `WEAPON_MASTERY_IDS` is *already imported* into
`apps/client/src/homebrew/useSchemaContext.ts:17` for the `weapon-property-is` trigger, so the
vocabulary is in hand and the control is one line. Both parity directions passed; a control has no
parity direction to catch it.

**N2 — three Stage-4 vocabulary items have an engine reader and SRD content and no editor control.**
Measured: `FeatureEditor.tsx` renders exactly one singular `choice` with kind / choose / repeatable /
`fromCatalog` / `from` / `options`. Grep finds **no** `extraPicks`, **no** `replaces`, **no** `choices`,
**no** `maxSpellLevel`, **no** `grantedAtLevels` anywhere under `apps/client/src`. All are on
`FeatureRecordSchema` and `FeatureOptionSchema` (`character-content.ts:566-568`, `:638-640`), which the
homebrew feature, feat, species and background editors write. `replaces` is the sharpest case: it is
wired end to end through a command, actor state, rest clearing and a gated projection — and a GM
cannot author one.

**N3 — two rider filters are the mirror defect: editor-complete, engine-starved.** `spell-school-is`
and `attack-kind-is: ["spell"]` both render in `RiderEditor.tsx` and both fail closed. This is the
failure mode the "one unit" rule does *not* catch if the rule is read as "always add the control" —
it must be read as "prove the value moves a number, from both ends." Worth stating in the phase's
acceptance bar.

**N4 — the inert masteries cover 30 of 38 weapons.** Measured from the bundle. No document carries
this number, and it changes the priority of `vex` (8) and `slow` (7) relative to `graze` (2) and
`cleave` (2).

**N5 — `3c` bug 1 is cheaper than the superseded plan sized it**, because the equipped loop already
holds `catalog.equipmentRecord(entry.item.id)` at `equipment-derivation.ts:644` for the mastery lookup.

---

## Acceptance bar for the phase

1. **The client's mace works as reported**: 1 use per short rest, +1d6 lightning, and the sheet shows
   both damage lines **before** the roll — proved with a rolled number, a spent counter, a refusal
   naming `1/short rest`, and a re-arm on a short rest. (The H4 bar from the superseded plan; keep it.)
2. **Every rarity and damage-type control is a visible dropdown that still accepts a custom value**,
   and "Uses are" survives a reload.
3. **No unit ships one-ended.** For each SHARED unit, one test drives the SRD path and one drives the
   homebrew path, and each fails when its own consumer is disabled. Non-vacuity is *measured* per unit,
   not asserted.
4. **`masteryReaches` is the honest gate throughout.** A slug is added to `IMPLEMENTED_MASTERIES` in
   the same commit that adds its behaviour and its test, never before.
5. **`node scripts/tap-audit.mjs 375` on `/homebrew` does not rise**, and every new control is checked
   at a narrow viewport.
6. **The three stale claims in §2.7 are fixed or deleted** in the commit that proves them stale.
