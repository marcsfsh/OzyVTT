# SRD 5.2.1 content bundles

Curated, offline SRD 5.2.1 content (CC BY 4.0) as canonical, schema-validated JSON: the content
boundary described in ADR-0007/ADR-0015. Nothing here is executable; bundles are data that
`@vtt/schemas` (monsters) and this package's reference schemas validate before anything consumes it.

## Rebuilding

`npm run content` (from the repo root or this package) rebuilds every bundle in `bundles/` from
`sources/`, in dependency order (`scripts/build-content.ts`):

1. Validates the hand-authored bundles in `sources/authored/` (all but the two class files) and
   copies them byte for byte.
2. `scripts/build-bundle.ts`: the open5e ETL (monsters, spells, weapons, armor, the reference text).
3. `scripts/build-class-bundle.ts`: classes and subclasses. Starting equipment resolves against
   steps 1 and 2.
4. `scripts/build-magic-items.ts`: magic items. Bases resolve against the weapons and armor from
   step 2.

Bundles are output only: no script reads its own output, and every step refuses to write when
anything fails validation. `test/content-pipeline.test.ts` reruns the whole pipeline into an empty
scratch directory and requires every committed bundle back byte for byte, so edit `sources/` or
`scripts/` and rerun `npm run content` rather than editing a bundle.

## Layout

