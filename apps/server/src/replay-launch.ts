import type { GameState, Scene, SceneCombat } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
import { activateNewScene, sceneHeadroom, sceneSlotsNeededToGoLive } from "./scenes.js";

/**
 * ============================================================================================
 * LAUNCH FROM HERE (D25) - ONE TABLE, THE SAME PARK/RESUME MOTION
 * ============================================================================================
 *
 * "Launch from this moment" parks the current table exactly as switching scenes does and makes the
 * archived moment live on it. There is no second table, no rerun room, and no separate mode: the
 * parked scene resumes any time through `scene.activate`, which is the motion the GM already knows.
 *
 * WHY THE COMBATANTS ARE CLONED UNDER NEW IDS. Actor state is GLOBAL and parking a scene does not
 * park hit points - that is deliberate (damage carries across scene swaps, the correct 5e reading).
 * So restoring an archived combatant ONTO its current id would rewrite the party's present: the
 * fighter who is at 4 HP tonight would silently be handed the 31 HP they had in last week's fight,
 * and there would be no way back. The clone is DATA SAFETY, not a separate concept - what the GM
 * sees is one table showing an old fight, with tonight's characters untouched behind it.
 *
 * Claims do not resurrect: a replay combatant is owned by nobody (`ownerSessionId: null`). The
 * player owns their LIVE character, and handing them a second body would let one session act twice.
 */

/** How the launch names a cloned combatant, once - never accumulating on a replay of a replay. */
const REPLAY_SUFFIX = " (replay)";
const withReplaySuffix = (name: string) => {
  if (name.endsWith(REPLAY_SUFFIX)) return name;
  const room = 120 - REPLAY_SUFFIX.length;
  return `${name.length > room ? name.slice(0, room) : name}${REPLAY_SUFFIX}`;
};

/** The definition cap `GameStateSchema` enforces; the launch refuses UP FRONT rather than failing mid-clone. */
const MAX_DEFINITIONS = 100;

export type ReplayLaunchInput = Readonly<{
  /** The archive row id - namespaces any definitions the launch has to store. */
  archiveId: number;
  document: EncounterArchiveDocument;
  /** Which recorded boundary to make live: an INDEX INTO `document.turns` (0 = the fight's first turn). */
  turnIndex: number;
  /** Scene id for the launched moment, and the id an unbound live encounter parks under. */
  sceneId: string;
  implicitSceneId: string;
  newActorId: () => string;
}>;

export type ReplayLaunchOutcome = Readonly<{
  scene: Scene;
  /** The cloned combatants, so the client can offer "remove these" when the replay scene is dropped. */
  actorIds: readonly string[];
  turnIndex: number;
  label: string;
}>;

/**
 * Rewrite every occurrence of an old actor id inside a cloned structure.
 *
 * A STRUCTURAL WALK, not a field-by-field list, and that is the point: a hand-written list of the
 * dozen places a combat holds an actor id (initiative, tokens, `turn.turnUses`' composite keys,
 * `reactionsUsed`, `legendaryUsed`' keys, three pending queues, effect source links) is exactly the
 * kind of list that goes stale the next time the combat shape grows, and the failure mode is a
 * replay quietly pointing at a LIVE actor. The walk cannot go stale. Ids are uuids, so a value
 * matching one is that actor and nothing else; composite keys (`<actorId>:<pool>`) are remapped by
 * their prefix.
 */
function remapIds<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => remapIds(entry, map)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const colon = key.indexOf(":");
      const remappedKey = map.get(key) ?? (colon > 0 && map.has(key.slice(0, colon)) ? `${map.get(key.slice(0, colon))!}${key.slice(colon)}` : key);
      out[remappedKey] = remapIds(entry, map);
    }
    return out as unknown as T;
  }
  return value;
}

/** The archived combat, reduced to the scene-shaped fields (no map, no scene bookkeeping, no timeline). */
function sceneCombatFrom(combat: GameState["combat"]): SceneCombat {
  return {
    active: combat.active, round: combat.round, turnActorId: combat.turnActorId,
    initiative: combat.initiative, tokens: combat.tokens, annotations: combat.annotations, turn: combat.turn,
    rulesMode: combat.rulesMode, ruleExceptions: combat.ruleExceptions,
    playerDamageMode: combat.playerDamageMode, playerInitiativeMode: combat.playerInitiativeMode,
    healthDisplay: combat.healthDisplay, underwater: combat.underwater,
    reactionsUsed: combat.reactionsUsed, legendaryUsed: combat.legendaryUsed, fog: combat.fog,
    pendingSaves: combat.pendingSaves, pendingReactions: combat.pendingReactions, pendingDamage: combat.pendingDamage,
    pendingRuleAsks: combat.pendingRuleAsks, pendingInitiative: combat.pendingInitiative
  };
}

