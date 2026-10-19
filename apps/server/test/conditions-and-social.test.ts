import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { builtinAction } from "../src/builtin-actions.js";
import { rollAbilityCheck } from "../src/check-rolls.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { CommandRejectedError, RulesBlockedError } from "../src/game-store.js";
import { projectPlayerView } from "../src/projections.js";
import { evaluateActionEconomy } from "../src/resolution/economy.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";

// The conditions' whole text and the social rules (SRD 5.2.1 Rules Glossary): choosing to fail a save, checks that
// need sight or hearing, a charmer named by hand, the charmer's and the attitude's say in a social check, Perfume,
// dropping what an Unconscious creature holds, and Help with a Check.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  bandit: "10000000-0000-4000-8000-000000000901",
  cleric: "10000000-0000-4000-8000-000000000902",
  fighter: "10000000-0000-4000-8000-000000000903",
  map: "20000000-0000-5000-8000-000000000901",
  gm: "30000000-0000-4000-8000-00000000090a",
  clericSession: "30000000-0000-4000-8000-00000000090b"
};
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-19T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

/** A party member proficient in Persuasion and Athletics, Wisdom and Charisma +2. */
const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 14, cha: 14 },
  hitPoints: { maximum: 40 },
  actions: [],
  proficiencies: {
    saves: [],
    skills: [
      { id: "persuasion", proficiency: "proficient" },
      { id: "athletics", proficiency: "proficient" }
    ]
  },
  extensions: {}
} as unknown as ActorDefinition;

function table(slug = "bandit") {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.bandit,
        name: definition.name,
        kind: "monster",
        hp: { current: 30, maximum: 30 },
        armorClass: 12,
        definitionId: "monster-def"
      },
      {
        id: IDS.cleric,
        name: "Cleric",
        kind: "player-character",
        hp: { current: 40, maximum: 40 },
        armorClass: 12,
        definitionId: "hero",
        ownerSessionId: IDS.clericSession,
        inventory: [{ id: "mace", name: "Mace", equipped: true, category: "weapon", weapon: weapon() }]
      },
      {
        id: IDS.fighter,
        name: "Fighter",
        kind: "player-character",
        hp: { current: 40, maximum: 40 },
        armorClass: 12,
        definitionId: "hero"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.cleric, score: 20 },
        { actorId: IDS.fighter, score: 15 },
        { actorId: IDS.bandit, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, definition };
}
type Table = ReturnType<typeof table>;

function weapon() {
  return { category: "simple", damageDice: "1d6", damageType: "bludgeoning", rangeFeet: null, longRangeFeet: null };
}

const resolveDefinition = (built: Table) => (id: string) =>
  id === "hero" ? heroDefinition : built.state.definitions.find((entry) => entry.id === id)?.definition;
const actor = (built: Table, id: string) => built.state.actors.find((candidate) => candidate.id === id)!;
const resolveDeps = (built: Table, faces: number[], definition?: ActorDefinition): ResolveDependencies => ({
  random: () => faces.shift() ?? 3,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW,
  resolveDefinition: resolveDefinition(built),
  ...(definition ? { definition } : {})
});
/** `actorId` takes a builtin action on its own turn. */
function takeBuiltin(built: Table, actorId: string, id: string, targetIds: string[], faces: number[], skill?: string) {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: actorId,
    turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
  };
  return resolveDefinitionAction(
    built.state,
    builtinAction(id)!,
    { actorId, targetIds, commandId: nextId(), builtin: true, ...(skill ? { skill } : {}) },
    resolveDeps(built, faces, actorId === IDS.bandit ? built.definition : heroDefinition)
  );
}
/** A check the GM asks of `actorId`, its d20 showing `face`. */
function check(
  built: Table,
  actorId: string,
  subject: Parameters<typeof rollAbilityCheck>[2]["subject"],
  face: number,
  findActorId?: string
) {
  return rollAbilityCheck(
    built.state,
    GM,
    {
      commandId: nextId(),
      actorId,
      subject,
      dc: 10,
      visibility: "public",
      ...(findActorId ? { findActorId } : {})
    },
    {
      random: () => face,
      newId: nextId,
      sessionId: IDS.gm,
      now: NOW,
      resolveDefinition: resolveDefinition(built),
      distanceFeet: () => 5
    }
  );
}

