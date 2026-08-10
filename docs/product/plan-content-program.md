# The content program — prerequisites, the SRD magic-item list, and the carriers

**Written 2026-08-10 by PLANNER-CONTENT, against HEAD `6278e5a` on
`claude/feature-implementations-intake-c5eyu1`, tree clean.**

This plan is subordinate to [`remaining-program-plan.md`](remaining-program-plan.md), which is the
governing document. Where the two disagree, the governing plan wins on ordering, batching and the
verification bar; this document supplies the *content* half of batches 0 and 3 and nothing else.
[`area-2-plan.md`](area-2-plan.md) remains the reference for each unit's original argument and
[`vocabulary-parity-audit.md`](vocabulary-parity-audit.md) for the per-row evidence.

**Every count and every `file:line` below was re-measured at `6278e5a`.** Where a number came from
running something, it says *measured* and names the command or the file. Where it is a judgement, it
says so. The previous plan carried 58 stale citations; nothing here is inherited unverified.

**Scope.** This program owns five pieces plus one obligation: the weapons ETL home, `properties` on
the weapon schema, the hand-authored overlay ruling, the full SRD magic-item list, Wizard's Spell
Mastery, and the carrier obligation for the zero-author units. It owns **no** U-numbered unit. The
API-parity program, the engine/vocabulary units U17–U33, and the mastery program U34–U38 plus `vex`
and `slow` belong to the other three planners; §5 and §9 say precisely where this program's output
lands in theirs.

---

## 1. What measuring changed

Six findings. Four of them change what an implementing agent does, and one of them changes the shape
of the longest pole in the whole remaining program.

### 1.1 There is no magic-item source in this repository, and the record that says why is wrong

The governing plan's batch 3 reads as an authoring job. **It is a source-acquisition job first.**

- `packages/content-srd-5.2.1/sources/open5e-srd-2024/` ships 15 fixtures — Creature, Spell, Weapon,
  Armor, Rule and so on. There is **no** magic-item model among them (*measured: `ls` of that
  directory*).
- `packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/` vendors four files: `character-origins.md`,
  `classes.md`, `equipment.md`, `feats.md`.
- `equipment.md`'s own `## Magic Items` section (line 2137) is the *rules about* magic items —
  identifying, attunement, wearing. It contains **zero item entries** and says so: *"Hundreds of magic
  items are detailed in 'Magic Items' later in this document."* Every heading after 2137 is a rule
  (*measured: heading extraction over lines 2137–2286*).
- `packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/PROVENANCE.json`'s `notVendored` field names
  `magic-items.md` among eight files left out, with the reason *"the corresponding bundles already come
  from the open5e fixtures and are cross-validated."* **That reason is false for exactly this one
  file.** There is no magic-item bundle and no magic-item fixture. The claim is a defect and is
  repaired in C5.

So the first content unit vendors the upstream file, at the same pinned commit the other four came
from. **Verified reachable:** `HTTP 200`, 244,314 bytes, 5,015 lines at
`downfallx/dnd-5e-srd-markdown@1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4`, the exact commit
`PROVENANCE.json` already pins. Hand-transcription is not an option here and the reason is in that
same file: hand-authoring is *"where both licensing violations landed."*

**Measured from the fetched file:** `## Magic Items A–Z` (line 578) carries **260 `####` entries**, of
which **2 are embedded creature stat blocks** (`Giant Fly`, `Avatar of Death` — their second line is a
creature line, not an italic type line), leaving **258 items**. **258 of 258** carry a parseable italic
type line. **140 of 258** require attunement.

### 1.2 The weapons ETL has a real source for both missing columns — it does not need a hand table

