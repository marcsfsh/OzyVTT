import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { makeEffect } from "../src/effects.js";
import { activeTeleportGrant } from "../src/granted-moves.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";
import { catalog, view } from "./spell-casters.js";

// SRD 5.2.1 Dimension Door: "You can also teleport one willing creature. The creature must be within 5 feet of you when
// you teleport, and it teleports to a space within 5 feet of your destination space. If you, the other creature, or
// both would arrive in a space occupied by a creature ... you and any creature traveling with you each take 4d6 Force
// damage, and the teleportation fails." A Cape of the Mountebank's cast leaves "the space you left Lightly Obscured
// until the end of your next turn".

const HERO = "10000000-0000-4000-8000-0000000000e1";
const ALLY = "10000000-0000-4000-8000-0000000000e2";
const ORC = "10000000-0000-4000-8000-0000000000e3";
const spell = loadSpells().find((entry) => entry.id === "dimension-door")!;
const door: ActorAction = {
  id: "spell-dimension-door",
  name: "Dimension Door",
  activation: "action",
  description: "",
  spellId: "dimension-door",
  ...spellCastMechanics(spell, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 4 })
};

function game(allyAt: { x: number; y: number }): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character" },
    { id: ALLY, name: "Mirena", kind: "player-character" },
    { id: ORC, name: "Orc", kind: "monster" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({
      ...actor,
      visibility: "public",
      hp: { current: 30, maximum: 30 },
      speedFeet: 30
    })),
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: [
        { actorId: HERO, position: cell(1, 1), sizePx: 40 },
        { actorId: ALLY, position: allyAt, sizePx: 40 },
        { actorId: ORC, position: cell(9, 9), sizePx: 40 }
      ]
    }
  });
}

const distanceFeet = (state: GameState) => (a: string, b: string) => {
  const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position!;
  return Math.max(Math.abs(at(a).x - at(b).x), Math.abs(at(a).y - at(b).y)) / 10;
};
const cast = (state: GameState, targetIds: string[]) =>
  resolveDefinitionAction(
    state,
    door,
    { actorId: HERO, targetIds, commandId: randomUUID() },
    {
      random: () => 3,
      newRollId: randomUUID,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      catalog,
      distanceFeet: distanceFeet(state)
    }
  );

describe("Dimension Door's passenger", () => {
  it("is offered by the spell and the Cape of the Mountebank, whose cast also leaves smoke", () => {
    expect(spell.effect?.teleport).toMatchObject({ passenger: true });
    expect(view.equipmentRecord("cape-of-the-mountebank")!.casts?.[0]?.teleport).toMatchObject({
      passenger: true,
      smoke: true
    });
  });

  it("rides the caster's teleport when it is a willing creature within 5 feet", () => {
    const state = game(cell(2, 1));
    cast(state, [ALLY]);
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    expect(activeTeleportGrant(state, hero)).toMatchObject({ feet: 500, passengerId: ALLY });
  });

  it("is refused 15 feet away, and when it isn't willing", () => {
    expect(() => cast(game(cell(4, 1)), [ALLY])).toThrow("Mirena must be within 5 ft of Borin to go along.");
    const state = game(cell(2, 1));
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === ORC ? { ...token, position: cell(1, 2) } : token
    );
    expect(() => cast(state, [ORC])).toThrow(
      "Dimension Door takes only a willing creature along, and Orc isn't willing."
    );
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A fight on the movement server with the hero's granted teleport set, as a Dimension Door from the cape gives it. */
async function teleporting(smoke: boolean) {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: game(cell(2, 1)).actors });
  const booted = await bootMovementServer(state, cleanups);
  await booted.startFight([HERO, ALLY, ORC], { [HERO]: cell(1, 1), [ALLY]: cell(2, 1), [ORC]: cell(9, 9) });
  await booted.server.store.execute({ id: randomUUID(), type: "test.dimension-door" }, (draft) => {
    const hero = draft.actors.find((actor) => actor.id === HERO)!;
    hero.effects = [
      makeEffect({
        id: randomUUID(),
        name: "Dimension Door",
        tags: ["granted-teleport"],
        duration: { type: "encounter" },
        grantedTeleport: {
          feet: 500,
          round: draft.combat.round,
          turnActorId: draft.combat.turnActorId,
          unseen: true,
          failDamage: "4d6",
          passengerId: ALLY,
          ...(smoke ? { smoke: true as const } : {})
        }
      })
    ];
  });
  return booted;
}
const tokenAt = (state: GameState, id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position!;

describe("a teleport that takes a creature along", () => {
  it("lands the passenger beside the caster and leaves the cape's smoke where the caster stood", async () => {
    const { server, gmToken, move } = await teleporting(true);
    const moved = await move(HERO, gmToken, { position: cell(10, 1), mode: "teleport" });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const state = server.store.snapshot;
    expect(tokenAt(state, HERO)).toEqual(cell(10, 1));
    const ally = tokenAt(state, ALLY);
    expect(Math.max(Math.abs(ally.x - cell(10, 1).x), Math.abs(ally.y - cell(10, 1).y))).toBe(50);
    expect(state.combat.vision.areas).toMatchObject([
      { kind: "lightly-obscured", shape: { type: "rect", x: 50, y: 50, width: 50, height: 50 } }
    ]);
  });

  it("fails for both, with 4d6 Force damage each, when the caster arrives where an unseen creature stands", async () => {
    const { server, gmToken, move } = await teleporting(false);
    // An orc the caster didn't know stood there.
    await server.store.execute({ id: randomUUID(), type: "test.hide-orc" }, (draft) => {
      draft.actors.find((actor) => actor.id === ORC)!.visibility = "gm-only";
    });
    await move(HERO, gmToken, { position: cell(9, 9), mode: "teleport" });
    const state = server.store.snapshot;
    expect(tokenAt(state, HERO)).toEqual(cell(1, 1));
    expect(tokenAt(state, ALLY)).toEqual(cell(2, 1));
    for (const id of [HERO, ALLY]) expect(state.actors.find((actor) => actor.id === id)!.hp.current).toBeLessThan(30);
  });
});
