# Vocabulary parity audit — schema · engine · SRD content · homebrew editor

**Status: active. This is a scoping instrument, not a narrative.** Every row is a claim about four
independent things, each checkable against a named `file:line`. Where this document and the code
disagree, the code is truth and the row is a defect.

## Why it exists

This session built a large rider / choice vocabulary for SRD class content. "Built-but-unwired" bit
seven times: a mechanism ships, typechecks, passes its own tests **through exactly one consumer**,
and is inert everywhere else. The purest case was `choices`, reachable from `feats.v1.json` and a
hard compile error from all twelve class modules.

The homebrew editor is a **second, independent consumer** of the same vocabulary. Anything both the
SRD overlay and the editor can express is exercised twice, and "works here, inert there" stops being
invisible. This audit measures how far that second consumer actually reaches.

## The three things this document refuses to conflate

1. **A field in a type** — a key exists on a Zod schema. Nothing follows from this.
2. **A control** — a `FieldDef` (or bespoke JSX) that a GM can actually touch. *A field that exists
   in the type but has no control is NOT exposed.*
3. **A reader** — the line that consumes the value **at the moment it should fire**. A value that is
   collected into a derivation struct and never applied is **not** a reader; those rows are called
   out by name below.

## Verdicts

| Verdict | Means |
| --- | --- |
| `parity` | Engine reads it · SRD content authors it · the editor has a control |
| `SRD-only` | Engine reads it · SRD content authors it · **no editor control** |
| `editor-only` | Engine reads it · editor has a control · **no SRD record authors it** |
| `declared, no reader` | Schema declares it; **nothing consumes it at its moment**. Inert. |
| `unused` | Engine reads it, but **neither** SRD content nor the editor authors it |

`declared, no reader` takes precedence over everything else: an inert row's editor status is
irrelevant to whether it works.

## Headline counts

**170 vocabulary items audited**, across nine families (sections A–I).

| Verdict | Count | Section split |
| --- | ---: | --- |
| `parity` | 66 | A 8 · B 6 · C 10 · D 14 · F 4 · G 8 · H 6 · I 10 |
| `SRD-only` | 41 | A 17 · B 3 · C 3 · E 3 · F 1 · H 13 · I 1 |
| `editor-only` | 30 | D 12 · F 1 · G 17 |
| `declared, no reader` (inert) | 16 | D 8 · G 7 · I 1 |
| `unused` | 17 | A 2 · E 6 · F 4 · H 5 |

Two readings, and they land on the same number from opposite directions:

- **Of the 154 items with a working engine reader, 96 have an editor control (62%).** The 58 that do
  not are the scope of the next phase.
- **Of the 107 items SRD content actually authors, 66 have an editor control (62%).** A GM can
  express under two thirds of the mechanics the shipped bundles use — and the missing third is not
  scattered: **41 of those 41 `SRD-only` rows concentrate in two families**, the pick/choice
  vocabulary (17) and the action vocabulary (13).

