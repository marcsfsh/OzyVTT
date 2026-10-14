import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
// The lane list is authoring-side and outside the package's `exports` map, so it is imported by path;
// this file checks that the composed lane and the committed bundle agree.
import { ITEM_MECHANICS_LANES } from "../../../packages/content-srd-5.2.1/scripts/item-mechanics/index.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerSave, createPendingSaves, saveTotalFor } from "../src/saving-throws.js";
import { startEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";

// Wands, staffs, rods, rings and the scroll (`wands-rods-rings.ts`), driven through the real
// `ContentLibrary` over the committed `magic-items.v1.json`, so an unmerged rider, a renamed item id
// or a dangling `spellId` fails here. Assertions are numbers a player acts on or refusals they read.
// A Wand of Fireballs spends a charge, rolls Fireball's 8d6 against the printed DC 15, and refuses by
// name once the charges are gone. The last two describes pin casts and entries that were removed
// because they produced the wrong effect at the table.

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
/** A fresh action slot: the charge pool is under test, not the action economy. */
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

describe("C7b far end: a Wand of Fireballs spends a charge, rolls real damage, and refuses at zero", () => {
  it("carries the authored cast out of the COMMITTED bundle, through the real content library", () => {
    // The first link: if the overlay did not merge, this fails.
    const record = view.equipmentRecord("wand-of-fireballs")!;
    // No `atLevel`: it would equal Fireball's own level, and `castAction` only reads it when it is higher.
    expect(record.casts).toEqual([
      {
        spellId: "fireball",
        saveDc: 15,
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
    expect(cast.save).toEqual({ ability: "dex", dc: 15 });
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
    // The charge is spent on the authored pool key, not the action id.
    expect(actor.actionUses[CHARGES]).toBe(1);
  });

  it("REFUSES the eighth casting by name once the seven charges are gone", () => {
    const definition = definitionOf();
    const state = fight(stateWith([item(WAND_ROW)]));
    const actor = state.actors[0];
    const cast = effectiveActions(definition, actor, catalog).find((entry) => entry.id === CAST_ID)!;

    actor.actionUses = { [CHARGES]: 6 };
    newTurn(state);
    resolveDefinitionAction(
      state,
      cast,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(2) },
      deps([1, 1, 1, 1, 1, 1, 1, 1], definition)
    );
    expect(actor.actionUses[CHARGES]).toBe(7); // the seventh charge, still legal

    newTurn(state);
    // The message names the wand and the pool it exhausted.
    expect(() =>
      resolveDefinitionAction(
        state,
        cast,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) },
        deps([1, 1, 1, 1, 1, 1, 1, 1], definition)
      )
    ).toThrow("Cast Fireball (Wand of Fireballs): no uses remaining (7/long rest).");
    // And nothing was rolled or spent on the refused press.
    expect(actor.actionUses[CHARGES]).toBe(7);

    // The pool re-arms on a long rest. Known over-recovery: the SRD recharges 1d6 + 1 at dawn, this
    // restores all seven.
    state.combat = { ...state.combat, active: false, initiative: [] };
    applyRest(state, IDS.hero, "long", () => definition, catalog);
    expect(actor.actionUses[CHARGES]).toBeUndefined();
  });

  it("offers the wand NOTHING before attunement - the negative control on the whole far end", () => {
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

describe("C7b: the standing modifiers a ring authors", () => {
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
      conditionId: null,
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

describe("C7b: an item action with a printed DC, a condition read off its prose, and a daily counter", () => {
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
    expect(action.save).toEqual({ ability: "wis", dc: 15 });
    expect(action.uses).toEqual({ limit: 1, per: "long-rest" });

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(5) },
      deps([], definition)
    );
    // The condition is not an authored field: `conditionFrom` reads it from the description.
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 15, conditionId: "charmed" });

    newTurn(state);
    expect(() =>
      resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(6) },
        deps([], definition)
      )
    ).toThrow("Command Obedience: no uses remaining (1/long rest).");
  });
});

describe("C7b: a staff's resistance and its shared charge pool", () => {
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
    expect(derivation.damageResistances).toEqual([{ id: "fire", sourceItemId: "staff-of-fire" }]);

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

  it("shares ONE pool across three casts on the Staff of Charming - the second cast sees the first's spend", () => {
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
    resolveDefinitionAction(
      state,
      actions.find((entry) => entry.id === "item-staff-of-charming-cast-command")!,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(8) },
      deps([], definition)
    );
    expect(actor.actionUses["staff-of-charming-charges"]).toBe(10);

    newTurn(state);
    // A different cast on the same pool is refused too: one pool.
    expect(() =>
      resolveDefinitionAction(
        state,
        actions.find((entry) => entry.id === "item-staff-of-charming-cast-charm-person")!,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(9) },
        deps([], definition)
      )
    ).toThrow(/no uses remaining \(10\/long rest\)/);
  });
});

