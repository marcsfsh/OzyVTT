import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { hitDiceFromDefinition, importActorDefinition, seedHitDice, spellSlotMaxima } from "../src/actor-roster.js";
import { applyRest, spendHitDice } from "../src/rests.js";
import { setSpellSlotRemaining } from "../src/spellcasting.js";
import { projectPlayerView } from "../src/projections.js";

/**
 * Multiclass seeding regressions. Two Phase-1 bugs met here:
 *
 *  1. `Actor.hitDice` was derived by regexing `hitPoints.formula`, and `DiceFormulaSchema` allows only
 *     ONE die term - so a Fighter 3 / Wizard 2 (3d10 + 2d6) was literally unparseable and seeded 3
 *     dice instead of 5. The long rest then restored the wrong maximum.
 *  2. Every seeding site read only the TOP-LEVEL `spellcasting.slots`, so a definition that filled
 *     `spellcasting.classes[]` (the multiclass shape) became a "modeled caster with zero slots" and a
 *     long rest restored nothing.
 */

const ACTOR = "10000000-0000-4000-8000-0000000000a1";
const OWNER = "30000000-0000-4000-8000-0000000000b1";

const BASE = {
  schemaId: "vtt.actor-character", schemaVersion: 1,
  source: { name: "test", version: "1" },
  name: "Multiclass Hero", size: "medium",
  abilityScores: { str: 14, dex: 12, con: 14, int: 16, wis: 10, cha: 8 },
  proficiencyBonus: 3, armorClass: 16, speedFeet: 30,
  actions: [], token: { disposition: "friendly", footprint: { width: 1, height: 1 } }, extensions: {}
} as const;

/** Fighter 3 / Wizard 2. The hit-point FORMULA can only say one thing; the class levels say the truth. */
function fighterWizard(overrides: Record<string, unknown> = {}): ActorDefinition {
  return ActorDefinitionSchema.parse({
    ...BASE,
    // A single-term formula is all `DiceFormulaSchema` permits - "3d10 + 2d6" is unparseable - which
    // is precisely why seeding from the formula lost the Wizard's two dice.
    hitPoints: { maximum: 40, formula: "3d10 + 10" },
    character: { classes: [{ id: "fighter", name: "Fighter", level: 3 }, { id: "wizard", name: "Wizard", level: 2 }], feats: [] },
    // Per-class entry only: the combined table is DERIVED, which is exactly the shape that used to
    // seed zero slots. No per-class `slots`, so the parse-time consistency rule is satisfied.
    spellcasting: { ability: "int", saveDc: 14, attackBonus: 6, slots: [], classes: [{ classId: "wizard", ability: "int" }], spells: [{ id: "magic-missile", name: "Magic Missile", level: 1, classId: "wizard" }] },
    ...overrides
  });
}

