import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

const MAX_ACTORS = 200;

/** "Goblin Warrior" -> "Goblin Warrior 2" -> "Goblin Warrior 3" ... deterministic and collision-free. */
function dedupedName(state: GameState, base: string): string {
  const names = new Set(state.actors.map((actor) => actor.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`.slice(0, 120);
    if (!names.has(candidate)) return candidate;
  }
}

export function addActorFromDefinition(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only") {
  if (state.actors.length >= MAX_ACTORS) throw new CommandRejectedError("The roster is full — remove unused combatants first.");
  if (definition.schemaId !== "vtt.actor-monster") throw new CommandRejectedError("Only monster definitions can be added this way.");
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind: "monster",
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    armorClass: definition.armorClass,
    initiative: definition.initiativeBonus,
    ownerSessionId: null,
    conditions: [],
    ...(definition.summary ? { notes: definition.summary } : {}),
    definitionId: definition.source.externalId
  });
}

export function removeActor(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (actor.kind === "player-character") throw new CommandRejectedError("Player characters can't be removed from the roster.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before removing a combatant who is in it.");
  }
  state.actors = state.actors.filter((item) => item.id !== actorId);
  // A finished encounter keeps its initiative for reference; drop this actor's stale entry
  // and token so nothing references a combatant that no longer exists.
  if (!state.combat.active) {
    state.combat = {
      ...state.combat,
      initiative: state.combat.initiative.filter((entry) => entry.actorId !== actorId),
      tokens: state.combat.tokens.filter((token) => token.actorId !== actorId)
    };
  }
}
