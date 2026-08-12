import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
// The SHIPPED bundle, read the way every consumer reads it. Nothing below is a fixture.
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
// The lane list is authoring-side and outside the package's `exports` map, so it is reached by path.
// That is deliberate: this file's guard is that the COMPOSED lane and the COMMITTED bundle agree.
import { ITEM_MECHANICS_LANES } from "../../../packages/content-srd-5.2.1/scripts/item-mechanics/index.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { setCondition } from "../src/actor-conditions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { setInventoryItem } from "../src/inventory.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";

/**
 * ============================================================================================
 * C7c - WONDROUS ITEMS YOU WEAR, PROVED AT THE FAR END
 * ============================================================================================
 *
 * `packages/content-srd-5.2.1/scripts/item-mechanics/worn-wondrous.ts` authors 19 of this lane's 56
 * items. This file is the proof that the authoring reaches the table, and like C7b's it does NOT
 * inject a fixture catalog the way `item-riders.test.ts` does: it runs the REAL `ContentLibrary`
 * over the REAL committed `magic-items.v1.json`, so a rider the ETL failed to merge, an id that got
 * renamed, or a `skill-is` slug that resolves to nothing fails HERE rather than at a character sheet.
 *
 * NOTHING BELOW IS SUPPLIED BY A FIXTURE. Round 1's headline far end passed only because its test
 * injected a weapon block the shipped row does not have; every row here is minted the way the
 * equipment picker mints one - id, name, category, equipped, attuned - and every number comes out of
 * the bundle. **THE ONE ROW THAT IS NOT A C7c ITEM IS THE BRACERS OF ARCHERY' LONGBOW, and review
 * caught it standing as a hand-written weapon block, which is the exact shape this paragraph
 * forbids.** It is now minted from `view.equipmentRecord("longbow")` - the SHIPPED weapon fold,
 * `1d8` piercing, 150/600, `["ammunition", "heavy", "two-handed"]` - so a to-hit measured through it
 * is measured through the bundle like everything else.
 *
 * THE FAR END IS A REVERSAL. A `Cloak of Protection` moves the AC the sheet shows AND the saving
 * throw the SERVER rolls, and BOTH come back off when the cloak does. A bonus that survives
 * unequipping is the bug this shape exists to rule out.
 *
 * THE LAST DESCRIBE IS THE SALVAGE GUARD. It pins the lane's counts and, item by item, the FIVE
 * casts that were measured producing the wrong thing and taken out - so no later pass can quietly
 * put `teleport`'s 1d100 back - plus the SIXTH removal review added, `Robe of the Archmagi`'s
 * `spell-save-dc`, which had already shipped.
 */

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);
const skillCatalog = view.catalogChoiceCatalogs().skills;

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/**
 * A Wizard 5 with AC 12, Dex 14 and NO save proficiencies, so every number a cloak moves below is
 * visibly the cloak's. `proficiencies.weapons: []` matters for the Bracers of Archery: absent, the
 * derivation reads "not recorded" as "proficient" and the grant would be invisible.
 */
function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 3,
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [], extensions: {},
    character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 60, maximum: 60 }, armorClass: 12 }
  ] });
}

function fight(state: GameState) {
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return state;
}

function deps(faces: number[], definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-12T00:00:00.000Z", definition, catalog
  };
}

const cmd = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const newTurn = (state: GameState) => {
  state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };
};

/** The row an equipment picker mints: no weapon block, no armor block, no riders. Exactly the shipped shape. */
const worn = (id: string, name: string, over: Record<string, unknown> = {}): InventoryItem =>
  item({ id, name, quantity: 1, equipped: true, attuned: true, category: "wondrous-item", ...over });

/**
 * A MUNDANE weapon row minted from the SHIPPED catalog, copying the same six keys the real builder
 * copies (`character-build.ts:1590`) and dropping `mastery` for the reason stated there. Used only
 * for the Bracers of Archery, whose whole mechanic is about somebody else's weapon: writing that
 * weapon's stats by hand here would be round 1's "the test measured its own fixture", and it was.
 */
