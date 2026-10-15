import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
// The shipped bundle, read as every consumer reads it.
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { builtinAction } from "../src/builtin-actions.js";
import { setCondition } from "../src/actor-conditions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { setInventoryItem } from "../src/inventory.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";

// Worn wondrous items (the worn section of `item-mechanics/items.ts`), driven through the real `ContentLibrary` over the committed
// `magic-items.v1.json`, so an unmerged rider, a renamed id or a dangling `skill-is` slug fails here.
// Inventory rows are minted as the equipment picker mints them; the Bracers of Archery's longbow comes
// from the shipped equipment catalog via `fromCatalog`, never a hand-written weapon block.
// A Cloak of Protection moves the sheet's AC and the save the server rolls, and both come off with it.
// The last describe pins every removed cast or rider, so none returns.

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

// A Wizard 5 with AC 12, Dex 14 and no save proficiencies, so every number a cloak moves is the cloak's.
// `proficiencies.weapons: []` matters for the Bracers of Archery: absent, the derivation reads "not
// recorded" as "proficient" and the grant would be invisible.
function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 3,
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [],
    extensions: {},
    character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem =>
  InventoryItemSchema.parse({ id: "x", name: "X", ...over });

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        armorClass: 12,
        definitionId: "def-hero",
        inventory
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 60, maximum: 60 },
        armorClass: 12
      }
    ]
  });
}

function fight(state: GameState) {
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );
  return state;
}

function deps(faces: number[], definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-08-12T00:00:00.000Z",
    definition,
    catalog
  };
}

const cmd = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const newTurn = (state: GameState) => {
  state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };
};

/** The row an equipment picker mints: no weapon block, no armor block, no riders. */
const worn = (id: string, name: string, over: Record<string, unknown> = {}): InventoryItem =>
  item({ id, name, quantity: 1, equipped: true, attuned: true, category: "wondrous-item", ...over });

// A mundane weapon row minted from the shipped catalog, copying the same keys the real builder copies
// (`character-build.ts`, minus `mastery`). Used for the Bracers of Archery, whose mechanic is about
// another weapon, so its stats must not be hand-written here.
const fromCatalog = (id: string): InventoryItem => {
  const record = view.equipmentRecord(id)!;
  const weapon = record.weapon!;
  return item({
    id: record.id,
    name: record.name,
    quantity: 1,
    equipped: true,
    category: record.category,
    weapon: {
      category: weapon.category,
      damageDice: weapon.damageDice,
      damageType: weapon.damageType,
      rangeFeet: weapon.rangeFeet,
      longRangeFeet: weapon.longRangeFeet,
      ...(weapon.properties ? { properties: [...weapon.properties] } : {})
    }
  });
};

describe("a Cloak of Protection moves AC and a rolled save, and both come off with it", () => {
  const ROW = { id: "cloak-of-protection", name: "Cloak of Protection", category: "wondrous-item" };

  it("carries the two authored riders out of the COMMITTED bundle, through the real content library", () => {
    // The first link: if the overlay did not merge, this fails.
    const record = view.equipmentRecord("cloak-of-protection")!;
    expect(record.slot).toBe("shoulders");
    expect(record.attunement).toMatchObject({ required: true });
    expect(record.modifiers).toEqual([
      { type: "armor-class", amount: 1, whileArmored: false, when: [] },
      { type: "save-bonus", amount: 1, when: [] }
    ]);
    // The shipped row has no weapon or armor for a fixture to have supplied.
    expect(record.weapon ?? null).toBeNull();
    expect(record.armor ?? null).toBeNull();
  });

  it("NUMBER ONE - the AC on the actor, through the real inventory write path, and back off again", () => {
    const definition = definitionOf();
    const state = stateWith([]);

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: false }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // worn but not attuned: the item requires it, so inert

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(13); // the +1

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: false, attuned: true }), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(12); // replacing the row is the un-grant

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
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Blast",
      ability: "dex",
      dc: 16,
      targetIds: [IDS.hero],
      proposedDamage: 10,
      halfOnSuccess: true,
      conditionId: null,
      newSaveId: () => "60000000-0000-4000-8000-000000000001",
      createdAt: 0
    });
    const saved = answerSave(
      state,
      cmd(1),
      state.combat.pendingSaves[0].id,
      "roll",
      undefined,
      false,
      { role: "gm" },
      {
        random: () => 13,
        newRollId: () => "40000000-0000-4000-8000-000000000000",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-12T00:00:00.000Z",
        resolveDefinition: () => definition,
        catalog
      }
    );
    // d20 = 13, +2 Dex, +1 cloak = 16, which meets DC 16.
    expect(saved.outcome).toMatchObject({ total: 16, success: true });

    // Same hero, same d20, same DC, cloak off: the save fails.
    const bareState = fight(stateWith([worn("cloak-of-protection", "Cloak of Protection", { equipped: false })]));
    const bare = deriveEquipment(bareState.actors[0], definition, catalog);
    expect(bare.armorClass).toBe(0);
    expect(saveTotalFor(definition, bareState.actors[0], "dex", bare)).toBe(2);

    createPendingSaves(bareState, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Blast",
      ability: "dex",
      dc: 16,
      targetIds: [IDS.hero],
      proposedDamage: 10,
      halfOnSuccess: true,
      conditionId: null,
      newSaveId: () => "60000000-0000-4000-8000-000000000002",
      createdAt: 0
    });
    const failed = answerSave(
      bareState,
      cmd(2),
      bareState.combat.pendingSaves[0].id,
      "roll",
      undefined,
      false,
      { role: "gm" },
      {
        random: () => 13,
        newRollId: () => "40000000-0000-4000-8000-000000000001",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-12T00:00:00.000Z",
        resolveDefinition: () => definition,
        catalog
      }
    );
    expect(failed.outcome).toMatchObject({ total: 15, success: false });
  });
});

