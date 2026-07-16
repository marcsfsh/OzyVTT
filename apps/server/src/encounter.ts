import type { EncounterStartEntry, GameState, InitiativeEntry } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";

type StartEncounterInput = Readonly<{
  mapAssetId: string;
  entries: readonly EncounterStartEntry[];
}>;

const validScore = (value: number) => Number.isInteger(value) && value >= -1000 && value <= 1000;

function ordered(state: GameState, entries: readonly InitiativeEntry[]) {
  const names = new Map(state.actors.map((actor) => [actor.id, actor.name]));
  return [...entries].sort((left, right) => right.score - left.score
    || right.tieBreaker - left.tieBreaker
    || (names.get(left.actorId) ?? "").localeCompare(names.get(right.actorId) ?? "")
    || left.actorId.localeCompare(right.actorId));
}

export function startEncounter(state: GameState, input: StartEncounterInput, rollD20: () => number, tokenGeometry: TokenMapGeometry) {
  if (state.combat.active) throw new CommandRejectedError("End the active encounter before starting another one.");
  if (input.entries.length === 0 || input.entries.length > 200) throw new CommandRejectedError("Choose 1 to 200 combatants before starting the encounter.");
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
  state.combat = {
    active: true,
    round: 1,
    turnActorId: sorted[0].actorId,
    mapAssetId: input.mapAssetId,
    initiative: sorted,
    tokens: createEncounterTokens(sorted.map((entry) => entry.actorId), tokenGeometry),
    annotations: []
  };
}

export function endEncounter(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter to end.");
  state.combat = { ...state.combat, active: false, turnActorId: null };
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

export function nextInitiativeTurn(state: GameState) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before advancing Initiative.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === state.combat.initiative.length - 1;
  state.combat = {
    ...state.combat,
    round: wraps ? state.combat.round + 1 : state.combat.round,
    turnActorId: state.combat.initiative[wraps ? 0 : currentIndex + 1].actorId
  };
}

export function previousInitiativeTurn(state: GameState) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before moving Initiative backward.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === 0;
  state.combat = {
    ...state.combat,
    round: wraps && state.combat.round > 1 ? state.combat.round - 1 : state.combat.round,
    turnActorId: state.combat.initiative[wraps ? state.combat.initiative.length - 1 : currentIndex - 1].actorId
  };
}
