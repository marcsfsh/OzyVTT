import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";

const IDS = {
  attacker: "10000000-0000-4000-8000-000000000001",
  pc: "10000000-0000-4000-8000-000000000002",
  second: "10000000-0000-4000-8000-000000000003",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const BITE = { id: "bite", name: "Bite", activation: "action" as const, description: "Melee Attack Roll: +9.", attack: { bonus: 9, reachFeet: 5 }, damage: [{ formula: "2d6 + 5", type: "piercing" }] };
const BREATH = { id: "breath", name: "Fire Breath", activation: "action" as const, description: "Dexterity Saving Throw: DC 15.", save: { ability: "dex" as const, dc: 15 }, damage: [{ formula: "3d6", type: "fire" }] };
const PARRY = { id: "parry", name: "Parry", activation: "reaction" as const, description: "Adds 2 AC.", damage: [{ formula: "1d4", type: "force" }] };

function deps(faces: number[]): ResolveDependencies {
  let rollIndex = 0;
  return { random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; }, newRollId: () => `40000000-0000-4000-8000-00000000000${rollIndex++}`, gmSessionId: IDS.gmSession, now: () => "2026-07-17T00:00:00.000Z" };
}

function combatState(attackerVisibility: "public" | "gm-only" = "public") {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.attacker, name: "Aboleth", kind: "monster", visibility: attackerVisibility, hp: { current: 150, maximum: 150 } },
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, armorClass: 17 },
    { id: IDS.second, name: "Beta", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
  ] });
  startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.attacker, score: 20 }, { actorId: IDS.pc, score: 10 }, { actorId: IDS.second, score: 5 }] }, () => 1, GEOMETRY);
  return game;
}