The `editor-only` column is the mirror-image warning. 30 items are offered to a GM and exercised by
no shipped record — 17 of them are rider gates and 12 are magic-item riders, because
**`equipment.v1.json` contains zero records with a `modifiers` block.** Those rows pass their own
tests through one consumer (the editor's own publish gate) and nothing else.

---

# A. Pick and choice vocabulary

The carrier is `FeatureRecord` (`packages/content-srd-5.2.1/src/character-content.ts:623`) and
`FeatureOption` (`:538`). The editor's surface for this whole family is `FeatureEditor.tsx`, which is
bespoke JSX, not a `FieldDef` list.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `FeatureRecord.level` | `character-content.ts:627` | `apps/server/src/character-build.ts:687` (grant rows) | all | `apps/client/src/homebrew/FeatureEditor.tsx:336` (20 chips) | `parity` |
| `FeatureRecord.choice` | `:630` | `character-build.ts:940` via `featurePicks` (`character-content.ts:523`) | 99 | `FeatureEditor.tsx:388` | `parity` |
| `FeatureRecord.choices` (plural) | `:636` | `character-build.ts:940`; `apps/client/src/builder/build-payload.ts:435` | 3 | **none** | `SRD-only` |
| `FeatureRecord.extraPicks` | `:638` | `character-build.ts:1075`; `build-payload.ts:429` | 6 | **none** | `SRD-only` |
| `FeatureRecord.replaces` | `:640` | `character-build.ts:1245`; `apps/server/src/choice-overrides.ts:65` | 2 | **none** | `SRD-only` |
| `FeatureRecord.replacesFeatureId` | `:643` | `character-build.ts:687` | 3 | **none** | `SRD-only` |
| `FeatureChoice.kind` | `:412` | `character-build.ts:1034` | 99 | `FeatureEditor.tsx:399` | `parity` |
| `FeatureChoice.choose` | `:413` | `character-build.ts:1034` (capacity `choose × grants`) | 99 | `FeatureEditor.tsx:414` | `parity` |
| `FeatureChoice.from` | `:419` | `character-build.ts:1032` | 28 | `FeatureEditor.tsx:510` | `parity` |
| `FeatureChoice.fromCatalog` | `:421` | `packages/domain/src/catalog-choice.ts:82`; `character-build.ts:1032` | 85 | `FeatureEditor.tsx:444` | `parity` |
| `FeatureChoice.fromPicks` | `:438` | `character-build.ts:959`; `catalog-choice.ts:194` | 3 | **none** | `SRD-only` |
| `FeatureChoice.maxSpellLevel` | `:443` | `character-build.ts:170`; `build-payload.ts:446` | 16 | **none** | `SRD-only` |
| `FeatureChoice.minSpellLevel` | `:455` | `character-build.ts:173`; `build-payload.ts:452` | 4 | **none** | `SRD-only` |
| `FeatureChoice.maximum` | `:466` | `character-build.ts:1340` (the ASI ceiling clamp) | 7 | **none** | `SRD-only` |
| `FeatureChoice.repeatable` | `:468` | `character-build.ts:1035` | 18 | `FeatureEditor.tsx:570` | `parity` |
| `FeatureChoice.options` | `:594` | `character-build.ts:1023`; `optionAsFeature` `:203` | 17 | `FeatureEditor.tsx:527` (id · name · description · riders only) | `parity` |
| `FeatureOption.requires` | `:560` | `character-build.ts:1023`; `build-payload.ts:477` | 8 | **none** | `SRD-only` |
| `FeatureOption.choice` | `:562` | `character-build.ts:216` (via `optionAsFeature`) | 7 | **none** | `SRD-only` |
| `FeatureOption.choices` | `:564` | `character-build.ts:216` | 0 | **none** | `unused` |
| `FeatureOption.extraPicks` | `:566` | `character-build.ts:211` → `:1075`; `build-payload.ts:535` | 2 | **none** | `SRD-only` |
| `FeatureOption.replaces` | `:568` | `character-build.ts:212` → `:1245` | 0 | **none** | `unused` |
| `ExtraPick.offer` | `:315` | `character-build.ts:1075` (rejects a key no budget matches) | 8 | **none** | `SRD-only` |
| `ExtraPick.amount` | `:316` | `packages/domain/src/pick-budget.ts:59` | 5 | **none** | `SRD-only` |
| `ExtraPick.scaling` (`class-resource-growth`) | `:337` | `pick-budget.ts:45` | 3 | **none** | `SRD-only` |
| `ReplaceableChoice.offer` | `:403` | `choice-overrides.ts:65`; `character-build.ts:1245` | 2 | **none** | `SRD-only` |
| `ReplaceableChoice.when` | `:404` | `choice-overrides.ts:65`; `apps/server/src/rests.ts:87` / `:99` | 2 | **none** | `SRD-only` |
| `ReplaceableChoice.amount` | `:405` | `character-build.ts:1245` | 2 | **none** | `SRD-only` |

**Nothing in this family beyond a single `choice` is authorable.** The editor's choice surface is
one `choice` object; `choices`, `extraPicks`, `replaces`, `replacesFeatureId`, the spell-level window,
the ASI ceiling, `fromPicks`, and every option-level rider beyond the plain rider block are all
unreachable. **This is the family that started this area** — see the cheap batch below.

---

# B. Uses vocabulary

`FeatureUsesSchema` (`character-content.ts:68`) for features; `ActionUsesSchema`
(`packages/schemas/src/index.ts:579`) for a monster's or item's action.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `uses.limit` | `character-content.ts:69` | `character-build.ts:323`; `apps/server/src/effective-actions.ts:113` | 42 | `apps/client/src/homebrew/RiderEditor.tsx:454` | `parity` |
| `uses.scaling: proficiency-bonus` | `:71` | `character-build.ts:325` | 20 | `RiderEditor.tsx:431` | `parity` |
| `uses.scaling: ability-modifier` | `:72` | `character-build.ts:326` | 7 | `RiderEditor.tsx:472`, `:473` | `parity` |
| `uses.scaling: by-level` | `:73` | `character-build.ts:334` | 4 | `RiderEditor.tsx:475` | `parity` |
| `uses.scaling: class-resource` | `:84` | `character-build.ts:327`–`:332` | **19** | `RiderEditor.tsx` `usesField` — the fifth `mode` option + `uses.scaling.id`, **feature scope only** (U7) | `parity` |
| `uses.per` | `:86` | `rests.ts:77`; `apps/server/src/encounter.ts:24` | 92 | `RiderEditor.tsx:490` | `parity` |
| `uses.pool` | `:87` | `effective-actions.ts:113`, `:154`; `rests.ts:78`; `apps/server/src/action-resolution.ts:177` | 40 | `RiderEditor.tsx:499` | `parity` |
| `ActionUses` on an action | `packages/schemas/src/index.ts:603` | `action-resolution.ts:239`, `:413`, `:1237` | 114 | `actionUsesField` inside `actionsField` (U8) — every carrier that mounts an action | `parity` |
| `ActionUses.per: "recharge"` + `recharge` | `packages/schemas/src/index.ts:603` | `rests.ts:77`; `encounter.ts:281`–`:301` | 86 | `actionUsesField`'s fifth `per` option + the threshold row (U8) | `parity` |

`class-resource` was the single highest-count gap in this family: 19 SRD features read the printed
class column for their use count (Rage, Wild Shape, Channel Divinity, the eight Metamagics), and a
homebrew class could not say it — it had to duplicate its own printed table into a `by-level` list
beside the table. **U7 closed it at FEATURE scope, and the scope is a measurement.** `scaledLimit`
(`equipment-derivation.ts`) answers `undefined` for `class-resource` in writing — a built definition
no longer carries a class table — so an item authored this way would grant no charges however the GM
filled it in. The row this audit filed under `equipment` is authored 19 times by class and subclass
features and 0 times by items, and the one carrier it named is the one carrier that cannot read it.

**`recharge` was filed under the same wrong carrier, and U8 corrected it the same way.** The row
this document names as `equipment.uses.recharge` is an ITEM's record-level `uses`, which is
`FeatureUsesSchema` — four `per` values, no threshold key. Widening it was measured and rejected
twice over: (1) an item's record-level `uses` **has no reader at all today** — `usesOf` has exactly
two call sites, an action's uses and a cast's, and the equipped loop never reads `record.uses`
(that is U24); and (2) the same schema is shared with FEATURES, where `character-build.ts` folds a
feature's uses into an action at **two** sites (`interpretAction`'s "the FEATURE's limited uses ride
the action", and the synthesised-activation path) and **neither forwards a threshold** — so a
feature authoring `per: "recharge"` would build `{limit, per: "recharge"}` and `ActionUsesSchema`
refuses it by name, turning a schema-valid record into an unbuildable character. The control
therefore went to the ACTION's `uses`, which is `ActionUsesSchema`, which is what the 86 SRD authors
use and what `encounter.ts` reads.

---

# C. Grants vocabulary

`FeatureGrantsSchema` (`character-content.ts:156`). Read at `character-build.ts:542`–`:554` for a
feature carrier and `apps/server/src/equipment-derivation.ts:566` for an item carrier. The editor's
`GrantsEditor` (`RiderEditor.tsx:618`) collapses ten of the eleven arrays into one list.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `grants.skills` | `:157` | `character-build.ts:543`; `equipment-derivation.ts:569` | ✓ | `RiderEditor.tsx:577` | `parity` |
| `grants.expertise` | `:158` | `character-build.ts:544`; `equipment-derivation.ts:570` | ✓ | `RiderEditor.tsx:578` | `parity` |
| `grants.tools` | `:159` | `character-build.ts:545`; `equipment-derivation.ts:572` | ✓ | `RiderEditor.tsx:579` | `parity` |
| `grants.languages` | `:160` | `character-build.ts:546`; `equipment-derivation.ts:573` | ✓ | `RiderEditor.tsx:580` | `parity` |
| `grants.armor` | `:161` | `character-build.ts:547`; `equipment-derivation.ts:578` | ✓ | `RiderEditor.tsx:581` | `parity` |
| `grants.weapons` | `:162` | `character-build.ts:548`; `equipment-derivation.ts:579` | ✓ | `RiderEditor.tsx:582` | `parity` |
| `grants.saves` | `:163` | `character-build.ts:549`; `equipment-derivation.ts:571` | ✓ | `RiderEditor.tsx:583` | `parity` |
| `grants.damageResistances` | `:164` | `character-build.ts:550`; `equipment-derivation.ts:574` | ✓ | `RiderEditor.tsx:584` | `parity` |
| `grants.damageImmunities` | `:165` | `character-build.ts:551`; `equipment-derivation.ts:576` | ✓ | `RiderEditor.tsx:585` | `parity` |
| `grants.conditionImmunities` | `:166` | `character-build.ts:552`; `equipment-derivation.ts:577` | ✓ | `RiderEditor.tsx:586` | `parity` |
| **`grants.spells`** | `:168` | `character-build.ts:553` (`grantedSpells`, → always-prepared). **Feature road ONLY** — `takeGrants` in `equipment-derivation.ts` folds nine grant arrays for an equipped item and `spells` is not one of them, so an item's spell grant parses and does nothing | **41** (19 class · 14 species · 8 subclass) | an eleventh `GRANT_KINDS` entry whose "Which" is a `CatalogPicker` over the merged spell catalog, not a `TagInput` — **U9, landed.** It was *preserved* on write before, never editable | `parity` |
| `grants.spells[].alwaysPrepared` | `:168` | `character-build.ts:553` | 34 (and it defaults `true`, so all 41 mean it) | written as `true` by the picker — **U9, landed** | `parity` |
| `grants.spells[].level` | `:168` | `character-build.ts:553` | 41 | **none, deliberately** — `grantedSpellEntry` resolves it from the spell record (`grantedSpell.level ?? record?.level`), which is righter than a number the editor would guess: the client's `CatalogEntry` carries prose, not a level | `SRD-only` |
| `grants.spells[].ability` | `:168` | `character-build.ts:1548` (the non-caster fallback) | **1** (`high-elf-cantrip`) | **none** — one author, and the fallback is the caster's own ability. Ships the day a second record needs it | `SRD-only` |

Ten of eleven arrays reach parity. The eleventh — domain spells, racial spells, every
"you always have X prepared" clause, 41 SRD records — is the one with no control.

---

# D. Modifiers — the feature/item rider vocabulary

`FeatureModifierSchema` (`character-content.ts:187`), 21 variants. Editor list: `MODIFIER_TYPES`
(`RiderEditor.tsx:253`) — **all 21 discriminators are offered**, so the gaps here are *sub-fields*
and *readers*, not missing variants.

`CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts:287`) is the most accurate map of
this partition in the repo, and its `"unread"` entries are load-bearing evidence below.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `ability-score` | `:189` | `character-build.ts:1369` (baked at step 5c) | 4 | `RiderEditor.tsx:363`, `:372` | `parity` |
| `ability-score.maximum` | `:189` | `character-build.ts:1369` | 4 | `RiderEditor.tsx:379` | `parity` |
| `hit-points-per-level` | `:190` | `character-build.ts:563` | 1 | `RiderEditor.tsx:372` | `parity` |
| `speed` | `:191` | `character-build.ts:564`; `equipment-derivation.ts:672` | 3 | `RiderEditor.tsx:373` | `parity` |
| `armor-class` | `:204` | `character-build.ts:568`; `equipment-derivation.ts:670` | 1 | `RiderEditor.tsx:372` | `parity` |
| `armor-class.whileArmored` | `:204` | `packages/rules-5e/src/riders.ts:225`; `character-build.ts:568` | 1 | `RiderEditor.tsx:383` | `parity` |
| `initiative` | `:205` | `character-build.ts:572`; `equipment-derivation.ts:671` | 0 | `RiderEditor.tsx:374` | `editor-only` |
| `extra-attack` | `:206` | `effective-actions.ts:101` | 7 | `RiderEditor.tsx:380` | `parity` |
| `unarmored-defense` | `:208` | `character-build.ts:573` → `:1613` | 3 | `RiderEditor.tsx:363` | `parity` |
| **`unarmored-defense.allowShield`** | `:208` | **none** — stored at `character-build.ts:573`, and `:1613` reads only `.ability` | 1 | `RiderEditor.tsx:384` (carries `note: "Not read yet."`) | `declared, no reader` |
| **`darkvision`** | `:209` | **none** — `character-build.ts:574` is an explicit no-op; `"display-only"` in the disposition table | 7 | `RiderEditor.tsx:382` (carries `note: "Display only."`) | `declared, no reader` |
| `attack-bonus` | `packages/schemas/src/index.ts:176` | `effective-actions.ts:49`; `action-resolution.ts:825` | 0 | `RiderEditor.tsx:375` | `editor-only` |
| `extra-damage.formula` | `packages/schemas/src/index.ts:202` | `action-resolution.ts:981` | 7 | `RiderEditor.tsx:385` | `parity` |
| `extra-damage.abilityModifier` | `:204` | `action-resolution.ts:971` | 6 | `RiderEditor.tsx:386` | `parity` |
| `extra-damage.damageType` | `:205` | `action-resolution.ts:974` | 7 | `RiderEditor.tsx:387` | `parity` |
| `extra-damage.doubleOnCritical` | `:206` | `action-resolution.ts:981` | 0 | `RiderEditor.tsx:388` | `editor-only` |
| `roll-mode` roll `attack` / `incoming-attack` | `:216` | `action-resolution.ts:576`, `:581` | 6 | `RiderEditor.tsx:389` | `parity` |
| `roll-mode` roll `save` | `:216` | `apps/server/src/saving-throws.ts:55` | ✓ | `RiderEditor.tsx:389` | `parity` |
| `roll-mode` roll `initiative` | `:216` | `encounter.ts:57`, `:62` | 0 | `RiderEditor.tsx:389` | `editor-only` |
| **`roll-mode` roll `check`** | `:216` | **none** — no call site filters on `roll === "check"` | 0 | `RiderEditor.tsx:389` | `declared, no reader` |
| **`roll-mode` roll `death-save`** | `:216` | **none** — `apps/server/src/death-saves.ts:44` reads only the caller's chosen mode | 0 | `RiderEditor.tsx:389` | `declared, no reader` |
| **`roll-mode` roll `concentration`** | `:216` | **none** | 0 | `RiderEditor.tsx:389` | `declared, no reader` |
| `save-bonus` | `character-content.ts:216` | `saving-throws.ts:66` | 0 | `RiderEditor.tsx:375` | `editor-only` |
| `check-bonus` | `:218` | `equipment-derivation.ts:773`; `apps/server/src/actor-derived.ts:91`, `:94` | 0 | `RiderEditor.tsx:375` | `editor-only` |
| `spell-save-dc` | `:220` | `effective-actions.ts:51` | 0 | `RiderEditor.tsx:372` | `editor-only` |
| **`spell-attack-bonus`** | `:222` | **none that applies it** — collected into `equipment-derivation.ts:676` and read by no spell-attack path; `"unread"` in the disposition table | 0 | `RiderEditor.tsx:372` | `declared, no reader` |
| `spell-slot` | `:224` | `apps/server/src/actor-roster.ts:169`; `apps/server/src/spellcasting.ts:22` | 0 | `RiderEditor.tsx:376`, `:392` | `editor-only` |
| `resource-bonus` | `:231` | `effective-actions.ts:114` | 0 | `RiderEditor.tsx:377`, `:393` | `editor-only` |
| `critical-range` | `:233` | `effective-actions.ts:121` | 2 | `RiderEditor.tsx:394` | `parity` |
| `critical-bonus-dice` | `:235` | `effective-actions.ts:50` | 0 | `RiderEditor.tsx:381` | `editor-only` |
| **`damage-reduction`** | `:237` | **none** — no incoming-damage path collects riders; `"unread"` in the disposition table | 0 | `RiderEditor.tsx:378` | `declared, no reader` |
| **`sense`** | `:239` | **none** — `"display-only"` in the disposition table, and nothing displays it | 1 | `RiderEditor.tsx:395`, `:396` (carries `note: "Display only."`) | `declared, no reader` |
| `classId` (on `spell-save-dc` / `spell-attack-bonus`) | `:220`, `:222` | `equipment-derivation.ts:686` | 0 | `RiderEditor.tsx:391` | `editor-only` |
| `scope` (`bearer` / `this-item`) | `packages/schemas/src/index.ts:164` | `packages/rules-5e/src/riders.ts:232` | 0 | `RiderEditor.tsx:399` (only on a weapon, only for the attack/damage/crit family) | `editor-only` |

