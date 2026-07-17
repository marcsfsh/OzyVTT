import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { answerSave, createPendingSaves, dismissSave, halfOnSuccessFrom, saveModifierFor, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { projectPlayerCombat } from "../src/projections.js";

const IDS = {
  source: "10000000-0000-4000-8000-000000000001",
  pc: "10000000-0000-4000-8000-000000000002",
  monster: "10000000-0000-4000-8000-000000000003",
  pcSession: "30000000-0000-4000-8000-000000000001",
  otherSession: "30000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const BREATH = { id: "breath", name: "Fire Breath", activation: "action" as const, description: "Dexterity Saving Throw: DC 15. Failure: 10 (3d6) Fire damage. Success: Half damage.", save: { ability: "dex" as const, dc: 15 }, damage: [{ formula: "3d6", type: "fire" }] };

// saveModifierFor only reads abilityScores + the untyped open5e extension, so a partial cast is enough.
const monsterDef = { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, extensions: { "open5e.srd-2024": { savingThrows: { dex: 7 } } } } as unknown as ActorDefinition;
const pcDef = { abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, extensions: {} } as unknown as ActorDefinition;
const resolveDefinition = (id: string) => (id === "pc-def" ? pcDef : id === "gob-def" ? monsterDef : undefined);

function state() {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.source, name: "Dragon", kind: "monster", visibility: "public", hp: { current: 100, maximum: 100 }, definitionId: "src-def" },
    { id: IDS.pc, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30, temporary: 4 }, ownerSessionId: IDS.pcSession, definitionId: "pc-def" },
    { id: IDS.monster, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 12, maximum: 12 }, definitionId: "gob-def" }
  ] });
  startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.source, score: 20 }, { actorId: IDS.pc, score: 12 }, { actorId: IDS.monster, score: 8 }] }, () => 1, GEOMETRY);
  return game;
}
function deps(faces: number[], role: "gm" | "player" = "gm", sessionId: string = IDS.gm): SaveAnswerDependencies {
  return { random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; }, newRollId: () => "40000000-0000-4000-8000-000000000000", sessionId, role, now: () => "2026-07-17T00:00:00.000Z", resolveDefinition };
}
let saveSeq = 0;
const pendingInput = (targetIds: readonly string[], overrides: Partial<Parameters<typeof createPendingSaves>[1]> = {}) => ({
  sourceActorId: IDS.source, sourceName: "Dragon", actionName: "Fire Breath", ability: "dex" as const, dc: 15,
  targetIds, proposedDamage: 12, halfOnSuccess: true, conditionId: null as string | null,
  newSaveId: () => `60000000-0000-4000-8000-00000000000${saveSeq++}`, createdAt: 0, ...overrides
});
const cmd = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;

