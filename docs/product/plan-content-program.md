# The content program — prerequisites, the SRD magic-item list, and the carriers

**Written 2026-08-10 by PLANNER-CONTENT against `6278e5a`. Re-measured 2026-08-10 against HEAD
`36b5a1f` on `claude/feature-impl-program-exec-ekmevw`** — the branch the plan was written on
(`claude/feature-implementations-intake-c5eyu1`) merged as PR #55 and is gone.

This plan is subordinate to [`remaining-program-plan.md`](remaining-program-plan.md), which is the
governing document. Where the two disagree, the governing plan wins on ordering, batching and the
verification bar; this document supplies the *content* half of batches 0 and 3 and nothing else.
[`area-2-plan.md`](area-2-plan.md) remains the reference for each unit's original argument and
[`vocabulary-parity-audit.md`](vocabulary-parity-audit.md) for the per-row evidence.

**Every count and every `file:line` below was re-measured at `36b5a1f`.** Where a number came from
running something, it says *measured* and names the command or the file. Where it is a judgement, it
says so.

**What has already landed, so nobody re-plans it.** Commit `36b5a1f` shipped **C1 in full** and
**C3's plumbing half**: both weapon columns now have an ETL home, `properties` reaches the inventory
row, and three readers that had shipped for releases stopped running against an empty column. **C3's
editor half then landed 2026-08-11, so C3 is complete.** Every section below is written to that state — the measurements
that describe the defect are kept in the past tense where the defect is closed, because the argument
for the guard is the reason the guard has to stay.

**Amended 2026-08-11** by the C7a/C7b salvage and the client ruling it forced: **C9, the
weapon-template mechanism, is a new unit** (§2), the four C7 lane counts are re-measured against the
committed bundle, and §5 gains a seventh U26 carrier. Everything changed on that date says so where
it stands, and the numbers it replaces are kept beside it because the arithmetic between them is the
part a future re-measurement needs.

**Scope.** This program owns six pieces plus one obligation: the weapons ETL home, `properties` on
the weapon schema, the hand-authored overlay ruling, the full SRD magic-item list, Wizard's Spell
Mastery, **the weapon-template mechanism (C9, added 2026-08-11 — and see §9, whose ownership is
provisional)**, and the carrier obligation for the zero-author units. It owns **no** U-numbered unit. The
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
  identifying, attunement, wearing. It contains **zero item entries** and says so at line 2139:
  *"Hundreds of magic items are detailed in 'Magic Items' later in this document."* All 17 headings
  after 2137 are rules — attunement, crafting, brewing, scribing (*measured: heading extraction over
  lines 2137–2287, the end of the file*).
- `packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/PROVENANCE.json`'s `notVendored` field names
  `magic-items.md` among eight files left out, with the reason *"the corresponding bundles already come
  from the open5e fixtures and are cross-validated."* **That reason is false for exactly this one
  file.** There is no magic-item bundle and no magic-item fixture. The claim is a defect and is
  repaired in C5.

So the first content unit vendors the upstream file, at the same pinned commit the other four came
from. **Verified reachable, re-fetched at re-measurement time:** `HTTP 200`, 244,314 bytes, 5,015
lines at `downfallx/dnd-5e-srd-markdown@1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4`, the exact commit
`PROVENANCE.json` already pins. Hand-transcription is not an option here and the reason is in that
same file: hand-authoring is *"where both licensing violations landed."*

**Measured from the fetched file:** `## Magic Items A–Z` (line 578) carries **260 `####` entries**, of
which **2 are embedded creature stat blocks** (`Giant Fly`, `Avatar of Death`), leaving **258 items**.
**140 of 258** require attunement.

**The discriminator is the category word, not the italics** — and getting this wrong is how C6's parse
would silently drop two rows or admit two creatures. *Measured: all 260 entries carry an italic second
line.* The two creature blocks carry `_Large Beast, Unaligned_` and `_Medium Undead, Neutral Evil_`;
the 258 items all open with one of nine category words (`Wondrous Item`, `Weapon`, `Potion`, `Ring`,
`Armor`, `Wand`, `Staff`, `Rod`, `Scroll`). So the parse is total on "italic line present" and
**258 of 258 on "italic line names a category"** — which is the test that separates them.

### 1.2 The weapons ETL had a real source for both missing columns — and now uses it. **DONE, `36b5a1f`.**

The governing plan (ruling 12) said `mastery` had no ETL home. Confirmed at the time, and worse than
stated: the open5e `Weapon.json` fixture has **nine fields** (*measured*) and none of them is mastery
or properties, and `weaponRecords` emitted neither. Since `WeaponReferenceSchema.mastery` is
`.optional()`, `validateBundle` passed and the write dropped all 38 values in silence. **And nothing
caught it:** the weapon assertion (now `packages/content-srd-5.2.1/test/bundle.test.ts:200-203`)
spot-checks Battleaxe's category and damage and never its mastery. A rebuild was green and silently
destructive.

**The column already had a vendored home.** `sources/dnd-5e-srd-markdown/equipment.md` carries the
SRD Weapons table with the columns `Name · Damage · Properties · Mastery · Weight · Cost` — **38 data
rows**, in the same HTML-table shape `build-class-bundle.ts` already parses.

**C1 joined it in.** `build-bundle.ts:585-618` parses the table into `Map<slug, {properties, mastery}>`
and cross-checks every slug against the 17 `WeaponProperty` fixtures; `weaponRecords`
(`build-bundle.ts:620-641`) looks each weapon up and **throws naming the weapon** when a row is
missing, exactly as `SKILL_ABILITY` throws (`build-bundle.ts:679`); `build-bundle.ts:644-645` fails
closed in the other direction too. The regenerated bundle was **143 insertions and zero deletions**.

**Measured at HEAD, on the committed `bundles/weapons.v1.json`:**

- 38 rows, 38 masteries — `vex 8 · slow 7 · sap 6 · topple 5 · nick 4 · push 4 · cleave 2 · graze 2`,
  reproducing the two intakes' count and byte-identical to what was there before the join;
- **70 property assignments over the 9 SRD property slugs**:
  `two-handed 13 · ammunition 9 · heavy 9 · light 8 · thrown 7 · versatile 7 · finesse 6 · loading 6 ·
  reach 5`. Every one of `WEAPON_PROPERTY_IDS`' nine members is authored by at least five weapons, so
  no property lands with zero authors;
- the five `reach` weapons are `Glaive, Halberd, Lance, Pike, Whip`; the six `finesse` weapons are
  `Dagger, Dart, Rapier, Scimitar, Shortsword, Whip`.

**The guard that keeps it true is `bundle.test.ts:224`** — *"emits the SRD mastery and property
columns for all 38 weapons, by name"* — which pins every value rather than counting. That test, not
this document, is what a future regeneration answers to.

### 1.3 `properties` was fully read on the live side and could not be authored at all — the four shapes are closed, the control is not

Not stated anywhere in the governing plan, and it is why `properties` was a four-part unit rather than
a schema line. **The live-play half was already plumbed; the content half was empty.**

- The field exists: `packages/schemas/src/index.ts:354`, `ItemWeaponSchema.properties`.
- **It decides which ability a weapon swings with.** `weaponAbilityModifier`
  (`apps/server/src/equipment-derivation.ts:984-991`) reads `finesse` to take the better of Strength
  and Dexterity, and `thrown` to decide whether a ranged weapon uses Dexterity.
- **It decides reach.** `weaponAction` (`equipment-derivation.ts:994-1016`) reads `reach` at `:1011`
  for 10 feet versus 5, and `thrown` again for whether a swing gets a reach or a range band.
- The rider path exists too: `weaponPropertiesOf` (`equipment-derivation.ts:1044`) →
  `packages/rules-5e/src/riders.ts:194-195`.
- **Nothing wrote it.** `EquipmentWeaponStatsSchema` had no `properties`, so no catalog record could
  carry one, and the catalog→inventory copy in `apps/server/src/character-build.ts` listed five weapon
  keys and `properties` was not among them.

So every weapon in the game swung with `properties: []`. Three consequences, all live and all
user-visible, none of them previously written down:

1. **A Rapier rolled off Strength.** It is a Finesse weapon; the branch that would notice is
   `weaponAbilityModifier`'s first clause, and it never fired. A DEX 15 / STR 12 rogue swung at the
   worse modifier, on the sheet.
2. **A Glaive, Halberd, Lance, Pike and Whip all had 5-foot reach** — the `reach` branch never fired
   (*measured: 5 weapons carry `reach`*).
3. **`weapon-property-is` was inert on every weapon** — the trigger always saw `[]`.

**`properties` had to land on four shapes, not one**, because stopping at the schema leaves a green
build with all three defects intact. **All four landed in `36b5a1f`:**

| # | shape | where | state |
| --- | --- | --- | --- |
| 1 | `WeaponReferenceSchema` | `packages/content-srd-5.2.1/src/schemas.ts:105-140` (`properties` at `:126-139`) | **done, C1** |
| 2 | the ETL emit | `packages/content-srd-5.2.1/scripts/build-bundle.ts:620-641` (`weaponRecords`) | **done, C1** |
| 3 | `EquipmentWeaponStatsSchema` and the `loadEquipment()` weapon fold | `schemas.ts:245-261` (`properties` at `:253-260`), `src/index.ts:113-117` | **done, C3** |
| 4 | the catalog→inventory copy | `apps/server/src/character-build.ts:1586-1591` | **done, C3** |
| 5 | **the editor control** | `apps/client/src/homebrew/schemas.ts:763-795` — the weapon block is six rows | **done, C3** |

Shipping the four without the fifth would have manufactured a fresh SRD-only row, which is the exact
mirror defect the phase exists to end. All five are in: the sixth row is a `tags` chooser over
`WEAPON_PROPERTY_IDS` (not `ctx.weaponProperties`, which is the properties∪masteries union), open so
a homebrew property stays typable. `docs/ai-ledger/known-bugs.md`'s entry is narrowed to `mastery`
alone, whose control is U38's.

Two hazards to carry into the remaining half, both documented in the code:

- `EquipmentWeaponStatsSchema` exists as a **named** schema precisely because *"inlining one more
  property here pushed `z.infer` past TypeScript's expansion budget"* and silently truncated
  `packages/domain`'s `catalog-choice.ts` view of the spell shape (`schemas.ts:232-244`). C1/C3 added
  a key to it and the hazard now has a **compile-time guard** at `bundle.test.ts:19-31`, which pins
  `SpellReference.attackRoll` and `SpellReference.range` — note `range`, an object, and **not**
  `rangeFeet`, which is the domain summary's own flattening. The schema's note named the wrong one of
  the two and was corrected in place at `36b5a1f`. Any further key on this schema still wants a
  root-wide `npm run check`.
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
has exposed `choices` since `c63fa75`.

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
it is hand-authored (no `writeFileSync` in `build-bundle.ts` names it). `enums.ts:86-91` already
records the same measurement and says the rarity containment assertion *"becomes non-vacuous the day
the first magic item lands"* — which this program is. The assertion itself is
`test/enums.test.ts:74-89`.

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
| ~~**C1**~~ | ~~the weapons ETL home — `mastery` and `properties`, derived and fail-closed~~ | M | **LANDED `36b5a1f`** | — |
| **C2** | the hand-authored overlay ruling | S | 0, serial | C4, and any later unit authoring onto cleric/fighter/wizard |
| ~~**C3**~~ | ~~`properties` reaches the **editor** — the control half only; the four data shapes landed in `36b5a1f`~~ | S | **LANDED 2026-08-11** | U20, U35 |
| **C4** | Wizard's Spell Mastery becomes two picks | S | 0b | — |
| **C5** | vendor the magic-item source; repair the provenance and the attribution | S | 3, serial | C6 |
| **C6** | the magic-item ETL — 268 rows, typed, folded into the catalog | L | 3, serial | C7a–d |
| **C7a** | item mechanics — weapons and armour (**60 rows**) | L | 3, concurrent — **24 of 60 landed `e7e3ae0`**; the weapon families are blocked on **C9** | U20, U23, U29 |
| **C7b** | item mechanics — wands, staffs, rods, rings, the scroll (**57**) | L | 3, concurrent — **27 of 57 landed `2e9a050`** | U26, U29, U31 |
| **C7c** | item mechanics — wondrous, worn (**56**) | L | 3, concurrent | U26, U29, U31, U32 |
| **C7d** | item mechanics — potions and carried wondrous (**95**) | M | 3, concurrent | U32 |
| **C8** | the program's close: adversarial review, mobile back-fill, ledger | M | 3, last | — |
| **C9** | the weapon-template mechanism — a magic weapon applies to a base weapon the player picks | L | after C8; **not** batch 3 | C7a's weapon half, and U20's two items |

**The four C7 counts are ROWS, and they were re-measured 2026-08-11 against the committed
`packages/content-srd-5.2.1/bundles/magic-items.v1.json`.** The earlier `52 / 55 / 57 / 94` were
*entries* on the 258 basis, taken before C6 committed; the lanes are keyed by **row id**, and the
ladder expansion (§3's "268 = 258 − 5 + 15") splits five entries into fifteen keys. C7a and C7b each
gain exactly their ladder rows; the C7c/C7d line moved by one item as well, because that boundary is
C6's committed `slot` column and not the plan's pre-C6 "by name" reading — which is the outcome §3
predicted in writing. The per-lane table in §3 carries the arithmetic and the attunement column.

**Total ~11–13 agent-days** left, estimated — C1 and C3 are spent, and C7a and C7b are part-landed
but not closed. Nine units remain, of which four run concurrently; C9 is new and is the largest thing
added to this program since it was written.

The carrier dossier the governing plan's ruling 5 asks for is **§5 of this document**, delivered now
rather than as a unit — it is a reading of the SRD, not a code change, and the units that consume it
belong to other planners.

---

### C1 — the weapons ETL home. **LANDED, `36b5a1f`.** Do not re-plan it; do not regenerate the bundle.

*One unit, one commit. Both columns, because they are one parse, one join and one fail-closed guard;
writing the join twice is how the two halves drift.*

| part | what shipped |
| --- | --- |
| **reader** | `mastery` → `masteryByActionId` (`apps/server/src/equipment-derivation.ts:644-655`), which reads it off the **catalog** at `:650`, not the inventory row. `properties` → `weaponPropertiesOf` (`equipment-derivation.ts:1044`) → `packages/rules-5e/src/riders.ts:194`. Both already shipped; neither was written by this unit. |
| **content** | the SRD Weapons table in `sources/dnd-5e-srd-markdown/equipment.md`, parsed with the existing HTML-table helpers, joined to the open5e fixture by name slug. 38 rows, 38 masteries, 70 property assignments. |
| **control** | **did not apply** — an ETL/content-pipeline shape with no editor surface, the second of the two permitted "does not apply" answers. The control for `properties` is C3's and is not deferred. |
| **test** | `bundle.test.ts:224`, which pins **all 38 mastery values** and **all 70 property assignments** by name, so a future regeneration that drops a column fails instead of shipping. |

**Files touched.**

```
packages/content-srd-5.2.1/scripts/build-bundle.ts        (the parse :585-618, the join :620-641, both fail-closed throws)
packages/content-srd-5.2.1/src/schemas.ts                 (WeaponReferenceSchema gained `properties` at :126-139)
packages/content-srd-5.2.1/bundles/weapons.v1.json        (regenerated — 143 insertions, ZERO deletions)
packages/content-srd-5.2.1/test/bundle.test.ts            (the rebuild guard :224, the compile-time guard :19-31)
```

**Shape as built.** The Weapons table is parsed once into `Map<slug, {properties, mastery}>`; each
weapon is looked up in `weaponRecords`, and a missing row **throws naming the weapon**, exactly as
`SKILL_ABILITY` throws (`build-bundle.ts:679`). The parenthetical in a property cell is stripped — the
table prints `Thrown (Range 20/60)` and `Versatile (1d10)`, and the bare slug is what riders match
(`enums.ts:59-69` states that rule and strips the bundle's own `-wp` suffix for the same reason). Both
vocabularies are cross-checked against the 17 `WeaponProperty` fixtures rather than a second hand list.

**Named absence, so it reads as a decision:** Versatile's two-handed die (`1d10` on a Longsword) is
thrown away by that strip. `EquipmentWeaponStatsSchema` has nowhere to put a second die, and inventing
one here would be a vocabulary addition with no reader. It is recorded in the parser's comment
(`build-bundle.ts:574-579`), not silently dropped.

**Far end, as observed.** The regenerated `weapons.v1.json` diff was **143 insertions and zero
deletions** — only added `properties` arrays, and the mastery column byte-identical on all 38 rows.
That is a stronger far end than any assertion, because it is the exact failure the unit existed to
prevent.

**375px:** no — no UI.

**Serialization, now inverted:** `weapons.v1.json` was regenerated by this unit and nothing else may
regenerate it *for a reason of its own*. A later unit that legitimately rebuilds it answers to
`bundle.test.ts:224`, which fails naming a weapon rather than shipping a dropped column — the guard,
not this sentence, is the protection now.

---

### C2 — the hand-authored overlay ruling. **RULED: Option 2, the `clears` verb.**

*A decision to take once and record, not to route around per unit.* The options and their costs are
still in §4, kept because the ruling's reasons are the argument, not the conclusion — but **§4 is a
record now, not a question.** The client ruled Option 2 with the three mitigations; the implementation
is this program's, and everything downstream (C4, and any later unit authoring onto cleric, fighter or
wizard) lands through it.

| part | what |
| --- | --- |
| **reader** | n/a — this unit adds no vocabulary. |
| **content** | n/a. |
| **control** | n/a. |
| **test** | one case in `packages/content-srd-5.2.1/test/mechanics-overlay.test.ts` beside the existing collision test at `:76` (*"REFUSES to overwrite a value the record already carries"*), proving the declared replacement lands **and** that it is idempotent across a second run — because for a hand-authored class the ETL writes back over its own input. |

**Deliverable:** the `clears` verb on `FeatureMechanics` (`class-mechanics/overlay.ts:77-85`), its
handling in `applyMechanics` (`overlay.ts:124-162`), the test above, a paragraph in the overlay's
header, and a dated entry in `docs/ai-ledger/decision-log.md` in that file's own house style (a
numbered ruling with the reason, not a note).

**375px:** no.

---

### C3 — `properties` reaches the **editor**

***LANDED 2026-08-11.** Shapes 1–4 of §1.3's five landed in `36b5a1f`; shape 5, the editor control,
landed here. The GM could not give a homebrew weapon a property — an SRD Rapier was Finesse and a
GM's rapier could never be. The weapon block is six rows now and both halves of the sentence are true.*