**The SRD authors no magic items with riders at all** — `equipment.v1.json` contains zero `modifiers`
blocks. Every `editor-only` verdict above is that fact: the rider is real, the engine reads it, the
editor offers it, and no shipped record exercises it. That is exactly the shape "built-but-unwired"
takes on the other side of the mirror.

---

# E. Modifiers — the effect-only vocabulary

`EffectModifierSchema` (`packages/schemas/src/index.ts:232`). These are legal **inside**
`effects[].modifiers`, which has no control at all (section F), so every row here is unauthorable
from the editor by construction.

**This union is NOT `FeatureModifierSchema`** — a distinction the "mount `modifiersField(...)`"
recommendation in §1 below got wrong, corrected there. The two overlap by exactly three members
(`attack-bonus`, `extra-damage`, `roll-mode`, declared once in `@vtt/schemas` and spread into both);
`FeatureModifierSchema`'s other eighteen are illegal inside an effect and this union's other nine are
illegal outside one. U6's control is therefore its own list, not a re-mount.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `damage-bonus` | `:233` | `action-resolution.ts:924` | 0 | **none, and deliberately** — `asRiderModifiers` (`equipment-derivation.ts:718`) returns nothing for it in writing, so on an ITEM carrier it is inert by construction; a control would be a box that does nothing | `unused` |
| `damage-resistance` | `:234` | `equipment-derivation.ts:591` | 2 (Superior Defense) | `effectModifiersField` (`RiderEditor.tsx`) — **U6, landed** | `parity` |
| `attack-advantage` | `:235` | `action-resolution.ts:545` | 1 (Reckless Attack) | `effectModifiersField` — **U6, landed** | `parity` |
| `incoming-attack-advantage` | `:236` | `action-resolution.ts:554` | 1 (Reckless Attack) | `effectModifiersField` — **U6, landed** | `parity` |
| `attack-disadvantage` | `:238` | `packages/schemas/src/index.ts:261` → `action-resolution.ts:545` | 0 | **none** — `roll-mode` is the general form and both sides normalise this into it (`toRollModes`, `asRiderModifiers`), so a second spelling is not offered | `unused` |
| `incoming-attack-disadvantage` | `:240` | `action-resolution.ts:554` | 0 (only `apps/server/src/builtin-actions.ts:41`) | **none** — as above | `unused` |
| `save-advantage` | `:242` | `saving-throws.ts:44` | 0 (only `builtin-actions.ts:41`) | **none** — as above | `unused` |
| `save-disadvantage` | `:243` | `saving-throws.ts:44` | 0 | **none** — as above | `unused` |
| shared `roll-mode` in an effect | `:246` | as section D | 0 | `effectModifiersField` — **U6, landed**; it is the general advantage/disadvantage form the four rows above normalise into | `editor-only` |
| shared `attack-bonus` / `extra-damage` in an effect | `:244`–`:245` | as section D | 0 | **none** — both already have a control on the record's own modifier list one level up; each ships the day a record authors it inside an effect | `unused` |

