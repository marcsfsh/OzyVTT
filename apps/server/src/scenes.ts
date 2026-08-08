import { DEFAULT_RULE_EXCEPTIONS, type GameState, type Scene, type SceneCombat } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { assertNotArchived } from "./actor-roster.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";

/**
 * Scenes - prepared encounters the GM parks-and-resumes between. The model: the top-level
 * `state.combat.*` fields ARE the live copy of the active scene; parked scenes hold a frozen full
 * combat snapshot. Activating a scene parks the current live combat into its scene slot and resumes
 * the target's frozen copy verbatim - round, turn, token positions, annotations, reactions, pending
 * saves all intact. HP/conditions/token images live on `state.actors` (global), so damage carries
 * across scene swaps, which is the correct 5e reading. Only the GM issues these commands.
 */

const MAX_SCENES = 20;

/** A parked scene's combat is the live top-level combat minus the map and scene bookkeeping. */
function snapshotSceneCombat(combat: GameState["combat"]): SceneCombat {
  return {
    active: combat.active,
    round: combat.round,
    turnActorId: combat.turnActorId,
    initiative: combat.initiative,
    tokens: combat.tokens,
    annotations: combat.annotations,
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
    pendingSaves: combat.pendingSaves,
    pendingReactions: combat.pendingReactions,
    pendingDamage: combat.pendingDamage,
    pendingRuleAsks: combat.pendingRuleAsks,
    pendingInitiative: combat.pendingInitiative
  };
}

/** The empty combat an inactive/active-slot scene holds (the single-source-of-truth invariant for the active scene). */
function emptySceneCombat(): SceneCombat {
  return { active: false, round: 1, turnActorId: null, initiative: [], tokens: [], annotations: [], turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }, rulesMode: "strict", ruleExceptions: { ...DEFAULT_RULE_EXCEPTIONS }, playerDamageMode: "proposal", playerInitiativeMode: "immediate", healthDisplay: { style: "band", audience: "gm" }, underwater: false, reactionsUsed: [], legendaryUsed: {}, fog: { enabled: false, shapes: [] }, pendingSaves: [], pendingReactions: [], pendingDamage: [], pendingRuleAsks: [], pendingInitiative: [] };
}


/** Builds a prepared (inactive) combat context from a combatant list: initiative at score 0, tokens at default (unplaced) positions. */
function buildSceneCombat(state: GameState, combatantIds: readonly string[], geometry: TokenMapGeometry): SceneCombat {
  if (combatantIds.length > 200) throw new CommandRejectedError("A scene can hold up to 200 combatants.");
  const seen = new Set<string>();
  const initiative = combatantIds.map((actorId) => {
    if (seen.has(actorId)) throw new CommandRejectedError("Each combatant can appear in a scene only once.");
    seen.add(actorId);
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new CommandRejectedError("One of the chosen combatants no longer exists.");
    assertNotArchived(state, actorId);
    return { actorId, score: 0, tieBreaker: actor.initiative ?? 0 };
  });
  const tokens = createEncounterTokens(initiative.map((entry) => { const source = state.actors.find((actor) => actor.id === entry.actorId); return { actorId: entry.actorId, sizeCells: source?.sizeCells ?? 1, size: source?.size }; }), geometry);
  // A newly prepared scene inherits the table's current policy settings rather than resetting to defaults.
  return { ...emptySceneCombat(), rulesMode: state.combat.rulesMode, ruleExceptions: { ...state.combat.ruleExceptions }, playerDamageMode: state.combat.playerDamageMode, playerInitiativeMode: state.combat.playerInitiativeMode, healthDisplay: state.combat.healthDisplay, initiative, tokens };
}

/**
 * Recency for the scene-setup "Recent" list. `lastUsedAt` was stamped only when a creature entered a
 * FIGHT, so a GM who preps ahead saw a Recent list that knew nothing about the evening they just
 * spent staging. Staging counts as use. Player characters are excluded: they are the standing party,
 * always at hand, and stamping them would push the monsters a GM is actually reaching for off the list.
 * GM-only field - already stripped from the player projection.
 */
function stampStagingRecency(state: GameState, combatantIds: readonly string[], now: number) {
  for (const actorId of combatantIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (actor && actor.kind !== "player-character") actor.lastUsedAt = now;
  }
}

