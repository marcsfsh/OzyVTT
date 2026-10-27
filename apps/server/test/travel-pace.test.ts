import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, passivePerception } from "../src/ability-checks.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { startPartyRest } from "../src/rests.js";
import { setTravelPace, travelPaceOf } from "../src/travel.js";

// SRD 5.2.1 Travel Pace: "Fast. Traveling at a Fast pace imposes Disadvantage on a traveler's Wisdom (Perception or
// Survival) and Dexterity (Stealth) checks. Normal. ... Disadvantage on Dexterity (Stealth) checks. Slow. ... Advantage
// on Wisdom (Perception or Survival) checks." Only "while traveling outside combat".

const LYRA = "10000000-0000-4000-8000-0000000000e1";
const OGRE = "10000000-0000-4000-8000-0000000000e2";
const sheet = {
  name: "Lyra",
  armorClass: 13,
  proficiencyBonus: 2,
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 14, cha: 10 },
  hitPoints: { maximum: 20 },
  speedFeet: 30,
  actions: [],
  extensions: {},
  proficiencies: { saves: [], skills: [{ id: "perception", proficiency: "proficient" }] }
} as unknown as ActorDefinition;

function table(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: LYRA,
        name: "Lyra",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "lyra"
      },
      { id: OGRE, name: "Ogre", kind: "monster", visibility: "public", hp: { current: 59, maximum: 59 } }
    ]
  });
}

const lyra = (state: GameState) => state.actors.find((actor) => actor.id === LYRA)!;
const modeOf = (state: GameState, ability: "wis" | "dex", skill: string) =>
  checkPlan(lyra(state), sheet, deriveEquipment(lyra(state), sheet, undefined), { ability, skill }).rollMode.mode;
const passive = (state: GameState) =>
  passivePerception(
    checkPlan(lyra(state), sheet, deriveEquipment(lyra(state), sheet, undefined), {
      ability: "wis",
      skill: "perception"
    })
  );

describe("travel pace on the party's checks", () => {
  it("gives a Fast pace Disadvantage on Perception, Survival and Stealth, and 5 less Passive Perception", () => {
    const state = table();
    expect(passive(state)).toBe(14);
    setTravelPace(state, "fast");
    expect(travelPaceOf(state)).toBe("fast");
    expect(modeOf(state, "dex", "stealth")).toBe("disadvantage");
    expect(modeOf(state, "wis", "perception")).toBe("disadvantage");
    expect(modeOf(state, "wis", "survival")).toBe("disadvantage");
    expect(modeOf(state, "dex", "acrobatics")).toBe("normal");
    expect(passive(state)).toBe(9);
    // Only the party travels: the monster holds no pace.
    expect(state.actors.find((actor) => actor.id === OGRE)!.effects).toEqual([]);
  });

  it("gives a Normal pace Disadvantage on Stealth only", () => {
    const state = table();
    setTravelPace(state, "normal");
    expect(modeOf(state, "dex", "stealth")).toBe("disadvantage");
    expect(modeOf(state, "wis", "perception")).toBe("normal");
  });

  it("gives a Slow pace Advantage on Perception and Survival, and 5 more Passive Perception", () => {
    const state = table();
    setTravelPace(state, "slow");
    expect(modeOf(state, "wis", "perception")).toBe("advantage");
    expect(modeOf(state, "wis", "survival")).toBe("advantage");
    expect(modeOf(state, "dex", "stealth")).toBe("normal");
    expect(passive(state)).toBe(19);
  });

  it("changes with the next pace, and stops when time passes without one", () => {
    const state = table();
    setTravelPace(state, "fast");
    setTravelPace(state, "slow");
    expect(lyra(state).effects.map((effect) => effect.name)).toEqual(["Slow pace"]);
    setTravelPace(state, null);
    expect(lyra(state).effects).toEqual([]);
    expect(travelPaceOf(state)).toBeNull();
  });

  it("stops for whoever rolls Initiative, and for a party that rests", () => {
    const state = table();
    setTravelPace(state, "fast");
    startEncounter(state, { mapAssetId: randomUUID(), entries: [{ actorId: LYRA, score: 12 }] }, () => 10, {
      width: 900,
      height: 600,
      calibration: null
    });
    expect(lyra(state).effects).toEqual([]);
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    setTravelPace(state, "normal");
    startPartyRest(state, [LYRA], "short");
    expect(lyra(state).effects).toEqual([]);
  });

  it("leaves out a character in a running encounter", () => {
    const state = table();
    state.combat = {
      ...state.combat,
      active: true,
      turnActorId: LYRA,
      initiative: [{ actorId: LYRA, score: 10, tieBreaker: 0 }]
    };
    setTravelPace(state, "fast");
    expect(lyra(state).effects).toEqual([]);
  });
});
