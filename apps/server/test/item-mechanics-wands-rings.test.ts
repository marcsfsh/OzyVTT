import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";

// Wands, staffs, rods, rings and the scroll (the wands section of `item-mechanics/items.ts`), driven
// through the real `ContentLibrary` over the committed `magic-items.v1.json`, so an unmerged rider, a
// renamed item id or a dangling `spellId` fails here. Assertions are numbers a player acts on or
// refusals they read. A Wand of Fireballs spends a charge, rolls Fireball's 8d6 against the printed
// DC 15, and refuses by name once the charges are gone. The last two describes pin entries left out
// or trimmed because they produced the wrong effect at the table; `item-mechanics-shared.test.ts`
// holds every cast to the spells a cast can say.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** A Wizard 5 with no spellcasting block, so an item's printed DC is visibly the item's. */
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
    now: () => "2026-08-11T00:00:00.000Z",
    definition,
    catalog
  };
}

const cmd = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
/** A fresh action slot: the charge pool is under test. */
const newTurn = (state: GameState) => {
  state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };
};

const WAND_ROW = {
  id: "wand-of-fireballs",
  name: "Wand of Fireballs",
  quantity: 1,
  equipped: true,
  attuned: true,
  category: "wand"
};
const CAST_ID = "item-wand-of-fireballs-cast-fireball";
const CHARGES = "wand-of-fireballs-charges";

describe("a Wand of Fireballs spends a charge, rolls real damage, and refuses at zero", () => {
  it("carries the authored cast out of the COMMITTED bundle, through the real content library", () => {
    // The first link: if the overlay did not merge, this fails.
    const record = view.equipmentRecord("wand-of-fireballs")!;
    // No `atLevel`: it would equal Fireball's own level. Up to 3 charges cast it up to level 5.
    expect(record.casts).toEqual([
      {
        spellId: "fireball",
        saveDc: 15,
        chargesRaiseLevel: 3,
        consumesSpellSlot: false,
        uses: { limit: 7, per: "long-rest", pool: CHARGES }
      }
    ]);
  });

  it("rolls Fireball's own 8d6 at the wand's printed DC 15, and debits one of seven charges", () => {
    const definition = definitionOf();
    const state = fight(stateWith([item(WAND_ROW)]));
    const actor = state.actors[0];

    const cast = effectiveActions(definition, actor, catalog).find((entry) => entry.id === CAST_ID)!;
    expect(cast.name).toBe("Cast Fireball (Wand of Fireballs)");
    // The spell bundle supplies the dice and save ability; the item supplies the DC. The wielder has no
    // spellcasting block, so DC 15 can only come from the authored `saveDc`.
    expect(cast.damage).toEqual([{ formula: "8d6", type: "fire" }]);
    expect(cast.save).toEqual({ ability: "dex", dc: 15, successDamage: "half", failureConditions: [] });
    expect(cast.uses).toEqual({ limit: 7, per: "long-rest", pool: CHARGES });

    // The roll: eight d6 faces of 5 -> 40 Fire, offered to the target as a pending save.
    const resolution = resolveDefinitionAction(
      state,
      cast,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(1) },
      deps([5, 5, 5, 5, 5, 5, 5, 5], definition)
    );
    expect(resolution.damage).toEqual([{ formula: "8d6", type: "fire", total: 40 }]);
    expect(state.combat.pendingSaves[0]).toMatchObject({
      targetActorId: IDS.foe,
      ability: "dex",
      dc: 15,
      proposedDamage: 40,
      halfOnSuccess: true
    });
    // The charge is spent on the authored pool key.
    expect(actor.actionUses[CHARGES]).toBe(1);
  });

  it("REFUSES the eighth casting by name once the seven charges are gone", () => {
    const definition = definitionOf();
    const state = fight(stateWith([item(WAND_ROW)]));
    const actor = state.actors[0];
    const cast = effectiveActions(definition, actor, catalog).find((entry) => entry.id === CAST_ID)!;

    actor.actionUses = { [CHARGES]: 6 };
    newTurn(state);
    const last = resolveDefinitionAction(
      state,
      cast,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(2) },
      deps([1, 1, 1, 1, 1, 1, 1, 1, 12], definition)
    );
    expect(actor.actionUses[CHARGES]).toBe(7); // the seventh charge, still legal
    // The SRD's d20 for the last charge, rolled by the server after the damage dice.
    expect(last.warnings).toContain("Wand of Fireballs's last charge is spent; the d20 shows 12, so it keeps working.");

    newTurn(state);
    // The message names the wand and the pool it exhausted.
    expect(() =>
      resolveDefinitionAction(
        state,
        cast,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) },
        deps([1, 1, 1, 1, 1, 1, 1, 1], definition)
      )
    ).toThrow("Cast Fireball (Wand of Fireballs): no uses remaining (7/Long Rest).");
    // And nothing was rolled or spent on the refused press.
    expect(actor.actionUses[CHARGES]).toBe(7);

    // The pool re-arms on a Long Rest. Known over-recovery: the SRD recharges 1d6 + 1 at dawn, this
    // restores all seven.
    state.combat = { ...state.combat, active: false, initiative: [] };
    applyRest(state, IDS.hero, "long", () => definition, catalog);
    expect(actor.actionUses[CHARGES]).toBeUndefined();
  });

  it("offers the wand NOTHING before attunement: the negative control on the whole far end", () => {
    const definition = definitionOf();
    const unattuned = fight(stateWith([item({ ...WAND_ROW, attuned: false })]));
    expect(
      effectiveActions(definition, unattuned.actors[0], catalog).find((entry) => entry.id === CAST_ID)
    ).toBeUndefined();

    const unequipped = fight(stateWith([item({ ...WAND_ROW, equipped: false })]));
    expect(
      effectiveActions(definition, unequipped.actors[0], catalog).find((entry) => entry.id === CAST_ID)
    ).toBeUndefined();
  });
});

