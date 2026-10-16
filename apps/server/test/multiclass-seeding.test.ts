import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { hitDiceFromDefinition, importActorDefinition, seedHitDice, spellSlotMaxima } from "../src/actor-roster.js";
import { applyRest, hitDieSizesToSpend, spendHitDice } from "../src/rests.js";
import { setSpellSlotRemaining } from "../src/spellcasting.js";
import { projectPlayerView } from "../src/projections.js";

// Multiclass seeding: hit dice come from class levels (the one-term `hitPoints.formula` cannot say
// 3d10 + 2d6), and slots are derived from `spellcasting.classes[]`, not only the top-level list.

const ACTOR = "10000000-0000-4000-8000-0000000000a1";
const OWNER = "30000000-0000-4000-8000-0000000000b1";

const BASE = {
  schemaId: "vtt.actor-character",
  schemaVersion: 1,
  source: { name: "test", version: "1" },
  name: "Multiclass Hero",
  size: "medium",
  abilityScores: { str: 14, dex: 12, con: 14, int: 16, wis: 10, cha: 8 },
  proficiencyBonus: 3,
  armorClass: 16,
  speedFeet: 30,
  actions: [],
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  extensions: {}
} as const;

/** Fighter 3 / Wizard 2. The hit-point formula can only describe one class; the class levels are authoritative. */
function fighterWizard(overrides: Record<string, unknown> = {}): ActorDefinition {
  return ActorDefinitionSchema.parse({
    ...BASE,
    // `DiceFormulaSchema` allows a single term only; "3d10 + 2d6" is unparseable.
    hitPoints: { maximum: 40, formula: "3d10 + 10" },
    character: {
      classes: [
        { id: "fighter", name: "Fighter", level: 3 },
        { id: "wizard", name: "Wizard", level: 2 }
      ],
      feats: []
    },
    // Per-class entry only, so the combined slot table must be derived. No per-class `slots`, which
    // satisfies the parse-time consistency rule.
    spellcasting: {
      ability: "int",
      saveDc: 14,
      attackBonus: 6,
      slots: [],
      classes: [{ classId: "wizard", ability: "int" }],
      spells: [{ id: "magic-missile", name: "Magic Missile", level: 1, classId: "wizard" }]
    },
    ...overrides
  });
}

function gameWith(definition: ActorDefinition): GameState {
  const game = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(game, definition, ACTOR, "public");
  return game;
}
const resolver = (game: GameState) => (definitionId: string) =>
  game.definitions.find((entry) => entry.id === definitionId)?.definition;
const actorOf = (game: GameState) => game.actors.find((candidate) => candidate.id === ACTOR)!;

