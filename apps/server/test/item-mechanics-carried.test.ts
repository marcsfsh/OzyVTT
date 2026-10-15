import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
// The shipped bundle, read as every consumer reads it.
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
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

// Carried wondrous items and potions (the carried section of `item-mechanics/items.ts`): the authored rows reach the table, and
// the absences stay absent for their recorded reasons. Runs the real `ContentLibrary` over the committed
// `magic-items.v1.json`; inventory rows are minted as the equipment picker mints them.
// The Pipes of Haunting end at a spent counter, a refusal at zero, and a server-enforced save whose
// Frightened condition the save block declares. The Potion of Resistance is
// an absence: `itemAction` drops an item action's `grants`, and an item's `effects` rider ignores
// `duration`, so "for 1 hour" cannot be expressed. Both halves are pinned below.

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

/** A Wizard 5 with AC 12, Dex 14 and no save or skill proficiencies, so every number is the item's. */
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
const carried = (id: string, name: string, over: Record<string, unknown> = {}): InventoryItem =>
  item({ id, name, quantity: 1, equipped: true, attuned: true, category: "wondrous-item", ...over });

/** The carried wondrous items, potions and oils, from the shipped bundle. */
const CARRIED_ROWS = loadMagicItems().filter(
  (row) =>
    ((row.category === "wondrous-item" && row.slot === "wondrous") || row.category === "consumable") &&
    row.id !== "spell-scroll"
);
/** "Carries a rider" over all nine keys `overlay.ts`'s `ITEM_RIDER_KEYS` admits, `tags` included. */
const carries = (row: {
  tags?: unknown[];
  modifiers: unknown[];
  actions: unknown[];
  casts: unknown[];
  effects: unknown[];
  grants?: unknown;
  grantsFeatIds: unknown[];
  uses?: unknown;
  cursed: boolean;
}) =>
  (row.tags ?? []).length > 0 ||
  row.modifiers.length > 0 ||
  row.actions.length > 0 ||
  row.casts.length > 0 ||
  row.effects.length > 0 ||
  row.grants !== undefined ||
  row.grantsFeatIds.length > 0 ||
  row.uses !== undefined ||
  row.cursed;

describe("the Pipes of Haunting spend a charge, refuse the fourth press, and force a real save", () => {
  it("carries the authored action out of the COMMITTED bundle, through the real content library", () => {
    // The first link: if the overlay did not merge, this fails.
    const record = view.equipmentRecord("pipes-of-haunting")!;
    expect(record.slot).toBe("wondrous");
    expect(record.category).toBe("wondrous-item");
    expect(record.attunement).toMatchObject({ required: false });
    expect(record.actions).toHaveLength(1);
    expect(record.actions[0]).toMatchObject({
      id: "play",
      name: "Play the Pipes",
      activation: "action",
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

    const action = effectiveActions(definition, actor, catalog).find(
      (entry) => entry.id === "item-pipes-of-haunting-play"
    )!;
    expect(action.uses).toEqual({ limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" });
    // Nothing else was invented either: no damage, no attack.
    expect(action.damage).toEqual([]);
    expect(action.attack).toBeUndefined();

    expect(actor.actionUses["pipes-of-haunting-charges"]).toBeUndefined();
    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(1) },
      deps([], definition)
    );
    expect(actor.actionUses["pipes-of-haunting-charges"]).toBe(1); // one of three

    newTurn(state);
    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(2) },
      deps([], definition)
    );
    newTurn(state);
    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(3) },
      deps([], definition)
    );
    expect(actor.actionUses["pipes-of-haunting-charges"]).toBe(3);

    // The fourth press is refused.
    newTurn(state);
    expect(() =>
      resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(4) },
        deps([], definition)
      )
    ).toThrow("Play the Pipes: no uses remaining (3/long rest).");
  });

  it("NUMBER TWO - a pending save the server ENFORCES at DC 15, naming Frightened off the shipped prose", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("pipes-of-haunting", "Pipes of Haunting", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-pipes-of-haunting-play"
    )!;

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(5) },
      deps([], definition)
    );
    // `conditionIds` are the save block's declared conditions.
    expect(state.combat.pendingSaves).toHaveLength(1);
    expect(state.combat.pendingSaves[0]).toMatchObject({
      targetActorId: IDS.foe,
      ability: "wis",
      dc: 15,
      conditionIds: ["frightened"]
    });

    // And the server enforces the DC: a monster with Wis +0 rolling 14 fails DC 15 and passes DC 13.
    const answered = answerSave(
      state,
      cmd(6),
      state.combat.pendingSaves[0].id,
      "roll",
      undefined,
      false,
      { role: "gm" },
      {
        random: () => 14,
        newRollId: () => "40000000-0000-4000-8000-0000000000aa",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-12T00:00:00.000Z",
        resolveDefinition: () => undefined,
        catalog
      }
    );
    expect(answered.outcome).toMatchObject({ total: 14, success: false });
  });

  it("NUMBER THREE - the reversal: no pipes in the pack, no action and no charge at all", () => {
    const definition = definitionOf();
    const unequipped = fight(
      stateWith([carried("pipes-of-haunting", "Pipes of Haunting", { attuned: false, equipped: false })])
    );
    expect(
      effectiveActions(definition, unequipped.actors[0], catalog).find(
        (entry) => entry.id === "item-pipes-of-haunting-play"
      )
    ).toBeUndefined();

    const empty = fight(stateWith([]));
    expect(
      effectiveActions(definition, empty.actors[0], catalog).find((entry) => entry.id === "item-pipes-of-haunting-play")
    ).toBeUndefined();
  });
});

