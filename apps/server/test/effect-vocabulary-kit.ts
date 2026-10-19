import { GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorAction, ActorDefinition, EffectInstance, Modifier } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { checkPlan, totalCheck, type CheckSubject } from "../src/ability-checks.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";

/**
 * A small table for the effect vocabulary's tests: Wren, a level 5 character with a Greatsword and a few spells on her
 * sheet, beside a Zombie (an Undead), an Imp (a Fiend) and Bran (an ally with no stat block). Dice are a queue of faces,
 * then 1s.
 */

export const view = new ContentLibrary().forAudience("gm");
export const catalog = equipmentCatalogOf(view);

export const WREN = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d20";
export const ZOMBIE = "10000000-0000-4000-8000-0000000000d1";
export const IMP = "10000000-0000-4000-8000-0000000000d2";
export const BRAN = "10000000-0000-4000-8000-0000000000d3";

const MONSTERS = loadMonsterDefinitions();
const monster = (id: string) => MONSTERS.find((entry) => entry.source?.externalId === id)!;

/** Wren: Str 18, Dex 12, Con 14, Int 10, Wis 16, Cha 8, Proficiency Bonus 3, Athletics and Arcana. */
export function wrenSheet(over: Partial<ActorDefinition> = {}): ActorDefinition {
  return {
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: "wren" },
    name: "Wren",
    size: "medium",
    armorClass: 14,
    proficiencyBonus: 3,
    abilityScores: { str: 18, dex: 12, con: 14, int: 10, wis: 16, cha: 8 },
    hitPoints: { maximum: 40 },
    speedFeet: 30,
    actions: [],
    extensions: {},
    character: { classes: [{ id: "fighter", name: "Fighter", level: 5 }], feats: [], features: [] },
    proficiencies: {
      saves: ["str", "con"],
      skills: [
        { id: "athletics", proficiency: "proficient" },
        { id: "arcana", proficiency: "proficient" }
      ],
      weapons: ["simple", "martial"],
      armor: ["light", "medium", "heavy", "shields"]
    },
    ...over
  } as unknown as ActorDefinition;
}

export const GREATSWORD = {
  id: "greatsword",
  name: "Greatsword",
  quantity: 1,
  equipped: true,
  attuned: false,
  category: "weapon",
  weapon: {
    category: "martial",
    damageDice: "2d6",
    damageType: "slashing",
    rangeFeet: null,
    longRangeFeet: null,
    melee: true,
    properties: ["heavy", "two-handed"]
  }
} as const;

export type Table = Readonly<{
  state: GameState;
  wren: Actor;
  definition: ActorDefinition;
  definitions: Map<string, ActorDefinition>;
}>;

/** Wren, the Zombie, the Imp and Bran in a fight, Wren's turn first. `distance` is every pair's map distance. */
export function table(definition: ActorDefinition = wrenSheet(), options: Readonly<{ wren?: object }> = {}): Table {
  const definitions = new Map<string, ActorDefinition>([
    ["wren", definition],
    ["zombie", monster("zombie")],
    ["imp", monster("imp")]
  ]);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: WREN,
        name: "Wren",
        kind: "player-character",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        speedFeet: 30,
        definitionId: "wren",
        inventory: [GREATSWORD],
        ...options.wren
      },
      {
        id: ZOMBIE,
        name: "Zombie",
        kind: "monster",
        visibility: "public",
        hp: { current: 15, maximum: 15 },
        armorClass: 8,
        speedFeet: 20,
        definitionId: "zombie"
      },
      {
        id: IMP,
        name: "Imp",
        kind: "monster",
        visibility: "public",
        hp: { current: 21, maximum: 21 },
        armorClass: 13,
        speedFeet: 20,
        definitionId: "imp"
      },
      {
        id: BRAN,
        name: "Bran",
        kind: "npc",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        armorClass: 12,
        speedFeet: 30
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: WREN, score: 20 },
        { actorId: ZOMBIE, score: 15 },
        { actorId: IMP, score: 10 },
        { actorId: BRAN, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, wren: state.actors.find((actor) => actor.id === WREN)!, definition, definitions };
}

export const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;

let counter = 0;
export const nextCommand = () => `70000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

/** Puts a hand-made effect on a creature, as the GM's `effect.add` does. */
export function giveEffect(
  built: Table,
  actorId: string,
  modifiers: readonly Modifier[],
  extra: Partial<EffectInstance> = {}
): EffectInstance {
  return addEffect(
    built.state,
    actorId,
    makeEffect({
      id: `effect-${nextCommand()}`,
      name: "Test effect",
      duration: { type: "manual" },
      modifiers: [...modifiers],
      ...extra
    }),
    undefined,
    { resolveDefinition: (id) => built.definitions.get(id), catalog }
  );
}

export const resolveDefinitionOf = (built: Table) => (id: string) => built.definitions.get(id);

/** Resolves `action` for `actorId` (Wren by default) on a fresh turn, its dice a queue of faces and then 1s. */
export function resolve(
  built: Table,
  action: ActorAction,
  input: Partial<ResolveInput> = {},
  faces: number[] = [],
  actorId: string = WREN,
  distance: number | null = 5
) {
  const { turn } = built.state.combat;
  built.state.combat = {
    ...built.state.combat,
    turnActorId: actorId,
    turn: { ...turn, actionUsed: false, bonusActionUsed: false, actionInstance: null, movementUsedFeet: 0 }
  };
  const attacker = actorOf(built.state, actorId);
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId, targetIds: [ZOMBIE], commandId: nextCommand(), ...input },
    {
      random: () => faces.shift() ?? 1,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      ...(attacker.definitionId ? { definition: built.definitions.get(attacker.definitionId)! } : {}),
      catalog,
      resolveDefinition: resolveDefinitionOf(built),
      ...(distance === null ? {} : { distanceFeet: () => distance })
    }
  );
}

/** Wren's action by id, as her sheet offers it. */
export const actionOf = (built: Table, id: string, actorId: string = WREN): ActorAction => {
  const actor = actorOf(built.state, actorId);
  const found = effectiveActions(built.definitions.get(actor.definitionId ?? ""), actor, catalog).find(
    (action) => action.id === id
  );
  if (!found) throw new Error(`No action ${id}`);
  return found;
};

/** Wren's check plan for `subject`, rolled with the d20 faces given and `others` for its other dice. */
export function checkWith(built: Table, subject: CheckSubject, faces: number[], others: number[] = []) {
  const actor = actorOf(built.state, WREN);
  const plan = checkPlan(actor, built.definition, deriveEquipment(actor, built.definition, catalog), subject);
  return { plan, roll: totalCheck(plan, faces, plan.rollMode.mode, () => others.shift() ?? 1) };
}
