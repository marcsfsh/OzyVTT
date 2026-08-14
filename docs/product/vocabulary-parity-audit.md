# Vocabulary parity audit — the guard's census of the API↔editor gap

**GENERATED — do not hand-edit.** Regenerate with `npm run docs` (or
`npm run docs:parity --workspace=@vtt/web`); `apps/client/src/homebrew/api-parity.mirror.test.ts`
fails when this file and the guard disagree. It replaces the hand-maintained audit of
2026-08-09 (ruling 19, decision log 2026-08-10), which is archived at
`docs/archive/vocabulary-parity-audit-hand-2026-08-09.md` — the four-way engine/SRD verdicts
in that document were measurements of their day and are NOT reproduced by this generator,
which states only what the guard itself measures: whether the editor can author each key
the nine homebrew body schemas accept.

## Headline counts

- **164 distinct object schemas** carrying **718 declared keys**, expanded to **5081 editor-addressable questions**.
- **2818 covered** — the editor has a control (or a composite ancestor control) for the key.
- **106 system-forced** — stamped by the store or the row, never authored (id/type/source/schema stamps).
- **2157 open**, every one carried by a reasoned exemption row below.

| type | covered | open |
| --- | ---: | ---: |
| background | 447 | 308 |
| class | 465 | 319 |
| equipment | 167 | 85 |
| feat | 404 | 336 |
| monster | 39 | 134 |
| species | 819 | 658 |
| spell | 29 | 4 |
| spell-list | 5 | 2 |
| subclass | 443 | 311 |

## The exemption table — every open address, its reason, and who closes it

A unit that lands a control deletes its rows here **in the same commit** (the census fails
in both directions). `permanent:` rows are gaps no unit will close, each with why.

### Owner: B0

| group | open | reason |
| --- | ---: | --- |
| `monster.^extensions` | 1 | the opaque bag itself — the census's structural blind spot; B0 declares the key contract the walk cannot see |

### Owner: C1

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].onHit[].**` | 60 | a hit that lands a condition — no rows control on the action row |

### Owner: C2

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].legendary.cost` | 20 | the per-round pool cost — the record has actionsPerRound, the action has no cost |

### Owner: C3

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|species\|subclass.actions[].damageByLevel[].**` | 57 | damage that grows with level — feature-carrier actions only (a statblock ActionSchema has no such key, which is why monster is absent) |

### Owner: C4

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].grants.**` | 292 | an action that grants itself an effect, the whole EffectGrant subtree included |

### Owner: content-program

| group | open | reason |
| --- | ---: | --- |
| `*.grants.spells[].**` | 21 | GrantsEditor writes the spells array whole (grantsFromRows, U9); the per-row keys have no FieldDef the probe can see |
| `*.features[].grants.**` | 96 | bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe |
| `*.traits[].grants.**` | 64 | bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe |
| `feat.^feature.grants.**` | 32 | bespoke GrantsEditor JSX at the feat's singular-feature scope — open now that the bare-group credit is gone |
| `*.^grants.**` | 32 | bespoke GrantsEditor JSX at record scope — same probe-blind mount |
| `equipment.casts[].uses.scaling.**` | 3 | an item cast's scaling — zero SRD authors until the magic-item bundle lands |

### Owner: D1

| group | open | reason |
| --- | ---: | --- |
| `species.languageChoices.**` | 3 | 9 of 9 SRD species author languageChoices — the builder's language offer has no authoring end |

### Owner: D2

| group | open | reason |
| --- | ---: | --- |
| `species.^lineages[].**` | 11 | a lineage's own traits — today a lineage row is name + description only |

### Owner: E1

| group | open | reason |
| --- | ---: | --- |
| `class\|subclass.levelTable[].classResources[].**` | 6 | the resource rows LevelTableEditor writes without FieldDefs — E1's refactor gives them real fields plus the missing id/display pair |
| `class\|subclass.levelTable[].**` | 20 | bespoke LevelTableEditor JSX with no FieldDef — authored today, invisible to the probe (the E1 refactor is the visibility fix) |

### Permanent, with reasons

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].reaction.**` | 40 | one SRD author (rogue uncanny-dodge) — test 2's 'not a lone record' is unsatisfiable (§4) |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].spellId` | 20 | synthesised at character-build.ts:443, zero hand authors (§4) |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].spellSlot.level` | 20 | synthesised from an item's consumesSpellSlot (equipment-derivation.ts:918), zero hand authors (§4) |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].requiresEffectTag` | 20 | zero SRD authors; read at action-resolution.ts:230 — C4 authors the effect side it reads (§4) |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].targetRules` | 20 | one SRD author (§4, lone record) |
| `background.languageChoices.**` | 3 | zero SRD backgrounds author it (§4) |
| `background.^languages` | 1 | zero SRD backgrounds author it (§4) |
| `background.skillChoices.**` | 3 | zero SRD backgrounds author it (§4) |
| `background.toolChoices.**` | 3 | one SRD background authors it (§4, lone record) |
| `species.abilityBonusChoice.**` | 3 | zero SRD species author it (§4) |
| `class.skillChoices.fromCatalog` | 1 | zero of 12 SRD classes author it — every class uses the from list, which has a control (§4); the group's rows never offered it |
| `class.toolChoices.fromCatalog` | 1 | zero of 12 SRD classes author it (§4); the group's rows never offered it |
| `spell-list.^add` | 1 | written whole by the bespoke SpellListContents editor — no FieldDef the probe can see |
| `spell-list.^remove` | 1 | written whole by the bespoke SpellListContents editor — no FieldDef the probe can see |
| `monster.proficiencies.**` | 8 | 0 of 330 SRD monsters author it, and a control would change which rung saves resolve on (§4, B1's trap) |
| `monster.spellcasting.**` | 20 | a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4) |
| `monster.character.**` | 15 | a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4) |
| `monster.startingInventory[].**` | 22 | a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4) |
| `monster.startingCurrency.**` | 5 | a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4) |

### Owner: U21a

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].multiattack[].**` | 40 | 126 SRD authors; owned outside this program (census row at vocabulary-parity.mirror.test.ts:3416) |

