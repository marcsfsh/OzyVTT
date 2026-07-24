import { describe, expect, it } from "vitest";
import { GameStateSchema, type ActionResolution, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { playerHitOwesDamage, resolutionDamageParts, resolvePendingDamage, settlePlayerHit } from "../src/player-damage.js";

const IDS = {
  attacker: "10000000-0000-4000-8000-000000000001",
  monster: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  playerSession: "30000000-0000-4000-8000-00000000000b",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const CLAW = { id: "claw", name: "Claw", activation: "action" as const, description: "Melee Attack Roll: +5.", attack: { bonus: 5, reachFeet: 5 }, damage: [{ formula: "1d6 + 3", type: "slashing" }] };

/** Deterministic clock + id source for the damage helpers (never hits the definition library). */
const damageDeps = (start = 0) => { let n = start; return { resolveDefinition: () => undefined, newId: () => `70000000-0000-4000-8000-0000000000${(10 + n++).toString()}`, now: () => 1000 }; };
/** A resolve dependency set that rolls the queued faces (d20 first, then damage dice). */
const resolveDeps = (faces: number[], initiator?: { role: "player"; sessionId: string }): ResolveDependencies => ({ random: () => faces.shift()!, newRollId: () => "40000000-0000-4000-8000-000000000000", gmSessionId: IDS.gmSession, now: () => "2026-07-24T00:00:00.000Z", ...(initiator ? { initiatorRole: initiator.role, initiatorSessionId: initiator.sessionId } : {}) });

function combat(): GameState {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.attacker, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: IDS.playerSession },
    { id: IDS.monster, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 15, maximum: 15 }, armorClass: 10 }
  ] });
  startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.attacker, score: 20 }, { actorId: IDS.monster, score: 5 }] }, () => 1, GEOMETRY);
  return game;
}

/** Alpha (a claimed PC) hits the Goblin: d20=15 (+5=20 vs AC 10 → hit), 1d6+3 with die=4 → 7 slashing. */
const resolveHit = (game: GameState, commandId = "50000000-0000-4000-8000-000000000001") =>
  resolveDefinitionAction(game, CLAW, { actorId: IDS.attacker, targetIds: [IDS.monster], commandId }, resolveDeps([15, 4], { role: "player", sessionId: IDS.playerSession }));

const goblinHp = (game: GameState) => game.actors.find((actor) => actor.id === IDS.monster)?.hp.current;

describe("player damage settlement", () => {
  it("parks a GM proposal in proposal mode without touching the target's HP", () => {
    const game = combat();
    const resolution = resolveHit(game);
    expect(resolution.attack?.outcome).toBe("hit");
    const applied = settlePlayerHit(game, resolution, "Alpha", IDS.attacker, "proposal", damageDeps());
    expect(applied).toBeNull();
    expect(game.combat.pendingDamage).toHaveLength(1);
    expect(game.combat.pendingDamage[0]).toMatchObject({ sourceActorId: IDS.attacker, sourceName: "Alpha", actionName: "Claw", targetActorId: IDS.monster, targetName: "Goblin", proposedTotal: 7, critical: false, proposedDamageParts: [{ amount: 7, type: "slashing" }] });
    expect(goblinHp(game)).toBe(15); // untouched - the GM applies it
  });

  it("applies typed damage immediately in direct mode and parks nothing", () => {
    const game = combat();
    const applied = settlePlayerHit(game, resolveHit(game), "Alpha", IDS.attacker, "direct", damageDeps());
    expect(applied?.targetId).toBe(IDS.monster);
    expect(applied?.outcome.application.totalApplied).toBe(7);
    expect(game.combat.pendingDamage).toHaveLength(0);
    expect(goblinHp(game)).toBe(8); // 15 - 7
  });

  it("lets the GM apply a parked proposal through the typed-defense pipeline, then clears it", () => {
    const game = combat();
    settlePlayerHit(game, resolveHit(game), "Alpha", IDS.attacker, "proposal", damageDeps());
    const applied = resolvePendingDamage(game, game.combat.pendingDamage[0].id, true, undefined, damageDeps(5));
    expect(applied?.outcome.application.totalApplied).toBe(7);
    expect(game.combat.pendingDamage).toHaveLength(0);
    expect(goblinHp(game)).toBe(8);
  });

  it("lets the GM override the applied total, and lets the GM dismiss without applying", () => {
    const overrideGame = combat();
    settlePlayerHit(overrideGame, resolveHit(overrideGame), "Alpha", IDS.attacker, "proposal", damageDeps());
    resolvePendingDamage(overrideGame, overrideGame.combat.pendingDamage[0].id, true, 3, damageDeps(5));
    expect(goblinHp(overrideGame)).toBe(12); // 15 - 3 (hand-rolled override)

    const dismissGame = combat();
    settlePlayerHit(dismissGame, resolveHit(dismissGame), "Alpha", IDS.attacker, "proposal", damageDeps());
    const applied = resolvePendingDamage(dismissGame, dismissGame.combat.pendingDamage[0].id, false, undefined, damageDeps(5));
    expect(applied).toBeNull();
    expect(dismissGame.combat.pendingDamage).toHaveLength(0);
    expect(goblinHp(dismissGame)).toBe(15); // untouched
  });

  it("treats resolving an unknown proposal id as a no-op (idempotent retry)", () => {
    const game = combat();
    expect(resolvePendingDamage(game, "99999999-0000-4000-8000-000000000000", true, undefined, damageDeps())).toBeNull();
    expect(goblinHp(game)).toBe(15);
  });

  it("owes no damage on a miss", () => {
    const game = combat();
    const resolution = resolveDefinitionAction(game, CLAW, { actorId: IDS.attacker, targetIds: [IDS.monster], commandId: "50000000-0000-4000-8000-000000000002" }, resolveDeps([2]));
    expect(resolution.attack?.outcome).toBe("miss");
    expect(playerHitOwesDamage(resolution)).toBe(false);
    expect(settlePlayerHit(game, resolution, "Alpha", IDS.attacker, "proposal", damageDeps())).toBeNull();
    expect(game.combat.pendingDamage).toHaveLength(0);
  });
});

