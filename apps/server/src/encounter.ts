import type { ActorDefinition, EncounterStartEntry, GameState, InitiativeEntry } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { expireEffectsAtTurnStart, type EffectNarration } from "./effects.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";

type StartEncounterInput = Readonly<{
  mapAssetId: string;
  entries: readonly EncounterStartEntry[];
  rulesMode?: "strict" | "assisted" | "freeform";
}>;

const EMPTY_TURN = { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 } as const;

/** A fresh fight refreshes per-encounter limited-use pools (Frenzy next fight); long-rest pools persist until a rest. */
function clearPerEncounterUses(state: GameState, combatantIds: ReadonlySet<string>, resolveDefinition: (definitionId: string) => ActorDefinition | undefined) {
  for (const actor of state.actors) {
    if (!combatantIds.has(actor.id) || !actor.definitionId) continue;
    const definition = resolveDefinition(actor.definitionId);
    if (!definition) continue;
    for (const action of definition.actions) {
      if (action.uses?.per !== "encounter") continue;
      const key = action.uses.pool ?? action.id;
      if (actor.actionUses[key] !== undefined) {
        const { [key]: _cleared, ...rest } = actor.actionUses;
        actor.actionUses = rest;
      }
    }
  }
}

const validScore = (value: number) => Number.isInteger(value) && value >= -1000 && value <= 1000;

function ordered(state: GameState, entries: readonly InitiativeEntry[]) {
  const names = new Map(state.actors.map((actor) => [actor.id, actor.name]));
  return [...entries].sort((left, right) => right.score - left.score
    || right.tieBreaker - left.tieBreaker
    || (names.get(left.actorId) ?? "").localeCompare(names.get(right.actorId) ?? "")
    || left.actorId.localeCompare(right.actorId));
}

export function startEncounter(state: GameState, input: StartEncounterInput, rollD20: () => number, tokenGeometry: TokenMapGeometry, resolveDefinition?: (definitionId: string) => ActorDefinition | undefined) {
  if (state.combat.active) throw new CommandRejectedError("End the active encounter before starting another one.");
  if (input.entries.length === 0 || input.entries.length > 200) throw new CommandRejectedError("Choose 1 to 200 combatants before starting the encounter.");
  // When a prepared scene is live, the encounter must run on that scene's map so park/resume stays coherent.
  if (state.combat.activeSceneId !== null) {
    const activeScene = state.combat.scenes.find((scene) => scene.id === state.combat.activeSceneId);
    if (activeScene && activeScene.mapAssetId !== input.mapAssetId) throw new CommandRejectedError("This scene uses a different map. Start on the scene's map, or switch scenes first.");
  }
  // Preserve any positions already placed during scene prep (or a prior setup); new combatants start unplaced.
  const placedPositions = new Map(state.combat.tokens.map((token) => [token.actorId, token.position]));
  const actorIds = new Set<string>();
  const initiative = input.entries.map((entry) => {
    if (actorIds.has(entry.actorId)) throw new CommandRejectedError("Each actor can appear in Initiative only once.");
    actorIds.add(entry.actorId);
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!actor) throw new CommandRejectedError("One of the selected combatants no longer exists.");
    const tieBreaker = actor.initiative ?? 0;
    const rolled = entry.score === undefined ? rollD20() + tieBreaker : entry.score;
    if (!validScore(rolled)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
    return { actorId: actor.id, score: rolled, tieBreaker };
  });
  const sorted = ordered(state, initiative);
  // Spread, never a fresh literal: CombatState grows fields over time (pendingSaves today; scenes
  // next) and a wholesale replacement here would silently drop them.
  state.combat = {
    ...state.combat,
    active: true,
    round: 1,
    turnActorId: sorted[0].actorId,
    mapAssetId: input.mapAssetId,
    initiative: sorted,
    tokens: createEncounterTokens(sorted.map((entry) => ({ actorId: entry.actorId, sizeCells: state.actors.find((actor) => actor.id === entry.actorId)?.sizeCells ?? 1 })), tokenGeometry)
      .map((token) => ({ ...token, position: placedPositions.get(token.actorId) ?? token.position })),
    annotations: [],
    turn: { ...EMPTY_TURN },
    rulesMode: input.rulesMode ?? state.combat.rulesMode,
    reactionsUsed: [],
    pendingSaves: [],
    pendingReactions: [],
    // A fresh fight starts live on the timeline; the handler wipes any prior fight's snapshots and
    // captures this start state as the baseline the GM can rewind all the way back to.
    historyCursor: null,
    historyDirty: false
  };
  if (resolveDefinition) clearPerEncounterUses(state, actorIds, resolveDefinition);
}

/** Drops a new combatant into a running encounter: rolls (or takes) its initiative, re-sorts, and places its token. GM-only at the command layer. */
export function addCombatant(state: GameState, actorId: string, score: number | undefined, rollD20: () => number, tokenGeometry: TokenMapGeometry) {
  if (!state.combat.active) throw new CommandRejectedError("Start the encounter before adding a combatant to it.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That combatant is already in the encounter.");
  if (state.combat.initiative.length >= 200) throw new CommandRejectedError("This encounter already has 200 combatants.");
  const tieBreaker = actor.initiative ?? 0;
  const rolled = score === undefined ? rollD20() + tieBreaker : score;
  if (!validScore(rolled)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  state.combat = {
    ...state.combat,
    initiative: ordered(state, [...state.combat.initiative, { actorId, score: rolled, tieBreaker }]),
    tokens: [...state.combat.tokens, ...createEncounterTokens([{ actorId, sizeCells: actor.sizeCells ?? 1 }], tokenGeometry)]
  };
}

export function endEncounter(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter to end.");
  // Ending mid-review would strand the timeline pointing at a fight that no longer exists.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before ending the encounter.");
  state.combat = { ...state.combat, active: false, turnActorId: null, turn: { ...EMPTY_TURN }, reactionsUsed: [], pendingSaves: [], pendingReactions: [], historyCursor: null, historyDirty: false };
}

export function setInitiativeScore(state: GameState, actorId: string, score: number) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before changing Initiative.");
  if (!validScore(score)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That actor is not in this encounter.");
  state.combat = {
    ...state.combat,
    initiative: ordered(state, state.combat.initiative.map((entry) => entry.actorId === actorId ? { ...entry, score } : entry))
  };
}

export function nextInitiativeTurn(state: GameState, events?: EffectNarration[]) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before advancing Initiative.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === state.combat.initiative.length - 1;
  const nextActorId = state.combat.initiative[wraps ? 0 : currentIndex + 1].actorId;
  state.combat = {
    ...state.combat,
    round: wraps ? state.combat.round + 1 : state.combat.round,
    turnActorId: nextActorId,
    // A new turn starts: fresh action/bonus for the incoming actor, whose reaction also refreshes.
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== nextActorId)
  };
  // The incoming actor's sustained durations tick: Reckless ends, Rage counts down (ADR-0020).
  const expiry = expireEffectsAtTurnStart(state, nextActorId);
  events?.push(...expiry);
}

export function previousInitiativeTurn(state: GameState) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before moving Initiative backward.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === 0;
  const previousActorId = state.combat.initiative[wraps ? state.combat.initiative.length - 1 : currentIndex - 1].actorId;
  state.combat = {
    ...state.combat,
    round: wraps && state.combat.round > 1 ? state.combat.round - 1 : state.combat.round,
    turnActorId: previousActorId,
    // Backing up is a GM correction; treat it like any turn change so the strip starts clean.
    // Effect durations deliberately do NOT rewind here — the Time Machine restore is the real undo.
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== previousActorId)
  };
}