The governing plan (ruling 12) says `mastery` has no ETL home. Confirmed, and worse than stated: the
open5e `Weapon.json` fixture has **nine fields** and none of them is mastery or properties, and
`weaponRecords` (`packages/content-srd-5.2.1/scripts/build-bundle.ts:549-559`) emits neither. Since
`WeaponReferenceSchema.mastery` is `.optional()`, `validateBundle` passes and the write drops all 38
values in silence. **And nothing catches it:** `packages/content-srd-5.2.1/test/bundle.test.ts:174`
spot-checks Battleaxe's category and damage and never its mastery; `grep mastery` over that package's
five test files finds it only in `enums.test.ts` (the id list) and `character-content.test.ts` (the
Fighter's pool). *Measured.* A rebuild today is green and silently destructive.

**The column already has a vendored home.** `sources/dnd-5e-srd-markdown/equipment.md` carries the
SRD Weapons table with the columns `Name · Damage · Properties · Mastery · Weight · Cost` — **38 data
rows**, and the same HTML-table shape `build-class-bundle.ts` already parses.

**Measured, by joining that table to `bundles/weapons.v1.json` on the name slug:**

- 38 of 38 bundle weapons matched a table row; **0 unmatched in either direction**;
- **0 mastery mismatches** — the table reproduces the committed column exactly
  (`topple 5 · vex 8 · slow 7 · nick 4 · sap 6 · graze 2 · cleave 2 · push 4`, 38 of 38, which also
  reproduces the two intakes' count);
- the Properties column yields **70 assignments over the 9 SRD property slugs**:
  `two-handed 13 · ammunition 9 · heavy 9 · light 8 · thrown 7 · versatile 7 · loading 6 · finesse 6 ·
  reach 5`. Every one of `WEAPON_PROPERTY_IDS`' nine members is authored by at least five weapons, so
  no property lands with zero authors.

That converts A and B from "invent a curated table" into "parse a vendored table and fail closed",
which is the `SKILL_ABILITY` precedent (`build-bundle.ts:582-601`) with a real source behind it — and
it gives the unit an exact acceptance test: **the regenerated bundle's mastery column is byte-identical
to the committed one.**

### 1.3 `properties` is fully read on the live side and cannot be authored at all — and it is not only a rider filter

Not stated anywhere in the governing plan, and it is why `properties` is a four-part unit rather than
a schema line. **The live-play half is already plumbed; the content half is empty.**

- The field exists: `packages/schemas/src/index.ts:354`, `ItemWeaponSchema.properties`.
- **It already decides which ability a weapon swings with.** `weaponAbilityModifier`
  (`apps/server/src/equipment-derivation.ts:984-991`) reads `finesse` to take the better of Strength
  and Dexterity, and `thrown` to decide whether a ranged weapon uses Dexterity.
- **It already decides reach.** `weaponAction` (`equipment-derivation.ts:993-1012`) reads `reach` for
  10 feet versus 5, and `thrown` again for whether a swing gets a reach or a range band.
- The rider path exists too: `weaponPropertiesOf` (`equipment-derivation.ts:1044`) →
  `packages/rules-5e/src/riders.ts:194-195`.
- **Nothing writes it.** `EquipmentWeaponStatsSchema` (`packages/content-srd-5.2.1/src/schemas.ts:226-234`)
  has no `properties`, so no catalog record can carry one, and the catalog→inventory copy at
  `apps/server/src/character-build.ts:1586` lists five weapon keys and `properties` is not among them.

So every weapon in the game swings with `properties: []`. Three consequences, all live and all
user-visible, none of them previously written down:

1. **A Rapier rolls off Strength.** It is a Finesse weapon; the branch that would notice is
   `weaponAbilityModifier`'s first clause, and it never fires. A DEX 15 / STR 12 rogue swings at the
   worse modifier, on the sheet, today.
2. **A Glaive, Halberd, Lance, Pike and Whip all have 5-foot reach** — the `reach` branch never fires
   (*measured: 5 weapons carry `reach` in the SRD table*).
3. **`weapon-property-is` is inert on every weapon** — the trigger always sees `[]`.

**`properties` must therefore land on four shapes, not one**, and stopping at the schema leaves a green
build with all three defects intact:

| # | shape | where |
| --- | --- | --- |
| 1 | `WeaponReferenceSchema` | `packages/content-srd-5.2.1/src/schemas.ts:105-126` — C1 |
| 2 | the ETL emit | `packages/content-srd-5.2.1/scripts/build-bundle.ts:549-559` (`weaponRecords`) — C1 |
| 3 | `EquipmentWeaponStatsSchema` and the `loadEquipment()` weapon fold | `schemas.ts:226-234`, `src/index.ts:113-117` — C3 |
| 4 | the catalog→inventory copy | `apps/server/src/character-build.ts:1586` — C3 |

> **Correction to a cross-planner citation.** The mastery program named the ETL emit as
> `build-class-bundle.ts:549-559`. *Measured:* that range is `equipmentOf`'s starting-equipment
> resolver and has nothing to do with weapon rows. The weapon emit is `build-bundle.ts:549-559`. The
> finding is right; the file is the other one.

Closing it needs all four shapes **and** an editor control, because shipping the four alone
manufactures a fresh SRD-only row, which is the exact mirror defect the phase exists to end.

Two hazards to carry into that unit, both documented in the code:

- `EquipmentWeaponStatsSchema` exists as a **named** schema precisely because *"inlining one more
  property here pushed `z.infer` past TypeScript's expansion budget"* and silently truncated
  `packages/domain/src/catalog-choice.ts`'s view of `SpellReference` (`schemas.ts:218-225`). Adding a
  key to it is exactly the move that broke it before. The unit's typecheck must be root-wide, and it
  must assert `catalog-choice.ts` still sees `SpellReference.attackRoll` and `.rangeFeet`.
- The client's weapon block is **five rows** (`apps/client/src/homebrew/schemas.ts:764-770`:
  category, damage dice, damage type, range, long range). `properties` is a sixth and U38's `mastery`
  is a seventh — the same block, two programs. §7 records it as a serialization point.

### 1.4 Wizard's Spell Mastery cannot be fixed by the overlay, and that is what forces the ruling

**Measured.** `bundles/classes.v1.json`'s Wizard record carries, on `spell-mastery`:

```json
{ "kind": "spell", "choose": 2, "fromCatalog": "wizard-spells", "maxSpellLevel": 2 }
```

against printed text reading *"Choose a level 1 **and** a level 2 spell."* Two level-1 spells is a legal
build; so is two level-2 spells. The correct shape is `choices` — one block capped at level 1, one
floored and capped at level 2 — and `packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts:78`
has exposed `choices` since `ef54720`.

The fix is still blocked, and by a second mechanism the overlay's own header describes:

- Wizard is one of the three `HAND_AUTHORED` classes
  (`packages/content-srd-5.2.1/scripts/build-class-bundle.ts:33` — `fighter`, `wizard`, `cleric`), so
  its record is carried through verbatim and the overlay merges over it *additively only*
  (`build-class-bundle.ts:836-838`);
- `applyMechanics` refuses to overwrite a key the record already holds and reports
  `"… (already authored on the record - remove it from one of the two homes)"`
  (`overlay.ts:139-141`, pinned by `packages/content-srd-5.2.1/test/mechanics-overlay.test.ts:76`);
- and writing `choices` *beside* the record's `choice` does not dodge it, because
  `oneChoiceForm` (`packages/content-srd-5.2.1/src/character-content.ts:525-527`) **refuses a record
  carrying both** — so the build fails at `ClassReferenceSchema.parse` instead.

`wizard.ts:66-73` already reports this as blocked, in prose, giving the wrong reason (it says the
overlay exposes only `choice`; it now exposes both). **That comment is stale and is repaired in C4.**

### 1.5 A generated magic-item bundle does not inherit the collision problem

Worth stating because it is the strongest available argument in §4. The collision exists *only*
because `classes.v1.json` is simultaneously the ETL's input and its output. A magic-item bundle
generated from a vendored source is an output only, so its mechanics overlay may overwrite freely and
the additive-only rule never applies. **This is the argument for a separate generated bundle rather
than appending 268 rows to the hand-authored `equipment.v1.json`** — appending would make that file
both input and output and self-inflict the very problem §4 exists to rule on.

*Measured:* `equipment.v1.json` holds **132 records** — `adventuring-gear 68 · tool 35 · focus 12 ·
equipment-pack 7 · consumable 6 · ammunition 4` — and **zero** of them declare `rarity`, `weapon`,
`armor`, `modifiers`, `effects`, `actions`, `grants`, `uses`, `casts`, `attunement` or `cursed`. The
union of its keys is exactly `id, name, category, costGp, weightLb, description`. Nothing writes it;
it is hand-authored (no `writeFileSync` in `build-bundle.ts` names it). `enums.ts:87` already records
the same measurement and says the rarity containment assertion *"becomes non-vacuous the day the first
magic item lands"* — which this program is.

### 1.6 The editor's whole magic-item surface already ships

So most units in this program have **no control half to build** — they assert an existing one.
`apps/client/src/homebrew/schemas.ts` mounts `slot` (:637), `isMagic` (:652), `rarity` (:672),
`attunement.required` (:674), `attunement.restrictedTo` (:681), `cursed` (:689), `casts` (:698),
`grantsFeatIds` (:742) and the full rider panel (:752). *Measured by reading the section.* That is why
the content program is the shortest path to closing the parity gap on items: the button exists and
nothing has ever pressed it.

---

## 2. The units

Sizes use this repo's convention: **S** ≈ half a day · **M** ≈ 1 day · **L** ≈ 1.5–2 days.
Sizes are estimated from reading the code; the *counts* inside them are measured.

| # | unit | size | batch | blocks |
| --- | --- | --- | --- | --- |
| **C1** | the weapons ETL home — `mastery` and `properties`, derived and fail-closed | M | 0, serial, first | everything |
| **C2** | the hand-authored overlay ruling | S | 0, serial | C4, and any later unit authoring onto cleric/fighter/wizard |
| **C3** | `properties` reaches the fight | M | 0b | U20, U35 |
| **C4** | Wizard's Spell Mastery becomes two picks | S | 0b | — |
| **C5** | vendor the magic-item source; repair the provenance and the attribution | S | 3, serial | C6 |
| **C6** | the magic-item ETL — 268 rows, typed, folded into the catalog | L | 3, serial | C7a–d |
| **C7a** | item mechanics — weapons and armour (52 items) | L | 3, concurrent | U20, U23 |
| **C7b** | item mechanics — wands, staffs, rods, rings, the scroll (55) | L | 3, concurrent | U26, U29 |
| **C7c** | item mechanics — wondrous, worn (63) | L | 3, concurrent | U31, U32 |
| **C7d** | item mechanics — potions and carried wondrous (88) | M | 3, concurrent | — |
| **C8** | the program's close: adversarial review, mobile back-fill, ledger | M | 3, last | — |

**Total ~11–13 agent-days**, estimated. Ten units, of which four run concurrently.

The carrier dossier the governing plan's ruling 5 asks for is **§5 of this document**, delivered now
rather than as a unit — it is a reading of the SRD, not a code change, and the units that consume it
belong to other planners.

---

### C1 — the weapons ETL home

*One unit, one commit. Both columns, because they are one parse, one join and one fail-closed guard;
writing the join twice is how the two halves drift.*

| part | what |
| --- | --- |
| **reader** | `mastery` → `masteryByActionId` (`apps/server/src/equipment-derivation.ts:638-649`), which reads it off the **catalog**, not the inventory row. `properties` → `weaponPropertiesOf` (`equipment-derivation.ts:1044`) → `packages/rules-5e/src/riders.ts:194`. Both ship; neither is written by this unit. |
| **content** | the SRD Weapons table in `sources/dnd-5e-srd-markdown/equipment.md`, parsed with the existing HTML-table helpers, joined to the open5e fixture by name slug. 38 rows, 38 masteries, 70 property assignments. |
| **control** | **does not apply** — this is an ETL/content-pipeline shape with no editor surface, which is the second of the two permitted "does not apply" answers. The control for `properties` is C3's and is not deferred: it lands in the next unit, in the same batch. |
| **test** | a bundle guard that pins **all 38 mastery values** and **all 70 property assignments** by name, so a future regeneration that drops a column fails instead of shipping. |

**Files.**

```
packages/content-srd-5.2.1/scripts/build-bundle.ts        (the parse, the join, the fail-closed throw)
packages/content-srd-5.2.1/src/schemas.ts                 (WeaponReferenceSchema gains `properties`)
packages/content-srd-5.2.1/bundles/weapons.v1.json        (regenerated — the ONLY unit allowed to)
packages/content-srd-5.2.1/test/bundle.test.ts            (the two guards)
```

**Shape.** Parse the Weapons table once into `Map<slug, {properties, mastery}>`; look each weapon up in
`weaponRecords`; **throw naming the weapon** when a row is missing, exactly as `SKILL_ABILITY` throws
(`build-bundle.ts:600`). Strip the parenthetical from a property cell — the table prints
`Thrown (Range 20/60)` and `Versatile (1d10)`, and the bare slug is what riders match
(`enums.ts:62-70` states that rule and strips the bundle's own `-wp` suffix for the same reason).

**Named absence, so it reads as a decision:** Versatile's two-handed die (`1d10` on a Longsword) is
thrown away by that strip. `EquipmentWeaponStatsSchema` has nowhere to put a second die, and inventing
one here would be a vocabulary addition with no reader. It is recorded in the parser's comment, not
silently dropped.

**Far end.** The regenerated `weapons.v1.json` diff shows **only added `properties` arrays** — the
mastery column is byte-identical to the committed one on all 38 rows. That is a stronger far end than
any assertion, because it is the exact failure the unit exists to prevent.

**Non-vacuity, both probes.** *Control:* delete the join (emit no `mastery`/`properties`) → the bundle
guard fails naming both columns and a count. *Value:* change one table cell (Battleaxe `Topple` →
`Vex`) → the mastery guard fails naming `battleaxe`; restore. Report exact counts and messages.

**375px:** no — no UI.

**Serialization:** this unit is the *only* thing that may regenerate `weapons.v1.json`, and nothing runs
concurrently with it (governing plan §5).

---

### C2 — the hand-authored overlay ruling

*A decision to take once and record, not to route around per unit.* Full argument and costs in §4.

| part | what |
| --- | --- |
| **reader** | n/a — this unit adds no vocabulary. |
| **content** | n/a. |
| **control** | n/a. |
| **test** | if the recommended option is taken: one case in `packages/content-srd-5.2.1/test/mechanics-overlay.test.ts` beside the existing collision test at `:76`, proving the declared replacement lands **and** that it is idempotent across a second run — because for a hand-authored class the ETL writes back over its own input. |

**Deliverable either way:** a dated entry in `docs/ai-ledger/decision-log.md`, in that file's own
house style (a numbered ruling with the reason, not a note).

**375px:** no.

---

### C3 — `properties` reaches the fight

*This unit closes shapes 3 and 4 of §1.3's four; C1 closed 1 and 2.*

| part | what |
| --- | --- |
| **reader** | ships, three of them — `weaponAbilityModifier` (`equipment-derivation.ts:984-991`), `weaponAction`'s reach branch (`:993-1012`), and `weaponPropertiesOf` → `riders.ts:194`. This unit supplies the two links that starve all three. |
| **content** | the 70 assignments C1 emitted, carried through `loadEquipment()`'s weapon fold (`packages/content-srd-5.2.1/src/index.ts:113-117`) into the catalog record, and through `apps/server/src/character-build.ts:1586` into the inventory row. |
| **control** | a **sixth** row in the client's weapon block (`apps/client/src/homebrew/schemas.ts:764-770`) — a tag/multiselect over `WEAPON_PROPERTY_IDS`, which `apps/client/src/homebrew/useSchemaContext.ts` already imports for the `weapon-property-is` trigger. Open, like every other SRD vocabulary control: a homebrew property must stay typable. |
| **test** | both paths over **three** far ends — the SRD path drives a Rapier, a Glaive and a Mace out of the catalog; the editor path drives a GM-authored Finesse weapon through the real controls; one assertion body runs over both. |

**Far end — three of them, and two are live defects rather than synthetic probes.**

1. A DEX 15 / STR 12 character's **Rapier attack bonus and damage move from Strength to Dexterity**.
   This is a wrong number on a shipped sheet today (§1.3).
2. A **Glaive's reach becomes 10 feet** and a Mace's stays 5.
3. A `weapon-property-is: ["finesse"]`-gated rider fires on the Rapier and not on the Mace.

Not "the array survived the fold".

**Non-vacuity, both probes.** *Control:* filter `weapon.properties` out of the weapon block's fields →
the mirror test fails naming `Field "weapon → properties" …`. *Value:* change the Rapier's authored
property from `finesse` to `heavy` → its attack bonus falls back to Strength and far end 1 fails;
restore.

**375px: yes.** `node scripts/tap-audit.mjs 375` on `/homebrew`; the count must not rise, and the new
control is checked with touch at a narrow viewport.

**Watch.** Root-wide `npm run check`, and confirm `packages/domain/src/catalog-choice.ts` still sees
`SpellReference.attackRoll` and `.rangeFeet` — §1.3's inference-budget hazard, which last time
truncated a type two packages away without any error at the edit site.

**Watch, second.** The inventory bridge means a character built before this unit has no `properties` on
its stored rows. That is precisely what the governing plan's ruling 7 (bump `schemaVersion`, offer a
GM-triggered rebuild) exists for; this unit does not invent a second migration. Its own tests build a
fresh character, so the far end does not depend on the rebuild.

---

### C4 — Wizard's Spell Mastery becomes two picks

| part | what |
| --- | --- |
| **reader** | `featurePicks` (`character-content.ts:538`) and both consumers ship, and have since Magic Initiate; U12 (`d02e894`) made the editor able to say it. |
| **content** | `bundles/classes.v1.json` Wizard `spell-mastery`: one `choice` capped at level 2 becomes two blocks — level 1, and level 2 floored **and** capped. Landed through whichever home C2 rules for. |
| **control** | ships — the choice panel is a list of blocks as of `d02e894`, and `writeChoiceBlocks` spells the pair canonically from the block count. |
| **test** | a level-18 Wizard's build offers **two** pick rows with **different** windows, and a build answering both rows with level-1 spells is **refused by name** — the far end is the refusal, which is the whole bug. |

**Ride-along, same commit:** delete the stale reason at
`packages/content-srd-5.2.1/scripts/class-mechanics/wizard.ts:66-73` (it says `overlay.ts` exposes
`choice` and not `choices`; `overlay.ts:78` exposes both). The code is truth and the comment is the
defect.

**Non-vacuity, both probes.** *Control:* collapse the two blocks back to one → the "two windows"
assertion fails and the refusal stops happening. *Value:* set the second block's floor to 1 → the
refusal stops; restore.

**375px: yes** — the builder's pick step now renders two rows where it rendered one, at level 18.

---

### C5 — vendor the magic-item source

| part | what |
| --- | --- |
| **reader** | n/a — a sourcing unit. |
| **content** | `magic-items.md` vendored at commit `1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4`, the commit `PROVENANCE.json` already pins for the other four files. |
| **control** | n/a. |
| **test** | the source file's line count and its `## Magic Items A–Z` entry count are pinned, so a re-vendor at a different commit fails rather than silently shifting 258 rows. |

**Files.**

```
packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/magic-items.md   (new, vendored)
packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/PROVENANCE.json  (files[] + notVendored)
packages/content-srd-5.2.1/scripts/build-bundle.ts                      (attribution.additionalSources.covers)
packages/content-srd-5.2.1/bundles/attribution.json                     (regenerated)
```

**Two claims are repaired, not softened.** `PROVENANCE.json`'s `notVendored` currently justifies
leaving `magic-items.md` out on the ground that *"the corresponding bundles already come from the
open5e fixtures"* — false, measured (§1.1). And `attribution.additionalSources[0].covers` reads
*"classes, subclasses, class spell lists, species, backgrounds, feats"*, which becomes untrue the
moment this source is used; CC BY attribution is not a place to leave a stale claim.

**375px:** no.

---

### C6 — the magic-item ETL

*The single largest piece of this program and it is deliberately one agent, because it is one parser.*

| part | what |
| --- | --- |
| **reader** | `loadEquipment()` (`packages/content-srd-5.2.1/src/index.ts:98-125`), which already folds three sources into one catalog; this adds a fourth. Everything downstream — browse-&-add, `equipmentCatalogOf`, the sheet — reads the folded catalog and needs no change. |
| **content** | 258 SRD entries → **268 emitted rows** (see the expansion rule below), each with `id`, `name`, `category`, `slot`, `rarity`, `isMagic: true`, `attunement`, `cursed`, `description`, and a `weapon`/`armor` block where the type line names one. |
| **control** | ships — the entire magic-item form (§1.6). This unit adds none and asserts the existing ones through the harness. |
| **test** | a bundle guard (row count, category histogram, rarity histogram, attunement count, zero id collisions) plus a both-paths row ending at a rendered item on a character's sheet. |

**Files.**

```
packages/content-srd-5.2.1/scripts/build-magic-items.ts     (new — the parser)
packages/content-srd-5.2.1/bundles/magic-items.v1.json      (new — generated, 268 rows)
packages/content-srd-5.2.1/src/index.ts                     (the fourth fold in loadEquipment)
packages/content-srd-5.2.1/package.json                     (a third bundle script)
packages/content-srd-5.2.1/test/magic-items.test.ts         (new — the bundle guard)
```

**A separate bundle, not 268 rows appended to `equipment.v1.json`.** Reason in §1.5: appending makes a
hand-authored file both the ETL's input and its output, which is exactly the condition that produced
the collision §4 rules on. A generated bundle is an output only.

**The parse, measured against the fetched source.** Every entry is `#### Name`, then an italic type
line, then prose that may contain the same HTML tables `build-class-bundle.ts` already renders with
`tableAsText`. 258 of 258 entries have the italic line, so the parse is total rather than
best-effort. Two `####` headings are embedded creature stat blocks (`Giant Fly`, `Avatar of Death`) —
recognised by a creature-shaped type line and skipped, **by name, with a count assertion**, never by a
silent filter.

**Category → slot, measured distribution over the 258.**

| type line | count | `slot` |
| --- | ---: | --- |
| Wondrous Item | 127 | by name: worn (62 across neck/shoulders/head/feet/hands/belt) or `wondrous` (65) |
| Weapon | 33 | `weapon` |
| Potion | 24 | `consumable` |
| Ring | 22 | `ring` |
| Armor | 19 | `armor` (or `shield` where the type line says Shield) |
| Wand | 13 | `held` |
| Staff | 12 | `held` |
| Rod | 7 | `held` |
| Scroll | 1 | `consumable` |

`ItemSlotSchema` (`packages/schemas/src/index.ts:29-37`) is a closed enum the engine switches on, so a
name-derived slot must be **asserted** by the bundle guard, not trusted.

**Rarity, measured:** `Rare 82 · Uncommon 73 · Very Rare 55 · Legendary 32 · Varies 7 · Common 2 ·
Artifact 1`, plus 6 entries whose type line carries a ladder. Every value is a member of `RARITY_IDS`,
which makes `enums.test.ts`'s rarity containment assertion **non-vacuous for the first time** — the
exact outcome `enums.ts:87` predicted.

**The expansion rule, and it is a decision, not a mechanic.**

- **Expand the five `+1, +2, or +3` ladders into one row each** — `Ammunition`, `Armor`, `Shield`,
  `Weapon`, `Wand of the War Mage`. Each tier has its own rarity and its own bonus amount, so one row
  cannot carry them, and "Longsword, +1" is what a GM expects to find in the browse list.
  **5 entries → 15 rows, net +10.**
- **Leave the seven `Rarity Varies` entries as one row each**, rarity `"varies"`, with their table
  rendered into the description: `Belt of Giant Strength`, `Feather Token`, `Figurine of Wondrous
  Power`, `Ioun Stone`, `Potion of Giant Strength`, `Potions of Healing`, `Spell Scroll`. Expanding
  `Armor of Resistance` into ten near-identical rows would put ten near-identical rows in the browse
  list, which is a worse table experience than one row and a table.

**268 = 258 − 5 + 15.**

**The id guard is not optional.** Minted ids are name slugs, and expansion mints ids the hand-authored
catalog already owns. *Measured:* raw name slugs collide with `equipment.v1.json` + `weapons.v1.json` +
`armor.v1.json` on **0 of 258** — but `Potions of Healing` expanded would mint `potion-of-healing`,
which `equipment.v1.json` already ships and `bundle.test.ts:212` already asserts. So the ETL **fails
closed on any minted id already present in the other three bundles**, naming both homes — the same
rule the overlay applies to riders.

**One reconciliation to decide inside this unit, recommended here:** keep `Potions of Healing` as the
grouped `varies` row and leave the existing mundane `potion-of-healing` alone. Cost: two rows in the
browse list with similar names. Alternative: expand the four printed tiers and delete the hand-authored
row, which moves one assertion at `bundle.test.ts:212`. Either is defensible; take one and write it
down.

**`costGp: null` on every row.** The SRD prints a value *band by rarity* (`## Magic Item Values by
Rarity`), not a per-item price. Deriving a number from a band would be inventing content.

**Far end.** A GM adds `Wand of the War Mage, +1` from the browse-&-add list and the item renders on a
character's sheet with its attunement requirement and its rarity — a rendered string, not a parsed
record.

**Non-vacuity, both probes.** *Control:* remove the fourth fold from `loadEquipment()` → the catalog
census fails naming a count that drops by 268. *Value:* change one item's `slot` in the parser →
the slot assertion fails naming the item; restore.

**375px: yes**, and it is a real risk rather than a formality: 268 rows land in the browse-&-add list
and several descriptions carry rendered tables. Check the list and one table-bearing item detail
(`Armor of Resistance`) at 375px, and run `node scripts/tap-audit.mjs 375`.

**Viewer safety — stated, then dismissed with the reason.** A magic item's mechanics never reach a
player through the inventory row: `packages/schemas/src/index.ts` documents that the carried-item
marker *"carries NO riders, NO casts and NO `cursed` flag"* and that mechanics resolve by `item.id`
against a catalog that never leaves the server. This unit adds catalog rows only and puts no new key
on the wire, so it is **not** a viewer-safety change. C7c is where `cursed` gets authored, and its
hiding rule is already structural (`schemas.ts:269-275`); that lane re-reads it rather than assuming.

---

### C7a–C7d — the item mechanics overlay, in four lanes

The split, and why it is this split, is §3. All four lanes share one contract:

| part | what |
| --- | --- |
| **reader** | already ships for every rider a lane may author — that is the lane's admission rule (below). |
| **content** | riders on the items in the lane, keyed by item id, in the lane's own module. |
| **control** | ships (§1.6). Each lane asserts it through the harness rather than adding one. |
| **test** | at least one both-paths row per lane, ending at an engine outcome, plus the lane's own module-level guard (every key matches a real item id). |

**The admission rule, and it is the `masteryReaches` rule restated for items:** *a lane authors a rider
only when its reader ships today.* A rider whose reader is a later unit's job is **not** authored — it
is recorded in the module as a **named absence**: the item, the SRD sentence, the vocabulary it needs
and the unit that unblocks it, in a comment beside the item's entry. That is exactly the shape
`class-mechanics/wizard.ts:48-74` uses for its nine prose-only records, and it is what turns "we
skipped it" into "we decided it". §5 is the index of those absences.

**Structure**, mirroring `class-mechanics/` — one module per lane, composed by an `index.ts`, keys
validated against the generated bundle, an unmatched key failing the build:

```
packages/content-srd-5.2.1/scripts/item-mechanics/index.ts
packages/content-srd-5.2.1/scripts/item-mechanics/*.ts        (one per lane)
```

The header of `class-mechanics/overlay.ts` states the reason for one-file-per-author in its own words:
*"A single object literal holding twelve classes is one file that every content author has to edit …
The split is the difference between four agents working and four agents merging."* Four lanes, four
modules, four worktrees.

**Per-lane far ends** (each a rolled number, an applied condition or a refusal — never a surviving
field):

- **C7a — weapons and armour (52 items · 47 with an expressible mechanic · 35 attuned).** Far end: a
  `+1` weapon's to-hit and damage both move by one, and an `Armor of Resistance` halves a typed damage
  total on the damage command. Reserved for U20 (`Sun Blade`, `Energy Bow`) and U23 (`Vicious
  Weapon`).
  > **This lane must not reach for the Light property as a carrier.** Cross-checked with the mastery
  > program and verified here: there is **no two-weapon / off-hand attack mechanism anywhere in the
  > engine** — `weaponAction` (`equipment-derivation.ts:993-1012`) hard-codes
  > `activation: "action"` — and the SRD `two-weapon-fighting` fighting style ships at
  > `packages/content-srd-5.2.1/bundles/feats.v1.json:302` carrying **nothing but
  > `tags: ["fighting-style"]`** (*measured: its `feature` block has a description and a tag and no
  > rider*). Light is a real property and C1 authors it on 8 weapons; what it *does* is U21's and
  > U35's mechanism to build. Any Light-based far end in this lane would be vacuous.
- **C7b — wands, staffs, rods, rings, the scroll (55 · 41 · 44).** Far end: a `Wand of Fireballs`
  spends a charge, rolls real damage through the item's `casts` block, and **refuses** when the charges
  are gone. Reserved for U26 and U29 (`Wand of the War Mage`, `Staff of the Magi`, `Staff of the
  Woodlands`).
- **C7c — wondrous, worn (63 · 49 · 51).** Far end: a `Cloak of Protection` moves AC **and** a saving
  throw the server rolls, and comes back off when the cloak does. Reserved for U31 (`Gloves of Missile
  Snaring`) and U32 (`Periapt of Wound Closure`). This lane owns `cursed` and re-reads the
  hidden-until-attuned rule.
- **C7d — potions and carried wondrous (88 · 30 · 10).** Far end: a `Potion of Resistance` applies a
  typed resistance for its duration and expires. The lightest lane per item and the heaviest in named
  absences — most of the 65 carried wondrous items are GM-fiat and stay prose.

**Six items whose central mechanic this vocabulary refuses, and it is a schema decision rather than an
oversight.** `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`
(`packages/content-srd-5.2.1/src/character-content.ts:262`) with a message explaining that an item
cannot change a baked-in number because it cannot be un-granted when the item comes off. *Measured:*
**6 of 258** SRD items set an ability score — `Amulet of Health`, `Belt of Giant Strength`,
`Gauntlets of Ogre Power`, `Headband of Intellect`, `Potion of Giant Strength`, `Thunderous
Greatclub` — and one raises a Hit Point maximum (`Berserker Axe`). All seven ship as prose with the
refusal quoted beside them. **No lane may work around this by inventing a modifier type;** that is a
vocabulary decision and it belongs to a unit, not to a content author.

**Non-vacuity, both probes, per lane.** *Control:* strip the lane's module out of `index.ts` → the
lane's both-paths test fails naming its item. *Value:* change the authored amount (a `+1` to `+0`, a
resistance's damage type) → the far-end number stops moving; restore. Report exact counts and messages.

**375px:** each lane runs `node scripts/tap-audit.mjs 375` on `/homebrew` (the count must not rise) and
checks one item it authored on a character sheet at 375px.

---

### C8 — the program's close

The governing plan folds the quality layer into each program (ruling 3), so this program carries its
own rather than assuming someone else does.

| part | what |
| --- | --- |
| **reader** | n/a. |
| **content** | n/a. |
| **control** | n/a. |
| **test** | the full suite, once, serially, plus the two audits below. |

Three things, in order:

1. **A hostile adversarial review of this program's own output**, hunting the two failure modes the
   governing plan names and nothing else: *built-but-unwired* (a rider authored whose reader does not
   fire — the admission rule above is what it audits) and *vacuous tests* (a both-paths test whose far
   end is a surviving field). Every named absence in §5 is checked against the module it claims to
   live in.
2. **The mobile back-fill** over everything the program rendered: the browse-&-add list at 268 new
   rows, one table-bearing item detail, the sheet's magic-item row, and the new weapon-properties
   control. `node scripts/tap-audit.mjs 375` on `/homebrew`, count must not rise.
3. **The ledger.** `docs/ai-ledger/current-state.md` is **exactly at its 150-line ceiling** (*measured:
   `wc -l`*), so it is parent-only and edited by replacement, never by addition. `known-bugs.md` and
   `decision-log.md` take this program's entries. `npm run docs` is re-run if anything touched
   state/command/HTTP/OpenAPI — nothing in this program should, and if something did, that is a finding.

**375px:** this unit *is* the 375px pass.

---

## 3. How the magic-item list is decomposed, and why

**The crux, stated first: the list splits in two before it splits four ways.**

258 items is one *parse* and one *authoring job*, and they have opposite parallelism. The parse is a
single program reading a single file — two agents editing one parser is a merge conflict with no
upside, and the prose it produces is not a judgement call. The mechanics are 258 independent readings
of English into a rider vocabulary, each of which is a judgement, and they are exactly what four
people can do at once. **So: one serial ETL unit (C6) producing prose and typed metadata, then four
concurrent overlay lanes (C7a–d) producing riders.**

This is not invented for this program. It is the ruling `class-mechanics/overlay.ts` already made for
classes, in its own words — *"prose is generated, mechanics are authored, and the ETL merges the
two"* — and the same header records that `SpellListReferenceSchema` made the identical call before
that. Three subsystems, one shape.

### Why by category, and not by rarity or by unit

**By category** — the axis chosen. Three reasons, in order of weight:

1. **It is the file-contention axis.** A lane is a module; a module is a file; an item belongs to
   exactly one category, so no two lanes ever touch one file. That is the property that makes four
   worktrees worth the cost, and `overlay.ts`'s header says so directly.
2. **It is machine-checkable.** The type line the ETL already parses *is* the category, so a module
   authoring an item outside its own category fails the build the same way an unmatched key does. A
   split the build can enforce does not drift.
3. **It groups the reasoning.** A wand lane is 55 readings of "spend a charge, cast a spell"; an
   armour lane is "change a number that comes back off". An author holds one mental model per lane
   instead of 258.

**By rarity** — rejected, and the repo already says why. `EquipmentReferenceSchema:265` calls rarity
*"Display and filtering only … rarity is identity, not a mechanical hook."* A rarity lane is a random
assortment of unrelated mechanics with no shared reasoning, **and it cuts across categories**, so two
agents would edit one module. It fails the only test the split has to pass.

**By which unit needs it** — rejected as the *split* axis, adopted as the *priority* axis. Only about
ten of 258 items are named by any unit (§5); a unit-shaped split leaves 248 items unassigned. But
"which unit needs it" is exactly the right ordering *within* a lane: each lane authors its reserved
carriers first, so the units that depend on them unblock as early as possible.

**By mechanic family** (bonuses / resistances / charges / conditions) — rejected. It groups the
reasoning best of any option and fails the contention test hardest: `Belt of Dwarvenkind` alone needs
an ability score, a resistance, an advantage and a proficiency, so it would belong to four modules and
four agents would edit one item.

### The four lanes, balanced by authoring weight rather than item count

The naive split is by item count, and it is wrong: **item count is not work.** Sixty-five of the
carried wondrous items are GM-fiat prose (`Bag of Beans`, `Deck of Illusions`, `Portable Hole`,
`Sphere of Annihilation`) with nothing this vocabulary can say about them.

*Measured — a textual scan for an expressible mechanic (a bonus, a resistance, an advantage, charges,
a cast, a proficiency, a speed change, an immunity, extra damage or an AC change):*

| lane | items | with an expressible mechanic | attuned |
| --- | ---: | ---: | ---: |
| **C7a** weapons + armour | 52 | **47** | 35 |
| **C7b** wands, staffs, rods, rings, scroll | 55 | **41** | 44 |
| **C7c** wondrous, worn | 63 | **49** | 51 |
| **C7d** potions + carried wondrous | 88 | **30** | 10 |
| **total** | **258** | **167** | **140** |

Item counts run 52 / 55 / 63 / 88 — a 1.7× spread. Authoring weight runs **47 / 41 / 49 / 30** — flat
across three lanes, with the fourth deliberately lightest because it also carries the largest number of
named absences to write down. **That is the balance the split is chosen for**, and it is why C7d is
sized M while the other three are L.

The wondrous category is 127 items, half the list, so it is the one category that must be sub-split.
It is sub-split **by body slot** — worn (62) versus carried (65) — because `ItemSlotSchema` is a closed
enum the engine switches on, so the sub-split is as machine-checkable as the category split itself,
and because "everything worn on the body" is one coherent authoring job (standing modifiers,
attunement, on/off symmetry) while "everything carried" is another (activation, charges, GM fiat).

---

## 4. The overlay ruling — the options, costed

**The problem, restated from the measurement.** For `cleric`, `fighter` and `wizard`
(`build-class-bundle.ts:33`) the class record in `classes.v1.json` is both the ETL's input and its
output. So the overlay may only **add**: `applyMechanics` refuses to overwrite a key the record already
carries and fails the build naming both homes (`overlay.ts:139-141`, tested at
`mechanics-overlay.test.ts:76`). A *second* edit to a shipped rider is therefore unauthorable from the
class module, and the only home left is a hand edit to a **10,418-line** generated-adjacent JSON file
(*measured: `wc -l`*).

**How often it actually bites, measured rather than feared.** Across the three classes: cleric carries
riders on 10 of 11 features, fighter on 11 of 15, wizard on 9 of 10. But the collision only fires when
a unit must **change a key that is already there** — adding an absent key is a clean merge. In this
program that is **exactly one case**: `wizard.spell-mastery` (§1.4). Two nearby cases are clean and
worth naming so nobody assumes the worst: `evoker.empowered-evocation` carries **no riders at all**, so
U23 and U30 can author it additively; `fighter.studied-attacks` likewise carries nothing, so U22's
carrier is a clean add.

### Option 1 — hand-edit `classes.v1.json` / `subclasses.v1.json` for the three

**Cost.** Zero new code. One JSON edit, one `npm run build-class-bundle`, one diff review per case.
**At N = 1 this is the cheapest option on the page.**

**What it costs that is not code.** It reintroduces the shared-file workflow the overlay was extended
to end — `build-class-bundle.ts:826-830` records that before the overlay reached the hand-authored
three, *"Thaumaturge's extra cantrip had to be hand-edited straight into `classes.v1.json`"* and
*"three of the four Stage-4 authoring lanes would otherwise have had to edit that same file."* This
remaining program is shaped around four concurrent agents; that file becomes a merge hotspot the moment
two of them need it. It also splits the authoring surface: an author reading `wizard.ts` to find out
what Wizard authors sees nothing, because the truth is in a 10,418-line JSON file. That is a
discoverability regression with no compiler behind it.

### Option 2 — give the overlay an explicit replacement verb (**recommended**)

A `clears?: readonly string[]` beside the riders on a `FeatureMechanics`: the named keys are deleted
from the record before the merge, so the module can say *"this feature's `choice` is superseded; the
list below replaces it."*

**Cost.** ~15 lines in `overlay.ts` + `applyMechanics`, one test beside the existing collision test,
one paragraph in the header, one decision-log entry. **At N = 1 it is more expensive than Option 1; at
N ≥ 2 it is cheaper, and it does not get worse with N.**

**What it buys.** One home for every rider on all twelve classes, which is the property
`overlay.ts`'s header argues for at length. The collision message today literally instructs *"remove it
from one of the two homes"* — this makes "remove it from the JSON" **expressible in the module**
instead of requiring a hand edit to satisfy the guard's own advice. And it makes the delete
reviewable: a `clears` line sits permanently in the module next to the reason, where the next author
reads it.

**The honest hazard, and it must be in the ruling.** For a hand-authored class the ETL writes back over
its own input, so a `clears` performs a **one-way, irreversible** edit to the committed JSON: deleting
the `clears` line later does not restore the old value. Three mitigations, all cheap:

- **`clears` is idempotent** — clearing an absent key is a no-op, so the second and later builds are
  clean and the module stays truthful rather than becoming a build error the moment it works;
- **a `clears` entry is a build error unless the same feature also authors a rider**, so it can never
  be used as a silent delete-only tool;
- **the review bar is the `git diff` of `classes.v1.json` in the same commit**, stated in the ruling,
  because the point of the collision guard was always that an overwrite would be *"unreviewable and
  un-revertable"* (`overlay.ts:120-122`).

### Option 3 — narrow the guard to the `choice`/`choices` pair only

Teach `applyMechanics` that authoring `choices` supersedes a record's `choice`. ~5 lines, no new
vocabulary, solves the one measured case. **Rejected:** it is a special case for the pair that happens
to be first, and the second case (a `uses` that must change, an `extraPicks` that must shrink) needs a
second special case. Option 2 is the general form of this at three times the cost and no more risk.

### Option 4 — move the three onto the generated path

**Rejected, and `overlay.ts`'s header already rejected it:** it freezes 242 records' worth of prose into
a hand-maintained copy that the cross-check *deliberately does not compare*, "to gain a place to hang
three lines of riders."

### Recommendation

**Take Option 2, with the three mitigations, and record it.** The decisive argument is not the code
cost — Option 1 wins that at N = 1 — it is that this remaining program's shape is four concurrent
agents in four worktrees, and Option 1's cost is paid in exactly the currency the program is short of.
Option 2 also matches what the generated case already does (§1.5): a magic-item overlay may overwrite
freely because its bundle is an output only, and `clears` is what gives the hand-authored three the
nearest safe equivalent.

**If the client prefers Option 1**, the ruling must still be taken once and written down, and it must
name the serialization consequence: `classes.v1.json` and `subclasses.v1.json` join §7's list, and no
two concurrent agents may hold them.

---

## 5. The carrier obligation — what this program supplies to which zero-author unit

The governing plan's ruling 5: *"the content program supplies a real carrier for every zero-author
unit, so the both-paths test 2 ('not a lone record') stays satisfiable everywhere."* **Satisfiable** is
the operative word, and the distinction decides the deliverable:

- **Where the rider's reader ships today**, the carrier is authored for real, in a C7 lane, and the
  unit's agent finds it already in the bundle.
- **Where the rider does not exist yet** (a new schema field, or a trigger that fails closed), the
  carrier **cannot** be authored ahead of the unit — doing so ships an inert rider, which is the
  precise anti-pattern this whole phase exists to end, and the same reason `masteryReaches` gates a
  slug until its behaviour lands. For those, this program supplies a **reserved carrier**: the named
  SRD records, their exact text, the count that satisfies test 2, and the module line where the
  absence is already written down. The unit's agent authors it in their own commit.

Every record below was found by reading the SRD text in the repo's own bundles, or the vendored
magic-item source. Counts are measured.

| unit | needs | carrier | count | where | status |
| --- | --- | --- | ---: | --- | --- |
| **U17** `widensPicks` | new field | `bard.magical-secrets` (*"whenever the Prepared Spells number increases, you can choose from the Bard, Cleric, Druid, and Wizard spell lists"*) + `college-of-lore.magical-discoveries` (*"These spells can come from the Cleric, Druid, or Wizard spell list"*) | 2 | both generated → class overlay, **no collision** | reserved |
| **U20** weapon-swing override | new rider variant | `monk.martial-arts` die column (`1d6/1d8/1d10/1d12` at 1/5/11/17) + `Sun Blade` (*"deals Radiant damage instead of Slashing"*, and *"functions as a Longsword with the Finesse property"*) + `Energy Bow` (*"deals Force damage instead of Piercing"*) | 3 | monk generated; two items in **C7a** | reserved |
| **U22** target-scoped effects | new field on `EffectInstance` | `fighter.studied-attacks` (*"…you have Advantage on your next attack roll against that creature"* — the exact `vex` shape) + `ranger.precise-hunter` (*"Advantage on attack rolls against the creature currently marked by your Hunter's Mark"*) + `barbarian.improved-brutal-strike` Staggering Blow | 3 | fighter is hand-authored but `studied-attacks` carries **no rider today**, so it is a clean add; ranger and barbarian generated | reserved. **Measured: 0 of 258 magic items author this shape** — the carrier is not an item |
| **U23** `extra-damage`, same type as the trigger | schema change (`damageType` is required) | `Vicious Weapon` (*"This extra damage is of the same type as the weapon's normal damage"*) + `evoker.empowered-evocation` | 2 | item in **C7a**; evoker carries **no riders at all**, so it is a clean add | reserved, shares its record with U30 |
| **U26** `spell-attack-bonus` | reader only | `Wand of the War Mage, +1/+2/+3` · `Staff of the Magi` · `Staff of the Woodlands` · `Talisman of Pure Good` · `Talisman of Ultimate Evil` | **5** | 3 in **C7b**, 2 in **C7c** | reserved — the modifier is collected at `equipment-derivation.ts:682` and applied nowhere, so authoring it before U26 ships an item whose printed bonus does nothing |
| **U29** `attack-kind-is: "spell"` | one line in `attackKindsOf` | the same 5, plus `Spellguard Shield` and `Staff of Power` — 7 items whose text turns on a spell attack roll | **7** | **C7b**, **C7c** | reserved |
| **U30** `spell-school-is` + `spell-level-is` | producer for `RiderContext.spellSchool` | `evoker.empowered-evocation` (shared with U23 — the same record, which is why they cannot land apart) + `evoker.evocation-savant` | 2 | evoker; `evocation-savant` **already carries a `choice`**, so a change there is a §4 collision while `empowered-evocation` is a clean add | reserved |
| **U31** `on-taking-damage` + `damage-reduction` | one new `collectRiders` call | `Gloves of Missile Snaring` (*"take a Reaction to reduce the damage by 1d10 plus your Dexterity modifier"*) + `Ring of Warmth` | 2 | **C7c** | reserved |
| **U32** `on-death-save` + `roll-mode: death-save` | one new call site | `Periapt of Wound Closure` (*"Whenever you make a Death Saving Throw, you can change a roll of 9 or lower to a 10"*) + `Mysterious Deck` | 2 | **C7c** | reserved |

**Two of these carry a warning the consuming unit must not discover on its own.**

- **U26/U29's items are `+1/+2/+3` ladders.** `Wand of the War Mage` expands to three rows (§3's
  expansion rule), so the count is 5 records but 7 rows, and a test asserting "not a lone record"
  should count records, not rows.
