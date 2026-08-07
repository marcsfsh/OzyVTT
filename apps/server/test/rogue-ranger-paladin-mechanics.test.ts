import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { answerReaction } from "../src/reactions.js";
import { setCondition } from "../src/actor-conditions.js";
import { startEncounter } from "../src/encounter.js";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * STAGE 4, LANE B2 - Rogue, Ranger and Paladin mechanics, proved at the far end.
 *
 * Every assertion below is a number that was rolled, a counter that was spent, a build that was
 * refused, or text the table actually reads. "The rider survived derivation" is deliberately never
 * the claim: issue `2e` shipped thirteen rider variants that parsed, typechecked and did nothing,
 * and this file exists so that cannot happen again one class at a time.
 *
 * These run against the REAL SRD bundles rather than a homebrew fixture, because the thing under
 * test IS the authored content: a fixture would prove the engine works and say nothing about
 * whether `rogue.ts` is right. `feature-riders.test.ts` is the fixture-side sibling.
 */

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Array<CharacterCreateRequestInput["choices"][number]>;
  backgroundBonusAllocation: Array<{ ability: CharacterCreateRequestInput["backgroundBonusAllocation"][number]["ability"]; amount: number }>;
};

type Table = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor; foe: Actor; catalog: ReturnType<typeof equipmentCatalogOf> }>;

/** Build the sheet through the REAL builder, put it on a table, and start a fight. */
function table(input: MutableInput, foeHp = 60): Table {
  const definition = buildCharacterDefinition(input, library, policy);
  const catalog = equipmentCatalogOf(library);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: foeHp, maximum: foeHp }, armorClass: 10 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return {
    definition, state, catalog,
    hero: state.actors.find((actor) => actor.id === IDS.hero)!,
    foe: state.actors.find((actor) => actor.id === IDS.foe)!
  };
}

let commandSeed = 0;
const nextCommandId = () => `50000000-0000-4000-8000-${String(commandSeed += 1).padStart(12, "0")}`;

