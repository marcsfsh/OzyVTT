import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, DamageDrain } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";
import type { ResolveInput } from "../src/resolution/context.js";

/**
 * A fight between one SRD stat block and a hero, with a third creature, for tests of what stat-block actions do: the
 * monster acts first, then the hero (a character of the species given), then the third creature (a stat block named
 * by slug, or a plain creature on the monster's side).
 */

export const MONSTERS = loadMonsterDefinitions();
export const definitionOf = (slug: string) => MONSTERS.find((monster) => monster.source.externalId === slug)!;
export const IDS = {
  monster: "10000000-0000-4000-8000-000000000801",
  hero: "10000000-0000-4000-8000-000000000802",
  ally: "10000000-0000-4000-8000-000000000803",
  map: "20000000-0000-5000-8000-000000000801",
  gm: "30000000-0000-4000-8000-00000000080a"
};
export const GM = { role: "gm" } as const;
export const NOW = () => "2026-10-19T00:00:00.000Z";
let command = 0;
export const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;

export const heroDefinition = (species = "human", overrides: Partial<ActorDefinition> = {}) =>
  ({
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 2,
    abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 120 },
    actions: [
      {
        id: "dagger",
        name: "Dagger",
        activation: "action",
        description: "A stab.",
        attack: { bonus: 6, reachFeet: 5 },
        damage: [{ formula: "1d4", type: "piercing" }]
      }
    ],
    character: { race: { id: species, name: species } },
    token: { disposition: "neutral", footprint: { width: 1, height: 1 } },
    extensions: {},
    ...overrides
  }) as unknown as ActorDefinition;

export function table(slug: string, options: Readonly<{ species?: string; allySlug?: string; heroHp?: number }> = {}) {
  const definition = definitionOf(slug);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [
      { id: "monster-def", definition },
      ...(options.allySlug ? [{ id: "ally-def", definition: definitionOf(options.allySlug) }] : [])
    ],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 60, maximum: 100 },
        armorClass: 15,
        speedFeet: 30,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: options.heroHp ?? 100, maximum: 120 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "monster",
        hp: { current: 50, maximum: 50 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: options.allySlug ? "ally-def" : "hero-def"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const hero = heroDefinition(options.species);
  const resolveDefinition = (id: string) =>
    id === "hero-def" ? hero : state.definitions.find((entry) => entry.id === id)?.definition;
  return { state, definition, resolveDefinition };
}
export type Table = ReturnType<typeof table>;

export const actor = (built: Table, id: string) => built.state.actors.find((candidate) => candidate.id === id)!;
export const conditionsOf = (built: Table, id: string) => actor(built, id).conditions.map((condition) => condition.id);

/** The monster uses `actionId` on `targetIds`. */
export function use(
  built: Table,
  actionId: string,
  targetIds: string[],
  faces: number[] = [],
  input: Partial<ResolveInput> = {}
) {
  const action = built.definition.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${built.definition.name} has no ${actionId}`);
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds, commandId: nextId(), ...input },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: built.definition,
      resolveDefinition: built.resolveDefinition
    }
  );
}

/** The open save of `targetId`, answered with a typed total. */
export function answer(built: Table, targetId: string, total: number) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === targetId);
  if (!pending) throw new Error("No save is owed.");
  return answerSave(built.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: built.resolveDefinition
  });
}

/** Damage lands on `targetId` from `sourceActorId`, with what its action drains. */
export function damage(
  built: Table,
  targetId: string,
  amount: number,
  type: string,
  extra: Readonly<{ sourceActorId?: string; sourceName?: string; drain?: DamageDrain }> = {}
) {
  return applyDamageDetailed(built.state, targetId, { amount, parts: [{ amount, type }], ...extra }, GM, {
    resolveDefinition: built.resolveDefinition,
    newId: nextId,
    now: NOW,
    rollDie: () => 2
  });
}

/** A legendary action comes right after another creature's turn ends. */
export const legendaryWindow = (built: Table) => {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: IDS.ally,
    turn: { ...built.state.combat.turn, afterActorId: IDS.hero }
  };
};
