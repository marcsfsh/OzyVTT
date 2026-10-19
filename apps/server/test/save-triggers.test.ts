import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { calmAtTurnStart } from "../src/berserker-axe.js";
import { builtinAction } from "../src/builtin-actions.js";
import { startEncounter } from "../src/encounter.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";
import { traitsAtTurnEnd, traitsAtTurnStart } from "../src/trait-turns.js";
import { actorOf, cast, caster } from "./spell-lifetimes-kit.js";
import { ALLY } from "./spell-casters.js";

// Saves that open on something other than the end of a creature's own turn, and the actions that end what they leave:
// an aboleth's Mucus Cloud at the end of its turn, a Berserker Axe's curse when its bearer is damaged, a darkmantle
// detached and a flesh golem calmed by an action.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000b01",
  hero: "10000000-0000-4000-8000-000000000b02",
  map: "20000000-0000-5000-8000-000000000b01",
  gm: "30000000-0000-4000-8000-00000000080b"
};
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-19T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 16 },
  hitPoints: { maximum: 60 },
  actions: [],
  proficiencies: {
    saves: [],
    skills: [
      { id: "athletics", proficiency: "proficient" },
      { id: "persuasion", proficiency: "proficient" }
    ]
  },
  extensions: {}
} as unknown as ActorDefinition;

function table(slug: string, inventory: unknown[] = []) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 200, maximum: 200 },
        armorClass: 10,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 50, maximum: 60 },
        armorClass: 10,
        definitionId: "hero",
        inventory
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const resolveDefinition = (id: string) =>
    id === "hero" ? heroDefinition : state.definitions.find((entry) => entry.id === id)?.definition;
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  const monster = state.actors.find((actor) => actor.id === IDS.monster)!;
  return { state, definition, resolveDefinition, hero, monster };
}
type Table = ReturnType<typeof table>;
const failSave = (built: Table) =>
  answerSave(built.state, nextId(), built.state.combat.pendingSaves[0]!.id, "manual", 1, true, GM, {
    random: () => 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: built.resolveDefinition
  });
const traitDeps = (built: Table, feet: number) => ({
  rollDie: () => 3,
  resolveDefinition: built.resolveDefinition,
  distanceFeet: () => feet,
  newId: nextId,
  now: NOW
});

describe("an aboleth's Mucus Cloud", () => {
  it("asks a save of each creature beside it at the end of its turn underwater, and curses on a failure", () => {
    const built = table("aboleth");
    expect(traitsAtTurnEnd(built.state, IDS.monster, traitDeps(built, 5))).toEqual([]);
    built.state.combat = { ...built.state.combat, underwater: true };
    traitsAtTurnEnd(built.state, IDS.monster, traitDeps(built, 5));
    expect(built.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.hero, ability: "con", dc: 14, actionName: "Mucus Cloud" }
    ]);
    failSave(built);
    expect(built.hero.effects).toMatchObject([
      { name: "Cursed (slimy skin) by Aboleth", tags: ["curse", "water-breathing", "no-healing-on-land"] }
    ]);
    // It heals underwater, and not on land.
    healActor(built.state, IDS.hero, 5, GM);
    expect(built.hero.hp.current).toBe(55);
    built.state.combat = { ...built.state.combat, underwater: false };
    healActor(built.state, IDS.hero, 5, GM);
    expect(built.hero.hp.current).toBe(55);
  });
});

describe("a Berserker Axe's curse", () => {
  it("asks a DC 15 Wisdom save when another creature damages the bearer, a failure sending it berserk", () => {
    const built = table("bandit", [
      { id: "berserker-axe", name: "Berserker Axe", equipped: true, attuned: true, category: "weapon" }
    ]);
    applyDamageDetailed(built.state, IDS.hero, { amount: 5, sourceActorId: IDS.monster }, GM, {
      resolveDefinition: built.resolveDefinition,
      newId: nextId,
      now: NOW
    });
    expect(built.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.hero, ability: "wis", dc: 15 }]);
    failSave(built);
    expect(built.hero.effects).toMatchObject([{ name: "Berserk (Berserker Axe)" }]);
    // It calms only at the start of a turn with no creature within 60 feet.
    expect(calmAtTurnStart(built.state, IDS.hero, () => 30)).toBeNull();
    expect(calmAtTurnStart(built.state, IDS.hero, () => 90)).toBe(built.hero.effects[0]!.id);
  });
});