// Boots and Cloak of Elvenkind and Cloak of the Bat, read from the committed bundle and driven to the
// die: the same fixed pair (3, 17) is queued into `resolveDefinitionAction`'s `random`, and each case
// asserts which face survived and whether the total cleared Hide's DC 15.
describe("Boots of Elvenkind make a Stealth check keep the higher die", () => {
  /** Resolve one builtin action exactly as the `action.resolve` handler does. */
  const check = (state: GameState, actionId: string, definition: ActorDefinition, faces: number[], n = 1) =>
    resolveDefinitionAction(
      state,
      builtinAction(actionId)!,
      {
        actorId: IDS.hero,
        targetIds: [],
        commandId: cmd(n),
        builtin: true
      },
      deps(faces, definition)
    );

  it("carries the harvested rider out of the COMMITTED bundle - the first link", () => {
    const record = view.equipmentRecord("boots-of-elvenkind")!;
    expect(record.slot).toBe("feet");
    expect(record.modifiers).toEqual([
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "ability-is", abilities: ["dex"] },
          { type: "skill-is", skills: ["stealth"] }
        ]
      }
    ]);
  });

  it("rolls 2d20kh1, keeps 17 over 3, and CLEARS Hide's DC 15 - the outcome moved, not just the die", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("boots-of-elvenkind", "Boots of Elvenkind", { attuned: false })]));
    const resolution = check(state, "hide", definition, [3, 17]);

    // Dex 14 = +2; this Wizard has no Stealth proficiency, so the +2 is the ability alone.
    expect(resolution.check).toMatchObject({
      skill: "Dexterity (Stealth)",
      naturalRoll: 17,
      total: 19,
      dc: 15,
      success: true
    });
    expect(resolution.rollMode).toEqual({ mode: "advantage", advantage: ["Boots of Elvenkind"], disadvantage: [] });
    // Two dice were thrown and one was kept.
    const record = state.rolls.find((roll) => roll.purpose === "check")!;
    expect(record.normalizedFormula).toBe("2d20kh1+2");
    expect(record.dice.map((die) => ({ face: die.face, kept: die.kept }))).toEqual([
      { face: 3, kept: false },
      { face: 17, kept: true }
    ]);
    // The success half moved with it: Hiding grants the Invisible-linked effect.
    expect(state.actors[0].effects.map((effect) => effect.name)).toEqual(["Hiding"]);
  });

  it("takes the boots off and the SAME queue gives one d20 and a failure", () => {
    const definition = definitionOf();
    const state = fight(
      stateWith([worn("boots-of-elvenkind", "Boots of Elvenkind", { attuned: false, equipped: false })])
    );
    const resolution = check(state, "hide", definition, [3, 17]);

    expect(resolution.check).toMatchObject({ naturalRoll: 3, total: 5, dc: 15, success: false });
    expect(resolution.rollMode).toBeUndefined();
    expect(state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe("1d20+2");
    expect(state.actors[0].effects).toEqual([]);
  });

  it("does NOT reach Search, Study or Influence - the narrow is the whole point", () => {
    // `skill-is: ["stealth"]` fails closed against a check that passes no skill, and `ability-is` fails
    // closed against a different ability, so three items cannot cover five checks.
    for (const [n, actionId, formula] of [
      [10, "search", "1d20+0"],
      [11, "study", "1d20+3"],
      [12, "influence", "1d20+0"]
    ] as const) {
      const definition = definitionOf();
      const state = fight(stateWith([worn("boots-of-elvenkind", "Boots of Elvenkind", { attuned: false })]));
      const resolution = check(state, actionId, definition, [3, 17], n);
      expect(resolution.rollMode, `${actionId} should see no advantage from a Stealth-narrowed rider`).toBeUndefined();
      expect(state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe(formula);
      expect(resolution.check!.naturalRoll).toBe(3);
    }
  });

  it("Cloak of Elvenkind is the ATTUNEMENT case: worn is not enough, attuned is", () => {
    // The Boots require no attunement and cannot prove this; the Cloak's row carries
    // `attunement.required: true` from the ETL's read of the printed type line.
    expect(view.equipmentRecord("cloak-of-elvenkind")!.attunement?.required).toBe(true);

    const unattuned = fight(stateWith([worn("cloak-of-elvenkind", "Cloak of Elvenkind", { attuned: false })]));
    expect(check(unattuned, "hide", definitionOf(), [3, 17], 20).check).toMatchObject({
      naturalRoll: 3,
      total: 5,
      success: false
    });
    expect(unattuned.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe("1d20+2");

    const attuned = fight(stateWith([worn("cloak-of-elvenkind", "Cloak of Elvenkind")]));
    const resolution = check(attuned, "hide", definitionOf(), [3, 17], 21);
    expect(resolution.check).toMatchObject({ naturalRoll: 17, total: 19, success: true });
    expect(resolution.rollMode).toEqual({ mode: "advantage", advantage: ["Cloak of Elvenkind"], disadvantage: [] });
  });

  it("Cloak of the Bat is the third carrier of the same sentence", () => {
    const state = fight(stateWith([worn("cloak-of-the-bat", "Cloak of the Bat")]));
    const resolution = check(state, "hide", definitionOf(), [3, 17], 22);
    expect(resolution.check).toMatchObject({ naturalRoll: 17, total: 19, success: true });
    expect(resolution.rollMode).toEqual({ mode: "advantage", advantage: ["Cloak of the Bat"], disadvantage: [] });
  });
});

describe("an AC bonus the SRD gates on wearing nothing", () => {
  it("gives Bracers of Defense +2 bare, and takes it away the moment a Shield is equipped", () => {
    const definition = definitionOf();
    const state = stateWith([]);
    setInventoryItem(state, IDS.hero, worn("bracers-of-defense", "Bracers of Defense"), () => definition, { catalog });
    expect(state.actors[0].armorClass).toBe(14); // 12 + 2

    // A Shield counts as armor for the gate: `while-unarmored` defaults `allowShield: false`.
    setInventoryItem(
      state,
      IDS.hero,
      item({
        id: "shield",
        name: "Shield",
        category: "shield",
        equipped: true,
        armor: {
          acBase: 2,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: false,
          strengthRequired: null
        }
      }),
      () => definition,
      { catalog }
    );
    // 10 + Dex 2 + shield 2 = 14. If the gate had not fired this would be 16.
    expect(state.actors[0].armorClass).toBe(14);
  });
});

describe("a +5 that lands on ONE skill row", () => {
  it("puts Gloves of Thievery on Sleight of Hand and nowhere else, including the same ability's other skills", () => {
    const definition = definitionOf();
    // No attunement on this item, so it is live merely worn.
    const state = stateWith([worn("gloves-of-thievery", "Gloves of Thievery", { attuned: false })]);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    const sheet = deriveActorSheet(state.actors[0], definition, derivation, skillCatalog);
    const row = (id: string) => sheet.skills.find((entry) => entry.id === id)!;

    expect(row("sleight-of-hand").bonus).toBe(7); // Dex +2 and the glove's +5
    expect(row("stealth").bonus).toBe(2); // same ability, untouched: the filter narrows
    expect(row("acrobatics").bonus).toBe(2);
    // And it is not a blanket ability bonus either: the raw Dex check is unchanged.
    expect(sheet.abilities.find((entry) => entry.ability === "dex")!.check).toBe(2);
  });
});

describe("a proficiency an item hands out, on the swing", () => {
  it("makes a Longbow proficient through Bracers of Archery and drops it when they come off", () => {
    const definition = definitionOf();
    // The bow's stats come from the shipped catalog, not this file.
    const bow = fromCatalog("longbow");
    expect(bow.weapon).toEqual({
      category: "martial",
      damageDice: "1d8",
      damageType: "piercing",
      rangeFeet: 150,
      longRangeFeet: 600,
      properties: ["ammunition", "heavy", "two-handed"]
    });
    const without = effectiveActions(definition, fight(stateWith([bow])).actors[0], catalog).find(
      (entry) => entry.id === "item-longbow"
    )!;
    const withBracers = effectiveActions(
      definition,
      fight(stateWith([bow, worn("bracers-of-archery", "Bracers of Archery")])).actors[0],
      catalog
    ).find((entry) => entry.id === "item-longbow")!;

    expect(without.attack!.bonus).toBe(2); // Dex +2, untrained
    expect(withBracers.attack!.bonus).toBe(5); // + the proficiency bonus 3, from the bracers

    // The grant is the two bows the SRD names, not "weapons": a Longsword from the same catalog stays
    // untrained with the bracers on, which `grants.weapons: ["martial"]` would fail.
    const swing = effectiveActions(
      definition,
      fight(stateWith([fromCatalog("longsword"), worn("bracers-of-archery", "Bracers of Archery")])).actors[0],
      catalog
    ).find((entry) => entry.id === "item-longsword")!;
    expect(swing.attack!.bonus).toBe(0); // Str +0, still untrained
  });
});

describe("resistance and immunity, at the damage pipeline", () => {
  it("halves Cold through Boots of the Winterlands and names the boots on the line", () => {
    const definition = definitionOf();
    const state = stateWith([worn("boots-of-the-winterlands", "Boots of the Winterlands")]);
    const outcome = applyDamageDetailed(
      state,
      IDS.hero,
      { amount: 0, parts: [{ amount: 12, type: "cold" }] },
      { role: "gm" },
      {
        resolveDefinition: () => definition,
        catalog
      }
    );
    expect(outcome.application.parts).toEqual([
      { amount: 12, type: "cold", adjusted: 6, adjustment: "resistance", adjustmentSource: "Boots of the Winterlands" }
    ]);
    expect(state.actors[0].hp.current).toBe(24);
  });

  it("zeroes Poison through the Periapt of Proof against Poison, and refuses the Poisoned condition by name", () => {
    const definition = definitionOf();
    const state = stateWith([worn("periapt-of-proof-against-poison", "Periapt of Proof against Poison")]);
    const outcome = applyDamageDetailed(
      state,
      IDS.hero,
      { amount: 0, parts: [{ amount: 14, type: "poison" }] },
      { role: "gm" },
      {
        resolveDefinition: () => definition,
        catalog
      }
    );
    expect(outcome.application.parts).toEqual([
      {
        amount: 14,
        type: "poison",
        adjusted: 0,
        adjustment: "immunity",
        adjustmentSource: "Periapt of Proof against Poison"
      }
    ]);
    expect(state.actors[0].hp.current).toBe(30);

    // The condition half, through the GM's own command: narrated as a skip, and not applied.
    const events = setCondition(
      state,
      IDS.hero,
      "poisoned",
      true,
      undefined,
      { role: "gm" },
      {
        catalog,
        resolveDefinition: () => definition
      }
    );
    expect(events[0].text).toContain("immune to");
    expect(state.actors[0].conditions).toEqual([]);
  });

  it("halves Force through the Brooch of Shielding, and Poison through the Cloak of Arachnida", () => {
    const definition = definitionOf();
    const brooch = stateWith([worn("brooch-of-shielding", "Brooch of Shielding")]);
    expect(
      applyDamageDetailed(
        brooch,
        IDS.hero,
        { amount: 0, parts: [{ amount: 9, type: "force" }] },
        { role: "gm" },
        { resolveDefinition: () => definition, catalog }
      ).application.parts[0]
    ).toMatchObject({ adjusted: 4, adjustment: "resistance", adjustmentSource: "Brooch of Shielding" });

    const cloak = stateWith([worn("cloak-of-arachnida", "Cloak of Arachnida")]);
    expect(
      applyDamageDetailed(
        cloak,
        IDS.hero,
        { amount: 0, parts: [{ amount: 10, type: "poison" }] },
        { role: "gm" },
        { resolveDefinition: () => definition, catalog }
      ).application.parts[0]
    ).toMatchObject({ adjusted: 5, adjustment: "resistance", adjustmentSource: "Cloak of Arachnida" });
  });
});

describe("the charges a worn item rations", () => {
  it("spends the Robe of Scintillating Colors' charge, holds the target to DC 15, names Stunned, and refuses the fourth press", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("robe-of-scintillating-colors", "Robe of Scintillating Colors")]));
    const actor = state.actors[0];
    const action = effectiveActions(definition, actor, catalog).find(
      (entry) => entry.id === "item-robe-of-scintillating-colors-dazzle"
    )!;
    expect(action.save).toEqual({ ability: "wis", dc: 15, successDamage: "none", failureCondition: "stunned" });
    expect(action.uses).toEqual({ limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" });

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) },
      deps([], definition)
    );
    // The prompt carries the condition the action's save block declares.
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 15, conditionId: "stunned" });
    expect(actor.actionUses["robe-of-scintillating-colors-charges"]).toBe(1);

    actor.actionUses = { "robe-of-scintillating-colors-charges": 3 };
    newTurn(state);
    expect(() =>
      resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(4) },
        deps([], definition)
      )
    ).toThrow("Scintillating Colors: no uses remaining (3/long rest).");
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
      // The charge is all these two enforce.
      expect(action.damage).toEqual([]);
      expect(action.attack).toBeUndefined();

      actor.actionUses = { [`${id}-charges`]: limit };
      expect(() =>
        resolveDefinitionAction(
          state,
          action,
          { actorId: IDS.hero, targetIds: [], commandId: cmd(5) },
          deps([], definition)
        )
      ).toThrow(`${label}: no uses remaining (${limit}/long rest).`);
    }
  });
});