export function createScene(state: GameState, input: Readonly<{ sceneId: string; name: string; mapAssetId: string; combatantIds: readonly string[] }>, geometry: TokenMapGeometry, now: number = Date.now()): Scene {
  if (state.combat.scenes.length >= MAX_SCENES) throw new CommandRejectedError(`You can prepare up to ${MAX_SCENES} scenes.`);
  if (state.combat.scenes.some((scene) => scene.id === input.sceneId)) throw new CommandRejectedError("That scene already exists.");
  const scene: Scene = { id: input.sceneId, name: input.name, mapAssetId: input.mapAssetId, combat: buildSceneCombat(state, input.combatantIds, geometry) };
  stampStagingRecency(state, input.combatantIds, now);
  state.combat = { ...state.combat, scenes: [...state.combat.scenes, scene] };
  return scene;
}

export function renameScene(state: GameState, sceneId: string, name: string) {
  if (!state.combat.scenes.some((scene) => scene.id === sceneId)) throw new CommandRejectedError("That scene no longer exists.");
  state.combat = { ...state.combat, scenes: state.combat.scenes.map((scene) => scene.id === sceneId ? { ...scene, name } : scene) };
}

/**
 * A LAUNCHED REPLAY IS DISPOSABLE - drop the scene and the combatants it minted, together (D3).
 *
 * WHY THIS EXISTS AT ALL. `launchReplay` appended a scene and a clone set and NOTHING ever removed
 * either, so every "Launch from here" permanently spent one of the twenty scene slots. At 19-20 the
 * headroom check below started refusing with "Remove a prepared scene first" - a demand the Replays
 * tab offered no way to satisfy. The refusal was never wrong; the leak underneath it was. Every exit
 * from a replay scene routes through here, so there is one answer to "when do the clones go".
 *
 * Called AFTER the state swap in each caller, never before: `activateScene`/`activateNewScene` park
 * the live combat into the departing scene's slot first, and dropping it earlier would lose the swap.
 * A no-op for an ordinary prepared scene, which is what makes it safe to call unconditionally.
 */
function dropReplayScene(state: GameState, sceneId: string) {
  const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene?.replayOf) return;
  // Trust the actors' own back-reference rather than the scene's list: an id in `replayOf.actorIds`
  // that no longer names an actor is already gone, and an actor carrying this scene's id is a clone
  // of it whether or not the list remembers. The list is the client's "remove these" hint, not the key.
  state.actors = state.actors.filter((actor) => actor.replaySceneId !== sceneId);
  state.combat = { ...state.combat, scenes: state.combat.scenes.filter((candidate) => candidate.id !== sceneId) };
}

export function removeScene(state: GameState, sceneId: string) {
  if (!state.combat.scenes.some((scene) => scene.id === sceneId)) throw new CommandRejectedError("That scene no longer exists.");
  if (state.combat.activeSceneId === sceneId) throw new CommandRejectedError("Switch to another scene before removing the live one.");
  // Removing a parked replay takes its clones with it - they exist only to stage that scene. A no-op
  // for an ordinary prepared scene, whose combatants belong to the campaign and stay on the roster.
  dropReplayScene(state, sceneId);
  state.combat = { ...state.combat, scenes: state.combat.scenes.filter((scene) => scene.id !== sceneId) };
}

export function setSceneCombatants(state: GameState, sceneId: string, combatantIds: readonly string[], geometry: TokenMapGeometry, now: number = Date.now()) {
  const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new CommandRejectedError("That scene no longer exists.");
  if (state.combat.activeSceneId === sceneId) throw new CommandRejectedError("This scene is live - change its combatants from the encounter instead.");
  // Preserve where already-staged combatants stand so adding/removing one doesn't reset the layout.
  const placed = new Map(scene.combat.tokens.map((token) => [token.actorId, token.position]));
  const combat = buildSceneCombat(state, combatantIds, geometry);
  const combatKeepingPositions = { ...combat, tokens: combat.tokens.map((token) => ({ ...token, position: placed.get(token.actorId) ?? token.position })) };
  stampStagingRecency(state, combatantIds, now);
  state.combat = { ...state.combat, scenes: state.combat.scenes.map((candidate) => candidate.id === sceneId ? { ...candidate, combat: combatKeepingPositions } : candidate) };
}

