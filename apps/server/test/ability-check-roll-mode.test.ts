import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { checkRollMode } from "../src/ability-checks.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "../src/equipment-derivation.js";
import { testCatalog } from "./catalog-records.js";
import { startEncounter } from "../src/encounter.js";
import { addEffect } from "../src/effects.js";

// `roll-mode {roll: "check"}` must reach the die. A fixed pair (3 then 17) is queued into the
// resolver's `random` and each case asserts which face the check kept, going through
// `resolveDefinitionAction` with `equipmentCatalog()` as `action.resolve` does. `BOOTS` mirrors
// boots-of-elvenkind ("Advantage on Dexterity (Stealth) checks"), whose bundle row has `modifiers: []`.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const COMMAND = "50000000-0000-4000-8000-000000000001";

function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [],
    extensions: {},
    character: { classes: [{ id: "rogue", name: "Rogue", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [{ id: "stealth", proficiency: "proficient" }] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem =>
  InventoryItemSchema.parse({ id: "x", name: "X", ...over });

const catalogOf = (equipment: readonly object[]): EquipmentCatalog => testCatalog({ equipment });

function stateWith(inventory: InventoryItem[]): GameState {
  const state = GameStateSchema.parse({
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
        hp: { current: 40, maximum: 40 },
        armorClass: 12
      }
    ]
  });
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

/** Every case feeds the same two faces and asserts which one survived. */
function deps(faces: number[], catalog?: EquipmentCatalog, definition?: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-08-13T00:00:00.000Z",
    ...(definition ? { definition } : {}),
    ...(catalog ? { catalog } : {})
  };
}

/** Resolve one builtin action (Hide, Escape a Grapple) exactly as the `action.resolve` handler does. */
function resolveBuiltin(state: GameState, actionId: string, dependencies: ResolveDependencies, commandId = COMMAND) {
  return resolveDefinitionAction(
    state,
    builtinAction(actionId)!,
    {
      actorId: IDS.hero,
      targetIds: [],
      commandId,
      builtin: true,
      rollMode: null,
      override: null
    },
    dependencies
  );
}

const BOOTS_ROW = {
  id: "boots-of-elvenkind",
  name: "Boots of Elvenkind",
  quantity: 1,
  equipped: true,
  category: "wondrous-item"
};
/** The modifiers the boots-of-elvenkind bundle row should carry; it has `modifiers: []`. */
const BOOTS = {
  id: "boots-of-elvenkind",
  name: "Boots of Elvenkind",
  category: "wondrous-item",
  slot: "feet",
  isMagic: true,
  modifiers: [
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
  ]
};

describe("advantage on an ability check reaches the d20", () => {
  it("Boots of Elvenkind make Hide keep the HIGHER of 3 and 17", () => {
    const definition = definitionOf();
    const state = stateWith([item(BOOTS_ROW)]);
    const resolution = resolveBuiltin(state, "hide", deps([3, 17], catalogOf([BOOTS]), definition));

    // DEX 14 = +2, and Stealth proficiency adds PB 2: 17 + 4 = 21, which also clears Hide's DC 15.
    expect(resolution.check).toMatchObject({
      skill: "Dexterity (Stealth)",
      naturalRoll: 17,
      total: 21,
      dc: 15,
      success: true
    });
    expect(resolution.rollMode).toEqual({ mode: "advantage", advantage: ["Boots of Elvenkind"], disadvantage: [] });

    // The recorded roll shows two dice thrown and one kept.
    const record = state.rolls.find((roll) => roll.purpose === "check")!;
    expect(record.normalizedFormula).toBe("2d20kh1+4");
    expect(record.dice.map((die) => ({ face: die.face, kept: die.kept }))).toEqual([
      { face: 3, kept: false },
      { face: 17, kept: true }
    ]);
    expect(record.total).toBe(21);
  });

  it("takes the boots off and the SAME queue gives 3 - one die, no advantage, DC 15 missed", () => {
    const definition = definitionOf();
    const state = stateWith([item({ ...BOOTS_ROW, equipped: false })]);
    const resolution = resolveBuiltin(state, "hide", deps([3, 17], catalogOf([BOOTS]), definition));

    expect(resolution.check).toMatchObject({ naturalRoll: 3, total: 7, success: false });
    expect(resolution.rollMode).toBeUndefined();
    expect(state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe("1d20+4");
    // The success half moved with it: no Hiding effect, so nothing granted Invisible.
    expect(state.actors[0].effects).toEqual([]);
  });

  it("an item with no roll-mode rider rolls exactly as it does today (the backward-compatible case)", () => {
    const definition = definitionOf();
    const mundane = {
      id: "boots-of-elvenkind",
      name: "Boots of Elvenkind",
      category: "wondrous-item",
      slot: "feet",
      isMagic: true,
      modifiers: []
    };
    const state = stateWith([item(BOOTS_ROW)]);
    const resolution = resolveBuiltin(state, "hide", deps([3, 17], catalogOf([mundane]), definition));

    expect(resolution.check).toMatchObject({ naturalRoll: 3, total: 7 });
    expect(resolution.rollMode).toBeUndefined();
  });

  it("no catalog at all keeps the check on one die (the documented fail-open)", () => {
    const definition = definitionOf();
    const state = stateWith([item(BOOTS_ROW)]);
    const resolution = resolveBuiltin(state, "hide", deps([3, 17], undefined, definition));
    expect(resolution.check).toMatchObject({ naturalRoll: 3 });
  });
});

describe("which check the rider actually reaches", () => {
  it("does not touch a Wisdom (Search) check - `ability-is` and `skill-is` fail closed", () => {
    const definition = definitionOf();
    const state = stateWith([item(BOOTS_ROW)]);
    const resolution = resolveBuiltin(state, "search", deps([3, 17], catalogOf([BOOTS]), definition));
    // WIS 10 = +0, so the natural die is the whole total: 3 means one d20 was thrown.
    expect(resolution.check).toMatchObject({ skill: "Wisdom check", naturalRoll: 3, total: 3 });
    expect(resolution.rollMode).toBeUndefined();
  });

  it("a STANDING rider (no `when` at all) reaches every check - the moment-less half of the mirror", () => {
    const definition = definitionOf();
    const luckstone = {
      id: "stone-of-good-luck",
      name: "Stone of Good Luck",
      category: "wondrous-item",
      slot: "none",
      isMagic: true,
      modifiers: [{ type: "roll-mode", roll: "check", mode: "advantage" }]
    };
    const state = stateWith([
      item({
        id: "stone-of-good-luck",
        name: "Stone of Good Luck",
        quantity: 1,
        equipped: true,
        category: "wondrous-item"
      })
    ]);
    const resolution = resolveBuiltin(state, "study", deps([3, 17], catalogOf([luckstone]), definition));
    expect(resolution.check).toMatchObject({ skill: "Intelligence check", naturalRoll: 17 });
    expect(resolution.rollMode).toMatchObject({ mode: "advantage", advantage: ["Stone of Good Luck"] });
  });

  it("a disadvantage rider keeps the LOWER die, and advantage plus disadvantage cancel", () => {
    const definition = definitionOf();
    const cursed = {
      id: "clumsy-boots",
      name: "Clumsy Boots",
      category: "wondrous-item",
      slot: "feet",
      isMagic: true,
      cursed: true,
      attunement: { required: true },
      modifiers: [
        {
          type: "roll-mode",
          roll: "check",
          mode: "disadvantage",
          when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["dex"] }]
        }
      ]
    };
    const cursedRow = {
      id: "clumsy-boots",
      name: "Clumsy Boots",
      quantity: 1,
      equipped: true,
      attuned: true,
      category: "wondrous-item"
    };

    const down = resolveBuiltin(
      stateWith([item(cursedRow)]),
      "hide",
      deps([17, 3], catalogOf([cursed]), definitionOf())
    );
    expect(down.check).toMatchObject({ naturalRoll: 3, total: 7, success: false });
    expect(down.rollMode).toEqual({ mode: "disadvantage", advantage: [], disadvantage: ["Clumsy Boots"] });

    // 5e cancellation (aggregateRollMode): one of each is a plain d20, so only the first face is spent.
    const both = resolveBuiltin(
      stateWith([item(BOOTS_ROW), item(cursedRow)]),
      "hide",
      deps([17, 3], catalogOf([BOOTS, cursed]), definition)
    );
    expect(both.check).toMatchObject({ naturalRoll: 17, total: 21 });
    expect(both.rollMode).toBeUndefined();
  });

  it("an unattuned rider contributes nothing until attunement springs it", () => {
    const attunedBoots = {
      ...BOOTS,
      id: "cloak-of-elvenkind",
      name: "Cloak of Elvenkind",
      slot: "shoulders",
      attunement: { required: true }
    };
    const row = {
      id: "cloak-of-elvenkind",
      name: "Cloak of Elvenkind",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: "wondrous-item"
    };
    const before = resolveBuiltin(
      stateWith([item(row)]),
      "hide",
      deps([3, 17], catalogOf([attunedBoots]), definitionOf())
    );
    expect(before.check).toMatchObject({ naturalRoll: 3 });

    const after = resolveBuiltin(
      stateWith([item({ ...row, attuned: true })]),
      "hide",
      deps([3, 17], catalogOf([attunedBoots]), definitionOf())
    );
    expect(after.check).toMatchObject({ naturalRoll: 17 });
  });
});