const fromCatalog = (id: string): InventoryItem => {
  const record = view.equipmentRecord(id)!;
  const weapon = record.weapon!;
  return item({
    id: record.id, name: record.name, quantity: 1, equipped: true, category: record.category,
    weapon: {
      category: weapon.category, damageDice: weapon.damageDice, damageType: weapon.damageType,
      rangeFeet: weapon.rangeFeet, longRangeFeet: weapon.longRangeFeet,
      ...(weapon.properties ? { properties: [...weapon.properties] } : {})
    }
  });
};

// -------------------------------------------------------------------------------------------------
// THE FAR END
// -------------------------------------------------------------------------------------------------

describe("C7c far end: a Cloak of Protection moves AC and a rolled save, and both come off with it", () => {
  const ROW = { id: "cloak-of-protection", name: "Cloak of Protection", category: "wondrous-item" };

  it("carries the two authored riders out of the COMMITTED bundle, through the real content library", () => {
    // Not the far end - the first link. If the overlay did not merge, this is what says so.
    const record = view.equipmentRecord("cloak-of-protection")!;
    expect(record.slot).toBe("shoulders");
    expect(record.attunement).toMatchObject({ required: true });
    expect(record.modifiers).toEqual([
      { type: "armor-class", amount: 1, whileArmored: false, when: [] },
      { type: "save-bonus", amount: 1, when: [] }
    ]);
    // And the shipped row really has nothing for a fixture to have supplied: no weapon, no armor.
    expect(record.weapon ?? null).toBeNull();
    expect(record.armor ?? null).toBeNull();
  });

  it("NUMBER ONE - the AC on the actor, through the real inventory write path, and back off again", () => {
    const definition = definitionOf();
    const state = stateWith([]);

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: false }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // worn but not attuned: the item requires it, so inert

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13); // THE +1

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: false, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // replace-whole IS the un-grant

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13);
    setInventoryItem(state, IDS.hero, item({ ...ROW, quantity: 0 }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // deleting the row removes it too
  });

  it("NUMBER TWO - a saving throw the SERVER rolls, where the cloak's +1 is the difference between fail and pass", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("cloak-of-protection", "Cloak of Protection")]));

    // The chip and the roll read the same function, so this is the number that will be rolled.
    const withCloak = deriveEquipment(state.actors[0], definition, catalog);
    expect(saveTotalFor(definition, state.actors[0], "dex", withCloak)).toBe(3); // Dex +2, no proficiency, +1 cloak

    createPendingSaves(state, {
      sourceActorId: IDS.foe, sourceName: "Foe", actionName: "Blast", ability: "dex", dc: 16,
      targetIds: [IDS.hero], proposedDamage: 10, halfOnSuccess: true, conditionId: null,
      newSaveId: () => "60000000-0000-4000-8000-000000000001", createdAt: 0
    });
    const saved = answerSave(state, cmd(1), state.combat.pendingSaves[0].id, "roll", undefined, false, { role: "gm" }, {
      random: () => 13, newRollId: () => "40000000-0000-4000-8000-000000000000", sessionId: IDS.gmSession, role: "gm",
      now: () => "2026-08-12T00:00:00.000Z", resolveDefinition: () => definition, catalog
    });
    // d20 = 13, +2 Dex, +1 cloak = 16, which exactly MEETS DC 16.
    expect(saved.outcome).toMatchObject({ total: 16, success: true });

    // THE REVERSAL. Same hero, same d20, same DC - the cloak is off, and the save fails.
    const bareState = fight(stateWith([worn("cloak-of-protection", "Cloak of Protection", { equipped: false })]));
    const bare = deriveEquipment(bareState.actors[0], definition, catalog);
    expect(bare.armorClass).toBe(0);
    expect(saveTotalFor(definition, bareState.actors[0], "dex", bare)).toBe(2);

    createPendingSaves(bareState, {
      sourceActorId: IDS.foe, sourceName: "Foe", actionName: "Blast", ability: "dex", dc: 16,
      targetIds: [IDS.hero], proposedDamage: 10, halfOnSuccess: true, conditionId: null,
      newSaveId: () => "60000000-0000-4000-8000-000000000002", createdAt: 0
    });
    const failed = answerSave(bareState, cmd(2), bareState.combat.pendingSaves[0].id, "roll", undefined, false, { role: "gm" }, {
      random: () => 13, newRollId: () => "40000000-0000-4000-8000-000000000001", sessionId: IDS.gmSession, role: "gm",
      now: () => "2026-08-12T00:00:00.000Z", resolveDefinition: () => definition, catalog
    });
    expect(failed.outcome).toMatchObject({ total: 15, success: false });
  });
});