describe("definition action resolution", () => {
  it("resolves an attack hit against the target's AC and proposes damage", () => {
    const game = combatState();
    const resolution = resolveDefinitionAction(game, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-000000000001" }, deps([15, 3, 4]));
    expect(resolution.attack).toEqual({ targetId: IDS.pc, targetName: "Alpha", total: 24, naturalRoll: 15, targetAc: 17, outcome: "hit" });
    expect(resolution.damage).toEqual([{ formula: "2d6 + 5", type: "piercing", total: 12 }]);
    expect(resolution.damageTotal).toBe(12);
    expect(game.rolls.map((roll) => roll.purpose)).toEqual(["attack", "damage"]);
    expect(game.rolls[0].initiatorLabel).toBe("Aboleth");
    expect(game.rolls.every((roll) => roll.visibility === "public")).toBe(true);
    expect(game.combat.turn.actionUsed).toBe(true); // attacker holds the current turn
  });

  it("attributes recorded rolls to the GM by default and to a player when one resolves their own action", () => {
    // Default deps carry no initiator identity: GM/integration-driven resolves stay attributed to the GM.
    const gmGame = combatState();
    resolveDefinitionAction(gmGame, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-00000000000b" }, deps([15, 3, 4]));
    expect(gmGame.rolls.length).toBe(2);
    expect(gmGame.rolls.every((roll) => roll.initiatorRole === "gm")).toBe(true);
    expect(gmGame.rolls.every((roll) => roll.initiatorSessionId === IDS.gmSession)).toBe(true);

    // When a player resolves their own claimed character's action, the recorded rolls attribute to that
    // player (session + role) while staying public with the acting character's label. (The handler's
    // canInitiateForActor enforces ownership; resolveDefinitionAction just carries the attribution.)
    const playerSession = "30000000-0000-4000-8000-00000000000b";
    const playerGame = combatState();
    resolveDefinitionAction(playerGame, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-00000000000c" }, { ...deps([15, 3, 4]), initiatorRole: "player", initiatorSessionId: playerSession });
    expect(playerGame.rolls.length).toBe(2);
    expect(playerGame.rolls.every((roll) => roll.initiatorRole === "player")).toBe(true);
    expect(playerGame.rolls.every((roll) => roll.initiatorSessionId === playerSession)).toBe(true);
    expect(playerGame.rolls.every((roll) => roll.visibility === "public")).toBe(true);
  });

  it("doubles only the dice on a natural 20 and skips damage on a natural 1", () => {
    const crit = combatState();
    const critResolution = resolveDefinitionAction(crit, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-000000000002" }, deps([20, 6, 6, 6, 6]));
    expect(critResolution.attack?.outcome).toBe("crit");
    expect(critResolution.crit).toBe(true);
    expect(critResolution.damage).toEqual([{ formula: "4d6 + 5", type: "piercing", total: 29 }]);
    const fumble = combatState();
    const fumbleResolution = resolveDefinitionAction(fumble, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-000000000003" }, deps([1]));
    expect(fumbleResolution.attack?.outcome).toBe("fumble");
    expect(fumbleResolution.damage).toEqual([]);
    const miss = combatState();
    const missResolution = resolveDefinitionAction(miss, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-000000000004" }, deps([2]));
    expect(missResolution.attack?.outcome).toBe("miss");
    expect(missResolution.damage).toEqual([]);
  });

  it("takes a hand-entered final total verbatim vs AC, with the crit declared (not inferred)", () => {
    // "Final total" manual mode: the total is used as-is, the natural die is unknown (naturalRoll 0 = hidden).
    const hit = combatState();
    const hitResolution = resolveDefinitionAction(hit, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-0000000000a1", attackTotal: 18 }, deps([3, 4]));
    expect(hitResolution.attack).toEqual({ targetId: IDS.pc, targetName: "Alpha", total: 18, naturalRoll: 0, targetAc: 17, outcome: "hit" });
    expect(hitResolution.crit).toBe(false);
    expect(hitResolution.damage).toEqual([{ formula: "2d6 + 5", type: "piercing", total: 12 }]);

    const miss = combatState();
    const missResolution = resolveDefinitionAction(miss, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-0000000000a2", attackTotal: 10 }, deps([]));
    expect(missResolution.attack?.outcome).toBe("miss");
    expect(missResolution.damage).toEqual([]);

    // A declared crit auto-hits and doubles the dice even when the entered total is BELOW AC.
    const crit = combatState();
    const critResolution = resolveDefinitionAction(crit, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-0000000000a3", attackTotal: 12, critical: true }, deps([6, 6, 6, 6]));
    expect(critResolution.attack?.outcome).toBe("crit");
    expect(critResolution.attack?.naturalRoll).toBe(20);
    expect(critResolution.crit).toBe(true);
    expect(critResolution.damage).toEqual([{ formula: "4d6 + 5", type: "piercing", total: 29 }]);

    // The crit is the FLAG, not the number: a total that equals nat-20-plus-bonus is a normal hit unless declared.
    const notCrit = combatState();
    const notCritResolution = resolveDefinitionAction(notCrit, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-0000000000a4", attackTotal: 29, critical: false }, deps([3, 4]));
    expect(notCritResolution.attack?.outcome).toBe("hit");
    expect(notCritResolution.crit).toBe(false);
    expect(notCritResolution.damage).toEqual([{ formula: "2d6 + 5", type: "piercing", total: 12 }]);
  });

  it("reports unknown outcomes against AC-less targets but still proposes damage", () => {
    const game = combatState();
    const resolution = resolveDefinitionAction(game, BITE, { actorId: IDS.attacker, targetIds: [IDS.second], commandId: "50000000-0000-4000-8000-000000000005" }, deps([10, 2, 2]));
    expect(resolution.attack?.outcome).toBe("unknown");
    expect(resolution.damageTotal).toBe(9);
  });

  it("resolves save actions against many targets with one damage roll and surfaces the DC", () => {
    const game = combatState();
    const resolution = resolveDefinitionAction(game, BREATH, { actorId: IDS.attacker, targetIds: [IDS.pc, IDS.second], commandId: "50000000-0000-4000-8000-000000000006" }, deps([4, 5, 6]));
    expect(resolution.attack).toBeNull();
    expect(resolution.save).toEqual({ ability: "dex", dc: 15, targets: [{ targetId: IDS.pc, targetName: "Alpha" }, { targetId: IDS.second, targetName: "Beta" }] });
    expect(resolution.damage).toEqual([{ formula: "3d6", type: "fire", total: 15 }]);
    expect(game.rolls.map((roll) => roll.purpose)).toEqual(["damage"]);
  });

  it("keeps a hidden attacker's rolls GM-only and marks reactions", () => {
    const game = combatState("gm-only");
    const resolution = resolveDefinitionAction(game, PARRY, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-000000000007" }, deps([3]));
    expect(resolution.damageTotal).toBe(3);
    expect(game.rolls.every((roll) => roll.visibility === "gm-only")).toBe(true);
    expect(game.combat.reactionsUsed).toEqual([IDS.attacker]);
  });

  it("rejects multi-target attacks, unknown targets, and inactive combat", () => {
    const game = combatState();
    expect(() => resolveDefinitionAction(game, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc, IDS.second], commandId: "50000000-0000-4000-8000-000000000008" }, deps([]))).toThrow(/exactly one target/);
    expect(() => resolveDefinitionAction(game, BITE, { actorId: IDS.attacker, targetIds: ["60000000-0000-4000-8000-000000000009"], commandId: "50000000-0000-4000-8000-000000000009" }, deps([]))).toThrow(/must be in this encounter/);
    game.combat = { ...game.combat, active: false, turnActorId: null };
    expect(() => resolveDefinitionAction(game, BITE, { actorId: IDS.attacker, targetIds: [IDS.pc], commandId: "50000000-0000-4000-8000-00000000000a" }, deps([]))).toThrow(/Start an encounter/);
  });
});
