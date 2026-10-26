import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorAction, type Detects } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { laterSpellAction, spellCastMechanics } from "../src/item-actions.js";
import { playerSight } from "../src/vision/audience.js";
import { sensedBy } from "../src/vision/detect.js";
import { catalog } from "./spell-casters.js";
import { cell, DIVIDER, FRIEND, GOBLIN, HERO, ORC, SESSION_A, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 senses beyond creature types: Detect Magic ("take the Magic action to see a faint aura around any visible
// creature ... that bears the magic, and if an effect was created by a spell, you learn the spell's school of magic"),
// Detect Poison and Disease ("the location of poisons, poison- or venom-bearing creatures, and magical contagions ...
// the kind"), Detect Thoughts' minds, and a Wand of Enemy Detection ("the direction of the nearest creature Hostile to
// you within 60 feet, but not its distance").

const monsters = loadMonsterDefinitions();
const spells = loadSpells();
const definition = (id: string) => monsters.find((monster) => monster.source.externalId === id);
const content = { definition, catalog };
const sense = (state: GameState, detects: Detects, spellId?: string) =>
  addEffect(
    state,
    HERO,
    makeEffect({
      id: `sense-${randomUUID()}`,
      name: "Sense",
      tags: [],
      duration: { type: "manual" },
      detects,
      ...(spellId ? { spell: { id: spellId, level: 1 } } : {})
    })
  );
const everyoneShown = () => true;
const nobodyShown = () => false;

describe("Detect Magic", () => {
  const state = () => {
    const game = visionGame({ positions: { [GOBLIN]: cell(3, 5), [ORC]: cell(1, 7) } });
    // The goblin carries a +1 weapon; the orc is under Bless.
    game.actors.find((actor) => actor.id === GOBLIN)!.inventory = [
      InventoryItemSchema.parse({ id: "weapon-1", name: "+1 Sword", quantity: 1, equipped: true, category: "weapon" })
    ];
    addEffect(
      game,
      ORC,
      makeEffect({
        id: "bless",
        name: "Bless",
        tags: [],
        duration: { type: "manual" },
        spell: { id: "bless", level: 1 }
      })
    );
    return game;
  };

  it("shows the auras and schools only after the Magic action to look", () => {
    const game = state();
    const cast = spellCastMechanics(
      spells.find((spell) => spell.id === "detect-magic")!,
      {
        attackBonus: 5,
        saveDc: 13,
        bearersDc: false,
        modifier: 3
      }
    );
    const resolve = (action: ActorAction) =>
      resolveDefinitionAction(
        game,
        action,
        { actorId: HERO, targetIds: [], commandId: randomUUID() },
        {
          random: () => 3,
          newRollId: randomUUID,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-19T00:00:00.000Z",
          catalog
        }
      );
    resolve({
      id: "spell-detect-magic",
      name: "Detect Magic",
      activation: "action",
      description: "",
      spellId: "detect-magic",
      ...cast
    });
    expect(sensedBy(game, [HERO], content, everyoneShown)).toEqual([]);
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false } };
    const spell = spells.find((entry) => entry.id === "detect-magic")!;
    resolve(
      laterSpellAction(spell, spell.effect!.laterActions![0]!, {
        attackBonus: 5,
        saveDc: 13,
        bearersDc: false,
        modifier: 3
      })
    );
    expect(
      sensedBy(game, [HERO], content, everyoneShown)
        .map((found) => found.sense)
        .sort()
    ).toEqual(["magic", "magic: enchantment"]);
  });

  it("finds nothing behind a wall, nor on a creature out of sight", () => {
    const game = state();
    game.combat.vision = { ...game.combat.vision, walls: [DIVIDER()] };
    game.combat.tokens = game.combat.tokens.map((token) =>
      token.actorId === GOBLIN ? { ...token, position: cell(6, 5) } : token
    );
    sense(game, { kinds: ["magic"], feet: 30, blockedByWalls: true, afterAction: true, revealed: true });
    expect(sensedBy(game, [HERO], content, (id) => id !== ORC).map((found) => found.sense)).toEqual([]);
  });
});

describe("Detect Poison and Disease", () => {
  it("senses a venomous creature and a carried poison with their kind, and passes a bandit by", () => {
    const game = visionGame({ positions: { [GOBLIN]: cell(3, 5), [ORC]: cell(1, 7), [FRIEND]: cell(2, 4) } });
    game.actors.find((actor) => actor.id === GOBLIN)!.definitionId = "giant-spider";
    game.actors.find((actor) => actor.id === ORC)!.definitionId = "bandit";
    game.actors.find((actor) => actor.id === FRIEND)!.inventory = [
      InventoryItemSchema.parse({
        id: "basic-poison",
        name: "Basic Poison",
        quantity: 1,
        equipped: false,
        category: "consumable"
      })
    ];
    sense(game, { kinds: ["poison"], feet: 30, blockedByWalls: true });
    expect(
      sensedBy(game, [HERO], content, nobodyShown)
        .map((found) => found.sense)
        .sort()
    ).toEqual(["a venomous Giant Spider", "poison: Basic Poison"]);
  });
});

describe("a Wand of Enemy Detection", () => {
  it("points toward the nearest Hostile creature, unseen, and not toward an ally", () => {
    const game = visionGame({ positions: { [GOBLIN]: cell(5, 5), [FRIEND]: cell(2, 5) } });
    sense(game, { nearestHostile: true, feet: 60 });
    const found = sensedBy(game, [HERO], content, nobodyShown);
    expect(found).toHaveLength(1);
    // One square from the hero (1, 5) toward the goblin (5, 5): no distance given.
    expect(found[0]).toMatchObject({
      x: cell(2, 5).x,
      y: cell(2, 5).y,
      sense: "the nearest Hostile creature, this way"
    });
  });
});

// Nondetection: "The target can't be targeted by any Divination spell or perceived through magical scrying sensors."
describe("a scrying sensor", () => {
  it("doesn't show its caster's player a creature a ward keeps from Divination", () => {
    const game = visionGame({ walls: [DIVIDER()], positions: { [ORC]: cell(7, 5), [GOBLIN]: cell(8, 5) } });
    const orc = game.actors.find((actor) => actor.id === ORC)!;
    orc.summon = {
      by: HERO,
      actionId: "spell-clairvoyance",
      name: "Clairvoyance",
      spell: { id: "clairvoyance", level: 3 },
      intangible: true,
      sight: "always"
    };
    orc.control = { by: HERO, side: "party" };
    expect(playerSight(game, SESSION_A, content).hidden.has(GOBLIN)).toBe(false);
    addEffect(
      game,
      GOBLIN,
      makeEffect({
        id: "nondetection",
        name: "Nondetection",
        tags: ["nondetection"],
        duration: { type: "manual" },
        modifiers: [{ type: "spell-ward", schools: ["divination"] }]
      })
    );
    expect(playerSight(game, SESSION_A, content).hidden.has(GOBLIN)).toBe(true);
  });
});