describe("the Stone of Good Luck - both halves reach the roll", () => {
  const ROW = { id: "stone-of-good-luck-luckstone", name: "Stone of Good Luck", category: "wondrous-item" };

  it("moves every skill row by +1 and the save the SERVER rolls by +1, and both come off with the stone", () => {
    const definition = definitionOf();
    const state = stateWith([]);

    // Worn but not attuned: the SRD gates this one, so the row is inert.
    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: false }), () => definition, { catalog });
    const bare = deriveEquipment(state.actors[0], definition, catalog);
    expect(
      deriveActorSheet(state.actors[0], definition, bare, skillCatalog).skills.find((row) => row.id === "arcana")!.bonus
    ).toBe(3);
    expect(saveTotalFor(definition, state.actors[0], "dex", bare)).toBe(2);

    setInventoryItem(state, IDS.hero, item({ ...ROW, equipped: true, attuned: true }), () => definition, { catalog });
    const lucky = deriveEquipment(state.actors[0], definition, catalog);
    const sheet = deriveActorSheet(state.actors[0], definition, lucky, skillCatalog);
    // Unnarrowed, which is what "ability checks" means: every skill, whatever its ability.
    expect(sheet.skills.find((row) => row.id === "arcana")!.bonus).toBe(4); // Int +3 and the stone
    expect(sheet.skills.find((row) => row.id === "stealth")!.bonus).toBe(3); // Dex +2 and the stone
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(1); // Str +0 and the stone
    expect(saveTotalFor(definition, state.actors[0], "dex", lucky)).toBe(3);

    // The reversal, on the real inventory write path.
    setInventoryItem(state, IDS.hero, item({ ...ROW, quantity: 0 }), () => definition, { catalog });
    const gone = deriveEquipment(state.actors[0], definition, catalog);
    expect(
      deriveActorSheet(state.actors[0], definition, gone, skillCatalog).skills.find((row) => row.id === "arcana")!.bonus
    ).toBe(3);
    expect(saveTotalFor(definition, state.actors[0], "dex", gone)).toBe(2);
  });

  it("is the difference between a failed and a passed save at the same die and the same DC", () => {
    const definition = definitionOf();
    for (const [attuned, total, success] of [
      [true, 16, true],
      [false, 15, false]
    ] as const) {
      const state = fight(stateWith([carried("stone-of-good-luck-luckstone", "Stone of Good Luck", { attuned })]));
      createPendingSaves(state, {
        sourceActorId: IDS.foe,
        sourceName: "Foe",
        actionName: "Blast",
        ability: "dex",
        dc: 16,
        targetIds: [IDS.hero],
        proposedDamage: 10,
        halfOnSuccess: true,
        conditionIds: [],
        newSaveId: () => `60000000-0000-4000-8000-00000000000${attuned ? 1 : 2}`,
        createdAt: 0
      });
      const answered = answerSave(
        state,
        cmd(attuned ? 7 : 8),
        state.combat.pendingSaves[0].id,
        "roll",
        undefined,
        false,
        { role: "gm" },
        {
          random: () => 13,
          newRollId: () => `40000000-0000-4000-8000-00000000000${attuned ? 1 : 2}`,
          sessionId: IDS.gmSession,
          role: "gm",
          now: () => "2026-08-12T00:00:00.000Z",
          resolveDefinition: () => definition,
          catalog
        }
      );
      expect(answered.outcome).toMatchObject({ total, success }); // d20 13, Dex +2, +1 only when attuned
    }
  });

  it("and the SERVER'S OWN ability check pays the +1 the sheet promises", () => {
    // The builtin checks add `checkRiderBonus`, narrowed to the check's ability and skill as the sheet's row is.
    const definition = definitionOf();
    const state = fight(stateWith([carried("stone-of-good-luck-luckstone", "Stone of Good Luck")]));
    const sheet = deriveActorSheet(
      state.actors[0],
      definition,
      deriveEquipment(state.actors[0], definition, catalog),
      skillCatalog
    );
    expect(sheet.skills.find((row) => row.id === "stealth")!.bonus).toBe(3); // Dex +2 and the stone

    const hide = resolveDefinitionAction(
      state,
      builtinAction("hide")!,
      { actorId: IDS.hero, targetIds: [], commandId: cmd(16), builtin: true },
      deps([10], definition)
    );
    expect(hide.check!.total).toBe(13); // d20 10 + Dex 2 + the stone's 1
  });
});

