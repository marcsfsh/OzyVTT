import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { setCondition } from "../src/actor-conditions.js";
import { storedArmorClass } from "../src/actor-roster.js";
import { carryingOf } from "../src/carrying.js";
import { makeEffect } from "../src/effects.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { startFall } from "../src/falling.js";
import { RulesBlockedError } from "../src/game-store.js";
import { mountOrDismount } from "../src/mounts.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { currentSpeedFeet } from "../src/speed.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Carrying Capacity, Beast of Burden, Dropping Prone, Shove, Interacting with Things, Climber's Kit and
// Saddles: what a creature can haul, when it can drop, what a shove and a free hand do, and how gear holds it.

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const fighter = (table: Table) => table.actor(IDS.fighter);
const speedOf = (table: Table) =>
  currentSpeedFeet(fighter(table), deriveEquipment(fighter(table), table.definition(IDS.fighter), catalog));
const blockedBy = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.rule;
    throw error;
  }
  return "nothing";
};

describe("carrying beyond capacity", () => {
  const anvil = (pounds: number) => ({
    id: "anvil",
    name: "Anvil",
    quantity: 1,
    equipped: false,
    attuned: false,
    weightEach: pounds
  });

  it("holds Speed to 5 feet up to twice the capacity, and to 0 beyond it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const carrying = deriveEquipment(fighter(table), table.definition(IDS.fighter), catalog).carrying!;
    expect(carrying.dragLimit).toBe(19 * 30);
    write(table, IDS.fighter, anvil(19 * 30 - carrying.pounds));
    expect(speedOf(table)).toBe(5);
    write(table, IDS.fighter, anvil(19 * 30 - carrying.pounds + 1));
    expect(speedOf(table)).toBe(0);
  });

  it("counts a mule's Beast of Burden one size larger: 420 pounds at Strength 14", () => {
    const mule = loadMonsterDefinitions().find((monster) => monster.source.externalId === "mule")!;
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: IDS.foe, name: "Mule", kind: "npc", hp: { current: 11, maximum: 11 }, size: "medium" }]
    });
    expect(carryingOf(state.actors[0]!, mule, catalog, [])).toMatchObject({ capacity: 420, dragLimit: 840 });
  });
});

describe("dropping Prone", () => {
  function owned(table: Table) {
    table.actor(IDS.fighter).ownerSessionId = "session-1";
    return { role: "player", sessionId: "session-1" } as const;
  }

  it("is refused off the creature's own turn, and at Speed 0", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const player = owned(table);
    fight(table, IDS.fighter);
    table.state.combat = { ...table.state.combat, turnActorId: IDS.foe };
    expect(blockedBy(() => setCondition(table.state, IDS.fighter, "prone", true, undefined, player))).toBe(
      "movement.drop-prone"
    );
    table.state.combat = { ...table.state.combat, turnActorId: IDS.fighter };
    setCondition(table.state, IDS.fighter, "grappled", true, undefined, { role: "gm" });
    expect(
      blockedBy(() =>
        setCondition(table.state, IDS.fighter, "prone", true, undefined, player, {
          resolveDefinition: table.resolve,
          catalog
        })
      )
    ).toBe("movement.drop-prone");
    setCondition(table.state, IDS.fighter, "grappled", false, undefined, { role: "gm" });
    setCondition(table.state, IDS.fighter, "prone", true, undefined, player, {
      resolveDefinition: table.resolve,
      catalog
    });
    expect(fighter(table).conditions.map((condition) => condition.id)).toContain("prone");
  });
});

describe("a Shove", () => {
  it("pushes a creature that fails its save 5 feet straight away from the shover", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "unarmed-shove-push", []);
    expect(table.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.foe)).toMatchObject({
      failurePush: { feet: 5 }
    });
  });
});

describe("the one free object interaction", () => {
  it("draws one weapon for free, rides an attack's draw, and takes the Utilize action for one more", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dagger", { equipped: false }));
    write(table, IDS.fighter, catalogRow("handaxe", { equipped: false }));
    write(table, IDS.fighter, catalogRow("shortsword", { equipped: false }));
    fight(table, IDS.fighter);
    write(table, IDS.fighter, edit(table, IDS.fighter, "dagger", { equipped: true }));
    expect(table.state.combat.turn).toMatchObject({ objectInteractionUsed: true, actionUsed: false });
    // An attack of the Attack action carries a draw of its own.
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3]);
    write(table, IDS.fighter, edit(table, IDS.fighter, "handaxe", { equipped: true }));
    expect(table.state.combat.turn.attackDraws).toBe(1);
    // Another one takes the Utilize action, and the Attack action has it already.
    expect(blockedBy(() => write(table, IDS.fighter, edit(table, IDS.fighter, "shortsword", { equipped: true })))).toBe(
      "economy.action-used"
    );
  });

  it("is refused to a player off the creature's own turn", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dagger", { equipped: false }));
    fight(table, IDS.fighter);
    table.state.combat = { ...table.state.combat, turnActorId: IDS.foe };
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "dagger", { equipped: true }))).toThrow(/turn/);
  });
});