- **U30's second carrier collides.** `evoker.evocation-savant` already holds a `choice`, so narrowing
  it to the Evocation school is a §4 case. `empowered-evocation` is clean. U30 should reach for the
  clean one and treat the other as the ruling's second consumer.

**What this program authors for real, because the readers ship:** every `armor-class`, `save-bonus`,
`check-bonus`, `damage-resistance`, `damage-immunity`, `condition-immunity`, proficiency grant,
`roll-mode` on attacks and saves, `casts` block and item `uses` in the SRD list —
`apps/server/test/homebrew-inert-fields.test.ts` proves those readers fire, across 383 lines. Those are
what give C7a–d their far ends, and they are also the first real SRD authors any of them have ever had:
`equipment.v1.json` carries **zero** rider blocks of any kind (§1.5).

---

## 6. Order, concurrency and worktrees

**Ceiling: 4 concurrent agents** (governing plan §1 — 4 cores, one full verification 66 s wall).
**At most 2 concurrent full-suite runs**, and never two server suites at once.

```
batch 0  (SERIAL — nothing else runs)
  C1  weapons ETL home            ── regenerates weapons.v1.json; blocks everything
  C2  the overlay ruling          ── decision + (if taken) overlay.ts + its test

batch 0b (2 concurrent, separate worktrees)
  C3  properties reaches the fight        C4  Wizard's Spell Mastery
      (needs C1)                              (needs C2)

batch 3  (the content program)
  C5  vendor the source           ── SERIAL, one agent, blocks C6
  C6  the magic-item ETL          ── SERIAL, one agent, one parser, blocks C7*
  C7a │ C7b │ C7c │ C7d           ── 4 concurrent, one worktree each, no shared file
  C8  the close                   ── after all four merge
```