describe("what the carried items' buttons do outside an encounter", () => {
  it("refuses every one of them, by the server's own words", () => {
    // Most authored rows do nothing out of combat, and their printed uses (scrying, messaging, Truesight)
    // are not combat activities. The failure mode is a button that refuses rather than one that lies.
    const definition = definitionOf();
    for (const [id, name, actionId] of [
      ["crystal-ball", "Crystal Ball", "item-crystal-ball-cast-scrying"],
      ["sending-stones", "Sending Stones", "item-sending-stones-cast-sending"],
      ["gem-of-seeing", "Gem of Seeing", "item-gem-of-seeing-peer"],
      ["pipes-of-haunting", "Pipes of Haunting", "item-pipes-of-haunting-play"]
    ] as const) {
      const state = stateWith([carried(id, name)]); // no `fight()`
      const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === actionId)!;
      expect(action, `${id} - the button is on the sheet`).toBeDefined();
      expect(() =>
        resolveDefinitionAction(
          state,
          action,
          { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(17) },
          deps([], definition)
        )
      ).toThrow("Start an encounter before resolving actions.");
      // The loose `action.use` route builds from `attack`/`damage` only, and none of these carries either.
      expect({ id, plan: looseRollPlan(action, { includeDamage: true }) }).toEqual({ id, plan: [] });
    }
  });

  it("except the Iron Bands, which the loose route WILL roll - and it spends no charge", () => {
    // Known limitation: the loose `action.use` path touches no combat state, so `actionUses` is never
    // incremented and outside a fight the bands throw unlimited +5 attacks where the SRD prints one per
    // dawn. Engine-wide, so this pins the leak rather than removing the rider.
    const definition = definitionOf();
    const state = stateWith([carried("iron-bands", "Iron Bands", { attuned: false })]);
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-iron-bands-throw"
    )!;
    expect(looseRollPlan(action, { includeDamage: true })).toEqual([
      { formula: "1d20 + 5", purpose: "attack", label: "Throw the Bands" }
    ]);
  });
});