describe("the standing modifiers a ring authors", () => {
  const ROW = {
    id: "ring-of-protection",
    name: "Ring of Protection",
    quantity: 1,
    equipped: true,
    attuned: true,
    category: "ring"
  };

  it("moves the derived AC and the save the server ROLLS by one, and both revert when it comes off", () => {
    const definition = definitionOf();
    const worn = stateWith([item(ROW)]);
    const derivation = deriveEquipment(worn.actors[0], definition, catalog);
    expect(derivation.armorClass).toBe(1);
    // dex 14 (+2), no proficiency, +1 from the ring.
    expect(saveTotalFor(definition, worn.actors[0], "dex", derivation)).toBe(3);

    const state = fight(stateWith([item(ROW)]));
    createPendingSaves(state, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Blast",
      ability: "dex",
      dc: 14,
      targetIds: [IDS.hero],
      proposedDamage: 10,
      halfOnSuccess: true,
      conditionIds: [],
      newSaveId: () => "60000000-0000-4000-8000-000000000001",
      createdAt: 0
    });
    const outcome = answerSave(
      state,
      cmd(4),
      state.combat.pendingSaves[0].id,
      "roll",
      undefined,
      false,
      { role: "gm" },
      {
        random: () => 11,
        newRollId: () => "40000000-0000-4000-8000-000000000000",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-11T00:00:00.000Z",
        resolveDefinition: () => definition,
        catalog
      }
    );
    // d20 = 11, +2 DEX, +1 ring = 14, which meets the DC. Without the ring it is 13 and a fail.
    expect(outcome.outcome).toMatchObject({ total: 14, success: true });

    const off = stateWith([item({ ...ROW, equipped: false })]);
    const bare = deriveEquipment(off.actors[0], definition, catalog);
    expect(bare.armorClass).toBe(0);
    expect(saveTotalFor(definition, off.actors[0], "dex", bare)).toBe(2);
  });
});