describe("choosing to fail a save", () => {
  it("lets a player fail their own character's save with no die thrown", () => {
    const built = table();
    createPendingSaves(built.state, {
      sourceActorId: IDS.bandit,
      sourceName: "Bandit",
      actionName: "Shove",
      ability: "dex",
      dc: 13,
      targetIds: [IDS.cleric],
      proposedDamage: 10,
      halfOnSuccess: true,
      conditionIds: ["prone"],
      newSaveId: nextId,
      createdAt: 0
    });
    const rollsBefore = built.state.rolls.length;
    const answered = answerSave(
      built.state,
      nextId(),
      built.state.combat.pendingSaves[0]!.id,
      "fail",
      undefined,
      true,
      { role: "player", sessionId: IDS.clericSession },
      {
        random: () => 20,
        newRollId: nextId,
        sessionId: IDS.clericSession,
        role: "player",
        now: NOW,
        resolveDefinition: resolveDefinition(built)
      }
    );
    expect(answered.outcome).toMatchObject({ success: false, appliedDamage: 10 });
    expect(answered.outcome.natural).toBeUndefined();
    expect(answered.events.map((event) => event.text)).toContain("Cleric chooses to fail the DEX save.");
    expect(built.state.rolls).toHaveLength(rollsBefore);
    expect(actor(built, IDS.cleric).conditions.map((condition) => condition.id)).toContain("prone");
  });
});

describe("checks that need sight or hearing", () => {
  it("fails a Blinded roller's check that needs sight, and rolls one that needs hearing", () => {
    const built = table();
    setCondition(built.state, IDS.fighter, "blinded", true, undefined, GM);
    const seeing = check(built, IDS.fighter, { ability: "wis", skill: "perception", sense: "sight" }, 18);
    expect(seeing.outcome).toMatchObject({
      success: false,
      autoFailed: "Fighter is Blinded, and this check needs sight."
    });
    expect(
      check(built, IDS.fighter, { ability: "wis", skill: "perception", sense: "hearing" }, 18).outcome.success
    ).toBe(true);
  });

  it("fails a Deafened roller's check that needs hearing", () => {
    const built = table();
    setCondition(built.state, IDS.fighter, "deafened", true, undefined, GM);
    expect(
      check(built, IDS.fighter, { ability: "wis", skill: "perception", sense: "hearing" }, 18).outcome
    ).toMatchObject({ success: false, autoFailed: "Fighter is Deafened, and this check needs hearing." });
    expect(check(built, IDS.fighter, { ability: "wis", skill: "perception", sense: "sight" }, 18).outcome.success).toBe(
      true
    );
  });
});

describe("Charmed with its charmer named by hand", () => {
  it("keeps the charmed bandit from attacking its charmer or aiming a spell at her, and not the others", () => {
    const built = table();
    setCondition(built.state, IDS.bandit, "charmed", true, undefined, GM, { sourceActorId: IDS.cleric });
    expect(actor(built, IDS.bandit).effects).toMatchObject([
      { name: "Charmed by Cleric", sourceActorId: IDS.cleric, linkedConditionIds: ["charmed"] }
    ]);
    const scimitar = built.definition.actions.find((entry) => entry.id === "scimitar")!;
    built.state.combat = { ...built.state.combat, turnActorId: IDS.bandit };
    expect(() =>
      resolveDefinitionAction(
        built.state,
        scimitar,
        { actorId: IDS.bandit, targetIds: [IDS.cleric], commandId: nextId() },
        resolveDeps(built, [15, 3], built.definition)
      )
    ).toThrow(RulesBlockedError);
    const blessing = { id: "bless", name: "Bless", activation: "action", spellId: "bless", damage: [] };
    const rules = (targetId: string) =>
      evaluateActionEconomy(
        built.state,
        actor(built, IDS.bandit),
        blessing as unknown as Parameters<typeof evaluateActionEconomy>[2],
        [targetId],
        built.definition
      ).violations.map((violation) => violation.rule);
    expect(rules(IDS.cleric)).toContain("condition.charmed-charmer");
    expect(rules(IDS.fighter)).not.toContain("condition.charmed-charmer");
    // Clearing the condition takes the named charmer with it.
    setCondition(built.state, IDS.bandit, "charmed", false, undefined, GM);
    expect(actor(built, IDS.bandit).effects).toEqual([]);
  });

  it("is the GM's to name", () => {
    const built = table();
    expect(() =>
      setCondition(
        built.state,
        IDS.cleric,
        "frightened",
        true,
        undefined,
        { role: "player", sessionId: IDS.clericSession },
        {
          sourceActorId: IDS.bandit
        }
      )
    ).toThrow();
  });

  it("gives the charmer Advantage on Influence against the charmed creature", () => {
    const built = table();
    setCondition(built.state, IDS.bandit, "charmed", true, undefined, GM, { sourceActorId: IDS.cleric });
    const influence = takeBuiltin(built, IDS.cleric, "influence", [IDS.bandit], [4, 15], "persuasion");
    expect(influence.rollMode?.advantage).toEqual(["Bandit is Charmed by Cleric"]);
    expect(influence.check).toMatchObject({ total: 19, dc: 15 });
  });
});