// -------------------------------------------------------------------------------------------------
// The lane's other rider families, each ending at an engine outcome
// -------------------------------------------------------------------------------------------------

describe("C7c: an AC bonus the SRD gates on wearing nothing", () => {
  it("gives Bracers of Defense +2 bare, and takes it away the moment a Shield is equipped", () => {
    const definition = definitionOf();
    const state = stateWith([]);
    setInventoryItem(state, IDS.hero, worn("bracers-of-defense", "Bracers of Defense"), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(14); // 12 + 2

    // A Shield is armour for the gate's purposes: `while-unarmored` defaults `allowShield: false`.
    setInventoryItem(state, IDS.hero, item({
      id: "shield", name: "Shield", category: "shield", equipped: true,
      armor: { acBase: 2, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null }
    }), () => definition, { catalog });
    // 10 + Dex 2 + shield 2 = 14. If the gate had not fired this would be 16.
    expect(state.actors[0].armorClass).toBe(14);
  });
});

describe("C7c: a +5 that lands on ONE skill row", () => {
  it("puts Gloves of Thievery on Sleight of Hand and nowhere else, including the same ability's other skills", () => {
    const definition = definitionOf();
    // No attunement on this item, so it is live merely worn - the shipped row says so.
    const state = stateWith([worn("gloves-of-thievery", "Gloves of Thievery", { attuned: false })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    const sheet = deriveActorSheet(state.actors[0], definition, derivation, skillCatalog);
    const row = (id: string) => sheet.skills.find((entry) => entry.id === id)!;

    expect(row("sleight-of-hand").bonus).toBe(7); // Dex +2 and the glove's +5
    expect(row("stealth").bonus).toBe(2);         // same ability, untouched - the filter really narrows
    expect(row("acrobatics").bonus).toBe(2);
    // And it is not a blanket ability bonus either: the raw Dex check is unchanged.
    expect(sheet.abilities.find((entry) => entry.ability === "dex")!.check).toBe(2);
  });
});

describe("C7c: a proficiency an item hands out, on the swing", () => {
  it("makes a Longbow proficient through Bracers of Archery and drops it when they come off", () => {
    const definition = definitionOf();
    // The bow's stats come OUT OF THE SHIPPED CATALOG, not out of this file. A hand-written weapon
    // block here is round 1's exact mistake - a test measuring its own fixture - and it stood in
    // this very test until review found it.
    const bow = fromCatalog("longbow");
    expect(bow.weapon).toEqual({ category: "martial", damageDice: "1d8", damageType: "piercing", rangeFeet: 150, longRangeFeet: 600, properties: ["ammunition", "heavy", "two-handed"] });
    const without = effectiveActions(definition, fight(stateWith([bow])).actors[0], catalog)
      .find((entry) => entry.id === "item-longbow")!;
    const withBracers = effectiveActions(definition, fight(stateWith([bow, worn("bracers-of-archery", "Bracers of Archery")])).actors[0], catalog)
      .find((entry) => entry.id === "item-longbow")!;

    expect(without.attack!.bonus).toBe(2);        // Dex +2, untrained
    expect(withBracers.attack!.bonus).toBe(5);    // + the proficiency bonus 3, from the bracers

    // And the grant really is the two bows the SRD names, not "weapons": a Longsword out of the same
    // shipped catalog is untrained with the bracers on. Without this, `grants.weapons: ["martial"]`
    // would pass every assertion above.
    const swing = effectiveActions(definition, fight(stateWith([fromCatalog("longsword"), worn("bracers-of-archery", "Bracers of Archery")])).actors[0], catalog)
      .find((entry) => entry.id === "item-longsword")!;
    expect(swing.attack!.bonus).toBe(0);          // Str +0, still untrained
  });
});

describe("C7c: resistance and immunity, at the damage pipeline", () => {
  it("halves Cold through Boots of the Winterlands and names the boots on the line", () => {
    const definition = definitionOf();
    const state = stateWith([worn("boots-of-the-winterlands", "Boots of the Winterlands")]);
    const outcome = applyDamageDetailed(state, IDS.hero, { amount: 0, parts: [{ amount: 12, type: "cold" }] }, { role: "gm" }, {
      resolveDefinition: () => definition, catalog
    });
    expect(outcome.application.parts).toEqual([
      { amount: 12, type: "cold", adjusted: 6, adjustment: "resistance", adjustmentSource: "Boots of the Winterlands" }
    ]);
    expect(state.actors[0].hp.current).toBe(24);
  });

  it("zeroes Poison through the Periapt of Proof against Poison, and refuses the Poisoned condition by name", () => {
    const definition = definitionOf();
    const state = stateWith([worn("periapt-of-proof-against-poison", "Periapt of Proof against Poison")]);
    const outcome = applyDamageDetailed(state, IDS.hero, { amount: 0, parts: [{ amount: 14, type: "poison" }] }, { role: "gm" }, {
      resolveDefinition: () => definition, catalog
    });
    expect(outcome.application.parts).toEqual([
      { amount: 14, type: "poison", adjusted: 0, adjustment: "immunity", adjustmentSource: "Periapt of Proof against Poison" }
    ]);
    expect(state.actors[0].hp.current).toBe(30);

    // The condition half, through the GM's own command: narrated as a skip, and NOT applied.
    const events = setCondition(state, IDS.hero, "poisoned", true, undefined, { role: "gm" }, {
      catalog, resolveDefinition: () => definition
    });
    expect(events[0].text).toContain("immune to");
    expect(state.actors[0].conditions).toEqual([]);
  });

  it("halves Force through the Brooch of Shielding, and Poison through the Cloak of Arachnida", () => {
    const definition = definitionOf();
    const brooch = stateWith([worn("brooch-of-shielding", "Brooch of Shielding")]);
    expect(applyDamageDetailed(brooch, IDS.hero, { amount: 0, parts: [{ amount: 9, type: "force" }] }, { role: "gm" }, { resolveDefinition: () => definition, catalog })
      .application.parts[0]).toMatchObject({ adjusted: 4, adjustment: "resistance", adjustmentSource: "Brooch of Shielding" });

    const cloak = stateWith([worn("cloak-of-arachnida", "Cloak of Arachnida")]);
    expect(applyDamageDetailed(cloak, IDS.hero, { amount: 0, parts: [{ amount: 10, type: "poison" }] }, { role: "gm" }, { resolveDefinition: () => definition, catalog })
      .application.parts[0]).toMatchObject({ adjusted: 5, adjustment: "resistance", adjustmentSource: "Cloak of Arachnida" });
  });
});

describe("C7c: the charges a worn item rations", () => {
  it("spends the Robe of Scintillating Colors' charge, holds the target to DC 15, names Stunned, and refuses the fourth press", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("robe-of-scintillating-colors", "Robe of Scintillating Colors")]));
    const actor = state.actors[0];
    const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === "item-robe-of-scintillating-colors-dazzle")!;
    expect(action.save).toEqual({ ability: "wis", dc: 15 });
    expect(action.uses).toEqual({ limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" });

    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) }, deps([], definition));
    // The condition is not an authored field - `conditionFrom` reads "Stunned" out of the prose,
    // which is why the module keeps the SRD's word verbatim in the description.
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 15, conditionId: "stunned" });
    expect(actor.actionUses["robe-of-scintillating-colors-charges"]).toBe(1);

    actor.actionUses = { "robe-of-scintillating-colors-charges": 3 };
    newTurn(state);
    expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(4) }, deps([], definition)))
      .toThrow("Scintillating Colors: no uses remaining (3/long rest).");
  });

  it("rations the Cloak of Invisibility at three and the Winged Boots at four", () => {
    const definition = definitionOf();
    for (const [id, name, actionId, limit, label] of [
      ["cloak-of-invisibility", "Cloak of Invisibility", "item-cloak-of-invisibility-vanish", 3, "Pull Up the Hood"],
      ["winged-boots", "Winged Boots", "item-winged-boots-fly", 4, "Winged Flight"]
    ] as const) {
      const state = fight(stateWith([worn(id, name)]));
      const actor = state.actors[0];
      const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === actionId)!;
      expect(action.uses).toEqual({ limit, per: "long-rest", pool: `${id}-charges` });
      // The charge is the whole of what these two enforce; the module says so at the entry.
      expect(action.damage).toEqual([]);
      expect(action.attack).toBeUndefined();

      actor.actionUses = { [`${id}-charges`]: limit };
      expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [], commandId: cmd(5) }, deps([], definition)))
        .toThrow(`${label}: no uses remaining (${limit}/long rest).`);
    }
  });
});