describe("an item action with a printed DC, a condition read off its prose, and a daily counter", () => {
  const ROW = {
    id: "rod-of-rulership",
    name: "Rod of Rulership",
    quantity: 1,
    equipped: true,
    attuned: true,
    category: "rod"
  };

  it("holds the target to DC 15 Wisdom, names Charmed on the prompt, and refuses the second use in a day", () => {
    const definition = definitionOf();
    const state = fight(stateWith([item(ROW)]));
    const actor = state.actors[0];
    const action = effectiveActions(definition, actor, catalog).find(
      (entry) => entry.id === "item-rod-of-rulership-command-obedience"
    )!;
    // Charmed for 8 hours, ended early by harm from its user's side.
    expect(action.save).toEqual({
      ability: "wis",
      dc: 15,
      successDamage: "none",
      failureConditions: ["charmed"],
      failureDuration: { type: "minutes", minutes: 480 },
      endsOnSourceSideDamage: true
    });
    expect(action.uses).toEqual({ limit: 1, per: "long-rest" });

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(5) },
      deps([], definition)
    );
    // The prompt carries the condition the action's save block declares.
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 15, conditionIds: ["charmed"] });

    newTurn(state);
    expect(() =>
      resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(6) },
        deps([], definition)
      )
    ).toThrow("Command Obedience: no uses remaining (1/Long Rest).");
  });
});

describe("a staff's resistance and its shared charge pool", () => {
  const ROW = {
    id: "staff-of-fire",
    name: "Staff of Fire",
    quantity: 1,
    equipped: true,
    attuned: true,
    category: "staff"
  };

  it("grants Fire resistance by name and casts Burning Hands off the 10-charge pool", () => {
    const definition = definitionOf();
    const state = fight(stateWith([item(ROW)]));
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    expect(derivation.damageResistances).toEqual([{ id: "fire", source: "Staff of Fire" }]);

    const cast = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-staff-of-fire-cast-burning-hands"
    )!;
    expect(cast.damage).toEqual([{ formula: "3d6", type: "fire" }]);
    expect(cast.uses).toEqual({ limit: 10, per: "long-rest", pool: "staff-of-fire-charges" });
    resolveDefinitionAction(
      state,
      cast,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(7) },
      deps([4, 4, 4], definition)
    );
    expect(state.actors[0].actionUses["staff-of-fire-charges"]).toBe(1);
  });

  it("shares ONE pool across three casts on the Staff of Charming: the second cast sees the first's spend", () => {
    const definition = definitionOf();
    const state = fight(
      stateWith([
        item({
          id: "staff-of-charming",
          name: "Staff of Charming",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "staff"
        })
      ])
    );
    const actor = state.actors[0];
    const actions = effectiveActions(definition, actor, catalog);
    const ids = actions
      .filter((entry) => entry.uses?.pool === "staff-of-charming-charges")
      .map((entry) => entry.id)
      .sort();
    expect(ids).toEqual([
      "item-staff-of-charming-cast-charm-person",
      "item-staff-of-charming-cast-command",
      "item-staff-of-charming-cast-comprehend-languages"
    ]);

    actor.actionUses = { "staff-of-charming-charges": 9 };
    const last = resolveDefinitionAction(
      state,
      actions.find((entry) => entry.id === "item-staff-of-charming-cast-command")!,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(8) },
      deps([2], definition)
    );
    expect(actor.actionUses["staff-of-charming-charges"]).toBe(10);
    // The last charge rolls a d20; above 1 the staff keeps working (a 1 destroys it, item-charge-costs.test.ts).
    expect(last.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Staff of Charming's last charge is spent; the d20 shows 2/)])
    );

    newTurn(state);
    // A different cast on the same pool is refused too: one pool.
    expect(() =>
      resolveDefinitionAction(
        state,
        actions.find((entry) => entry.id === "item-staff-of-charming-cast-charm-person")!,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(9) },
        deps([], definition)
      )
    ).toThrow(/no uses remaining \(10\/Long Rest\)/);
  });
});

