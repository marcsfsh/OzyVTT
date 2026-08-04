import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentRecordLike, type SpellRecordLike } from "../src/equipment-derivation.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { setCondition } from "../src/actor-conditions.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";

/**
 * D21 - "the form is a promise the fight keeps."
 *
 * One describe per row of the inert-field inventory: every field the homebrew editor offers that was
 * authored, stored, derived, and then read by NOTHING. Each test proves the link at the far end (a
 * rolled number, an applied condition, a halved damage line), never merely that the value survived
 * into the derivation - a value in a struct nobody reads is exactly the bug being closed.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [], extensions: {},
    character: { classes: [{ id: "paladin", name: "Paladin", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });

function catalogOf(records: readonly EquipmentRecordLike[], spells: readonly SpellRecordLike[] = []): EquipmentCatalog {
  return {
    equipmentRecord: (id) => records.find((record) => record.id === id),
    featRecord: () => undefined,
    spellRecord: (id) => spells.find((spell) => spell.id === id)
  };
}

function stateWith(inventory: InventoryItem[], extra: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory, ...extra },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
  ] });
}

function fight(state: GameState, first: string = IDS.hero) {
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: first, score: 20 }, { actorId: first === IDS.hero ? IDS.foe : IDS.hero, score: 10 }] }, () => 1, GEOMETRY);
  return state;
}

function deps(faces: number[], catalog?: EquipmentCatalog, definition?: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-03T00:00:00.000Z",
    ...(definition ? { definition } : {}), ...(catalog ? { catalog } : {})
  };
}

const cmd = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

// -------------------------------------------------------------------------------------------------
// Row 1 - item grants: saves
// -------------------------------------------------------------------------------------------------

describe("row 1: an item that grants a saving-throw proficiency", () => {
  const AMULET: EquipmentRecordLike = {
    id: "amulet-of-health", name: "Amulet of Health", category: "wondrous", slot: "neck",
    isMagic: true, attunement: { required: true }, grants: { saves: ["con"] }
  };
  const worn = () => stateWith([item({ id: "amulet-of-health", name: "Amulet of Health", equipped: true, attuned: true, category: "wondrous" })]);

  it("adds the proficiency bonus to the save the server actually rolls", () => {
    const definition = definitionOf();
    const catalog = catalogOf([AMULET]);
    const state = fight(worn());
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    // con 12 (+1) alone; the amulet's grant adds the proficiency bonus 2.
    expect(saveTotalFor(definition, state.actors[0], "con", derivation)).toBe(3);

    createPendingSaves(state, {
      sourceActorId: IDS.foe, sourceName: "Foe", actionName: "Poison Cloud", ability: "con", dc: 12,
      targetIds: [IDS.hero], proposedDamage: 10, halfOnSuccess: true, conditionId: null,
      newSaveId: () => "60000000-0000-4000-8000-000000000001", createdAt: 0
    });
    const outcome = answerSave(state, cmd(1), state.combat.pendingSaves[0].id, "roll", undefined, false, { role: "gm" }, {
      random: () => 9, newRollId: () => "40000000-0000-4000-8000-000000000000", sessionId: IDS.gmSession, role: "gm",
      now: () => "2026-08-03T00:00:00.000Z", resolveDefinition: () => definition, catalog
    });
    // d20 = 9, +1 CON, +2 granted proficiency = 12, which exactly meets the DC.
    expect(outcome.outcome).toMatchObject({ total: 12, success: true });
  });

  it("shows on the sheet row, is never paid twice, and drops when the amulet comes off", () => {
    const catalog = catalogOf([AMULET]);
    const state = fight(worn());
    const definition = definitionOf();
    const row = (def: ActorDefinition, game: GameState) =>
      deriveActorSheet(game.actors[0], def, deriveEquipment(game.actors[0], def, catalog), []).abilities.find((entry) => entry.ability === "con")!;

    expect(row(definition, state)).toMatchObject({ save: 3, saveFromItems: 2, saveProficient: true });
    // A sheet ALREADY proficient in CON must not pay the bonus a second time.
    const alreadyProficient = definitionOf({ proficiencies: { saves: ["con"], skills: [], weapons: [], armor: [], tools: [] } });
    expect(row(alreadyProficient, state)).toMatchObject({ save: 3, saveFromItems: 0 });
    // Unequip: replace-whole is the un-grant.
    const bare = fight(stateWith([item({ id: "amulet-of-health", name: "Amulet of Health", equipped: false, category: "wondrous" })]));
    expect(row(definition, bare)).toMatchObject({ save: 1, saveFromItems: 0, saveProficient: false });
  });
});

// -------------------------------------------------------------------------------------------------
// Row 2 - item grants: damageResistances  (and row 3's damageImmunities, same pipeline)
// -------------------------------------------------------------------------------------------------

describe("row 2: an item that grants damage resistance", () => {
  const RING: EquipmentRecordLike = {
    id: "ring-of-fire-resistance", name: "Ring of Fire Resistance", category: "ring", slot: "ring",
    isMagic: true, attunement: { required: true }, grants: { damageResistances: ["fire"] }
  };
  const catalog = catalogOf([RING]);
  const definition = definitionOf();
  const wearing = (equipped = true) => stateWith([item({ id: "ring-of-fire-resistance", name: "Ring of Fire Resistance", equipped, attuned: true, category: "ring" })]);

  it("halves fire on the damage command, and names the item on the line", () => {
    const state = wearing();
    const outcome = applyDamageDetailed(state, IDS.hero, { parts: [{ amount: 12, type: "fire" }], amount: 12 }, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(outcome.application.totalApplied).toBe(6);
    expect(outcome.application.parts[0]).toMatchObject({ adjustment: "resistance", adjustmentSource: "Ring of Fire Resistance" });
    expect(state.actors[0].hp.current).toBe(24);

    const without = wearing(false);
    applyDamageDetailed(without, IDS.hero, { parts: [{ amount: 12, type: "fire" }], amount: 12 }, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(without.actors[0].hp.current).toBe(18);
  });

  it("halves the damage a FAILED save applies, not just the direct command", () => {
    const state = fight(wearing());
    createPendingSaves(state, {
      sourceActorId: IDS.foe, sourceName: "Foe", actionName: "Fire Breath", ability: "dex", dc: 30,
      targetIds: [IDS.hero], proposedDamage: 12, proposedDamageParts: [{ amount: 12, type: "fire" }],
      halfOnSuccess: false, conditionId: null, newSaveId: () => "60000000-0000-4000-8000-000000000002", createdAt: 0
    });
    const outcome = answerSave(state, cmd(2), state.combat.pendingSaves[0].id, "manual", 5, true, { role: "gm" }, {
      random: () => 1, newRollId: () => "40000000-0000-4000-8000-000000000000", sessionId: IDS.gmSession, role: "gm",
      now: () => "2026-08-03T00:00:00.000Z", resolveDefinition: () => definition, catalog
    });
    expect(outcome.outcome.success).toBe(false);
    expect(outcome.outcome.appliedDamage).toBe(6);
  });
});

// -------------------------------------------------------------------------------------------------
// Row 3 - the four grant kinds the reading surface used to drop
// -------------------------------------------------------------------------------------------------

describe("row 3: the four dropped grant kinds", () => {
  it("weapons: granted training pays the proficiency bonus on the to-hit", () => {
    const AXE_ROW = { id: "greataxe", name: "Greataxe", quantity: 1, equipped: true, category: "weapon", weapon: { category: "martial", damageDice: "1d12", damageType: "slashing", rangeFeet: null, longRangeFeet: null } };
    const GAUNTLETS: EquipmentRecordLike = {
      id: "gauntlets-of-training", name: "Gauntlets of Training", category: "wondrous", slot: "hands",
      isMagic: true, grants: { weapons: ["martial"] }
    };
    // The sheet records NO martial training, so the untrained attack is str 16 (+3) alone.
    const definition = definitionOf();
    const untrained = deriveEquipment(stateWith([item(AXE_ROW)]).actors[0], definition, catalogOf([]));
    expect(untrained.actions.find((action) => action.id === "item-greataxe")!.attack!.bonus).toBe(3);

    const state = stateWith([item(AXE_ROW), item({ id: "gauntlets-of-training", name: "Gauntlets of Training", equipped: true, category: "wondrous" })]);
    const trained = deriveEquipment(state.actors[0], definition, catalogOf([GAUNTLETS]));
    expect(trained.weaponProficiencies).toEqual([{ id: "martial", sourceItemId: "gauntlets-of-training" }]);
    expect(trained.actions.find((action) => action.id === "item-greataxe")!.attack!.bonus).toBe(5);
  });

  it("armor: granted training reaches the rider gates as real proficiency", () => {
    const ROBE: EquipmentRecordLike = {
      id: "robe-of-the-drilled", name: "Robe of the Drilled", category: "wondrous", slot: "body",
      isMagic: true, grants: { armor: ["heavy"] }
    };
    const state = stateWith([item({ id: "robe-of-the-drilled", name: "Robe of the Drilled", equipped: true, category: "wondrous" })]);
    const derivation = deriveEquipment(state.actors[0], definitionOf(), catalogOf([ROBE]));
    expect(derivation.armorProficiencies).toEqual([{ id: "heavy", sourceItemId: "robe-of-the-drilled" }]);
    expect(derivation.context.proficientArmor).toContain("heavy");
  });

  it("damageImmunities: the granted type is ignored entirely", () => {
    const CLOAK: EquipmentRecordLike = {
      id: "cloak-of-the-frozen", name: "Cloak of the Frozen", category: "wondrous", slot: "back",
      isMagic: true, attunement: { required: true }, grants: { damageImmunities: ["cold"] }
    };
    const state = stateWith([item({ id: "cloak-of-the-frozen", name: "Cloak of the Frozen", equipped: true, attuned: true, category: "wondrous" })]);
    const outcome = applyDamageDetailed(state, IDS.hero, { parts: [{ amount: 15, type: "cold" }], amount: 15 }, { role: "gm" }, { resolveDefinition: () => definitionOf(), catalog: catalogOf([CLOAK]) });
    expect(outcome.application.totalApplied).toBe(0);
    expect(outcome.application.parts[0]).toMatchObject({ adjustment: "immunity", adjustmentSource: "Cloak of the Frozen" });
    expect(state.actors[0].hp.current).toBe(30);
  });

  it("conditionImmunities: the condition narrates the skip instead of landing", () => {
    const PERIAPT: EquipmentRecordLike = {
      id: "periapt-of-clarity", name: "Periapt of Clarity", category: "wondrous", slot: "neck",
      isMagic: true, attunement: { required: true }, grants: { conditionImmunities: ["frightened"] }
    };
    const definition = definitionOf();
    const catalog = catalogOf([PERIAPT]);
    const state = stateWith([item({ id: "periapt-of-clarity", name: "Periapt of Clarity", equipped: true, attuned: true, category: "wondrous" })]);
    const events = setCondition(state, IDS.hero, "frightened", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(events[0].text).toMatch(/immune to Frightened - not applied/);
    expect(state.actors[0].conditions).toHaveLength(0);

    // Negative control: the same command with the periapt unequipped applies the condition.
    const bare = stateWith([item({ id: "periapt-of-clarity", name: "Periapt of Clarity", equipped: false, category: "wondrous" })]);
    setCondition(bare, IDS.hero, "frightened", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(bare.actors[0].conditions.map((condition) => condition.id)).toEqual(["frightened"]);
  });
});

// -------------------------------------------------------------------------------------------------
// Row 4 - item-action attack & save halves
// -------------------------------------------------------------------------------------------------

describe("row 4: an item action's attack and save halves", () => {
  const ROD: EquipmentRecordLike = {
    id: "rod-of-blasting", name: "Rod of Blasting", category: "held", slot: "held", isMagic: true,
    actions: [
      { id: "zap", name: "Zap", attack: { ability: "dex" }, damage: [{ formula: "1d8", type: "force" }] },
      { id: "burst", name: "Burst", save: { ability: "dex", dc: { base: 8, ability: "cha", proficiencyBonus: true } }, damage: [{ formula: "2d6", type: "thunder" }], description: "Failure: 2d6 thunder. Success: Half damage." }
    ]
  };
  const definition = definitionOf();
  const catalog = catalogOf([ROD]);
  const held = () => fight(stateWith([item({ id: "rod-of-blasting", name: "Rod of Blasting", equipped: true, category: "held" })]));

  it("rolls a real to-hit against the target's AC", () => {
    const state = held();
    const zap = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-rod-of-blasting-zap")!;
    // dex 14 (+2) + proficiency 2 = 4.
    expect(zap.attack).toMatchObject({ bonus: 4 });
    const resolution = resolveDefinitionAction(state, zap, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) }, deps([11, 5], catalog, definition));
    expect(resolution.attack).toMatchObject({ total: 15, naturalRoll: 11, targetAc: 12, outcome: "hit" });
  });

  it("creates a pending save at the DC the author derived", () => {
    const state = held();
    const burst = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-rod-of-blasting-burst")!;
    // 8 + cha 10 (+0) + proficiency 2 = 10.
    expect(burst.save).toEqual({ ability: "dex", dc: 10 });
    resolveDefinitionAction(state, burst, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(4) }, deps([3, 4], catalog, definition));
    expect(state.combat.pendingSaves).toHaveLength(1);
    expect(state.combat.pendingSaves[0]).toMatchObject({ targetActorId: IDS.foe, ability: "dex", dc: 10, actionName: "Burst", halfOnSuccess: true });
  });

  it("resolves a flat printed DC and a spellcasting-powered attack from the wielder's own numbers", () => {
    const WAND: EquipmentRecordLike = {
      id: "wand-of-the-schooled", name: "Wand of the Schooled", category: "held", slot: "held", isMagic: true,
      actions: [{ id: "bolt", name: "Bolt", attack: { ability: "spellcasting" }, save: { ability: "wis", dc: 15 }, damage: [{ formula: "1d10", type: "force" }] }]
    };
    const caster = definitionOf({ spellcasting: { ability: "int", saveDc: 14, attackBonus: 6, slots: [], spells: [], classes: [] } });
    const state = fight(stateWith([item({ id: "wand-of-the-schooled", name: "Wand of the Schooled", equipped: true, category: "held" })]));
    const bolt = effectiveActions(caster, state.actors[0], catalogOf([WAND])).find((entry) => entry.id === "item-wand-of-the-schooled-bolt")!;
    expect(bolt.attack).toMatchObject({ bonus: 6 });
    expect(bolt.save).toEqual({ ability: "wis", dc: 15 });
  });
});

// -------------------------------------------------------------------------------------------------
// Row 5 - the item effects rider
// -------------------------------------------------------------------------------------------------

describe("row 5: an item's effects rider", () => {
  const BLADE: EquipmentRecordLike = {
    id: "blade-of-certainty", name: "Blade of Certainty", category: "weapon", slot: "weapon", isMagic: true,
    attunement: { required: true },
    effects: [{ name: "Certain Strike", tags: ["blessed"], modifiers: [{ type: "attack-advantage" }, { type: "damage-resistance", damageTypes: ["necrotic"] }] }]
  };
  const ROW = { id: "blade-of-certainty", name: "Blade of Certainty", quantity: 1, equipped: true, attuned: true, category: "weapon", weapon: { category: "martial", damageDice: "1d8", damageType: "slashing", rangeFeet: null, longRangeFeet: null } };
  const definition = definitionOf();
  const catalog = catalogOf([BLADE]);

  it("shifts the attack roll to advantage while equipped, and stops when it is not", () => {
    const state = fight(stateWith([item(ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-blade-of-certainty")!;
    // Two d20 faces are consumed only if advantage really applied: 6 then 17, keeping the 17.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(5) }, deps([6, 17, 4], catalog, definition));
    expect(resolution.attack).toMatchObject({ naturalRoll: 17, outcome: "hit" });
    expect(resolution.rollMode).toMatchObject({ mode: "advantage" });

    const unattuned = fight(stateWith([item({ ...ROW, attuned: false })]));
    const plain = effectiveActions(definition, unattuned.actors[0], catalog).find((entry) => entry.id === "item-blade-of-certainty")!;
    const without = resolveDefinitionAction(unattuned, plain, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(6) }, deps([6, 4], catalog, definition));
    expect(without.attack).toMatchObject({ naturalRoll: 6 });
    expect(without.rollMode).toBeUndefined();
  });

  it("applies an effect-declared damage resistance and publishes its tags to the rider gates", () => {
    const state = stateWith([item(ROW)]);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    expect(derivation.damageResistances).toEqual([{ id: "necrotic", sourceItemId: "blade-of-certainty" }]);
    expect(derivation.context.effectTags).toContain("blessed");
    const outcome = applyDamageDetailed(state, IDS.hero, { parts: [{ amount: 10, type: "necrotic" }], amount: 10 }, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(outcome.application.totalApplied).toBe(5);
  });
});

// -------------------------------------------------------------------------------------------------
// Row 6 - cast details: atLevel, ability, saveDc, consumesSpellSlot
// -------------------------------------------------------------------------------------------------

describe("row 6: an item that casts a spell, with its cast details", () => {
  const FIREBALL: SpellRecordLike = {
    id: "fireball", name: "Fireball", level: 3, attackRoll: false,
    damage: { roll: "8d6", types: ["fire"] }, save: "dex",
    description: "A bright streak flashes from you. Success: Half damage.",
    castingOptions: [
      { type: "slot_level_4", damageRoll: "9d6", targetCount: null },
      { type: "slot_level_5", damageRoll: "10d6", targetCount: null }
    ]
  };
  const wandOf = (cast: Record<string, unknown>): EquipmentRecordLike => ({
    id: "wand-of-fireballs", name: "Wand of Fireballs", category: "held", slot: "held", isMagic: true,
    attunement: { required: true }, casts: [{ spellId: "fireball", ...cast }]
  });
  const row = item({ id: "wand-of-fireballs", name: "Wand of Fireballs", equipped: true, attuned: true, category: "held" });
  const definition = definitionOf();

  it("resolves the spell's own damage and save instead of casting nothing", () => {
    const catalog = catalogOf([wandOf({ uses: { limit: 3, per: "long-rest" } })], [FIREBALL]);
    const state = fight(stateWith([row]));
    const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-wand-of-fireballs-cast-fireball")!;
    expect(cast.name).toBe("Cast Fireball (Wand of Fireballs)");
    expect(cast.damage).toEqual([{ formula: "8d6", type: "fire" }]);
    // No authored ability or DC: the wielder is no caster, so 8 + cha/int modifier 0 + proficiency 2.
    expect(cast.save).toEqual({ ability: "dex", dc: 10 });
    expect(cast.uses).toEqual({ limit: 3, per: "long-rest" });

    resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(7) }, deps([3, 3, 3, 3, 3, 3, 3, 3], catalog, definition));
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "dex", dc: 10, actionName: cast.name });
  });

  it("casts at the authored level, with the authored ability and printed DC", () => {
    const catalog = catalogOf([wandOf({ atLevel: 5, ability: "int", saveDc: 15 })], [FIREBALL]);
    const state = fight(stateWith([row]));
    const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-wand-of-fireballs-cast-fireball")!;
    expect(cast.damage).toEqual([{ formula: "10d6", type: "fire" }]);
    expect(cast.save).toEqual({ ability: "dex", dc: 15 });
  });

  it("spends the wearer's own spell slot when the item says it does, and refuses when the pool is empty", () => {
    const catalog = catalogOf([wandOf({ atLevel: 3, consumesSpellSlot: true })], [FIREBALL]);
    const state = fight(stateWith([row], { spellSlots: [{ level: 3, remaining: 1 }] }));
    const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-wand-of-fireballs-cast-fireball")!;
    expect(cast.spellSlot).toEqual({ level: 3 });

    resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(8) }, deps([3, 3, 3, 3, 3, 3, 3, 3], catalog, definition));
    expect(state.actors[0].spellSlots).toEqual([{ level: 3, remaining: 0 }]);

    // A fresh turn (the action slot is not what is being tested here) - the empty POOL is.
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };

    expect(() => resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(9) }, deps([3, 3, 3, 3, 3, 3, 3, 3], catalog, definition)))
      .toThrow(/spends a level-3 spell slot/);
  });

  it("degrades to a name-only cast when the catalog cannot resolve the spell", () => {
    const catalog = catalogOf([wandOf({})], []);
    const state = fight(stateWith([row]));
    const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-wand-of-fireballs-cast-fireball")!;
    expect(cast.damage).toEqual([]);
    expect(cast.save).toBeUndefined();
  });
});