describe("C7c: the casts that survived the spell-record check", () => {
  it("gives the Helm of Telepathy TWO independent daily pools, at the helm's printed DC 13", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("helm-of-telepathy", "Helm of Telepathy")]));
    const actor = state.actors[0];
    const actions = effectiveActions(definition, actor, catalog);
    const detect = actions.find((entry) => entry.id === "item-helm-of-telepathy-cast-detect-thoughts")!;
    const suggest = actions.find((entry) => entry.id === "item-helm-of-telepathy-cast-suggestion")!;

    // The DC is the ITEM's: this Wizard has no spellcasting block at all, so 13 can only be authored.
    expect(detect.save).toEqual({ ability: "wis", dc: 13 });
    expect(suggest.save).toEqual({ ability: "wis", dc: 13 });
    // W6's whole point: neither cast synthesises damage or an attack out of the spell's text.
    expect(detect.damage).toEqual([]);
    expect(suggest.damage).toEqual([]);
    expect(detect.attack).toBeUndefined();

    // SEPARATE pools - "that spell can't be cast from it again" gates each spell on its own.
    resolveDefinitionAction(state, detect, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(6) }, deps([], definition));
    expect(actor.actionUses["helm-of-telepathy-detect-thoughts"]).toBe(1);
    expect(actor.actionUses["helm-of-telepathy-suggestion"]).toBeUndefined();
    newTurn(state);
    resolveDefinitionAction(state, suggest, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(7) }, deps([], definition));
    expect(actor.actionUses["helm-of-telepathy-suggestion"]).toBe(1);
  });

  it("spends one of the Eyes of Charming's three charges at DC 13, and offers the Medallion five", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("eyes-of-charming", "Eyes of Charming")]));
    const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-eyes-of-charming-cast-charm-person")!;
    expect(cast.save).toEqual({ ability: "wis", dc: 13 });
    expect(cast.uses).toEqual({ limit: 3, per: "long-rest", pool: "eyes-of-charming-charges" });
    resolveDefinitionAction(state, cast, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(8) }, deps([], definition));
    expect(state.actors[0].actionUses["eyes-of-charming-charges"]).toBe(1);

    const medallion = fight(stateWith([worn("medallion-of-thoughts", "Medallion of Thoughts")]));
    const detect = effectiveActions(definition, medallion.actors[0], catalog).find((entry) => entry.id === "item-medallion-of-thoughts-cast-detect-thoughts")!;
    expect(detect.save).toEqual({ ability: "wis", dc: 13 });
    expect(detect.uses).toEqual({ limit: 5, per: "long-rest", pool: "medallion-of-thoughts-charges" });
  });

  it("puts the two unlimited self-casts on the sheet carrying no damage, no attack and no save", () => {
    const definition = definitionOf();
    for (const [id, name, actionId] of [
      ["hat-of-disguise", "Hat of Disguise", "item-hat-of-disguise-cast-disguise-self"],
      ["helm-of-comprehending-languages", "Helm of Comprehending Languages", "item-helm-of-comprehending-languages-cast-comprehend-languages"]
    ] as const) {
      const state = fight(stateWith([worn(id, name, { attuned: id === "hat-of-disguise" })]));
      const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === actionId)!;
      expect(cast.damage).toEqual([]);
      expect(cast.attack).toBeUndefined();
      expect(cast.save).toBeUndefined();
      expect(cast.uses).toBeUndefined();
    }
  });
});