| part | what |
| --- | --- |
| **reader** | ships, three of them — `weaponAbilityModifier` (`equipment-derivation.ts:984`, which delegates the Finesse rule to `weaponAbilityModifierFrom` in `@vtt/rules-5e` so the sheet's tap-to-roll preview derives the same number), `weaponAction`'s reach branch (`:1014`), and `weaponPropertiesOf` (`:1047`) → `packages/rules-5e/src/riders.ts:194`. *Line numbers re-measured 2026-08-11; the earlier `:1011`/`:1044` had drifted by three.* All three fired on SRD weapons only; this unit is what lets a GM's weapon reach them. |
| **content** | ships — the 70 assignments C1 emitted, carried through `loadEquipment()`'s weapon fold (`packages/content-srd-5.2.1/src/index.ts:113-117`) into the catalog record and through `apps/server/src/character-build.ts:1591` onto the inventory row. This unit authors none of it. |
| **control** | **done** — a **sixth** row in the client's weapon block (`apps/client/src/homebrew/schemas.ts:763-795`): `kind: "tags"` + `pick: true` over `WEAPON_PROPERTY_IDS`, capped at 12 to mirror the column's own `.max(12)`. Open, like every other SRD vocabulary control: a homebrew property stays typable, and a test proves one publishes and reaches `weaponPropertiesOf`. |
| **test** | `apps/client/src/homebrew/weapon-properties.mirror.test.ts` — the editor path end to end: authored through the real controls, POSTed and published over the real wire, read back out of the real merged `ContentLibrary`, added through the browse-and-add picker's own projection under the server's `InventoryItemSchema`, and swung. |

> **Do not reach for `ctx.weaponProperties` for the suggestions.** *Measured:*
> `apps/client/src/homebrew/useSchemaContext.ts:33` builds `WEAPON_SLUGS` as
> `[...WEAPON_PROPERTY_IDS, ...WEAPON_MASTERY_IDS]` and hands it to the context as `weaponProperties`
> (`:138`; the same union is in `schema.ts:136`). That union is right for the `weapon-property-is`
> **trigger**, which matches either family. It is wrong for the weapon block, where offering `topple`
> as a property would suggest a value the weapon column cannot mean. Suggest `WEAPON_PROPERTY_IDS`.

**Far end — MET.** A GM-authored weapon with `finesse`, on a DEX 15 / STR 12 character, **swings off
Dexterity**: **+4 to hit and `1d8 + 2`**, out of a record that went through the editor's own controls,
the real POST/publish pair and the real merged catalog. The Maul beside it reads **+3 / `2d6 + 1`** off
Strength, and the SRD Rapier — the control group, green at HEAD — lands on the same +4 / `1d8 + 2`, so
a number that moves for both is a broken fixture rather than a broken editor row. The scores are one
point apart on purpose: `Math.max(str, dex)` would swallow a wide gap. Not "the array survived the form".

**Non-vacuity, both probes — BOTH MET, both restored.** *Control:* deleting the `weapon.properties`
row threw from the authoring harness, verbatim and byte-for-byte as predicted —
`No field "weapon.properties" in the equipment form — the test is addressing a field that does not
exist.` (`authoring-harness.ts:186`; the weapon block flattens to top-level keys, so it is *not* the
container-shaped `Field "a → b"` message). It took all 3 tests in the far-end file with it, plus the
`vocabularies.test.ts` pick census and 5 of the parity guard's 15 — 9 failed / 18 passed over 3 files.
*Value:* authoring `heavy` instead of `finesse` through the same control dropped the attack bonus to
**3** — Strength — and the failure landed **at the far-end assertion** (`expected 3 to be 4`), not at
an intermediate one, which is the difference between a probe and a data check.

**375px: yes.** `node scripts/tap-audit.mjs 375` on `/homebrew`; the count must not rise, and the new
control is checked with touch at a narrow viewport.

**Watch.** This unit adds no schema key, so §1.3's inference-budget hazard is not live for it — that
risk was spent in `36b5a1f` and is now pinned by the compile-time guard at `bundle.test.ts:19-31`.
Root-wide `npm run check` all the same.

**Watch, second.** A character built before `36b5a1f` has no `properties` on its stored inventory
rows. That is precisely what the governing plan's ruling 7 (bump `schemaVersion`, offer a GM-triggered
rebuild) exists for; this unit does not invent a second migration. Its own tests build a fresh
character, so the far end does not depend on the rebuild.

---

### C4 — Wizard's Spell Mastery becomes two picks

| part | what |
| --- | --- |
| **reader** | `featurePicks` (`character-content.ts:538`) and both consumers ship, and have since Magic Initiate; U12 (`d02e894`) made the editor able to say it. |
| **content** | `bundles/classes.v1.json` Wizard `spell-mastery`: one `choice` capped at level 2 becomes two blocks — level 1, and level 2 floored **and** capped. Landed through C2's `clears`, which is the ruled home. |
| **control** | ships — the choice panel is a list of blocks as of `d02e894`, and `writeChoiceBlocks` spells the pair canonically from the block count. |
| **test** | a level-18 Wizard's build offers **two** pick rows with **different** windows, and a build answering both rows with level-1 spells is **refused by name** — the far end is the refusal, which is the whole bug. |

**Ride-along, same commit:** delete the stale reason at
`packages/content-srd-5.2.1/scripts/class-mechanics/wizard.ts:66-73` (it says `overlay.ts`'s
`FeatureMechanics` *"exposes `choice` and not `choices`"* and that `overlay.ts` is *"frozen for
Stage 4"*; `overlay.ts:78` exposes both and Stage 4 is over). The code is truth and the comment is the
defect. *Re-measured at HEAD: the comment is still there, still wrong, still at `:66-73`.*

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
| **test** | the source file's line count (**5,015**) and its `## Magic Items A–Z` entry count (**260 `####`, 258 of them items**) are pinned, so a re-vendor at a different commit fails rather than silently shifting 258 rows. All three numbers re-verified against a fresh fetch of the pinned commit. |

**Files.**

```
packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/magic-items.md   (new, vendored)
packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/PROVENANCE.json  (files[] + notVendored)
packages/content-srd-5.2.1/scripts/build-bundle.ts                      (attribution.additionalSources.covers)
packages/content-srd-5.2.1/bundles/attribution.json                     (regenerated)
```

**Two claims are repaired, not softened.** `PROVENANCE.json:15`'s `notVendored` names eight files —
`spells.md, monsters-A-Z.md, animals.md, magic-items.md, rules-glossary.md, playing-the-game.md,
gameplay-toolbox.md, character-creation.md` — and justifies all eight on the ground that *"the
corresponding bundles already come from the open5e fixtures and are cross-validated"*. **That is false
for `magic-items.md` and true for the other seven** (§1.1), so the repair is to split the sentence,
not to soften it. And `attribution.additionalSources[0].covers` reads *"classes, subclasses, class
spell lists, species, backgrounds, feats"* (*verified in `bundles/attribution.json`, emitted from
`build-bundle.ts:716`*), which becomes untrue the moment this source is used; CC BY attribution is not
a place to leave a stale claim.

**375px:** no.

---

### C6 — the magic-item ETL

*The single largest piece of this program and it is deliberately one agent, because it is one parser.*

| part | what |
| --- | --- |
| **reader** | `loadEquipment()` (`packages/content-srd-5.2.1/src/index.ts:98-124`), which already folds three sources into one catalog (gear `:101`, weapons `:113`, armor `:118`); this adds a fourth. Everything downstream — browse-&-add, `equipmentCatalogOf` (`apps/server/src/equipment-derivation.ts:286`), the sheet — reads the folded catalog and needs no change. |
| **content** | 258 SRD entries → **268 emitted rows** (see the expansion rule below), each with `id`, `name`, `category`, `slot`, `rarity`, `isMagic: true`, `attunement`, `cursed`, `description`. ~~and a `weapon`/`armor` block where the type line names one~~ — **struck 2026-08-11, measured false and it was the plan's own error, not the ETL's**: the type line names the base the item *applies to*, never the item's own stats, so **0 of the 33 `weapon` rows and 0 of the 14 `armor` rows carry a block** and no correct parse could have produced one. That is C9's whole subject. |
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

**The parse, measured against the fetched source.** Every entry is `#### Name`, then an italic
(`_..._`) type line, then prose that may contain the same HTML tables `build-class-bundle.ts` already
renders with `tableAsText`. **All 260 `####` entries carry an italic second line, so italics is not
the discriminator** — the two embedded creature stat blocks (`Giant Fly`, `Avatar of Death`) carry an
italic *creature* line (`_Large Beast, Unaligned_`). The test that separates them is whether that line
opens with one of the nine category words, which **258 of 258** do. The two are skipped **by name,
with a count assertion**, never by a silent filter.

**Category → slot, measured distribution over the 258.**

| type line | count | `slot` |
| --- | ---: | --- |
| Wondrous Item | 127 | by name: worn or `wondrous` — see the warning below |
| Weapon | 33 | `weapon` — except the **2** whose type line says `Weapon (Any Ammunition)` (`Ammunition, +1, +2, or +3`; `Ammunition of Slaying`), which are `ammunition` |
| Potion | 24 | `consumable` |
| Ring | 22 | `ring` |
| Armor | 19 | `armor`, or `shield` for the **7** whose type line says `Armor (Shield)` |
| Wand | 13 | `held` |
| Staff | 12 | `held` |
| Rod | 7 | `held` |
| Scroll | 1 | `consumable` |

`ItemSlotSchema` (`packages/schemas/src/index.ts:29-37`) is a closed enum the engine switches on, so a
name-derived slot must be **asserted** by the bundle guard, not trusted.

