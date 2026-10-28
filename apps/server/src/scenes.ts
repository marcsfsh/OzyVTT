import {
  CALM_ENVIRONMENT,
  DEFAULT_RULE_EXCEPTIONS,
  EMPTY_SCENE_VISION,
  type GameState,
  type Scene,
  type SceneCombat,
  type SceneInitiativeDefaults,
  type ScenePlayerDice
} from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { assertNotArchived } from "./actor-roster.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";

/** Scenes: prepared encounters the GM parks and resumes. `state.combat.*` is the live copy of the active
 *  scene; parked scenes hold frozen snapshots. HP, conditions and token images live on `state.actors`,
 *  so damage carries across scenes (the correct 5e reading). GM-only. */

const MAX_SCENES = 20;

// Go-live refusals, exported because `replay-launch.ts` pre-checks the room refusal. The Replays tab
// routes both by their codes.
export const SCENE_ROOM_REFUSAL =
  "Remove a prepared encounter first. Launching needs room to park the table and stage the replay.";
export const HISTORY_REVIEW_REFUSAL = "Finish reviewing the combat history before switching encounters.";

/** A parked scene's combat is the live top-level combat minus the map and scene bookkeeping. */
function snapshotSceneCombat(combat: GameState["combat"]): SceneCombat {
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
    terrain: combat.terrain,
    environment: combat.environment,
    traps: combat.traps,
    vision: combat.vision,
    pendingSaves: combat.pendingSaves,
    pendingReactions: combat.pendingReactions,
    pendingDamage: combat.pendingDamage,
    pendingRuleAsks: combat.pendingRuleAsks,
    pendingInitiative: combat.pendingInitiative,
    initiativeWindow: combat.initiativeWindow,
    ...(combat.atTable ? { atTable: combat.atTable } : {}),
    damageRolls: combat.damageRolls,
    targetAsks: combat.targetAsks
  };
}

/** The empty combat a scene slot holds (the active scene's slot is always empty; its live copy is top-level). */
function emptySceneCombat(): SceneCombat {
  return {
    active: false,
    round: 1,
    turnActorId: null,
    initiative: [],
    tokens: [],
    annotations: [],
    spellZones: [],
    turn: {
      actionUsed: false,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    },
    rulesMode: "strict",
    ruleExceptions: { ...DEFAULT_RULE_EXCEPTIONS },
    playerDamageMode: "proposal",
    playerInitiativeMode: "immediate",
    healthDisplay: { style: "band", audience: "gm" },
    underwater: false,
    reactionsUsed: [],
    legendaryUsed: {},
    fog: { enabled: false, shapes: [] },
    terrain: { difficult: [], water: [], runningWater: [], ice: [] },
    environment: { ...CALM_ENVIRONMENT },
    traps: [],
    vision: { ...EMPTY_SCENE_VISION },
    pendingSaves: [],
    pendingReactions: [],
    pendingDamage: [],
    pendingRuleAsks: [],
    pendingInitiative: [],
    initiativeWindow: [],
    damageRolls: [],
    targetAsks: []
  };
}

/** A prepared combat from a combatant list: initiative at score 0, tokens unplaced. */
function buildSceneCombat(state: GameState, combatantIds: readonly string[], geometry: TokenMapGeometry): SceneCombat {
  if (combatantIds.length > 200) throw new CommandRejectedError("An encounter can hold up to 200 combatants.");
  const seen = new Set<string>();
  const initiative = combatantIds.map((actorId) => {
    if (seen.has(actorId)) throw new CommandRejectedError("Each combatant can appear in an encounter only once.");
    seen.add(actorId);
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new CommandRejectedError("One of the chosen combatants no longer exists.");
    assertNotArchived(state, actorId);
    return { actorId, score: 0, tieBreaker: actor.initiative ?? 0 };
  });
  const tokens = createEncounterTokens(
    initiative.map((entry) => {
      const source = state.actors.find((actor) => actor.id === entry.actorId);
      return { actorId: entry.actorId, sizeCells: source?.sizeCells ?? 1, size: source?.size };
    }),
    geometry
  );
  // A newly prepared scene inherits the table's current policy settings.
  return {
    ...emptySceneCombat(),
    rulesMode: state.combat.rulesMode,
    ruleExceptions: { ...state.combat.ruleExceptions },
    playerDamageMode: state.combat.playerDamageMode,
    playerInitiativeMode: state.combat.playerInitiativeMode,
    healthDisplay: state.combat.healthDisplay,
    initiative,
    tokens
  };
}