- `sources/open5e-srd-2024/`: vendored, unmodified [open5e-api](https://github.com/open5e/open5e-api)
  Django fixtures for the `srd-2024` document (CC BY 4.0; third-party/OGL sources are deliberately
  excluded).
- `sources/dnd-5e-srd-markdown/`: vendored, unmodified CC BY 4.0 markdown transcription of SRD
  5.2.1, pinned to a commit (`PROVENANCE.json`). The open5e fixtures ship no class, subclass,
  species, background, feat or magic-item data, so those come from here. It is a secondary source:
  a cross-check and a transcription source, never an authority that silently overrides a reviewed
  record. Only the files the builder content needs are vendored; `test/magic-item-source.test.ts`
  pins `magic-items.md` by hash.
- `sources/authored/`: content with no machine-readable source, written by hand.
  - `equipment.json`, `species.json`, `backgrounds.json`, `feats.json`, `languages.json`,
    `names.json`: copied to the bundle of the same name (`<name>.v1.json`).
  - `classes.json` and `subclasses.json`: Fighter, Wizard and Cleric with their subclasses,
    transcribed by hand with riders the markdown cannot express. `build-class-bundle.ts` merges the
    class mechanics overlay into them and fails the build if the markdown disagrees with them on hit
    die, saving throws, skill choices, proficiency bonus and spell slots per level, or subclass
    feature levels.
- `scripts/build-bundle.ts`: joins Creature + CreatureAction + CreatureActionAttack +
  CreatureTrait and adapts each stat block into a canonical `ActorDefinition` (structured
  attacks/saves/damage; everything unmodeled stays inert in `extensions`/description text per
  ADR-0008), and maps the spell/equipment/rules fixtures into typed reference records. Attack
  actions with no structured row upstream (33, mostly animals) are recovered from the standardized
  2024 statblock prose by a deterministic parser; a flat-damage primary keeps its damage prose-only
  so structure never misrepresents the text. What each monster and spell save does (half or no
  damage on a success, the condition a failure imposes) is read from the text once here by
  `scripts/save-outcomes.ts`, with reviewed overrides, so the engine never reads prose; authored
  mechanics (classes, species, items) state it explicitly. The same goes for an action's or spell's
  area of effect and for a Multiattack whose attacks the build cannot structure, read here by
  `src/action-prose.ts` (homebrew and imported stat blocks go through it as they enter the
  campaign). Each spell's cast model (the spell attacks one cast makes, its damage and its healing)
  is read here too, by `scripts/spell-effects.ts` with a reviewed table, because the source's damage
  and attack columns describe the prose rather than a cast. Upstream data bugs are fixed via reviewed
  `CORRECTIONS` tables (never by editing sources); fixtures open5e mislabels as SRD are dropped via
  `EXCLUSIONS`.
- `scripts/build-class-bundle.ts`: generates the other nine classes and their subclasses from
  `classes.md`. The markdown carries no riders, so mechanics are authored per class in
  `scripts/class-mechanics/` and merged into every class record, generated or hand-authored. A
  rider may live in only one place: the merge refuses one the record already carries. A feature
  the text prints once but the rules grant in steps (a subclass spells table's later rows,
  Unarmored Movement's column) is a staged feature (`stages`, `subclassStages`), a whole record
  with its own level added beside the printed ones. An option's printed "Prerequisite: Level N+"
  becomes its `level`, and a prerequisite naming another option of the same pick its `requires`.
- `scripts/build-magic-items.ts`: parses `magic-items.md` into one row per item (the five
  "+1, +2, or +3" ladders expand to one row per tier), with slot, rarity, attunement, prose and the
  `appliesTo` base-item column. Mechanics are authored in `scripts/item-mechanics/items.ts`, a map
  from item id to riders, and merged by `scripts/item-mechanics/overlay.ts`, which refuses an
  unknown id, an empty entry, a slug that resolves to nothing and a row the schema rejects. An item
  with no entry ships as prose.
- `bundles/`: the committed output.
  - `monsters.v1.json`: all 330 SRD 5.2.1 statblocks (monsters and animals) as `ActorDefinition`
    v1 (423 structured attacks: 390 from upstream rows and 33 prose-recovered).
  - `conditions.v1.json` (15), `spells.v1.json` (339, with structured casting/save/damage/upcast
    fields plus full text), `weapons.v1.json` (38) and `weapon-properties.v1.json` (17),
    `armor.v1.json` (13, with AC-derivation fields; the shield row carries its +2 in `acBase`),
    `skills.v1.json` (18, each with the SRD ability column), `damage-types.v1.json` (13) and
    `rules.v1.json` (56 core-rules glossary entries grouped by ruleset).
  - `attribution.json`: the required CC BY 4.0 attribution (wording verified against the SRD's
    own Legal Information page); any surface that displays this content must show it.
  - `classes.v1.json` (all twelve classes, each a complete 20-row table) and `subclasses.v1.json`
    (the one SRD subclass per class). Domain, oath, patron, draconic and land spells are staged
    always-prepared grants, one record per table row;
    shared resources (e.g. `channel-divinity`) draw on one uses pool.
  - `magic-items.v1.json`: every SRD magic item, folded into `loadEquipment()`. A magic shield
    carries the base shield's armor block, so its own bonus stacks on the shield's +2.
  - `equipment.v1.json`, `species.v1.json` (all nine SRD species; lineage choices are `lineages`
    behind `<speciesId>-lineages` catalog slugs), `backgrounds.v1.json` (all four),
    `feats.v1.json` (the complete SRD 5.2.1 feat chapter, 19 records), `languages.v1.json` and
    `names.v1.json` (original name pools for every species; name lists are not SRD text).
- `src/character-content.ts`: the character-builder record schemas (`ClassReference`,
  `SubclassReference`, `SpeciesReference`, `BackgroundReference`, `FeatReference`,
  `NamePoolReference`) built on one shared `FeatureRecord`: prose plus optional structured riders
  reusing the actor-side `ActionSchema` / `EffectGrantSchema` / `ActionUsesSchema` shapes. Every
  record carries `source: "srd" | "homebrew"`, and homebrew authors the same record. A choice option
  (`FeatureChoice.options`) is that same `FeatureRecord` shape, so an option carries its own
  mechanics; `choice.from` is derived from `options` when those are authored.
- `src/schemas.ts`: every content shape, and the only entry a browser build may import
  (`@vtt/content-srd-5.2.1/schemas`). Re-exports `character-content.ts`, `spell-lists.ts` and
  `enums.ts`, and adds `HOMEBREW_BODY_SCHEMAS`: the one type-to-schema map that the publish gate,
  the store's read-back parse and the homebrew editor's publish checklist all run. Nothing in this
  module, or anything it imports, may touch `node:` or a bundle.
- `src/enums.ts`: the canonical SRD vocabularies as plain id arrays (`DAMAGE_TYPE_IDS`,
  `CONDITION_IDS`, `MAGIC_SCHOOL_IDS`, `CREATURE_TYPE_IDS`, `WEAPON_PROPERTY_IDS`,
  `WEAPON_MASTERY_IDS`, `GEAR_CATEGORY_IDS`). Literals because the forms that need them run in a
  browser; `test/enums.test.ts` re-derives every list from the bundles and fails on any difference.
- `src/index.ts`: typed, validated loaders for every bundle, plus a re-export of `src/schemas.ts`.
  The loaders are server-side only (`createRequire` reads the bundles off disk); clients receive
  content via server projections and import only the schemas entry.

## Curation record (why the bundles differ from the raw sources)

- **Excluded `giant-fly`**: the SRD 5.2.1 has no Giant Fly statblock (it is referenced only
  inside the Figurine of Wondrous Power item); open5e over-includes it.
- **25 Tiny sizes restored**: open5e's srd-2024 fixtures carry no `tiny` size and store those
  creatures as `small`; the SRD-printed sizes are restored (rat, imp, sprite, will-o'-wisp, ...).
  The SRD's "Medium or Small" NPC statblocks stay at open5e's `small`, which is within the SRD's
  own dual-size statement.
- **`octopus`**: upstream stores the CON/CHA _modifiers_ (0 / -3) where the scores (11 / 4)
  belong, plus a garbage CON-save value; **`mastiff`** and **`swarm-of-rats`** store save
  _modifiers_ where the SRD-printed save bonuses belong.
- **`greater-invisibility`**: upstream ships an empty description; restored from the SRD.
- **No `tough` feat and no PHB name pools**: Tough is not in the SRD 5.2.1 feat chapter and the
  2014 PHB name lists are not SRD content. Elf's `sizes` is `["medium"]` (the SRD prints "Medium
  (about 5-6 feet tall)" only).

## What deliberately stays prose (ADR-0008)

Weapon Mastery is engine behaviour rather than a rider: each weapon row carries its SRD mastery,
the Fighter's picks land in the choice ledger, and all eight properties run in the server's
resolver (`apps/server/src/weapon-mastery.ts`), as does the Light property's extra attack that
Nick depends on.

The rider vocabulary is bounded on purpose. These printed effects have **no** structured
encoding, so they are authored as description text and adjudicated at the table rather than
mis-encoded into a rider that means something else:

- **Potent Spellcasting** (Cleric Blessed Strikes) — "add your Wisdom modifier to Cleric cantrip
  damage": `damage-bonus` carries a flat integer for weapon attacks, not an ability-derived
  bonus scoped to cantrips.
- **Thaumaturge's Arcana/Religion bonus** — an ability-derived bonus to specific skill checks;
  there is no skill-check modifier in the vocabulary. The extra cantrip _is_ modeled.
- **Stone's Endurance / Divine Spark healing** — damage reduction and "restore Hit Points equal
  to the roll" have no rider; both actions carry their prose and their use counter.
- **Frost's Chill's Speed reduction** and **Hill's Tumble's Prone** — `onHit` riders only fire
  from an attack roll _on the same action_, and these ride an attack made with another action.
  Encoding them as `onHit` would silently never trigger.
- **"Necrotic or Radiant, your choice"** (Divine Strike, Divine Spark) — a damage part carries
  one type; both are recorded as Radiant with the choice stated in the action text.

## License

Game content: **CC BY 4.0** — "This work includes material from the System Reference Document
5.2.1 ('SRD 5.2.1') by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd.
The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License."
The vendored fixture _files_ come from open5e-api, whose code is MIT; the fixtures carry the
SRD's own license per open5e's `Document`/`License` model.