> **The wondrous worn/carried split is a READING, and the earlier numbers do not reproduce.** An
> independent re-measurement over the same fetched file, applying the plan's own "by name" rule
> (`amulet|necklace|periapt|medallion|scarab|talisman|brooch` → neck ·
> `cloak|cape|mantle|robe` → shoulders · `helm|hat|circlet|headband|mask|goggles|eyes of|ioun` → head ·
> `boots|slippers` → feet · `gloves|gauntlets|bracers` → hands · `belt` → belt) yields
> **57 worn / 70 carried**: `neck 15 · shoulders 14 · head 13 · feet 7 · hands 6 · belt 2`. The
> earlier draft claimed **62 / 65** with `neck 19`; a scan for worn-location *prose* ("while you
> wear …") yields a third number, **52**. Three methods, three answers — this is a judgement, not a
> machine fact. **C6 asserts the number its own parser produces and writes it down; it must not be
> handed a target to hit.** Note also that `ioun` is **not** a member of `ItemSlotSchema` — `Ioun
> Stone` is `head` or `wondrous`, and inventing a slot for it is a vocabulary change, not a parse.

**Rarity, measured:** `Rare 82 · Uncommon 73 · Very Rare 55 · Legendary 32 · Varies 7 · Common 2 ·
Artifact 1` — 252 — **plus 6 entries whose type line prints a ladder of rarities**: the five
`+1, +2, or +3` rows below and `Horn of Valhalla` (*"Rare (Silver or Brass), Very Rare (Bronze), or
Legendary (Iron)"*), which the expansion rule leaves as one row and which therefore needs a rarity
decision of its own. 252 + 6 = 258. Every value is a member of `RARITY_IDS`, which makes
`test/enums.test.ts:74-89`'s rarity containment assertion **non-vacuous for the first time** — the
exact outcome `enums.ts:86-91` predicted.

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

**The id guard is not optional — it is a precaution against the alternative reconciliation, and that
is the honest framing.** *Re-measured:* under the recommended rule the ids are clean —
**0 of 258** raw name slugs collide with `equipment.v1.json` + `weapons.v1.json` + `armor.v1.json`
(183 ids), **0 of 268** after the `+1/+2/+3` expansion, and **0** internal duplicates. The guard earns
its place on the branch not taken: `Potions of Healing` *expanded* would mint `potion-of-healing`,
which `equipment.v1.json` already ships and `bundle.test.ts:305` already asserts. So the ETL **fails
closed on any minted id already present in the other three bundles**, naming both homes — the same
rule the overlay applies to riders — and today it fires zero times, which is the point.

**One reconciliation to decide inside this unit, recommended here:** keep `Potions of Healing` as the
grouped `varies` row and leave the existing mundane `potion-of-healing` alone. Cost: two rows in the
browse list with similar names. Alternative: expand the four printed tiers and delete the hand-authored
row, which moves one assertion at `bundle.test.ts:305`. Either is defensible; take one and write it
down.

**`costGp: null` on every row.** The SRD prints a value *band by rarity* — `### Magic Item Values by
Rarity`, line 177 of the vendored source, an H3 under `## Magic Item Rarity` — not a per-item price.
Deriving a number from a band would be inventing content.

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
player through the inventory row: `packages/schemas/src/index.ts:361` documents that the carried-item
marker *"deliberately carries NO riders, NO casts and NO `cursed` flag"* and that mechanics resolve by
`item.id` against a catalog that never leaves the server. This unit adds catalog rows only and puts no
new key on the wire, so it is **not** a viewer-safety change. C7c is where `cursed` gets authored, and
its hiding rule is already structural (`packages/content-srd-5.2.1/src/schemas.ts:296-302`, with the
attunement precondition enforced at `:319-326`); that lane re-reads it rather than assuming.

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
only when its reader ships **and produces the printed effect**.* **The second clause was added
2026-08-11 and it is not decoration** — both salvages found riders whose readers ship, fire, and
produce the wrong thing: a `+1` on a weapon row that derives no swing (C7a) and a `casts: cure-wounds`
that synthesises 2d8 of damage at a wounded ally (C7b). **A rider that reaches a reader and produces
the wrong effect is worse than an unauthored one**, because prose is visibly prose and a wrong number
is invisible until the round it lands. A rider that fails either clause is **not** authored — it
is recorded in the module as a **named absence**: the item, the SRD sentence, the vocabulary it needs
and the unit **or bug** that unblocks it, in a comment beside the item's entry. That is exactly the shape
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

- **C7a — weapons and armour (60 rows · 35 attuned; re-measured 2026-08-11 off the committed
  bundle). PART-LANDED at `e7e3ae0`: 24 of 60 — armour 11, shields 6, ammunition 3, weapons 4 — and
  its weapon half is BLOCKED on C9.** The lane's original far end was *"a `+1` weapon's to-hit and
  damage both move by one"* and **it was vacuous**: a magic weapon carries no weapon block, so the
  row derives no swing for a to-hit to move on, and the number only ever appeared because the test
  supplied a weapon block the shipped row does not have. The landed far end is armour instead, and it
  takes nothing from a fixture — an `Armor of Resistance` halves a typed damage total on the damage
  command (*"You have Resistance to one type of damage while you wear this armor"* — the GM picks the
  type off a d10 table, so the lane authored **lightning** and says so). **19 weapon rows are named
  absences citing C9**; the 4 that survive print something that is not a swing (`weapon-of-warning`,
  `luck-blade`, `trident-of-fish-command`, `frost-brand`), and a guard pins that no weapon row carries
  a weapon-scoped rider so a later pass cannot quietly put them back. Reserved for U20 (`Sun Blade`,
  `Energy Bow` — **now behind C9 as well as U20**), U23 (`Vicious Weapon`) and **U29 (`Spellguard
  Shield`, which is `Armor (Shield)` and therefore this lane's, not C7b's)**.
  > **The armour half does NOT have the weapon half's problem, and the reason is the SRD's own
  > wording rather than luck.** `Shield, +2` prints its bonus *"in addition to the Shield's normal
  > bonus to AC"*, so an `armor-class` rider that stacks on whatever base the bearer is also wearing
  > is what the source describes. AC is additive by construction — `armorClassFromEquipment`
  > (`packages/rules-5e/src/character.ts:99`) sums the equipped base's `acBase` and the riders land on
  > top — where a weapon's `+1` needs a *swing* to attach to and there is none. The residual gap is
  > real but small and it is C9's too: a bearer who equips **only** the magic row and no mundane base
  > reads `10 + Dex + N` rather than the base's AC + N, because that row carries no `armor` block
  > either. Do not "fix" it by inventing an `armor` block — that invents stats the SRD does not print.
  > **This lane must not reach for the Light property as a carrier.** Cross-checked with the mastery
  > program and verified here: there is **no two-weapon / off-hand attack mechanism anywhere in the
  > engine** — `weaponAction` (`equipment-derivation.ts:994-1016`) hard-codes
  > `activation: "action"` at `:1007` — and the SRD `two-weapon-fighting` fighting style ships at
  > `packages/content-srd-5.2.1/bundles/feats.v1.json:302` carrying **nothing but
  > `tags: ["fighting-style"]`** (*measured: its `feature` block has a description and a tag and no
  > rider*). Light is a real property and C1 authored it on 8 weapons; what it *does* is U21's and
  > U35's mechanism to build. Any Light-based far end in this lane would be vacuous.
- **C7b — wands, staffs, rods, rings, the scroll (57 rows · 46 attuned; re-measured 2026-08-11).
  PART-LANDED at `2e9a050`: 27 of 57 — wands 9, staffs 8, rings 8, rods 2.**
  Far end: a `Wand of Fireballs` (*"This wand has 7 charges … expend no more than 3 charges to cast
  Fireball (save DC 15)"*) spends a charge, rolls real damage through the item's `casts` block, and
  **refuses** when the charges are gone. **Seven of its `casts` were removed on the same measurement
  and are absences now**, because `castAction` reads a spell's `damage`/`attackRoll` columns as if
  they described one cast: both `docs/ai-ledger/known-bugs.md` `[content/spells]` entries are the
  blocker, and a healing staff pointed at an ally hit them for 2d8 until it was taken out. Reserved
  for U26/U29 (`Wand of the War Mage`, `Staff of the Magi`, `Staff of the Woodlands`, **`Staff of
  Power`** — see §5) and **U31 (`Ring of Warmth`, which is a `Ring` and therefore this lane's, not
  C7c's)**.
- **C7c — wondrous, worn (56 rows · 46 attuned; re-measured 2026-08-11 off C6's committed `slot`
  column, which is the boundary — neither the earlier 63 · 51 nor the "by name" 57 · 47 is what
  shipped).** Far end: a `Cloak of Protection` (*"You gain a +1 bonus to Armor
  Class and saving throws while you wear this cloak"*) moves AC **and** a saving throw the server
  rolls, and comes back off when the cloak does. Reserved for U31 (`Gloves of Missile Snaring`), U32
  (`Periapt of Wound Closure`) and U26/U29 (`Talisman of Pure Good`, `Talisman of Ultimate Evil`,
  and **`Robe of the Archmagi`** — the carrier §5's first draft missed; see the correction there).
  This lane owns `cursed` and re-reads the hidden-until-attuned rule.
- **C7d — potions and carried wondrous (95 rows · 15 attuned, same re-measurement; the earlier
  88 · 10 and 94 · 14 are both superseded).** Far end: a `Potion of Resistance` (*"you have Resistance to one type
  of damage for 1 hour"*) applies a typed resistance and expires. The lightest lane per item and the
  heaviest in named absences — most of the 70 carried wondrous items are GM-fiat and stay prose.
  Reserved for **U32 (`Mysterious Deck`, whose Comet card reads *"you have Advantage on Death Saving
  Throws"* — it is carried wondrous and therefore this lane's, not C7c's)**.

> **The "expressible mechanic" column is gone from these headings, and deliberately.** The earlier
> draft carried `47 / 41 / 49 / 30` as *measured*; it is a textual judgement about whether a sentence
> can be said in this vocabulary, and no re-run reproduces a judgement. Item counts and attunement
> counts are machine facts and are stated above. **Each lane reports its own expressible count as an
> output**, beside its named absences — that number is a finding, not an input.

**Seven items whose central mechanic this vocabulary refuses, and it is a schema decision rather than
an oversight.** `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`
(`packages/content-srd-5.2.1/src/character-content.ts:262`, message at `:263`, enforced at
`src/schemas.ts:329-333`) with a message explaining that an item cannot change a baked-in number
because it cannot be un-granted when the item comes off. *Measured — all seven present in the source,
with the lane each falls in:* **6 of 258** set an ability score — `Amulet of Health` (C7c),
`Belt of Giant Strength` (C7c), `Gauntlets of Ogre Power` (C7c), `Headband of Intellect` (C7c),
`Potion of Giant Strength` (**C7d, and it is the only one of the seven that is**), `Thunderous
Greatclub` (C7a) — and one raises a Hit Point maximum, `Berserker Axe` (C7a). All seven ship as prose
with the refusal quoted beside them. **No lane may work around this by inventing a modifier type;**
that is a vocabulary decision and it belongs to a unit, not to a content author.

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
3. **The ledger.** `docs/ai-ledger/current-state.md` is **exactly at its 150-line ceiling**
   (*re-measured: `wc -l` = 150*), so it is parent-only and edited by replacement, never by addition.
   `known-bugs.md` and `decision-log.md` take this program's entries — and `known-bugs.md`'s entry for
   the weapon block was C3's to narrow, not to delete — **narrowed 2026-08-11** to *"A homebrew weapon
   cannot be given a mastery"*, because U38 still owns the `mastery` half. `npm run docs` is re-run if anything touched
   state/command/HTTP/OpenAPI — nothing in this program should, and if something did, that is a finding.

**375px:** this unit *is* the 375px pass.

---

### C9 — the weapon-template mechanism: a magic weapon applies to a base weapon the player picks

***NEW UNIT, added 2026-08-11 by client ruling.*** *Found by the C7a salvage (`e7e3ae0`), not by the
lane reporting it — the lane's headline far end passed green against a fixture it supplied itself,
and reported that pass as verification. This is the unit that turns 19 named absences back into riders, and it is the largest thing
added to this program since it was written. It is also the only unit here whose implementation lands
in `apps/server` and `packages/schemas`, so read §9 before starting it.*

**The finding, measured over the committed `packages/content-srd-5.2.1/bundles/magic-items.v1.json`
(268 rows).** A magic weapon in the SRD **carries no stats of its own.** The printed type line names
which **base** weapon the item applies to — `Weapon (Warhammer)`, `Weapon (Longbow or Shortbow)`,
`Weapon (Any Simple or Martial)` — and the ETL is faithful to it: **0 of the 33 `weapon`-category rows
carry a `weapon` block.** No damage die, no range, no properties, and therefore no swing.

**The qualifier histogram, measured off the same file — 18 distinct forms over 33 rows, and it is what
settles the shape of the unit:**

| the type line names | rows | the forms |
| --- | ---: | --- |
| **exactly ONE base weapon** | **11** | `Mace` 3 · `Dagger` · `Greatclub` · `Javelin` · `Longsword` · `Quarterstaff` · `Scimitar` · `Trident` · `Warhammer` |
| **a CHOICE of bases** | **22** | `Any Simple or Martial` 9 · `Glaive, Greatsword, Longsword, Rapier, Scimitar, or Shortsword` 3 · `Any Melee Weapon` 2 · `Glaive, Greatsword, Longsword, or Scimitar` 2 · `Longbow or Shortbow` 2 · `Battleaxe, Greataxe, or Halberd` · `Glaive, Greatsword, Longsword, Rapier, Scimitar, Sickle, or Shortsword` · `Greatsword, Longsword, Rapier, Scimitar, or Shortsword` · `Maul or Warhammer` |

**Two thirds of the list is a choice**, which is the fact that rules out every cheaper answer below.

**THE RULING (client, 2026-08-11): the player picks the base weapon the template applies to.** The
chosen base supplies the swing — its die, its damage type, its range band and its properties — and the
magic row's riders scope to that swing. It is an **item-applies-to-item** mechanism and **it does not
exist anywhere in this repo.** It is a unit, not content work, and no lane may route around it.

**Why the rider produces nothing today, precisely — the chain, so nobody re-derives it.**

- `attack-bonus`, `extra-damage`, `critical-range`, `critical-bonus-dice` and `damage-bonus` are
  `THIS_ITEM_BY_DEFAULT` (`packages/rules-5e/src/riders.ts:231`), and `scopeOf` resolves them to
  `"this-item"` whenever the carrier `isWeapon`.
- `isWeapon` is `effectiveSlot(...) === "weapon" || item.weapon !== undefined`
  (`apps/server/src/equipment-derivation.ts:610`), and every one of these 33 rows carries
  `slot: "weapon"` — so they **are** weapon carriers, scope and all.
- `collectRiders` then requires `context.sourceItemId === carrier.sourceItemId`
  (`packages/rules-5e/src/riders.ts:259`): the rider applies only to an attack made **with that item**.
- And there is no such attack. `weaponAction` returns `null` when the row's `weapon` is undefined
  (`apps/server/src/equipment-derivation.ts:996`), and the browse-and-add picker mints the row's block
  from the catalog summary's (`inventoryWeaponFrom`, `apps/client/src/encounter/equipment.tsx:66`),
  which is null here.
- **Driven end to end on a picker-minted `Dwarven Thrower`** (equipped, attuned, exactly as the
  shipped data yields): `derivation.carriers` **1**, `weaponActionIds` **`[]`**, `effectiveActions`
  **`[]`**. The carrier exists and there is nothing for it to modify.

**What already ships, and it is more than it looks — this is the part that sizes the unit.** The
**reader is not the missing half.** `apps/server/test/item-riders.test.ts` criterion 1 drives exactly
this mechanism and is green at HEAD: an inventory row that carries a weapon block, plus a catalog
record with `attack-bonus: 1` and `extra-damage 1d4 lightning`, yields a **rolled** to-hit of **6**
against a base 5, damage `1d6 + 3` piercing (7) **plus** `1d4` lightning (3) as two typed entries,
three auditable rolls, and a drop back to 5 when the sword comes off. **So the reader ships and
produces the printed effect; what fails the admission rule is that no shipped row can reach it.**
C9 is the unit that lets a shipped row reach a reader that already works — which is why its weight is
in the ETL, the schema and the control, not in the engine.

| part | what |
| --- | --- |
| **reader** | **half ships.** Everything downstream of "the row has a weapon block" is done and proven (above). What C9 writes is the binding: the step that gives a magic-weapon row the picked base's stats, and the `weaponAction` name/id treatment that keeps the derived swing labelled as the *magic* item rather than as the base. |
| **content** | the **eligibility column** — which bases each of the 33 rows may apply to. **It is not in the bundle today**: the qualifier is prose inside `description`, and `build-magic-items.ts` reads the type line for `category`/`slot`/`rarity`/`attunement` and discards the rest. 18 distinct forms over 33 rows — small enough to close as a vocabulary, far too irregular to leave open — resolved against `weapons.v1.json`'s 38 rows and **failing closed** on any form that does not, exactly as C1's join throws by name. `Any Simple or Martial` and `Any Melee Weapon` are category predicates, not lists, so the column needs both shapes. |
| **control** | the **pick**, and there are **two** surfaces, not one. (1) the browse-and-add picker, which is where a row is minted (`apps/client/src/encounter/equipment.tsx`) — the 22 choice rows need a base chooser at add time and the 11 single-base rows must not ask. (2) the **homebrew equipment form**, or the SRD half ships a mechanism a GM's own magic weapon cannot use, which is the exact defect C3 existed to close for `properties`. |
| **test** | one both-paths row ending at **two different rolled swings out of one item row** (far end below), plus a bundle guard pinning all 33 eligibility values by name — the C1 shape, which pins values rather than counting, because a regenerated column that silently empties is this program's known failure. |

**Far end — one shipped row, two picked bases, two different rolled numbers.** `Weapon, +1`
(*"Any Simple or Martial"*) bound to a **Greatsword** swings `2d6 + 1` off Strength on a STR 12 /
DEX 15 sheet; **the same row** bound to a **Dagger** swings `1d4 + 2` off Dexterity, because the
Dagger's `finesse` travels with it into `weaponAbilityModifier`
(`apps/server/src/equipment-derivation.ts:984`). Two dice, two abilities, one item row, read out of
the shipped bundle. **A fixture cannot fake this one**: supplying the weapon block is precisely the
thing the unit builds, so a test that supplies it is testing nothing — which is the mistake this
unit exists because of. Beside it, `Dwarven Thrower` (*"Weapon (Warhammer)"*) proves the 11
single-base rows derive a swing with no pick UI at all.

**WHAT C9 DOES NOT UNBLOCK, and getting this wrong would re-ship the exact bug it fixes.** C9 gives
the `+N` families a swing to attach to. It does **not** make them authorable, because
`FeatureModifierSchema` has no flat `damage-bonus`: the only damage rider is `extra-damage`, whose
`formula` is a `DiceFormulaSchema` and therefore requires a die term (*measured in C7a: `{formula:
"1"}` and `{formula: "1d1"}` are both refused with "Use a safe dice formula such as 1d8 + 3."*). So
`Weapon, +1` after C9 would author `attack-bonus: 1` and **silently understate damage by one** —
half-right, invisible at the table, and worse than the absence it replaced. **The `+N` ladder needs
BOTH C9 and a flat `damage-bonus` in the vocabulary** (limit (A) in
`packages/content-srd-5.2.1/scripts/item-mechanics/weapons-armour.ts`, which has no unit yet). The
19 absences citing C9 must each be re-read against their own second blocker before any is authored;
they are not one batch that opens together.

**Rejected alternatives, with their costs — all three were live options and each is wrong differently.**

- **Inherit the single named base for the 11 that name one** (`Dwarven Thrower` → Warhammer's block,
  copied at ETL time). Cheapest by far, needs no control and no pick. **Leaves the other 22 inert** —
  two thirds of the list, including every `+1/+2/+3` ladder row and all nine `Any Simple or Martial`
  items — and it is a *partial* mechanism, so the browse list would have magic weapons that swing
  beside magic weapons that do nothing, with nothing on screen explaining which is which. Rejected as
  the answer; **worth keeping as the first slice of C9's own delivery**, because the 11 need no UI.
- **`scope: "bearer"` on the riders.** It parses today and needs no unit at all, which is what makes
  it dangerous. It is wrong in a way a table feels: it raises **every** attack the bearer makes with
  **any** weapon, and **two magic weapons in a pack stack**. A wrong number is worse than an absent
  one — this is the admission rule's second clause, and it is the specific workaround it forbids.
- **Invent default stats for the magic rows** (give `Sword of Sharpness` a `1d8 slashing` block).
  Ships a swing immediately and needs no pick. It **invents content the SRD does not print**: the
  source says the item applies to a Glaive, Greatsword, Longsword or Scimitar, whose dice are
  `1d10`/`2d6`/`1d8`/`1d6`, so any single default is wrong for at least three of the four. It is also
  unfalsifiable — nothing downstream could ever tell the invented die from a parsed one. Same class of
  refusal as `costGp: null` (§C6): deriving a number the source does not print is not a parse.

**One design question this unit must answer, and it is genuinely open.** Does the picked base travel
as a **copy** of its weapon block onto the inventory row, or as a **`baseWeaponId` reference**
resolved at derivation? A copy is nearly free — `InventoryItemSchema.weapon` already exists
(`packages/schemas/src/index.ts:371-385`) and the picker already mints one — but nothing on the row
then records *which* base was chosen, so the sheet cannot print "Dwarven Thrower (Warhammer)", a GM
cannot audit a wrong pick, and errata to a base never reach rows already minted. A reference fixes all
three and costs a new key on a `.strict()` schema, which is a **state-shape change** and therefore
`npm run docs`, the API reference and a parent-only merge. **Lean: copy the block AND record the base
id** — the copy keeps derivation unchanged and the id is what makes the pick reviewable — but this is
the call I am least confident in, and it is cheap to settle by trying the copy-only shape first and
seeing whether the sheet can say what it needs to.

**Size: L, and honestly it may be two.** The engine is nearly free and everything else is not: an ETL
column with a fail-closed join and a closed 18-form vocabulary, a schema field, two controls with
375px passes each, and a bundle regeneration. If it overruns, the natural split is **C9a** — the
eligibility column, the schema and the 11 single-base rows, no UI, serial against
`build-magic-items.ts` — and **C9b**, the pick, the two controls and the 22 choice rows. I have not
split it here because a column with no reader is the anti-pattern this whole phase exists to end, and
C9a alone would ship one for the 22.

**Serialization.** `build-magic-items.ts` and `bundles/magic-items.v1.json` (against any live C7
lane — the bundle is regenerated by `npm run build-magic-item-bundle -w @vtt/content-srd-5.2.1`, never
by `npm run build-bundle`), `packages/schemas/src/index.ts` if the reference shape is taken, and the
picker file against any other unit touching it. **Run it after C8**, not beside the lanes.

**375px: yes**, and it is a real one — the base chooser lands inside the browse-and-add flow, which is
already the densest surface this program touches. `node scripts/tap-audit.mjs 375`, count must not rise.

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

**By rarity** — rejected, and the repo already says why. `EquipmentReferenceSchema` calls rarity
*"Display and filtering only … rarity is identity, not a mechanical hook"*
(`packages/content-srd-5.2.1/src/schemas.ts:292-293`). A rarity lane is a random
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

The naive split is by item count, and it is wrong: **item count is not work.** Seventy of the
carried wondrous items are GM-fiat prose (`Bag of Beans`, `Deck of Illusions`, `Portable Hole`,
`Sphere of Annihilation`, `Mirror of Life Trapping` — all five verified present in the source) with
nothing this vocabulary can say about them.

*Re-measured over the fetched source. The item and attunement columns are machine counts; the
worn/carried boundary that sets C7c against C7d is a reading, and the numbers below are what the
plan's own "by name" rule produces (see C6's warning):*

**Superseded 2026-08-11 — re-measured off the committed bundle, and these are the numbers a lane
answers to.** The table below is *rows*, which is what a lane is keyed by; the entry-basis numbers it
replaces are kept in the paragraph under it because the arithmetic between them is the useful part.

| lane | rows | attuned | landed | how it is selected off the committed bundle |
| --- | ---: | ---: | ---: | --- |
| **C7a** weapons + armour | 60 | 35 | 24 | `category` ∈ `weapon` 33 · `armor` 14 · `shield` 9 · `ammunition` 4 |
| **C7b** wands, staffs, rods, rings, scroll | 57 | 46 | 27 | `category` ∈ `wand` 15 · `staff` 12 · `rod` 7 (`slot: held` = 34) · `ring` 22, **plus `spell-scroll`** |
| **C7c** wondrous, worn | 56 | 46 | 0 | `category: wondrous-item` with a worn `slot` — `neck 15 · shoulders 15 · head 11 · feet 7 · hands 6 · belt 2` |
| **C7d** potions + carried wondrous | 95 | 15 | 0 | `slot: wondrous` 71 + `category: consumable` 25 − the Spell Scroll |
| **total** | **268** | **142** | **51** | |

**Where the old `52 / 55 / 57 / 94` came from and why it moved.** Those were *entries* on the 258
basis, measured before C6 committed. Two things changed and both were predicted here in writing.
**(1) The ladder expansion.** A lane is keyed by row id, so `weapon-1/-2/-3` are three keys, not one:
C7a gains 8 rows (`ammunition`, `armor`, `shield`, `weapon`), C7b gains 2 (`Wand of the War Mage`),
and 268 − 258 = **+10** exactly. Only `Wand of the War Mage` of the five requires attunement, which is
the whole of 142 − 140 = **+2**. **(2) The wondrous line moved by one item.** C7c/C7d split on C6's
committed `slot` column — §3's own correction says so — and that column reads `56 / 71` where the
plan's pre-C6 "by name" rule predicted `57 / 70` and an earlier draft said `63 / 64`. Three methods,
three answers, exactly as the C6 warning said; **the committed column is the boundary and the other
two are history.** The pair still sums: 56 + 95 = 57 + 94 = 151, and 46 + 15 = 47 + 14 = 61. **The
totals hold: 268 rows and 142 attunements, whichever side of the wondrous line an item falls.**

Row counts run 60 / 57 / 56 / 95 — a 1.7× spread, and it is the *wrong* axis to balance on. Most of
C7d's 95 are GM-fiat prose whose deliverable is a written absence, not a rider; that is why C7d is
sized M while the other three are L, and why **each lane reports its own expressible-mechanic count as
an output** rather than being handed one. **Authoring weight, not item count, is the balance the split
is chosen for** — and the two lanes that have run bear it out: C7a authored 24 of 60 and C7b 27 of 57,
so **the deliverable is roughly half riders and half written absences**, which no item count predicts.

The wondrous category is 127 rows, half the list, so it is the one category that must be sub-split.
It is sub-split **by body slot** — worn (**56 as committed**) versus carried (**71**) — because
"everything worn on the body" is one coherent authoring job (standing modifiers, attunement, on/off
symmetry) while "everything carried" is another (activation, charges, GM fiat).

**One correction to the original argument, because it was the argument's strongest claim.** The
earlier draft said this sub-split is "as machine-checkable as the category split itself" because
`ItemSlotSchema` is a closed enum. It is not: the *category* comes off the printed type line and the
build can check it; a *slot* is derived from the item's NAME, and three derivations give three answers
(57, 62, 52). The enum makes the slot **assertable once C6 has assigned one** — it does not make the
assignment itself checkable. So the lane boundary is C6's committed `slot` column, and C7c/C7d split
on whatever that column says. That is still a hard, build-enforced line; it is just downstream of a
judgement rather than free of one.

---

## 4. The overlay ruling — **taken: Option 2.** The options are kept because the reasons are.

> **This section is a record, not a question.** The client ruled **Option 2, the `clears` verb, with
> its three mitigations**. C2 implements it and C4 lands through it. Everything below is why — read it
> before touching the overlay, do not re-litigate it.

**The problem, restated from the measurement.** For `cleric`, `fighter` and `wizard`
(`build-class-bundle.ts:33`) the class record in `classes.v1.json` is both the ETL's input and its
output. So the overlay may only **add**: `applyMechanics` refuses to overwrite a key the record already
carries and fails the build naming both homes (`overlay.ts:139-141`, tested at
`mechanics-overlay.test.ts:76`). A *second* edit to a shipped rider is therefore unauthorable from the
class module, and the only home left is a hand edit to a **10,418-line** generated-adjacent JSON file
(*re-measured: `wc -l`*).

**How often it actually bites, measured rather than feared.** *Re-measured at HEAD, over the three
records:* cleric carries riders on **10 of 11** features, fighter on **11 of 15**, wizard on **9 of
10**. But the collision only fires when a unit must **change a key that is already there** — adding an
absent key is a clean merge. In this program that is **exactly one case**: `wizard.spell-mastery`
(§1.4). Two nearby cases are clean and worth naming so nobody assumes the worst:
`evoker.empowered-evocation` carries **no riders at all** (*verified*), so U23 and U30 can author it
additively; `fighter.studied-attacks` likewise carries nothing (*verified*), so U22's carrier is a
clean add.

### Option 1 — hand-edit `classes.v1.json` / `subclasses.v1.json` for the three

**Cost.** Zero new code. One JSON edit, one `npm run build-class-bundle`, one diff review per case.
**At N = 1 this is the cheapest option on the page.**

**What it costs that is not code.** It reintroduces the shared-file workflow the overlay was extended
to end — `build-class-bundle.ts:828-830` records that before the overlay reached the hand-authored
three, *"Thaumaturge's extra cantrip had to be hand-edited straight into `classes.v1.json`"* and
*"three of the four Stage-4 authoring lanes would otherwise have had to edit that same 20,000-line
file."* (That comment's own line count is generous — the file is 10,418 lines today.) This
remaining program is shaped around four concurrent agents; that file becomes a merge hotspot the moment
two of them need it. It also splits the authoring surface: an author reading `wizard.ts` to find out
what Wizard authors sees nothing, because the truth is in a 10,418-line JSON file. That is a
discoverability regression with no compiler behind it.

### Option 2 — give the overlay an explicit replacement verb (**RULED — this is the one taken**)

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

### The ruling

**Option 2, with the three mitigations, recorded in `docs/ai-ledger/decision-log.md`.** The decisive
argument is not the code cost — Option 1 wins that at N = 1 — it is that this remaining program's
shape is four concurrent agents in four worktrees, and Option 1's cost is paid in exactly the currency
the program is short of. Option 2 also matches what the generated case already does (§1.5): a
magic-item overlay may overwrite freely because its bundle is an output only, and `clears` is what
gives the hand-authored three the nearest safe equivalent.

Because Option 1 was **not** taken, `classes.v1.json` and `subclasses.v1.json` do **not** join §7's
serialization list — a `clears` line is a module edit, and modules are one-file-per-class by design.

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

**Every row below was re-verified at HEAD**: each class and subclass record was opened in
`bundles/classes.v1.json` / `subclasses.v1.json` and its rider block inspected; each item was found in
the fetched magic-item source, its category read off its own type line, and its quoted sentence
matched. Where a lane assignment moved, it moved because the item's category says so.

| unit | needs | carrier | count | where | status |
| --- | --- | --- | ---: | --- | --- |
| **U17** `widensPicks` | new field | `bard.magical-secrets` (*"you can choose any of your new prepared spells from the Bard, Cleric, Druid, and Wizard spell lists"*, level 10) + `college-of-lore.magical-discoveries` (*"These spells can come from the Cleric, Druid, or Wizard spell list"*, level 6) | 2 | both generated → class overlay. Both already carry a `choice`, so **adding `widensPicks` is a clean add** and only a change to the `choice` itself would be a §4 case | reserved |
| **U20** weapon-swing override | new rider variant | `monk.martial-arts` die column (`1d6/1d8/1d10/1d12` at 1/5/11/17 — *verified: it lives in the per-level `classResources` inside `levelTable`, not on the feature*) + `Sun Blade` (*"deals Radiant damage instead of Slashing damage"*, and *"functions as a Longsword with the Finesse property"*) + `Energy Bow` (*"deals Force damage instead of Piercing"*) | 3 | monk generated; two items in **C7a** | reserved |
| **U22** target-scoped effects | new field on `EffectInstance` | `fighter.studied-attacks` (*"you have Advantage on your next attack roll against that creature"*, level 13 — the exact `vex` shape) + `ranger.precise-hunter` (*"You have Advantage on attack rolls against the creature currently marked by your Hunter's Mark"*, level 17) + `barbarian.improved-brutal-strike` Staggering Blow (level 13) | 3 | **all three carry no rider at all today** (*verified*), so all three are clean adds — including the hand-authored fighter | reserved. **Re-measured: 0 of 258 magic items author this shape** — the carrier is not an item |
| **U23** `extra-damage`, same type as the trigger | schema change (`damageType` is required) | `Vicious Weapon` (*"This extra damage is of the same type as the weapon's normal damage"*) + `evoker.empowered-evocation` (level 10) | 2 | item in **C7a**; evoker carries **no riders at all** (*verified*), so it is a clean add | reserved, shares its record with U30 |
| **U26** `spell-attack-bonus` | reader only | `Wand of the War Mage, +1/+2/+3` · `Staff of the Magi` · `Staff of the Woodlands` · **`Staff of Power`** · `Talisman of Pure Good` · `Talisman of Ultimate Evil` · **`Robe of the Archmagi`** | **7 records / 9 rows** *(was 6 / 8)* | 4 records (**6 rows**) in **C7b**, 3 in **C7c** | reserved — the modifier is collected at `equipment-derivation.ts:682` and applied nowhere, which `apps/server/src/character-build.ts:302` states in the code as `"spell-attack-bonus": "unread"`. Authoring it before U26 ships an item whose printed bonus does nothing |
| **U29** `attack-kind-is: "spell"` | one line in `attackKindsOf` (`apps/server/src/action-resolution.ts:512`) | the same 7, plus `Spellguard Shield` — **8 records / 10 rows** whose text turns on a spell attack roll | **8 records / 10 rows** *(was 7)* | **C7a** 1 (Spellguard Shield is `Armor (Shield)`), **C7b** 4 records / 6 rows, **C7c** 3 | reserved |
| **U30** `spell-school-is` + `spell-level-is` | producer for `RiderContext.spellSchool` | `evoker.empowered-evocation` (shared with U23 — the same record, which is why they cannot land apart) + `evoker.evocation-savant` (level 3) | 2 | evoker; `evocation-savant` **already carries a `choice`** (*verified*), so a change there is a §4 case while `empowered-evocation` is a clean add | reserved |
| **U31** `on-taking-damage` + `damage-reduction` | one new `collectRiders` call | `Gloves of Missile Snaring` (*"take a Reaction to reduce the damage by 1d10 plus your Dexterity modifier"*) + `Ring of Warmth` (*"the ring reduces the damage you take by 2d8"*) | 2 | Gloves in **C7c**; **Ring of Warmth is a `Ring` and therefore in C7b** | reserved |
| **U32** `on-death-save` + `roll-mode: death-save` | one new call site | `Periapt of Wound Closure` (*"Whenever you make a Death Saving Throw, you can change a roll of 9 or lower to a 10"*) + `Mysterious Deck` (the Comet card: *"you have Advantage on Death Saving Throws"*) | 2 | Periapt in **C7c**; **Mysterious Deck is carried wondrous and therefore in C7d**. *Re-measured: these are the only 2 of 258 items whose text names a Death Saving Throw* | reserved |

**Three of these carry a warning the consuming unit must not discover on its own.**

- **U26/U29's items include a `+1/+2/+3` ladder.** `Wand of the War Mage` expands to three rows (§3's
  expansion rule), so U26's count is 7 records but 9 rows, and a test asserting "not a lone record"
  should count records, not rows.
- **U26's sixth carrier was missed by the first draft.** `Staff of Power` prints *"you gain a +2 bonus
  to Armor Class, saving throws, and spell attack rolls"*, so it is a `spell-attack-bonus` carrier and
  not only a U29 one. `Spellguard Shield`, by contrast, grants **no** bonus — *"spell attack rolls
  have Disadvantage against you"* — which is why it is U29's alone. *Re-measured: exactly 7 of 258
  items mention a spell attack roll; 6 of the 7 grant a bonus.*
- **And a SEVENTH carrier was missed for a reason worth keeping: the grep was on the wrong phrase.**
  *Re-measured 2026-08-11 over the committed 268 rows.* `/spell attack roll/` matches **9 rows / 7
  records** and reproduces the line above exactly — which is why it read as settled. But **the SRD
  prints this bonus two ways**, and the second form carries `Robe of the Archmagi`: *"Your spell save
  DC and spell attack bonus each increase by 2."* It is `wondrous-item`, `slot: shoulders`, so it is
  **C7c's**, and it is a `spell-attack-bonus` carrier by any reading. `/spell attack bonus/` matches
  4 more rows and `/spell attack modifier/` 1, but the other four say *"uses **your** spell save DC
  and spell attack bonus"* — `hat-of-many-spells`, `ioun-stone`, `ring-of-spell-storing`,
  `staff-of-swarming-insects` — which is a cast **consuming** the bearer's bonus, not an item granting
  one. So: **U26 is 7 records / 9 rows and U29 is 8 / 10**, and the lesson for anyone re-measuring
  §5 is that an SRD phrase search is a *lower bound* until the near-miss forms have been read by eye.
  Two more rows (`ring-of-the-ram`, `feather-token`) *make* a spell attack rather than modifying one;
  they are neither unit's carrier — they need an item-granted attack action, which is a third shape.
- **U30's second carrier collides.** `evoker.evocation-savant` already holds a `choice`, so narrowing
  it to the Evocation school is a §4 case. `empowered-evocation` is clean. U30 should reach for the
  clean one and treat the other as the ruling's second consumer.

**What this program authors for real, because the readers ship:** every `armor-class`, `save-bonus`,
`check-bonus`, `damage-resistance`, `damage-immunity`, `condition-immunity`, proficiency grant,
`roll-mode` on attacks and saves, `casts` block and item `uses` in the SRD list —
`apps/server/test/homebrew-inert-fields.test.ts` proves those readers fire, across 383 lines
(*re-measured: `wc -l`*). Those are what give C7a–d their far ends, and they are also the first real
SRD authors any of them have ever had: `equipment.v1.json` carries **zero** rider blocks of any kind
(§1.5).

---

## 6. Order, concurrency and worktrees

**Ceiling: 4 concurrent agents** (governing plan §1 — 4 cores, one full verification 66 s wall).
**At most 2 concurrent full-suite runs**, and never two server suites at once.

```
batch 0  (SERIAL — nothing else runs)
  C1  weapons ETL home            ── DONE, 36b5a1f. Bundle regenerated; guard at bundle.test.ts:224
  C2  the overlay ruling          ── RULED (Option 2). Implement `clears` + its test + the log entry

batch 0b (2 concurrent, separate worktrees)
  C3  properties reaches the EDITOR       C4  Wizard's Spell Mastery
      (control half only; no dependency)      (needs C2's `clears`)

batch 3  (the content program)
  C5  vendor the source           ── SERIAL, one agent, blocks C6
  C6  the magic-item ETL          ── SERIAL, one agent, one parser, blocks C7*
  C7a │ C7b │ C7c │ C7d           ── 4 concurrent, one worktree each, no shared file
                                     C7a and C7b are PART-LANDED (24/60, 27/57) and not closed
  C8  the close                   ── after all four merge

after batch 3
  C9  the weapon-template          ── SERIAL. Unblocks C7a's 19 weapon absences, but only together
                                      with limit (A)'s flat `damage-bonus` — see C9 and §10.7
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

**What this unblocks, and when.** C1 is landed, so the mastery program can regenerate bundles again and
U20/U35 have the `properties` data they needed. C3 closed the last half of the editor's weapon block
below `mastery` on 2026-08-11. C6 unblocks C7a–d. C7b unblocks U26, U29 and
U31's ring; C7c unblocks U26, U29, U31 and U32; C7d unblocks U32's second carrier. The
engine/vocabulary planner and the mastery planner should sequence their units behind those four
merges, not behind the whole program.

**Corrected 2026-08-11 — C7a unblocks LESS than this paragraph promised.** It supplies U29's
`Spellguard Shield` and U23's `Vicious Weapon` **as reserved carriers only**; it does **not** supply
U20's `Sun Blade` or `Energy Bow` as working ones, because a magic weapon derives no swing to override
(C9). U20 is therefore behind **C9**, not behind C7a, and any schedule that queued it behind the lane
merge is wrong. U23's carrier is in the same position: the record is there, the swing is not.

---

## 7. Serialization points this program touches

From the governing plan's §5, plus two this program adds. Each is a merge conflict or a silent data
loss waiting to happen.

| point | who | rule |
| --- | --- | --- |
| `packages/content-srd-5.2.1/bundles/weapons.v1.json` | **regenerated by C1, `36b5a1f`** | the hazard is closed: a rebuild that drops either column now fails `bundle.test.ts:224` by name instead of shipping. No further unit in this program regenerates it. |
| `docs/api-reference.md`, `docs/app-map.md` | parent only | generated; **regeneration IS the merge resolution** and runs after the merge. Nothing in this program should touch state/command/HTTP/OpenAPI — if it does, that is a finding, not a doc chore |
| `docs/ai-ledger/current-state.md` | parent only | exactly at its 150-line ceiling (*re-measured: `wc -l` = 150*), pinned in two places, zero headroom — edit by replacement |
| `apps/client/src/homebrew/vocabularies.test.ts` | one unit at a time | exact counts and an ordered list (211 lines) |
| `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts` census | one unit at a time | an exact ordered set — *re-measured at HEAD, still exactly **3 rows***: `equipment.weapon.mastery` (U38), `monster.actions[].multiattack` (U21), `class.widensPicks` (U17). This program deletes **none** of them; C3's `weapon.properties` is not on the list and does not go on it |
| `apps/server/src/equipment-derivation.ts` `IMPLEMENTED_MASTERIES` | the mastery program | one `Set` literal at `:247`, `{graze, sap}` today, seven units. **This program never edits it** — C1 supplied the data, not the gate |
| **`apps/client/src/homebrew/schemas.ts`, the weapon block** | ~~C3~~, now U38 alone | **six rows at `:763-795`** — C3 added `properties` (sixth) 2026-08-11; U38 adds `mastery` (seventh). C3 is out of the file, so the lock is U38's alone |
| **`packages/content-srd-5.2.1/src/index.ts` `loadEquipment()`** | C6 alone now | C1/C3 already threaded `properties` through the weapon fold at `:113-117`; C6 adds a fourth source. No third party may edit it in between |
| **`packages/content-srd-5.2.1/bundles/magic-items.v1.json`** | one C7 lane at a time, then C9 | generated, and **only** by `npm run build-magic-item-bundle -w @vtt/content-srd-5.2.1` — `npm run build-bundle` is a different script and does not emit it. Regeneration IS the merge resolution. Verify `weapons.v1.json` (`45b59185ccb8fa38924cb75c3b8485ff`) and `classes.v1.json` (`456fb5e40b29a439051cb85c36f5fc4b`) are untouched afterwards; both salvages did and both quote the sums |
| **`packages/content-srd-5.2.1/scripts/build-magic-items.ts`** | C6, then C9 alone | C9 adds the eligibility column to the type-line parse. No C7 lane touches this file — a lane that needs a parsed column is asking for a C9-shaped unit, not an ETL edit |
| `packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts` | **C2 alone** | C2 adds `clears` to `FeatureMechanics` and `applyMechanics`. C4 consumes it from `wizard.ts` and does not touch this file |
| full-suite verification | ≤ 2 concurrent | the server suite binds a live port |

---

## 8. The verification bar, per unit

Unchanged and non-negotiable (governing plan §6 and ruling 17): **an engine-outcome far end, a
non-vacuity probe at both control level and value level, a 375px touch pass for anything with UI.**
Chromium is pre-installed at `/opt/pw-browsers`; **never run `playwright install`**.

| unit | far end | control probe | value probe | 375px |
| --- | --- | --- | --- | --- |
| ~~**C1**~~ | **met at `36b5a1f`**: the regenerated bundle was 143 insertions / **zero** deletions — the mastery column byte-identical on all 38 rows | — | — | no |
| **C2** | the build accepts a declared replacement and rejects an undeclared one | remove `clears` handling → the case fails | clear a key the feature does not author → build error | no |
| ~~**C3**~~ | **met 2026-08-11** (`weapon-properties.mirror.test.ts`): a GM-authored Finesse weapon, published over the real wire, swings at **+4 / `1d8 + 2`** on a DEX 15 / STR 12 sheet where a Maul reads +3 / `2d6 + 1` | met — the exact predicted string, verbatim | met — `heavy` drops the bonus to **3**, at the far-end assertion | **yes** |
| **C4** | a level-18 Wizard is **refused** for answering both rows with level-1 spells | collapse two blocks to one → the refusal stops | set the second block's floor to 1 → the refusal stops | **yes** |
| **C5** | the pinned entry count matches the vendored file | — (a sourcing unit; its probe is the pin) | change the pinned count → the guard fails | no |
| **C6** | a browsed-and-added `Wand of the War Mage, +1` renders on a sheet with its rarity and attunement | remove the fourth fold → the census drops by 268 | change one item's parsed slot → the slot assertion names it | **yes** |
| ~~**C7a**~~ | ~~a `+1` weapon's to-hit **and** damage both move by one~~ — **struck: vacuous, and the salvage is why.** **Met instead at `e7e3ae0`**, on armour, out of the shipped bundle: an `Armor of Resistance` takes 12 lightning to **6** (`adjustment: "resistance"`, `adjustmentSource: "Armor of Resistance"`, hp 30 → 24), unequipped takes the full 12, and 12 fire lands whole while worn | met — stripping the lane from `index.ts` gives *"rows changed by the overlay: 0 (0 lane(s): none)"* and 4 failures, the first *"the authored lightning resistance did not halve the total: expected 12 to be 6"* | met — lightning → acid keeps the lane composed at 24 rows and fails ONLY the far end, 1 failed / 9 passed | yes |
| **C7b** | a `Wand of Fireballs` spends 1 of its 7 charges, rolls damage, and **refuses** at zero | strip the module | change the charge limit → the refusal moves | yes |
| **C7c** | a `Cloak of Protection` moves AC **and** a server-rolled save by +1, and both revert when it comes off | strip the module | change the bonus → both numbers stop moving | yes |
| **C7d** | a `Potion of Resistance` halves a typed damage total for its hour and expires | strip the module | change the resisted type → the halving stops | yes |
| **C8** | — | — | — | **this unit is the pass** |
| **C9** | one shipped row, two picked bases: `Weapon, +1` on a **Greatsword** swings `2d6 + 1` off Strength and on a **Dagger** `1d4 + 2` off Dexterity | remove the eligibility column from the ETL → the pick has nothing to offer and the bundle guard names the row | change one row's eligible bases → the swing the pick produces changes with it | **yes** |

*"The value survived derivation" is not a test.* Every row above ends at a rolled number, a spent
counter, a refusal or a rendered string. **C7a is the reason that sentence is in this document
twice**: its far end read as a rolled number and was one, and the number came from the test's own
fixture. **A far end must be driven from the SHIPPED bundle**, and where a test has to build a row by
hand it must build it the way the picker does and no better.

---

## 9. What this program does not own

Named so nobody re-solves it, and so the handoff is precise.

| item | owner | what this program hands over |
| --- | --- | --- |
| U17–U33 | the engine/vocabulary planner | §5's reserved carriers, with the SRD text, the lane and the collision status of each |
| U34–U38, `vex`, `slow` | the mastery planner | **C1's mastery column, landed at `36b5a1f` and pinned by `bundle.test.ts:224`** at the exact measured distribution (`vex 8 · slow 7 · sap 6 · topple 5 · nick 4 · push 4 · graze 2 · cleave 2`, 38 of 38). Without that pin the entire mastery program's data basis was one rebuild from gone. C1 also authored `light` on 8 weapons, which `nick` (U35) needs and which **no engine mechanism reads yet** (see C7a's box) |
| the parity guard, the ~80 capability gaps, the three API defects | the API-parity planner | C6's 268 rows, which is the first SRD content that exercises `rarity`, `slot`, `attunement`, `cursed`, `casts` and item riders at all, and therefore the first real closer for the API's rarity bucket (defect (c) names 7 rarities) |
| `IMPLEMENTED_MASTERIES` | the mastery planner | untouched by this program, by rule |
| the `weapon.mastery` control (U38) | the mastery planner | C3 left the weapon block one row wider (2026-08-11) and says so in §7. The live bug in `docs/ai-ledger/known-bugs.md` is now narrowed to the `mastery` half, U38's alone |
| a second die for Versatile | nobody, yet | recorded as a named absence in C1's parser at `build-bundle.ts:574-579`; it needs a vocabulary decision, not a content edit |
| the seven ability-score and hit-point items | nobody, yet | recorded as named absences in C7a (`Thunderous Greatclub`, `Berserker Axe`), C7c (`Amulet of Health`, `Belt of Giant Strength`, `Gauntlets of Ogre Power`, `Headband of Intellect`) and C7d (`Potion of Giant Strength`), with `ITEM_REFUSED_MODIFIER_TYPES`' own message quoted |
| a flat `damage-bonus` in `FeatureModifierSchema` | nobody, yet | limit (A) in `packages/content-srd-5.2.1/scripts/item-mechanics/weapons-armour.ts`. **It is C9's co-blocker, not a footnote**: without it every `+N` weapon authors its to-hit and understates its damage by N. Whoever schedules C9 must schedule this beside it or the ladder stays absent |
| **C9 itself, as an ownership question** | **this program, provisionally** | Ruled 2026-08-11 as a C-numbered unit here because this program found it and is blocked by it. It is an **engine** mechanism by shape — its implementation lands in `apps/server` and `packages/schemas`, which nothing else in this program touches — so if the engine/vocabulary planner claims it, the number moves and C9's section becomes the handoff dossier unchanged. Say which before anyone starts it |

---

## 10. Risks, in the order they will bite

1. **C6's slot column is a judgement dressed as a count, and it is now the biggest soft spot in this
   plan.** The category histogram, the rarity histogram, the attunement count and the 268-row total
   all reproduce exactly on re-measurement. The **wondrous worn/carried split does not** — three
   derivations give 57, 62 and 52. C6 must assert what its own parser produces and write the number
   down; C7c and C7d then split on that committed column, and their item counts are whatever it says.
   Anyone who hands C6 a target number instead of a rule has reintroduced the failure this bullet
   exists to name.
2. **C6 is the longest single unit and its parse is total or it is nothing.** 258 of 258 entries carry
   an italic line that opens with a category word today; if the vendored file's shape differs from the
   fetched copy in any way, the count assertions fail loudly at C5 rather than producing a partial
   bundle. That is the design.
3. **The `Potions of Healing` reconciliation** is the one place C6 can produce a duplicate row in a
   player-facing list. It is a decision with two defensible answers; the failure mode is taking neither.
   Under the recommended answer the id guard fires **zero** times — which is what a guard should do.
4. **~~A lane authoring a rider whose reader does not fire.~~ IT HAS NOW BITTEN, TWICE, AND IN THE
   WORSE FORM.** Promoted from a risk to a record on 2026-08-11. Both C7a and C7b authored riders whose
   readers **do** fire and produce the wrong thing — 18 weapon rows whose `+N` had no swing to attach
   to, and 7 `casts` that turned healing and buffs into damage. Neither was caught by the lane; both
   were caught by a review pass afterwards, and in C7a's case the lane's own far end was green
   against a fixture it supplied itself and was reported as verification. **The admission rule now has a second clause
   because of this** (see C7a–C7d), and C8's adversarial review must audit *effect*, not merely
   *reach*. §5's lane assignments moved again on this re-measurement (`Robe of the Archmagi` was never
   assigned at all); a lane that authors a reserved carrier because it thought it owned it is the same
   failure wearing a different hat.
7. **C9 will look cheaper than it is, and the shape of the mistake is already known.** Its engine half
   is nearly free — `apps/server/test/item-riders.test.ts` criterion 1 proves the reader works the
   moment a row has a weapon block — so the temptation is to "just copy a base block in the ETL" and
   call it done. That is the rejected third option, it invents content, and it is unfalsifiable
   downstream. The cost is in the eligibility column, the two controls and the co-blocker (limit (A));
   anyone sizing C9 off the engine half will size it wrong.
5. **~~The §4 ruling arriving late.~~** Closed: the ruling is taken (Option 2). What remains is C2's
   implementation, and C4 is the only unit in this program waiting on it.
6. **~~The inference budget.~~** Spent at `36b5a1f` and now guarded at compile time
   (`bundle.test.ts:19-31`). It returns only if a later unit adds another key to
   `EquipmentWeaponStatsSchema`; C3's editor half added none — it is a control over an existing column.