/**
 * Duplicate a prepared scene as a new staged copy sitting next to the original. The copy carries the
 * source's map and its frozen combat (staged combatants, token positions, fog) verbatim. Duplicating
 * the LIVE scene snapshots the current top-level combat into the copy - the active scene's own slot is
 * empty by invariant, so a bare copy would be blank. The copy is always parked (never the active
 * scene), and `activeSceneId` is untouched.
 */
export function duplicateScene(state: GameState, sourceSceneId: string, newSceneId: string): Scene {
  if (state.combat.scenes.length >= MAX_SCENES) throw new CommandRejectedError(`You can prepare up to ${MAX_SCENES} scenes.`);
  const sourceIndex = state.combat.scenes.findIndex((scene) => scene.id === sourceSceneId);
  if (sourceIndex === -1) throw new CommandRejectedError("That scene no longer exists.");
  if (state.combat.scenes.some((scene) => scene.id === newSceneId)) throw new CommandRejectedError("That scene already exists.");
  const source = state.combat.scenes[sourceIndex];
  const combat = state.combat.activeSceneId === sourceSceneId ? snapshotSceneCombat(state.combat) : structuredClone(source.combat);
  const suffix = " (copy)";
  const name = `${source.name.length + suffix.length > 120 ? source.name.slice(0, 120 - suffix.length) : source.name}${suffix}`;
  const copy: Scene = { id: newSceneId, name, mapAssetId: source.mapAssetId, combat };
  const scenes = [...state.combat.scenes];
  scenes.splice(sourceIndex + 1, 0, copy);
  state.combat = { ...state.combat, scenes };
  return copy;
}

/**
 * Reorder the prepared-scene list to a permutation of the current scene ids. Which scene is live is an
 * id reference (`activeSceneId`), independent of array position, so it is never changed by a reorder.
 */
export function reorderScenes(state: GameState, order: readonly string[]) {
  const current = state.combat.scenes;
  const ids = new Set(current.map((scene) => scene.id));
  if (order.length !== current.length || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
    throw new CommandRejectedError("The new order must list every prepared scene exactly once.");
  }
  const byId = new Map(current.map((scene) => [scene.id, scene]));
  state.combat = { ...state.combat, scenes: order.map((id) => byId.get(id)!) };
}

/**
 * The park-and-resume swap. Parks the current live combat into its own scene slot (or an implicit
 * scene if a pre-scenes encounter is running unbound), then resumes the target scene's frozen combat
 * verbatim while resetting the target's own slot to empty (the active scene's live copy is top-level).
 */
export function activateScene(state: GameState, sceneId: string, implicitSceneId: string) {
  const target = state.combat.scenes.find((scene) => scene.id === sceneId);
  if (!target) throw new CommandRejectedError("That scene no longer exists.");
  if (state.combat.activeSceneId === sceneId) throw new CommandRejectedError("That scene is already live.");
  // A scene swap replaces the live fight the timeline tracks; the handler wipes its snapshots, so
  // block a switch while the GM is mid-review rather than silently discarding an unresolved rewind.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before switching scenes.");

  const departingId = state.combat.activeSceneId;
  let scenes = state.combat.scenes;
  if (state.combat.activeSceneId !== null) {
    const parkedId = state.combat.activeSceneId;
    scenes = scenes.map((scene) => scene.id === parkedId ? { ...scene, combat: snapshotSceneCombat(state.combat) } : scene);
  } else if (state.combat.mapAssetId !== null && (state.combat.active || state.combat.initiative.length > 0)) {
    // A pre-scenes encounter is live and unbound; preserve it as an implicit scene so switching back resumes it.
    if (scenes.length >= MAX_SCENES) throw new CommandRejectedError("Remove a prepared scene before switching away from the current encounter.");
    scenes = [...scenes, { id: implicitSceneId, name: "Current encounter", mapAssetId: state.combat.mapAssetId, combat: snapshotSceneCombat(state.combat) }];
  }
  // Resume the target (read its stored combat before we blank its slot) and reset its own slot to empty.
  const resumed = target.combat;
  scenes = scenes.map((scene) => scene.id === sceneId ? { ...scene, combat: emptySceneCombat() } : scene);
  // `resumed` is a SceneCombat and carries no timeline bookkeeping - set it explicitly so the rebuilt
  // combat starts live (a bare spread would leave historyCursor/historyDirty undefined, not null/false).
  state.combat = { ...resumed, mapAssetId: target.mapAssetId, scenes, activeSceneId: sceneId, historyCursor: null, historyDirty: false };
  // Switching AWAY from a launched replay ends it: the scene the table just left, and the combatants
  // it minted, go. Runs after the swap so the park above still had a slot to park into.
  if (departingId !== null) dropReplayScene(state, departingId);
}