/**
 * Make one archived moment live. Runs INSIDE the command transaction (it mutates `state`), and every
 * refusal below is raised before anything is written.
 */
export function launchReplay(state: GameState, input: ReplayLaunchInput): ReplayLaunchOutcome {
  const turns = input.document.turns ?? [];
  if (turns.length === 0) throw new CommandRejectedError("This recording has no turns to launch.");
  const turn = turns[input.turnIndex];
  if (!turn || !turn.state) throw new CommandRejectedError("That moment is not in this recording.");
  const archived = turn.state;

  // Scene headroom FIRST: a launch can need two slots (one to park an unbound live encounter, one
  // for the replay itself), and finding that out half-way through would leave a mangled table.
  if (sceneHeadroom(state) < sceneSlotsNeededToGoLive(state)) {
    throw new CommandRejectedError("Remove a prepared scene first - launching needs room to park the table and stage the replay.");
  }

  const combatantIds = [...new Set(archived.combat.initiative.map((entry) => entry.actorId))];
  if (combatantIds.length === 0) throw new CommandRejectedError("That moment has no combatants to launch.");

  // Definition headroom, counted before the clone: only imported stat blocks that are not already
  // stored under the same id need a slot; bundled ones resolve through the content library as-is.
  const definitionsToStore: Array<{ id: string; definition: EncounterArchiveDocument["definitions"][number]["definition"] }> = [];
  const definitionIdMap = new Map<string, string>();
  for (const actorId of combatantIds) {
    const source = archived.actors.find((actor) => actor.id === actorId);
    const definitionId = source?.definitionId ?? null;
    if (definitionId === null || definitionIdMap.has(definitionId)) continue;
    const archivedDefinition = input.document.definitions.find((entry) => entry.id === definitionId);
    if (!archivedDefinition || archivedDefinition.source !== "imported") continue;
    const current = state.definitions.find((entry) => entry.id === definitionId);
    if (current && JSON.stringify(current.definition) === JSON.stringify(archivedDefinition.definition)) {
      // Identical body already stored under the same id - reuse it rather than minting a twin.
      definitionIdMap.set(definitionId, definitionId);
      continue;
    }
    if (current) {
      // COLLISION RULE: never overwrite a definition the campaign is using now. The replay's copy
      // gets its own namespaced id instead.
      const replayId = `replay-${input.archiveId}-${definitionId}`;
      definitionIdMap.set(definitionId, replayId);
      if (!state.definitions.some((entry) => entry.id === replayId)) definitionsToStore.push({ id: replayId, definition: archivedDefinition.definition });
      continue;
    }
    definitionIdMap.set(definitionId, definitionId);
    definitionsToStore.push({ id: definitionId, definition: archivedDefinition.definition });
  }
  if (state.definitions.length + definitionsToStore.length > MAX_DEFINITIONS) {
    throw new CommandRejectedError("The table's sheet library is full - delete some imported stat blocks before launching a replay.");
  }

  // Clone every combatant under a NEW id. Ids first, so effect source links and the combat's own
  // references can be remapped in one pass afterwards.
  const actorIdMap = new Map<string, string>();
  for (const actorId of combatantIds) actorIdMap.set(actorId, input.newActorId());

  const clones = combatantIds.flatMap((actorId) => {
    const source = archived.actors.find((actor) => actor.id === actorId);
    if (!source) return [];
    const clone = remapIds(structuredClone(source), actorIdMap);
    return [{
      ...clone,
      id: actorIdMap.get(actorId)!,
      name: withReplaySuffix(source.name),
      ownerSessionId: null,
      archived: false,
      ...(clone.definitionId ? { definitionId: definitionIdMap.get(clone.definitionId) ?? clone.definitionId } : {})
    }];
  });

  const combat = remapIds(structuredClone(sceneCombatFrom(archived.combat)), actorIdMap);
  const label = `Replay: turn ${input.turnIndex + 1} of ${input.document.endedAt.slice(0, 10)}`;

  state.actors = [...state.actors, ...clones];
  if (definitionsToStore.length > 0) state.definitions = [...state.definitions, ...definitionsToStore];
  const scene = activateNewScene(state, { sceneId: input.sceneId, name: label, mapAssetId: archived.combat.mapAssetId, combat }, input.implicitSceneId);

  return { scene, actorIds: clones.map((clone) => clone.id), turnIndex: input.turnIndex, label };
}
