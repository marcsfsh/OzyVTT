import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { ActorDefinitionSchema, InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerReaction } from "../src/reactions.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";

// Reactions to damage about to land (SRD 5.2.1): Deflect Attacks takes 1d10 plus Dexterity and Monk level off a hit's
// Bludgeoning, Piercing or Slashing damage (any type from Deflect Energy at 13), Stone's Endurance takes 1d12 plus
// Constitution off any damage, Superior Hunter's Defense resists the damage's type until the turn ends, Gloves of
// Missile Snaring take 1d10 plus Dexterity off a weapon's hit from range, and a stone giant's Deflect Missile takes
// 1d10 + 6 off a ranged hit. A Quarterstaff of the Acrobat's Attack Deflection adds 5 to AC against a hit.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);
const POLICY = BuilderPolicySchema.parse({});

const IDS = {
  hero: "10000000-0000-4000-8000-0000000000d1",
  goblin: "10000000-0000-4000-8000-0000000000d2",
  gm: "30000000-0000-4000-8000-0000000000d9",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const NOW = "2026-10-18T00:00:00.000Z";

const SCIMITAR = {
  id: "scimitar",
  name: "Scimitar",
  activation: "action",
  description: "A test swing.",
  attack: { bonus: 4, reachFeet: 5 },
  damage: [{ formula: "1d6 + 2", type: "slashing" }]
};
const SHORTBOW = {
  id: "shortbow",
  name: "Shortbow",
  activation: "action",
  description: "A test shot.",
  attack: { bonus: 4, rangeFeet: 80, longRangeFeet: 320 },
  damage: [{ formula: "1d6 + 2", type: "piercing" }]
};
const FIRE_BOLT = {
  id: "fire-bolt",
  name: "Fire Bolt",
  activation: "action",
  description: "A test bolt.",
  attack: { bonus: 4, rangeFeet: 120 },
  damage: [{ formula: "1d10", type: "fire" }]
};
const FIRE_BREATH = {
  id: "fire-breath",
  name: "Fire Breath",
  activation: "action",
  description: "A test breath.",
  damage: [{ formula: "4d6", type: "fire" }],
  save: { ability: "dex", dc: 13, successDamage: "half", failureConditions: [] }
};

function monster(name: string, actions: readonly object[], over: Record<string, unknown> = {}): ActorDefinition {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size: "medium",
    abilityScores: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 14,
    hitPoints: { maximum: 60 },
    speedFeet: 30,
    actions,
    ...over
  });
}

/** The goblin acts first, then the hero; they stand `feet` apart (5 by default). */
function table(hero: ActorDefinition, inventory: InventoryItem[] = [], heroHp = 60): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: heroHp, maximum: heroHp },
        armorClass: 14,
        definitionId: "def-hero",
        inventory
      },
      {
        id: IDS.goblin,
        name: "Goblin",
        kind: "monster",
        visibility: "public",
        hp: { current: 60, maximum: 60 },
        armorClass: 14,
        definitionId: "def-goblin"
      }
    ],
    definitions: [
      { id: "def-hero", definition: hero },
      { id: "def-goblin", definition: monster("Goblin", [SCIMITAR, SHORTBOW, FIRE_BOLT, FIRE_BREATH]) }
    ]
  });
  startEncounter(
    game,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.goblin, score: 20 },
        { actorId: IDS.hero, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    lookup(game)
  );
  return game;
}

let counter = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const lookup = (game: GameState) => (definitionId: string) =>
  game.definitions.find((entry) => entry.id === definitionId)?.definition;
const dice = (faces: number[]) => (sides: number) => {
  const face = faces.shift();
  if (face === undefined) throw new Error(`dice queue empty (d${sides})`);
  return face;
};
const hero = (game: GameState) => game.actors.find((candidate) => candidate.id === IDS.hero)!;

function goblinUses(game: GameState, action: object, faces: number[], feet = 5) {
  return resolveDefinitionAction(
    game,
    action as ActorDefinition["actions"][number],
    { actorId: IDS.goblin, targetIds: [IDS.hero], commandId: nextId(), commit: true },
    {
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: () => NOW,
      definition: lookup(game)("def-goblin"),
      resolveDefinition: lookup(game),
      catalog,
      distanceFeet: () => feet
    }
  );
}