describe("a held item's bonus to spell attack rolls", () => {
  it("is authored on the wands, staffs and talismans that print it", () => {
    for (const [id, amount] of [
      ["wand-of-the-war-mage-1", 1],
      ["wand-of-the-war-mage-2", 2],
      ["wand-of-the-war-mage-3", 3],
      ["staff-of-the-magi", 2],
      ["staff-of-the-woodlands", 2],
      ["staff-of-power", 2],
      ["talisman-of-pure-good", 2],
      ["talisman-of-ultimate-evil", 2]
    ] as const)
      expect(view.equipmentRecord(id)!.modifiers, id).toContainEqual({ type: "spell-attack-bonus", amount });
    // A ring that prints no such bonus gets none: the Ring of Warmth only takes 2d8 off Cold damage.
    const warmth = view.equipmentRecord("ring-of-warmth")!;
    expect(warmth.category).toBe("ring");
    expect(warmth.modifiers.map((modifier) => modifier.type)).toEqual(["damage-reduction"]);
  });

  it("lands on its holder's spell attacks and on no weapon swing", () => {
    const fireBolt = {
      id: "spell-fire-bolt",
      name: "Fire Bolt",
      activation: "action",
      description: "A spell attack.",
      spellId: "fire-bolt",
      attack: { bonus: 6, rangeFeet: 120 },
      damage: [{ formula: "2d10", type: "fire" }]
    };
    const dagger = {
      ...fireBolt,
      id: "dagger",
      name: "Dagger",
      spellId: undefined,
      attack: { bonus: 5, reachFeet: 5 }
    };
    const definition = definitionOf({ actions: [fireBolt, dagger] });
    const state = fight(
      stateWith([
        item({
          id: "wand-of-the-war-mage-2",
          name: "Wand of the War Mage, +2",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "wand"
        })
      ])
    );
    const bonusOf = (id: string) =>
      effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === id)!.attack!.bonus;
    expect(bonusOf("spell-fire-bolt")).toBe(8);
    expect(bonusOf("dagger")).toBe(5);
  });
});

describe("the whole-entry absences are absent at the engine", () => {
  /** Equipped and attuned, so every gate is open and only the absence explains the result. */
  const worn = (id: string, name: string, category: string) =>
    fight(stateWith([item({ id, name, quantity: 1, equipped: true, attuned: true, category })]));

  // `grants.conditionImmunities` has no source filter, so an authored immunity would refuse non-magical
  // paralysis (a Ghoul's Claw, a Giant Spider's Web) that the SRD lets land ("Magic can neither... cause
  // you to have the Paralyzed or Restrained condition"). With the ring worn, a non-magical Paralyzed lands.
  it("lets a non-magical Paralyzed land on the wearer of a Ring of Free Action", () => {
    const definition = definitionOf();
    const state = worn("ring-of-free-action", "Ring of Free Action", "ring");
    const actor = state.actors[0];
    expect(deriveEquipment(actor, definition, catalog).conditionImmunities).toEqual([]);

    const narration = setCondition(
      state,
      IDS.hero,
      "paralyzed",
      true,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => definition, catalog }
    );
    expect(actor.conditions.map((condition) => condition.id)).toContain("paralyzed");
    expect(narration.map((event) => event.text).join(" ")).not.toContain("immune");
  });
});