function gameWith(definition: ActorDefinition): GameState {
  const game = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(game, definition, ACTOR, "public");
  return game;
}
const resolver = (game: GameState) => (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition;
const actorOf = (game: GameState) => game.actors.find((candidate) => candidate.id === ACTOR)!;

describe("multiclass seeding", () => {
  it("seeds the full multiclass Hit Dice pool, not one die size from the hit-point formula", () => {
    const definition = fighterWizard();
    // THE BUG, pinned: the formula can only ever describe the first class's dice.
    expect(hitDiceFromDefinition(definition)).toEqual({ die: "d10", maximum: 3, remaining: 3 });
    const game = gameWith(definition);
    // The seeded pool is 3d10 (Fighter) + 2d6 (Wizard), largest die first.
    expect(actorOf(game).hitDice).toEqual({
      die: "d10", maximum: 5, remaining: 5,
      entries: [{ die: "d10", maximum: 3, remaining: 3 }, { die: "d6", maximum: 2, remaining: 2 }]
    });
    // The summary the pre-multiclass sheet UI reads now counts ALL five dice, not three.
    expect(actorOf(game).hitDice?.maximum).toBe(5);
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("honours an explicit per-class hitDie and still falls back to the SRD class table", () => {
    // Homebrew "moon-warden" is not in the class table; its own hitDie carries the pool.
    const homebrew = fighterWizard({ character: { classes: [{ id: "moon-warden", name: "Moon Warden", level: 4, hitDie: "d12" }, { id: "wizard", name: "Wizard", level: 1 }], feats: [] } });
    expect(seedHitDice(homebrew)).toEqual({
      die: "d12", maximum: 5, remaining: 5,
      entries: [{ die: "d12", maximum: 4, remaining: 4 }, { die: "d6", maximum: 1, remaining: 1 }]
    });
  });

  it("keeps the formula-derived single entry for monsters and class-less legacy sheets", () => {
    const legacy = ActorDefinitionSchema.parse({ ...BASE, hitPoints: { maximum: 30, formula: "7d8 + 14" } });
    expect(seedHitDice(legacy)).toEqual({ die: "d8", maximum: 7, remaining: 7, entries: [{ die: "d8", maximum: 7, remaining: 7 }] });
    const unmodeled = ActorDefinitionSchema.parse({ ...BASE, hitPoints: { maximum: 30 } });
    expect(seedHitDice(unmodeled)).toBeNull();
  });

  it("spends the pool largest die first and a long rest restores every die size", () => {
    const game = gameWith(fighterWizard());
    // Four dice spent: all three d10s, then one d6.
    spendHitDice(game, ACTOR, [5, 5, 5, 3], { role: "gm" }, resolver(game));
    expect(actorOf(game).hitDice).toEqual({
      die: "d10", maximum: 5, remaining: 1,
      entries: [{ die: "d10", maximum: 3, remaining: 0 }, { die: "d6", maximum: 2, remaining: 1 }]
    });
    // Spending past the whole pool is still rejected on the TOTAL, not on one die size.
    expect(() => spendHitDice(game, ACTOR, [4, 4], { role: "gm" }, resolver(game))).toThrowError(/1 Hit Die left/);
    applyRest(game, ACTOR, "long", resolver(game));
    expect(actorOf(game).hitDice).toEqual({
      die: "d10", maximum: 5, remaining: 5,
      entries: [{ die: "d10", maximum: 3, remaining: 3 }, { die: "d6", maximum: 2, remaining: 2 }]
    });
  });

  it("derives the combined spell-slot table from classes[] when the top level is empty", () => {
    const definition = fighterWizard();
    // THE BUG, pinned: the only field the old seeding read is empty on this shape, so the character
    // was seeded as a modeled caster with zero slots instead of failing loudly.
    expect(definition.spellcasting?.slots).toEqual([]);
    const game = gameWith(definition);
    // SRD multiclassing: Fighter contributes nothing, Wizard 2 -> caster level 2 -> three 1st-level slots.
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    expect(spellSlotMaxima(fighterWizard())).toEqual([{ level: 1, max: 3 }]);
    // Prepared spells and the definition link still seed as before.
    expect(actorOf(game).preparedSpellIds).toEqual(["magic-missile"]);
  });

  it("rounds half-caster levels down into the shared multiclass table", () => {
    // Paladin 6 (half -> 3) + Wizard 4 (full -> 4) = caster level 7: 4/3/3/1.
    const paladinWizard = fighterWizard({
      hitPoints: { maximum: 70, formula: "10d10" },
      character: { classes: [{ id: "paladin", name: "Paladin", level: 6 }, { id: "wizard", name: "Wizard", level: 4 }], feats: [] },
      spellcasting: { ability: "cha", slots: [], classes: [{ classId: "paladin", ability: "cha" }, { classId: "wizard", ability: "int" }], spells: [] }
    });
    expect(spellSlotMaxima(paladinWizard)).toEqual([{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 3 }, { level: 4, max: 1 }]);
    expect(seedHitDice(paladinWizard)).toEqual({
      die: "d10", maximum: 10, remaining: 10,
      entries: [{ die: "d10", maximum: 6, remaining: 6 }, { die: "d6", maximum: 4, remaining: 4 }]
    });
  });

  it("derives Pact Magic from the Warlock levels alone", () => {
    const warlockSorcerer = fighterWizard({
      hitPoints: { maximum: 40, formula: "6d8" },
      character: { classes: [{ id: "warlock", name: "Warlock", level: 3 }, { id: "sorcerer", name: "Sorcerer", level: 3 }], feats: [] },
      spellcasting: { ability: "cha", slots: [], classes: [{ classId: "warlock", ability: "cha" }, { classId: "sorcerer", ability: "cha" }], spells: [] }
    });
    const game = gameWith(warlockSorcerer);
    // Warlock levels stay OUT of the shared table (Sorcerer 3 alone -> 4/2), and drive the pact pool.
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 4 }, { level: 2, remaining: 2 }]);
    expect(actorOf(game).pactSlots).toEqual({ level: 2, remaining: 2 });
  });

  it("a long rest refills derived slots, and the spend clamp uses the same maxima", () => {
    const game = gameWith(fighterWizard());
    setSpellSlotRemaining(game, ACTOR, 1, 0, resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 0 }]);
    applyRest(game, ACTOR, "long", resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    // The clamp reads the DERIVED maximum too, so restoring cannot overshoot or be capped short.
    setSpellSlotRemaining(game, ACTOR, 1, 9, resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
  });

  it("keeps the pool owner-only in the player projection, entries included", () => {
    const game = gameWith(fighterWizard());
    actorOf(game).ownerSessionId = OWNER;
    const own = projectPlayerView(game, OWNER, () => null).actors[0];
    expect(own.hitDice?.entries).toEqual([{ die: "d10", maximum: 3, remaining: 3 }, { die: "d6", maximum: 2, remaining: 2 }]);
    const stranger = projectPlayerView(game, "30000000-0000-4000-8000-0000000000b2", () => null).actors[0];
    expect("hitDice" in stranger).toBe(false);
    // The projection hands out a COPY - mutating it must not reach into GameState.
    own.hitDice!.entries[0].remaining = 0;
    expect(actorOf(game).hitDice?.entries[0].remaining).toBe(3);
  });

  it("still loads a GameState persisted before hit-dice pools existed", () => {
    const legacy = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: ACTOR, name: "Old Save", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 40 }, hitDice: { die: "d12", maximum: 7, remaining: 2 } }]
    });
    expect(legacy.schemaVersion).toBe(1);
    expect(actorOf(legacy).hitDice).toEqual({ die: "d12", maximum: 7, remaining: 2, entries: [{ die: "d12", maximum: 7, remaining: 2 }] });
    // ...and a long rest on that normalised save still restores the whole pool.
    applyRest(legacy, ACTOR, "long", () => undefined);
    expect(actorOf(legacy).hitDice).toEqual({ die: "d12", maximum: 7, remaining: 7, entries: [{ die: "d12", maximum: 7, remaining: 7 }] });
    // A re-serialised save round-trips through the schema unchanged (persistence is JSON in SQLite).
    expect(GameStateSchema.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  });
});