describe("Escape a Grapple takes the same consumer", () => {
  const GAUNTLETS = {
    id: "gauntlets-of-ogre-power",
    name: "Gauntlets of Ogre Power",
    category: "wondrous-item",
    slot: "hands",
    isMagic: true,
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["athletics"] }]
      }
    ]
  };
  const ROW = {
    id: "gauntlets-of-ogre-power",
    name: "Gauntlets of Ogre Power",
    quantity: 1,
    equipped: true,
    category: "wondrous-item"
  };

  function grappled(inventory: InventoryItem[]): GameState {
    const state = stateWith(inventory);
    addEffect(state, IDS.hero, {
      id: "grapple",
      name: "Grappled",
      tags: [],
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      sourceActionId: null,
      startedRound: 1,
      duration: { type: "manual" },
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: false,
      concentration: false,
      modifiers: [],
      linkedConditionIds: ["grappled"],
      escapeDc: 13,
      onEnd: [],
      endsWithTag: null
    });
    return state;
  }

  it("keeps the higher die and breaks the grapple; without the gauntlets the same queue fails", () => {
    // STR 16 (+3) beats DEX 14 (+2), so Athletics is the winning branch and `skill-is` matches it.
    const won = grappled([item(ROW)]);
    const escaped = resolveBuiltin(won, "escape-grapple", deps([3, 17], catalogOf([GAUNTLETS]), definitionOf()));
    expect(escaped.check).toMatchObject({
      skill: "Strength (Athletics)",
      naturalRoll: 17,
      total: 20,
      dc: 13,
      success: true
    });
    expect(escaped.rollMode).toMatchObject({ mode: "advantage", advantage: ["Gauntlets of Ogre Power"] });
    expect(won.actors[0].effects).toEqual([]);

    const held = grappled([item({ ...ROW, equipped: false })]);
    const stuck = resolveBuiltin(held, "escape-grapple", deps([3, 17], catalogOf([GAUNTLETS]), definitionOf()));
    expect(stuck.check).toMatchObject({ naturalRoll: 3, total: 6, success: false });
    expect(held.actors[0].effects).toHaveLength(1);
  });

  it("an Acrobatics-only rider does not help the Athletics branch that actually rolled", () => {
    const acrobatic = {
      ...GAUNTLETS,
      modifiers: [
        {
          type: "roll-mode",
          roll: "check",
          mode: "advantage",
          when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["acrobatics"] }]
        }
      ]
    };
    const state = grappled([item(ROW)]);
    const resolution = resolveBuiltin(state, "escape-grapple", deps([3, 17], catalogOf([acrobatic]), definitionOf()));
    expect(resolution.check).toMatchObject({ naturalRoll: 3 });
  });
});

describe("checkRollMode narrows the way checkRiderBonus does", () => {
  it("matches on ability and skill, and stays normal when neither is named", () => {
    const state = stateWith([item(BOOTS_ROW)]);
    const derivation = deriveEquipment(state.actors[0], definitionOf(), catalogOf([BOOTS]));

    expect(checkRollMode(derivation, { ability: "dex", skill: "stealth" }).mode).toBe("advantage");
    expect(checkRollMode(derivation, { ability: "dex", skill: "acrobatics" }).mode).toBe("normal");
    expect(checkRollMode(derivation, { ability: "str", skill: "stealth" }).mode).toBe("normal");
    // A caller that cannot name the check gets nothing rather than everyone's advantage (fail-closed).
    expect(checkRollMode(derivation).mode).toBe("normal");
  });
});