describe("saving-throw prompts", () => {
  it("creates one pending save per target when a save action resolves", () => {
    const game = state();
    resolveDefinitionAction(game, BREATH, { actorId: IDS.source, targetIds: [IDS.pc, IDS.monster], commandId: cmd(1) }, { random: () => 4, newRollId: () => "40000000-0000-4000-8000-000000000000", gmSessionId: IDS.gm, now: () => "2026-07-17T00:00:00.000Z" });
    expect(game.combat.pendingSaves).toHaveLength(2);
    const forPc = game.combat.pendingSaves.find((save) => save.targetActorId === IDS.pc)!;
    expect(forPc).toMatchObject({ ability: "dex", dc: 15, halfOnSuccess: true, sourceName: "Dragon", actionName: "Fire Breath", proposedDamage: 12 });
  });

  it("chooses the monster save bonus, else the ability modifier", () => {
    expect(saveModifierFor(monsterDef, "dex")).toBe(7);
    expect(saveModifierFor(monsterDef, "str")).toBe(0);
    expect(saveModifierFor(pcDef, "dex")).toBe(2);
    expect(saveModifierFor(undefined, "dex")).toBe(0);
  });

  it("defaults to half-on-success unless the text says no damage", () => {
    expect(halfOnSuccessFrom("Success: Half damage.")).toBe(true);
    expect(halfOnSuccessFrom("Failure: 10 damage. Success: No damage.")).toBe(false);
    expect(halfOnSuccessFrom("some prose")).toBe(true);
  });

  it("auto-applies full damage and the condition on a failed save", () => {
    const game = state();
    createPendingSaves(game, pendingInput([IDS.monster], { conditionId: "prone" }));
    const saveId = game.combat.pendingSaves[0].id;
    const outcome = answerSave(game, cmd(2), saveId, "roll", undefined, true, { role: "gm" }, deps([5])); // 5 + 7 = 12 < 15
    expect(outcome).toMatchObject({ success: false, total: 12, appliedDamage: 12, conditionApplied: true });
    const goblin = game.actors.find((actor) => actor.id === IDS.monster)!;
    expect(goblin.hp.current).toBe(0);
    expect(goblin.conditions.some((condition) => condition.id === "prone")).toBe(true);
    expect(game.combat.pendingSaves).toHaveLength(0);
    expect(game.rolls.find((roll) => roll.purpose === "save")).toMatchObject({ actorId: IDS.monster, initiatorLabel: "Goblin", visibility: "public" });
  });

  it("previews a roll without applying it (commit=false): records the die, keeps the save, applies nothing", () => {
    const game = state();
    createPendingSaves(game, pendingInput([IDS.monster], { conditionId: "prone" }));
    const saveId = game.combat.pendingSaves[0].id;
    const preview = answerSave(game, cmd(20), saveId, "roll", undefined, false, { role: "gm" }, deps([5])); // 12 < 15 → would fail
    expect(preview).toMatchObject({ success: false, total: 12, appliedDamage: 12, conditionApplied: true, committed: false });
    const goblin = game.actors.find((actor) => actor.id === IDS.monster)!;
    expect(goblin.hp.current).toBe(12); // untouched
    expect(goblin.conditions).toHaveLength(0); // not applied yet
    expect(game.combat.pendingSaves).toHaveLength(1); // still owed
    expect(game.rolls.find((roll) => roll.purpose === "save")).toBeTruthy(); // the die is shown to the table
    // Committing with the shown total then applies it and clears the save.
    const committed = answerSave(game, cmd(21), saveId, "manual", 12, true, { role: "gm" }, deps([]));
    expect(committed).toMatchObject({ committed: true, appliedDamage: 12, conditionApplied: true });
    expect(game.combat.pendingSaves).toHaveLength(0);
  });

  it("applies half on success, or nothing when the action says no damage on success", () => {
    const half = state();
    createPendingSaves(half, pendingInput([IDS.monster]));
    expect(answerSave(half, cmd(3), half.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, deps([10])).appliedDamage).toBe(6); // 10+7 = 17 >= 15
    expect(half.actors.find((actor) => actor.id === IDS.monster)!.hp.current).toBe(6);

    const none = state();
    createPendingSaves(none, pendingInput([IDS.monster], { halfOnSuccess: false }));
    expect(answerSave(none, cmd(4), none.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, deps([10])).appliedDamage).toBe(0);
    expect(none.actors.find((actor) => actor.id === IDS.monster)!.hp.current).toBe(12);
  });

  it("routes failed-save damage through temporary hit points first (manual total)", () => {
    const game = state();
    createPendingSaves(game, pendingInput([IDS.pc]));
    answerSave(game, cmd(5), game.combat.pendingSaves[0].id, "manual", 5, true, { role: "gm" }, deps([]));
    const borin = game.actors.find((actor) => actor.id === IDS.pc)!;
    expect(borin.hp.temporary).toBe(0);
    expect(borin.hp.current).toBe(22); // 30 - (12 - 4 temp)
  });

  it("rejects a manual answer with no total or an out-of-range total", () => {
    const game = state();
    createPendingSaves(game, pendingInput([IDS.pc]));
    const saveId = game.combat.pendingSaves[0].id;
    expect(() => answerSave(game, cmd(6), saveId, "manual", undefined, true, { role: "gm" }, deps([]))).toThrow(/whole number/);
    expect(() => answerSave(game, cmd(6), saveId, "manual", 999, true, { role: "gm" }, deps([]))).toThrow(/whole number/);
  });

  it("lets the owning player answer their own save but not another's, and only the GM dismiss", () => {
    const game = state();
    createPendingSaves(game, pendingInput([IDS.pc]));
    const saveId = game.combat.pendingSaves[0].id;
    expect(() => answerSave(game, cmd(7), saveId, "manual", 20, true, { role: "player", sessionId: IDS.otherSession }, deps([]))).toThrow(/own character/);
    expect(answerSave(game, cmd(8), saveId, "manual", 20, true, { role: "player", sessionId: IDS.pcSession }, deps([])).success).toBe(true);

    createPendingSaves(game, pendingInput([IDS.pc]));
    const saveId2 = game.combat.pendingSaves[0].id;
    expect(() => dismissSave(game, saveId2, { role: "player", sessionId: IDS.pcSession })).toThrow(/GM/);
    dismissSave(game, saveId2, { role: "gm" });
    expect(game.combat.pendingSaves).toHaveLength(0);
  });

  it("records a hidden target's save roll as gm-only", () => {
    const game = state();
    game.actors.find((actor) => actor.id === IDS.monster)!.visibility = "gm-only";
    createPendingSaves(game, pendingInput([IDS.monster]));
    answerSave(game, cmd(9), game.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, deps([10]));
    expect(game.rolls.find((roll) => roll.purpose === "save")).toMatchObject({ actorId: IDS.monster, visibility: "gm-only" });
  });

  it("projects only a player's own saves, strips the source id, and masks a hidden source", () => {
    const game = state();
    game.actors.find((actor) => actor.id === IDS.source)!.visibility = "gm-only";
    createPendingSaves(game, pendingInput([IDS.pc, IDS.monster]));
    const ownerView = projectPlayerCombat(game, IDS.pcSession);
    expect(ownerView.pendingSaves).toHaveLength(1);
    expect(ownerView.pendingSaves[0].targetActorId).toBe(IDS.pc);
    expect(ownerView.pendingSaves[0].sourceName).toBe("A hidden threat");
    expect(JSON.stringify(ownerView.pendingSaves)).not.toContain("sourceActorId");
    expect(JSON.stringify(ownerView.pendingSaves)).not.toContain(IDS.source);
    expect(projectPlayerCombat(game, IDS.otherSession).pendingSaves).toHaveLength(0);
  });
});