---

# F. Effect grants

`EffectGrantSchema` (`packages/schemas/src/index.ts:551`), carried by `featureRiders.effects`
(`character-content.ts:281`) and by `ActionSchema.grants` (`:614`). Editor: `effectsField`
(`RiderEditor.tsx:542`), capped at one row.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `effects[]` itself | `character-content.ts:281` | `character-build.ts:534`–`:538` (synthesises the activation); `equipment-derivation.ts:583` | 2 | `RiderEditor.tsx:542` | `parity` |
| `name` | `packages/schemas/src/index.ts:552` | `apps/server/src/effects.ts:117` | 2 | `RiderEditor.tsx:557` | `parity` |
| `tags` | `:553` | `effects.ts:123`; `equipment-derivation.ts:586` (`itemEffectTags`) | 2 | `RiderEditor.tsx:558` | `parity` |
| `duration` | `:554` | `effects.ts` (all transitions) | 2 | `RiderEditor.tsx:559`, `:560` | `parity` |
| **`modifiers`** | **`:584`** | **`equipment-derivation.ts:591` (`takeEffects`, the ITEM road); `action-resolution.ts:545`, `:554`, `:924` (the live-effect road).** *(This row used to name `action-resolution.ts:1075`, which is the Sap mastery minting an effect of its own, not a reader; re-measured and corrected when U6 landed.)* | **2** | `effectModifiersField`, nested inside `effectsField` (`RiderEditor.tsx`) — **U6, landed** | **`parity`** |
| `onEnd` | `:561` | `effects.ts:115` | 0 | **none** | `unused` |
| `endsWithTag` | `:563` | `effects.ts:123` | 0 | **none** | `unused` |
| `target` (`self` / `target`) | `:565` | `action-resolution.ts:680`, `:690` | 0 | **none** | `unused` |
| `voidWhileIncapacitated` | `:567` | `saving-throws.ts:44`; `action-resolution.ts:543` | 0 | **none** | `unused` |
| `concentration` | `:569` | `apps/server/src/hit-points.ts:175` | 0 | `RiderEditor.tsx:561` | `editor-only` |

> ### ~~The single highest-value row in this document.~~ Closed by U6.
>
> It was true: **`EffectGrantSchema.modifiers` had no control and defaults to `[]`, so every effect a
> GM authored was mechanically empty** — a name, some tags, a duration, and nothing that changes a
> number. The engine reads it in four places across two roads, and the SRD authors it twice (Reckless
> Attack, Superior Defense), both of them FEATURES, because `equipment.v1.json` authors no `effects`
> at all. `effectModifiersField` closes it, and the both-paths test in
> `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` is the one that crosses carriers: the
> editor half authors an ITEM's effect, the SRD half reads a FEATURE's, and one assertion body ends
> at the same kept d20.
>
> **Two things measured while closing it, both of which this document had wrong:**
>
> 1. the control is **not** a re-mount of `modifiersField` — see the note above section E's table;
> 2. `effectsField`'s `maxRows: 1` cited an engine limit that is real for a FEATURE
>    (`character-build.ts:538` takes `effects[0]`) and **false for an ITEM** (`takeEffects` iterates
>    all of them). The cap is now the carrier's: 4 on an item, 1 on a feature, 1 on a stat block —
>    where the reason is different again, since `ActorDefinitionSchema` has no record-level `effects`
>    array and a creature's effects hang off `ActionSchema.grants`, a single grant.

---

# G. Rider gates — the `when` list

`RiderTriggerSchema` (`packages/schemas/src/index.ts:54`), 31 triggers. The evaluator is one switch,
`packages/rules-5e/src/riders.ts:158`, and it **fails closed**: a trigger whose context field has no
producer never matches, silently. The editor offers **all 31** (`TRIGGER_TYPES`,
`RiderEditor.tsx:77`), so every gap here is a missing *producer*, not a missing control.

