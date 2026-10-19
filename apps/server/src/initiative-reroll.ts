import type { GameState } from "@vtt/domain";
import { keptD20 } from "@vtt/rules-5e";
import type { Initiator } from "./authorization.js";
import { rollInitiative, setInitiativeScore, type InitiativeRollDeps, type InitiativeRollSink } from "./encounter.js";
import { CommandRejectedError } from "./game-store.js";
import { heldD20s, heldRollFor, releaseHeldRoll, requireTypedReroll, spendRerollRight } from "./held-rolls.js";

/**
 * SRD 5.2.1 Heroic Inspiration: "you can expend it to reroll any die immediately after rolling it, and you must use the
 * new roll." Initiative is a Dexterity check, and its d20s are held when they are thrown (`initiative:<actorId>`), so
 * the character's player may reroll one of them with Heroic Inspiration before the fight comes to its first turn. The
 * GM rerolls freely, as for any held die. A typed die is rerolled by typing the reroll's face.
 */
export function rerollInitiative(
  state: GameState,
  actorId: string,
  scope: Initiator,
  face: number | undefined,
  rollD20: () => number,
  onRoll?: InitiativeRollSink,
  deps: InitiativeRollDeps = {}
): number {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before rolling Initiative.");
  const entry = state.combat.initiative.find((candidate) => candidate.actorId === actorId);
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!entry || !actor) throw new CommandRejectedError("That actor is not in this encounter.");
  if (state.combat.pendingInitiative.includes(actorId))
    throw new CommandRejectedError("Roll initiative first: a reroll throws again a die that was thrown.");
  const key = `initiative:${actorId}`;
  const held = heldRollFor(state, key);
  if (!held) throw new CommandRejectedError("Roll initiative first: a reroll throws again a die that was thrown.");
  if (turnsPassed(state, actorId))
    throw new CommandRejectedError(
      `${actor.name}'s initiative die can be rerolled only right after it is rolled, before ${actor.name}'s first turn.`
    );
  const mode = held.readAs ?? "normal";
  let faces: number[];
  if (face !== undefined) {
    requireTypedReroll(state, scope, held);
    spendRerollRight(actor, scope);
    faces = [face];
  } else {
    if (held.typed && scope.role !== "gm") throw new CommandRejectedError("Type the die your reroll shows.");
    spendRerollRight(actor, scope);
    faces = heldD20s(held, mode, () => rollD20(), scope.role === "gm" ? "all" : "one").faces;
  }
  const natural = face ?? keptD20(faces, mode);
  const roll = rollInitiative(state, actorId, entry.surprised === true, rollD20, deps, natural);
  setInitiativeScore(state, actorId, roll.total);
  releaseHeldRoll(state, key);
  if (face === undefined) onRoll?.({ actorId, ...roll, mode });
  return roll.total;
}

/** Whether the fight has already come to the creature's first turn: past round 1, or round 1 at or past its place.
 *  While a waiting fight gathers its rolls, no turn has begun. */
function turnsPassed(state: GameState, actorId: string): boolean {
  const { round, turnActorId, initiative, playerInitiativeMode, pendingInitiative } = state.combat;
  if (playerInitiativeMode === "wait" && pendingInitiative.length > 0) return false;
  if (round > 1) return true;
  const current = initiative.findIndex((entry) => entry.actorId === turnActorId);
  const own = initiative.findIndex((entry) => entry.actorId === actorId);
  return current >= 0 && own <= current;
}