**Why C6 is serial even though it is the biggest unit.** It is one parser over one file. Splitting it
gives four agents one file and a merge; the parallelism lives one layer up, in the overlay, which is
what §3 is about.

**Worktree hygiene, from the governing plan and not negotiable:** hard-link `node_modules` with
`cp -al` (measured 0.4 s). **Never symlink it** — POSIX resolves the symlink first, so a worktree's
`node_modules/@vtt/domain` lands on the *original* tree and every cross-package unit produces a green
run that proves nothing about its own worktree. Every unit in this program is cross-package.

**Operational traps that have each cost an agent real time** (governing plan §6, repeated because this
program will hit all three): `npm run build` emits compiled output under the server workspace and
`npm run test` then collects those compiled tests too (185 → 204 files, ~11 spurious failures) — build
only the client workspace; never run two full suites concurrently, because the server suite binds a
live port; read `docs/ai-ledger/known-bugs.md` before calling a red test a regression.

**What this unblocks, and when.** C1 unblocks the whole program and the mastery program's ability to
regenerate anything. C3 unblocks U20 and U35. C6 unblocks C7a–d. C7a unblocks U20 and U23; C7b unblocks
U26 and U29; C7c unblocks U31 and U32. The engine/vocabulary planner and the mastery planner should
sequence their units behind those four merges, not behind the whole program.