| trigger | schema | evaluator | producer of the fact it tests | SRD authors | verdict |
| --- | --- | --- | --- | ---: | --- |
| `attuned` | `:57` | `riders.ts:163` | `equipment-derivation.ts` bearer context | 0 | `editor-only` |
| `while-armored` | `:59` | `riders.ts:165` | bearer context `armorWeight` | 0 | `editor-only` |
| `while-unarmored` | `:60` | `riders.ts:167` | bearer context `armorWeight` | 0 | `editor-only` |
| `while-shield` | `:62` | `riders.ts:169` | bearer context `shieldEquipped` | 0 | `editor-only` |
| `while-character-is` | `:64` | `riders.ts:171` | bearer context `classIds` / `speciesId` | 0 | `editor-only` |
| `while-proficient-with` | `:65` | `riders.ts:174` | `equipment-derivation.ts:661` | 0 | `editor-only` |
| `while-effect-tag` | `:68` | `riders.ts:182` | `equipment-derivation.ts:414` | 0 | `editor-only` |
| `while-hp-at-or-below` | `:69` | `riders.ts:184` | bearer context `hitPointFraction` | 0 | `editor-only` |
| `while-condition` | `:70` | `riders.ts:187` | bearer context `bearerConditionIds` | 0 | `editor-only` |
| `on-attack-roll` | `:72` | `action-resolution.ts:825`, `:575` | — | 0 | `editor-only` |
| `on-hit` | `:73` | `action-resolution.ts:958` | — | 2 | `parity` |
| `on-critical-hit` | `:74` | `action-resolution.ts:959` | — | 0 | `editor-only` |
| `on-critical-miss` | `:76` | `action-resolution.ts:960` | — | 0 | `editor-only` |
| `on-damage-roll` | `:77` | `action-resolution.ts:957` | — | 5 | `parity` |
| `on-saving-throw` | `:78` | `saving-throws.ts:64` | — | 2 | `parity` |
| `on-ability-check` | `:79` | `equipment-derivation.ts:777` | — | 1 | `parity` |
| `on-initiative-roll` | `:80` | `encounter.ts:56` | — | 0 | `editor-only` |
| **`on-death-save`** | `:81` | **no `collectRiders` call site anywhere** | — | 0 | `declared, no reader` |
| **`on-taking-damage`** | `:82` | **no `collectRiders` call site anywhere** | — | 0 | `declared, no reader` |
| **`on-spell-cast`** | `:83` | **no `collectRiders` call site anywhere** | — | 0 | `declared, no reader` |
| `attack-kind-is` | `:86` | `riders.ts:192` | `action-resolution.ts:512` `attackKindsOf`; `apps/server/src/reactions.ts:98` | 1 | `parity` |
| — its `"spell"` member | `:86` | `riders.ts:192` | **nothing emits `"spell"`** — `attackKindsOf` yields melee/ranged/thrown/unarmed/reaction/opportunity only | 0 | `declared, no reader` |
| `weapon-property-is` | `:87` | `riders.ts:194` | `action-resolution.ts:807` | 0 | `editor-only` |
| `damage-type-is` | `:88` | `riders.ts:196` | `action-resolution.ts:808` | 5 | `parity` |
| `ability-is` | `:89` | `riders.ts:198` | `saving-throws.ts:54`; `equipment-derivation.ts:775` | 3 | `parity` |
| `skill-is` | `:90` | `riders.ts:200` | `equipment-derivation.ts:776` | 0 | `editor-only` |
| **`spell-school-is`** | `:91` | `riders.ts:203` | **nothing sets `RiderContext.spellSchool`** | 0 | `declared, no reader` |
| **`spell-level-is`** | `:92` | `riders.ts:205` | **nothing sets `RiderContext.spellLevel`** | 0 | `declared, no reader` |
| `spell-id-is` | `:102` | `riders.ts:207` | `action-resolution.ts:800`; minted by `character-build.ts:444` and `equipment-derivation.ts:928` | 1 | `parity` |
| **`versus-creature-type`** | `:104` | `riders.ts:209` | **nothing sets `targetCreatureType`** — the schema comment says so | 0 | `declared, no reader` (editor carries `note` at `RiderEditor.tsx:236`) |
| `versus-size` | `:105` | `riders.ts:210` | `action-resolution.ts:809` | 0 | `editor-only` |
| `versus-condition` | `:106` | `riders.ts:212` | `action-resolution.ts:810` | 0 | `editor-only` |

Structural rules — one moment per rider, a filter needs a moment (`RiderWhenSchema:142`) — are
mirrored in the editor as publish blockers via `triggerKindOf` (`RiderEditor.tsx:118`). Parity there.

---

# H. Action vocabulary

`FeatureActionSchema` (`character-content.ts:144`) for a feature; `ActionSchema`
(`packages/schemas/src/index.ts:589`) for a monster and for a derived item action. **One editor
control serves both** — `actionsField` (`RiderEditor.tsx:503`) — and that is where the sharpest
cross-carrier defect lives.

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| `id` / `name` / `activation` / `description` | `packages/schemas/src/index.ts:590` | `action-resolution.ts` throughout | 54 char · 989 monster | `RiderEditor.tsx:513`–`:518` | `parity` |
| `damage[]` | `:601` | `action-resolution.ts:940` | 19 char · 524 monster | `RiderEditor.tsx:519` | `parity` |
| `attack.ability` (feature and item) | `character-content.ts:99` | `character-build.ts:343` | derived | `toHitFields` (`RiderEditor.tsx`), at the `feature` / `item` scopes | `parity` |
| **`attack.bonus`** (monster) | `packages/schemas/src/index.ts:615` | `action-resolution.ts:836` | **423** | `toHitFields` (`RiderEditor.tsx`), at the `statblock` scope — **U10, landed.** `RiderScope` is three-valued and `actionsField` branches on it, so a stat block is offered "To hit" instead of the feature's "Uses" | `parity` |
| `attack.proficient` | `character-content.ts:100` | `character-build.ts:346` | default only | **none** | `unused` |
| `attack.reachFeet` / `.rangeFeet` | `:101`, `:102` | `action-resolution.ts:347`–`:369` (the range/reach refusals) | 376 / 68 | `actionsField`'s attack group | `parity` |
| `attack.rangeNormalFeet` | `:103` | **`action-resolution.ts:635`** — `attackRollSources`, the `Long range (beyond N ft)` disadvantage. *(This row used to name `:512`, which is `attackKindsOf` and reads only reach and range; re-measured and corrected when U11 landed.)* | 45 | `actionsField`'s attack group, every scope — **U11, landed** | `parity` |
| `attack.count` | `:104` | `effective-actions.ts:101` | 0 | **none** | `unused` |
| `attack.criticalBonusDice` | `:105` | `effective-actions.ts:50` | 0 | **none** | `unused` |
| `save.ability` | `:134` | `saving-throws.ts` | 18 char · 184 monster | `RiderEditor.tsx:535` | `parity` |
| `save.dc` as a number | `:120` | `character-build.ts:359` | 184 | `RiderEditor.tsx:536` | `parity` |
| `save.dc: "spellcasting"` | `:119` | `character-build.ts:356` | 5 | **none** — the control is a number field whose help promises "leave empty" behaviour the schema does not have (`FeatureSaveSchema.dc` is required) | `SRD-only` |
| `save.dc` derived `{base, ability, proficiencyBonus}` | `:121` | `character-build.ts:360` | 13 | **none** | `SRD-only` |
| `damageByLevel` | `:148` | `character-build.ts:364` | 15 | **none** | `SRD-only` |
| `multiattack` | `packages/schemas/src/index.ts:603` | `action-resolution.ts:185` | 126 | **none** (deliberate — `apps/client/src/homebrew/schemas.ts:834`) | `SRD-only` |
| `onHit` | `:605` | `action-resolution.ts` (condition application) | 47 | **none** (deliberate) | `SRD-only` |
| `targetRules` | `:612` | `action-resolution.ts` | 1 | **none** (deliberate) | `SRD-only` |
| `grants` (an `EffectGrant` on the action) | `:614` | `action-resolution.ts:1075` | 3 | **none** | `SRD-only` |
| `requiresEffectTag` | `:616` | `action-resolution.ts:230` | ✓ | **none** | `SRD-only` |
| `uses` | `:618` | `action-resolution.ts:236` | 114 | **none** | `SRD-only` |
| `spellSlot` | `:627` | `action-resolution.ts:324` | 0 | **none** | `unused` |
| `spellId` | `:637` | `action-resolution.ts:800` | 0 authored (minted at `character-build.ts:444`, `equipment-derivation.ts:928`) | **none** | `unused` |
| `reaction` | `:639` | `reactions.ts` | 1 | **none** (deliberate) | `SRD-only` |
| `legendary.cost` | `:641` | `action-resolution.ts:311`–`:316` | 82 | **none** — the editor offers `legendary.actionsPerRound` / `.resistancesPerDay` (`schemas.ts:848`, `:849`) but never the per-action cost | `SRD-only` |