/** Stamps `lastUsedAt` for the "Recent" list (staging counts as use); player characters are excluded. */
function stampStagingRecency(state: GameState, combatantIds: readonly string[], now: number) {
  for (const actorId of combatantIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (actor && actor.kind !== "player-character") actor.lastUsedAt = now;
  }
}

export function createScene(
  state: GameState,
  input: Readonly<{
    encounterId: string;
    name: string;
    mapAssetId: string;
    combatantIds: readonly string[];
    initiativeDefaults?: SceneInitiativeDefaults;
  }>,
  geometry: TokenMapGeometry,
  now: number = Date.now()
): Scene {
  if (state.combat.encounters.length >= MAX_SCENES)
    throw new CommandRejectedError(`You can prepare up to ${MAX_SCENES} encounters.`);
  if (state.combat.encounters.some((scene) => scene.id === input.encounterId))
    throw new CommandRejectedError("That encounter already exists.");
  const scene: Scene = {
    id: input.encounterId,
    name: input.name,
    mapAssetId: input.mapAssetId,
    combat: buildSceneCombat(state, input.combatantIds, geometry),
    ...(input.initiativeDefaults ? { initiativeDefaults: input.initiativeDefaults } : {}),
    createdAt: now,
    updatedAt: now
  };
  stampStagingRecency(state, input.combatantIds, now);
  state.combat = { ...state.combat, encounters: [...state.combat.encounters, scene] };
  return scene;
}

/** Replaces a scene's starting choices for its fight. Allowed on the live scene: it changes no running fight. */
export function setSceneInitiativeDefaults(state: GameState, encounterId: string, defaults: SceneInitiativeDefaults) {
  const scene = state.combat.encounters.find((candidate) => candidate.id === encounterId);
  if (!scene) throw new CommandRejectedError("That encounter no longer exists.");
  if (scene.replayOf) throw new CommandRejectedError("A replay starts the way its recorded encounter did.");
  const kept: SceneInitiativeDefaults = {
    ...(defaults.playersRollInitiative !== undefined ? { playersRollInitiative: defaults.playersRollInitiative } : {}),
    ...(defaults.groupMonsters !== undefined ? { groupMonsters: defaults.groupMonsters } : {})
  };
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.map((candidate) => {
      if (candidate.id !== encounterId) return candidate;
      const { initiativeDefaults: _dropped, ...rest } = candidate;
      return Object.keys(kept).length > 0 ? { ...rest, initiativeDefaults: kept } : rest;
    })
  };
}

/** Replaces an encounter's own dice modes (ADR-0043); a kind left out goes back to the table's. It applies at once
 *  while the encounter is live, since it decides only how the next roll is entered. */
export function setScenePlayerDice(state: GameState, encounterId: string, dice: ScenePlayerDice) {
  if (!state.combat.encounters.some((candidate) => candidate.id === encounterId))
    throw new CommandRejectedError("That encounter no longer exists.");
  const kept: ScenePlayerDice = {
    ...(dice.d20 !== undefined ? { d20: dice.d20 } : {}),
    ...(dice.damage !== undefined ? { damage: dice.damage } : {})
  };
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.map((candidate) => {
      if (candidate.id !== encounterId) return candidate;
      const { playerDice: _dropped, ...rest } = candidate;
      return Object.keys(kept).length > 0 ? { ...rest, playerDice: kept } : rest;
    })
  };
}

/**
 * The live scene's starting choices, for `encounter:start` to use where its request leaves one out (ADR-0039). A
 * request's own value always wins; with neither, the fight starts as it always has.
 */