---

## 7. Serialization points this program touches

From the governing plan's §5, plus two this program adds. Each is a merge conflict or a silent data
loss waiting to happen.

| point | who | rule |
| --- | --- | --- |
| `packages/content-srd-5.2.1/bundles/weapons.v1.json` | **C1 only** | do not regenerate until C1 lands; regenerating today drops all 38 mastery values silently and the suite stays green (§1.2) |
| `docs/api-reference.md`, `docs/app-map.md` | parent only | generated; **regeneration IS the merge resolution** and runs after the merge. Nothing in this program should touch state/command/HTTP/OpenAPI — if it does, that is a finding, not a doc chore |
| `docs/ai-ledger/current-state.md` | parent only | exactly at its 150-line ceiling (*measured*), pinned in two places, zero headroom — edit by replacement |
| `apps/client/src/homebrew/vocabularies.test.ts` | one unit at a time | exact counts and an ordered list |
| `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` census | one unit at a time | an exact ordered set — measured, **3 rows today**: `equipment.weapon.mastery` (U38), `monster.actions[].multiattack` (U21), `class.widensPicks` (U17). This program deletes **none** of them; C3's `weapon.properties` is not on the list and does not go on it |
| `apps/server/src/equipment-derivation.ts` `IMPLEMENTED_MASTERIES` | the mastery program | one `Set` literal, seven units. **This program never edits it** — C1 supplies the data, not the gate |
| **`apps/client/src/homebrew/schemas.ts`, the weapon block** (new) | C3, then U38 | five rows today at `:764-770`. C3 adds `properties` (sixth), U38 adds `mastery` (seventh). Batch 0 versus the last closer, so no real contention — but the two programs must not both hold the file |
| **`packages/content-srd-5.2.1/src/index.ts` `loadEquipment()`** (new) | C3, then C6 | C3 threads `properties` through the weapon fold; C6 adds a fourth source. Both are in this program and are sequenced; no third party may edit it in between |
| `packages/content-srd-5.2.1/bundles/classes.v1.json` | conditional | **only if the client takes §4 Option 1** — then it joins this list and no two concurrent agents may hold it |
| full-suite verification | ≤ 2 concurrent | the server suite binds a live port |