describe("the one printed to-hit among carried items that the vocabulary can say", () => {
  it("derives the Iron Bands' attack from Dex + Proficiency, exactly as the SRD prints it", () => {
    const definition = definitionOf();
    // "Iron Bands of Bilarro" is the 2014 name and does not appear in SRD 5.2.1.
    expect(view.equipmentRecord("iron-bands")!.name).toBe("Iron Bands");
    const state = fight(stateWith([carried("iron-bands", "Iron Bands", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-iron-bands-throw"
    )!;
    // "an attack bonus equal to your Dexterity modifier plus your Proficiency Bonus" = 2 + 3.
    expect(action.attack).toMatchObject({ bonus: 5, rangeFeet: 60 });
    expect(action.uses).toEqual({ limit: 1, per: "long-rest", pool: "iron-bands-charges" });
    expect(action.damage).toEqual([]);

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(9) },
      deps([12], definition)
    );
    expect(state.actors[0].actionUses["iron-bands-charges"]).toBe(1);
    newTurn(state);
    expect(() =>
      resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(10) },
        deps([12], definition)
      )
    ).toThrow("Throw the Bands: no uses remaining (1/long rest).");
  });
});

describe("the charge-alone items, whose counter is the whole of what they enforce", () => {
  it("rations the four elemental summons at one a day and the three-charge items at three", () => {
    const definition = definitionOf();
    for (const [id, name, actionId, limit, label] of [
      [
        "bowl-of-commanding-water-elementals",
        "Bowl of Commanding Water Elementals",
        "item-bowl-of-commanding-water-elementals-summon",
        1,
        "Summon Water Elemental"
      ],
      [
        "brazier-of-commanding-fire-elementals",
        "Brazier of Commanding Fire Elementals",
        "item-brazier-of-commanding-fire-elementals-summon",
        1,
        "Summon Fire Elemental"
      ],
      [
        "censer-of-controlling-air-elementals",
        "Censer of Controlling Air Elementals",
        "item-censer-of-controlling-air-elementals-summon",
        1,
        "Summon Air Elemental"
      ],
      [
        "stone-of-controlling-earth-elementals",
        "Stone of Controlling Earth Elementals",
        "item-stone-of-controlling-earth-elementals-summon",
        1,
        "Summon Earth Elemental"
      ],
      ["bag-of-tricks", "Bag of Tricks", "item-bag-of-tricks-pull", 3, "Pull a Fuzzy Object"],
      ["gem-of-seeing", "Gem of Seeing", "item-gem-of-seeing-peer", 3, "Peer Through the Gem"],
      ["pipes-of-the-sewers", "Pipes of the Sewers", "item-pipes-of-the-sewers-call", 3, "Call a Swarm of Rats"]
    ] as const) {
      const state = fight(stateWith([carried(id, name)]));
      const actor = state.actors[0];
      const action = effectiveActions(definition, actor, catalog).find((entry) => entry.id === actionId)!;
      expect(action.uses).toEqual({ limit, per: "long-rest", pool: `${id}-charges` });
      // The charge is all these enforce.
      expect(action.damage).toEqual([]);
      expect(action.attack).toBeUndefined();
      expect(action.save).toBeUndefined();

      actor.actionUses = { [`${id}-charges`]: limit };
      expect(() =>
        resolveDefinitionAction(
          state,
          action,
          { actorId: IDS.hero, targetIds: [], commandId: cmd(11) },
          deps([], definition)
        )
      ).toThrow(`${label}: no uses remaining (${limit}/long rest).`);
    }
  });
});

