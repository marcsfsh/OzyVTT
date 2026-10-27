import { CALM_ENVIRONMENT, EMPTY_SCENE_VISION, type GameState, type Scene, type SceneCombat } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
import { activateNewScene, sceneHeadroom, sceneSlotsNeededToGoLive, SCENE_ROOM_REFUSAL } from "./scenes.js";

/**
 * "Launch from here": parks the current table as a scene switch does and makes an archived moment live.
 * The parked scene resumes through `scene.activate`.
 *
 * Combatants are cloned under new ids because actor state (HP, conditions) is global; restoring onto
 * current ids would overwrite the party's present. Clones are unowned (`ownerSessionId: null`) so no
 * session gets a second body. Clones keep their recorded names and carry `replaySceneId`, which keeps
 * them out of roster surfaces (`rosterActors`) and lets `scenes.ts` delete them with the scene.
 */

/** The definition cap `GameStateSchema` enforces; the launch refuses up front, so a clone never fails halfway. */
const MAX_DEFINITIONS = 100;

export type ReplayLaunchInput = Readonly<{
  /** The archive row id; namespaces any definitions the launch stores. */
  archiveId: number;
  document: EncounterArchiveDocument;
  /** Which recorded boundary to make live: an index into `document.turns` (0 = the first turn). */
  turnIndex: number;
  /** Scene id for the launched moment, and the id an unbound live encounter parks under. */
  sceneId: string;
  implicitSceneId: string;
  newActorId: () => string;
}>;

export type ReplayLaunchOutcome = Readonly<{
  scene: Scene;
  /** The cloned combatants. Recorded on the scene as `replayOf.actorIds`; the server deletes them with it. */
  actorIds: readonly string[];
  turnIndex: number;
  label: string;
}>;

/** Rewrites every occurrence of an old actor id inside a cloned structure. A structural walk rather
 *  than a field list, so new combat fields can't be missed (which would point a replay at a live actor).
 *  Ids are uuids, so a matching value is that actor; composite keys (`<actorId>:<pool>`) remap by prefix. */
function remapIds<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => remapIds(entry, map)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const colon = key.indexOf(":");
      const remappedKey =
        map.get(key) ??
        (colon > 0 && map.has(key.slice(0, colon)) ? `${map.get(key.slice(0, colon))!}${key.slice(colon)}` : key);
      out[remappedKey] = remapIds(entry, map);
    }
    return out as unknown as T;
  }
  return value;
}

/** The archived combat, reduced to the scene-shaped fields (no map, no scene bookkeeping, no timeline). */
function sceneCombatFrom(combat: GameState["combat"]): SceneCombat {
  return {
    active: combat.active,
    round: combat.round,
    turnActorId: combat.turnActorId,
    initiative: combat.initiative,
    tokens: combat.tokens,
    annotations: combat.annotations,
    spellZones: combat.spellZones,
    turn: combat.turn,
    rulesMode: combat.rulesMode,
    ruleExceptions: combat.ruleExceptions,
    playerDamageMode: combat.playerDamageMode,
    playerInitiativeMode: combat.playerInitiativeMode,
    healthDisplay: combat.healthDisplay,
    underwater: combat.underwater,
    reactionsUsed: combat.reactionsUsed,
    legendaryUsed: combat.legendaryUsed,
    fog: combat.fog,
    // A recording made before painted water and ice, or the weather, has none.
    terrain: {
      difficult: combat.terrain.difficult,
      water: (combat.terrain.water as SceneCombat["terrain"]["water"] | undefined) ?? [],
      runningWater: (combat.terrain.runningWater as SceneCombat["terrain"]["runningWater"] | undefined) ?? [],
      ice: (combat.terrain.ice as SceneCombat["terrain"]["ice"] | undefined) ?? []
    },
    environment: (combat.environment as SceneCombat["environment"] | undefined) ?? { ...CALM_ENVIRONMENT },
    traps: (combat.traps as SceneCombat["traps"] | undefined) ?? [],
    // A recording made before dynamic vision has none.
    vision: (combat.vision as SceneCombat["vision"] | undefined) ?? { ...EMPTY_SCENE_VISION },
    pendingSaves: combat.pendingSaves,
    pendingReactions: combat.pendingReactions,
    pendingDamage: combat.pendingDamage,
    pendingRuleAsks: combat.pendingRuleAsks,
    pendingInitiative: combat.pendingInitiative,
    initiativeWindow: combat.initiativeWindow
  };
}

