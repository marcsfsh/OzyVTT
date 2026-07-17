# ADR-015: SRD content source and packaging

## Status

Accepted — 2026-07-17. (Previously an index-only proposal: "curated, versioned SRD bundle separate from executable code.")

## Context and decision drivers

The combat loop planned in BUILD_PLAN.md §5 needs real monster content (stat blocks with
structured attacks/saves/damage) and condition reference text, available fully offline on a
LAN with no runtime network calls. ADR-0007 fixed the canonical format (`ActorDefinition`
JSON, adapters at the boundary) and reserved `packages/content-srd-5.2.1` for curated
bundles; what remained open was the *source*: which SRD dataset to convert, under which
license, and how it enters the repo.

Seven candidate repositories were reviewed (2026-07-17): open5e/open5e-api, open5e/open5e,
5e-bits/5e-database, 5e-bits/5e-srd-api, downfallx/dnd-5e-srd-markdown, and two character-
sheet/generator projects. Key findings: open5e-api vendors normalized Django fixtures for
the SRD 5.2 2024 rules under CC BY 4.0 (`data/v2/wizards-of-the-coast/srd-2024/`, including
331 creatures with structured per-action attack rows); 5e-bits/5e-database is denormalized
and easy to parse but its 2024 monster set is nearly empty (a full bestiary exists only in
its 2014/OGL data); the markdown SRD is prose (reference display, not mechanics); the
character tools are out of scope ("not a character builder") and one carries no license.

## Considered options

- **open5e-api `srd-2024` fixtures (chosen):** complete structured 2024 bestiary, single
  clean CC BY 4.0 license, matches the package's stated SRD 5.2.1 target; requires
  reconstructing stat blocks from normalized joins (Creature + CreatureAction +
  CreatureActionAttack + CreatureTrait).
- **5e-bits/5e-database:** simplest record shapes and MIT tooling, but the full bestiary is
  2014 rules under OGL 1.0a — a mixed-license bundle and a ruleset mismatch with
  `content-srd-5.2.1`.
- **Markdown SRD (downfallx or open5e `raw_sources`):** CC BY 4.0 2024 prose; would require
  brittle scraping to drive mechanics. Useful later as a rules-reference pane, not as the
  mechanics source.
- **Running an external content service (open5e API/5e-srd-api):** violates the offline/
  LAN-only constraint outright.

## Decision

The SRD content source is **open5e-api's `srd-2024` document set (SRD 5.2.1, CC BY 4.0)**.
Its fixtures are vendored unmodified into
`packages/content-srd-5.2.1/sources/open5e-srd-2024/` (only the CC-BY `srd-2024` document;
third-party/OGL publisher data is deliberately excluded). A deterministic build-time ETL
(`scripts/build-bundle.ts`) joins the fixtures and adapts each stat block into canonical
`ActorDefinition` v1 JSON per ADR-0007/ADR-0008 — structured attack/save/damage where the
source is structured, inert text (`extensions`, descriptions) for everything else. Combat-
and sheet-relevant reference data ships alongside the bestiary: spells (with structured
save/attack/damage/upcast fields), the weapon and armor tables, weapon property/mastery
texts, skills, damage types, conditions, and the core-rules glossary. The generated bundles
under `bundles/` are committed and reviewed like code; the ETL validates every bundle
fail-closed before writing. Reviewed corrections for upstream fixture bugs live in explicit
`CORRECTIONS` tables in the ETL (with the printed SRD values), and fixtures open5e mislabels
as SRD are dropped via an `EXCLUSIONS` list — never edits to the vendored sources. The
required CC BY 4.0 attribution ships in the bundle and must be shown by any surface that
displays the content.

## Consequences and tradeoffs

The app gains a complete offline 2024 bestiary, spellbook, equipment tables, and rules
reference under one permissive license, at the cost of vendoring ~2.7 MB of source fixtures
plus ~1.6 MB of generated bundles in git. Regenerating after an upstream refresh is a re-run
of the ETL plus a reviewable diff. Choosing 2024 (SRD 5.2.1) over 2014 (SRD 5.1) means the
older bestiary is not bundled; a future OGL 5.1 bundle would be a separate package with its
own license notice, not a mix-in. Classes, species, feats, backgrounds, and magic items are
deliberately not bundled — character-build and loot content outside the product's "not a
character builder" scope (revisit only with a concrete consumer).

## Mobile, security, and visibility impact

Content is inert JSON validated by `@vtt/schemas` before anything consumes it (ADR-0007);
the ETL runs at development time, never at runtime, so the LAN service makes no network
calls. Bundles are loaded server-side (`src/index.ts` loaders); clients receive content only
through server projections/commands, preserving server authority and viewer safety. No
device-specific behavior.

## Migration / reversibility

Bundles carry `schemaVersion` per document (ADR-0007), so a future `ActorDefinition` v2
coexists with v1 and migrates deliberately. Swapping or adding a content source means a new
`sources/<name>/` directory and adapter run — the canonical bundle format and consumers are
unchanged. Removing the content entirely is deleting the package's `sources/` and `bundles/`
directories.

## Validation evidence

`packages/content-srd-5.2.1/test/bundle.test.ts` (11 tests): all 330 definitions pass
`ActorDefinitionSchema`; every hit-point, damage, and spell formula parses with the
authoritative `@vtt/rules-5e` grammar; the aboleth stat block spot-checks faithfully (AC 17,
HP 150 `20d10 + 40`, tentacle +9 reach 15 `2d6 + 5` bludgeoning, Consume Memories save INT
DC 16); fireball, battleaxe, and breastplate spot-check across the reference bundles;
monsters are uniformly hostile with bounded footprints; the 15 SRD conditions and the exact
CC BY 4.0 attribution statement (verified against the SRD's own Legal Information page) are
present. The full bundle was cross-validated statblock-by-statblock against an independent
CC-BY copy of the SRD text: exact 330/330 name coverage in both directions and zero
AC/HP/CR mismatches. Documented curation: `giant-fly` excluded (no SRD statblock — verified
against the SRD text), 25 Tiny sizes restored (upstream flattens Tiny to small), octopus
CON/CHA and greater-invisibility description corrected. ETL report: 989 actions adapted —
390 structured attacks, 184 structured saves. Every bundle (monsters, spells, weapons,
weapon properties, armor, skills, damage types, rules, conditions, attribution) is validated
fail-closed before writing. Full workspace `check`/`test`/`build` green (189 tests).