function answer(game: GameState, use: boolean, faces: number[] = []) {
  return answerReaction(game, nextId(), game.combat.pendingReactions[0]!.id, use, undefined, GM, {
    resolveDefinition: lookup(game),
    catalog,
    random: dice(faces),
    newRollId: nextId,
    gmSessionId: IDS.gm,
    now: () => NOW,
    distanceFeet: () => 5
  });
}

type Row = CharacterCreateRequestInput["choices"][number];
/** A Halfling Monk with Dex 17 at level 3 and Dex 20 from level 12. */
function monk(level: number): ActorDefinition {
  const asi = (at: number, first: string, second: string): Row[] =>
    at > level
      ? []
      : ([
          { level: at, classId: "monk", kind: "asi-or-feat", id: "ability-score-improvement" },
          { level: at, kind: "ability-score", id: first, payload: { featureId: "ability-score-improvement" } },
          { level: at, kind: "ability-score", id: second, payload: { featureId: "ability-score-improvement" } }
        ] as Row[]);
  return buildCharacterDefinition(
    {
      name: "Shan",
      speciesId: "halfling",
      backgroundId: "criminal",
      classId: "monk",
      level,
      subclassId: "warrior-of-the-open-hand",
      abilityMethod: "standard-array",
      baseScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
      backgroundBonusAllocation: [
        { ability: "dex", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: "monk", kind: "skill", id: "acrobatics" },
        { level: 1, classId: "monk", kind: "skill", id: "insight" },
        { level: 3, classId: "monk", kind: "subclass", id: "warrior-of-the-open-hand" },
        ...asi(4, "dex", "dex"),
        ...asi(8, "wis", "wis"),
        ...asi(12, "dex", "wis"),
        { level: 1, kind: "equipment", id: "monk-a" },
        { level: 1, kind: "equipment", id: "criminal-a" }
      ] as Row[]
    } as CharacterCreateRequestInput,
    view,
    POLICY
  );
}

describe("Deflect Attacks", () => {
  it("is built with the Dexterity modifier and Monk level added, and Deflect Energy drops the type limit at 13", () => {
    const third = monk(3).actions.find((action) => action.id === "deflect-attacks");
    expect(third).toMatchObject({
      activation: "reaction",
      reaction: {
        trigger: "hit-by-attack",
        response: "reduce-damage",
        formula: "1d10 + 6",
        damageTypes: ["bludgeoning", "piercing", "slashing"]
      }
    });
    const thirteenth = monk(13).actions.find((action) => action.id === "deflect-attacks");
    expect(thirteenth?.reaction).toEqual({ trigger: "hit-by-attack", response: "reduce-damage", formula: "1d10 + 18" });
  });

  it("takes the rolled amount off a slashing hit and spends the Reaction", () => {
    const game = table(monk(3));
    const swing = goblinUses(game, SCIMITAR, [15, 6]);
    expect(swing.reactionPrompts).toEqual([
      { actorId: IDS.hero, actorName: "Hero", actionName: "Deflect Attacks", holdsDamage: true }
    ]);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "hit-by-attack",
      proposedDamage: 8,
      damageResponse: { kind: "reduce", formula: "1d10 + 6" }
    });
    const before = hero(game).hp.current;
    // 1 + 6 = 7 off 8 Slashing.
    const used = answer(game, true, [1]);
    expect(used).toMatchObject({ used: true, appliedDamage: 1 });
    expect(hero(game).hp.current).toBe(before - 1);
    expect(game.combat.reactionsUsed).toContain(IDS.hero);
  });

  it("is offered on a Fire Bolt only from Monk 13", () => {
    const third = table(monk(3));
    goblinUses(third, FIRE_BOLT, [15, 7], 30);
    expect(third.combat.pendingReactions).toEqual([]);
    const thirteenth = table(monk(13));
    goblinUses(thirteenth, { ...FIRE_BOLT, attack: { bonus: 14, rangeFeet: 120 } }, [15, 7], 30);
    expect(thirteenth.combat.pendingReactions[0]).toMatchObject({
      actionName: "Deflect Attacks",
      damageResponse: { kind: "reduce", formula: "1d10 + 18" }
    });
    const before = hero(thirteenth).hp.current;
    answer(thirteenth, true, [1]);
    expect(hero(thirteenth).hp.current).toBe(before);
  });

  it("declined, the whole hit lands and the Reaction stays", () => {
    const game = table(monk(3));
    goblinUses(game, SCIMITAR, [15, 6]);
    const before = hero(game).hp.current;
    expect(answer(game, false)).toMatchObject({ used: false, appliedDamage: 8 });
    expect(hero(game).hp.current).toBe(before - 8);
    expect(game.combat.reactionsUsed).not.toContain(IDS.hero);
  });
});

