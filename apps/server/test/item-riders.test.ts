import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, effectiveSkillTier, type EquipmentCatalog, type EquipmentRecordLike, type FeatRecordLike } from "../src/equipment-derivation.js";
import { reconcileEquipment, setInventoryItem } from "../src/inventory.js";
import { startEncounter, initiativeRollMode } from "../src/encounter.js";
import { answerReaction } from "../src/reactions.js";
import { applyRest } from "../src/rests.js";
import { CommandRejectedError } from "../src/game-store.js";

/**
 * The fifteen magic-item criteria, proved SERVER-SIDE by injection.
 *
 * Every test here injects a catalog directly rather than trusting a published record, because this
 * team has repeatedly found guards that did not fire and one that did not exist. Where a criterion
 * has an obvious way to appear-to-work-but-not, the test asserts the NEGATIVE control too: the
 * unequipped case, the wrong class, the non-crit, the on-turn attack.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** A minimal but structurally honest definition; the fields the derivation and resolver actually read. */
function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [], extensions: {},
    character: { classes: [{ id: "paladin", name: "Paladin", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [{ id: "stealth", proficiency: "proficient" }] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });

/** An in-test catalog. `equipmentRecord`/`featRecord` are exactly the two hooks the derivation reads. */
function catalogOf(records: readonly EquipmentRecordLike[], feats: readonly FeatRecordLike[] = []): EquipmentCatalog {
  return {
    equipmentRecord: (id) => records.find((record) => record.id === id),
    featRecord: (id) => feats.find((feat) => feat.id === id)
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
    gmSessionId: IDS.gmSession, now: () => "2026-07-27T00:00:00.000Z",
    ...(definition ? { definition } : {}), ...(catalog ? { catalog } : {})
  };
}

const SWORD_ROW = { id: "shortsword-of-lightning", name: "Shortsword of Lightning", quantity: 1, equipped: true, attuned: true, category: "weapon", weapon: { category: "martial", damageDice: "1d6", damageType: "piercing", rangeFeet: null, longRangeFeet: null } };

// -------------------------------------------------------------------------------------------------
// Criterion 1 - "+1 to hit and an extra 1d4 lightning"
// -------------------------------------------------------------------------------------------------

describe("criterion 1: a magic weapon's +1 to hit and extra damage die", () => {
  const SWORD: EquipmentRecordLike = {
    id: "shortsword-of-lightning", name: "Shortsword of Lightning", category: "weapon", slot: "weapon",
    isMagic: true, attunement: { required: true },
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "extra-damage", formula: "1d4", damageType: "lightning", doubleOnCritical: false }
    ]
  };

  it("raises the ROLLED to-hit by exactly 1, and drops back when the sword comes off", () => {
    const definition = definitionOf();
    const catalog = catalogOf([SWORD]);
    const state = fight(stateWith([item(SWORD_ROW)]));
    const actor = state.actors[0];

    const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === "item-shortsword-of-lightning")!;
    // str 16 (+3) + proficiency 2 = 5 base; the rider makes it 6.
    expect(action.attack!.bonus).toBe(6);

    // The ROLL, not just the number: d20 = 10 -> 16 total, which beats AC 12.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" }, deps([10, 4, 3], catalog, definition));
    expect(resolution.attack).toMatchObject({ total: 16, naturalRoll: 10, targetAc: 12, outcome: "hit" });

    // Unequip: replace-whole IS the un-grant, so the very next read is back to 5.
    const bare = fight(stateWith([item({ ...SWORD_ROW, equipped: false })]));
    const without = effectiveActions(definition, bare.actors[0], catalog).find((entry) => entry.id === "item-shortsword-of-lightning");
    expect(without).toBeUndefined(); // an unequipped weapon offers no derived attack at all
    const unattuned = fight(stateWith([item({ ...SWORD_ROW, attuned: false })]));
    expect(effectiveActions(definition, unattuned.actors[0], catalog).find((entry) => entry.id === "item-shortsword-of-lightning")!.attack!.bonus).toBe(5);
  });

  it("rolls the extra 1d4 lightning as its own typed damage entry", () => {
    const definition = definitionOf();
    const catalog = catalogOf([SWORD]);
    const state = fight(stateWith([item(SWORD_ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-shortsword-of-lightning")!;

    // d20 = 10 (hit), weapon 1d6 = 4 -> 7 with the +3 Str, rider 1d4 = 3.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000002" }, deps([10, 4, 3], catalog, definition));
    expect(resolution.damage).toEqual([
      { formula: "1d6 + 3", type: "piercing", total: 7 },
      { formula: "1d4", type: "lightning", total: 3 }
    ]);
    expect(resolution.damageTotal).toBe(10);
    // Three rolls recorded: the attack and both damage dice - the lightning is a real, auditable roll.
    expect(state.rolls.map((roll) => roll.purpose)).toEqual(["attack", "damage", "damage"]);
  });

  it("applies NOTHING before attunement - the cursed-item hiding boundary", () => {
    const definition = definitionOf();
    const catalog = catalogOf([SWORD]);
    const state = stateWith([item({ ...SWORD_ROW, attuned: false })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    expect(derivation.carriers).toHaveLength(0);
    expect(derivation.sources).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 2 - the eight item kinds, made mechanically real by `slot`
// -------------------------------------------------------------------------------------------------

describe("criterion 2: `slot` makes an open category mechanically real", () => {
  it("derives AC from a homebrew category that declares an armor slot, and caps rings at two", () => {
    const definition = definitionOf();
    const relic: EquipmentRecordLike = { id: "scale-relic", name: "Scale Relic", category: "relic", slot: "armor" };
    const catalog = catalogOf([relic]);
    const state = stateWith([]);
    // `category: "relic"` is inert to the engine; `slot: "armor"` is not.
    setInventoryItem(state, IDS.hero, item({ id: "scale-relic", name: "Scale Relic", equipped: true, category: "relic", armor: { acBase: 14, addDexModifier: true, dexModifierCap: 2, stealthDisadvantage: false, strengthRequired: null } }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(16); // 14 + min(dex +2, cap 2)

    const rings: EquipmentRecordLike[] = [1, 2, 3].map((n) => ({ id: `ring-${n}`, name: `Ring ${n}`, category: "ring", slot: "ring" }));
    const ringCatalog = catalogOf(rings);
    const ringState = stateWith([]);
    for (const n of [1, 2]) setInventoryItem(ringState, IDS.hero, item({ id: `ring-${n}`, name: `Ring ${n}`, equipped: true, category: "ring" }), () => definition, { catalog: ringCatalog, role: "player" });
    expect(() => setInventoryItem(ringState, IDS.hero, item({ id: "ring-3", name: "Ring 3", equipped: true, category: "ring" }), () => definition, { catalog: ringCatalog, role: "player" }))
      .toThrow(/Only 2 ring items/);
    // The GM override is the audited escape hatch.
    setInventoryItem(ringState, IDS.hero, item({ id: "ring-3", name: "Ring 3", equipped: true, category: "ring" }), () => definition, { catalog: ringCatalog, role: "gm" });
    expect(ringState.actors[0].inventory).toHaveLength(3);
  });

  it("counts only ONE shield - three equipped shields used to read +6 AC", () => {
    const definition = definitionOf();
    const state = stateWith([]);
    const shield = (n: number) => item({ id: `shield-${n}`, name: `Shield ${n}`, equipped: true, category: "shield", armor: { acBase: 2, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null } });
    for (const n of [1, 2, 3]) setInventoryItem(state, IDS.hero, shield(n), () => definition, { role: "gm" });
    expect(state.actors[0].armorClass).toBe(14); // 10 + dex 2 + ONE shield 2, not +6
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 3 - a ring that raises AC, and gives it back
// -------------------------------------------------------------------------------------------------

describe("criterion 3: a ring changes AC and the change disappears on unequip", () => {
  const RING: EquipmentRecordLike = {
    id: "ring-of-protection", name: "Ring of Protection", category: "ring", slot: "ring",
    isMagic: true, attunement: { required: true }, modifiers: [{ type: "armor-class", amount: 1 }]
  };

  it("adds 1 while worn and attuned, removes it on unequip, and never applies unattuned", () => {
    const definition = definitionOf();
    const catalog = catalogOf([RING]);
    const state = stateWith([]);
    const row = { id: "ring-of-protection", name: "Ring of Protection", category: "ring" };

    setInventoryItem(state, IDS.hero, item({ ...row, equipped: true, attuned: false }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // worn but not attuned: inert

    setInventoryItem(state, IDS.hero, item({ ...row, equipped: true, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13); // THE +1

    setInventoryItem(state, IDS.hero, item({ ...row, equipped: false, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // replace-whole is the un-grant

    setInventoryItem(state, IDS.hero, item({ ...row, equipped: true, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13);
    setInventoryItem(state, IDS.hero, item({ ...row, quantity: 0 }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // deleting the item removes it too
  });

  it("stacks with the builder's own flat AC rider instead of dropping it", () => {
    // The Defense fighting style rides the extension bag; the item rider must ADD to it, not replace it.
    const definition = definitionOf({ extensions: { "open5e.srd-2024": { armorClassBonus: 1 } } });
    const state = stateWith([]);
    setInventoryItem(state, IDS.hero, item({ id: "ring-of-protection", name: "Ring of Protection", category: "ring", equipped: true, attuned: true }), () => definition, { catalog: catalogOf([RING]) });
    // No equipped armor, so the base is the definition's stored AC 12, and only the item rider lands
    // on top (the builder's rider is already inside that stored total).
    expect(state.actors[0].armorClass).toBe(13);
  });

  it("enforces the SRD three-item attunement cap server-side", () => {
    const definition = definitionOf();
    const state = stateWith([]);
    const catalog = catalogOf([]);
    for (const n of [1, 2, 3]) setInventoryItem(state, IDS.hero, item({ id: `trinket-${n}`, name: `Trinket ${n}`, attuned: true }), () => definition, { catalog, role: "player" });
    expect(() => setInventoryItem(state, IDS.hero, item({ id: "trinket-4", name: "Trinket 4", attuned: true }), () => definition, { catalog, role: "player" }))
      .toThrow(/Already attuned to 3 items/);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 4 - "cast Message once per day while attuned"
// -------------------------------------------------------------------------------------------------

describe("criterion 4: an item that casts a spell on a limited pool", () => {
  const AMULET: EquipmentRecordLike = {
    id: "amulet-of-whispers", name: "Amulet of Whispers", category: "wondrous", slot: "neck",
    isMagic: true, attunement: { required: true },
    casts: [{ spellId: "message", uses: { limit: 1, per: "long-rest" } }]
  };

  it("synthesises a charged action that spends and then recovers on a long rest", () => {
    const definition = definitionOf();
    const catalog = catalogOf([AMULET]);
    const state = fight(stateWith([item({ id: "amulet-of-whispers", name: "Amulet of Whispers", equipped: true, attuned: true, category: "wondrous" })]));
    const actor = state.actors[0];

    const cast = effectiveActions(definition, actor, catalog).find((entry) => entry.id === "item-amulet-of-whispers-cast-message")!;
    expect(cast.uses).toEqual({ limit: 1, per: "long-rest" });

    resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000010" }, deps([], catalog, definition));
    expect(actor.actionUses["item-amulet-of-whispers-cast-message"]).toBe(1);

    // Second use is refused - the charge really is spent.
    expect(() => resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000011" }, deps([], catalog, definition)))
      .toThrow(/no uses remaining/i);

    state.combat = { ...state.combat, active: false, initiative: [] };
    applyRest(state, IDS.hero, "long", () => definition, catalog);
    expect(actor.actionUses["item-amulet-of-whispers-cast-message"]).toBeUndefined();
  });

  it("re-arms a SHORT-rest item pool - the sweep site that silently strands charges", () => {
    const wand: EquipmentRecordLike = {
      id: "wand-of-sparks", name: "Wand of Sparks", category: "held", slot: "held",
      actions: [{ id: "spark", name: "Spark", damage: [{ formula: "1d6", type: "fire" }], uses: { limit: 3, per: "short-rest" } }]
    };
    const definition = definitionOf();
    const catalog = catalogOf([wand]);
    const state = stateWith([item({ id: "wand-of-sparks", name: "Wand of Sparks", equipped: true, category: "held" })]);
    state.actors[0].actionUses = { "item-wand-of-sparks-spark": 3 };
    // `rests.ts` reading `definition.actions` would find nothing here and leave the wand dead forever.
    applyRest(state, IDS.hero, "short", () => definition, catalog);
    expect(state.actors[0].actionUses["item-wand-of-sparks-spark"]).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 5 - advantage on Initiative
// -------------------------------------------------------------------------------------------------

describe("criterion 5: a cloak granting advantage on Initiative while attuned", () => {
  const CLOAK: EquipmentRecordLike = {
    id: "cloak-of-quickness", name: "Cloak of Quickness", category: "wondrous", slot: "shoulders",
    isMagic: true, attunement: { required: true },
    modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }, { type: "initiative", amount: 2 }]
  };

  it("rolls initiative with advantage while attuned, and normally once the cloak is off", () => {
    const definition = definitionOf();
    const catalog = catalogOf([CLOAK]);
    const row = { id: "cloak-of-quickness", name: "Cloak of Quickness", category: "wondrous", equipped: true };

    const worn = stateWith([item({ ...row, attuned: true })]);
    expect(initiativeRollMode(worn, IDS.hero, () => definition, catalog)).toBe("advantage");

    const off = stateWith([item({ ...row, attuned: false })]);
    expect(initiativeRollMode(off, IDS.hero, () => definition, catalog)).toBe("normal");

    // And the roll actually keeps the higher die: the queue gives 3 then 17.
    const faces = [3, 17];
    startEncounter(worn, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero }, { actorId: IDS.foe, score: 5 }] }, () => faces.shift()!, GEOMETRY, () => definition, Date.now(), catalog);
    expect(worn.combat.initiative.find((entry) => entry.actorId === IDS.hero)!.score).toBe(17);
  });

  it("seeds the flat initiative rider onto the live actor", () => {
    const definition = definitionOf();
    const state = stateWith([item({ id: "cloak-of-quickness", name: "Cloak of Quickness", category: "wondrous", equipped: true, attuned: true })], { initiative: 2 });
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([CLOAK]));
    expect(derivation.initiative).toBe(2);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 6 - one more use of a class resource, for one class only
// -------------------------------------------------------------------------------------------------

describe("criterion 6: a shield granting a Paladin one more use of Lay on Hands", () => {
  const SHIELD: EquipmentRecordLike = {
    id: "devotion-shield", name: "Shield of Devotion", category: "shield", slot: "shield",
    isMagic: true,
    modifiers: [{ type: "resource-bonus", poolId: "lay-on-hands", amount: 1, when: [{ type: "while-character-is", classIds: ["paladin"], speciesIds: [] }] }]
  };
  const LAY_ON_HANDS = { id: "lay-on-hands", name: "Lay on Hands", activation: "bonus-action" as const, description: "Heal.", damage: [], uses: { limit: 5, per: "long-rest" as const, pool: "lay-on-hands" } };

  it("raises the pool's limit for a Paladin and leaves a Wizard's untouched", () => {
    const catalog = catalogOf([SHIELD]);
    const row = item({ id: "devotion-shield", name: "Shield of Devotion", equipped: true, category: "shield" });

    const paladin = definitionOf({ actions: [LAY_ON_HANDS] });
    const paladinState = stateWith([row]);
    expect(effectiveActions(paladin, paladinState.actors[0], catalog).find((a) => a.id === "lay-on-hands")!.uses!.limit).toBe(6);

    const wizard = definitionOf({ actions: [LAY_ON_HANDS], character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] } });
    const wizardState = stateWith([row]);
    expect(effectiveActions(wizard, wizardState.actors[0], catalog).find((a) => a.id === "lay-on-hands")!.uses!.limit).toBe(5);
  });

  it("lets the sixth use actually resolve, where the fifth was the old ceiling", () => {
    const definition = definitionOf({ actions: [LAY_ON_HANDS] });
    const catalog = catalogOf([SHIELD]);
    const state = fight(stateWith([item({ id: "devotion-shield", name: "Shield of Devotion", equipped: true, category: "shield" })]));
    state.actors[0].actionUses = { "lay-on-hands": 5 };
    const action = effectiveActions(definition, state.actors[0], catalog).find((a) => a.id === "lay-on-hands")!;
    // The gate reads the EFFECTIVE limit (6), so the sixth use is legal.
    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000020" }, deps([], catalog, definition));
    expect(state.actors[0].actionUses["lay-on-hands"]).toBe(6);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 7 - advantage on OPPORTUNITY attacks. The one that reviews as working and does nothing.
// -------------------------------------------------------------------------------------------------

describe("criterion 7: a dagger granting advantage on opportunity attacks", () => {
  const DAGGER: EquipmentRecordLike = {
    id: "dagger-of-reprisal", name: "Dagger of Reprisal", category: "weapon", slot: "weapon",
    isMagic: true,
    modifiers: [{
      type: "roll-mode", roll: "attack", mode: "advantage", scope: "bearer",
      when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["opportunity"] }]
    }]
  };
  const DAGGER_ROW = { id: "dagger-of-reprisal", name: "Dagger of Reprisal", quantity: 1, equipped: true, category: "weapon", weapon: { category: "simple", damageDice: "1d4", damageType: "piercing", rangeFeet: null, longRangeFeet: null } };

  it("applies advantage on an OFF-TURN opportunity attack - the onOwnTurn gate must not swallow it", () => {
    const definition = definitionOf();
    const catalog = catalogOf([DAGGER]);
    // The FOE holds the turn. The hero reacts off-turn - which is exactly when the legacy
    // `attack-advantage` branch would silently drop this.
    const state = fight(stateWith([item(DAGGER_ROW)]), IDS.foe);
    expect(state.combat.turnActorId).toBe(IDS.foe);
    state.combat = { ...state.combat, pendingReactions: [{
      id: "60000000-0000-4000-8000-000000000001", kind: "leaves-reach", actorId: IDS.hero,
      actionId: "item-dagger-of-reprisal", actionName: "Opportunity Attack",
      sourceActorId: IDS.foe, sourceName: "Foe", targetActorId: IDS.foe,
      triggerCommandId: "50000000-0000-4000-8000-000000000030", proposedDamage: 0, proposedDamageParts: [],
      critical: false, createdAt: 0
    }] };

    let index = 0;
    const faces = [4, 18, 3]; // two d20s (advantage keeps 18), then the 1d4 damage
    const outcome = answerReaction(state, "50000000-0000-4000-8000-000000000031", "60000000-0000-4000-8000-000000000001", true, "item-dagger-of-reprisal", { role: "gm" }, {
      resolveDefinition: () => definition, catalog,
      random: () => faces.shift()!, newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
      gmSessionId: IDS.gmSession, now: () => "2026-07-27T00:00:00.000Z"
    });

    expect(outcome.resolution!.rollMode).toMatchObject({ mode: "advantage", advantage: ["Dagger of Reprisal"] });
    expect(outcome.resolution!.attack!.naturalRoll).toBe(18); // the HIGHER of the two dice was kept
  });

  it("does NOT apply on an ordinary on-turn attack - the filter really filters", () => {
    const definition = definitionOf();
    const catalog = catalogOf([DAGGER]);
    const state = fight(stateWith([item(DAGGER_ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-dagger-of-reprisal")!;
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000032" }, deps([11, 2], catalog, definition));
    expect(resolution.rollMode).toBeUndefined();
    expect(resolution.attack!.naturalRoll).toBe(11); // one die, not two
  });

  it("finds the item weapon as the opportunity attack's fallback melee instead of an unarmed strike", () => {
    const definition = definitionOf();
    const state = stateWith([item(DAGGER_ROW)]);
    const available = effectiveActions(definition, state.actors[0], catalogOf([DAGGER]));
    expect(available.find((entry) => entry.attack?.reachFeet !== undefined)?.name).toBe("Dagger of Reprisal");
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 8 - an extra spell slot
// -------------------------------------------------------------------------------------------------

describe("criterion 8: an amulet granting one extra 1st-level spell slot", () => {
  const AMULET: EquipmentRecordLike = {
    id: "amulet-of-reserves", name: "Amulet of Reserves", category: "wondrous", slot: "neck",
    isMagic: true, attunement: { required: true }, modifiers: [{ type: "spell-slot", level: 1, amount: 1 }]
  };
  const caster = () => definitionOf({ spellcasting: { slots: [{ level: 1, max: 2 }], spells: [], classes: [] } });

  it("hands the extra slot over full, and clamps back down when the amulet comes off", () => {
    const definition = caster();
    const catalog = catalogOf([AMULET]);
    const state = stateWith([], { spellSlots: [{ level: 1, remaining: 2 }] });
    const row = { id: "amulet-of-reserves", name: "Amulet of Reserves", category: "wondrous", equipped: true };

    setInventoryItem(state, IDS.hero, item({ ...row, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 3 }]);

    setInventoryItem(state, IDS.hero, item({ ...row, attuned: false }), () => definition, { catalog });
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 2 }]); // clamped, never stranded above max
  });

  it("refills to the RAISED maximum on a long rest, because every reader goes through spellSlotMaxima", () => {
    const definition = caster();
    const catalog = catalogOf([AMULET]);
    const state = stateWith([item({ id: "amulet-of-reserves", name: "Amulet of Reserves", category: "wondrous", equipped: true, attuned: true })], { spellSlots: [{ level: 1, remaining: 0 }] });
    applyRest(state, IDS.hero, "long", () => definition, catalog);
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 3 }]); // 2 base + 1 from the amulet
  });

  it("lets the spend clamp reach the raised maximum instead of capping at the base", async () => {
    const { setSpellSlotRemaining } = await import("../src/spellcasting.js");
    const definition = caster();
    const catalog = catalogOf([AMULET]);
    const state = stateWith([item({ id: "amulet-of-reserves", name: "Amulet of Reserves", category: "wondrous", equipped: true, attuned: true })], { spellSlots: [{ level: 1, remaining: 1 }] });
    setSpellSlotRemaining(state, IDS.hero, 1, 3, () => definition, catalog);
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    // Without the amulet the same restore clamps at the base maximum of 2.
    const bare = stateWith([], { spellSlots: [{ level: 1, remaining: 1 }] });
    setSpellSlotRemaining(bare, IDS.hero, 1, 3, () => definition, catalog);
    expect(bare.actors[0].spellSlots).toEqual([{ level: 1, remaining: 2 }]);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 9 - extra typed damage ON A CRITICAL HIT ONLY
// -------------------------------------------------------------------------------------------------

describe("criterion 9: a mace dealing an extra 1d6 fire on a critical hit", () => {
  const MACE: EquipmentRecordLike = {
    id: "mace-of-embers", name: "Mace of Embers", category: "weapon", slot: "weapon",
    isMagic: true,
    modifiers: [{ type: "extra-damage", formula: "1d6", damageType: "fire", doubleOnCritical: false, when: [{ type: "on-critical-hit" }] }]
  };
  const ROW = { id: "mace-of-embers", name: "Mace of Embers", quantity: 1, equipped: true, category: "weapon", weapon: { category: "simple", damageDice: "1d6", damageType: "bludgeoning", rangeFeet: null, longRangeFeet: null } };

  it("adds the fire die on a natural 20 and NOT on an ordinary hit", () => {
    const definition = definitionOf();
    const catalog = catalogOf([MACE]);

    const critState = fight(stateWith([item(ROW)]));
    const action = effectiveActions(definition, critState.actors[0], catalog).find((entry) => entry.id === "item-mace-of-embers")!;
    // nat 20 -> crit. The weapon's own dice double (2d6+3); the RIDER does not (5e does not double
    // dice added after the attack), so its formula stays 1d6.
    const crit = resolveDefinitionAction(critState, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000040" }, deps([20, 5, 6, 4], catalog, definition));
    expect(crit.crit).toBe(true);
    expect(crit.damage).toEqual([
      { formula: "2d6 + 3", type: "bludgeoning", total: 14 },
      { formula: "1d6", type: "fire", total: 4 }
    ]);

    const hitState = fight(stateWith([item(ROW)]));
    const hit = resolveDefinitionAction(hitState, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000041" }, deps([12, 5], catalog, definition));
    expect(hit.crit).toBe(false);
    expect(hit.damage).toEqual([{ formula: "1d6 + 3", type: "bludgeoning", total: 8 }]); // no fire
  });

  it("widens the critical range when a rider says so", () => {
    const keen: EquipmentRecordLike = { id: "keen-blade", name: "Keen Blade", category: "weapon", slot: "weapon", modifiers: [{ type: "critical-range", threshold: 19 }] };
    const definition = definitionOf();
    const catalog = catalogOf([keen]);
    const state = fight(stateWith([item({ id: "keen-blade", name: "Keen Blade", quantity: 1, equipped: true, category: "weapon", weapon: { category: "martial", damageDice: "1d8", damageType: "slashing", rangeFeet: null, longRangeFeet: null } })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-keen-blade")!;
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000042" }, deps([19, 6, 7], catalog, definition));
    expect(resolution.crit).toBe(true);
    expect(resolution.attack!.outcome).toBe("crit");
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 10 - a raised spell save DC
// -------------------------------------------------------------------------------------------------

describe("criterion 10: half-plate that raises the spell save DC", () => {
  it("raises the DC the server ENFORCES, not just the one displayed", () => {
    const armor: EquipmentRecordLike = {
      id: "half-plate-of-power", name: "Half-Plate of Power", category: "armor", slot: "armor",
      isMagic: true, modifiers: [{ type: "spell-save-dc", amount: 1 }]
    };
    const definition = definitionOf({ actions: [{ id: "scorch", name: "Scorching Ray", activation: "action", description: "Dexterity Saving Throw: DC 14.", save: { ability: "dex", dc: 14 }, damage: [{ formula: "2d6", type: "fire" }] }] });
    const catalog = catalogOf([armor]);
    const state = fight(stateWith([item({ id: "half-plate-of-power", name: "Half-Plate of Power", equipped: true, category: "armor", armor: { acBase: 15, addDexModifier: true, dexModifierCap: 2, stealthDisadvantage: true, strengthRequired: null } })]));

    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "scorch")!;
    expect(action.save!.dc).toBe(15);
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000050" }, deps([3, 4], catalog, definition));
    expect(resolution.save!.dc).toBe(15);
    expect(state.combat.pendingSaves[0].dc).toBe(15); // the DC the target is actually held to
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 11 - a circlet granting proficiency / expertise, reversibly
// -------------------------------------------------------------------------------------------------

describe("criterion 11: a circlet granting a skill proficiency or expertise", () => {
  const CIRCLET: EquipmentRecordLike = {
    id: "circlet-of-shadows", name: "Circlet of Shadows", category: "wondrous", slot: "head",
    isMagic: true, attunement: { required: true },
    grants: { skills: ["perception"], expertise: ["stealth"] }
  };

  it("layers over the base tier and vanishes on unequip - never written into the definition", () => {
    const definition = definitionOf();
    const catalog = catalogOf([CIRCLET]);
    const row = { id: "circlet-of-shadows", name: "Circlet of Shadows", category: "wondrous", equipped: true };

    const worn = stateWith([item({ ...row, attuned: true })]);
    const wornDerivation = deriveEquipment(worn.actors[0], definition, catalog);
    expect(effectiveSkillTier(definition, wornDerivation, "perception")).toBe("proficient"); // untrained -> proficient
    expect(effectiveSkillTier(definition, wornDerivation, "stealth")).toBe("expertise");     // proficient -> expertise
    expect(wornDerivation.skills).toContainEqual({ id: "stealth", proficiency: "expertise", sourceItemId: "circlet-of-shadows" });

    const off = stateWith([item({ ...row, equipped: false, attuned: true })]);
    const offDerivation = deriveEquipment(off.actors[0], definition, catalog);
    expect(effectiveSkillTier(definition, offDerivation, "perception")).toBe("none");
    expect(effectiveSkillTier(definition, offDerivation, "stealth")).toBe("proficient"); // back to the BASE tier

    // The definition itself is untouched - which is what makes the un-grant free, and what keeps the
    // grant out of the owner's projected `definition`.
    expect(definition.proficiencies!.skills).toEqual([{ id: "stealth", proficiency: "proficient" }]);
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 12 - saving throws: a flat bonus and advantage
// -------------------------------------------------------------------------------------------------

describe("criterion 12: a bow granting a bonus and advantage on saving throws", () => {
  const BOW: EquipmentRecordLike = {
    id: "bow-of-poise", name: "Bow of Poise", category: "weapon", slot: "weapon", isMagic: true,
    modifiers: [
      { type: "save-bonus", amount: 1 },
      { type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] }
    ]
  };

  it("sums the flat bonus and claims Dex-only save advantage", async () => {
    const { saveRollSources, saveRiderBonus } = await import("../src/saving-throws.js");
    const definition = definitionOf();
    const state = stateWith([item({ id: "bow-of-poise", name: "Bow of Poise", quantity: 1, equipped: true, category: "weapon" })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([BOW]));

    expect(saveRiderBonus(derivation, "dex")).toBe(1);
    expect(saveRiderBonus(derivation, "wis")).toBe(1); // the flat bonus is unnarrowed here
    expect(saveRollSources(state.actors[0], "dex", derivation).advantage).toEqual([{ source: "item:bow-of-poise", label: "Bow of Poise" }]);
    expect(saveRollSources(state.actors[0], "wis", derivation).advantage).toEqual([]); // `ability-is` narrows it
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 13 - curses: every rider is signed, and a curse will not come off
// -------------------------------------------------------------------------------------------------

describe("criterion 13: curses are the negative of every rider", () => {
  const CURSED: EquipmentRecordLike = {
    id: "blade-of-weakness", name: "Blade of Weakness", category: "weapon", slot: "weapon",
    isMagic: true, cursed: true, attunement: { required: true },
    modifiers: [{ type: "attack-bonus", amount: -1 }, { type: "armor-class", amount: -1 }, { type: "roll-mode", roll: "attack", mode: "disadvantage" }]
  };
  const ROW = { id: "blade-of-weakness", name: "Blade of Weakness", quantity: 1, equipped: true, attuned: true, category: "weapon", weapon: { category: "martial", damageDice: "1d8", damageType: "slashing", rangeFeet: null, longRangeFeet: null } };

  it("subtracts from the roll and imposes disadvantage", () => {
    const definition = definitionOf();
    const catalog = catalogOf([CURSED]);
    const state = fight(stateWith([item(ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-blade-of-weakness")!;
    expect(action.attack!.bonus).toBe(4); // 5 base, minus 1

    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000060" }, deps([15, 4, 6], catalog, definition));
    expect(resolution.rollMode).toMatchObject({ mode: "disadvantage", disadvantage: ["Blade of Weakness"] });
    expect(resolution.attack!.naturalRoll).toBe(4); // the LOWER of 15 and 4
  });

  it("refuses a player's attempt to take it off, and lets the GM remove the curse", () => {
    const definition = definitionOf();
    const catalog = catalogOf([CURSED]);
    const state = stateWith([item(ROW)]);
    const release = item({ ...ROW, equipped: false, attuned: false });
    expect(() => setInventoryItem(state, IDS.hero, release, () => definition, { catalog, role: "player" })).toThrow(CommandRejectedError);
    expect(() => setInventoryItem(state, IDS.hero, release, () => definition, { catalog, role: "player" })).toThrow(/will not come off/);
    setInventoryItem(state, IDS.hero, release, () => definition, { catalog, role: "gm" });
    expect(state.actors[0].inventory[0]).toMatchObject({ equipped: false, attuned: false });
  });

  it("hides everything until attunement - the curse contributes nothing before it springs", () => {
    const definition = definitionOf();
    const state = stateWith([item({ ...ROW, attuned: false })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([CURSED]));
    expect(derivation.armorClass).toBe(0);
    expect(derivation.carriers).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Criteria 14 & 15 - one vocabulary for every carrier, and an item that grants a feat
// -------------------------------------------------------------------------------------------------

describe("criteria 14 & 15: feats carry the same riders, and an item can grant one", () => {
  const FEAT: FeatRecordLike = {
    id: "resilient-guard", name: "Resilient Guard",
    feature: { modifiers: [{ type: "armor-class", amount: 1 }, { type: "save-bonus", amount: 2 }], grants: { skills: ["athletics"] } }
  };
  const BELT: EquipmentRecordLike = {
    id: "belt-of-the-guard", name: "Belt of the Guard", category: "wondrous", slot: "belt",
    isMagic: true, attunement: { required: true }, grantsFeatIds: ["resilient-guard"]
  };

  it("folds the granted feat's OWN riders into the same block, through the same collector", () => {
    const definition = definitionOf();
    const catalog = catalogOf([BELT], [FEAT]);
    const state = stateWith([item({ id: "belt-of-the-guard", name: "Belt of the Guard", category: "wondrous", equipped: true, attuned: true })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);

    expect(derivation.featIds).toEqual([{ id: "resilient-guard", name: "Resilient Guard", sourceItemId: "belt-of-the-guard" }]);
    // The feat's riders were read by the SAME collector that reads an item's - criterion 14 by construction.
    expect(derivation.armorClass).toBe(1);
    expect(derivation.saveBonus).toBe(2);
    expect(effectiveSkillTier(definition, derivation, "athletics")).toBe("proficient");
  });

  it("un-grants the feat and everything it granted in ONE recomputation", () => {
    const definition = definitionOf();
    const catalog = catalogOf([BELT], [FEAT]);
    const state = stateWith([]);
    const row = { id: "belt-of-the-guard", name: "Belt of the Guard", category: "wondrous", equipped: true };

    setInventoryItem(state, IDS.hero, item({ ...row, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13);

    setInventoryItem(state, IDS.hero, item({ ...row, equipped: false, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12);
    const after = deriveEquipment(state.actors[0], definition, catalog);
    expect(after.featIds).toEqual([]);
    expect(after.saveBonus).toBe(0);
    expect(effectiveSkillTier(definition, after, "athletics")).toBe("none");
  });

  it("does not follow a granted feat any further than depth 1", () => {
    // The grant edge is one-directional (an item may name feats; nothing names an item), so a cycle
    // cannot be drawn. Depth 1 is the belt-and-braces half: an unresolvable feat is simply skipped.
    const definition = definitionOf();
    const state = stateWith([item({ id: "belt-of-the-guard", name: "Belt of the Guard", category: "wondrous", equipped: true, attuned: true })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([BELT], []));
    expect(derivation.featIds).toEqual([]);
    expect(derivation.armorClass).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Fail-open and viewer safety
// -------------------------------------------------------------------------------------------------

describe("the derivation fails open and adds no actor state", () => {
  it("treats an item with no catalog record as mundane rather than throwing", () => {
    const definition = definitionOf();
    const state = stateWith([item({ id: "mystery-thing", name: "Mystery Thing", equipped: true, attuned: true, category: "wondrous" })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([]));
    expect(derivation.armorClass).toBe(0);
    expect(derivation.carriers).toHaveLength(0);
  });

  it("behaves exactly as before when no catalog is supplied at all", () => {
    const definition = definitionOf({ actions: [{ id: "bite", name: "Bite", activation: "action", description: "Bite.", attack: { bonus: 4, reachFeet: 5 }, damage: [{ formula: "1d6", type: "piercing" }] }] });
    const state = stateWith([item({ id: "ring-of-protection", name: "Ring of Protection", equipped: true, attuned: true, category: "ring" })]);
    expect(effectiveActions(definition, state.actors[0], undefined)).toBe(definition.actions);
    reconcileEquipment(state.actors[0], definition, {});
    expect(state.actors[0].armorClass).toBe(12);
  });

  it("writes no new field onto the actor, so nothing can leak through a projection", () => {
    const definition = definitionOf();
    const catalog = catalogOf([{ id: "ring-of-protection", name: "Ring of Protection", category: "ring", slot: "ring", modifiers: [{ type: "armor-class", amount: 1 }] }]);
    const state = stateWith([]);
    const before = new Set(Object.keys(state.actors[0]));
    setInventoryItem(state, IDS.hero, item({ id: "ring-of-protection", name: "Ring of Protection", category: "ring", equipped: true }), () => definition, { catalog });
    expect(new Set(Object.keys(state.actors[0]))).toEqual(before);
    expect(state.actors[0].armorClass).toBe(13); // the contribution is real, it is just not stored as its own field
  });
});

// -------------------------------------------------------------------------------------------------
// The authoring/reading seam
// -------------------------------------------------------------------------------------------------

describe("the catalog adapter's cast is a CHECKED claim, not an assumption", () => {
  it("keeps the authored content records assignable to the structural views this module reads", async () => {
    // `equipmentCatalogOf` casts, because the authoring schemas live in the content package and these
    // structural views are the reading surface. That cast is the one place the two could silently
    // drift, so the claim is asserted at COMPILE time here: if a rider field is renamed or retyped in
    // `@vtt/content-srd-5.2.1`, this file stops compiling instead of the riders quietly going inert.
    const content = await import("@vtt/content-srd-5.2.1");
    const equipment: EquipmentRecordLike = content.EquipmentReferenceSchema.parse({
      id: "ring-of-proof", name: "Ring of Proof", source: "homebrew",
      category: "ring", costGp: 0, weightLb: 0, description: null,
      slot: "ring", isMagic: true, attunement: { required: true }, cursed: false,
      modifiers: [{ type: "armor-class", amount: 1 }],
      grants: { skills: ["perception"] },
      grantsFeatIds: []
    });
    expect(equipment.modifiers?.[0]).toMatchObject({ type: "armor-class", amount: 1 });
    expect(equipment.slot).toBe("ring");
    expect(equipment.attunement?.required).toBe(true);

    // And the whole way through: a real parsed record drives a real derivation.
    const definition = definitionOf();
    const state = stateWith([item({ id: "ring-of-proof", name: "Ring of Proof", category: "ring", equipped: true, attuned: true })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalogOf([equipment]));
    expect(derivation.armorClass).toBe(1);
    expect(effectiveSkillTier(definition, derivation, "perception")).toBe("proficient");
  });
});

// -------------------------------------------------------------------------------------------------
// Criterion 16 - the flat "+N to damage rolls" (C9's co-blocker, weapons-armour.ts limit (A))
// -------------------------------------------------------------------------------------------------

describe("criterion 16: a +1 weapon's flat damage bonus", () => {
  const PLUS_ONE: EquipmentRecordLike = {
    id: "shortsword-plus-one", name: "Shortsword, +1", category: "weapon", slot: "weapon",
    isMagic: true,
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  };
  const ROW = { id: "shortsword-plus-one", name: "Shortsword, +1", quantity: 1, equipped: true, category: "weapon", weapon: { category: "martial", damageDice: "1d6", damageType: "piercing", rangeFeet: null, longRangeFeet: null } };

  it("folds the +1 into the printed damage formula, and the ROLLED total pays it", () => {
    const definition = definitionOf();
    const catalog = catalogOf([PLUS_ONE]);
    const state = fight(stateWith([item(ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-shortsword-plus-one")!;

    // Str +3 and the flat +1 in ONE printed formula - the sheet, the roll and the resolver read the
    // same number, exactly as `attack-bonus` folds into the to-hit beside it.
    expect(action.damage).toEqual([{ formula: "1d6 + 4", type: "piercing" }]);
    expect(action.attack!.bonus).toBe(6);

    // The ROLL: d20 = 10 -> 16 vs AC 12 (hit); 1d6 = 4 -> 8 damage, the +1 inside the total.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000161" }, deps([10, 4], catalog, definition));
    expect(resolution.damage).toEqual([{ formula: "1d6 + 4", type: "piercing", total: 8 }]);
    expect(resolution.damageTotal).toBe(8);
  });

  it("without the rider the formula stays 1d6 + 3 - the number moves with the value, not the field", () => {
    const definition = definitionOf();
    const plain: EquipmentRecordLike = { ...PLUS_ONE, modifiers: [{ type: "attack-bonus", amount: 1 }] };
    const state = fight(stateWith([item(ROW)]));
    const action = effectiveActions(definition, state.actors[0], catalogOf([plain])).find((entry) => entry.id === "item-shortsword-plus-one")!;
    expect(action.damage).toEqual([{ formula: "1d6 + 3", type: "piercing" }]);
  });

  it("a moment-gated bonus lands only at its moment, as its own labelled line", () => {
    const definition = definitionOf();
    const SMITER: EquipmentRecordLike = {
      id: "smiting-shortsword", name: "Smiting Shortsword", category: "weapon", slot: "weapon",
      isMagic: true,
      modifiers: [{ type: "damage-bonus", amount: 7, when: [{ type: "on-critical-hit" }] }]
    };
    const row = { ...ROW, id: "smiting-shortsword", name: "Smiting Shortsword" };
    const catalog = catalogOf([SMITER]);
    const state = fight(stateWith([item(row)]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-smiting-shortsword")!;

    // NOT folded standing: the printed formula stays the plain swing.
    expect(action.damage).toEqual([{ formula: "1d6 + 3", type: "piercing" }]);

    // An ordinary hit pays nothing: d20 = 10 -> hit, 1d6 = 4 -> 7, no bonus line.
    const hit = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000162" }, deps([10, 4], catalog, definition));
    expect(hit.bonusDamage).toBeUndefined();
    expect(hit.damageTotal).toBe(7);

    // A crit pays it as its own explainable line: d20 = 20, doubled 2d6 = 4 + 4 -> 11, plus the 7.
    const fresh = fight(stateWith([item(row)]));
    const crit = resolveDefinitionAction(fresh, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000163" }, deps([20, 4, 4], catalog, definition));
    expect(crit.attack?.outcome).toBe("crit");
    expect(crit.bonusDamage).toEqual([{ amount: 7, type: "piercing", source: "Smiting Shortsword" }]);
    expect(crit.damageTotal).toBe(18);
  });
});
