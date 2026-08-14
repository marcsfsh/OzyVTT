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
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";
import { builtinAction } from "../src/builtin-actions.js";
import { looseRollPlan } from "../src/tap-routing.js";

/**
 * ============================================================================================
 * C7d - CARRIED WONDROUS ITEMS AND POTIONS, PROVED AT THE FAR END
 * ============================================================================================
 *
 * `packages/content-srd-5.2.1/scripts/item-mechanics/carried-and-potions.ts` authors 18 of this
 * lane's 95 items and names 77 absences. This file is the proof that the 18 reach the table and,
 * in its last describe, that the 77 stayed absent for the reasons the module measured.
 *
 * NOTHING BELOW IS SUPPLIED BY A FIXTURE. It runs the REAL `ContentLibrary` over the REAL committed
 * `magic-items.v1.json`; every inventory row is minted the way the equipment picker mints one - id,
 * name, category, equipped, attuned - and every number comes out of the bundle. Round 1's headline
 * far end passed only because its test injected a weapon block the shipped row does not have.
 *
 * THE FAR END IS THE PIPES OF HAUNTING, and it ends at three engine outcomes rather than one:
 * a SPENT COUNTER, a REFUSAL at zero, and a SAVE THE SERVER ENFORCES carrying a condition that no
 * authored field names - `conditionFrom` reads "Frightened" out of the shipped description.
 *
 * THE BRIEFED FAR END WAS THE POTION OF RESISTANCE AND IT IS AN ABSENCE. `carried-and-potions.ts`
 * limits D2 and D3 carry the measurements: an item action's `grants` is dropped by `itemAction`, and
 * an item's `effects` rider ignores `duration` entirely - so "Resistance to one type of damage FOR 1
 * HOUR" can only be authored as a resistance that never ends. Both halves are pinned below, so a
 * later pass cannot quietly author one.
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

/** A Wizard 5 with AC 12, Dex 14 and NO save or skill proficiencies, so every number is the item's. */
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
const carried = (id: string, name: string, over: Record<string, unknown> = {}): InventoryItem =>
  item({ id, name, quantity: 1, equipped: true, attuned: true, category: "wondrous-item", ...over });

/** This lane's 95 rows, off the SHIPPED bundle rather than a list retyped here. */
const LANE_ROWS = loadMagicItems().filter((row) =>
  ((row.category === "wondrous-item" && row.slot === "wondrous") || row.category === "consumable") && row.id !== "spell-scroll");
/**
 * "Carries a rider" over ALL NINE keys `overlay.ts`'s `ITEM_RIDER_KEYS` admits. `tags` was the
 * missing ninth (review): a later lane authoring `tags` alone on a C7d row would have shipped a
 * rider and still passed "authors 18 and leaves 77 as prose". Latent - no lane authors `tags` on
 * any of the 268 rows, measured - but the guard is this lane's claim that a row cannot move
 * between groups unnoticed, and it was checking eight of nine.
 */
const carries = (row: { tags?: unknown[]; modifiers: unknown[]; actions: unknown[]; casts: unknown[]; effects: unknown[]; grants?: unknown; grantsFeatIds: unknown[]; uses?: unknown; cursed: boolean }) =>
  (row.tags ?? []).length > 0
  || row.modifiers.length > 0 || row.actions.length > 0 || row.casts.length > 0 || row.effects.length > 0
  || row.grants !== undefined || row.grantsFeatIds.length > 0 || row.uses !== undefined || row.cursed;

// -------------------------------------------------------------------------------------------------
// THE FAR END
// -------------------------------------------------------------------------------------------------