describe("Stone's Endurance", () => {
  const STONES_ENDURANCE = {
    id: "stones-endurance",
    name: "Stone's Endurance",
    activation: "reaction",
    description: "A test reaction.",
    damage: [],
    uses: { limit: 2, per: "long-rest", pool: "giant-ancestry" },
    reaction: { trigger: "takes-damage", response: "reduce-damage", formula: "1d12 + 2" }
  };
  const goliath = monster("Goliath", [STONES_ENDURANCE]);

  it("is authored on the Goliath's Giant Ancestry with the Constitution modifier added", () => {
    const species = view.speciesRecord("goliath");
    const action = JSON.stringify(species);
    expect(action).toContain('"reaction":{"trigger":"takes-damage","response":"reduce-damage","formula":"1d12"}');
    expect(action).toContain('"adds":{"abilityModifier":"con"}');
  });

  it("holds a failed save's damage, and the roll comes off it", () => {
    const game = table(goliath);
    const saveId = nextId();
    createPendingSaves(game, {
      sourceActorId: IDS.goblin,
      sourceName: "Goblin",
      actionName: "Fire Breath",
      ability: "dex",
      dc: 13,
      targetIds: [IDS.hero],
      proposedDamage: 14,
      proposedDamageParts: [{ amount: 14, type: "fire" }],
      halfOnSuccess: true,
      conditionIds: [],
      newSaveId: () => saveId,
      createdAt: 0
    });
    const saved = answerSave(game, nextId(), saveId, "roll", undefined, true, GM, {
      random: dice([3]),
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: () => NOW,
      resolveDefinition: lookup(game),
      catalog
    });
    expect(saved.outcome).toMatchObject({ committed: true, success: false, appliedDamage: 0, damageHeld: true });
    expect(hero(game).hp.current).toBe(60);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "takes-damage",
      actionName: "Stone's Endurance",
      proposedDamage: 14,
      damageResponse: { kind: "reduce", formula: "1d12 + 2" }
    });
    // 8 + 2 = 10 off 14 Fire.
    expect(answer(game, true, [8])).toMatchObject({ used: true, appliedDamage: 4 });
    expect(hero(game).hp.current).toBe(56);
    expect(hero(game).actionUses["giant-ancestry"]).toBe(1);
  });

  it("is offered on a hit too, and not once its uses are spent", () => {
    const game = table(goliath);
    goblinUses(game, SCIMITAR, [15, 6]);
    expect(game.combat.pendingReactions[0]).toMatchObject({ kind: "hit-by-attack", actionName: "Stone's Endurance" });
    answer(game, false);
    const spent = table(goliath);
    hero(spent).actionUses = { "giant-ancestry": 2 };
    goblinUses(spent, SCIMITAR, [15, 6]);
    expect(spent.combat.pendingReactions).toEqual([]);
  });
});

describe("Superior Hunter's Defense", () => {
  const ranger = monster("Ranger", [
    {
      id: "superior-hunters-defense",
      name: "Superior Hunter's Defense",
      activation: "reaction",
      description: "A test reaction.",
      damage: [],
      reaction: { trigger: "takes-damage", response: "resist-type" }
    }
  ]);

  it("halves the hit's damage and the next of the same type this turn, then ends with the turn", () => {
    const game = table(ranger);
    goblinUses(game, SCIMITAR, [15, 6]);
    expect(game.combat.pendingReactions[0]).toMatchObject({ damageResponse: { kind: "resist" } });
    expect(answer(game, true)).toMatchObject({ used: true, appliedDamage: 4 });
    expect(hero(game).hp.current).toBe(56);
    expect(hero(game).effects.map((effect) => effect.name)).toEqual(["Superior Hunter's Defense (Slashing)"]);
    // The Reaction is spent, so the second swing opens no prompt, and its Slashing damage is still halved.
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
    expect(goblinUses(game, SCIMITAR, [15, 6]).damageTotal).toBe(8);
    expect(game.combat.pendingReactions).toEqual([]);
    applyDamageDetailed(game, IDS.hero, { amount: 8, parts: [{ amount: 8, type: "slashing" }] }, GM, {
      resolveDefinition: lookup(game),
      newId: nextId,
      now: () => NOW,
      commandId: nextId(),
      catalog
    });
    expect(hero(game).hp.current).toBe(52);
    nextInitiativeTurn(game);
    expect(hero(game).effects).toEqual([]);
  });

  it("is authored on the Hunter", () => {
    const hunter = JSON.stringify(view.subclassRecord("hunter"));
    expect(hunter).toContain('"reaction":{"trigger":"takes-damage","response":"resist-type"}');
  });
});