describe("the casts that survived the spell-record check", () => {
  it("holds all four Crystal Balls' Scrying to the orbs' printed DC 17, with nothing else invented", () => {
    const definition = definitionOf();
    for (const id of [
      "crystal-ball",
      "crystal-ball-of-mind-reading",
      "crystal-ball-of-telepathy",
      "crystal-ball-of-true-seeing"
    ]) {
      const state = fight(stateWith([carried(id, "Crystal Ball")]));
      const cast = effectiveActions(definition, state.actors[0], catalog).find(
        (entry) => entry.id === `item-${id}-cast-scrying`
      )!;
      // The save Scrying's own target makes, at the item's printed DC, not the wearer's derived one.
      expect(cast.save).toEqual({ ability: "wis", dc: 17, successDamage: "none", failureConditions: [] });
      expect(cast.damage).toEqual([]);
      expect(cast.attack).toBeUndefined();
      expect(cast.uses).toBeUndefined(); // no charge limit is printed on any of the four
    }
  });

  it("the two SENSOR-GATED casts are absent, and a re-author would land a real Charm on any target", () => {
    // The SRD casts these through an active Scrying sensor ("targeting creatures you can see within 30 feet
    // of the spell's sensor"), which no trigger can express, so the derived buttons would have no
    // prerequisite. Suggestion resolved at a foe in melee would write a charmed pending save.
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
      // The orb's own printed, ungated Scrying is still unlimited.
      expect(actions.find((entry) => entry.id === `item-${id}-cast-scrying`)!.uses).toBeUndefined();
    }
    // The shipped prose still carries the gate, so a GM reads what the button cannot enforce.
    expect(view.equipmentRecord("crystal-ball-of-telepathy")!.description).toContain(
      "through the sensor on one of those creatures"
    );
    expect(view.equipmentRecord("crystal-ball-of-mind-reading")!.description).toContain(
      "within 30 feet of the spell's sensor"
    );
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
    // One pool: casting Gate spends the charge Plane Shift would have used.
    resolveDefinitionAction(
      state,
      actions.find((entry) => entry.id === "item-cubic-gate-cast-gate")!,
      { actorId: IDS.hero, targetIds: [], commandId: cmd(13) },
      deps([], definition)
    );
    expect(state.actors[0].actionUses["cubic-gate-charges"]).toBe(1);

    const stones = fight(stateWith([carried("sending-stones", "Sending Stones")]));
    const sending = effectiveActions(definition, stones.actors[0], catalog).find(
      (entry) => entry.id === "item-sending-stones-cast-sending"
    )!;
    expect(sending.uses).toEqual({ limit: 1, per: "long-rest", pool: "sending-stones-charges" });
    expect(sending.damage).toEqual([]);
    expect(sending.save).toBeUndefined();
    expect(sending.attack).toBeUndefined();
  });
});

describe("a save with no charge behind it, because the SRD prints no limit", () => {
  it("gives the Rope of Entanglement an unlimited DC 15 Dex save that names Restrained", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("rope-of-entanglement", "Rope of Entanglement", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-rope-of-entanglement-entangle"
    )!;
    expect(action.save).toEqual({ ability: "dex", dc: 15, successDamage: "none", failureConditions: ["restrained"] });
    expect(action.uses).toBeUndefined(); // unlimited is the printed item
    expect(action.damage).toEqual([]);

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(14) },
      deps([], definition)
    );
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "dex", dc: 15, conditionIds: ["restrained"] });
  });

  it("gives the Iron Flask a DC 17 Wis save and applies NO condition - nothing spurious off the prose", () => {
    const definition = definitionOf();
    const state = fight(stateWith([carried("iron-flask", "Iron Flask", { attuned: false })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-iron-flask-trap"
    )!;
    expect(action.save).toEqual({ ability: "wis", dc: 17, successDamage: "none", failureConditions: [] });
    expect(action.damage).toEqual([]);

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(15) },
      deps([], definition)
    );
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "wis", dc: 17, conditionIds: [] });
  });

  it("gives the Decanter's Geyser a DC 13 Str save: no damage on a success, Prone on a failure", () => {
    const definition = definitionOf();
    const state = fight(
      stateWith([carried("decanter-of-endless-water", "Decanter of Endless Water", { attuned: false })])
    );
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-decanter-of-endless-water-geyser"
    )!;
    // The SRD's "must succeed ... or take 1d4" means nothing on a success, which prose reading got wrong.
    expect(action.save).toEqual({ ability: "str", dc: 13, successDamage: "none", failureConditions: ["prone"] });
    expect(action.damage).toEqual([{ formula: "1d4", type: "bludgeoning" }]);
    expect(action.uses).toBeUndefined();

    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(18) },
      deps([3], definition)
    );
    expect(state.combat.pendingSaves[0]).toMatchObject({
      ability: "str",
      dc: 13,
      proposedDamage: 3,
      halfOnSuccess: false,
      conditionIds: ["prone"]
    });
  });
});