describe("a monster's attitude in an Influence check", () => {
  it("gives Disadvantage against a Hostile creature and Advantage against a Friendly one", () => {
    const built = table();
    actor(built, IDS.bandit).attitude = "hostile";
    const hostile = takeBuiltin(built, IDS.cleric, "influence", [IDS.bandit], [15, 4], "persuasion");
    expect(hostile.rollMode?.disadvantage).toEqual(["Bandit is Hostile"]);
    expect(hostile.check).toMatchObject({ total: 8, success: false });
    actor(built, IDS.bandit).attitude = "friendly";
    const friendly = takeBuiltin(built, IDS.cleric, "influence", [IDS.bandit], [4, 15], "persuasion");
    expect(friendly.rollMode?.advantage).toEqual(["Bandit is Friendly"]);
  });

  it("never shows a player the attitude", () => {
    const built = table();
    actor(built, IDS.bandit).attitude = "hostile";
    const view = projectPlayerView(built.state, IDS.clericSession, () => null);
    expect(view.actors.find((entry) => entry.id === IDS.bandit)).not.toHaveProperty("attitude");
  });

  it("gives Perfume's Advantage on Persuasion against an Indifferent Humanoid within 5 feet", () => {
    const built = table();
    actor(built, IDS.cleric).effects = [
      {
        id: "perfume",
        name: "Perfume",
        tags: ["perfume"],
        sourceActorId: IDS.cleric,
        sourceName: "Cleric",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "minutes", remaining: 60 },
        endsWhenSourceDefeated: false,
        endsWithTag: null,
        voidWhileIncapacitated: false,
        concentration: false,
        modifiers: [],
        linkedConditionIds: [],
        escapeDc: null,
        onEnd: []
      }
    ];
    const rolled = check(built, IDS.cleric, { ability: "cha", skill: "persuasion" }, 10, IDS.bandit);
    expect(rolled.outcome.rollMode?.advantage).toEqual(["Perfume"]);
  });

  it("refuses Animal Handling on a creature that isn't a Beast or Monstrosity", () => {
    const built = table();
    expect(() => takeBuiltin(built, IDS.cleric, "influence", [IDS.bandit], [10], "animal-handling")).toThrow(
      CommandRejectedError
    );
  });
});

describe("dropping what an Unconscious creature holds", () => {
  it("unequips a character's weapon when it drops to 0 Hit Points, and keeps it carried", () => {
    const built = table();
    const result = applyDamageDetailed(built.state, IDS.cleric, { amount: 40 }, GM);
    expect(actor(built, IDS.cleric).inventory).toMatchObject([{ id: "mace", equipped: false }]);
    expect(result.events.map((event) => event.text)).toContain("Cleric drops Mace.");
  });

  it("drops it when the GM sets Unconscious by hand", () => {
    const built = table();
    const events = setCondition(built.state, IDS.cleric, "unconscious", true, undefined, GM);
    expect(actor(built, IDS.cleric).inventory[0]?.equipped).toBe(false);
    expect(events.map((event) => event.text)).toContain("Cleric drops Mace.");
  });
});

describe("Help with a Check", () => {
  it("gives the ally Advantage on its next check with the helper's skill, once", () => {
    const built = table();
    takeBuiltin(built, IDS.cleric, "help-check", [IDS.fighter], [], "athletics");
    expect(actor(built, IDS.fighter).effects).toMatchObject([{ name: "Helped by Cleric (Athletics)" }]);
    const first = check(built, IDS.fighter, { ability: "str", skill: "athletics" }, 12);
    expect(first.outcome.rollMode?.advantage).toEqual(["Helped by Cleric (Athletics)"]);
    // Another skill doesn't use it, and the next Athletics check rolls plainly.
    const second = check(built, IDS.fighter, { ability: "str", skill: "athletics" }, 12);
    expect(second.outcome.rollMode).toBeUndefined();
    expect(actor(built, IDS.fighter).effects).toEqual([]);
  });

  it("refuses a skill the helper isn't proficient in, and an enemy", () => {
    const built = table();
    expect(() => takeBuiltin(built, IDS.cleric, "help-check", [IDS.fighter], [], "stealth")).toThrow(
      /isn't proficient in Stealth/
    );
    expect(() => takeBuiltin(built, IDS.cleric, "help-check", [IDS.bandit], [], "athletics")).toThrow(
      /isn't Cleric's ally/
    );
  });
});