describe("C7d far end: the Pipes of Haunting spend a charge, refuse the fourth press, and force a real save", () => {
  it("carries the authored action out of the COMMITTED bundle, through the real content library", () => {
    // Not the far end - the first link. If the overlay did not merge, this is what says so.
    const record = view.equipmentRecord("pipes-of-haunting")!;
    expect(record.slot).toBe("wondrous");
    expect(record.category).toBe("wondrous-item");
    expect(record.attunement).toMatchObject({ required: false });
    expect(record.actions).toHaveLength(1);
    expect(record.actions[0]).toMatchObject({
      id: "play", name: "Play the Pipes", activation: "action",
      save: { ability: "wis", dc: 15 },
      uses: { limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" }
    });
    // The shipped row really has nothing for a fixture to have supplied.
    expect(record.weapon ?? null).toBeNull();
    expect(record.armor ?? null).toBeNull();
    expect(record.modifiers).toEqual([]);
    expect(record.casts).toEqual([]);
  });

  it("NUMBER ONE - the charge, spent on the real action pipeline and refused at zero", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("pipes-of-haunting", "Pipes of Haunting", { attuned: false })]));
    const actor = state.actors[0];

    const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === "item-pipes-of-haunting-play")!;
    expect(action.uses).toEqual({ limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" });
    // The charge is not the whole of it, but nothing else was invented either: no damage, no attack.
    expect(action.damage).toEqual([]);
    expect(action.attack).toBeUndefined();

    expect(actor.actionUses["pipes-of-haunting-charges"]).toBeUndefined();
    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(1) }, deps([], definition));
    expect(actor.actionUses["pipes-of-haunting-charges"]).toBe(1); // ONE of three

    newTurn(state);
    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(2) }, deps([], definition));
    newTurn(state);
    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) }, deps([], definition));
    expect(actor.actionUses["pipes-of-haunting-charges"]).toBe(3);

    // THE REFUSAL. The fourth press is the one the SRD does not allow, and the server says so.
    newTurn(state);
    expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(4) }, deps([], definition)))
      .toThrow("Play the Pipes: no uses remaining (3/long rest).");
  });

  it("NUMBER TWO - a pending save the server ENFORCES at DC 15, naming Frightened off the shipped prose", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("pipes-of-haunting", "Pipes of Haunting", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-pipes-of-haunting-play")!;

    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(5) }, deps([], definition));
    // `conditionId` is NOT an authored field: `conditionFrom` reads it out of the description the
    // bundle ships, which is why the module keeps the SRD's word "Frightened" verbatim.
    expect(state.combat.pendingSaves).toHaveLength(1);
    expect(state.combat.pendingSaves[0]).toMatchObject({ targetActorId: IDS.foe, ability: "wis", dc: 15, conditionId: "frightened" });

    // And the DC is the one the SERVER holds the target to, not one the sheet merely displays:
    // a monster with Wis +0 rolling 14 fails DC 15, and the same die passes DC 13.
    const answered = answerSave(state, cmd(6), state.combat.pendingSaves[0].id, "roll", undefined, false, { role: "gm" }, {
      random: () => 14, newRollId: () => "40000000-0000-4000-8000-0000000000aa", sessionId: IDS.gmSession, role: "gm",
      now: () => "2026-08-12T00:00:00.000Z", resolveDefinition: () => undefined, catalog
    });
    expect(answered.outcome).toMatchObject({ total: 14, success: false });
  });

  it("NUMBER THREE - the reversal: no pipes in the pack, no action and no charge at all", () => {
    const definition = definitionOf();
    const unequipped = fight(stateWith([carried("pipes-of-haunting", "Pipes of Haunting", { attuned: false, equipped: false })]));
    expect(effectiveActions(definition, unequipped.actors[0], catalog).find((entry) => entry.id === "item-pipes-of-haunting-play")).toBeUndefined();

    const empty = fight(stateWith([]));
    expect(effectiveActions(definition, empty.actors[0], catalog).find((entry) => entry.id === "item-pipes-of-haunting-play")).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// The lane's other rider families, each ending at an engine outcome
// -------------------------------------------------------------------------------------------------

describe("C7d: the Stone of Good Luck - one half whole, one half short of the roll", () => {
  const ROW = { id: "stone-of-good-luck-luckstone", name: "Stone of Good Luck", category: "wondrous-item" };

  it("moves every skill row by +1 and the save the SERVER rolls by +1, and both come off with the stone", () => {
    const definition = definitionOf();
    const state = stateWith([]);

    // Worn but not attuned: the SRD gates this one, so the row is inert and the sheet says so.
    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: false }), () => definition, { catalog });
    const bare = deriveEquipment(state.actors[0], definition, catalog);
    expect(deriveActorSheet(state.actors[0], definition, bare, skillCatalog).skills.find((row) => row.id === "arcana")!.bonus).toBe(3);
    expect(saveTotalFor(definition, state.actors[0], "dex", bare)).toBe(2);

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: true }), () => definition, { catalog });
    const lucky = deriveEquipment(state.actors[0], definition, catalog);
    const sheet = deriveActorSheet(state.actors[0], definition, lucky, skillCatalog);
    // UNNARROWED, which is what "ability checks" means - every skill, whatever its ability.
    expect(sheet.skills.find((row) => row.id === "arcana")!.bonus).toBe(4);     // Int +3 and the stone
    expect(sheet.skills.find((row) => row.id === "stealth")!.bonus).toBe(3);    // Dex +2 and the stone
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(1);  // Str +0 and the stone
    expect(saveTotalFor(definition, state.actors[0], "dex", lucky)).toBe(3);

    // THE REVERSAL, on the real inventory write path.
    setInventoryItem(state, IDS.hero, item({ ...ROW, quantity: 0 }), () => definition, { catalog });
    const gone = deriveEquipment(state.actors[0], definition, catalog);
    expect(deriveActorSheet(state.actors[0], definition, gone, skillCatalog).skills.find((row) => row.id === "arcana")!.bonus).toBe(3);
    expect(saveTotalFor(definition, state.actors[0], "dex", gone)).toBe(2);
  });

  it("is the difference between a failed and a passed save at the same die and the same DC", () => {
    const definition = definitionOf();
    for (const [attuned, total, success] of [[true, 16, true], [false, 15, false]] as const) {
      const state = fight(stateWith([carried("stone-of-good-luck-luckstone", "Stone of Good Luck", { attuned })]));
      createPendingSaves(state, {
        sourceActorId: IDS.foe, sourceName: "Foe", actionName: "Blast", ability: "dex", dc: 16,
        targetIds: [IDS.hero], proposedDamage: 10, halfOnSuccess: true, conditionId: null,
        newSaveId: () => `60000000-0000-4000-8000-00000000000${attuned ? 1 : 2}`, createdAt: 0
      });
      const answered = answerSave(state, cmd(attuned ? 7 : 8), state.combat.pendingSaves[0].id, "roll", undefined, false, { role: "gm" }, {
        random: () => 13, newRollId: () => `40000000-0000-4000-8000-00000000000${attuned ? 1 : 2}`, sessionId: IDS.gmSession, role: "gm",
        now: () => "2026-08-12T00:00:00.000Z", resolveDefinition: () => definition, catalog
      });
      expect(answered.outcome).toMatchObject({ total, success }); // d20 13, Dex +2, +1 only when attuned
    }
  });

  it("but the SERVER'S OWN ability check does not pay the +1 the sheet promises - the check half is short", () => {
    // The module used to call this row "the ONLY item in this lane whose entire printed sentence
    // lands ... nothing left over". Only the SAVE half lands on a roll. `check-bonus` reaches
    // `checkRiderBonus` -> the derived sheet's skill row and nothing else: `BUILTIN_CHECKS`
    // (action-resolution.ts:138-143) resolves at :758-766 from `abilityModifier` +
    // `skillBonusFromExtension` + `exhaustionPenalty` and never calls it. This test is the
    // measurement, kept so the gap cannot be quietly re-described as complete.
    const definition = definitionOf();
    const state = fight(stateWith([carried("stone-of-good-luck-luckstone", "Stone of Good Luck")]));
    const sheet = deriveActorSheet(state.actors[0], definition, deriveEquipment(state.actors[0], definition, catalog), skillCatalog);
    expect(sheet.skills.find((row) => row.id === "stealth")!.bonus).toBe(3); // Dex +2 AND the stone

    const hide = resolveDefinitionAction(state, builtinAction("hide")!,
      { actorId: IDS.hero, targetIds: [], commandId: cmd(16), builtin: true }, deps([10], definition));
    expect(hide.check!.total).toBe(12); // d20 10 + Dex 2. The stone's +1 is NOT here. 13 would be whole.
  });
});

