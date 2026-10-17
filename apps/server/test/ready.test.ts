import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { projectPlayerView } from "../src/projections.js";
import { mapDistance } from "../src/movement-narration.js";
import type { TokenMapGeometry } from "../src/token-placement.js";

// SRD Ready: "you choose the action you will take in response to that trigger, or you choose to move up to your Speed
// in response to it ... When you Ready a spell, you cast it as normal (expending any resources used to cast it) but
// hold its energy, which you release with your Reaction when the trigger occurs ... holding on to the spell's magic
// requires Concentration, which you can maintain up to the start of your next turn. If your Concentration is broken,
// the spell dissipates without taking effect."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const WREN = "10000000-0000-4000-8000-0000000000b1";
const BRUTE = "10000000-0000-4000-8000-0000000000b2";

const FIREBALL = {
  id: "spell-fireball",
  name: "Fireball",
  activation: "action" as const,
  description: "A test action.",
  save: { ability: "dex" as const, dc: 15, successDamage: "half" as const, failureConditions: [] },
  damage: [{ formula: "8d6", type: "fire" }],
  spellSlot: { level: 3 },
  spellId: "fireball"
};
const WIZARD: ActorDefinition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-monster",
  schemaVersion: 1,
  source: { name: "Test", version: "1", externalId: "wren" },
  name: "Wren",
  size: "medium",
  abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
  proficiencyBonus: 3,
  armorClass: 12,
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  actions: [FIREBALL]
});

function fight(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: WREN,
        name: "Wren",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        speedFeet: 30,
        definitionId: "def-wren",
        spellSlots: [
          { level: 3, remaining: 2 },
          { level: 4, remaining: 1 }
        ]
      },
      {
        id: BRUTE,
        name: "Brute",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        speedFeet: 30
      }
    ],
    definitions: [{ id: "def-wren", definition: WIZARD }],
    combat: {
      active: true,
      round: 1,
      turnActorId: WREN,
      mapAssetId: "20000000-0000-5000-8000-0000000000b1",
      initiative: [
        { actorId: WREN, score: 18 },
        { actorId: BRUTE, score: 10 }
      ],
      tokens: [
        { actorId: WREN, position: { x: 25, y: 25 }, sizePx: 40, sizeCells: 1 },
        { actorId: BRUTE, position: { x: 525, y: 25 }, sizePx: 40, sizeCells: 1 }
      ]
    }
  });
}

let counter = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const wren = (state: GameState) => state.actors.find((actor) => actor.id === WREN)!;
const cast = (state: GameState, extra: Record<string, unknown> = {}, targetIds: string[] = []) =>
  resolveDefinitionAction(
    state,
    FIREBALL,
    { actorId: WREN, targetIds, commandId: nextId(), commit: true, ...extra },
    {
      random: () => 3,
      newRollId: nextId,
      gmSessionId: "30000000-0000-4000-8000-00000000000b",
      now: () => "2026-10-17T00:00:00.000Z",
      definition: WIZARD,
      resolveDefinition: (id) => (id === "def-wren" ? WIZARD : undefined),
      catalog
    }
  );
/** The Brute's turn begins: Wren is off its own. */
const brutesTurn = (state: GameState) => {
  state.combat = { ...state.combat, turnActorId: BRUTE };
};
const names = (state: GameState) => wren(state).effects.map((effect) => effect.name);

