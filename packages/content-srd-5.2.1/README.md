# SRD 5.2.1 content bundles

Curated, offline SRD 5.2.1 content (CC BY 4.0) as canonical, schema-validated JSON — the
content boundary described in ADR-0007/ADR-0015. Nothing here is executable; bundles are
data that `@vtt/schemas` (monsters) and this package's reference schemas validate before
anything consumes it.

## Layout

- `sources/open5e-srd-2024/` — vendored, unmodified [open5e-api](https://github.com/open5e/open5e-api)
  Django fixtures for the `srd-2024` document (CC BY 4.0 — the only document vendored;
  third-party/OGL sources are deliberately excluded).
- `scripts/build-bundle.ts` — the ETL/adapter. Joins Creature + CreatureAction +
  CreatureActionAttack + CreatureTrait and adapts each stat block into a canonical
  `ActorDefinition` (structured attacks/saves/damage; everything unmodeled stays inert in
  `extensions`/description text per ADR-0008), and maps the spell/equipment/rules fixtures
  into typed reference records. Attack actions with no structured row upstream (33, mostly
  animals) are recovered from the standardized 2024 statblock prose by a deterministic
  parser — a flat-damage primary keeps its damage prose-only so structure never
  misrepresents the text. Deterministic output; **refuses to write if any bundle fails
  validation**. Upstream data bugs are fixed via reviewed `CORRECTIONS` tables (never by
  editing sources); fixtures open5e mislabels as SRD are dropped via `EXCLUSIONS`.
  Re-run with `npm run build-bundle -w @vtt/content-srd-5.2.1`.
- `bundles/` — the committed, reviewed bundles:
  - `monsters.v1.json` — all **330** SRD 5.2.1 statblocks (monsters + animals) as
    `ActorDefinition` v1 (423 structured attacks: 390 from upstream rows + 33 prose-
    recovered). Cross-validated statblock-by-statblock against an independent CC-BY copy of
    the SRD text: exact name coverage both ways; 0 mismatches on size, AC, HP, CR, all six
    ability scores, saving throws, initiative, and attack bonuses.
  - `conditions.v1.json` — the 15 SRD conditions as reference text.
  - `spells.v1.json` — all 339 SRD spells with structured casting/save/damage/upcast fields
    plus full text.
  - `weapons.v1.json` + `weapon-properties.v1.json` — the weapon table (38) and the
    property/mastery descriptions (17). (The source does not link per-weapon properties.)
  - `armor.v1.json` — the armor table (13) with AC-derivation fields; the shield row carries
    its +2 bonus in `acBase`.
  - `skills.v1.json` (18) and `damage-types.v1.json` (13) — short reference descriptions.
    Skills additionally carry the SRD `ability` column (`acrobatics` → `dex`, …), hand-added on
    top of the ETL output — a bundle rebuild must preserve it (`build-bundle.ts` does not emit it
    yet; the ability-column test guards against a silent clobber).
  - `rules.v1.json` — the 56 core-rules glossary entries grouped by ruleset (D20 Tests,
    Combat, Damage and Healing, ...).
  - `attribution.json` — the required CC BY 4.0 attribution (wording verified against the
    SRD's own Legal Information page); any surface that displays this content must show it.
  - **Character-builder bundles — PHASE-2 state (vertical slice complete):**
    - `classes.v1.json` — Fighter, Wizard, **Cleric**, each a complete 20-row transcription
      (Cleric's slot columns are asserted equal to `FULL_CASTER_SLOTS` row-for-row).
    - `subclasses.v1.json` — Champion, Evoker, **Life Domain** (domain spells as staged
      always-prepared grants at Cleric levels 3/5/7/9; Preserve Life draws on the shared
      `channel-divinity` uses pool).
    - `species.v1.json` — **all nine** SRD 5.2.1 species (Dragonborn, Dwarf, Elf, Gnome,
      Goliath, Halfling, Human, Orc, Tiefling). Lineage-style choices (Draconic Ancestry,
      Gnomish Lineage, Fiendish Legacy) are `lineages` behind `<speciesId>-lineages`
      catalog slugs; typed riders carry darkvision, resistances, HP-per-level, and
      PB-scaling uses. The SRD grants **no** species languages beyond what character
      creation hands out, so new species list only `common` (the seeded Elf's `elvish` is a
      pre-existing liberty).
    - `backgrounds.v1.json` — all four (Acolyte, Criminal, Sage, Soldier), each with
      ability-score options, an origin feat, and catalog-resolvable equipment/tools.
    - `feats.v1.json` — the **complete SRD 5.2.1 feat chapter** (19 records): Origin (Alert,
      Magic Initiate ×3 per-list variants, Savage Attacker, Skilled), General (Ability Score
      Improvement, Grappler), Fighting Style (Archery, Defense, Great Weapon Fighting,
      Two-Weapon Fighting), Epic Boon (Combat Prowess, Dimensional Travel, Fate, Irresistible
      Offense, Spell Recall, the Night Spirit, Truesight). The formerly seeded **Tough** feat
      was removed: it is PHB-2024-only, not SRD 5.2.1 content (a test pins this).
    - `names.v1.json` — hand-written, original name pools for every species (name lists are
      not SRD text; the seeded Elf pools were replaced for the same reason).
    Remaining: the other 9 classes and their subclasses (phase 5) — a missing class is a
    content gap, not a schema gap.
- `src/character-content.ts` — the character-builder record schemas
  (`ClassReference`, `SubclassReference`, `SpeciesReference`, `BackgroundReference`,
  `FeatReference`, `NamePoolReference`) built on ONE shared `FeatureRecord`: prose plus
  optional structured riders reusing the actor-side `ActionSchema` / `EffectGrantSchema` /
  `ActionUsesSchema` shapes. Every record carries `source: "srd" | "homebrew"`, identity ids
  stay open slugs, and no feature needs hardcoded behavior — homebrew authors the same record.
  A **choice option** (`FeatureChoice.options`) is that same `FeatureRecord` shape, so an
  option carries its own mechanics — Divine Order's Protector grants Martial weapons and Heavy
  armor training right where it is printed, rather than being a bare id nothing consumes.
  `choice.from` remains the canonical id list and is derived from `options` when those are
  authored, so a consumer that only wants ids never changes.
- `src/index.ts` — typed, validated loaders (`loadMonsterDefinitions`, `loadConditions`,
  `loadSpells`, `loadWeapons`, `loadWeaponProperties`, `loadArmor`, `loadSkills`,
  `loadDamageTypes`, `loadRules`, `loadAttribution`, plus `loadClasses`, `loadSubclasses`,
  `loadSpecies`, `loadBackgrounds`, `loadFeats`, `loadNames`). Server-side only: clients
  receive content via server projections, never by importing this package.

## Curation record (why the bundle differs from the raw fixtures)

- **Excluded `giant-fly`** — the SRD 5.2.1 has no Giant Fly statblock (it is referenced only
  inside the Figurine of Wondrous Power item); open5e over-includes it.
- **25 Tiny sizes restored** — open5e's srd-2024 fixtures carry no `tiny` size and store
  those creatures as `small`; the SRD-printed sizes were restored from cross-validation
  (rat, imp, sprite, will-o'-wisp, ...). The SRD's "Medium or Small" NPC statblocks stay at
  open5e's `small`, which is within the SRD's own dual-size statement.
- **`octopus`** — upstream stores the CON/CHA *modifiers* (0 / −3) where the scores (11 / 4)
  belong, plus a garbage CON-save value; **`mastiff`** and **`swarm-of-rats`** store save
  *modifiers* where the SRD-printed save bonuses belong.
- **`greater-invisibility`** — upstream ships an empty description; restored from the SRD.
- Classes, species, feats, and backgrounds were previously deferred as "outside this VTT's
  not-a-character-builder scope". That scope changed (ADR-0021 / the character-builder task
  packet): they are now first-class bundles, transcribed by hand from the SRD 5.2.1 text
  (phase 2 above; the remaining classes are phase 5).
- **Dropped the seeded `tough` feat and Elf's PHB name pools** — Tough is not in the SRD
  5.2.1 feat chapter and the 2014 PHB name lists are not SRD content; both were replaced
  in-license (phase-2 content pass). The seeded Elf's `sizes` was also corrected to
  `["medium"]` (the SRD prints "Medium (about 5–6 feet tall)" only).
- Still deferred (not bundled): magic items and other loot content.

## What deliberately stays prose (ADR-0008)

The rider vocabulary is bounded on purpose. These printed effects have **no** structured
encoding, so they are authored as description text and adjudicated at the table rather than
mis-encoded into a rider that means something else:

- **Weapon Mastery** (Fighter level 1). The pick is real and lands in the choice ledger, but
  the eight mastery properties (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) are combat
  behaviors with no counterpart in `EffectModifier`/`onHit`, and the SRD's per-weapon mastery
  column is not in the vendored fixtures. The chosen weapons are provenance and display only.
- **Potent Spellcasting** (Cleric Blessed Strikes) — "add your Wisdom modifier to Cleric cantrip
  damage": `damage-bonus` carries a flat integer for weapon attacks, not an ability-derived
  bonus scoped to cantrips.
- **Thaumaturge's Arcana/Religion bonus** — an ability-derived bonus to specific skill checks;
  there is no skill-check modifier in the vocabulary. The extra cantrip *is* modeled.
- **Stone's Endurance / Divine Spark healing** — damage reduction and "restore Hit Points equal
  to the roll" have no rider; both actions carry their prose and their use counter.
- **Frost's Chill's Speed reduction** and **Hill's Tumble's Prone** — `onHit` riders only fire
  from an attack roll *on the same action*, and these ride an attack made with another action.
  Encoding them as `onHit` would silently never trigger.
- **"Necrotic or Radiant, your choice"** (Divine Strike, Divine Spark) — a damage part carries
  one type; both are recorded as Radiant with the choice stated in the action text.

## License

Game content: **CC BY 4.0** — "This work includes material from the System Reference Document
5.2.1 ('SRD 5.2.1') by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd.
The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License."
The vendored fixture *files* come from open5e-api, whose code is MIT; the fixtures carry the
SRD's own license per open5e's `Document`/`License` model.