describe("C7d: D8 and D9 - what this lane's buttons do outside an encounter", () => {
  it("D8: refuses every one of them, by the server's own words", () => {
    // 17 of the 18 authored rows produce NOTHING out of combat, and the printed use of most of them
    // (scry a distant creature, send a message, peer for 10 minutes of Truesight) is not a combat
    // activity. The module records this as a limit rather than rolling the riders back, because the
    // failure mode is a button that refuses rather than one that lies - and this is the refusal.
    const definition = definitionOf();
    for (const [id, name, actionId] of [
      ["crystal-ball", "Crystal Ball", "item-crystal-ball-cast-scrying"],
      ["sending-stones", "Sending Stones", "item-sending-stones-cast-sending"],
      ["gem-of-seeing", "Gem of Seeing", "item-gem-of-seeing-peer"],
      ["pipes-of-haunting", "Pipes of Haunting", "item-pipes-of-haunting-play"]
    ] as const) {
      const state = stateWith([carried(id, name)]); // NO `fight()` - that is the whole point
      const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === actionId)!;
      expect(action, `${id} - the button is on the sheet`).toBeDefined();
      expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(17) }, deps([], definition)))
        .toThrow("Start an encounter before resolving actions.");
      // And the loose `action.use` route has nothing to roll for them either: it builds from
      // `attack`/`damage` only, and none of these four carries either.
      expect({ id, plan: looseRollPlan(action, { includeDamage: true }) }).toEqual({ id, plan: [] });
    }
  });

  it("D9: except the Iron Bands, which the loose route WILL roll - and it spends no charge", () => {
    // The lane's only authored action carrying an `attack`, so the only one `looseRollPlan` builds a
    // roll for. `game-operations.ts:1571-1572` says in its own comment that this path "touches no
    // combat state at all", so `actionUses` is never incremented: outside a fight the bands throw an
    // unlimited number of real +5 attacks where the SRD prints one per dawn. Engine-wide rather than
    // an authoring mistake, which is why the rider stays and this pins the leak instead.
    const definition = definitionOf();
    const state = stateWith([carried("iron-bands", "Iron Bands", { attuned: false })]);
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-iron-bands-throw")!;
    expect(looseRollPlan(action, { includeDamage: true })).toEqual([
      { formula: "1d20 + 5", purpose: "attack", label: "Throw the Bands" }
    ]);
  });
});