---

## 8. The verification bar, per unit

Unchanged and non-negotiable (governing plan §6 and ruling 17): **an engine-outcome far end, a
non-vacuity probe at both control level and value level, a 375px touch pass for anything with UI.**
Chromium is pre-installed at `/opt/pw-browsers`; **never run `playwright install`**.

| unit | far end | control probe | value probe | 375px |
| --- | --- | --- | --- | --- |
| **C1** | the regenerated bundle's mastery column is byte-identical on 38 rows | delete the join → the guard fails naming both columns | flip one table cell → the guard fails naming `battleaxe` | no |
| **C2** | the build accepts a declared replacement and rejects an undeclared one | remove `clears` handling → the case fails | clear a key the feature does not author → build error | no |
| **C3** | a Rapier's attack bonus moves to Dexterity, a Glaive's reach becomes 10 ft, a Finesse-gated rider fires on one and not the other | drop `weapon.properties` from the form's fields → the mirror test names the missing field | author `heavy` instead of `finesse` → the Rapier falls back to Strength | **yes** |
| **C4** | a level-18 Wizard is **refused** for answering both rows with level-1 spells | collapse two blocks to one → the refusal stops | set the second block's floor to 1 → the refusal stops | **yes** |
| **C5** | the pinned entry count matches the vendored file | — (a sourcing unit; its probe is the pin) | change the pinned count → the guard fails | no |
| **C6** | a browsed-and-added `Wand of the War Mage, +1` renders on a sheet with its rarity and attunement | remove the fourth fold → the census drops by 268 | change one item's parsed slot → the slot assertion names it | **yes** |
| **C7a** | a `+1` weapon's to-hit **and** damage both move by one | strip the module from `index.ts` → the lane's test names its item | `+1` → `+0` → the number stops moving | yes |
| **C7b** | a `Wand of Fireballs` spends a charge, rolls damage, and **refuses** at zero | strip the module | change the charge limit → the refusal moves | yes |
| **C7c** | a `Cloak of Protection` moves AC and a server-rolled save, and both revert when it comes off | strip the module | change the bonus → both numbers stop moving | yes |
| **C7d** | a `Potion of Resistance` halves a typed damage total and expires | strip the module | change the resisted type → the halving stops | yes |
| **C8** | — | — | — | **this unit is the pass** |