function deps(built: Table, faces: number[]): ResolveDependencies {
  let rollSeed = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(rollSeed += 1).padStart(12, "0")}`,
    gmSessionId: IDS.gm, now: () => "2026-08-07T00:00:00.000Z",
    definition: built.definition, catalog: built.catalog,
    resolveDefinition: (id: string) => resolveIn(built.state, id)
  };
}

/** The table's own definition store - `importActorDefinition` keys it `import-<actorId>`, not by the record's id. */
const resolveIn = (state: GameState, id: string) => state.definitions.find((entry) => entry.id === id)?.definition;

const actionOf = (built: Table, id: string) => effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === id);
const resolve = (built: Table, id: string, faces: number[], targetIds: string[] = [IDS.foe]) =>
  resolveDefinitionAction(built.state, actionOf(built, id)!, { actorId: IDS.hero, targetIds, commandId: nextCommandId() }, deps(built, faces));

// =================================================================================================
// ROGUE
// =================================================================================================

/**
 * A Halfling Criminal Rogue. Halfling is the species with no build choices at all and Criminal's
 * origin feat (Alert) asks for none either, so every choice row below belongs to the ROGUE - which
 * keeps the "the build is refused without this row" assertions unambiguous.
 */
const rogueInput = (level: number): MutableInput => {
  const asiLevels = [4, 8, 10, 12, 16].filter((asi) => asi <= level);
  const expertiseLevels = [1, 6].filter((entry) => entry <= level);
  return {
    name: "Nim", speciesId: "halfling", backgroundId: "criminal", classId: "rogue", level,
    ...(level >= 3 ? { subclassId: "thief" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
    backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, classId: "rogue", kind: "skill", id: "acrobatics" },
      { level: 1, classId: "rogue", kind: "skill", id: "investigation" },
      { level: 1, classId: "rogue", kind: "skill", id: "perception" },
      { level: 1, classId: "rogue", kind: "skill", id: "deception" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "dagger" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "shortbow" },
      ...expertiseLevels.flatMap((entry) => entry === 1
        ? [{ level: 1, classId: "rogue", kind: "expertise", id: "stealth" }, { level: 1, classId: "rogue", kind: "expertise", id: "sleight-of-hand" }]
        : [{ level: 6, classId: "rogue", kind: "expertise", id: "perception" }, { level: 6, classId: "rogue", kind: "expertise", id: "investigation" }]),
      ...(level >= 3 ? [{ level: 3, classId: "rogue", kind: "subclass", id: "thief" }] : []),
      ...asiLevels.flatMap((asi) => [
        { level: asi, classId: "rogue", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: asi, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } },
        { level: asi, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
      ]),
      ...(level >= 19 ? [
        { level: 19, classId: "rogue", kind: "feat", id: "boon-of-irresistible-offense", payload: { featureId: "epic-boon" } },
        { level: 19, kind: "ability-score", id: "dex", payload: { featureId: "boon-of-irresistible-offense" } }
      ] : []),
      { level: 1, kind: "equipment", id: "rogue-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Rogue - Sneak Attack rolls the printed column", () => {
  it("rolls 6d6 at level 11 and 1d6 at level 1, off ONE record", () => {
    // `damageByLevel` keeps the highest row at or below the character's level. The far end is the
    // rolled total, not the array: six stubbed 4s is 24, and the same record on a level-1 Rogue
    // rolls one die. If the level filter were dropped this would roll 10d6 at both levels.
    const eleven = table(rogueInput(11));
    const rolled = resolve(eleven, "sneak-attack", [4, 4, 4, 4, 4, 4], []);
    expect(rolled.damage).toEqual([{ formula: "6d6", type: "weapon", total: 24 }]);

    const first = table(rogueInput(1));
    expect(resolve(first, "sneak-attack", [5], []).damage).toEqual([{ formula: "1d6", type: "weapon", total: 5 }]);
  });

  it("refuses a SECOND Sneak Attack in the same turn, and the counter says so", () => {
    // "Once per turn" is a `per: "turn"` pool counted in `combat.turn.turnUses`, not prose. The
    // refusal is what makes the first roll mean anything.
    const built = table(rogueInput(11));
    resolve(built, "sneak-attack", [1, 1, 1, 1, 1, 1], []);
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
    expect(() => resolve(built, "sneak-attack", [1, 1, 1, 1, 1, 1], []))
      .toThrowError(/Sneak Attack: no uses remaining \(1\/turn\)/);
    // ...and nothing was spent by the refusal.
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
  });
});

describe("Rogue - Uncanny Dodge halves the damage that hit", () => {
  it("parks the attack's damage on a reaction prompt and halves it when used", () => {
    // The far end of `reaction: {trigger: "hit-by-attack", response: "half-damage"}`: the foe hits
    // the Rogue, the resolver offers the prompt, and answering it applies HALF. Without the authored
    // reaction there is no prompt at all and full damage lands (asserted below).
    const built = table(rogueInput(11));
    const bite = {
      id: "bite", name: "Bite", activation: "action" as const,
      description: "A bite.", damage: [{ formula: "2d6", type: "piercing" }],
      attack: { bonus: 20 }
    };
    const before = built.hero.hp.current;
    const hit = resolveDefinitionAction(built.state, bite, { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined });
    expect(hit.attack?.outcome).toBe("hit");
    const pending = built.state.combat.pendingReactions;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "hit-by-attack", actionName: "Uncanny Dodge", proposedDamage: 10 });

    const outcome = answerReaction(built.state, nextCommandId(), pending[0].id, true, undefined, "gm", {
      random: () => 1, newRollId: () => "40000000-0000-4000-8000-0000000000ff",
      gmSessionId: IDS.gm, now: () => "2026-08-07T00:00:00.000Z", catalog: built.catalog,
      resolveDefinition: (id: string) => resolveIn(built.state, id)
    });
    expect(outcome.appliedDamage).toBe(5); // 10 halved, floor, before defenses
    expect(built.hero.hp.current).toBe(before - 5);
  });

  it("offers NO prompt to a level-4 Rogue, who has not gained the feature", () => {
    // The negative control that makes the assertion above about the AUTHORED record rather than
    // about the engine: Uncanny Dodge is a level-5 feature.
    const built = table(rogueInput(4));
    const bite = {
      id: "bite", name: "Bite", activation: "action" as const,
      description: "A bite.", damage: [{ formula: "2d6", type: "piercing" }], attack: { bonus: 20 }
    };
    resolveDefinitionAction(built.state, bite, { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined });
    expect(built.state.combat.pendingReactions).toEqual([]);
  });
});

describe("Rogue - the flat grants and the pick", () => {
  it("puts Thieves' Cant on the sheet's languages", () => {
    expect(table(rogueInput(1)).definition.proficiencies?.languages).toContain("thieves-cant");
  });

  it("adds Wisdom and Charisma saves at level 15 and NOT at level 14", () => {
    // Slippery Mind is `grants.saves`, which lands in the one array every save on the sheet is
    // rolled from. The Rogue prints Dex and Int at level 1.
    const fifteen = table(rogueInput(15)).definition.proficiencies?.saves ?? [];
    expect([...fifteen].sort()).toEqual(["cha", "dex", "int", "wis"]);
    const fourteen = table(rogueInput(14)).definition.proficiencies?.saves ?? [];
    expect([...fourteen].sort()).toEqual(["dex", "int"]);
  });

  it("REFUSES a level-19 Rogue with no Epic Boon feat, and puts the chosen one on the sheet", () => {
    // Audit row 6. The record carried no `choice` at all, so the level-19 feat the text promises was
    // never offered - a silence, not an error. Now the build says so.
    const missing = rogueInput(19);
    missing.choices = missing.choices.filter((row) =>
      row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-irresistible-offense");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
    expect(table(rogueInput(19)).definition.character?.feats?.map((feat) => feat.id))
      .toContain("boon-of-irresistible-offense");
  });

  it("spends Stroke of Luck's one use and refuses the second", () => {
    // A feature that prints a use count and no action gets a synthesised rollable, which is what
    // makes the pool real. The counter is the half a player has to track.
    const built = table(rogueInput(20));
    resolve(built, "stroke-of-luck", [], []);
    expect(built.hero.actionUses["stroke-of-luck"]).toBe(1);
    expect(() => resolve(built, "stroke-of-luck", [], []))
      .toThrowError(/Stroke Of Luck: no uses remaining \(1\/short rest\)/);
  });

  it("gives Steady Aim's Bonus Action a real Advantage effect", () => {
    const built = table(rogueInput(11));
    expect(actionOf(built, "steady-aim")?.activation).toBe("bonus-action");
    resolve(built, "steady-aim", [], []);
    const granted = built.hero.effects.find((effect) => effect.tags.includes("steady-aim"));
    expect(granted?.modifiers).toEqual([{ type: "roll-mode", roll: "attack", mode: "advantage", when: [], scope: undefined }]);
  });

  it("makes the Thief's Fast Hands a Bonus Action", () => {
    expect(actionOf(table(rogueInput(11)), "fast-hands")?.activation).toBe("bonus-action");
  });
});