describe("C7d: the one printed to-hit in the lane that the vocabulary can say", () => {
  it("derives the Iron Bands' attack from Dex + Proficiency, exactly as the SRD prints it", () => {
    const definition = definitionOf();
    // `Iron Bands`, not "Iron Bands of Bilarro" - that is the 2014-era name, it appears nowhere in
    // the vendored SRD 5.2.1, and this row mints the way the picker mints it or the header is lying.
    expect(view.equipmentRecord("iron-bands")!.name).toBe("Iron Bands");
    const state = fight(stateWith([carried("iron-bands", "Iron Bands", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-iron-bands-throw")!;
    // "an attack bonus equal to your Dexterity modifier plus your Proficiency Bonus" = 2 + 3.
    expect(action.attack).toMatchObject({ bonus: 5, rangeFeet: 60 });
    expect(action.uses).toEqual({ limit: 1, per: "long-rest", pool: "iron-bands-charges" });
    expect(action.damage).toEqual([]);

    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(9) }, deps([12], definition));
    expect(state.actors[0].actionUses["iron-bands-charges"]).toBe(1);
    newTurn(state);
    expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(10) }, deps([12], definition)))
      .toThrow("Throw the Bands: no uses remaining (1/long rest).");
  });
});

describe("C7d: the charge-alone items, whose counter is the whole of what they enforce", () => {
  it("rations the four elemental summons at one a day and the three-charge items at three", () => {
    const definition = definitionOf();
    for (const [id, name, actionId, limit, label] of [
      ["bowl-of-commanding-water-elementals", "Bowl of Commanding Water Elementals", "item-bowl-of-commanding-water-elementals-summon", 1, "Summon Water Elemental"],
      ["brazier-of-commanding-fire-elementals", "Brazier of Commanding Fire Elementals", "item-brazier-of-commanding-fire-elementals-summon", 1, "Summon Fire Elemental"],
      ["censer-of-controlling-air-elementals", "Censer of Controlling Air Elementals", "item-censer-of-controlling-air-elementals-summon", 1, "Summon Air Elemental"],
      ["stone-of-controlling-earth-elementals", "Stone of Controlling Earth Elementals", "item-stone-of-controlling-earth-elementals-summon", 1, "Summon Earth Elemental"],
      ["bag-of-tricks", "Bag of Tricks", "item-bag-of-tricks-pull", 3, "Pull a Fuzzy Object"],
      ["gem-of-seeing", "Gem of Seeing", "item-gem-of-seeing-peer", 3, "Peer Through the Gem"],
      ["pipes-of-the-sewers", "Pipes of the Sewers", "item-pipes-of-the-sewers-call", 3, "Call a Swarm of Rats"]
    ] as const) {
      const state = fight(stateWith([carried(id, name)]));
      const actor = state.actors[0];
      const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === actionId)!;
      expect(action.uses).toEqual({ limit, per: "long-rest", pool: `${id}-charges` });
      // The charge is the whole of what these enforce; the module says so at every entry.
      expect(action.damage).toEqual([]);
      expect(action.attack).toBeUndefined();
      expect(action.save).toBeUndefined();

      actor.actionUses = { [`${id}-charges`]: limit };
      expect(() => resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [], commandId: cmd(11) }, deps([], definition)))
        .toThrow(`${label}: no uses remaining (${limit}/long rest).`);
    }
  });
});