describe("player damage part/reaction helpers", () => {
  const resolutionOf = (over: Partial<ActionResolution>): ActionResolution => ({
    actionName: "Claw", activation: "action",
    attack: { targetId: IDS.monster, targetName: "Goblin", total: 18, naturalRoll: 13, targetAc: 10, outcome: "hit" },
    save: null, damage: [{ formula: "1d6", type: "slashing", total: 5 }], damageTotal: 5, crit: false,
    bonusDamage: [], reactionPrompts: [], preview: false, ...over
  });

  it("combines attack damage with bonus-damage parts and drops zero amounts", () => {
    const parts = resolutionDamageParts(resolutionOf({
      damage: [{ formula: "1d6", type: "slashing", total: 5 }],
      bonusDamage: [{ amount: 3, type: "necrotic", source: "Hex" }, { amount: 0, type: "fire", source: "spark" }]
    }));
    expect(parts).toEqual([{ amount: 5, type: "slashing" }, { amount: 3, type: "necrotic" }]);
  });

  it("owes damage on a committed hit but NOT when the target has a reaction prompt (Uncanny Dodge), nor on a preview/miss", () => {
    expect(playerHitOwesDamage(resolutionOf({}))).toBe(true);
    expect(playerHitOwesDamage(resolutionOf({ attack: { targetId: IDS.monster, targetName: "Goblin", total: 7, naturalRoll: 12, targetAc: null, outcome: "unknown" } }))).toBe(true);
    // A parked reaction means the damage resolves in the turn order, not here - do not park/apply it.
    expect(playerHitOwesDamage(resolutionOf({ reactionPrompts: [{ id: "90000000-0000-4000-8000-000000000001", actorId: IDS.monster, actionName: "Uncanny Dodge" }] as ActionResolution["reactionPrompts"] }))).toBe(false);
    expect(playerHitOwesDamage(resolutionOf({ preview: true }))).toBe(false);
    expect(playerHitOwesDamage(resolutionOf({ attack: { targetId: IDS.monster, targetName: "Goblin", total: 3, naturalRoll: 2, targetAc: 10, outcome: "miss" }, damage: [], damageTotal: 0 }))).toBe(false);
  });

  it("settlePlayerHit parks nothing and applies nothing when the hit is reaction-owned", () => {
    const game = combat();
    const reactionOwned = resolutionOf({ reactionPrompts: [{ id: "90000000-0000-4000-8000-000000000002", actorId: IDS.monster, actionName: "Uncanny Dodge" }] as ActionResolution["reactionPrompts"] });
    expect(settlePlayerHit(game, reactionOwned, "Alpha", IDS.attacker, "direct", damageDeps())).toBeNull();
    expect(game.combat.pendingDamage).toHaveLength(0);
    expect(goblinHp(game)).toBe(15); // untouched - the reaction handles it in the turn order
  });
});