/**
 * How many scene slots a park-and-go-live needs right now: one for the new scene, plus one more when
 * a pre-scenes encounter is running unbound and would have to be preserved as an implicit scene.
 * Callers that MINT the scene they go live on (replay launch) pre-check with this so the refusal
 * arrives before anything is built, rather than half-way through.
 */
export function sceneSlotsNeededToGoLive(state: GameState): number {
  const parksImplicitly = state.combat.activeSceneId === null && state.combat.mapAssetId !== null && (state.combat.active || state.combat.initiative.length > 0);
  return 1 + (parksImplicitly ? 1 : 0);
}

export function sceneHeadroom(state: GameState): number {
  return MAX_SCENES - state.combat.scenes.length;
}

/**
 * Park the current table and go live on a NEW scene carrying `combat`.
 *
 * This is `activateScene`'s motion with the target CREATED rather than resumed, and it exists so
 * launching a replay is the same park/resume the GM already knows (D25/R3) instead of a second
 * table concept: the current fight parks into its slot exactly as it does on a scene switch, the
 * new scene goes live, and the parked one resumes any time through `scene.activate`.
 */
export function activateNewScene(state: GameState, input: Readonly<{ sceneId: string; name: string; mapAssetId: string | null; combat: SceneCombat; replayOf?: Scene["replayOf"] }>, implicitSceneId: string): Scene {
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before switching scenes.");
  if (state.combat.scenes.some((scene) => scene.id === input.sceneId)) throw new CommandRejectedError("That scene already exists.");
  if (sceneHeadroom(state) < sceneSlotsNeededToGoLive(state)) {
    throw new CommandRejectedError("Remove a prepared scene first - launching needs room to park the table and stage the replay.");
  }

  const departingId = state.combat.activeSceneId;
  let scenes = state.combat.scenes;
  if (state.combat.activeSceneId !== null) {
    const parkedId = state.combat.activeSceneId;
    scenes = scenes.map((scene) => scene.id === parkedId ? { ...scene, combat: snapshotSceneCombat(state.combat) } : scene);
  } else if (state.combat.mapAssetId !== null && (state.combat.active || state.combat.initiative.length > 0)) {
    scenes = [...scenes, { id: implicitSceneId, name: "Current encounter", mapAssetId: state.combat.mapAssetId, combat: snapshotSceneCombat(state.combat) }];
  }
  // The live scene's own slot stays EMPTY by invariant - its live copy is the top-level combat.
  const scene: Scene = { id: input.sceneId, name: input.name, mapAssetId: input.mapAssetId ?? state.combat.mapAssetId ?? "", combat: emptySceneCombat(), ...(input.replayOf ? { replayOf: input.replayOf } : {}) };
  state.combat = { ...input.combat, mapAssetId: scene.mapAssetId, scenes: [...scenes, scene], activeSceneId: scene.id, historyCursor: null, historyDirty: false };
  // Launching a replay FROM a replay ends the first one. Without this the twenty-fifth launch in an
  // evening still walks into the cap, because each one would leave its own scene and clones behind -
  // and this path (not `activateScene`) is the one a GM who keeps pressing "Launch from here" takes.
  if (departingId !== null) dropReplayScene(state, departingId);
  return scene;
}

/**
 * One-shot startup migration for states created before scenes existed: if an encounter/map is present
 * but no scenes are, bind the current live combat to a single implicit active scene (whose own slot
 * stays empty - the live copy remains the top-level combat). Additive, so players/viewer are unaffected.
 */
export function migrateToScene(state: GameState, sceneId: string) {
  if (state.combat.scenes.length > 0 || state.combat.mapAssetId === null) return;
  const scene: Scene = { id: sceneId, name: "Scene 1", mapAssetId: state.combat.mapAssetId, combat: emptySceneCombat() };
  state.combat = { ...state.combat, scenes: [scene], activeSceneId: sceneId };
}