describe("readying a spell", () => {
  it("spends the action and the slot now, and holds the spell with Concentration", () => {
    const state = fight();
    cast(state, { ready: true, slotLevel: 4 });
    expect(wren(state).spellSlots).toEqual([
      { level: 3, remaining: 2 },
      { level: 4, remaining: 0 }
    ]);
    expect(state.combat.turn.actionUsed).toBe(true);
    expect(names(state)).toEqual(["Concentrating on Fireball (readied)", "Readied: Fireball"]);
    expect(state.combat.pendingSaves).toEqual([]);
  });

  it("is released off-turn with the Reaction, at the level it was readied, spending no other slot", () => {
    const state = fight();
    cast(state, { ready: true, slotLevel: 4 });
    brutesTurn(state);
    const released = cast(state, {}, [BRUTE]);
    // A level 4 Fireball: 9d6.
    expect(released.damage[0]?.formula).toBe("9d6");
    expect(wren(state).spellSlots?.find((slot) => slot.level === 3)?.remaining).toBe(2);
    expect(state.combat.reactionsUsed).toContain(WREN);
    expect(names(state)).toEqual([]);
  });

  it("tells only its caster's player which spell is held, and at what level", () => {
    const state = fight();
    wren(state).ownerSessionId = "40000000-0000-4000-8000-0000000000b1";
    cast(state, { ready: true });
    const effectOf = (session: string) =>
      projectPlayerView(state, session, () => null)
        .actors.find((actor) => actor.id === WREN)!
        .effects.find((effect) => effect.name === "Readied: Fireball")!;
    expect(effectOf("40000000-0000-4000-8000-0000000000b1").readiedSpell).toEqual({
      actionId: "spell-fireball",
      level: 3
    });
    expect(effectOf("40000000-0000-4000-8000-0000000000b2").readiedSpell).toBeUndefined();
  });

  it("dissipates when its Concentration breaks, leaving nothing to release", () => {
    const state = fight();
    cast(state, { ready: true });
    const holding = wren(state).effects.find((effect) => effect.name.startsWith("Concentrating"))!;
    endEffect(state, WREN, holding.id);
    expect(names(state)).toEqual([]);
    brutesTurn(state);
    expect(() => cast(state, {}, [BRUTE])).toThrow(RulesBlockedError);
  });

  it("takes a spell with a casting time of an action only", () => {
    const state = fight();
    const healingWord = {
      id: "spell-healing-word",
      name: "Healing Word",
      activation: "bonus-action" as const,
      description: "A test action.",
      damage: [],
      healing: { formula: "2d4 + 4" },
      spellSlot: { level: 3 },
      spellId: "healing-word"
    };
    expect(() =>
      resolveDefinitionAction(
        state,
        healingWord,
        { actorId: WREN, targetIds: [], commandId: nextId(), commit: true, ready: true },
        {
          random: () => 3,
          newRollId: nextId,
          gmSessionId: "30000000-0000-4000-8000-00000000000b",
          now: () => "2026-10-17T00:00:00.000Z",
          definition: WIZARD,
          catalog
        }
      )
    ).toThrowError("Only a spell with a casting time of an action can be readied.");
  });
});

describe("a readied move", () => {
  /** 50px cells, 5 ft each. */
  const GRID: TokenMapGeometry = {
    width: 2000,
    height: 2000,
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
  };
  const cell = (column: number) => ({ x: 25 + 50 * column, y: 25 });
  const move = (state: GameState, from: number, to: number) =>
    applyMovementRules(state, {
      actorId: WREN,
      from: cell(from),
      to: cell(to),
      byPlayer: true,
      distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
      calibration: GRID.calibration,
      override: null,
      resolveDefinition: (id) => (id === "def-wren" ? WIZARD : undefined),
      newPromptId: nextId,
      now: () => 0,
      commandId: nextId()
    });
  const readied = (state: GameState) =>
    addEffect(
      state,
      WREN,
      makeEffect({
        id: "readied",
        name: "Readied",
        tags: ["readied"],
        sourceActorId: WREN,
        sourceActionId: "ready",
        duration: { type: "until-source-next-turn" }
      })
    );

  it("moves up to its Speed off its turn with its Reaction, and uses up the ready", () => {
    const state = fight();
    readied(state);
    brutesTurn(state);
    expect(move(state, 0, 6).readied).toBe(true);
    expect(state.combat.turn.movementUsedFeet).toBe(0);
    expect(state.combat.reactionsUsed).toContain(WREN);
    expect(names(state)).toEqual([]);
    // Without a ready, a player's move off its turn is the GM's call again.
    expect(() => move(state, 6, 7)).toThrow(RulesBlockedError);
  });

  it("can't go past its Speed", () => {
    const state = fight();
    readied(state);
    brutesTurn(state);
    expect(() => move(state, 0, 7)).toThrowError("Wren has 30 ft of movement left (this move needs 35 ft).");
  });
});