> **~~A monster action with an attack roll cannot be published from the editor.~~ Closed by U10.**
> It could not: `actionsField` wrote `attack.ability`, `ActionSchema.attack` requires `bonus`
> (`packages/schemas/src/index.ts:615`) and the monster body is validated by `ActorDefinitionSchema`
> (`HOMEBREW_BODY_SCHEMAS`, `packages/content-srd-5.2.1/src/schemas.ts:407`), so the GM filled in
> "Uses: Strength" and the publish gate answered `actions[].attack.bonus: Required`. One control, two
> schemas, one of them wrong. The repair is the one §3 item 4 below recommends — `RiderScope` gained
> a third value, `"statblock"`, and `actionsField` now takes it. Pinned end to end by
> `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts`.

---

# I. Record-level riders and the rest

| item | schema | engine reader | SRD authors | editor control | verdict |
| --- | --- | --- | ---: | --- | --- |
| **`featureRiders.tags`** | `character-content.ts:277` | **none** — crosses the wire as `ContentFeatureSummary.tags` (`packages/domain/src/index.ts:807`) and no client or server consumer reads it | **44** | `RiderEditor.tsx:772` (help: "Grouping only — no mechanical effect") | `declared, no reader` |
| `featureRiders.actions` | `:279` | `character-build.ts:520` | 51 | `RiderEditor.tsx:503` | `parity` |
| `featureRiders.effects` | `:281` | `character-build.ts:534` | 2 | `RiderEditor.tsx:542` | `parity` |
| `featureRiders.uses` | `:283` | `character-build.ts:321` | 92 | `RiderEditor.tsx:413` | `parity` |
| `featureRiders.grants` | `:285` | `character-build.ts:542` | 84 | `RiderEditor.tsx:618` | `parity` |
| `featureRiders.modifiers` | `:287` | `character-build.ts:555` | 41 | `RiderEditor.tsx:335` | `parity` |
| `ITEM_REFUSED_MODIFIER_TYPES` | `:262` | `EquipmentReferenceSchema` | — | `ITEM_REFUSED` (`RiderEditor.tsx:331`) — the two lists agree, by hand | `parity` |
| `SpellReference.castingOptions` (upcast rows) | `packages/content-srd-5.2.1/src/schemas.ts:101` | `equipment-derivation.ts:939`; `apps/client/src/encounter/CharacterSheet.tsx:156` | 164 | **none** — seeded to `[]` at `apps/client/src/homebrew/defaults.ts:144` | `SRD-only` |
| `ItemAttunement.restrictedTo` | `packages/content-srd-5.2.1/src/schemas.ts:186` | advisory, displayed only (documented) | ✓ | `apps/client/src/homebrew/schemas.ts:658` | `parity` |
| `ItemArmor.stealthDisadvantage` | `packages/schemas/src/index.ts:348` | `character-build.ts:1588` | ✓ | `schemas.ts:757` | `parity` |
| `ItemArmor.strengthRequired` | `packages/schemas/src/index.ts:348` | `character-build.ts:1588` | ✓ | `schemas.ts:756` | `parity` |
| `ActorDefinition.token.disposition` | `packages/schemas/src/index.ts:841` | `apps/server/src/actor-roster.ts` | ✓ | `schemas.ts:845` | `parity` |

**Three claims in the brief that prompted this audit are stale and the code is truth:**
`token.disposition`, `armor.stealthDisadvantage` / `armor.strengthRequired`, and
`attunement.restrictedTo` **are all exposed today**. They are recorded here as `parity`, not as gaps.

---

# 1. The cheap batch — rows that are pure form work

A row qualifies when **the engine already reads the value** and closing it needs only a control
added to an existing declarative field list. No schema change, no server change, no new component.

### Batch 1 — `RiderEditor.tsx`, declarative `FieldDef` additions (~8 controls, half a day)

| row | where the control goes | shape |
| --- | --- | --- |
| **`EffectGrant.modifiers`** — **U6, landed** | `effectsField` (`RiderEditor.tsx`) | ~~mount `modifiersField(...)` as a nested `rows` field~~ — **wrong, and measured wrong when U6 landed.** The nesting half was right (`whenField` inside `modifiersField` is the same depth and renders); the re-mount half was not. `EffectGrant.modifiers` is `EffectModifierSchema`, not `FeatureModifierSchema`, and mounting the latter would have offered eighteen variants an effect cannot hold while hiding nine it can — Reckless Attack's own pair among them. Shipped as `effectModifiersField`, its own four-option list |
| `EffectGrant.onEnd` | `effectsField` | `kind: "rows"` — condition id + level |
| `EffectGrant.target` | `effectsField` | `kind: "select"` — self / the target |
| `EffectGrant.endsWithTag` | `effectsField` | `kind: "text"` |
| `EffectGrant.voidWhileIncapacitated` | `effectsField` | `kind: "switch"` |
| `uses.scaling: class-resource` — **U7, landed** | the `mode` select in `usesField` + one `uses.scaling.id` text row | a fifth option and one sibling field. Shipped as written, with one correction: **feature scope only.** An item's `class-resource` resolves to `undefined` in `scaledLimit`, so the option and the row are both absent at item scope rather than offered and inert |
| `grants.spells` — **U9, landed** | `GRANT_KINDS` (`RiderEditor.tsx`) | an eleventh kind whose "Which" is the spell picker, not a `TagInput`. Shipped as written. **What it did NOT do:** retire `grants` from `RIDER_EXEMPT`. The exemption is about the LOOKUP, and all eleven kinds are still bespoke JSX with no `FieldDef` — U9 made the eleventh *editable*, not *declarative*, so retiring it means converting `GrantsEditor`, which is a refactor with no vocabulary of its own |
| `attack.rangeNormalFeet` · `attack.count` · `attack.criticalBonusDice` | `actionsField`'s attack group (`RiderEditor.tsx:521`) | three `kind: "number"` rows |