describe("C7c: the spell save DC a legendary robe does NOT raise - W8, added by review", () => {
  /*
   * THIS TEST USED TO ASSERT THE OPPOSITE, and that is the point of keeping it here rather than
   * deleting it. `3a8acb3` authored `spell-save-dc: 2` on the Robe of the Archmagi for "War Mage.
   * Your spell save DC ... increases by 2", proved a DC-14 action reading 16, and shipped. What the
   * rider actually reaches is `action.save.dc` on EVERY action carrying a save
   * (`effective-actions.ts:51` sums it, `:74` folds it, and nothing on the path asks whether the
   * action is a spell) - so it was raising numbers PRINTED ON OTHER ITEMS. The rider is gone and
   * the robe is prose; these two assertions are what stops it coming back.
   */
  it("leaves a Wand of Paralysis' printed DC 15 alone, and a Breath Weapon's 13, with the robe on", () => {
    const robe = worn("robe-of-the-archmagi", "Robe of the Archmagi");
    // A DEFINITION action that is not a spell at all.
    const definition = definitionOf({ actions: [{
      id: "breath", name: "Fire Breath", activation: "action",
      description: "Each creature in a 15-foot Cone makes a DC 13 Dexterity saving throw.",
      save: { ability: "dex", dc: 13 }, damage: [{ formula: "2d6", type: "fire" }]
    }] });
    // A second ITEM whose DC the SRD prints on the item, out of the same shipped bundle. The slots
    // do not conflict - the robe is `shoulders` and a wand is `held` - so this is a real loadout.
    const wand = worn("wand-of-paralysis", "Wand of Paralysis", { category: "wand" });
    const dcs = (inventory: InventoryItem[]) => Object.fromEntries(
      effectiveActions(definition, stateWith(inventory).actors[0], catalog).filter((entry) => entry.save).map((entry) => [entry.id, entry.save!.dc]));

    const bare = dcs([wand]);
    expect(bare).toEqual({ breath: 13, "item-wand-of-paralysis-paralyzing-ray": 15 });
    // With the robe on, both are UNCHANGED. Before the removal they read 15 and 17.
    expect(dcs([wand, robe])).toEqual(bare);
  });

  it("carries no rider at all on the robe, and no row in the whole bundle carries `spell-save-dc`", () => {
    const record = view.equipmentRecord("robe-of-the-archmagi")!;
    expect(record.modifiers ?? []).toEqual([]);
    expect(record.casts ?? []).toEqual([]);
    expect(record.actions ?? []).toEqual([]);
    // The blast radius, measured rather than assumed: the robe was the only carrier in all 268, so
    // removing it takes the type out of the shipped content entirely. A later lane authoring one
    // turns this red and has to read W8 first.
    expect(loadMagicItems().filter((row) => (row.modifiers ?? []).some((modifier) => modifier.type === "spell-save-dc")).map((row) => row.id)).toEqual([]);
  });

  it("moves the Robe of Stars' +1 into the save the server rolls, and off again", () => {
    const definition = definitionOf();
    const on = stateWith([worn("robe-of-stars", "Robe of Stars")]);
    expect(saveTotalFor(definition, on.actors[0], "wis", deriveEquipment(on.actors[0], definition, catalog))).toBe(1);
    const off = stateWith([worn("robe-of-stars", "Robe of Stars", { equipped: false })]);
    expect(saveTotalFor(definition, off.actors[0], "wis", deriveEquipment(off.actors[0], definition, catalog))).toBe(0);
  });

  it("moves the Scarab of Protection's +1 onto the actor's AC", () => {
    const definition = definitionOf();
    const state = stateWith([]);
    setInventoryItem(state, IDS.hero, worn("scarab-of-protection", "Scarab of Protection"), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13);
    setInventoryItem(state, IDS.hero, worn("scarab-of-protection", "Scarab of Protection", { equipped: false }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12);
  });
});

// -------------------------------------------------------------------------------------------------
// THE GUARD - the lane's shape, and every removal, pinned against the committed bundle
// -------------------------------------------------------------------------------------------------

describe("C7c: the lane's own shape, machine-checked against the bundle", () => {
  const rows = loadMagicItems();
  const lane = ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7c")!;
  const WORN_SLOTS = ["neck", "shoulders", "head", "feet", "hands", "belt"];
  const mine = rows.filter((row) => row.category === "wondrous-item" && WORN_SLOTS.includes(row.slot ?? ""));

  it("is the 56 rows the plan measured, 46 of them attuned, and the lane declares exactly those slots", () => {
    expect(mine).toHaveLength(56);
    expect(mine.filter((row) => row.attunement?.required === true)).toHaveLength(46);
    expect([...(lane.slots ?? [])].sort()).toEqual([...WORN_SLOTS].sort());
    const bySlot = Object.fromEntries(WORN_SLOTS.map((slot) => [slot, mine.filter((row) => row.slot === slot).length]));
    expect(bySlot).toEqual({ neck: 15, shoulders: 15, head: 11, feet: 7, hands: 6, belt: 2 });
  });

  it("authors exactly 18 of the 56 and names the other 38 as absences - the two add to the lane", () => {
    // WAS 19 AND 37 AT `3a8acb3`. `robe-of-the-archmagi` moved to the absences when review measured
    // what its `spell-save-dc` raises (W8), and it is the ONLY row that moved.
    const authored = Object.keys(lane.entries).sort();
    expect(authored).toEqual([
      "boots-of-the-winterlands", "bracers-of-archery", "bracers-of-defense", "brooch-of-shielding",
      "cloak-of-arachnida", "cloak-of-invisibility", "cloak-of-protection", "eyes-of-charming",
      "gloves-of-thievery", "hat-of-disguise", "helm-of-comprehending-languages", "helm-of-telepathy",
      "medallion-of-thoughts", "periapt-of-proof-against-poison", "robe-of-scintillating-colors",
      "robe-of-stars", "scarab-of-protection", "winged-boots"
    ]);
    expect(authored).toHaveLength(18);
    expect(mine.length - authored.length).toBe(38);
    // Every authored id is one of the lane's own rows, and every one really carries a rider.
    for (const id of authored) {
      const row = mine.find((entry) => entry.id === id);
      expect(row, `${id} is not one of C7c's 56 rows`).toBeDefined();
      const carries = (row!.modifiers?.length ?? 0) + (row!.casts?.length ?? 0) + (row!.actions?.length ?? 0)
        + (row!.grants ? Object.values(row!.grants).flat().length : 0);
      expect(carries, `${id} merged into the bundle carrying nothing`).toBeGreaterThan(0);
      // Per-slot totals, so a row cannot move group without the module header moving with it.
    }
    const bySlot = Object.fromEntries(WORN_SLOTS.map((slot) =>
      [slot, authored.filter((id) => mine.find((row) => row.id === id)!.slot === slot).length]));
    expect(bySlot).toEqual({ shoulders: 5, head: 4, neck: 4, hands: 3, feet: 2, belt: 0 });
  });

  it("leaves the FIVE casts W6 measured producing the wrong thing unauthored, by name", () => {
    // Each of these looked authorable until it was driven. If a later pass puts one back, the row
    // gains a `casts` entry and this fails - which is the only thing standing between a Helm of
    // Teleportation and 1d100 Force damage at a player's target.
    for (const [id, why] of [
      ["helm-of-teleportation", "teleport's damage.roll is the SRD's 1d100 MISHAP table"],
      ["cape-of-the-mountebank", "dimension-door's 4d6 is arrival damage, not a cast's damage"],
      ["circlet-of-blasting", "scorching-ray's 2d6 is ONE of three rays, at the wearer's bonus not the circlet's +5"],
      ["boots-of-levitation", "levitate's Con save is an unwilling target's; the boots cast on yourself"],
      ["cloak-of-the-bat", "polymorph's Wis save is an unwilling target's; the cloak casts on yourself"]
    ] as const) {
      const row = view.equipmentRecord(id)!;
      expect(row.casts ?? [], `${id} - ${why}`).toEqual([]);
      expect(row.actions ?? [], `${id} - the charge-alone shape does not rescue a cast`).toEqual([]);
    }
    // And the two the healing bug owns carry nothing at all.
    for (const id of ["periapt-of-health", "necklace-of-prayer-beads"]) {
      const row = view.equipmentRecord(id)!;
      expect(row.casts ?? []).toEqual([]);
      expect(row.actions ?? []).toEqual([]);
      expect(row.modifiers ?? []).toEqual([]);
    }
  });

  it("leaves the four RESERVED items and the four ability-score refusals entirely to prose", () => {
    for (const id of [
      "gloves-of-missile-snaring", "periapt-of-wound-closure",         // U31, U32
      "talisman-of-pure-good", "talisman-of-ultimate-evil",            // U26 / U29
      "amulet-of-health", "belt-of-giant-strength",                    // ITEM_REFUSED_MODIFIER_TYPES
      "gauntlets-of-ogre-power", "headband-of-intellect"
    ]) {
      const row = view.equipmentRecord(id)!;
      expect(row.modifiers ?? [], `${id} must stay prose`).toEqual([]);
      expect(row.casts ?? []).toEqual([]);
      expect(row.actions ?? []).toEqual([]);
      expect(Object.values(row.grants ?? {}).flat()).toEqual([]);
    }
  });

  it("leaves every row whose mechanic is 'Advantage on a check' to prose - W1 has no consumer", () => {
    // The module's biggest single claim, machine-checked: `roll-mode` reaches four rolls and `check`
    // is not one of them, so a flat `check-bonus` would be a different sentence and is not written.
    const advantageOnChecks = mine.filter((row) => /Advantage on [^.]*\bchecks?\b/i.test(row.description ?? "")).map((row) => row.id).sort();
    expect(advantageOnChecks).toEqual([
      "belt-of-dwarvenkind", "boots-of-elvenkind", "cloak-of-elvenkind", "cloak-of-the-bat",
      "eyes-of-minute-seeing", "eyes-of-the-eagle", "robe-of-eyes", "talisman-of-the-sphere"
    ]);
    for (const id of advantageOnChecks) expect(Object.keys(lane.entries), `${id} must stay prose`).not.toContain(id);
  });

  it("authors no curse, because no row in this lane prints one", () => {
    // The lane OWNS `cursed`; this is the measurement that says it has no carrier, rather than a
    // silence that looks the same as forgetting. `Robe of Eyes` prints a Drawbacks clause and is
    // deliberately not made cursed: it comes off, and a curse would lock its benefits on.
    expect(mine.filter((row) => row.cursed === true)).toEqual([]);
    const speakOfCurses = rows.filter((row) => /\bcursed\b/i.test(row.description ?? "")).map((row) => row.id).sort();
    expect(speakOfCurses).toEqual(["armor-of-vulnerability", "berserker-axe", "demon-armor", "mysterious-deck", "shield-of-missile-attraction"]);
    expect(speakOfCurses.filter((id) => mine.some((row) => row.id === id))).toEqual([]);
  });

  it("claims no row outside its own slots - the boundary the seam now enforces", () => {
    const carried = rows.filter((row) => row.category === "wondrous-item" && row.slot === "wondrous");
    expect(carried.length).toBe(71); // C7d's half of the shared category
    for (const id of Object.keys(lane.entries)) expect(carried.some((row) => row.id === id)).toBe(false);
  });
});