export function liveInitiativeDefaults(state: GameState): SceneInitiativeDefaults {
  const live = state.combat.encounters.find((scene) => scene.id === state.combat.activeEncounterId);
  return live && !live.replayOf ? (live.initiativeDefaults ?? {}) : {};
}

export function renameScene(state: GameState, encounterId: string, name: string) {
  if (!state.combat.encounters.some((scene) => scene.id === encounterId))
    throw new CommandRejectedError("That encounter no longer exists.");
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.map((scene) => (scene.id === encounterId ? { ...scene, name } : scene))
  };
}

/** Drops a launched replay's scene and its cloned combatants. Call after the state swap; no-op for an
 *  ordinary scene. */
function dropReplayScene(state: GameState, encounterId: string) {
  const scene = state.combat.encounters.find((candidate) => candidate.id === encounterId);
  if (!scene?.replayOf) return;
  // Keyed on the actors' own back-reference; the scene's id list is only a hint.
  state.actors = state.actors.filter((actor) => actor.replayEncounterId !== encounterId);
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.filter((candidate) => candidate.id !== encounterId)
  };
}

export function removeScene(state: GameState, encounterId: string) {
  if (!state.combat.encounters.some((scene) => scene.id === encounterId))
    throw new CommandRejectedError("That encounter no longer exists.");
  if (state.combat.activeEncounterId === encounterId)
    throw new CommandRejectedError("Switch to another encounter before removing the live one.");
  // Removing a parked replay takes its clones with it; an ordinary scene's combatants stay on the roster.
  dropReplayScene(state, encounterId);
  state.combat = { ...state.combat, encounters: state.combat.encounters.filter((scene) => scene.id !== encounterId) };
}

export function setSceneCombatants(
  state: GameState,
  encounterId: string,
  combatantIds: readonly string[],
  geometry: TokenMapGeometry,
  now: number = Date.now()
) {
  const scene = state.combat.encounters.find((candidate) => candidate.id === encounterId);
  if (!scene) throw new CommandRejectedError("That encounter no longer exists.");
  if (state.combat.activeEncounterId === encounterId)
    throw new CommandRejectedError("This encounter is live. Change who is in it at the table.");
  // Preserve where already-staged combatants stand so adding/removing one doesn't reset the layout.
  const placed = new Map(scene.combat.tokens.map((token) => [token.actorId, token.position]));
  const combat = buildSceneCombat(state, combatantIds, geometry);
  const combatKeepingPositions = {
    ...combat,
    tokens: combat.tokens.map((token) => ({ ...token, position: placed.get(token.actorId) ?? token.position }))
  };
  stampStagingRecency(state, combatantIds, now);
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.map((candidate) =>
      candidate.id === encounterId ? { ...candidate, combat: combatKeepingPositions } : candidate
    )
  };
}

/** Duplicates a scene as a parked copy; duplicating the live scene snapshots the top-level combat. */
export function duplicateScene(
  state: GameState,
  sourceSceneId: string,
  newSceneId: string,
  now: number = Date.now()
): Scene {
  if (state.combat.encounters.length >= MAX_SCENES)
    throw new CommandRejectedError(`You can prepare up to ${MAX_SCENES} encounters.`);
  const sourceIndex = state.combat.encounters.findIndex((scene) => scene.id === sourceSceneId);
  if (sourceIndex === -1) throw new CommandRejectedError("That encounter no longer exists.");
  if (state.combat.encounters.some((scene) => scene.id === newSceneId))
    throw new CommandRejectedError("That encounter already exists.");
  const source = state.combat.encounters[sourceIndex];
  const combat =
    state.combat.activeEncounterId === sourceSceneId
      ? snapshotSceneCombat(state.combat)
      : structuredClone(source.combat);
  const suffix = " (copy)";
  const name = `${source.name.length + suffix.length > 120 ? source.name.slice(0, 120 - suffix.length) : source.name}${suffix}`;
  const copy: Scene = {
    id: newSceneId,
    name,
    mapAssetId: source.mapAssetId,
    combat,
    ...(source.initiativeDefaults && !source.replayOf ? { initiativeDefaults: { ...source.initiativeDefaults } } : {}),
    createdAt: now,
    updatedAt: now
  };
  const scenes = [...state.combat.encounters];
  scenes.splice(sourceIndex + 1, 0, copy);
  state.combat = { ...state.combat, encounters: scenes };
  return copy;
}

