import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { settlePlanes } from "../src/off-plane.js";
import { catalog } from "./spell-casters.js";
import { cell, FRIEND, GEOMETRY, GOBLIN, HERO, ORC, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 spells that hold creatures apart from the map: Meld into Stone ("Nothing of your presence remains visible
// ... you can't see what occurs outside it, and any Wisdom (Perception) checks you make to hear sounds outside it are
// made with Disadvantage") and Rope Trick ("The space can hold up to eight Medium or smaller creatures. Attacks, spells,
// and other effects can't pass into or out of the space ... Anything inside the space drops out when the spell ends").

const spells = loadSpells();
const castOf = (spellId: string): ActorAction => ({
  id: `spell-${spellId}`,
  name: spells.find((entry) => entry.id === spellId)!.name,
  activation: "action",
  description: "",
  spellId,
  ...spellCastMechanics(
    spells.find((entry) => entry.id === spellId)!,
    {
      attackBonus: 7,
      saveDc: 15,
      bearersDc: false,
      modifier: 4
    }
  )
});
const actor = (state: GameState, id: string) => state.actors.find((entry) => entry.id === id)!;
const token = (state: GameState, id: string) => state.combat.tokens.find((entry) => entry.actorId === id)!;
function cast(state: GameState, spellId: string, targetIds: string[]) {
  const at = (id: string) => token(state, id).position!;
  return resolveDefinitionAction(
    state,
    castOf(spellId),
    { actorId: HERO, targetIds, commandId: randomUUID() },
    {
      random: () => 3,
      newRollId: randomUUID,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      catalog,
      distanceFeet: (a, b) => Math.max(Math.abs(at(a).x - at(b).x), Math.abs(at(a).y - at(b).y)) / 10
    }
  );
}

describe("Meld into Stone", () => {
  it("takes the caster off the map for 8 hours, hearing outside with Disadvantage", () => {
    const state = visionGame({ enabled: false });
    cast(state, "meld-into-stone", []);
    const merged = actor(state, HERO).effects.find((effect) => effect.name === "Meld into Stone")!;
    expect(merged).toMatchObject({ tags: ["off-plane", "meld-into-stone"], duration: { remaining: 480 } });
    expect(merged.modifiers).toEqual([
      expect.objectContaining({ type: "roll-mode", roll: "check", mode: "disadvantage" })
    ]);
    settlePlanes(state, GEOMETRY);
    expect(token(state, HERO).position).toBeNull();
  });
});

describe("Rope Trick", () => {
  const party = () => {
    const state = visionGame({ enabled: false, positions: { [FRIEND]: cell(2, 5), [ORC]: cell(1, 4) } });
    actor(state, ORC).kind = "player-character";
    return state;
  };

  it("takes the willing creatures beside the rope into its space for the hour", () => {
    const state = party();
    cast(state, "rope-trick", [HERO, FRIEND, ORC]);
    for (const id of [HERO, FRIEND, ORC])
      expect(actor(state, id).effects.find((effect) => effect.name === "Inside the Rope Trick")).toMatchObject({
        tags: ["off-plane", "rope-trick"],
        duration: { remaining: 60 }
      });
    settlePlanes(state, GEOMETRY);
    expect(token(state, FRIEND).position).toBeNull();
  });

  it("refuses an unwilling creature and a Large one", () => {
    const state = visionGame({ enabled: false, positions: { [GOBLIN]: cell(2, 5) } });
    expect(() => cast(state, "rope-trick", [GOBLIN])).toThrow("isn't willing");
    const big = party();
    actor(big, FRIEND).size = "large";
    expect(() => cast(big, "rope-trick", [FRIEND])).toThrow("too large");
  });
});