describe("a Climber's Kit", () => {
  function anchored(): Table {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("climbers-kit"));
    fight(table, IDS.fighter);
    table.state.combat = {
      ...table.state.combat,
      tokens: [
        {
          actorId: IDS.fighter,
          position: { x: 125, y: 125 },
          sizePx: 40,
          gridSizePx: null,
          gridRotationRadians: null,
          sizeCells: 1,
          altitudeFeet: 60
        }
      ]
    };
    resolveAt(table, IDS.fighter, "item-climbers-kit-anchor", [], { targetIds: [] });
    return table;
  }

  it("anchors its user where it is with the Utilize action", () => {
    const table = anchored();
    expect(fighter(table).effects.find((effect) => effect.name === "Anchored")?.anchor).toEqual({
      x: 125,
      y: 125,
      altitudeFeet: 60,
      feet: 25
    });
    expect(table.state.combat.turn.actionUsed).toBe(true);
  });

  it("stops a fall 25 feet below the anchor", () => {
    const table = anchored();
    let next = 0;
    startFall(
      table.state,
      { actorId: IDS.fighter, feet: 60, landingAltitudeFeet: 0 },
      {
        resolveDefinition: table.resolve,
        catalog,
        random: () => 3,
        newId: () => `60000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
        now: () => "2026-10-19T00:00:00.000Z"
      }
    );
    expect(table.state.combat.tokens[0]!.altitudeFeet).toBe(35);
  });

  it("refuses a move more than 25 feet from the anchor until the Bonus Action undoes it", () => {
    const table = anchored();
    const tether = (state: GameState) =>
      blockedBy(() =>
        applyMovementRules(state, {
          actorId: IDS.fighter,
          from: { x: 125, y: 125 },
          to: { x: 125 + 50 * 6, y: 125 },
          fromAltitudeFeet: 60,
          toAltitudeFeet: 60,
          mode: "climb",
          byPlayer: true,
          distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
          cost: (a, b, options) => movementCost(state, GRID, IDS.fighter, a, b, options),
          calibration: GRID.calibration,
          override: null,
          resolveDefinition: table.resolve,
          newPromptId: () => "70000000-0000-4000-8000-000000000001",
          now: () => 0,
          commandId: "50000000-0000-4000-8000-000000000001"
        })
      );
    expect(tether(table.state)).toBe("movement.tether");
    expect(actionOf(table, IDS.fighter, "item-climbers-kit-undo").activation).toBe("bonus-action");
    resolveAt(table, IDS.fighter, "item-climbers-kit-undo", [], { targetIds: [] });
    expect(fighter(table).effects.some((effect) => effect.name === "Anchored")).toBe(false);
    expect(tether(table.state)).not.toBe("movement.tether");
  });
});

describe("saddles and barding", () => {
  const griffon = loadMonsterDefinitions().find((monster) => monster.source.externalId === "griffon")!;
  const horse = loadMonsterDefinitions().find((monster) => monster.source.externalId === "riding-horse")!;
  const HORSE = "10000000-0000-4000-8000-0000000000b1";

  function ridden(definition: typeof griffon, inventory: Record<string, unknown>[] = []): GameState {
    return GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: IDS.fighter, name: "Borin", kind: "player-character", hp: { current: 30, maximum: 30 }, speedFeet: 30 },
        {
          id: HORSE,
          name: definition.name,
          kind: "npc",
          hp: { current: 30, maximum: 30 },
          speedFeet: definition.speedFeet,
          size: "large",
          definitionId: "mount",
          inventory
        }
      ],
      combat: {
        active: true,
        round: 1,
        turnActorId: IDS.fighter,
        mapAssetId: IDS.map,
        initiative: [
          { actorId: IDS.fighter, score: 20 },
          { actorId: HORSE, score: 10 }
        ],
        tokens: [
          { actorId: IDS.fighter, position: { x: 125, y: 125 }, sizePx: 40, sizeCells: 1 },
          { actorId: HORSE, position: { x: 200, y: 150 }, sizePx: 90, sizeCells: 2 }
        ]
      }
    });
  }
  const climb = (state: GameState, definition: typeof griffon) =>
    blockedBy(() =>
      mountOrDismount(
        state,
        {
          riderId: IDS.fighter,
          mountId: HORSE,
          override: null,
          distanceFeet: () => 5,
          resolveDefinition: () => definition,
          catalog,
          newId: () => "riding"
        },
        GRID
      )
    );

  it("needs an Exotic Saddle to ride a flying mount", () => {
    expect(climb(ridden(griffon), griffon)).toBe("movement.mount");
    const saddled = ridden(griffon, [
      { id: "saddle-exotic", name: "Saddle, Exotic", quantity: 1, equipped: true, attuned: false }
    ]);
    expect(climb(saddled, griffon)).toBe("nothing");
    expect(climb(ridden(horse), horse)).toBe("nothing");
  });

  it("sets a mount's Armor Class from the barding it wears", () => {
    const state = ridden(horse);
    expect(storedArmorClass(state.actors[1]!, horse, catalog)).toBe(horse.armorClass);
    setInventoryItem(state, HORSE, { ...catalogRow("chain-mail"), equipped: true }, () => horse, {
      catalog,
      role: "gm"
    });
    expect(state.actors[1]!.armorClass).toBe(16);
  });
});

describe("an anchor's effect", () => {
  it("is what the Climber's Kit grants", () => {
    const effect = makeEffect({
      id: "anchor",
      name: "Anchored",
      duration: { type: "manual" },
      anchor: { x: 0, y: 0, altitudeFeet: 10, feet: 25 }
    });
    expect(effect.anchor?.feet).toBe(25);
  });
});