/** Reorders scenes to a permutation of the current ids; the live scene is an id, so it never changes. */
export function reorderScenes(state: GameState, order: readonly string[]) {
  const current = state.combat.encounters;
  const ids = new Set(current.map((scene) => scene.id));
  if (order.length !== current.length || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
    throw new CommandRejectedError("The new order must list every prepared encounter exactly once.");
  }
  const byId = new Map(current.map((scene) => [scene.id, scene]));
  state.combat = { ...state.combat, encounters: order.map((id) => byId.get(id)!) };
}

/** Park-and-resume: parks the live combat into its slot (or an implicit scene), then resumes the target
 *  and empties its slot. */
export function activateScene(
  state: GameState,
  encounterId: string,
  implicitSceneId: string,
  now: number = Date.now()
) {
  const target = state.combat.encounters.find((scene) => scene.id === encounterId);
  if (!target) throw new CommandRejectedError("That encounter no longer exists.");
  if (state.combat.activeEncounterId === encounterId) throw new CommandRejectedError("That encounter is already live.");
  // The handler wipes timeline snapshots on a swap, so refuse while the GM is mid-review.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError(HISTORY_REVIEW_REFUSAL, "history_review");

  const departingId = state.combat.activeEncounterId;
  let scenes = state.combat.encounters;
  if (state.combat.activeEncounterId !== null) {
    const parkedId = state.combat.activeEncounterId;
    scenes = scenes.map((scene) =>
      scene.id === parkedId ? { ...scene, combat: snapshotSceneCombat(state.combat) } : scene
    );
  } else if (state.combat.mapAssetId !== null && (state.combat.active || state.combat.initiative.length > 0)) {
    // A pre-scenes encounter is live and unbound; preserve it as an implicit scene so switching back resumes it.
    if (scenes.length >= MAX_SCENES)
      throw new CommandRejectedError("Remove a prepared encounter before switching away from the current encounter.");
    scenes = [
      ...scenes,
      {
        id: implicitSceneId,
        name: "Current encounter",
        mapAssetId: state.combat.mapAssetId,
        combat: snapshotSceneCombat(state.combat),
        createdAt: now,
        updatedAt: now
      }
    ];
  }
  // Read the target's stored combat before blanking its slot.
  const resumed = target.combat;
  scenes = scenes.map((scene) =>
    scene.id === encounterId ? { ...scene, combat: emptySceneCombat(), liveAt: now } : scene
  );
  // SceneCombat has no timeline fields; set them so the resumed combat starts live.
  state.combat = {
    ...resumed,
    mapAssetId: target.mapAssetId,
    encounters: scenes,
    activeEncounterId: encounterId,
    historyCursor: null,
    historyDirty: false,
    // A held fall belongs to the table it began on.
    pendingFalls: [],
    // A creature off the plane comes back on the map it left; a new table places it by hand.
    offPlane: [],
    timeStop: null,
    heldMove: null,
    turnSteps: null,
    // A second turn of round 1 belongs to the table it began on.
    secondTurn: null,
    secondTurnsTaken: [],
    initiativeSwapOffers: []
  };
  // Switching away from a launched replay ends it. Runs after the swap so the park still had a slot.
  if (departingId !== null) dropReplayScene(state, departingId);
}

/** Scene slots a park-and-go-live needs (one more if an unbound encounter must be preserved). */
export function sceneSlotsNeededToGoLive(state: GameState): number {
  const parksImplicitly =
    state.combat.activeEncounterId === null &&
    state.combat.mapAssetId !== null &&
    (state.combat.active || state.combat.initiative.length > 0);
  return 1 + (parksImplicitly ? 1 : 0);
}