Effect `modifiers` alone converts every GM-authored effect from decorative to mechanical. It is the
highest value per line of code in the repo right now.

### Batch 2 — `FeatureEditor.tsx`, the pick family (~1–2 days, and NOT pure form work)

**This is the batch that lets a GM homebrew the extra-cantrip case that started this whole area.**
Divine Order's Thaumaturge — "you know one extra cantrip from the Cleric spell list" — is
`extraPicks: [{ offer: "class-cantrips", amount: 1 }]`, read by `character-build.ts:1075` and
`build-payload.ts:429`, authored 8 times in the SRD, and **unauthorable from the editor**.

| row | cost |
| --- | --- |
| `extraPicks` (offer key + amount) | one `rows` field; the offer key needs a picker over the eight `NAMED_PICK_BUDGETS` (`character-build.ts:194`) plus `feature:<id>` over the record's own features |
| `maxSpellLevel` / `minSpellLevel` / `maximum` | three numbers on the existing choice panel |
| `replaces` (offer + when + amount) | one `rows` field |
| `replacesFeatureId` | one select over sibling feature ids |
| `choices` (plural) | the choice panel becomes a list — a real refactor of `FeatureEditor.tsx:396`–`:590` |
| `FeatureOption.requires` / `.choice` / `.extraPicks` | the option row already mounts `RiderEditor`; these need the choice panel too |

Batch 2 is *not* cheap in the same sense: `FeatureEditor` is bespoke JSX, not a `FieldDef` list, so
every one of these is hand-written markup. See the recommendation below.

### Not cheap, and should not be attempted as form work

`attack.bonus` for monsters is a **carrier bug**, not a missing control: one `actionsField` serves
two schemas that require different keys. The fix is to branch `actionsField` on `scope`
(feature → `ability`, monster → `bonus`), which means `RiderEditor` learns a third scope. Do it as a
bug fix with a test, not as a batch item.

---

# 2. The genuinely inert rows — declared, no reader

16 rows. Each is either a bug to fix or a claim to delete. **The distinguishing question is whether a
consumer is planned or the vocabulary simply over-reached.**

| row | why it is inert | verdict |
| --- | --- | --- |
| `damage-reduction` | no incoming-damage path collects riders at all (`apps/server/src/hit-points.ts` reads `actor.effects`, never carriers) | **bug to fix.** The disposition table already calls it `"unread"`; the reader belongs in `hit-points.ts` beside the typed-defence pass. Until then the editor control at `RiderEditor.tsx:378` is a promise the fight does not keep and needs a `note`. |
| `spell-attack-bonus` | collected into `equipment-derivation.ts:676`, applied nowhere | **bug to fix.** Its sibling `spell-save-dc` *is* folded (`effective-actions.ts:51`); this is the same fold missing one call. Cheapest inert row to close. |
| `roll-mode` roll `check` | nothing filters on it, though `check-bonus` at the same moment works | **bug to fix.** `equipment-derivation.ts:773` already collects at `on-ability-check`; it sums `check-bonus` and drops `roll-mode`. |
| `roll-mode` roll `death-save` | `death-saves.ts:44` reads only the caller's mode | **bug to fix** — small, and death saves are exactly where a magic item wants to help. |
| `roll-mode` roll `concentration` | no concentration roll exists as a rider-collecting path; `hit-points.ts:175` mints a plain CON save | **claim to delete or defer.** The concentration save is a normal CON save; either route it through `saving-throws.ts` (where `roll: "save"` already works) or drop the enum member. |
| `on-death-save` moment | no `collectRiders` call site | same as `roll-mode: death-save` — one call site closes both |
| `on-taking-damage` moment | no `collectRiders` call site | **bug to fix**, and it is the same call site `damage-reduction` needs. Close them together. |
| `on-spell-cast` moment | no `collectRiders` call site | **defer with a note.** There is no spell-cast pipeline that collects riders yet; `spell-id-is` fires from the *action* path instead. |
| `spell-school-is` | `RiderContext.spellSchool` set by nothing | **claim to delete, or one line to fix.** `action-resolution.ts:800` already sets `spellId` from the action; the school is a catalog lookup away. Cheap — but nothing authors it, so deleting is equally honest. |
| `spell-level-is` | `RiderContext.spellLevel` set by nothing | as above |
| `attack-kind-is: "spell"` | `attackKindsOf` (`action-resolution.ts:512`) never emits it | **bug to fix.** An action with a `spellId` is a spell attack; one line in `attackKindsOf`. |
| `versus-creature-type` | `targetCreatureType` set by nothing; `ActorDefinition` records creature type only in the `open5e.srd-2024` extension bag | **defer, and it is already labelled** (`RiderEditor.tsx:236`). Closing it means promoting creature type to a first-class definition field. |
| `unarmored-defense.allowShield` | stored at `character-build.ts:573`, and `:1613` reads only `.ability` | **bug to fix**, one line — and it is a real 5e distinction (Barbarian allows a shield, Monk does not). Already labelled `"Not read yet."` |
| `darkvision` | explicit no-op at `character-build.ts:574` | **claim to keep, labelled.** There is no senses model; the trait prose carries it. Authored 7 times. Leave as display-only. |
| `sense` | `"display-only"` in the disposition table, and nothing displays it | **claim to fix or downgrade.** `darkvision` is at least honest — the prose says "Darkvision 60 ft". `sense` has neither a reader nor a display. Either render it on the sheet beside darkvision or delete the variant. |
| `featureRiders.tags` | crosses the wire (`packages/domain/src/index.ts:807`), read by nobody | **claim to fix.** 44 SRD records author it and the editor calls it "grouping only" — but nothing groups. Either group the sheet by it or stop shipping it over the wire. |

**Five of these are one-line fixes** (`spell-attack-bonus`, `roll-mode: check`,
`unarmored-defense.allowShield`, `attack-kind-is: "spell"`, and `spell-school-is`/`spell-level-is`
together). Three share one new call site (`on-taking-damage` + `damage-reduction`, and
`on-death-save` + `roll-mode: death-save`).

---

# 3. Recommended shape for the editor's rider surface

**The declarative surface scales. The bespoke one does not, and that is where the rows are.**

### What the evidence says

`FieldDef` (`apps/client/src/homebrew/schema.ts:159`) already carries eleven `FieldKind`s including
recursive `rows` and `group`, plus `visibleWhen`, `read`/`write` escape hatches, `emptyValue`,
`validate`, `note`, and context-resolved `options`/`suggestions`. `modifiersField`
(`RiderEditor.tsx:335`) is 21 discriminated variants expressed as **one `rows` field with 24
`visibleWhen`-gated sibling controls** and it reads cleanly. `whenField` (`:179`) nests a second
`rows` editor *inside* a row and the comment at `:178` records that `RowEditor` was measured
nesting-safe. Adding batch 1's eight controls is genuinely more of the same.