describe("C7d: the casts that survived the spell-record check", () => {
  it("holds all four Crystal Balls' Scrying to the orbs' printed DC 17, with nothing else invented", () => {
    const definition = definitionOf();
    for (const id of ["crystal-ball", "crystal-ball-of-mind-reading", "crystal-ball-of-telepathy", "crystal-ball-of-true-seeing"]) {
      const state = fight(stateWith([carried(id, "Crystal Ball")]));
      const cast = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === `item-${id}-cast-scrying`)!;
      // The save Scrying's OWN target makes, at the item's printed DC - not the wearer's derived one.
      expect(cast.save).toEqual({ ability: "wis", dc: 17 });
      expect(cast.damage).toEqual([]);
      expect(cast.attack).toBeUndefined();
      expect(cast.uses).toBeUndefined(); // no charge limit is printed on any of the four
    }
  });

  it("D7: the two SENSOR-GATED casts are absent, and a re-author would land a real Charm on any target", () => {
    // These two SHIPPED and review removed them. The SRD casts both through an active Scrying's
    // sensor, at a creature near it - "targeting creatures you can see within 30 feet of the spell's
    // sensor" / "through the sensor on one of those creatures" - and no trigger says either thing,
    // so the derived buttons had no prerequisite at all. What was measured before removal, and what
    // this guard exists to stop coming back: the Telepathy orb's Suggestion derived
    // `{save: {wis, 17}, uses: {limit: 1, per: "long-rest"}}` and, resolved at a foe in melee,
    // wrote `pendingSaves[0].conditionId === "charmed"` - `conditionFrom` reading "Charmed" out of
    // Suggestion's own description - which a committed failing save then applied.
    const definition = definitionOf();
    for (const [id, name, spell] of [
      ["crystal-ball-of-telepathy", "Crystal Ball of Telepathy", "suggestion"],
      ["crystal-ball-of-mind-reading", "Crystal Ball of Mind Reading", "detect-thoughts"]
    ] as const) {
      const row = view.equipmentRecord(id)!;
      expect(row.casts.map((cast) => cast.spellId)).toEqual(["scrying"]);
      const state = fight(stateWith([carried(id, name)]));
      const actions = effectiveActions(definition, state.actors[0], catalog);
      expect(actions.find((entry) => entry.id === `item-${id}-cast-${spell}`)).toBeUndefined();
      // The orb's OWN printed, ungated Scrying is untouched and still unlimited.
      expect(actions.find((entry) => entry.id === `item-${id}-cast-scrying`)!.uses).toBeUndefined();
    }
    // And the shipped prose still carries the gate, so a GM reads what the button cannot enforce.
    expect(view.equipmentRecord("crystal-ball-of-telepathy")!.description).toContain("through the sensor on one of those creatures");
    expect(view.equipmentRecord("crystal-ball-of-mind-reading")!.description).toContain("within 30 feet of the spell's sensor");
  });

  it("shares ONE three-charge pool across the Cubic Gate's two spells, and hands the Sending Stones one a day", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("cubic-gate", "Cubic Gate")]));
    const actions = effectiveActions(definition, state.actors[0], catalog);
    for (const spell of ["gate", "plane-shift"]) {
      const cast = actions.find((entry) => entry.id === `item-cubic-gate-cast-${spell}`)!;
      expect(cast.uses).toEqual({ limit: 3, per: "long-rest", pool: "cubic-gate-charges" });
      expect(cast.damage).toEqual([]);
      expect(cast.save).toBeUndefined();
      expect(cast.attack).toBeUndefined();
    }
    // ONE pool: casting Gate spends the charge Plane Shift would have used.
    resolveDefinitionAction(state, actions.find((entry) => entry.id === "item-cubic-gate-cast-gate")!, { actorId: IDS.hero, targetIds: [], commandId: cmd(13) }, deps([], definition));
    expect(state.actors[0].actionUses["cubic-gate-charges"]).toBe(1);

    const stones = fight(stateWith([carried("sending-stones", "Sending Stones")]));
    const sending = effectiveActions(definition, stones.actors[0], catalog).find((entry) => entry.id === "item-sending-stones-cast-sending")!;
    expect(sending.uses).toEqual({ limit: 1, per: "long-rest", pool: "sending-stones-charges" });
    expect(sending.damage).toEqual([]);
    expect(sending.save).toBeUndefined();
    expect(sending.attack).toBeUndefined();
  });
});