describe("multiclass seeding", () => {
  it("seeds the full multiclass Hit Dice pool, not one die size from the hit-point formula", () => {
    const definition = fighterWizard();
    // The formula can only ever describe the first class's dice.
    expect(hitDiceFromDefinition(definition)).toEqual({ die: "d10", maximum: 3, remaining: 3 });
    const game = gameWith(definition);
    // The seeded pool is 3d10 (Fighter) + 2d6 (Wizard), largest die first.
    expect(actorOf(game).hitDice).toEqual({
      die: "d10",
      maximum: 5,
      remaining: 5,
      entries: [
        { die: "d10", maximum: 3, remaining: 3 },
        { die: "d6", maximum: 2, remaining: 2 }
      ]
    });
    // The summary the single-class sheet UI reads counts all five dice.
    expect(actorOf(game).hitDice?.maximum).toBe(5);
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("honours an explicit per-class hitDie and still falls back to the SRD class table", () => {
    // Homebrew "moon-warden" is not in the class table; its own hitDie carries the pool.
    const homebrew = fighterWizard({
      character: {
        classes: [
          { id: "moon-warden", name: "Moon Warden", level: 4, hitDie: "d12" },
          { id: "wizard", name: "Wizard", level: 1 }
        ],
        feats: []
      }
    });
    expect(seedHitDice(homebrew)).toEqual({
      die: "d12",
      maximum: 5,
      remaining: 5,
      entries: [
        { die: "d12", maximum: 4, remaining: 4 },
        { die: "d6", maximum: 1, remaining: 1 }
      ]
    });
  });

  it("keeps the formula-derived single entry for monsters and class-less legacy sheets", () => {
    const legacy = ActorDefinitionSchema.parse({ ...BASE, hitPoints: { maximum: 30, formula: "7d8 + 14" } });
    expect(seedHitDice(legacy)).toEqual({
      die: "d8",
      maximum: 7,
      remaining: 7,
      entries: [{ die: "d8", maximum: 7, remaining: 7 }]
    });
    const unmodeled = ActorDefinitionSchema.parse({ ...BASE, hitPoints: { maximum: 30 } });
    expect(seedHitDice(unmodeled)).toBeNull();
  });

  it("rolls each spent die at its own size, biggest first", () => {
    const game = gameWith(fighterWizard());
    // Three d10s and two d6s: spending four rolls d10, d10, d10, d6, never a d10 for a d6.
    expect(hitDieSizesToSpend(actorOf(game).hitDice!.entries, 4)).toEqual([10, 10, 10, 6]);
    expect(hitDieSizesToSpend(actorOf(game).hitDice!.entries, 9)).toEqual([10, 10, 10, 6, 6]);
  });

  it("spends the pool largest die first and a long rest restores every die size", () => {
    const game = gameWith(fighterWizard());
    // Four dice spent: all three d10s, then one d6.
    spendHitDice(game, ACTOR, [5, 5, 5, 3], { role: "gm" }, resolver(game));
    expect(actorOf(game).hitDice).toEqual({
      die: "d10",
      maximum: 5,
      remaining: 1,
      entries: [
        { die: "d10", maximum: 3, remaining: 0 },
        { die: "d6", maximum: 2, remaining: 1 }
      ]
    });
    // Spending past the whole pool is rejected on the total, not on one die size.
    expect(() => spendHitDice(game, ACTOR, [4, 4], { role: "gm" }, resolver(game))).toThrowError(/1 Hit Die left/);
    applyRest(game, ACTOR, "long", resolver(game));
    expect(actorOf(game).hitDice).toEqual({
      die: "d10",
      maximum: 5,
      remaining: 5,
      entries: [
        { die: "d10", maximum: 3, remaining: 3 },
        { die: "d6", maximum: 2, remaining: 2 }
      ]
    });
  });

  it("derives the combined spell-slot table from classes[] when the top level is empty", () => {
    const definition = fighterWizard();
    // The top-level slot list is empty on this shape; seeding from it would give a caster zero slots.
    expect(definition.spellcasting?.slots).toEqual([]);
    const game = gameWith(definition);
    // SRD multiclassing: Fighter contributes nothing, Wizard 2 -> caster level 2 -> three 1st-level slots.
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    expect(spellSlotMaxima(fighterWizard())).toEqual([{ level: 1, max: 3 }]);
    expect(actorOf(game).preparedSpellIds).toEqual(["magic-missile"]);
  });

  it("rounds half-caster levels UP into the shared multiclass table", () => {
    // Paladin 6 (half -> 3) + Wizard 4 (full -> 4) = caster level 7: 4/3/3/1.
    const paladinWizard = fighterWizard({
      hitPoints: { maximum: 70, formula: "10d10" },
      character: {
        classes: [
          { id: "paladin", name: "Paladin", level: 6 },
          { id: "wizard", name: "Wizard", level: 4 }
        ],
        feats: []
      },
      spellcasting: {
        ability: "cha",
        slots: [],
        classes: [
          { classId: "paladin", ability: "cha" },
          { classId: "wizard", ability: "int" }
        ],
        spells: []
      }
    });
    expect(spellSlotMaxima(paladinWizard)).toEqual([
      { level: 1, max: 4 },
      { level: 2, max: 3 },
      { level: 3, max: 3 },
      { level: 4, max: 1 }
    ]);
    expect(seedHitDice(paladinWizard)).toEqual({
      die: "d10",
      maximum: 10,
      remaining: 10,
      entries: [
        { die: "d10", maximum: 6, remaining: 6 },
        { die: "d6", maximum: 4, remaining: 4 }
      ]
    });
    // SRD 5.2.1: "Half your levels (round up) in the Paladin and Ranger classes". Paladin 3 (-> 2) +
    // Wizard 1 = caster level 3, so 4/2; rounding down would drop the 2nd-level row.
    const paladin3Wizard1 = fighterWizard({
      hitPoints: { maximum: 34, formula: "4d10" },
      character: {
        classes: [
          { id: "paladin", name: "Paladin", level: 3 },
          { id: "wizard", name: "Wizard", level: 1 }
        ],
        feats: []
      },
      spellcasting: {
        ability: "cha",
        slots: [],
        classes: [
          { classId: "paladin", ability: "cha" },
          { classId: "wizard", ability: "int" }
        ],
        spells: []
      }
    });
    expect(spellSlotMaxima(paladin3Wizard1)).toEqual([
      { level: 1, max: 4 },
      { level: 2, max: 2 }
    ]);
    expect(actorOf(gameWith(paladin3Wizard1)).spellSlots).toEqual([
      { level: 1, remaining: 4 },
      { level: 2, remaining: 2 }
    ]);
  });

  it("derives Pact Magic from the Warlock levels alone", () => {
    const warlockSorcerer = fighterWizard({
      hitPoints: { maximum: 40, formula: "6d8" },
      character: {
        classes: [
          { id: "warlock", name: "Warlock", level: 3 },
          { id: "sorcerer", name: "Sorcerer", level: 3 }
        ],
        feats: []
      },
      spellcasting: {
        ability: "cha",
        slots: [],
        classes: [
          { classId: "warlock", ability: "cha" },
          { classId: "sorcerer", ability: "cha" }
        ],
        spells: []
      }
    });
    const game = gameWith(warlockSorcerer);
    // Warlock levels stay out of the shared table (Sorcerer 3 alone -> 4/2) and drive the pact pool.
    expect(actorOf(game).spellSlots).toEqual([
      { level: 1, remaining: 4 },
      { level: 2, remaining: 2 }
    ]);
    expect(actorOf(game).pactSlots).toEqual({ level: 2, remaining: 2 });
  });

  it("a long rest refills derived slots, and the spend clamp uses the same maxima", () => {
    const game = gameWith(fighterWizard());
    setSpellSlotRemaining(game, ACTOR, 1, 0, resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 0 }]);
    applyRest(game, ACTOR, "long", resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    // The clamp reads the derived maximum too, so restoring cannot overshoot or be capped short.
    setSpellSlotRemaining(game, ACTOR, 1, 9, resolver(game));
    expect(actorOf(game).spellSlots).toEqual([{ level: 1, remaining: 3 }]);
  });

  it("keeps the pool owner-only in the player projection, entries included", () => {
    const game = gameWith(fighterWizard());
    actorOf(game).ownerSessionId = OWNER;
    const own = projectPlayerView(game, OWNER, () => null).actors[0];
    expect(own.hitDice?.entries).toEqual([
      { die: "d10", maximum: 3, remaining: 3 },
      { die: "d6", maximum: 2, remaining: 2 }
    ]);
    const stranger = projectPlayerView(game, "30000000-0000-4000-8000-0000000000b2", () => null).actors[0];
    expect("hitDice" in stranger).toBe(false);
    // The projection hands out a copy; mutating it must not reach GameState.
    own.hitDice!.entries[0].remaining = 0;
    expect(actorOf(game).hitDice?.entries[0].remaining).toBe(3);
  });

  it("still loads a GameState persisted before hit-dice pools existed", () => {
    const legacy = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: ACTOR,
          name: "Old Save",
          kind: "player-character",
          visibility: "public",
          hp: { current: 20, maximum: 40 },
          hitDice: { die: "d12", maximum: 7, remaining: 2 }
        }
      ]
    });
    expect(legacy.schemaVersion).toBe(1);
    expect(actorOf(legacy).hitDice).toEqual({
      die: "d12",
      maximum: 7,
      remaining: 2,
      entries: [{ die: "d12", maximum: 7, remaining: 2 }]
    });
    // ...and a long rest on that normalised save still restores the whole pool.
    applyRest(legacy, ACTOR, "long", () => undefined);
    expect(actorOf(legacy).hitDice).toEqual({
      die: "d12",
      maximum: 7,
      remaining: 7,
      entries: [{ die: "d12", maximum: 7, remaining: 7 }]
    });
    // A re-serialised save round-trips through the schema unchanged (persistence is JSON in SQLite).
    expect(GameStateSchema.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  });
});