describe("C7b: the lane authors what it claims to author", () => {
  const lane = ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7b")!;

  it("is composed into ITEM_MECHANICS_LANES with its own categories", () => {
    expect(lane).toBeDefined();
    expect([...lane.categories].sort()).toEqual(["consumable", "ring", "rod", "staff", "wand"]);
  });

  it("keys 27 real magic items, every one inside the lane's own categories", () => {
    const ids = Object.keys(lane.entries);
    expect(ids).toHaveLength(27);
    for (const id of ids) {
      const record = view.equipmentRecord(id);
      expect(record, `${id} is keyed by C7b but no bundle row carries that id`).toBeDefined();
      expect(lane.categories, `${id} is a "${record!.category}"`).toContain(record!.category);
    }
  });

  it("landed every authored rider on the COMMITTED bundle - not one entry merged to nothing", () => {
    // The build refuses an empty rider; this checks the build was run and its output committed, so a
    // module edited without regenerating fails here.
    for (const [id, mechanics] of Object.entries(lane.entries)) {
      const record = view.equipmentRecord(id)!;
      for (const key of Object.keys(mechanics) as ReadonlyArray<"casts" | "actions" | "modifiers" | "grants">) {
        const landed = record[key];
        const populated = Array.isArray(landed)
          ? landed.length > 0
          : landed !== undefined && Object.keys(landed as object).length > 0;
        expect(
          populated,
          `${id}.${key} is authored in the module but empty in magic-items.v1.json - regenerate the bundle`
        ).toBe(true);
      }
    }
  });

  it("reserves U26's spell-attack-bonus rather than authoring it inert", () => {
    // These carriers need a reader that does not exist yet; `applyItemMechanics` refuses the rider at
    // build time, and this asserts the output.
    for (const id of [
      "wand-of-the-war-mage-1",
      "wand-of-the-war-mage-2",
      "wand-of-the-war-mage-3",
      "staff-of-the-magi",
      "staff-of-the-woodlands",
      "staff-of-power"
    ]) {
      const record = view.equipmentRecord(id)!;
      expect(
        record.modifiers.map((modifier) => modifier.type),
        id
      ).not.toContain("spell-attack-bonus");
    }
    // Staff of Power's AC and saving-throw halves are readable and authored, from the same sentence.
    expect(
      view
        .equipmentRecord("staff-of-power")!
        .modifiers.map((modifier) => modifier.type)
        .sort()
    ).toEqual(["armor-class", "save-bonus"]);
    // Ring of Warmth is a Ring, so it is this lane's absence.
    const warmth = view.equipmentRecord("ring-of-warmth")!;
    expect(warmth.category).toBe("ring");
    expect(warmth.modifiers).toEqual([]);
  });
});

// Spells this lane may not cast, each with what the cast would have done. `castAction` reads
// `spell.damage.roll` as the cast's damage, `spell.damage.types[0] ?? "force"` as its type, and emits
// an `attack` block from `spell.attackRoll`; for these records those columns describe the spell's text
// rather than what one cast rolls at a target.
const REFUSED_CASTS: ReadonlyArray<readonly [string, string]> = [
  [
    "cure-wounds",
    "{roll: '2d8', types: []} -> a 2d8 FORCE damage action; a Staff of Healing would hit the ally it heals"
  ],
  [
    "heal",
    "{roll: null, types: []} -> no damage, no save, no attack: a Rod of Resurrection that restores nothing and debits a charge"
  ],
  ["magic-missile", "{roll: '1d4 + 1'} is ONE of the THREE darts the SRD prints - ~3.5 where the spell averages ~10.5"],
  ["web", "{roll: '2d4', types: ['fire']} is the damage of BURNING webs, and the cast rolls it on every press"],
  [
    "ray-of-enfeeblement",
    "attackRoll true + {roll: '1d8', types: []} -> a 1d8 Force SPELL ATTACK; the SRD prints neither, and the 1d8 is what the TARGET subtracts from its own damage rolls"
  ],
  ["protection-from-evil-and-good", "attackRoll true on a ward that rolls nothing at anybody"],
  ["faerie-fire", "attackRoll true on a spell whose only roll is the target's Dexterity save"]
];