export function sceneHeadroom(state: GameState): number {
  return MAX_SCENES - state.combat.encounters.length;
}

/** `activateScene` for a target it creates fresh; used for replay launch. */
export function activateNewScene(
  state: GameState,
  input: Readonly<{
    encounterId: string;
    name: string;
    mapAssetId: string | null;
    combat: SceneCombat;
    replayOf?: Scene["replayOf"];
  }>,
  implicitSceneId: string,
  now: number = Date.now()
): Scene {
  if (state.combat.historyCursor !== null) throw new CommandRejectedError(HISTORY_REVIEW_REFUSAL, "history_review");
  if (state.combat.encounters.some((scene) => scene.id === input.encounterId))
    throw new CommandRejectedError("That encounter already exists.");
  if (sceneHeadroom(state) < sceneSlotsNeededToGoLive(state)) {
    throw new CommandRejectedError(SCENE_ROOM_REFUSAL, "encounter_room_full");
  }

  const departingId = state.combat.activeEncounterId;
  let scenes = state.combat.encounters;
  if (state.combat.activeEncounterId !== null) {
    const parkedId = state.combat.activeEncounterId;
    scenes = scenes.map((scene) =>
      scene.id === parkedId ? { ...scene, combat: snapshotSceneCombat(state.combat) } : scene
    );
  } else if (state.combat.mapAssetId !== null && (state.combat.active || state.combat.initiative.length > 0)) {
    scenes = [
      ...scenes,
      {
        id: implicitSceneId,
        name: "Current encounter",
        mapAssetId: state.combat.mapAssetId,
        combat: snapshotSceneCombat(state.combat),
        createdAt: now,
        updatedAt: now
      }
    ];
  }
  // The live scene's own slot stays empty by invariant.
  const scene: Scene = {
    id: input.encounterId,
    name: input.name,
    mapAssetId: input.mapAssetId ?? state.combat.mapAssetId ?? "",
    combat: emptySceneCombat(),
    createdAt: now,
    updatedAt: now,
    liveAt: now,
    ...(input.replayOf ? { replayOf: input.replayOf } : {})
  };
  state.combat = {
    ...input.combat,
    mapAssetId: scene.mapAssetId,
    encounters: [...scenes, scene],
    activeEncounterId: scene.id,
    historyCursor: null,
    historyDirty: false,
    pendingFalls: [],
    // A creature off the plane comes back on the map it left; a new table places it by hand.
    offPlane: [],
    timeStop: null,
    heldMove: null,
    turnSteps: null,
    // A second turn of round 1 belongs to the table it began on.
    secondTurn: null,
    secondTurnsTaken: [],
    initiativeSwapOffers: []
  };
  // Launching a replay from a replay ends the first one, so repeated launches don't hit the scene cap.
  if (departingId !== null) dropReplayScene(state, departingId);
  return scene;
}

/** A scene's record without its own stamps, to tell whether a command changed it. */
function sceneContent(scene: Scene): string {
  const { createdAt: _created, updatedAt: _updated, liveAt: _live, ...content } = scene;
  return JSON.stringify(content);
}

/**
 * Stamps `updatedAt` on every scene a command changed, whichever command it was: a rename, its creatures, a token
 * moved on it, its fog, terrain, walls or lights, or a fight parked into it. The scene that went live in this command
 * only had its slot emptied, which its `liveAt` already records.
 */
export function stampSceneChanges(state: GameState, before: GameState, now: number = Date.now()) {
  const previous = new Map(before.combat.encounters.map((scene) => [scene.id, scene]));
  const wentLive =
    state.combat.activeEncounterId !== before.combat.activeEncounterId ? state.combat.activeEncounterId : null;
  let changed = false;
  const scenes = state.combat.encounters.map((scene) => {
    const earlier = previous.get(scene.id);
    if (!earlier || scene.id === wentLive || sceneContent(scene) === sceneContent(earlier)) return scene;
    changed = true;
    return { ...scene, updatedAt: now };
  });
  if (changed) state.combat = { ...state.combat, encounters: scenes };
}
