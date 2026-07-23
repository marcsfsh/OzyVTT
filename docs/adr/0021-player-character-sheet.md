# ADR-0021: Player character sheet — interactive play sheet now, builder-ready

- **Status:** Accepted
- **Date:** 2026-07-23
- **Relates to:** refines the "not a character builder" scope boundary in `CLAUDE.md`;
  builds on ADR-0007 (additive canonical content), ADR-0008 (rules representation),
  ADR-0011 (identity & character claims), ADR-0020 (combat rules engine); gives ADR-0018
  (character-sheet PDF ingestion) a concrete import target.

## Context

OzyVTT is GM-focused: the GM imports stat blocks and runs combat, and the player surface
has been thin — claim a character, track HP/conditions, answer saves, and watch a read-only
action list ("the GM rolls these"). The existing `CharacterSheet` was explicitly
"track, never build," and `CLAUDE.md` listed "not a character builder" as a scope boundary.

The next major update adds the **player-facing** half: an integrated D&D 5e character sheet,
in the spirit of D&D Beyond / Roll20's 2024 module, used at game night on phone or laptop.
This ADR records the decisions that reshape the prior boundary.

## Decision

1. **Ship an interactive *play* sheet, not a guided builder — yet.** Players view and act
   from a rich sheet (tap to roll, spend slots, manage prepared spells / inventory /
   currency). The full **builder** (guided creation, level-up, point-buy, class/race/
   background/feat/item content, and rules auto-derivation) is the **next roadmap update**.

2. **"No-rewrite" data-model contract.** The durable schema stores the builder's *choice
   inputs* — save/skill proficiency selections, spell-slot maxima + known/prepared list,
   class/level/race/background/feats — with **optional override totals** for imports that
   only know final numbers. A single resolver reads `override ?? selection-derived ??
   ability-only`. The builder later *fills the same fields*; no consumer changes. (Storing
   only derived totals in the free-form `extensions` bag — as before — would have forced the
   builder to replace them.)

3. **Immutable definition vs. live actor split**, mirroring `hitDice`/`actionUses`:
   identity, proficiency selections, and spell *capability* live on `ActorDefinition`; live
   `spellSlots`/`pactSlots`/`preparedSpellIds`/`inventory`/`currency` live on `Actor`, seeded
   in `instantiate()` and projected **owner-only**.

4. **Players initiate their own rolls; the server still resolves and authorizes.** Damage to
   monsters stays a GM-applied step — players never reduce another creature's HP. All
   ownership checks funnel through one `canInitiateForActor(initiator, state, actorId, kind)`
   seam, so a future per-table "players may initiate attacks" toggle is a one-field change.

5. **Light hand-edit, not creation.** A player (or GM) may edit their own character's
   structured fields — proficiency selections, spell prep, inventory, and identity — on the
   per-PC imported definition (`import-<actorId>`, 1:1 with the actor), re-validated through
   `ActorDefinitionSchema`. Shared bundle content is never editable this way. Guided creation
   stays deferred to the builder.

**Amendment (v6, 2026-07-23): a slice of "rules auto-derivation" ships in the play sheet.**
Originally this ADR parked all auto-derivation (incl. AC-from-armor) for the builder. In
response to direct GM feedback, the play sheet now derives two things from equipped gear, using
the stats the SRD catalog already vendors (weapon `damageDice`/range; armor `acBase`/dex rules),
stored additively on the inventory item: **(a) Armor Class** — server-authoritative via
`armorClassFromEquipment()` in `@vtt/rules-5e`, recomputed in `instantiate` and on
`character.set-inventory`, and falling back to the stored stat-block AC whenever no armor/shield
is equipped (so imports and monsters are unaffected); **(b) weapon attack actions** — equipped
weapons render as tap-to-roll to-hit/damage on the sheet (Str melee / Dex ranged; finesse,
versatile, and per-weapon proficiency remain builder work as that data isn't vendored). The
guided builder, point-buy, level-up, and full content/derivation are still deferred.

## Consequences

- The `CLAUDE.md` scope line changes from *"not a character builder"* to *"not a character
  builder **yet** — an interactive play sheet ships now; a guided builder is the next roadmap
  update (ADR-0021)."*
- New schema fields are **additive-optional** (old `GameState` still parses); the JSON-Schema
  mirror is kept in lockstep, and the owner-only projection is covered by leak tests.
- New player-allowed commands (tap-to-roll via `dice.roll`; `character.set-slot` /
  `set-prepared` / `set-inventory` / `set-currency` / `set-identity` / `set-proficiencies`)
  all flow through the shared operations layer and the versioned OpenAPI contract.
- Content for classes/races/backgrounds/feats/items and the rules-derivation engine remain
  unbuilt — deferred to the builder. A PDF / D&D Beyond importer (ADR-0018) is a fast-follow.

See the roadmap and codebase orientation in `docs/product/character-sheet-initiative.md`.