describe("what an action ends", () => {
  const endIt = (built: Table, targetId: string, faces: number[]) => {
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.hero,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    return resolveDefinitionAction(
      built.state,
      builtinAction("end-effect")!,
      { actorId: IDS.hero, targetIds: [targetId], commandId: nextId(), builtin: true },
      {
        random: () => faces.shift() ?? 3,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        resolveDefinition: built.resolveDefinition,
        definition: heroDefinition,
        distanceFeet: () => 40
      }
    );
  };

  it("detaches a darkmantle with the bearer's Athletics check", () => {
    const built = table("darkmantle");
    resolveDefinitionAction(
      built.state,
      built.definition.actions.find((entry) => entry.id === "crush")!,
      { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
      {
        random: (sides) => Math.min(sides, 18),
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: built.definition,
        resolveDefinition: built.resolveDefinition
      }
    );
    expect(built.hero.effects).toMatchObject([
      { name: "Attached by Darkmantle (Crush)", endedBy: { check: { dc: 13 } } }
    ]);
    expect(endIt(built, IDS.hero, [12]).check).toMatchObject({ dc: 13, success: true });
    expect(built.hero.effects).toEqual([]);
  });

  it("calms a berserk flesh golem with a Persuasion check from within 60 feet", () => {
    const built = table("flesh-golem");
    built.monster.hp = { ...built.monster.hp, current: 90 };
    traitsAtTurnStart(built.state, IDS.monster, { ...traitDeps(built, 40), rollDie: () => 6 });
    expect(built.monster.effects).toMatchObject([{ name: "Berserk", endedBy: { withinFeet: 60 } }]);
    expect(endIt(built, IDS.monster, [13]).check).toMatchObject({ dc: 15, success: true });
    expect(built.monster.effects).toEqual([]);
  });
});

describe("Water Breathing", () => {
  it("lets its bearer breathe water", () => {
    const built = table("bandit");
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({ id: "wb", name: "Water Breathing", tags: ["water-breathing"], duration: { type: "manual" } })
    );
    built.state.combat = { ...built.state.combat, underwater: true };
    expect(built.hero.effects.map((effect) => effect.name)).toEqual(["Water Breathing"]);
  });
});

describe("Sanctuary", () => {
  it("wards its target at the caster's spell save DC until the target acts", () => {
    const fight = caster();
    cast(fight, "sanctuary", { targetIds: [ALLY] });
    expect(actorOf(fight.state, ALLY).effects).toMatchObject([
      { name: "Sanctuary", tags: ["sanctuary", "until-it-acts"], ward: { ability: "wis", dc: 15 } }
    ]);
  });

  it("turns away a creature that fails its save, spending nothing, and refuses it the same target this turn", () => {
    const built = table("bandit");
    built.hero.effects = [
      makeEffect({
        id: "ward",
        name: "Sanctuary",
        tags: ["sanctuary", "until-it-acts"],
        duration: { type: "rounds", remaining: 10 },
        ward: { ability: "wis", dc: 30 }
      })
    ];
    const scimitar = built.definition.actions.find((entry) => entry.id === "scimitar")!;
    const swing = () =>
      resolveDefinitionAction(
        built.state,
        scimitar,
        { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
        {
          random: () => 10,
          newRollId: nextId,
          gmSessionId: IDS.gm,
          now: NOW,
          definition: built.definition,
          resolveDefinition: built.resolveDefinition
        }
      );
    const turned = swing();
    expect(turned.attack).toBeNull();
    expect((turned.tableNarration ?? []).map((line) => line.text).join(" ")).toMatch(
      /DC 30 WIS save, 10 \(d20 10\), a failure: it chooses a new target or loses the attack\./
    );
    expect(built.state.combat.turn.actionUsed).toBe(false);
    expect(swing).toThrow(/turned away from Hero by Sanctuary this turn/);
  });
});