/** Makes one archived moment live. Runs inside the command transaction; every refusal happens before any write. */
export function launchReplay(state: GameState, input: ReplayLaunchInput): ReplayLaunchOutcome {
  const turns = input.document.turns ?? [];
  if (turns.length === 0) throw new CommandRejectedError("This recording has no turns to launch.");
  const turn = turns[input.turnIndex];
  if (!turn || !turn.state) throw new CommandRejectedError("That moment is not in this recording.");
  const archived = turn.state;

  // Scene headroom first: a launch can need two slots, and discovering that mid-way would mangle the table.
  if (sceneHeadroom(state) < sceneSlotsNeededToGoLive(state)) {
    throw new CommandRejectedError(SCENE_ROOM_REFUSAL, "scene_room_full");
  }

  const combatantIds = [...new Set(archived.combat.initiative.map((entry) => entry.actorId))];
  if (combatantIds.length === 0) throw new CommandRejectedError("That moment has no combatants to launch.");

  // Definition headroom before cloning: only imported stat blocks not already stored under the same id
  // need a slot; bundled ones resolve through the content library.
  const definitionsToStore: Array<{
    id: string;
    definition: EncounterArchiveDocument["definitions"][number]["definition"];
  }> = [];
  const definitionIdMap = new Map<string, string>();
  for (const actorId of combatantIds) {
    const source = archived.actors.find((actor) => actor.id === actorId);
    const definitionId = source?.definitionId ?? null;
    if (definitionId === null || definitionIdMap.has(definitionId)) continue;
    const archivedDefinition = input.document.definitions.find((entry) => entry.id === definitionId);
    if (!archivedDefinition || archivedDefinition.source !== "imported") continue;
    const current = state.definitions.find((entry) => entry.id === definitionId);
    if (current && JSON.stringify(current.definition) === JSON.stringify(archivedDefinition.definition)) {
      // Identical body already stored under the same id: reuse it.
      definitionIdMap.set(definitionId, definitionId);
      continue;
    }
    if (current) {
      // Never overwrite a definition the campaign uses now; the replay's copy gets a namespaced id.
      const replayId = `replay-${input.archiveId}-${definitionId}`;
      definitionIdMap.set(definitionId, replayId);
      if (!state.definitions.some((entry) => entry.id === replayId))
        definitionsToStore.push({ id: replayId, definition: archivedDefinition.definition });
      continue;
    }
    definitionIdMap.set(definitionId, definitionId);
    definitionsToStore.push({ id: definitionId, definition: archivedDefinition.definition });
  }
  if (state.definitions.length + definitionsToStore.length > MAX_DEFINITIONS) {
    throw new CommandRejectedError(
      "The table's sheet library is full. Delete some imported stat blocks before launching a replay."
    );
  }

  // Map all ids first so effect links and combat references can be remapped in one pass.
  const actorIdMap = new Map<string, string>();
  for (const actorId of combatantIds) actorIdMap.set(actorId, input.newActorId());

  const clones = combatantIds.flatMap((actorId) => {
    const source = archived.actors.find((actor) => actor.id === actorId);
    if (!source) return [];
    const clone = remapIds(structuredClone(source), actorIdMap);
    return [
      {
        ...clone,
        id: actorIdMap.get(actorId)!,
        // The recorded name, unchanged, so a replay of a replay can't stack suffixes.
        name: source.name,
        ownerSessionId: null,
        archived: false,
        // Scoped to this launch; a clone of a clone is re-scoped, so it never points at its old scene.
        replaySceneId: input.sceneId,
        ...(clone.definitionId ? { definitionId: definitionIdMap.get(clone.definitionId) ?? clone.definitionId } : {})
      }
    ];
  });

  const combat = remapIds(structuredClone(sceneCombatFrom(archived.combat)), actorIdMap);
  const label = `Replay: turn ${input.turnIndex + 1} of ${input.document.endedAt.slice(0, 10)}`;
  const actorIds = clones.map((clone) => clone.id);

  state.actors = [...state.actors, ...clones];
  if (definitionsToStore.length > 0) state.definitions = [...state.definitions, ...definitionsToStore];
  const scene = activateNewScene(
    state,
    {
      sceneId: input.sceneId,
      name: label,
      mapAssetId: archived.combat.mapAssetId,
      combat,
      replayOf: { archiveId: input.archiveId, actorIds }
    },
    input.implicitSceneId
  );

  return { scene, actorIds, turnIndex: input.turnIndex, label };
}