### Owner: U38

| group | open | reason |
| --- | ---: | --- |
| `equipment.weapon.mastery` | 1 | owned outside this program (census row at vocabulary-parity.mirror.test.ts:3415) |

### Unowned — real gaps no plan has claimed

| group | open | reason |
| --- | ---: | --- |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].attack.count` | 20 | attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review) |
| `background\|class\|equipment\|feat\|monster\|species\|subclass.actions[].attack.criticalBonusDice` | 20 | attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review) |
| `background\|class\|equipment\|feat\|species\|subclass.actions[].attack.proficient` | 19 | the feature attack shape's proficiency flag — no row enumerates it (the statblock shape does not carry it) |
| `background\|class\|equipment\|feat\|species\|subclass.actions[].save.dc.**` | 57 | the feature save's DERIVED dc object (ability/base/proficiencyBonus) — the rows author the statblock's flat number only |
| `background\|class\|equipment\|feat\|species\|subclass.effects[].onEnd[].**` | 57 | what happens when an effect ends — no program unit authors it |
| `background\|class\|equipment\|feat\|species\|subclass.effects[].endsWithTag` | 19 | effect linkage vocabulary with no control — no program unit authors it |
| `background\|class\|equipment\|feat\|species\|subclass.effects[].target` | 19 | effect linkage vocabulary with no control — no program unit authors it |
| `background\|class\|equipment\|feat\|species\|subclass.effects[].voidWhileIncapacitated` | 19 | effect linkage vocabulary with no control — no program unit authors it |
| `background\|class\|equipment\|feat\|species\|subclass.modifiers[].**` | 33 | the modifier rows beyond U6's type control — neither union's per-key internals (appliesTo/damageTypes on effects; the feature union's filters) have fields |
| `*.choice.options[].**` | 424 | an option's own payload (nested choice, grants, uses, extraPicks) — the choice panel authors one level and no deeper |
| `*.choices[].**` | 452 | the plural choices list — the panel writes the singular choice; the list shape has no control at all |
| `*.choice.**` | 10 | the parts of a feature's choice beyond the panel's fields |
| `*.uses.scaling.table[].**` | 6 | the by-level table at the three mounts the canonicaliser cannot reach — lineage depth, the feat's dotted singular feature, a cast's row scope (instrumented: exactly those six). The plain feature mounts author the table and probe covered |
| `*.extraPicks[].**` | 12 | extra-pick rows beyond the resolver U15 wired — no rows control at feature scope |
| `*.replaces[].**` | 6 | the replacement clause's rows — written whole by the U14 control, per-key fields invisible to the probe |
| `species.replacesFeatureId` | 1 | supersession at species-trait scope — the control exists on class features (U14), not here |
| `class.multiclassProficiencies.**` | 3 | the builder does not multiclass — no reader on the build path and no control |
| `class.multiclassPrerequisites.**` | 3 | the builder does not multiclass — the schema key has no reader on the build path and no control |
| `equipment.^uses.scaling.id` | 1 | the class-resource id at ITEM scope — the dedicated field exists on feature mounts only; the item's uses rows omit it |
| `feat.prerequisite.**` | 4 | feat prerequisites have no controls — the ability-score rows, the requires slug and the printed text alike |
| `spell.castingOptions[].**` | 4 | a spell's casting options — the spell form has no rows control for them |

## What this census cannot see, stated so nobody over-reads a green run

- **Values.** A key with a control can still have an unauthorable value (an option missing
  from a select). The round trip in `api-parity.mirror.test.ts` covers the values its
  fixtures exercise; nothing covers the rest.
- **The `extensions` bag.** `z.record(...)` has no addresses inside it, and the sharpest
  monster gap (`extensions["open5e.srd-2024"].savingThrows`, read by `saving-throws.ts`)
  lives exactly there. Unit B0's hand-declared statblock-extension contract is the answer.
- **Engine readers and SRD authorship.** This guard measures the editor. Whether the engine
  reads a key and how many SRD records author it are the census in
  `vocabulary-parity.mirror.test.ts` and the four program plans' evidence, not this file's.
