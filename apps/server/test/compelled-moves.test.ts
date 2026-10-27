import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { CompelledMove } from "@vtt/schemas";
import { compelledTurnUnmet } from "../src/compelled-moves.js";
import { makeEffect } from "../src/effects.js";
import { RulesBlockedError, CommandRejectedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { endTurn } from "../src/turn-economy.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { loadClasses, loadMagicItems } from "@vtt/content-srd-5.2.1";
import { builtinActionFor } from "../src/builtin-actions.js";
import { FOE, HERO as HERO_ID, view } from "./spell-casters.js";
import { actorOf, answer, cast, caster, laterAction, resolveAs, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 moves an effect compels: Fear ("takes the Dash action and moves away from you by the safest route on each
// of its turns"), Antipathy ("must use its movement on its turns to get as far away as possible from the target"),
// Sympathy ("as close as possible ... If the creature is within 5 feet of the target, the creature can't willingly move
// away"), a Symbol of Fear ("must move at least 30 feet away from the glyph on each of its turns, if able") and
// Compulsion's or Confusion's direction ("use as much of its movement as possible to move in that direction").

const CASTER = "10000000-0000-4000-8000-0000000000c1";
const HERO = "10000000-0000-4000-8000-0000000000c2";
const SESSION = "30000000-0000-4000-8000-0000000000c3";
const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
/** A grid square's centre, 5 feet a square. */
const at = (column: number, row: number) => ({ x: column * 50 + 25, y: row * 50 + 25 });

/** The hero's turn, standing at (10, 10) with the caster at (8, 10), under one compulsion. */
function compelled(rule: CompelledMove, name = "Fear"): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: CASTER, name: "Mage", kind: "monster", speedFeet: 30 },
      { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30, ownerSessionId: SESSION }
    ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: [
        { actorId: HERO, score: 20 },
        { actorId: CASTER, score: 10 }
      ],
      tokens: [
        { actorId: CASTER, position: at(8, 10), sizePx: 40, sizeCells: 1 },
        { actorId: HERO, position: at(10, 10), sizePx: 40, sizeCells: 1 }
      ]
    }
  });
  state.actors[1]!.effects.push(
    makeEffect({
      id: "compelled",
      name,
      sourceActorId: CASTER,
      sourceName: "Mage",
      duration: { type: "manual" },
      compelled: rule
    })
  );
  return state;
}

function move(state: GameState, to: { x: number; y: number }) {
  const token = state.combat.tokens.find((entry) => entry.actorId === HERO)!;
  const from = token.position!;
  const outcome = applyMovementRules(state, {
    actorId: HERO,
    from,
    to,
    byPlayer: true,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, options) => movementCost(state, GRID, HERO, a, b, options),
    calibration: GRID.calibration,
    override: null,
    resolveDefinition: () => undefined,
    newPromptId: () => crypto.randomUUID(),
    now: () => 0,
    commandId: "50000000-0000-4000-8000-0000000000c9"
  });
  token.position = to;
  return outcome;
}

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof RulesBlockedError || error instanceof CommandRejectedError) return error.message;
    throw error;
  }
  return "";
};

const owed = (state: GameState) =>
  compelledTurnUnmet(
    state,
    state.actors.find((actor) => actor.id === HERO)!,
    { resolveDefinition: () => undefined }
  );

describe("Fear's flight", () => {
  it("is what the spell's failure leaves: Dash only, away from the caster", () => {
    expect(view.spellRecord("fear")?.effect?.failureEffect).toMatchObject({
      tags: ["drops-held", "dash-only"],
      compelled: { way: "away", dashes: true }
    });
  });

  it("refuses a move that doesn't end farther from the caster, and allows one that does", () => {
    const state = compelled({ way: "away", dashes: true, minFeet: 5 });
    expect(refusal(() => move(state, at(10, 12)))).toBe("Borin must move away from Mage (Fear).");
    expect(refusal(() => move(state, at(9, 10)))).toBe("Borin must move away from Mage (Fear).");
    expect(refusal(() => move(state, at(13, 10)))).toBe("");
  });

  it("keeps a player's turn until the Dash is taken and the creature has moved", () => {
    const state = compelled({ way: "away", dashes: true, minFeet: 5 });
    const player = { role: "player", sessionId: SESSION } as const;
    const deps = { resolveDefinition: () => undefined, rollDie: () => 1 };
    expect(refusal(() => endTurn(state, player, [], deps))).toBe("Borin must take the Dash action this turn (Fear).");
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: true } };
    expect(owed(state)).toBe(
      "Borin must move at least 5 ft away from Mage (Fear). With nowhere to move, the GM passes the turn."
    );
    move(state, at(12, 10));
    expect(owed(state)).toBeNull();
    endTurn(state, player, [], deps);
    expect(state.combat.turnActorId).toBe(CASTER);
  });

  it("lets the GM pass the turn of a creature with nowhere to move", () => {
    const state = compelled({ way: "away", dashes: true, minFeet: 5 });
    endTurn(state, { role: "gm" }, [], { resolveDefinition: () => undefined, rollDie: () => 1 });
    expect(state.combat.turnActorId).toBe(CASTER);
  });
});

