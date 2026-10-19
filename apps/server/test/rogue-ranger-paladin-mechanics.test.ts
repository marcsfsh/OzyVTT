import { describe, expect, it } from "vitest";
import { applyRest } from "../src/rests.js";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf, rollModeClaims } from "../src/equipment-derivation.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { answerReaction } from "../src/reactions.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";
import { answerAbilityCheck, rollAbilityCheck, type CheckRollDependencies } from "../src/check-rolls.js";
import { setCondition } from "../src/actor-conditions.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { currentSpeedFeet } from "../src/speed.js";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { asiRows } from "./asi-rows.js";

// Rogue, Ranger and Paladin mechanics, asserted as rolled numbers, spent counters, refused builds or
// text the table reads; never "the rider survived derivation". Runs against the real SRD bundles
// because the authored content is under test. `feature-riders.test.ts` is the fixture-side sibling.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
/** Every command here is the GM's; player scope is covered in `authorization.test.ts`. */
const GM_SCOPE = { role: "gm" } as const;

type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Array<CharacterCreateRequestInput["choices"][number]>;
  backgroundBonusAllocation: Array<{
    ability: CharacterCreateRequestInput["backgroundBonusAllocation"][number]["ability"];
    amount: number;
  }>;
};

type Table = Readonly<{
  definition: ActorDefinition;
  state: GameState;
  hero: Actor;
  foe: Actor;
  catalog: ReturnType<typeof equipmentCatalogOf>;
}>;

/** Build the sheet through the real builder, put it on a table, and start a fight. */
function table(input: MutableInput, foeHp = 60): Table {
  const definition = buildCharacterDefinition(input, library, policy);
  const catalog = equipmentCatalogOf(library);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: foeHp, maximum: foeHp },
        armorClass: 10
      }
    ]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
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
  return {
    definition,
    state,
    catalog,
    hero: state.actors.find((actor) => actor.id === IDS.hero)!,
    foe: state.actors.find((actor) => actor.id === IDS.foe)!
  };
}

let commandSeed = 0;
const nextCommandId = () => `50000000-0000-4000-8000-${String((commandSeed += 1)).padStart(12, "0")}`;