// The absences, pinned so none is authored by accident.

describe("what no carried item can carry", () => {
  it("no potion or oil carries a rider, because a consumed item is unsayable", () => {
    const consumables = CARRIED_ROWS.filter((row) => row.category === "consumable");
    expect(consumables.length).toBeGreaterThan(0);
    expect(consumables.filter(carries).map((row) => row.id)).toEqual([]);
  });

  it("authors no curse, and could not have, since no carried row requires attunement AND prints a curse", () => {
    expect(CARRIED_ROWS.filter((row) => row.cursed).map((row) => row.id)).toEqual([]);
    // `mysterious-deck` is the only carried row whose prose says "cursed", and `schemas.ts` would refuse a
    // curse on it anyway because it requires no attunement.
    const deck = CARRIED_ROWS.find((row) => row.id === "mysterious-deck")!;
    expect(deck.attunement?.required).toBe(false);
    expect(carries(deck)).toBe(false);
  });
});

describe("the absences that were measured and must stay absent", () => {
  it("the briefed far end - Potion of Resistance - carries no rider, because 'for 1 hour' cannot be said", () => {
    const potion = view.equipmentRecord("potion-of-resistance")!;
    expect(potion.description).toContain("Resistance to one type of damage for 1 hour");
    // An item's `effects` rider would stand while the bottle is merely carried.
    expect(potion.effects).toEqual([]);
    // ...and nothing else was reached for either.
    expect(potion.grants).toBeUndefined();
    expect(potion.actions).toEqual([]);
    expect(potion.casts).toEqual([]);
    expect(potion.modifiers).toEqual([]);
    // Its expensive sibling fails the same way and must not be authored either.
    const invulnerability = view.equipmentRecord("potion-of-invulnerability")!;
    expect(invulnerability.effects).toEqual([]);
    expect(invulnerability.grants).toBeUndefined();
  });

  it("every row whose printed effect restores or grants hit points is prose", () => {
    for (const id of [
      "potions-of-healing",
      "potion-of-vitality",
      "ioun-stone",
      "dragon-orb",
      "potion-of-heroism",
      "bag-of-beans"
    ]) {
      const row = view.equipmentRecord(id)!;
      expect({ id, carries: carries(row) }).toEqual({ id, carries: false });
    }
  });

  it("the Bead of Force and the Horn of Blasting carry no action", () => {
    // The bead is destroyed on use, which no `per` value can say.
    expect(view.equipmentRecord("bead-of-force")!.actions).toEqual([]);
    // The horn is absent for its 20% explosion chance.
    const horn = view.equipmentRecord("horn-of-blasting")!;
    expect(horn.description).toContain("20 percent chance of causing the horn to explode");
    expect(carries(horn)).toBe(false);
  });

  it("the seven ability-score refusals stay prose, and so do the reserved and multi-cost rows", () => {
    // `ability-score` is refused on an item carrier: one potion, three manuals, three tomes.
    for (const id of [
      "potion-of-giant-strength",
      "manual-of-bodily-health",
      "manual-of-gainful-exercise",
      "manual-of-quickness-of-action",
      "tome-of-clear-thought",
      "tome-of-leadership-and-influence",
      "tome-of-understanding"
    ]) {
      expect({ id, carries: carries(view.equipmentRecord(id)!) }).toEqual({ id, carries: false });
    }
    // Rows needing mechanics not modeled yet, and two whose charge table costs more than one charge per use.
    for (const id of ["mysterious-deck", "cube-of-force", "dragon-orb", "gem-of-brightness", "pearl-of-power"]) {
      expect({ id, carries: carries(view.equipmentRecord(id)!) }).toEqual({ id, carries: false });
    }
  });
});