describe("the casts that survived the spell-record check", () => {
  it("gives the Helm of Telepathy TWO independent daily pools, at the helm's printed DC 13", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("helm-of-telepathy", "Helm of Telepathy")]));
    const actor = state.actors[0];
    const actions = effectiveActions(definition, actor, catalog);
    const detect = actions.find((entry) => entry.id === "item-helm-of-telepathy-cast-detect-thoughts")!;
    const suggest = actions.find((entry) => entry.id === "item-helm-of-telepathy-cast-suggestion")!;

    // The DC is the item's: this Wizard has no spellcasting block, so 13 can only be authored.
    expect(detect.save).toEqual({ ability: "wis", dc: 13, successDamage: "none", failureCondition: null });
    expect(suggest.save).toEqual({ ability: "wis", dc: 13, successDamage: "none", failureCondition: "charmed" });
    // Neither cast synthesizes damage or an attack from the spell's text.
    expect(detect.damage).toEqual([]);
    expect(suggest.damage).toEqual([]);
    expect(detect.attack).toBeUndefined();

    // Separate pools: "that spell can't be cast from it again" gates each spell on its own.
    resolveDefinitionAction(
      state,
      detect,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(6) },
      deps([], definition)
    );
    expect(actor.actionUses["helm-of-telepathy-detect-thoughts"]).toBe(1);
    expect(actor.actionUses["helm-of-telepathy-suggestion"]).toBeUndefined();
    newTurn(state);
    resolveDefinitionAction(
      state,
      suggest,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(7) },
      deps([], definition)
    );
    expect(actor.actionUses["helm-of-telepathy-suggestion"]).toBe(1);
  });

  it("spends one of the Eyes of Charming's three charges at DC 13, and offers the Medallion five", () => {
    const definition = definitionOf();
    const state = fight(stateWith([worn("eyes-of-charming", "Eyes of Charming")]));
    const cast = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-eyes-of-charming-cast-charm-person"
    )!;
    expect(cast.save).toEqual({ ability: "wis", dc: 13, successDamage: "none", failureCondition: "charmed" });
    expect(cast.uses).toEqual({ limit: 3, per: "long-rest", pool: "eyes-of-charming-charges" });
    resolveDefinitionAction(
      state,
      cast,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(8) },
      deps([], definition)
    );
    expect(state.actors[0].actionUses["eyes-of-charming-charges"]).toBe(1);

    const medallion = fight(stateWith([worn("medallion-of-thoughts", "Medallion of Thoughts")]));
    const detect = effectiveActions(definition, medallion.actors[0], catalog).find(
      (entry) => entry.id === "item-medallion-of-thoughts-cast-detect-thoughts"
    )!;
    expect(detect.save).toEqual({ ability: "wis", dc: 13, successDamage: "none", failureCondition: null });
    expect(detect.uses).toEqual({ limit: 5, per: "long-rest", pool: "medallion-of-thoughts-charges" });
  });

  it("puts the two unlimited self-casts on the sheet carrying no damage, no attack and no save", () => {
    const definition = definitionOf();
    for (const [id, name, actionId] of [
      ["hat-of-disguise", "Hat of Disguise", "item-hat-of-disguise-cast-disguise-self"],
      [
        "helm-of-comprehending-languages",
        "Helm of Comprehending Languages",
        "item-helm-of-comprehending-languages-cast-comprehend-languages"
      ]
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

describe("the spell save DC a legendary robe does NOT raise", () => {
  // The Robe of the Archmagi's "spell save DC ... increases by 2" cannot be authored as `spell-save-dc`:
  // that rider raises `action.save.dc` on every action carrying a save (`effective-actions.ts` sums and
  // folds it without asking whether the action is a spell), including DCs printed on other items. The
  // robe stays prose; these assertions keep it that way.
  it("leaves a Wand of Paralysis' printed DC 15 alone, and a Breath Weapon's 13, with the robe on", () => {
    const robe = worn("robe-of-the-archmagi", "Robe of the Archmagi");
    // A definition action that is not a spell at all.
    const definition = definitionOf({
      actions: [
        {
          id: "breath",
          name: "Fire Breath",
          activation: "action",
          description: "Each creature in a 15-foot Cone makes a DC 13 Dexterity saving throw.",
          save: { ability: "dex", dc: 13 },
          damage: [{ formula: "2d6", type: "fire" }]
        }
      ]
    });
    // A second item with an SRD-printed DC. The robe is `shoulders` and a wand is `held`, so this is a
    // real loadout.
    const wand = worn("wand-of-paralysis", "Wand of Paralysis", { category: "wand" });
    const dcs = (inventory: InventoryItem[]) =>
      Object.fromEntries(
        effectiveActions(definition, stateWith(inventory).actors[0], catalog)
          .filter((entry) => entry.save)
          .map((entry) => [entry.id, entry.save!.dc])
      );

    const bare = dcs([wand]);
    expect(bare).toEqual({ breath: 13, "item-wand-of-paralysis-paralyzing-ray": 15 });
    // With the robe on, both are unchanged.
    expect(dcs([wand, robe])).toEqual(bare);
  });

  it("carries no rider at all on the robe, and no row in the whole bundle carries `spell-save-dc`", () => {
    const record = view.equipmentRecord("robe-of-the-archmagi")!;
    expect(record.modifiers ?? []).toEqual([]);
    expect(record.casts ?? []).toEqual([]);
    expect(record.actions ?? []).toEqual([]);
    // The robe was the only carrier, so no shipped item carries `spell-save-dc`; a new one must justify it.
    expect(
      loadMagicItems()
        .filter((row) => (row.modifiers ?? []).some((modifier) => modifier.type === "spell-save-dc"))
        .map((row) => row.id)
    ).toEqual([]);
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
    setInventoryItem(state, IDS.hero, worn("scarab-of-protection", "Scarab of Protection"), () => definition, {
      catalog
    });
    expect(state.actors[0].armorClass).toBe(13);
    setInventoryItem(
      state,
      IDS.hero,
      worn("scarab-of-protection", "Scarab of Protection", { equipped: false }),
      () => definition,
      { catalog }
    );
    expect(state.actors[0].armorClass).toBe(12);
  });
});

describe("the worn items left as prose, by name", () => {
  const rows = loadMagicItems();
  const worn = rows.filter((row) => row.category === "wondrous-item" && row.slot !== "wondrous");

  it("leaves the five casts that produced the wrong thing unauthored, by name", () => {
    // Each of these produced the wrong effect when driven (e.g. a Helm of Teleportation dealing 1d100
    // Force damage). Re-authoring one adds a `casts` entry and fails here.
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
    // And the two blocked on healing carry nothing at all.
    for (const id of ["periapt-of-health", "necklace-of-prayer-beads"]) {
      const row = view.equipmentRecord(id)!;
      expect(row.casts ?? []).toEqual([]);
      expect(row.actions ?? []).toEqual([]);
      expect(row.modifiers ?? []).toEqual([]);
    }
  });

  it("leaves the four RESERVED items and the four ability-score refusals entirely to prose", () => {
    for (const id of [
      // The gloves need a rolled reduction ("1d10 plus your Dexterity modifier"), a free-hand gate and a
      // Reaction cost; `on-taking-damage` + `damage-reduction` alone cannot express it.
      "gloves-of-missile-snaring",
      "periapt-of-wound-closure", // rolled amount
      "talisman-of-pure-good",
      "talisman-of-ultimate-evil", // needs mechanics not modeled yet
      "amulet-of-health",
      "belt-of-giant-strength", // ITEM_REFUSED_MODIFIER_TYPES
      "gauntlets-of-ogre-power",
      "headband-of-intellect"
    ]) {
      const row = view.equipmentRecord(id)!;
      expect(row.modifiers ?? [], `${id} must stay prose`).toEqual([]);
      expect(row.casts ?? []).toEqual([]);
      expect(row.actions ?? []).toEqual([]);
      expect(Object.values(row.grants ?? {}).flat()).toEqual([]);
    }
  });

  it("splits the eight 'Advantage on a check' rows 3 authored / 5 prose, and says why for each", () => {
    // Of the eight "Advantage on ... checks" rows, only those whose clause the engine can express exactly
    // are authored; authoring the rest would over-grant.
    const advantageOnChecks = worn
      .filter((row) => /Advantage on [^.]*\bchecks?\b/i.test(row.description ?? ""))
      .map((row) => row.id)
      .sort();
    expect(advantageOnChecks).toEqual([
      "belt-of-dwarvenkind",
      "boots-of-elvenkind",
      "cloak-of-elvenkind",
      "cloak-of-the-bat",
      "eyes-of-minute-seeing",
      "eyes-of-the-eagle",
      "robe-of-eyes",
      "talisman-of-the-sphere"
    ]);

    // Authored (3): the clause is "Advantage on Dexterity (Stealth) checks" with no qualifier, and
    // `BUILTIN_CHECKS.hide` passes exactly `{ability: "dex", skill: "stealth"}`, so the rider fires on that
    // check and, because `ability-is`/`skill-is` fail closed, on nothing else.
    for (const id of ["boots-of-elvenkind", "cloak-of-elvenkind", "cloak-of-the-bat"]) {
      const row = view.equipmentRecord(id)!;
      expect(row.modifiers, `${id} lost its harvested rider`).toContainEqual({
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "ability-is", abilities: ["dex"] },
          { type: "skill-is", skills: ["stealth"] }
        ]
      });
    }

    // Still prose (5), each for its own reason, which the failure message names.
    for (const [id, why] of [
      ["belt-of-dwarvenkind", "Persuasion narrowed to dwarves and duergar - no trigger names who you are influencing"],
      ["eyes-of-minute-seeing", "Investigation within ONE FOOT - nothing measures a distance"],
      ["eyes-of-the-eagle", "Perception 'that rely on sight' - Search does not know what it relied on"],
      ["robe-of-eyes", "Perception 'that rely on sight', on a robe whose own Drawbacks Blind you"],
      ["talisman-of-the-sphere", "Arcana to control a Sphere of Annihilation, which the engine does not hold"]
    ] as const) {
      const advantage = view.equipmentRecord(id)!.modifiers.filter((modifier) => modifier.type === "roll-mode");
      expect(advantage, `${id} must stay prose: ${why}`).toEqual([]);
    }
  });

  it("authors no curse on a worn item, because none prints one", () => {
    // `Robe of Eyes` prints a Drawbacks clause but is not cursed: it comes off, and a curse would lock
    // its benefits on.
    expect(worn.filter((row) => row.cursed === true)).toEqual([]);
    const speakOfCurses = rows
      .filter((row) => /\bcursed\b/i.test(row.description ?? ""))
      .map((row) => row.id)
      .sort();
    expect(speakOfCurses).toEqual([
      "armor-of-vulnerability",
      "berserker-axe",
      "demon-armor",
      "mysterious-deck",
      "shield-of-missile-attraction"
    ]);
    expect(speakOfCurses.filter((id) => worn.some((row) => row.id === id))).toEqual([]);
  });
});