describe("Gloves of Missile Snaring", () => {
  const wearer = monster("Archer", [], {
    abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 }
  });
  const gloves = InventoryItemSchema.parse({
    id: "gloves-of-missile-snaring",
    name: "Gloves of Missile Snaring",
    quantity: 1,
    equipped: true,
    attuned: true,
    category: "wondrous-item"
  });

  it("derive a Reaction with the wearer's Dexterity modifier added", () => {
    const record = loadMagicItems().find((item) => item.id === "gloves-of-missile-snaring");
    expect(record?.actions?.[0]).toMatchObject({ adds: { abilityModifier: "dex" } });
    const game = table(wearer, [gloves]);
    const snare = effectiveActions(wearer, hero(game), catalog).find((action) => action.name === "Snare Missile");
    expect(snare?.reaction).toEqual({
      trigger: "hit-by-attack",
      response: "reduce-damage",
      formula: "1d10 + 3",
      attackKinds: ["ranged-weapon"]
    });
  });

  it("are offered on a shot, and not on a sword's swing or a Fire Bolt", () => {
    const game = table(wearer, [gloves]);
    goblinUses(game, SHORTBOW, [15, 4], 30);
    expect(game.combat.pendingReactions[0]).toMatchObject({ actionName: "Snare Missile", proposedDamage: 6 });
    // 3 + 3 = 6 off 6 Piercing.
    expect(answer(game, true, [3])).toMatchObject({ used: true, appliedDamage: 0 });
    const melee = table(wearer, [gloves]);
    goblinUses(melee, SCIMITAR, [15, 4]);
    expect(melee.combat.pendingReactions).toEqual([]);
    const bolt = table(wearer, [gloves]);
    goblinUses(bolt, FIRE_BOLT, [15, 4], 30);
    expect(bolt.combat.pendingReactions).toEqual([]);
  });
});

describe("a stone giant's Deflect Missile", () => {
  const giant = view.monster("stone-giant")!;

  it("takes 1d10 + 6 off a ranged hit, and isn't offered on a melee one", () => {
    expect(giant.actions.find((action) => action.id === "deflect-missile")?.reaction).toEqual({
      trigger: "hit-by-attack",
      response: "reduce-damage",
      formula: "1d10 + 6",
      damageTypes: ["bludgeoning", "piercing", "slashing"],
      attackKinds: ["ranged"]
    });
    const game = table(giant, [], 126);
    goblinUses(game, SHORTBOW, [19, 4], 30);
    expect(game.combat.pendingReactions[0]).toMatchObject({ actionName: "Deflect Missile (Recharge 5-6)" });
    expect(answer(game, true, [1])).toMatchObject({ used: true, appliedDamage: 0 });
    const melee = table(giant, [], 126);
    goblinUses(melee, SCIMITAR, [19, 4]);
    expect(melee.combat.pendingReactions).toEqual([]);
  });
});

describe("a Quarterstaff of the Acrobat's Attack Deflection", () => {
  const staff = InventoryItemSchema.parse({
    id: "quarterstaff-of-the-acrobat",
    name: "Quarterstaff of the Acrobat",
    quantity: 1,
    equipped: true,
    attuned: true,
    category: "weapon"
  });

  it("adds 5 to AC against a hit, once a rest", () => {
    const game = table(monster("Acrobat", []), [staff]);
    goblinUses(game, SCIMITAR, [12]);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "attack-would-hit",
      actionName: "Attack Deflection",
      acBonus: 5
    });
    expect(answer(game, true).resolution?.attack).toMatchObject({ outcome: "miss" });
    const again = table(monster("Acrobat", []), [staff]);
    hero(again).actionUses = { ...hero(game).actionUses };
    goblinUses(again, SCIMITAR, [12, 4]);
    expect(again.combat.pendingReactions).toEqual([]);
  });
});