describe("C7d: a save with no charge behind it, because the SRD prints no limit", () => {
  it("gives the Rope of Entanglement an unlimited DC 15 Dex save that names Restrained", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("rope-of-entanglement", "Rope of Entanglement", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-rope-of-entanglement-entangle")!;
    expect(action.save).toEqual({ ability: "dex", dc: 15 });
    expect(action.uses).toBeUndefined(); // unlimited IS the printed item
    expect(action.damage).toEqual([]);   // D5: no damage authored, so no half-on-success to misread

    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(14) }, deps([], definition));
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "dex", dc: 15, conditionId: "restrained" });
  });

  it("gives the Iron Flask a DC 17 Wis save and applies NO condition - nothing spurious off the prose", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("iron-flask", "Iron Flask", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-iron-flask-trap")!;
    expect(action.save).toEqual({ ability: "wis", dc: 17 });
    expect(action.damage).toEqual([]);

    resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(15) }, deps([], definition));
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 17, conditionId: null });
  });
});

// -------------------------------------------------------------------------------------------------
// THE SALVAGE GUARD - the 77 absences, pinned so no later pass can quietly author one
// -------------------------------------------------------------------------------------------------

describe("C7d: the lane's counts, measured against the shipped bundle rather than asserted", () => {
  it("owns 95 rows - 71 carried wondrous and 24 consumables - and the scroll is not one of them", () => {
    expect(LANE_ROWS).toHaveLength(95);
    expect(LANE_ROWS.filter((row) => row.category === "wondrous-item")).toHaveLength(71);
    expect(LANE_ROWS.filter((row) => row.category === "consumable")).toHaveLength(24);
    expect(LANE_ROWS.filter((row) => row.attunement?.required === true)).toHaveLength(15);
    const lane = ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7d")!;
    expect(lane.slots).toEqual(["wondrous", "consumable"]);
  });

  it("pins the one row no lane-level check separates - `spell-scroll`, which NEITHER lane authors", () => {
    // `index.ts`'s header states this hole; this is the guard on it. C7b and C7d both declare the
    // `consumable` category, C7b declares no `slots`, and the scroll's slot IS `consumable` - so
    // both lanes pass every lane-level check for it. The duplicate-id refusal cannot help, because
    // C7b records the scroll as a named ABSENCE rather than authoring it. What keeps it safe today
    // is that neither lane has an entry, and that is what this asserts.
    const scroll = loadMagicItems().find((row) => row.id === "spell-scroll")!;
    expect({ category: scroll.category, slot: scroll.slot }).toEqual({ category: "consumable", slot: "consumable" });
    for (const name of ["C7b", "C7d"]) {
      expect({ name, claims: Object.keys(ITEM_MECHANICS_LANES.find((entry) => entry.lane === name)!.entries).includes("spell-scroll") })
        .toEqual({ name, claims: false });
    }
    expect(ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7b")!.slots).toBeUndefined();
  });

  it("authors 18 and leaves 77 as prose - and the 18 are exactly the module's list", () => {
    const lane = ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7d")!;
    expect(Object.keys(lane.entries).sort()).toEqual([
      "bag-of-tricks", "bowl-of-commanding-water-elementals", "brazier-of-commanding-fire-elementals",
      "censer-of-controlling-air-elementals", "crystal-ball", "crystal-ball-of-mind-reading",
      "crystal-ball-of-telepathy", "crystal-ball-of-true-seeing", "cubic-gate", "gem-of-seeing",
      "iron-bands", "iron-flask", "pipes-of-haunting", "pipes-of-the-sewers", "rope-of-entanglement",
      "sending-stones", "stone-of-controlling-earth-elementals", "stone-of-good-luck-luckstone"
    ]);
    // The bundle agrees: 18 rows carry a rider and 77 do not.
    expect(LANE_ROWS.filter(carries)).toHaveLength(18);
    expect(LANE_ROWS.filter((row) => !carries(row))).toHaveLength(77);
    // THE ONE ARITHMETIC CLAIM IN THE MODULE HEADER THAT IS CHECKABLE. Its six-way split of the 77
    // used to sum to 78; the residual group was 39 and is 38, derived from these two numbers. The
    // editorial groups themselves are not pinnable - a row can move between "over-grant" and "no
    // vocabulary" with nothing failing, and the header now says so - but their TOTAL is.
    const absent = LANE_ROWS.filter((row) => !carries(row));
    expect({
      consumables: absent.filter((row) => row.category === "consumable").length,
      carriedWondrous: absent.filter((row) => row.category === "wondrous-item").length
    }).toEqual({ consumables: 24, carriedWondrous: 53 });
  });

  it("D1: NOT ONE of the 24 consumables carries a rider, because a consumed item is unsayable", () => {
    const consumables = LANE_ROWS.filter((row) => row.category === "consumable");
    expect(consumables).toHaveLength(24);
    expect(consumables.filter(carries).map((row) => row.id)).toEqual([]);
  });

  it("owns `cursed` and authors none - and could not have, since no lane row requires attunement AND prints a curse", () => {
    expect(LANE_ROWS.filter((row) => row.cursed).map((row) => row.id)).toEqual([]);
    // `mysterious-deck` is the lane's only row whose prose says "cursed", it is RESERVED for U32,
    // and `schemas.ts` would refuse a curse on it anyway: it requires no attunement.
    const deck = LANE_ROWS.find((row) => row.id === "mysterious-deck")!;
    expect(deck.attunement?.required).toBe(false);
    expect(carries(deck)).toBe(false);
  });
});

describe("C7d: the absences that were measured and must stay absent", () => {
  it("the briefed far end - Potion of Resistance - carries no rider, because 'for 1 hour' cannot be said", () => {
    const potion = view.equipmentRecord("potion-of-resistance")!;
    expect(potion.description).toContain("Resistance to one type of damage for 1 hour");
    // D3: an item's `effects` rider would stand while the bottle is merely carried.
    expect(potion.effects).toEqual([]);
    // and nothing else was reached for either.
    expect(potion.grants).toBeUndefined();
    expect(potion.actions).toEqual([]);
    expect(potion.casts).toEqual([]);
    expect(potion.modifiers).toEqual([]);
    // Its expensive sibling fails the same way and must not be authored either.
    const invulnerability = view.equipmentRecord("potion-of-invulnerability")!;
    expect(invulnerability.effects).toEqual([]);
    expect(invulnerability.grants).toBeUndefined();
  });

  it("D6: every row whose printed effect restores or grants hit points is prose", () => {
    for (const id of ["potions-of-healing", "potion-of-vitality", "ioun-stone", "dragon-orb", "potion-of-heroism", "bag-of-beans"]) {
      const row = view.equipmentRecord(id)!;
      expect({ id, carries: carries(row) }).toEqual({ id, carries: false });
    }
  });

  it("D5: the two rows whose save-or-damage sentence the engine misreads carry no damage action", () => {
    // `halfOnSuccessFrom` reads both as "half on a success"; the SRD gives neither any damage there.
    for (const id of ["decanter-of-endless-water", "bead-of-force"]) {
      expect(view.equipmentRecord(id)!.actions).toEqual([]);
    }
    // The Horn of Blasting is the ONE the reader gets right, and it is absent for its 20% explosion.
    const horn = view.equipmentRecord("horn-of-blasting")!;
    expect(horn.description).toContain("20 percent chance of causing the horn to explode");
    expect(carries(horn)).toBe(false);
  });

  it("the seven ability-score refusals in this lane stay prose, and so do the reserved and multi-cost rows", () => {
    // Pre-ruled: `ability-score` is refused on an item carrier. One potion, three manuals, three tomes.
    for (const id of ["potion-of-giant-strength", "manual-of-bodily-health", "manual-of-gainful-exercise",
      "manual-of-quickness-of-action", "tome-of-clear-thought", "tome-of-leadership-and-influence", "tome-of-understanding"]) {
      expect({ id, carries: carries(view.equipmentRecord(id)!) }).toEqual({ id, carries: false });
    }
    // RESERVED for U32, and the two whose charge table costs more than one charge per use (C7b's L1).
    for (const id of ["mysterious-deck", "cube-of-force", "dragon-orb", "gem-of-brightness", "pearl-of-power"]) {
      expect({ id, carries: carries(view.equipmentRecord(id)!) }).toEqual({ id, carries: false });
    }
  });
});