function deps(built: Table, faces: number[]): ResolveDependencies {
  let rollSeed = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-${String((rollSeed += 1)).padStart(12, "0")}`,
    gmSessionId: IDS.gm,
    now: () => "2026-08-07T00:00:00.000Z",
    definition: built.definition,
    catalog: built.catalog,
    resolveDefinition: (id: string) => resolveIn(built.state, id)
  };
}

/** The table's definition store: `importActorDefinition` keys it `import-<actorId>`. */
const resolveIn = (state: GameState, id: string) => state.definitions.find((entry) => entry.id === id)?.definition;

const actionOf = (built: Table, id: string) =>
  effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === id);
const resolve = (built: Table, id: string, faces: number[], targetIds: string[] = [IDS.foe]) =>
  resolveDefinitionAction(
    built.state,
    actionOf(built, id)!,
    { actorId: IDS.hero, targetIds, commandId: nextCommandId() },
    deps(built, faces)
  );

// A fresh turn. The action economy is per turn, so draining a pool must happen over several turns or
// the economy would block the second use.
function newTurn(built: Table): void {
  built.state.combat = {
    ...built.state.combat,
    turn: {
      actionUsed: false,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    }
  };
}

/** Spend one use of a pool on its own turn. */
const spend = (built: Table, id: string) => {
  newTurn(built);
  return resolve(built, id, [], []);
};

// Rogue

// A Halfling Criminal Rogue. Neither the species nor Criminal's origin feat (Alert) asks for choices,
// so every choice row below belongs to the Rogue.
const rogueInput = (level: number): MutableInput => {
  const asiLevels = [4, 8, 10, 12, 16].filter((asi) => asi <= level);
  const expertiseLevels = [1, 6].filter((entry) => entry <= level);
  return {
    name: "Nim",
    speciesId: "halfling",
    backgroundId: "criminal",
    classId: "rogue",
    level,
    ...(level >= 3 ? { subclassId: "thief" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "dex", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      // Thieves' Cant raises `species-languages` by one: a Rogue is offered three languages.
      { level: 1, kind: "language", id: "goblin" },
      { level: 1, classId: "rogue", kind: "skill", id: "acrobatics" },
      { level: 1, classId: "rogue", kind: "skill", id: "investigation" },
      { level: 1, classId: "rogue", kind: "skill", id: "perception" },
      { level: 1, classId: "rogue", kind: "skill", id: "deception" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "dagger" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "shortbow" },
      ...expertiseLevels.flatMap((entry) =>
        entry === 1
          ? [
              { level: 1, classId: "rogue", kind: "expertise", id: "stealth" },
              { level: 1, classId: "rogue", kind: "expertise", id: "sleight-of-hand" }
            ]
          : [
              { level: 6, classId: "rogue", kind: "expertise", id: "perception" },
              { level: 6, classId: "rogue", kind: "expertise", id: "investigation" }
            ]
      ),
      ...(level >= 3 ? [{ level: 3, classId: "rogue", kind: "subclass", id: "thief" }] : []),
      ...asiRows("rogue", asiLevels, ["dex", "con", "wis"], { dex: 17, con: 15, wis: 12 }),
      ...(level >= 19
        ? [
            {
              level: 19,
              classId: "rogue",
              kind: "feat",
              id: "boon-of-irresistible-offense",
              payload: { featureId: "epic-boon" }
            },
            { level: 19, kind: "ability-score", id: "dex", payload: { featureId: "boon-of-irresistible-offense" } }
          ]
        : []),
      { level: 1, kind: "equipment", id: "rogue-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

/** One swing with the extras the confirm carries, at a given roll mode and map distance. */
function swing(
  built: Table,
  actionId: string,
  faces: number[],
  options: {
    hitOptions?: Array<{ id: string; damageType?: string; slotLevel?: number }>;
    rollMode?: "advantage" | "disadvantage";
    commit?: boolean;
    distanceFeet?: (a: string, b: string) => number | null;
  } = {}
) {
  return resolveDefinitionAction(
    built.state,
    actionOf(built, actionId)!,
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: nextCommandId(),
      ...(options.rollMode ? { rollMode: options.rollMode } : {}),
      ...(options.commit === false ? { commit: false } : {}),
      ...(options.hitOptions ? { hitOptions: options.hitOptions } : {})
    },
    { ...deps(built, faces), ...(options.distanceFeet ? { distanceFeet: options.distanceFeet } : {}) }
  );
}

describe("Rogue: Sneak Attack rides a qualifying hit", () => {
  it("is offered on an advantaged Finesse hit, rolls the printed column in the weapon's type, and spends the turn's use", () => {
    // Level 11 prints 6d6. The shortsword is Finesse; Advantage qualifies it.
    const built = table(rogueInput(11));
    const preview = swing(built, "item-shortsword", [15, 2], { rollMode: "advantage", commit: false });
    expect(preview.hitOffers).toEqual([
      expect.objectContaining({ id: "sneak-attack", name: "Sneak Attack", dice: "6d6 Piercing", cost: "once per turn" })
    ]);
    const hit = swing(built, "item-shortsword", [15, 2, 4, 4, 4, 4, 4, 4, 4], {
      rollMode: "advantage",
      hitOptions: [{ id: "sneak-attack" }]
    });
    expect(hit.damage.find((part) => part.source === "Sneak Attack")).toEqual({
      formula: "6d6",
      type: "piercing",
      total: 24,
      source: "Sneak Attack"
    });
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
    // Once per turn: the next hit this turn offers it no more.
    newTurn(built);
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, turnUses: { [`${IDS.hero}:sneak-attack`]: 1 } }
    };
    expect(
      swing(built, "item-shortsword", [15, 2], { rollMode: "advantage", commit: false }).hitOffers
    ).toBeUndefined();
  });

  it("doubles its dice on a critical hit", () => {
    const built = table(rogueInput(5));
    const crit = swing(built, "item-dagger", [20, 2, 1, 2, 3, 4, 5, 6, 1, 2, 3], {
      rollMode: "advantage",
      hitOptions: [{ id: "sneak-attack" }]
    });
    expect(crit.attack?.outcome).toBe("crit");
    expect(crit.damage.find((part) => part.source === "Sneak Attack")).toMatchObject({ formula: "6d6" });
  });

  it("is not offered without Advantage or an ally beside the target, and is refused if chosen anyway", () => {
    const built = table(rogueInput(5));
    expect(swing(built, "item-shortsword", [15], { commit: false }).hitOffers).toBeUndefined();
    expect(() => swing(built, "item-shortsword", [15, 3], { hitOptions: [{ id: "sneak-attack" }] })).toThrowError(
      /Sneak Attack needs a Finesse or Ranged weapon/
    );
    // ...nor with Disadvantage, even beside an ally.
    expect(
      swing(built, "item-shortsword", [15, 15], { rollMode: "disadvantage", commit: false }).hitOffers
    ).toBeUndefined();
  });

  it("is refused when taken alone: it adds to a hit", () => {
    const built = table(rogueInput(5));
    expect(() => resolve(built, "sneak-attack", [3, 3, 3], [IDS.foe])).toThrowError(/adds to a hit/);
  });
});

describe("Rogue: Sneak Attack on an opportunity attack", () => {
  it("is offered on the swing's preview and rides the confirmed hit, on the mover's turn", () => {
    const built = table(rogueInput(5));
    // The foe's turn: it leaves the Rogue's reach.
    built.state.combat = { ...built.state.combat, turnActorId: IDS.foe };
    const prompt = "40000000-0000-4000-8000-0000000000ac";
    built.state.combat = {
      ...built.state.combat,
      pendingReactions: [
        {
          id: prompt,
          kind: "leaves-reach",
          actorId: IDS.hero,
          actionId: "opportunity-attack",
          actionName: "Opportunity Attack",
          sourceActorId: IDS.foe,
          sourceName: "Foe",
          targetActorId: IDS.foe,
          triggerCommandId: nextCommandId(),
          proposedDamage: 0,
          proposedDamageParts: [],
          critical: false,
          weighed: null,
          acBonus: null,
          rollsAttack: true,
          parkedAttack: null,
          createdAt: 0
        }
      ]
    };
    const answer = (faces: number[], options: Parameters<typeof answerReaction>[7]) =>
      answerReaction(
        built.state,
        nextCommandId(),
        prompt,
        true,
        "item-shortsword",
        GM_SCOPE,
        { ...deps(built, faces), resolveDefinition: (id) => resolveIn(built.state, id) },
        options
      );
    const preview = answer([15, 2], { commit: false, rollMode: "advantage" });
    expect(preview.resolution?.hitOffers).toEqual([
      expect.objectContaining({ id: "sneak-attack", dice: "3d6 Piercing" })
    ]);
    const hit = answer([4, 4, 4, 4], {
      commit: true,
      attackNatural: 15,
      rollMode: "advantage",
      hitOptions: [{ id: "sneak-attack" }]
    });
    expect(hit.used).toBe(true);
    expect(hit.resolution?.damage.find((part) => part.source === "Sneak Attack")).toMatchObject({
      formula: "3d6",
      type: "piercing",
      total: 12
    });
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
  });
});

describe("Rogue: Sneak Attack from an ally beside the target", () => {
  const ALLY = "10000000-0000-4000-8000-0000000000aa";
  const withAlly = (level: number) => {
    const built = table(rogueInput(level));
    built.state.actors.push(
      GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          {
            id: ALLY,
            name: "Ally",
            kind: "player-character",
            visibility: "public",
            hp: { current: 20, maximum: 20 }
          }
        ]
      }).actors[0]
    );
    built.state.combat = {
      ...built.state.combat,
      initiative: [...built.state.combat.initiative, { actorId: ALLY, score: 5, tieBreaker: 0 }]
    };
    return built;
  };

  it("qualifies with an able ally within 5 feet of the target, and not with one farther off", () => {
    const near = withAlly(5);
    const beside = (a: string, b: string) =>
      [a, b].includes(ALLY) && [a, b].includes(IDS.foe) ? 5 : a === IDS.hero || b === IDS.hero ? 5 : 30;
    expect(swing(near, "item-shortsword", [15], { commit: false, distanceFeet: beside }).hitOffers?.[0]).toMatchObject({
      id: "sneak-attack"
    });
    const far = (a: string, b: string) => ([a, b].includes(ALLY) ? 30 : 5);

    expect(swing(near, "item-shortsword", [15], { commit: false, distanceFeet: far }).hitOffers).toBeUndefined();
    // An Incapacitated ally doesn't count.
    near.state.actors.find((actor) => actor.id === ALLY)!.conditions = [{ id: "stunned" }];
    expect(swing(near, "item-shortsword", [15], { commit: false, distanceFeet: beside }).hitOffers).toBeUndefined();
  });

  it("is offered for the attacker to vouch for when the map can't measure", () => {
    const built = withAlly(5);
    const offer = swing(built, "item-shortsword", [15], { commit: false }).hitOffers?.[0];
    expect(offer).toMatchObject({ id: "sneak-attack" });
    expect(offer?.unverified).toMatch(/ally is within 5 feet/);
  });
});

describe("Rogue: Evasion on a Dexterity save for half damage", () => {
  const fireball = (built: Table, total: number, dc = 15) => {
    createPendingSaves(built.state, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Fireball",
      ability: "dex",
      dc,
      targetIds: [IDS.hero],
      proposedDamage: 28,
      proposedDamageParts: [{ amount: 28, type: "fire" }],
      halfOnSuccess: true,
      conditionIds: [],
      newSaveId: () => "60000000-0000-4000-8000-000000000077",
      createdAt: 0
    });
    return answerSave(
      built.state,
      nextCommandId(),
      "60000000-0000-4000-8000-000000000077",
      "manual",
      total,
      true,
      GM_SCOPE,
      {
        random: () => 1,
        newRollId: () => "40000000-0000-4000-8000-0000000000aa",
        sessionId: IDS.gm,
        role: "gm",
        now: () => "2026-08-07T00:00:00.000Z",
        resolveDefinition: (id) => resolveIn(built.state, id),
        catalog: built.catalog
      }
    ).outcome.appliedDamage;
  };

  it("takes none on a success and half on a failure from level 7", () => {
    const seven = table(rogueInput(7));
    expect(fireball(seven, 20)).toBe(0);
    expect(fireball(seven, 5)).toBe(14);
    // A level-6 Rogue has no Evasion yet.
    const six = table(rogueInput(6));
    expect(fireball(six, 20)).toBe(14);
    expect(fireball(six, 5)).toBe(28);
  });

  it("is lost while Incapacitated", () => {
    const built = table(rogueInput(7));
    built.hero.conditions = [{ id: "incapacitated" }];
    expect(fireball(built, 20)).toBe(14);
  });
});

describe("Rogue: Uncanny Dodge halves the damage that hit", () => {
  it("parks the attack's damage on a reaction prompt and halves it when used", () => {
    // `reaction: {trigger: "hit-by-attack", response: "half-damage"}`: the foe hits the Rogue, the
    // resolver offers the prompt, and answering it applies half. Without it full damage lands (below).
    const built = table(rogueInput(11));
    const bite = {
      id: "bite",
      name: "Bite",
      activation: "action" as const,
      description: "A bite.",
      damage: [{ formula: "2d6", type: "piercing" }],
      attack: { bonus: 20 }
    };
    const before = built.hero.hp.current;
    // The foe bites on its own turn.
    built.state.combat = { ...built.state.combat, turnActorId: IDS.foe };
    const hit = resolveDefinitionAction(
      built.state,
      bite,
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined }
    );
    expect(hit.attack?.outcome).toBe("hit");
    const pending = built.state.combat.pendingReactions;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "hit-by-attack", actionName: "Uncanny Dodge", proposedDamage: 10 });

    const outcome = answerReaction(built.state, nextCommandId(), pending[0].id, true, undefined, GM_SCOPE, {
      random: () => 1,
      newRollId: () => "40000000-0000-4000-8000-0000000000ff",
      gmSessionId: IDS.gm,
      now: () => "2026-08-07T00:00:00.000Z",
      catalog: built.catalog,
      resolveDefinition: (id: string) => resolveIn(built.state, id)
    });
    expect(outcome.appliedDamage).toBe(5); // 10 halved, floor, before defenses
    expect(built.hero.hp.current).toBe(before - 5);
  });

  it("offers NO prompt to a level-4 Rogue, who has not gained the feature", () => {
    // Negative control: Uncanny Dodge is a level-5 feature.
    const built = table(rogueInput(4));
    const bite = {
      id: "bite",
      name: "Bite",
      activation: "action" as const,
      description: "A bite.",
      damage: [{ formula: "2d6", type: "piercing" }],
      attack: { bonus: 20 }
    };
    built.state.combat = { ...built.state.combat, turnActorId: IDS.foe };
    resolveDefinitionAction(
      built.state,
      bite,
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined }
    );
    expect(built.state.combat.pendingReactions).toEqual([]);
  });
});

describe("Rogue: the flat grants and the pick", () => {
  it("puts Thieves' Cant on the sheet's languages", () => {
    expect(table(rogueInput(1)).definition.proficiencies?.languages).toContain("thieves-cant");
  });

  it("adds Wisdom and Charisma saves at level 15 and NOT at level 14", () => {
    // Slippery Mind is `grants.saves`, the array every save is rolled from. The Rogue prints Dex and Int
    // at level 1.
    const fifteen = table(rogueInput(15)).definition.proficiencies?.saves ?? [];
    expect([...fifteen].sort()).toEqual(["cha", "dex", "int", "wis"]);
    const fourteen = table(rogueInput(14)).definition.proficiencies?.saves ?? [];
    expect([...fourteen].sort()).toEqual(["dex", "int"]);
  });

  it("REFUSES a level-19 Rogue with no Epic Boon feat, and puts the chosen one on the sheet", () => {
    // The level-19 feat pick must be offered, so a build without it is refused.
    const missing = rogueInput(19);
    missing.choices = missing.choices.filter(
      (row) => row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-irresistible-offense"
    );
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Epic Boon" needs 1 pick\(s\) of kind "feat"/
    );
    expect(table(rogueInput(19)).definition.character?.feats?.map((feat) => feat.id)).toContain(
      "boon-of-irresistible-offense"
    );
  });

  it("turns a failed check into a 20 with Stroke of Luck once, and offers it no second time before a rest", () => {
    const built = table(rogueInput(20));
    const checkDeps = (faces: number[]): CheckRollDependencies => ({
      random: () => faces.shift()!,
      newId: nextCommandId,
      sessionId: IDS.gm,
      now: () => "2026-07-27T00:00:00.000Z",
      resolveDefinition: (id) => resolveIn(built.state, id),
      catalog: built.catalog
    });
    const stealth = (face: number) =>
      rollAbilityCheck(
        built.state,
        { role: "gm" },
        {
          commandId: nextCommandId(),
          actorId: IDS.hero,
          subject: { ability: "int" },
          dc: 30,
          visibility: "public"
        },
        checkDeps([face])
      );
    expect(stealth(4).outcome.answers?.map((offer) => offer.id)).toContain("stroke-of-luck");
    const turned = answerAbilityCheck(
      built.state,
      { role: "gm" },
      { commandId: nextCommandId(), actorId: IDS.hero, answer: { id: "stroke-of-luck" } },
      checkDeps([])
    );
    expect(turned.outcome.natural).toBe(20);
    expect(built.hero.actionUses["stroke-of-luck"]).toBe(1);
    expect(stealth(4).outcome.answers?.map((offer) => offer.id) ?? []).not.toContain("stroke-of-luck");
  });

  it("gives Steady Aim's Bonus Action a real Advantage effect", () => {
    const built = table(rogueInput(11));
    expect(actionOf(built, "steady-aim")?.activation).toBe("bonus-action");
    resolve(built, "steady-aim", [], []);
    const granted = built.hero.effects.find((effect) => effect.tags.includes("steady-aim"));
    expect(granted?.modifiers).toEqual([{ type: "roll-mode", roll: "attack", mode: "advantage" }]);
  });

  it("spends Steady Aim's Advantage on the next attack roll, and holds Speed at 0 until the turn ends", () => {
    const built = table(rogueInput(11));
    resolve(built, "steady-aim", [], []);
    const aiming = () => built.hero.effects.find((effect) => effect.tags.includes("steady-aim"));
    // "Your Speed is 0 until the end of the current turn", and the Advantage is for this turn only.
    expect(aiming()).toMatchObject({
      speedZero: true,
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
    });
    expect(currentSpeedFeet(built.hero, deriveEquipment(built.hero, built.definition, built.catalog))).toBe(0);
    const swung = swing(built, "item-shortsword", [4, 15, 3]);
    expect(swung.rollMode).toMatchObject({ mode: "advantage" });
    expect(swung.attack!.naturalRoll).toBe(15);
    // The roll spent the Advantage; Speed 0 stays to the end of the turn.
    expect(aiming()).toMatchObject({ name: "Steady Aim (Speed 0)", modifiers: [], speedZero: true });
    nextInitiativeTurn(built.state);
    expect(aiming()).toBeUndefined();
  });

  it("refuses Steady Aim once the Rogue has moved this turn", () => {
    const built = table(rogueInput(11));
    built.state.combat = { ...built.state.combat, turn: { ...built.state.combat.turn, movementUsedFeet: 10 } };
    expect(() => resolve(built, "steady-aim", [], [])).toThrowError(
      /has moved this turn, and Steady Aim is only for a creature that hasn't/
    );
  });

  it("makes the Thief's Fast Hands a Bonus Action", () => {
    expect(actionOf(table(rogueInput(11)), "fast-hands")?.activation).toBe("bonus-action");
  });
});

// Ranger

/** The prepared-spell picks a half-caster owes at `level`, derived from the printed table. */
function preparedPicks(classId: string, level: number, granted: readonly string[]): string[] {
  const record = library.classRecord(classId)!;
  const row = record.levelTable[level - 1];
  const maxSlotLevel = (row.spellSlots ?? []).reduce((highest, count, index) => (count > 0 ? index + 1 : highest), 0);
  const pool = library
    .spellSummaries()
    .filter(
      (spell) =>
        spell.classes.includes(record.spellcasting!.spellListId!) &&
        spell.level >= 1 &&
        spell.level <= maxSlotLevel &&
        !granted.includes(spell.id)
    )
    .map((spell) => spell.id);
  const owed = row.preparedCount ?? 0;
  if (pool.length < owed)
    throw new Error(`${classId} ${level} owes ${owed} prepared spells and the list offers ${pool.length}`);
  return pool.slice(0, owed);
}

/** A Halfling Criminal Ranger. `wisFocus` sends every ASI into Wisdom, which moves the ability-scaled pools. */
const rangerInput = (level: number, options: { wisFocus?: boolean } = {}): MutableInput => {
  const asiLevels = [4, 8, 12, 16].filter((asi) => asi <= level);
  const bumped = options.wisFocus ? "wis" : "dex";
  return {
    name: "Ash",
    speciesId: "halfling",
    backgroundId: "criminal",
    classId: "ranger",
    level,
    ...(level >= 3 ? { subclassId: "hunter" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "dex", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      // Deft Explorer raises `species-languages` by two from level 2 ("you learn two languages of your
      // choice"), so a Ranger past level 1 is offered four.
      ...(level >= 2
        ? [
            { level: 2, kind: "language", id: "goblin" },
            { level: 2, kind: "language", id: "orc" }
          ]
        : []),
      { level: 1, classId: "ranger", kind: "skill", id: "survival" },
      { level: 1, classId: "ranger", kind: "skill", id: "perception" },
      { level: 1, classId: "ranger", kind: "skill", id: "nature" },
      { level: 1, classId: "ranger", kind: "weapon-mastery", id: "longbow" },
      { level: 1, classId: "ranger", kind: "weapon-mastery", id: "shortsword" },
      ...(level >= 2
        ? [
            {
              level: 2,
              classId: "ranger",
              kind: "fighting-style",
              id: "defense",
              payload: { featureId: "fighting-style" }
            },
            {
              level: 2,
              classId: "ranger",
              kind: "expertise",
              id: "perception",
              payload: { featureId: "deft-explorer" }
            }
          ]
        : []),
      ...(level >= 3
        ? [
            { level: 3, classId: "ranger", kind: "subclass", id: "hunter" },
            { level: 3, kind: "hunters-prey", id: "colossus-slayer", payload: { featureId: "hunters-prey" } }
          ]
        : []),
      ...(level >= 7
        ? [{ level: 7, kind: "defensive-tactics", id: "escape-the-horde", payload: { featureId: "defensive-tactics" } }]
        : []),
      ...(level >= 9
        ? [
            { level: 9, classId: "ranger", kind: "expertise", id: "survival", payload: { featureId: "expertise" } },
            { level: 9, classId: "ranger", kind: "expertise", id: "nature", payload: { featureId: "expertise" } }
          ]
        : []),
      ...asiRows("ranger", asiLevels, [bumped, "con", "str"], { dex: 16, wis: 15, con: 14, str: 12 }),
      ...(level >= 19
        ? [
            {
              level: 19,
              classId: "ranger",
              kind: "feat",
              id: "boon-of-dimensional-travel",
              payload: { featureId: "epic-boon" }
            },
            { level: 19, kind: "ability-score", id: "con", payload: { featureId: "boon-of-dimensional-travel" } }
          ]
        : []),
      ...preparedPicks("ranger", level, ["hunters-mark"]).map((id) => ({ level: 1, kind: "spell" as const, id })),
      { level: 1, kind: "equipment", id: "ranger-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Ranger: Favored Enemy, audit row 32", () => {
  it("hands over Hunter's Mark ALWAYS prepared, without charging the prepared budget", () => {
    // SRD: a feature-granted always-prepared spell "doesn't count against the number of spells you can
    // prepare". A level-5 Ranger prints 6, so the sheet holds seven spells and reports a budget of 6.
    const built = table(rangerInput(5));
    const spells = built.definition.spellcasting?.spells ?? [];
    expect(spells.find((spell) => spell.id === "hunters-mark")).toMatchObject({ alwaysPrepared: true, level: 1 });
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "ranger", prepared: 6 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(6);
  });

  it("gives exactly as many free casts as the printed Favored Enemy column, at two levels", () => {
    // The column reads 2 at level 1 and 6 at level 17, via `scaling: {type: "class-resource"}`. The free casts
    // are Hunter's Mark cast without a slot, counted on the feature's pool.
    // A Bonus Action each, so each cast is its own turn, and each marks the foe.
    const mark = (built: Table) => {
      newTurn(built);
      return resolve(built, "spell-hunters-mark-free", []);
    };
    const first = table(rangerInput(1));
    mark(first);
    mark(first);
    expect(first.hero.actionUses["favored-enemy"]).toBe(2);
    expect(first.foe.effects.map((effect) => effect.name)).toEqual(["Hunter's Mark"]);
    expect(() => mark(first)).toThrowError(/Hunter's Mark \(no slot\): no uses remaining \(2\/Long Rest\)/);

    const late = table(rangerInput(17));
    for (let cast = 0; cast < 6; cast += 1) mark(late);
    expect(late.hero.actionUses["favored-enemy"]).toBe(6);
    expect(() => mark(late)).toThrowError(/Hunter's Mark \(no slot\): no uses remaining \(6\/Long Rest\)/);
  });
});

describe("Ranger: the rest of the kit", () => {
  it("REFUSES a level-2 Ranger with no Deft Explorer Expertise, and grants it when chosen", () => {
    const missing = rangerInput(2);
    missing.choices = missing.choices.filter((row) => row.payload?.featureId !== "deft-explorer");
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Deft Explorer" needs 1 pick\(s\) of kind "expertise"/
    );
    const skills = table(rangerInput(2)).definition.proficiencies?.skills ?? [];
    expect(skills.find((skill) => skill.id === "perception")?.proficiency).toBe("expertise");
  });

  it("adds Roving's 10 feet at level 6 and not at level 5", () => {
    expect(table(rangerInput(6)).definition.speedFeet).toBe(40);
    expect(table(rangerInput(5)).definition.speedFeet).toBe(30);
  });

  it("takes Roving's 10 feet away while Heavy armor is worn", () => {
    const built = table(rangerInput(6));
    const speed = () => currentSpeedFeet(built.hero, deriveEquipment(built.hero, built.definition, built.catalog));
    expect(speed()).toBe(40);
    built.hero.inventory = [
      ...built.hero.inventory.map((item) => (item.armor ? { ...item, equipped: false } : item)),
      {
        id: "plate",
        name: "Plate Armor",
        quantity: 1,
        equipped: true,
        attuned: false,
        category: "armor",
        armor: {
          acBase: 18,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: true,
          strengthRequired: null
        }
      }
    ];
    expect(speed()).toBe(30);
  });

  it("scales Tireless off the FINAL Wisdom modifier, so an ASI moves the pool", () => {
    // `scaling: {type: "ability-modifier"}` resolves against the built scores: same record, same level,
    // two different numbers.
    // Each use rolls its 1d8 of Temporary Hit Points.
    const tire = (built: Table) => {
      newTurn(built);
      return resolve(built, "tireless", [4], []);
    };
    const plain = table(rangerInput(10)); // Wis 15 -> +2
    for (let use = 0; use < 2; use += 1) tire(plain);
    expect(plain.hero.actionUses["tireless"]).toBe(2);
    newTurn(plain);
    expect(() => resolve(plain, "tireless", [], [])).toThrowError(/Tireless: no uses remaining \(2\/Long Rest\)/);

    const focused = table(rangerInput(10, { wisFocus: true })); // Wis 15 + 4 -> +4
    for (let use = 0; use < 4; use += 1) tire(focused);
    expect(focused.hero.actionUses["tireless"]).toBe(4);
    newTurn(focused);
    expect(() => resolve(focused, "tireless", [], [])).toThrowError(/Tireless: no uses remaining \(4\/Long Rest\)/);
  });

  it("gives Tireless's 1d8 + Wisdom as Temporary Hit Points, and takes a level of Exhaustion off at a Short Rest", () => {
    const built = table(rangerInput(10)); // Wis 15 -> +2
    resolve(built, "tireless", [5], []);
    expect(built.hero.hp.temporary).toBe(7);
    built.hero.conditions = [{ id: "exhaustion", level: 2 }];
    built.state.combat = { ...built.state.combat, active: false };
    applyRest(built.state, IDS.hero, "short", (id) => resolveIn(built.state, id));
    expect(built.hero.conditions).toEqual([{ id: "exhaustion", level: 1 }]);
  });

  it("makes Nature's Veil a Bonus Action with its own Wisdom-sized pool", () => {
    const built = table(rangerInput(14));
    expect(actionOf(built, "natures-veil")?.activation).toBe("bonus-action");
    spend(built, "natures-veil");
    spend(built, "natures-veil");
    expect(built.hero.actionUses["natures-veil"]).toBe(2);
    // A separate pool from Tireless's, as the SRD reads it.
    expect(built.hero.actionUses["tireless"]).toBeUndefined();
    newTurn(built);
    expect(() => resolve(built, "natures-veil", [], [])).toThrowError(
      /Nature's Veil: no uses remaining \(2\/Long Rest\)/
    );
  });

  it("gives the Ranger the Invisible condition until the end of its next turn", () => {
    const built = table(rangerInput(14));
    resolve(built, "natures-veil", [], []);
    expect(built.hero.conditions.map((condition) => condition.id)).toEqual(["invisible"]);
    // Taken on its own turn, so the end of this turn doesn't count.
    expect(built.hero.effects[0]).toMatchObject({
      name: "Nature's Veil",
      duration: { type: "until-source-turn-end", skipsCurrentTurn: true }
    });
  });

  it("REFUSES a level-19 Ranger with no Epic Boon feat", () => {
    const missing = rangerInput(19);
    missing.choices = missing.choices.filter(
      (row) => row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-dimensional-travel"
    );
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Epic Boon" needs 1 pick\(s\) of kind "feat"/
    );
  });

  it("carries Feral Senses as a rider on the sheet: display-level, and knowingly so", () => {
    // `CARRIER_RIDER_DISPOSITION` records `sense` as display-only: it reaches the rider carriers and no
    // consumer applies it. Asserted only at that seam.
    const built = table(rangerInput(18));
    const carrier = deriveEquipment(built.hero, built.definition, built.catalog).carriers.find(
      (entry) => entry.label === "Feral Senses"
    );
    expect(carrier?.modifiers).toEqual([{ type: "sense", sense: "blindsight", feet: 30 }]);
  });

  it("takes Extra Attack all the way to a SECOND WEAPON SWING: the engine gap, closed", () => {
    // `extra-attack` is a standing rider: a Ranger declares no feature actions (swings come from equipped
    // inventory), so `effective-actions.ts` raises the count on the derived weapon swings.
    const built = table(rangerInput(5));
    expect(built.definition.character?.features?.map((entry) => entry.id)).toContain("extra-attack");
    const bow = effectiveActions(built.definition, built.hero, built.catalog).find(
      (entry) => entry.id === "item-longbow"
    );
    expect(bow?.attack?.count).toBe(2);

    // A second arrow that really resolves.
    expect(resolve(built, "item-longbow", [17, 5]).componentsRemaining).toEqual({ attack: 1 });
    expect(resolve(built, "item-longbow", [14, 6]).componentsRemaining).toBeNull();
    expect(() => resolve(built, "item-longbow", [19, 4])).toThrow(/no attacks remaining in this action/);

    // Level 4, one level before the feature: still one arrow.
    const before = table(rangerInput(4));
    const single = effectiveActions(before.definition, before.hero, before.catalog).find(
      (entry) => entry.id === "item-longbow"
    );
    expect(single?.attack?.count ?? 1).toBe(1);
  });
});

describe("Ranger: Hunter's Prey and Defensive Tactics, audit rows 21 and 22", () => {
  it("REFUSES a Hunter who chose neither option, and puts the chosen one on the sheet", () => {
    // The Hunter's picks are real: a build without them is refused.
    const missing = rangerInput(3);
    missing.choices = missing.choices.filter((row) => row.kind !== "hunters-prey");
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Hunter's Prey" needs 1 pick\(s\) of kind "hunters-prey"/
    );

    const traits = (
      table(rangerInput(3)).definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }
    ).traits.map((trait) => trait.name);
    expect(traits).toContain("Colossus Slayer");
    expect(traits).not.toContain("Horde Breaker");
  });

  it("refuses an option that is not one of the two printed", () => {
    const bogus = rangerInput(3);
    bogus.choices = bogus.choices.map((row) => (row.kind === "hunters-prey" ? { ...row, id: "colossal-slayer" } : row));
    expect(() => buildCharacterDefinition(bogus, library, policy)).toThrowError(/not an offered option/);
  });

  it("offers Defensive Tactics at level 7 and refuses a build that skipped it", () => {
    const missing = rangerInput(7);
    missing.choices = missing.choices.filter((row) => row.kind !== "defensive-tactics");
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Defensive Tactics" needs 1 pick\(s\) of kind "defensive-tactics"/
    );
    const traits = (
      table(rangerInput(7)).definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }
    ).traits.map((trait) => trait.name);
    expect(traits).toContain("Escape the Horde");
  });

  it("gives a creature that hit a Multiattack Defense Ranger Disadvantage on its other attacks this turn", () => {
    const input = rangerInput(7);
    input.choices = input.choices.map((row) =>
      row.kind === "defensive-tactics" ? { ...row, id: "multiattack-defense" } : row
    );
    const built = table(input);
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.foe,
      ruleExceptions: { economy: "freeform" }
    };
    const claw: ActorAction = {
      id: "claw",
      name: "Claw",
      activation: "action",
      description: "Melee Attack Roll: +5, reach 5 ft. Hit: 4 (1d6) Slashing damage.",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [{ formula: "1d6", type: "slashing" }]
    };
    const swing = (faces: number[], commit = true) =>
      resolveDefinitionAction(
        built.state,
        claw,
        { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId(), commit },
        { ...deps(built, faces), definition: undefined }
      );
    expect(swing([19, 4]).attack?.outcome).toBe("hit");
    expect(built.hero.effects).toEqual([
      expect.objectContaining({ name: "Multiattack Defense", sourceActorId: IDS.foe })
    ]);
    expect(swing([10, 12], false).rollMode).toMatchObject({ mode: "disadvantage" });
    // The foe's turn ends, and the mark with it.
    nextInitiativeTurn(built.state, [], {
      resolveDefinition: (id) => resolveIn(built.state, id),
      rollDie: () => 3,
      newId: nextCommandId,
      now: () => "2026-08-07T00:00:00.000Z"
    });
    expect(built.hero.effects).toEqual([]);
  });

  it("gives Opportunity Attacks against an Escape the Horde Ranger Disadvantage, and no other attack", () => {
    const built = table(rangerInput(7));
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    const claims = (attackKinds: NonNullable<Parameters<typeof rollModeClaims>[3]>["attackKinds"]) =>
      rollModeClaims(derivation, ["incoming-attack"], "on-attack-roll", { attackKinds }).disadvantage;
    expect(claims(["melee", "reaction", "opportunity"])).toEqual([
      expect.objectContaining({ label: expect.stringContaining("Escape the Horde") })
    ]);
    expect(claims(["melee"])).toEqual([]);
  });
});

// Paladin

/** The always-prepared spells a Paladin's own features hand over, by level: excluded from the picks. */
const paladinGranted = (level: number): string[] => [
  ...(level >= 2 ? ["divine-smite"] : []),
  ...(level >= 3 ? ["protection-from-evil-and-good", "shield-of-faith"] : []),
  ...(level >= 5 ? ["find-steed", "aid", "zone-of-truth"] : []),
  ...(level >= 9 ? ["beacon-of-hope", "dispel-magic"] : []),
  ...(level >= 13 ? ["freedom-of-movement", "guardian-of-faith"] : []),
  ...(level >= 17 ? ["commune", "flame-strike"] : [])
];

/** A Halfling Criminal Paladin of Devotion. Charisma 14 after the array, so the spell save DC moves with proficiency. */
const paladinInput = (level: number): MutableInput => {
  const asiLevels = [4, 8, 12, 16].filter((asi) => asi <= level);
  return {
    name: "Bree",
    speciesId: "halfling",
    backgroundId: "criminal",
    classId: "paladin",
    level,
    ...(level >= 3 ? { subclassId: "oath-of-devotion" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 14 },
    backgroundBonusAllocation: [
      { ability: "dex", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "paladin", kind: "skill", id: "athletics" },
      { level: 1, classId: "paladin", kind: "skill", id: "persuasion" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "longsword" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "javelin" },
      ...(level >= 2
        ? [
            {
              level: 2,
              classId: "paladin",
              kind: "fighting-style",
              id: "defense",
              payload: { featureId: "fighting-style" }
            }
          ]
        : []),
      ...(level >= 3 ? [{ level: 3, classId: "paladin", kind: "subclass", id: "oath-of-devotion" }] : []),
      ...asiRows("paladin", asiLevels, ["str", "con", "cha"], { str: 15, con: 14, cha: 14 }),
      ...(level >= 19
        ? [
            {
              level: 19,
              classId: "paladin",
              kind: "feat",
              id: "boon-of-truesight",
              payload: { featureId: "epic-boon" }
            },
            { level: 19, kind: "ability-score", id: "cha", payload: { featureId: "boon-of-truesight" } }
          ]
        : []),
      ...preparedPicks("paladin", level, paladinGranted(level)).map((id) => ({ level: 1, kind: "spell" as const, id })),
      { level: 1, kind: "equipment", id: "paladin-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Paladin: the two free casts, audit rows 30 and 31", () => {
  it("always has Divine Smite prepared and casts it free ONCE per Long Rest", () => {
    const built = table(paladinInput(5));
    const spells = built.definition.spellcasting?.spells ?? [];
    expect(spells.find((spell) => spell.id === "divine-smite")).toMatchObject({ alwaysPrepared: true });
    // The printed budget at level 5 is 6: six chosen spells plus the six its features grant.
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ prepared: 6 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(6);

    // The free cast is Divine Smite without a slot, counted on the feature's own pool, added to a hit.
    newTurn(built);
    swing(built, "item-longsword", [19, 6, 3, 4], { hitOptions: [{ id: "spell-divine-smite-free" }] });
    expect(built.hero.actionUses["paladins-smite"]).toBe(1);
    newTurn(built);
    expect(() =>
      swing(built, "item-longsword", [19, 6, 3, 4], { hitOptions: [{ id: "spell-divine-smite-free" }] })
    ).toThrowError(/Divine Smite \(no slot\): no uses remaining \(1\/Long Rest\)/);
  });

  it("always has Find Steed prepared from level 5, on its OWN pool", () => {
    const built = table(paladinInput(5));
    expect((built.definition.spellcasting?.spells ?? []).find((spell) => spell.id === "find-steed")).toMatchObject({
      alwaysPrepared: true,
      level: 2
    });
    spend(built, "spell-find-steed-free");
    expect(built.hero.actionUses["faithful-steed"]).toBe(1);
    expect(built.hero.actionUses["paladins-smite"]).toBeUndefined();
    // ...and a level-4 Paladin has neither the spell nor the pool.
    const early = table(paladinInput(4));
    expect((early.definition.spellcasting?.spells ?? []).some((spell) => spell.id === "find-steed")).toBe(false);
  });

  it("gives a Devotion Paladin's aura Smite of Protection's Half Cover when Divine Smite rides a hit", () => {
    const built = table(paladinInput(15));
    newTurn(built);
    // The d20, the longsword's d8, Radiant Strikes' d8 and the smite's dice.
    swing(built, "item-longsword", [19, 6, 3, 4, 4, 4, 4, 4, 4], { hitOptions: [{ id: "spell-divine-smite-free" }] });
    expect(built.hero.effects.find((effect) => effect.tags.includes("smite-of-protection"))).toMatchObject({
      name: "Smite of Protection",
      duration: { type: "until-source-next-turn" }
    });
  });
});

describe("Paladin: Channel Divinity is ONE counter that three features spend", () => {
  it("drains the printed column across Divine Sense, Abjure Foes and Sacred Weapon", () => {
    // The column prints 2 at level 3. Two spends of any of the three exhaust all three, which is what
    // `uses.pool` means; a per-action key would give each feature its own two.
    const built = table(paladinInput(9));
    spend(built, "divine-sense");
    spend(built, "sacred-weapon");
    expect(built.hero.actionUses["channel-divinity"]).toBe(2);
    newTurn(built);
    expect(() => resolve(built, "abjure-foes", [], [IDS.foe])).toThrowError(
      /Abjure Foes: no uses remaining \(2\/Long Rest\)/
    );
  });

  it("follows the column to 3 uses at level 11", () => {
    const built = table(paladinInput(11));
    for (let use = 0; use < 3; use += 1) spend(built, "divine-sense");
    expect(built.hero.actionUses["channel-divinity"]).toBe(3);
    newTurn(built);
    expect(() => resolve(built, "divine-sense", [], [])).toThrowError(
      /Divine Sense: no uses remaining \(3\/Long Rest\)/
    );
  });

  it("holds Abjure Foes' targets to THIS Paladin's spell save DC", () => {
    // `dc: "spellcasting"` is 8 + proficiency + Charisma modifier from the built sheet: at level 9,
    // 8 + 4 + 2 = 14.
    const built = table(paladinInput(9));
    expect(actionOf(built, "abjure-foes")?.save).toEqual({
      ability: "wis",
      dc: 14,
      spellcasting: true,
      successDamage: "none",
      failureConditions: ["frightened"],
      // "for 1 minute or until it takes any damage".
      failureDuration: { type: "rounds", rounds: 10 },
      endsOnDamage: true
    });
    const resolution = resolve(built, "abjure-foes", [], [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "wis", dc: 14 });
  });
});

describe("Paladin: the auras that are really immunities", () => {
  // The auras are gated grants (inactive while the Paladin is Incapacitated), read live through the catalog as
  // every command path passes it.
  const immunitiesOf = (built: Table) => ({ resolveDefinition: () => built.definition, catalog: built.catalog });

  it("REFUSES the Frightened condition on a level-10 Paladin, and says so at the table", () => {
    // `grants.conditionImmunities` is enforced with narration in the fight log. The level-9 build is the
    // negative control.
    const brave = table(paladinInput(10));
    const events = setCondition(brave.state, IDS.hero, "frightened", true, undefined, GM_SCOPE, immunitiesOf(brave));
    expect(events).toEqual([
      { kind: "condition", text: "Bree is immune to Frightened, so it isn't applied.", actorId: IDS.hero, immune: true }
    ]);
    expect(brave.hero.conditions).toEqual([]);

    const earlier = table(paladinInput(9));
    setCondition(earlier.state, IDS.hero, "frightened", true, undefined, GM_SCOPE, immunitiesOf(earlier));
    expect(earlier.hero.conditions).toEqual([{ id: "frightened" }]);
  });

  it("REFUSES Charmed from Oath of Devotion's level-7 aura", () => {
    const devoted = table(paladinInput(7));
    expect(
      setCondition(devoted.state, IDS.hero, "charmed", true, undefined, GM_SCOPE, immunitiesOf(devoted))[0].text
    ).toBe("Bree is immune to Charmed, so it isn't applied.");
    // Frightened is not immune yet: the class aura is level 10.
    setCondition(devoted.state, IDS.hero, "frightened", true, undefined, GM_SCOPE, immunitiesOf(devoted));
    expect(devoted.hero.conditions).toEqual([{ id: "frightened" }]);
  });

  it("goes quiet while the Paladin is Incapacitated (SRD: the aura is inactive)", () => {
    const brave = table(paladinInput(10));
    setCondition(brave.state, IDS.hero, "stunned", true, undefined, GM_SCOPE, immunitiesOf(brave));
    setCondition(brave.state, IDS.hero, "frightened", true, undefined, GM_SCOPE, immunitiesOf(brave));
    expect(brave.hero.conditions.map((condition) => condition.id)).toEqual(["frightened", "stunned"]);
  });
});

describe("Paladin: Divine Smite rides a melee hit", () => {
  it("adds 2d8 Radiant, doubled on a crit, with the extra 1d8 against an Undead, and spends the slot and Bonus Action", () => {
    const built = table(paladinInput(5));
    const zombie = loadMonsterDefinitions().find((monster) => monster.source.externalId === "zombie")!;
    built.state.definitions.push({ id: "zombie", definition: zombie });
    built.foe.definitionId = "zombie";
    const slotsBefore = built.hero.spellSlots?.find((slot) => slot.level === 1)?.remaining ?? 0;
    const preview = swing(built, "item-longsword", [20], { commit: false });
    expect(preview.hitOffers?.map((offer) => offer.id)).toEqual(
      expect.arrayContaining(["spell-divine-smite", "spell-divine-smite-free"])
    );
    expect(preview.hitOffers?.find((offer) => offer.id === "spell-divine-smite")).toMatchObject({
      dice: "2d8 Radiant",
      slotLevels: [1, 2]
    });
    // A crit: the longsword's 2d8, the smite's 4d8, and the Undead's 2d8.
    const crit = swing(built, "item-longsword", [20, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], {
      hitOptions: [{ id: "spell-divine-smite", slotLevel: 1 }]
    });
    expect(crit.damage.filter((part) => part.source?.startsWith("Divine Smite"))).toEqual([
      { formula: "4d8", type: "radiant", total: 8, source: "Divine Smite" },
      { formula: "2d8", type: "radiant", total: 6, source: "Divine Smite (Undead)" }
    ]);
    expect(built.hero.spellSlots?.find((slot) => slot.level === 1)?.remaining).toBe(slotsBefore - 1);
    expect(built.state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("rides a Melee weapon even thrown (a Javelin), never a miss", () => {
    // "A Melee weapon or an Unarmed Strike" names the weapon, however it was used.
    const built = table(paladinInput(5));
    const thrown = resolveDefinitionAction(
      built.state,
      actionOf(built, "item-javelin")!,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextCommandId(), commit: false },
      { ...deps(built, [19]), distanceFeet: () => 30 }
    );
    expect((thrown.hitOffers ?? []).some((offer) => offer.id === "spell-divine-smite")).toBe(true);
    expect(swing(built, "item-longsword", [2], { commit: false }).hitOffers).toBeUndefined();
  });
});

/** A Paladin input with `spellId` prepared in place of its first pick. */
const preparing = (input: MutableInput, spellId: string): MutableInput => {
  const first = input.choices.findIndex((row) => row.kind === "spell");
  input.choices[first] = { ...input.choices[first], id: spellId } as MutableInput["choices"][number];
  return input;
};

describe("Paladin: smites that outlast the hit", () => {
  it("Shining Smite gives the Paladin its Concentration, ends the one held before, and its mark ends with it", () => {
    const built = table(preparing(paladinInput(5), "shining-smite"));
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "bless",
        name: "Concentrating on Bless",
        tags: ["concentrating"],
        sourceActorId: IDS.hero,
        concentration: true,
        castId: "bless",
        duration: { type: "rounds", remaining: 10 }
      })
    );
    const result = swing(built, "item-longsword", [19, 4, 3, 3, 3, 3], {
      hitOptions: [{ id: "spell-shining-smite", slotLevel: 2 }]
    });
    expect(built.hero.effects.map((effect) => effect.name)).toEqual(["Concentrating on Shining Smite"]);
    expect(result.effectsApplied?.map((applied) => applied.name)).toEqual(
      expect.arrayContaining(["Concentrating on Shining Smite", "Shining Smite"])
    );
    const mark = built.foe.effects.find((effect) => effect.name === "Shining Smite")!;
    expect(mark.castId).toBe(built.hero.effects[0].castId);
    // Dropping the Concentration ends the mark.
    endEffect(built.state, IDS.hero, built.hero.effects[0].id);
    expect(built.foe.effects.map((effect) => effect.name)).toEqual(["Sapped by Bree"]);
  });

  it("Searing Smite keeps burning: its slot's dice at the start of each of the target's turns, then the spell's save", () => {
    const built = table(preparing(paladinInput(5), "searing-smite"));
    const result = swing(built, "item-longsword", [19, 4, 2, 2, 2, 2], {
      hitOptions: [{ id: "spell-searing-smite", slotLevel: 2 }]
    });
    // The cast itself asks for no save: the save is the spell's own, at the Paladin's spell save DC.
    expect(actionOf(built, "spell-searing-smite")!.save).toBeUndefined();
    const dc = built.definition.spellcasting!.saveDc;
    expect(built.foe.effects.find((effect) => effect.name === "Searing Smite")).toMatchObject({
      sourceActorId: IDS.hero,
      duration: { type: "rounds", remaining: 10 },
      ongoingDamage: {
        damage: [{ formula: "2d6", type: "fire" }],
        at: "bearer-turn-start",
        saveToEnd: { ability: "con", dc }
      }
    });
    // The engine runs it, so it is no longer a note for the table.
    expect(result.warnings ?? []).not.toContainEqual(expect.stringMatching(/^Searing Smite:/));
  });
});

describe("Paladin: Radiant Strikes rolls extra dice on a melee hit", () => {
  it("adds 1d8 Radiant to a Melee weapon hit at level 11 and nothing at level 10", () => {
    // A roll-time rider gated `on-hit` + `attack-kind-is: ["melee", "unarmed"]`: a second damage entry
    // on the resolution, rolled and typed.
    const built = table(paladinInput(11));
    const hit = resolve(built, "item-longsword", [19, 6, 7]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.damage.find((part) => part.type === "radiant")).toMatchObject({ formula: "1d8", total: 7 });

    const earlier = table(paladinInput(10));
    const plain = resolve(earlier, "item-longsword", [19, 6]);
    expect(plain.attack?.outcome).toBe("hit");
    expect(plain.damage.some((part) => part.type === "radiant")).toBe(false);
  });

  it("rolls its 1d8 twice on a critical hit, like the weapon's own dice", () => {
    // SRD Critical Hits: "If the attack involves other damage dice ... you also roll those dice twice."
    const built = table(paladinInput(11));
    const crit = resolve(built, "item-longsword", [20, 6, 5, 7, 3]);
    expect(crit.attack?.outcome).toBe("crit");
    expect(crit.damage.find((part) => part.type === "radiant")).toMatchObject({ formula: "2d8", total: 10 });
  });

  it("adds nothing to the javelin the SAME Paladin THROWS, and does add it when they stab with it", () => {
    // A Javelin is thrown, so its derived action has a reach and a range, and `attackKindsOf`
    // (`action-resolution.ts`) decides from the measured distance: past reach it is ranged and Radiant
    // Strikes must not fire; inside reach it must.
    const built = table(paladinInput(11));
    expect(actionOf(built, "item-longsword")?.attack?.reachFeet).toBe(5);
    expect(actionOf(built, "item-javelin")?.attack).toMatchObject({ reachFeet: 5, rangeNormalFeet: 30 });

    const atDistance = (feet: number, faces: number[]): ResolveDependencies => ({
      ...deps(built, faces),
      distanceFeet: () => feet
    });
    const action = actionOf(built, "item-javelin")!;
    const throwIt = resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextCommandId() },
      atDistance(30, [19, 4])
    );
    expect(throwIt.attack?.outcome).toBe("hit");
    expect(throwIt.damage.some((part) => part.type === "radiant")).toBe(false);

    const stabIt = resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextCommandId() },
      atDistance(5, [19, 4, 7])
    );
    expect(stabIt.attack?.outcome).toBe("hit");
    expect(stabIt.damage.find((part) => part.type === "radiant")).toMatchObject({ formula: "1d8", total: 7 });
  });

  it("adds nothing to the javelin when the distance is UNMEASURABLE: no map, no placement, no grid", () => {
    // With the default dependencies `distanceFeet` returns null (no map, unplaced combatant, or
    // uncalibrated grid). With nothing to measure, a thrown weapon must read as ranged, or every mapless
    // table would add 1d8 Radiant to thrown javelins.
    const built = table(paladinInput(11));
    const unmeasured = resolve(built, "item-javelin", [19, 4]);
    expect(unmeasured.attack?.outcome).toBe("hit");
    expect(unmeasured.damage.some((part) => part.type === "radiant")).toBe(false);
  });
});

describe("Paladin: Oath of Devotion, audit row 28", () => {
  it("always has the level-3 pair prepared, uncharged", () => {
    const built = table(paladinInput(3));
    const spells = built.definition.spellcasting?.spells ?? [];
    for (const id of ["protection-from-evil-and-good", "shield-of-faith"]) {
      expect(spells.find((spell) => spell.id === id)).toMatchObject({ alwaysPrepared: true });
    }
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ prepared: 4 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(4);
  });

  it("hands each later tier over at its Paladin level, always prepared", () => {
    // "When you reach a Paladin level specified in the table, you thereafter always have the listed spells
    // prepared": each row is its own staged feature.
    const alwaysPrepared = (level: number) =>
      (table(paladinInput(level)).definition.spellcasting?.spells ?? [])
        .filter((spell) => spell.alwaysPrepared)
        .map((spell) => spell.id);
    const nine = alwaysPrepared(9);
    expect(nine).toEqual(expect.arrayContaining(["aid", "zone-of-truth", "beacon-of-hope", "dispel-magic"]));
    expect(nine).not.toContain("guardian-of-faith");
    // Beacon of Hope, Guardian of Faith, Commune and Flame Strike are on no Paladin list: only the tier gives them.
    expect(alwaysPrepared(17)).toEqual(
      expect.arrayContaining([
        "protection-from-evil-and-good",
        "shield-of-faith",
        "guardian-of-faith",
        "commune",
        "flame-strike"
      ])
    );
    // ...and the description carries the table the player reads them from.
    const oath = library
      .subclassRecord("oath-of-devotion")!
      .features.find((feature) => feature.id === "oath-of-devotion-spells")!;
    expect(oath.description).toContain("Flame Strike");
  });

  it("makes Holy Nimbus a Bonus Action with one long-rest use", () => {
    const built = table(paladinInput(20));
    expect(actionOf(built, "holy-nimbus")?.activation).toBe("bonus-action");
    spend(built, "holy-nimbus");
    expect(built.hero.actionUses["holy-nimbus"]).toBe(1);
    newTurn(built);
    expect(() => resolve(built, "holy-nimbus", [], [])).toThrowError(/Holy Nimbus: no uses remaining \(1\/Long Rest\)/);
  });

  it("REFUSES a level-19 Paladin with no Epic Boon feat", () => {
    const missing = paladinInput(19);
    missing.choices = missing.choices.filter(
      (row) => row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-truesight"
    );
    expect(() => buildCharacterDefinition(missing, library, policy)).toThrowError(
      /"Epic Boon" needs 1 pick\(s\) of kind "feat"/
    );
  });
});
