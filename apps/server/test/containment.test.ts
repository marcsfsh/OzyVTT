import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { settlePlanes } from "../src/off-plane.js";
import { catalog, view } from "./spell-casters.js";
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

// "The target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask ... The flask can hold only one
// creature at a time ... release the creature in the flask. The creature then obeys your commands for 1 hour."
describe("an Iron Flask", () => {
  const flask = view.equipmentRecord("iron-flask")!;
  const actionOf = (id: string): ActorAction => ({ ...flask.actions.find((action) => action.id === id)! });
  const deps = {
    random: () => 3,
    newRollId: randomUUID,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    catalog
  };
  const trapped = () => {
    const state = visionGame({ enabled: false, positions: { [GOBLIN]: cell(8, 5) } });
    // The goblin failed the save: it is in the flask, off the map.
    addEffect(
      state,
      GOBLIN,
      makeEffect({
        id: "trapped",
        name: "Trapped in the Iron Flask",
        tags: ["off-plane", "iron-flask"],
        duration: { type: "manual" },
        sourceActorId: HERO,
        sourceName: "Borin"
      })
    );
    settlePlanes(state, GEOMETRY);
    return state;
  };

  it("holds one creature at a time", () => {
    const state = trapped();
    expect(() =>
      resolveDefinitionAction(
        state,
        actionOf("trap"),
        { actorId: HERO, targetIds: [ORC], commandId: randomUUID() },
        deps
      )
    ).toThrow("Trap a Creature already holds a creature.");
  });

  it("releases its creature beside its user, obeying its user for an hour", () => {
    const state = trapped();
    resolveDefinitionAction(
      state,
      actionOf("release"),
      { actorId: HERO, targetIds: [], commandId: randomUUID() },
      deps
    );
    settlePlanes(state, GEOMETRY);
    const at = token(state, GOBLIN).position!;
    const hero = token(state, HERO).position!;
    expect(Math.max(Math.abs(at.x - hero.x), Math.abs(at.y - hero.y))).toBe(50);
    expect(actor(state, GOBLIN).effects).toEqual([
      expect.objectContaining({
        name: "Obeys Borin",
        tags: ["commanded"],
        duration: { type: "minutes", remaining: 60 }
      })
    ]);
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false } };
    expect(() =>
      resolveDefinitionAction(
        state,
        actionOf("release"),
        { actorId: HERO, targetIds: [], commandId: randomUUID() },
        deps
      )
    ).toThrow("Release the Creature holds no creature to release.");
  });
});

// "Transports you and up to 199 other willing creatures you can see to a demiplane ... When ... you take a Magic action
// to end the effect, all visitors reappear in the location they occupied ... can't be used again until 10 days have
// passed."
describe("a Rod of Security", () => {
  const rod = view.equipmentRecord("rod-of-security")!.actions[0]!;
  const use = (state: GameState, targetIds: string[]) =>
    resolveDefinitionAction(
      state,
      { ...rod, id: "item-rod-of-security-demiplane" },
      { actorId: HERO, targetIds, commandId: randomUUID() },
      {
        random: () => 3,
        newRollId: randomUUID,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        catalog
      }
    );
  const away = (state: GameState, id: string) =>
    actor(state, id).effects.some((effect) => effect.tags.includes("off-plane"));

  it("takes its user and the willing creatures it sees to the demiplane, and brings every visitor back", () => {
    const state = visionGame({ enabled: false, positions: { [FRIEND]: cell(4, 5) } });
    use(state, [FRIEND]);
    expect([away(state, HERO), away(state, FRIEND)]).toEqual([true, true]);
    expect(actor(state, HERO).actionUses).toMatchObject({ "item-rod-of-security-demiplane": 1 });
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false } };
    use(state, []);
    expect([away(state, HERO), away(state, FRIEND)]).toEqual([false, false]);
    expect(() => use(state, [GOBLIN])).toThrow();
  });
});