describe("C7b salvage: the removed casts stay removed", () => {
  /** Lazy so that removing the lane from `index.ts` fails a named test instead of throwing during collection. */
  const authoredCasts = () => {
    const lane = ITEM_MECHANICS_LANES.find((entry) => entry.lane === "C7b");
    expect(lane, "no C7b lane is composed into ITEM_MECHANICS_LANES at all").toBeDefined();
    return Object.entries(lane!.entries).flatMap(([itemId, mechanics]) =>
      (mechanics.casts ?? []).map((cast) => ({ itemId, spellId: cast.spellId }))
    );
  };

  it("walks a real population - the two sweeps below are vacuous if this number is ever 0", () => {
    const authored = authoredCasts();
    expect(authored).toHaveLength(28);
    expect(new Set(authored.map((cast) => cast.itemId)).size).toBe(16);
  });

  it("names none of the seven spells whose record does not describe what a cast rolls", () => {
    const authored = authoredCasts();
    for (const [spellId, why] of REFUSED_CASTS) {
      const found = authored.filter((cast) => cast.spellId === spellId).map((cast) => cast.itemId);
      expect(found, `${spellId} is cast by ${found.join(", ")} and it must not be: ${why}`).toEqual([]);
    }
  });

  // Applied to every cast, not just the named list. A damage roll with an empty type set cannot say what
  // the cast rolls (those spells are a mix of healing, buffs, temporary hit points and choose-your-type),
  // and `castAction` would turn it into Force damage.
  it("names no spell whose damage roll carries no damage type", () => {
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId)!;
      expect(spell, `${cast.spellId} resolves to no spell record`).toBeDefined();
      const offends = spell.damage?.roll != null && (spell.damage?.types?.length ?? 0) === 0;
      expect(
        offends,
        `${cast.itemId} casts ${cast.spellId}, whose damage is ${JSON.stringify(spell.damage)} - castAction types an untyped roll as "force"`
      ).toBe(false);
    }
  });

  // The `attackRoll` column is set by any mention of an attack roll in the text, including other
  // creatures' attacks, so this lane may not rely on it.
  it("names no spell the record marks as an attack roll, while that column is untrustworthy", () => {
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId)!;
      expect(
        spell.attackRoll,
        `${cast.itemId} casts ${cast.spellId}, which the record marks attackRoll - castAction would hang an attack block on it`
      ).toBe(false);
    }
  });
});

describe("C7b salvage: the five whole-entry absences are absent AT THE ENGINE", () => {
  /** Equipped and attuned, so every gate is open and only the absence explains the result. */
  const worn = (id: string, name: string, category: string) =>
    fight(stateWith([item({ id, name, quantity: 1, equipped: true, attuned: true, category })]));

  it.each([
    ["staff-of-healing", "Staff of Healing", "staff"],
    ["rod-of-resurrection", "Rod of Resurrection", "rod"],
    ["wand-of-magic-missiles", "Wand of Magic Missiles", "wand"],
    ["wand-of-web", "Wand of Web", "wand"]
  ])("offers %s no action at all, so its wrong effect cannot be pressed", (id, name, category) => {
    const definition = definitionOf();
    const state = worn(id, name, category);
    const mine = effectiveActions(definition, state.actors[0], catalog).filter((entry) =>
      entry.id.startsWith(`item-${id}-`)
    );
    expect(
      mine.map((entry) => entry.name),
      `${name} still derives an action`
    ).toEqual([]);
    // And the row itself carries no rider: the absence is in the bundle.
    const record = view.equipmentRecord(id)!;
    expect({ casts: record.casts, actions: record.actions, modifiers: record.modifiers }).toEqual({
      casts: [],
      actions: [],
      modifiers: []
    });
  });

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

describe("C7b salvage: the two entries that lost a cast and kept the rest", () => {
  it("leaves Staff of Power its AC and saving-throw halves and NO cast at all", () => {
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
    // What remains: +2 to the derived AC and to the save the server rolls.
    expect(derivation.armorClass).toBe(2);
    expect(saveTotalFor(definition, state.actors[0], "dex", derivation)).toBe(4);
    // Both casts were removed, so the 20-charge pool has nothing drawing on it.
    expect(view.equipmentRecord("staff-of-power")!.casts).toEqual([]);
    expect(
      effectiveActions(definition, state.actors[0], catalog).filter((entry) =>
        entry.id.startsWith("item-staff-of-power-")
      )
    ).toEqual([]);
  });

  it("leaves Staff of the Magi four at-will casts and Ring of Shooting Stars its two cantrips and its own action", () => {
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
    expect(
      effectiveActions(definition, magi.actors[0], catalog)
        .filter((entry) => entry.id.startsWith("item-staff-of-the-magi-"))
        .map((entry) => entry.id)
        .sort()
    ).toEqual([
      "item-staff-of-the-magi-cast-arcane-lock",
      "item-staff-of-the-magi-cast-detect-magic",
      "item-staff-of-the-magi-cast-enlargereduce",
      "item-staff-of-the-magi-cast-light"
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
      "item-ring-of-shooting-stars-cast-light",
      "item-ring-of-shooting-stars-shooting-stars"
    ]);
    // Shooting Stars is the ring's own printed effect: DC 15, 5d4 Radiant.
    const stars = actions.find((entry) => entry.id === "item-ring-of-shooting-stars-shooting-stars")!;
    expect(stars.save).toEqual({ ability: "dex", dc: 15 });
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
    expect(dcOf("animal-friendship")).toEqual({ ability: "wis", dc: 13 });
    expect(dcOf("fear")).toEqual({ ability: "wis", dc: 13 });
    // Speak with Animals forces no save, so a `saveDc` would have no reader.
    expect(dcOf("speak-with-animals")).toBeUndefined();
    expect(
      view.equipmentRecord("ring-of-animal-influence")!.casts.find((cast) => cast.spellId === "speak-with-animals")!
        .saveDc
    ).toBeUndefined();
  });
});
