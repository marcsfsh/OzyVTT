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
  - `rules.v1.json` — the 56 core-rules glossary entries grouped by ruleset (D20 Tests,
    Combat, Damage and Healing, ...).
  - `attribution.json` — the required CC BY 4.0 attribution (wording verified against the
    SRD's own Legal Information page); any surface that displays this content must show it.
  - **Character-builder bundles — currently PHASE-1 SEEDS, not full transcriptions:**
    `classes.v1.json` (Fighter + Wizard, each with a complete 20-row level table),
    `subclasses.v1.json` (Champion, Evoker), `species.v1.json` (Human, Elf),
    `backgrounds.v1.json` (Soldier, Sage), `feats.v1.json` (Alert, Tough, Savage Attacker,
    Magic Initiate), `names.v1.json` (per-species name pools). These exist to prove the
    record schemas parse and the loaders work while the wizard, rules math, and UI are built
    in parallel. Transcribing the remaining 10 classes, 10 subclasses, 7 species, 2
    backgrounds, and ~16 feats is phases 2 and 5 of the character-builder task packet — a
    missing class is a content gap, not a schema gap.
- `src/character-content.ts` — the character-builder record schemas
  (`ClassReference`, `SubclassReference`, `SpeciesReference`, `BackgroundReference`,
  `FeatReference`, `NamePoolReference`) built on ONE shared `FeatureRecord`: prose plus
  optional structured riders reusing the actor-side `ActionSchema` / `EffectGrantSchema` /
  `ActionUsesSchema` shapes. Every record carries `source: "srd" | "homebrew"`, identity ids
  stay open slugs, and no feature needs hardcoded behavior — homebrew authors the same record.
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
  packet): they are now first-class bundles, seeded above and transcribed in phases 2 and 5.
- Still deferred (not bundled): magic items and other loot content.

## License

Game content: **CC BY 4.0** — "This work includes material from the System Reference Document
5.2.1 ('SRD 5.2.1') by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd.
The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License."
The vendored fixture *files* come from open5e-api, whose code is MIT; the fixtures carry the
SRD's own license per open5e's `Document`/`License` model.