*"The value survived derivation" is not a test.* Every row above ends at a rolled number, a spent
counter, a refusal or a rendered string.

---

## 9. What this program does not own

Named so nobody re-solves it, and so the handoff is precise.

| item | owner | what this program hands over |
| --- | --- | --- |
| U17–U33 | the engine/vocabulary planner | §5's reserved carriers, with the SRD text and the collision status of each |
| U34–U38, `vex`, `slow` | the mastery planner | C1's mastery column, restored and pinned at the exact measured distribution (`vex 8 · slow 7 · sap 6 · topple 5 · nick 4 · push 4 · graze 2 · cleave 2`, 38 of 38) — without it the entire mastery program's data basis is one rebuild from gone. C1 also authors `light` on 8 weapons, which `nick` (U35) needs and which **no engine mechanism reads yet** (see C7a's box) |
| the parity guard, the ~80 capability gaps, the three API defects | the API-parity planner | C6's 268 rows, which is the first SRD content that exercises `rarity`, `slot`, `attunement`, `cursed`, `casts` and item riders at all, and therefore the first real closer for the API's rarity bucket (defect (c) names 7 rarities) |
| `IMPLEMENTED_MASTERIES` | the mastery planner | untouched by this program, by rule |
| the `weapon.mastery` control (U38) | the mastery planner | C3 leaves the weapon block one row wider and says so in §7 |
| a second die for Versatile | nobody, yet | recorded as a named absence in C1's parser; it needs a vocabulary decision, not a content edit |
| the seven ability-score and hit-point items | nobody, yet | recorded as named absences in C7a/C7c/C7d with `ITEM_REFUSED_MODIFIER_TYPES`' own message quoted |

---

## 10. Risks, in the order they will bite

1. **C6 is the longest single unit and its parse is total or it is nothing.** 258 of 258 entries have a
   parseable type line today; if the vendored file's shape differs from the fetched copy in any way,
   the count assertions fail loudly at C5 rather than producing a partial bundle. That is the design.
2. **The inference budget.** `EquipmentWeaponStatsSchema` broke a type two packages away the last time
   a key was added to it, with no error at the edit site. C3's typecheck is root-wide and asserts the
   downstream type explicitly.
3. **The `Potions of Healing` reconciliation** is the one place C6 can produce a duplicate row in a
   player-facing list. It is a decision with two defensible answers; the failure mode is taking neither.
4. **The §4 ruling arriving late.** C4 is blocked on it and so are at least two units in another
   planner's program. It is a small unit and it is scheduled in batch 0 for exactly that reason.
5. **A lane authoring a rider whose reader does not fire.** The admission rule and C8's adversarial
   review both exist for this, and it is the failure mode this repo has shipped eight times.
