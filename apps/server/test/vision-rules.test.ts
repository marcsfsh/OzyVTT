import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import { cell, GEOMETRY, GOBLIN, HERO, visionGame, wall } from "./vision-fixtures.js";

// The rules dynamic vision lets the engine know (ADR-0023): walls and closed doors in the way of a move, and who can
// see whom for an attack roll ("Unseen Attackers and Targets") and for Hide.

const goblinWarrior = loadMonsterDefinitions().find((monster) => monster.source.externalId === "goblin-warrior")!;
const GOBLIN_STATS = { definitionId: "goblin-warrior" };

let commandCount = 0;
const commandId = () => `60000000-0000-4000-8000-${String(++commandCount).padStart(12, "0")}`;

function deps(faces: number[], state: GameState): ResolveDependencies {
  let rolls = 0;
  return {
    // The queued faces, kept to the die rolled (a d6 of damage after a d20).
    random: (sides) => Math.min(sides, faces.shift() ?? 1),
    newRollId: () => `40000000-0000-4000-8000-${String(++rolls).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-17T00:00:00.000Z",
    definition: goblinWarrior,
    distanceFeet: (a, b) => {
      const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)?.position;
      const [from, to] = [at(a), at(b)];
      return from && to ? (mapDistance(GEOMETRY, from, to)?.value ?? null) : null;
    },
    resolveDefinition: (id) => (id === "goblin-warrior" ? goblinWarrior : undefined)
  };
}

function goblinSwing(state: GameState, actionId = "scimitar") {
  state.combat.turnActorId = GOBLIN;
  const weapon = goblinWarrior.actions.find((action) => action.id === actionId)!;
  return resolveDefinitionAction(
    state,
    weapon,
    { actorId: GOBLIN, targetIds: [HERO], commandId: commandId(), rollMode: null, override: null },
    deps([10, 10, 3, 3], state)
  );
}

describe("walls in the way of a move", () => {
  // A wall along x = 250 from row 3 to row 8; the hero at (1,5) goes to (6,5).
  const blocker = () => wall({ x: 250, y: 150 }, { x: 250, y: 450 });

  it("charges the way round a wall", () => {
    const cost = (enabled: boolean) =>
      movementCost(visionGame({ enabled, walls: [blocker()] }), GEOMETRY, HERO, cell(1, 5), cell(6, 5));
    expect(cost(false)?.feet).toBe(25);
    // Round the wall's end at row 2: up 3 rows and across 5 columns. The path grazes no end.
    expect(cost(true)?.feet).toBeGreaterThan(25);
    expect(cost(true)?.blocked).toBeUndefined();
  });

  it("goes through an open door and not a closed one", () => {
    const closed = [
      wall({ x: 250, y: 0 }, { x: 250, y: 250 }),
      wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", false),
      wall({ x: 250, y: 300 }, { x: 250, y: 600 })
    ];
    const open = closed.map((entry) => (entry.kind === "door" ? { ...entry, open: true } : entry));
    expect(movementCost(visionGame({ walls: open }), GEOMETRY, HERO, cell(1, 5), cell(6, 5))?.feet).toBe(25);
    expect(movementCost(visionGame({ walls: closed }), GEOMETRY, HERO, cell(1, 5), cell(6, 5))?.blocked).toBe(true);
  });

  it("refuses a move the walls shut off, saying so", () => {
    const state = visionGame({ walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })] });
    expect(() =>
      applyMovementRules(state, {
        actorId: HERO,
        from: cell(1, 5),
        to: cell(6, 5),
        distance: (a, b) => mapDistance(GEOMETRY, a, b)?.value ?? null,
        cost: (a, b, options) => movementCost(state, GEOMETRY, HERO, a, b, options),
        calibration: GEOMETRY.calibration,
        override: null,
        resolveDefinition: () => undefined,
        newPromptId: () => "70000000-0000-4000-8000-000000000001",
        now: () => 0,
        commandId: commandId()
      })
    ).toThrowError(
      new RulesBlockedError("movement.blocked-path", "Borin can't get there. Walls or other creatures bar the way.")
    );
  });

  it("walks past a creature the mover doesn't perceive, as past a hidden one", () => {
    // The goblin stands in the hero's way at (3,5), in a one-row corridor.
    const corridor = [wall({ x: 0, y: 250 }, { x: 1000, y: 250 }), wall({ x: 0, y: 300 }, { x: 1000, y: 300 })];
    const state = visionGame({ walls: corridor, positions: { [GOBLIN]: cell(3, 5) } });
    expect(movementCost(state, GEOMETRY, HERO, cell(1, 5), cell(6, 5))?.blocked).toBe(true);
    const unaware = movementCost(state, GEOMETRY, HERO, cell(1, 5), cell(6, 5), { perceives: () => false });
    expect(unaware?.feet).toBe(25);
  });
});

describe("a ranged attack in close combat", () => {
  // SRD: Disadvantage "if you are within 5 feet of an enemy who can see you and who doesn't have the Incapacitated
  // condition". The goblin shoots Borin beside it.
  it("has Disadvantage while the enemy beside the archer can see it", () => {
    const state = visionGame({ positions: { [GOBLIN]: cell(2, 5) }, actors: { [GOBLIN]: GOBLIN_STATS } });
    expect(goblinSwing(state, "shortbow").rollMode?.disadvantage).toContain("Enemy within 5 feet (Borin)");
  });

  it("has none when the enemy beside it can't see the archer, in the dark or Blinded", () => {
    const dark = visionGame({
      ambient: "dark",
      positions: { [GOBLIN]: cell(2, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    expect(goblinSwing(dark, "shortbow").rollMode?.disadvantage ?? []).not.toContain("Enemy within 5 feet (Borin)");
    const blinded = visionGame({
      enabled: false,
      positions: { [GOBLIN]: cell(2, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS, [HERO]: { conditions: [{ id: "blinded" }] } }
    });
    expect(goblinSwing(blinded, "shortbow").rollMode?.disadvantage ?? []).not.toContain("Enemy within 5 feet (Borin)");
  });
});

describe("who sees whom, on the attack roll", () => {
  it("gives Advantage against a target that can't see the attacker", () => {
    // Dark, and the goblin's Darkvision finds the hero beside it; the hero has none.
    const state = visionGame({
      ambient: "dark",
      positions: { [GOBLIN]: cell(2, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    const swing = goblinSwing(state);
    expect(swing.rollMode?.advantage).toContain("Target can't see the attacker");
    expect(swing.rollMode?.disadvantage).toEqual([]);
  });

  it("gives Disadvantage against a target the attacker can't see", () => {
    // A bowshot of 65 feet in the dark, past the goblin's 60-foot Darkvision.
    const state = visionGame({
      ambient: "dark",
      positions: { [GOBLIN]: cell(14, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    const swing = goblinSwing(state, "shortbow");
    expect(swing.rollMode?.disadvantage).toContain("Attacker can't see the target");
    // Neither sees the other, so the two cancel.
    expect(swing.rollMode?.mode).toBe("normal");
  });

  it("keeps Invisible's Disadvantage against an attacker that can't see through it", () => {
    const invisible = { [HERO]: { conditions: [{ id: "invisible" }] } };
    const plain = goblinSwing(
      visionGame({ positions: { [GOBLIN]: cell(2, 5) }, actors: { ...invisible, [GOBLIN]: GOBLIN_STATS } })
    );
    expect(plain.rollMode?.disadvantage).toContain("Target is Invisible");
    expect(plain.rollMode?.mode).toBe("disadvantage");
  });

  it("leaves the conditions alone with the scene's vision off", () => {
    const state = visionGame({
      enabled: false,
      ambient: "dark",
      positions: { [GOBLIN]: cell(2, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    const swing = goblinSwing(state);
    expect(swing.rollMode?.advantage ?? []).toEqual([]);
    expect(swing.rollMode?.disadvantage ?? []).toEqual([]);
  });
});

describe("Hide, out of every enemy's sight", () => {
  const hide = (state: GameState) =>
    resolveDefinitionAction(
      state,
      builtinAction("hide")!,
      { actorId: HERO, targetIds: [], commandId: commandId(), builtin: true, rollMode: null, override: null },
      { ...deps([17], state), definition: undefined }
    );

  it("is refused while an enemy the hider can see sees it", () => {
    const state = visionGame({ positions: { [GOBLIN]: cell(4, 5) }, actors: { [GOBLIN]: GOBLIN_STATS } });
    expect(() => hide(state)).toThrowError(/Skulking Goblin can see Borin/);
  });

  it("goes ahead behind a wall, and doesn't give away an enemy the hider can't see", () => {
    const walled = visionGame({
      walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })],
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    expect(hide(walled).check?.dc).toBe(15);
    // In the dark the goblin's Darkvision finds the hero, but the hero can't see the goblin, so nothing says so.
    const dark = visionGame({
      ambient: "dark",
      positions: { [GOBLIN]: cell(4, 5) },
      actors: { [GOBLIN]: GOBLIN_STATS }
    });
    expect(hide(dark).check?.dc).toBe(15);
  });
});
