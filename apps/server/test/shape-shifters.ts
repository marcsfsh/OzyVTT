import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { actionAvailability, resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { addActorFromDefinition, importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { answerSave } from "../src/saving-throws.js";

/**
 * Creatures that change shape, in a fight on a calibrated map: a built Druid (or any built character) and bestiary
 * stat blocks. Each table reads the creature's definition afresh for every resolve, since a form swaps it. Dice are a
 * queue of faces, then 10s.
 */

export const view = new ContentLibrary().forAudience("gm");
export const catalog = equipmentCatalogOf(view);
const POLICY = BuilderPolicySchema.parse({});

export const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
export const FOE = "10000000-0000-4000-8000-000000000002";
export const ALLY = "10000000-0000-4000-8000-000000000004";

type Row = CharacterCreateRequestInput["choices"][number];

/** A Human Sage Druid of any level (WIS 15 + 2), Circle of the Land, with Primal Strike from level 7 and Moonbeam and
 *  Revivify among its spells where its level reaches them. */
export function druid(level: number, extra: readonly Row[] = []): ActorDefinition {
  const asi = [4, 8, 12, 16]
    .filter((at) => at <= level)
    .flatMap((at, index) => [
      { level: at, classId: "druid", kind: "asi-or-feat", id: "ability-score-improvement" },
      {
        level: at,
        kind: "ability-score",
        id: index < 2 ? "con" : "str",
        payload: { featureId: "ability-score-improvement" }
      },
      {
        level: at,
        kind: "ability-score",
        id: index < 2 ? "dex" : "int",
        payload: { featureId: "ability-score-improvement" }
      }
    ]);
  const input = {
    name: "Maelin",
    speciesId: "human",
    backgroundId: "sage",
    classId: "druid",
    level,
    ...(level >= 3 ? { subclassId: "circle-of-the-land" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "druid", kind: "skill", id: "nature" },
      { level: 1, classId: "druid", kind: "skill", id: "perception" },
      { level: 1, classId: "druid", kind: "primal-order", id: "warden", payload: { featureId: "primal-order" } },
      { level: 1, kind: "cantrip", id: "druidcraft" },
      { level: 1, kind: "cantrip", id: "produce-flame" },
      { level: 1, kind: "spell", id: "entangle" },
      { level: 1, kind: "spell", id: "cure-wounds" },
      ...(level >= 3 ? [{ level: 1, kind: "spell", id: "moonbeam" }] : []),
      ...(level >= 5 ? [{ level: 1, kind: "spell", id: "revivify" }] : []),
      ...(level >= 7 ? [{ level: 1, kind: "spell", id: "polymorph" }] : []),
      ...(level >= 15 ? [{ level: 1, kind: "spell", id: "animal-shapes" }] : []),
      ...(level >= 17 ? [{ level: 1, kind: "spell", id: "shapechange" }] : []),
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-wizard" } },
      ...(level >= 3
        ? [
            { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
            { level: 3, kind: "land", id: "polar", payload: { featureId: "circle-of-the-land-spells" } }
          ]
        : []),
      ...(level >= 7
        ? [
            {
              level: 7,
              classId: "druid",
              kind: "elemental-fury",
              id: "primal-strike",
              payload: { featureId: "elemental-fury" }
            }
          ]
        : []),
      ...asi,
      ...(level >= 19
        ? [
            { level: 19, classId: "druid", kind: "feat", id: "boon-of-fate", payload: { featureId: "epic-boon" } },
            { level: 19, kind: "ability-score", id: "wis", payload: { featureId: "boon-of-fate" } }
          ]
        : []),
      { level: 1, kind: "equipment", id: "druid-a" },
      { level: 1, kind: "equipment", id: "sage-a" },
      ...extra
    ]
  } as CharacterCreateRequestInput;
  return buildCharacterDefinition(input, view, POLICY);
}

/** A built character's input, built with the table's content. */
export const build = (input: CharacterCreateRequestInput): ActorDefinition =>
  buildCharacterDefinition(input, view, POLICY);

export type Table = Readonly<{
  state: GameState;
  actor: (id: string) => GameState["actors"][number];
  definitionOf: (id: string) => ActorDefinition | undefined;
  resolve: (
    actorId: string,
    actionId: string | ActorAction,
    input: Partial<ResolveInput>,
    faces?: number[]
  ) => ReturnType<typeof resolveDefinitionAction>;
  available: (actorId: string, actionId: string) => ReturnType<typeof actionAvailability>[number];
  nextTurn: () => void;
}>;

/** What a fight's resolves read: stored sheets first, then the bestiary. */
export const resolverOf = (state: GameState) => (definitionId: string) =>
  storedDefinition(state, definitionId) ?? view.monster(definitionId);

/**
 * A fight: `hero` (a built character) first in the turn order, then each bestiary creature in `monsters` (id ->
 * bestiary id), all on one calibrated map with 50-pixel cells and tokens placed in a row. `combat: false` leaves the
 * fight unstarted.
 */
export function table(
  hero: ActorDefinition | null,
  monsters: Readonly<Record<string, string>> = {},
  options: Readonly<{ combat?: boolean; distance?: number }> = {}
): Table {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  if (hero) importActorDefinition(state, hero, HERO, "public", catalog);
  for (const [id, bestiaryId] of Object.entries(monsters))
    addActorFromDefinition(state, view.monster(bestiaryId)!, id, "public", catalog);
  const ids = state.actors.map((actor) => actor.id);
  if (options.combat !== false)
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: ids.map((actorId, index) => ({ actorId, score: 20 - index }))
      },
      () => 1,
      {
        width: 1000,
        height: 1000,
        calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
      }
    );
  ids.forEach((actorId, index) => {
    const token = state.combat.tokens.find((entry) => entry.actorId === actorId);
    if (token) token.position = { x: 125 + index * 100, y: 125 };
  });
  const resolve = resolverOf(state);
  const actor = (id: string) => state.actors.find((entry) => entry.id === id)!;
  const definitionOf = (id: string) => {
    const found = actor(id);
    return found.definitionId ? resolve(found.definitionId) : undefined;
  };
  let rollId = 0;
  return {
    state,
    actor,
    definitionOf,
    resolve: (actorId, actionId, input, faces = []) => {
      const definition = definitionOf(actorId);
      const found =
        typeof actionId !== "string"
          ? actionId
          : (effectiveActions(definition, actor(actorId), catalog).find((entry) => entry.id === actionId) ??
            builtinActionFor(definition, actionId));
      if (!found) throw new Error(`No action ${String(actionId)}`);
      return resolveDefinitionAction(
        state,
        found,
        { actorId, targetIds: [], commandId: `cmd-${(rollId += 1)}`, ...input },
        {
          random: () => faces.shift() ?? 10,
          newRollId: () => `40000000-0000-4000-8000-${String((rollId += 1)).padStart(12, "0")}`,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-19T00:00:00.000Z",
          ...(definition ? { definition } : {}),
          catalog,
          resolveDefinition: resolve,
          distanceFeet: () => options.distance ?? 5
        }
      );
    },
    available: (actorId, actionId) => {
      const definition = definitionOf(actorId);
      const actions = effectiveActions(definition, actor(actorId), catalog);
      const found = actions.filter((entry) => entry.id === actionId);
      if (found.length === 0) throw new Error(`No action ${actionId}`);
      return actionAvailability(state, actor(actorId), found, definition, false, actions, catalog)[0]!;
    },
    nextTurn: () => nextInitiativeTurn(state)
  };
}

/** The GM answers the save `targetId` owes with a typed total. */
export function answerSaveOf(fight: Table, targetId: string, total: number) {
  const pending = fight.state.combat.pendingSaves.find((entry) => entry.targetActorId === targetId);
  if (!pending) throw new Error(`No save owed by ${targetId}`);
  return answerSave(
    fight.state,
    `answer-${pending.id}`,
    pending.id,
    "manual",
    total,
    true,
    { role: "gm" },
    {
      random: () => 10,
      newRollId: () => crypto.randomUUID(),
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: resolverOf(fight.state),
      catalog
    }
  );
}

/** Advances the turn order until it is `actorId`'s turn. */
export function turnOf(fight: Table, actorId: string): void {
  for (let step = 0; step < 20; step += 1) {
    if (fight.state.combat.turnActorId === actorId) return;
    fight.nextTurn();
  }
  throw new Error(`${actorId} never came up.`);
}