describe("Antipathy and Sympathy", () => {
  it("drives the frightened creature to use all its movement away from the target", () => {
    const state = compelled({ way: "away", allMovement: true }, "Antipathy");
    move(state, at(14, 10));
    expect(owed(state)).toMatch(/must use all its movement to move away from Mage \(Antipathy\), and has 10 ft left/);
    move(state, at(16, 10));
    expect(owed(state)).toBeNull();
  });

  it("draws the charmed creature in, and once beside the target it can't willingly move away", () => {
    const state = compelled({ way: "toward", allMovement: true, holdsNear: true }, "Sympathy");
    expect(refusal(() => move(state, at(11, 10)))).toBe("Borin must move closer to Mage (Sympathy).");
    state.combat.tokens.find((token) => token.actorId === HERO)!.position = at(10, 10);
    move(state, at(9, 10));
    expect(refusal(() => move(state, at(10, 10)))).toBe("Borin can't willingly move away from Mage (Sympathy).");
  });
});

describe("a Symbol of Fear's glyph", () => {
  it("makes the creature move at least 30 feet away from the glyph's point", () => {
    const state = compelled({ way: "away", minFeet: 30, point: at(10, 14) }, "Symbol of Fear");
    expect(refusal(() => move(state, at(10, 12)))).toBe(
      "Borin must move away from the area's center (Symbol of Fear)."
    );
    move(state, at(10, 8));
    expect(owed(state)).toMatch(/must move at least 30 ft away from the area's center/);
    move(state, at(10, 4));
    expect(owed(state)).toBeNull();
  });
});

describe("the other flights", () => {
  it("are what Turn Undead, a Mace of Terror, Command's Flee and Eyebite's Panicked leave", () => {
    const turn = loadClasses()
      .flatMap((entry) => entry.features)
      .flatMap((feature) => feature.actions ?? [])
      .find((action) => action.id === "turn-undead")!;
    expect(turn.save?.failureEffect?.compelled).toEqual({ way: "away", allMovement: true });
    const mace = loadMagicItems().find((item) => item.id === "mace-of-terror")!;
    expect(mace.actions?.[0]?.save?.failureEffect).toMatchObject({
      tags: ["flee-only", "no-opportunity-attacks"],
      compelled: { way: "away", allMovement: true }
    });
    const options = (id: string) => view.spellRecord(id)?.effect?.failureEffect?.options ?? [];
    expect(options("command").find((option) => option.id === "flee")?.compelled).toMatchObject({ way: "away" });
    expect(options("eyebite").find((option) => option.id === "panicked")?.compelled).toMatchObject({ dashes: true });
  });

  it("lets a creature fleeing a Mace of Terror only Dash, escape or Dodge", () => {
    const table = caster();
    actorOf(table.state, HERO_ID).effects.push(
      makeEffect({ id: "terror", name: "Wave of Terror", tags: ["flee-only"], duration: { type: "manual" } })
    );
    const swing = builtinActionFor(wizard, "unarmed-strike")!;
    expect(() => resolveAs(table, swing, { targetIds: [FOE], builtin: true }, [15])).toThrow(
      /can take only the Dash action, try to escape what holds it, or Dodge/
    );
    resolveAs(table, builtinActionFor(wizard, "dodge")!, { targetIds: [], builtin: true });
  });
});

describe("Compulsion", () => {
  it("binds each Charmed target to the direction its caster's Bonus Action names, then asks its save again", () => {
    const table = caster();
    cast(table, "compulsion", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    expect(actorOf(table.state, FOE).effects[0]?.compelled).toEqual({ way: "heading", allMovement: true, once: true });
    resolveAs(table, laterAction("compulsion", "direction"), { targetIds: [], optionId: "east" });
    expect(actorOf(table.state, FOE).effects[0]?.compelled?.heading).toBe(90);
    // The Goblin's turn passes: its save opens after the move, and the direction is spent.
    const deps = {
      resolveDefinition: () => undefined,
      rollDie: () => 1,
      newId: () => crypto.randomUUID(),
      now: () => "2026-10-26T00:00:00.000Z"
    };
    while (table.state.combat.turnActorId !== FOE) nextInitiativeTurn(table.state, [], deps);
    expect(table.state.combat.pendingSaves).toEqual([]);
    nextInitiativeTurn(table.state, [], deps);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: FOE, ability: "wis" }]);
    expect(actorOf(table.state, FOE).effects[0]?.compelled?.heading).toBeUndefined();
  });
});

describe("a compelled heading", () => {
  it("refuses a move against the direction, and owes the rest of the movement that way", () => {
    const state = compelled({ way: "heading", heading: 90, allMovement: true, once: true }, "Compulsion");
    expect(refusal(() => move(state, at(9, 10)))).toBe("Borin must move east this turn (Compulsion).");
    expect(refusal(() => move(state, at(11, 9)))).toBe("");
    expect(owed(state)).toMatch(/must use all its movement to move east \(Compulsion\), and has 25 ft left/);
  });

  it("binds nothing until a direction is named", () => {
    const state = compelled({ way: "heading", allMovement: true, once: true }, "Compulsion");
    expect(refusal(() => move(state, at(9, 10)))).toBe("");
    expect(owed(state)).toBeNull();
  });
});