**Where it strains, concretely:**

1. **`amount` seven times over** (`RiderEditor.tsx:372`–`:378`). Seven mutually exclusive controls
   for one key, because each variant has different bounds. The comment defends it well, and it is
   right — but a 22nd variant makes it eight, and the mutual exclusion is enforced only by seven
   `visibleWhen`s agreeing. **This is the first thing that will break silently.** Recommendation:
   derive the bounds from a per-variant table (`{ability-score: [-5,5], speed: [-30,60], …}`) so
   one row reads `min: BOUNDS[type][0]`. One control, one source of numbers, checkable against the
   Zod schema in a test.

2. **`blankModifier` / `blankTrigger` are hand-maintained mirrors** of the discriminated unions
   (`RiderEditor.tsx:284`, `:124`). A variant added server-side compiles fine here and produces an
   unparseable row. Recommendation: a test that asserts `MODIFIER_TYPES` covers exactly
   `FeatureModifierSchema.options.map(o => o.shape.type.value)` and that every `blankModifier(type)`
   parses. `vocabularies.test.ts` is the right home and already imports both sides.

3. **`FeatureEditor.tsx` is not on this surface at all.** 650 lines of hand-written JSX for one
   `choice` object. Batch 2 — `extraPicks`, `replaces`, `choices`, the spell window, option-level
   picks — is six new panels of the same. **Recommendation: convert the choice panel to a `FieldDef`
   list before adding to it.** Everything it does (a segmented source switcher, a derived readout,
   nested option rows) is expressible: `visibleWhen` handles the source modes, `rows` handles the
   options, and the `choose × grants` readout is a `help` computed from the draft. The one thing
   that genuinely needs bespoke code is the level-chips control writing both `feature.level` and
   `levelTable[].features[]` in one edit — keep that as `custom`, which is exactly what
   `CustomField` (`schema.ts:157`) is for.

4. **`enabled: RiderKind[]` is too coarse for three carriers.** `RecordDetail.tsx:231` already
   branches three ways (item / monster / feature) and `scope` is only two-valued
   (`"feature" | "item"`). The monster attack bug is that mismatch made visible. Recommendation:
   make `scope` three-valued (`"feature" | "item" | "statblock"`) so `actionsField` can offer
   `attack.bonus` on a stat block and `attack.ability` on a feature. This is a small type change
   that turns a class of silent bug into a compile error.

**Net: add batch 1 one control at a time — the surface takes it. Do not add batch 2 one panel at a
time; make the choice panel declarative first, then the six panels are six `FieldDef` lists.**

---

# 4. A both-paths test pattern

## The smallest test that proves a vocabulary item works from both directions

**Extend `apps/server/test/homebrew-inert-fields.test.ts`. Do not replace it.** It is already the
right shape — one `describe` per row, each ending at a rolled number or an applied condition rather
than at "the value survived the derivation" (`homebrew-inert-fields.test.ts:14`–`:19`). What it
lacks is the *second* path: all six of its rows author their record as a hand-built
`EquipmentRecordLike` literal, so they prove the engine reads the field, never that the editor can
produce it.

The missing half already exists too, in a different file:
`apps/client/src/homebrew/publish-paths.test.ts:60`–`:75` drives the **production** editor machinery
— it looks a field up in the real `SCHEMAS`/`FieldDef` and applies the real `write`, and *throws* if
the key names no field the form has. That throw is the whole trick: a test cannot assert about a
body no GM could produce.

**The pattern is those two halves joined by one shared record fixture.**

```
describe("<vocabulary item> — both paths", () => {
  // ONE record, built the way the EDITOR builds it: blankDraft → applyField → forStorage
  // → bodyForPublish. `applyField` throws if the control does not exist, so a missing
  // control fails this test at the top rather than producing a silent no-op body.
  const authored = <editor-built body>;

  it("the editor can author it", () => {
    // publish-paths.ts's own gate: the checklist is empty AND HOMEBREW_BODY_SCHEMAS accepts it.
    expectPublishable(<type>, authored);
  });

  it("the SRD overlay authors the same shape", () => {
    // The real bundle record, parsed by the real content schema. Same field, same meaning.
    expect(<bundle record path>).toMatchObject({ <the field>: expect.anything() });
  });

  it("the engine applies it, from either", () => {
    // ONE assertion body, run twice — once over the editor-built record, once over the
    // SRD one — ending at a rolled number, a raised limit, or an applied condition.
    for (const record of [authored, srdRecord]) expect(<engine outcome>(record)).toBe(<value>);
  });
});
```

**Why this would have caught `choices`.** The plural form is reachable from `feats.v1.json` and was
a hard compile error from all twelve class modules. Test 2 passes (the feat bundle authors it).
Test 1 **fails immediately** — `applyField("class", draft, "choices", …)` throws
`No field "choices" in the class form`. Test 3 never runs. The failure names the missing consumer on
the first run, before four agents trip over it.

**Practical notes.**

- It has to live where both halves are importable. `homebrew-inert-fields.test.ts` is in
  `apps/server/test/`; the editor helpers are in `apps/client/src/homebrew/`. Lift `applyField`,
  `expectPublishable` and `fieldsOf` out of `publish-paths.test.ts` into a small shared helper
  (they are already generic), then import from either side. That refactor is the only real cost.
- Start with the three rows that would have caught the most: **effect `modifiers`**
  (`SRD-only`, headline), **`uses.scaling: class-resource`** (`SRD-only`, 19 records), and
  **monster `attack.bonus`** (the carrier bug — test 1 fails today, which is the point).
- Every `declared, no reader` row from section 2 is a test 3 that cannot be written. That is the
  cleanest signal this pattern gives: **if you cannot name the engine outcome, the row is inert**,
  and it belongs in section 2 rather than in a batch.

---

# Appendix — how the counts were derived

- **SRD authoring counts** are occurrences of a key (non-empty, non-`false`) or of a discriminator
  under its own parent, walked over every file in `packages/content-srd-5.2.1/bundles/`. Character
  content = `classes.v1.json`, `subclasses.v1.json`, `species.v1.json`, `backgrounds.v1.json`,
  `feats.v1.json`, `equipment.v1.json`. The mechanics overlay in
  `packages/content-srd-5.2.1/scripts/class-mechanics/index.ts` is the *source* of
  `classes.v1.json`, so counting the bundle counts it once, correctly, rather than twice.
- **Editor controls** are `FieldDef`s reachable from `SCHEMAS`
  (`apps/client/src/homebrew/schemas.ts:855`), from `RiderEditor`'s field factories, or from
  `FeatureEditor`'s JSX. A `read`/`write` pair that merely *preserves* a key is **not** a control —
  which is exactly what `GrantsEditor` did for `grants.spells` until U9, and the reason that row read
  `SRD-only` while ten sibling arrays read `parity`.
- **Engine readers** are the line that consumes the value at the moment it fires. Where a value is
  only collected into a derivation struct and never applied — `spell-attack-bonus` at
  `equipment-derivation.ts:676` is the canonical case — the row is `declared, no reader`, and the
  disposition table at `apps/server/src/character-build.ts:287` agrees.