describe("the staffs that cast at their printed charge costs", () => {
  it("gives Staff of Power its AC and saving-throw halves and its spells at their charge costs", () => {
    const definition = definitionOf();
    const state = fight(
      stateWith([
        item({
          id: "staff-of-power",
          name: "Staff of Power",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "staff"
        })
      ])
    );
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    // +2 to the derived AC and to the save the server rolls.
    expect(derivation.armorClass).toBe(2);
    expect(saveTotalFor(definition, state.actors[0], "dex", derivation)).toBe(4);
    const casts = effectiveActions(definition, state.actors[0], catalog).filter((entry) =>
      entry.id.startsWith("item-staff-of-power-cast-")
    );
    expect(casts.map((entry) => [entry.id, entry.useCost ?? 1, entry.uses?.limit])).toContainEqual([
      "item-staff-of-power-cast-fireball",
      5,
      20
    ]);
    expect(casts).toHaveLength(9);
    // It swings as a magic Quarterstaff too, in one hand or two, and can be thrown as an improvised weapon.
    expect(
      effectiveActions(definition, state.actors[0], catalog)
        .filter((entry) => entry.id.startsWith("item-staff-of-power") && !entry.id.includes("-cast-"))
        .map((entry) => entry.id)
        .sort()
    ).toEqual(["item-staff-of-power", "item-staff-of-power-thrown-improvised", "item-staff-of-power-two-handed"]);
  });

  it("leaves Staff of the Magi its at-will casts and Ring of Shooting Stars its casts and its own actions", () => {
    const definition = definitionOf();
    const magi = fight(
      stateWith([
        item({
          id: "staff-of-the-magi",
          name: "Staff of the Magi",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "staff"
        })
      ])
    );
    // The zero-charge casts spend nothing; the rest share the 50 charges.
    expect(
      effectiveActions(definition, magi.actors[0], catalog)
        .filter((entry) => entry.id.startsWith("item-staff-of-the-magi-cast-") && entry.uses === undefined)
        .map((entry) => entry.id)
        .sort()
    ).toEqual([
      "item-staff-of-the-magi-cast-arcane-lock",
      "item-staff-of-the-magi-cast-detect-magic",
      "item-staff-of-the-magi-cast-enlargereduce",
      "item-staff-of-the-magi-cast-light",
      "item-staff-of-the-magi-cast-protection-from-evil-and-good"
    ]);

    const ring = fight(
      stateWith([
        item({
          id: "ring-of-shooting-stars",
          name: "Ring of Shooting Stars",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "ring"
        })
      ])
    );
    const actions = effectiveActions(definition, ring.actors[0], catalog).filter((entry) =>
      entry.id.startsWith("item-ring-of-shooting-stars-")
    );
    expect(actions.map((entry) => entry.id).sort()).toEqual([
      "item-ring-of-shooting-stars-cast-dancing-lights",
      "item-ring-of-shooting-stars-cast-faerie-fire",
      "item-ring-of-shooting-stars-cast-light",
      "item-ring-of-shooting-stars-lightning-spheres",
      "item-ring-of-shooting-stars-shooting-stars"
    ]);
    // Shooting Stars is the ring's own printed effect: DC 15, 5d4 Radiant.
    const stars = actions.find((entry) => entry.id === "item-ring-of-shooting-stars-shooting-stars")!;
    expect(stars.save).toEqual({ ability: "dex", dc: 15, successDamage: "half", failureConditions: [] });
    expect(stars.damage).toEqual([{ formula: "5d4", type: "radiant" }]);
    // None of the surviving actions carries an attack roll.
    expect(actions.filter((entry) => entry.attack !== undefined)).toEqual([]);
  });

  it("keeps the Ring of Animal Influence's printed DC 13 on the two casts that HAVE a save, and nowhere else", () => {
    const definition = definitionOf();
    const state = fight(
      stateWith([
        item({
          id: "ring-of-animal-influence",
          name: "Ring of Animal Influence",
          quantity: 1,
          equipped: true,
          attuned: true,
          category: "ring"
        })
      ])
    );
    const actions = effectiveActions(definition, state.actors[0], catalog).filter((entry) =>
      entry.id.startsWith("item-ring-of-animal-influence-")
    );
    expect(actions).toHaveLength(3);
    const dcOf = (spellId: string) => actions.find((entry) => entry.id.endsWith(`cast-${spellId}`))!.save;
    expect(dcOf("animal-friendship")).toEqual({
      ability: "wis",
      dc: 13,
      successDamage: "none",
      failureConditions: ["charmed"],
      endsOnSourceSideDamage: true
    });
    expect(dcOf("fear")).toEqual({
      ability: "wis",
      dc: 13,
      successDamage: "none",
      failureConditions: ["frightened"],
      // Fear's own failure: the creature drops what it is holding, and Dashes away on each of its turns.
      failureEffect: {
        name: "Fear",
        tags: ["drops-held", "dash-only"],
        modifiers: [],
        compelled: { way: "away", dashes: true, minFeet: 5 }
      },
      repeatUnseenSource: true
    });
    // Speak with Animals forces no save, so a `saveDc` would have no reader.
    expect(dcOf("speak-with-animals")).toBeUndefined();
    expect(
      view.equipmentRecord("ring-of-animal-influence")!.casts.find((cast) => cast.spellId === "speak-with-animals")!
        .saveDc
    ).toBeUndefined();
  });
});
