import type { GameState } from "@vtt/domain";
import {
  makeEffect,
  NO_ACTIONS_TAG,
  NO_BONUS_ACTIONS_TAG,
  NO_REACTIONS_TAG,
  sourceOf,
  type EffectNarration
} from "./effects.js";

/**
 * Tables the server rolls on for a creature (SRD 5.2.1): a gibbering mouther's d8 for a creature that failed its save
 * against Gibbering, and Confusion's d10 at the start of each of a confused creature's turns (with the d4 direction
 * it wanders). What the roll forbids for the turn rides an effect that ends with the turn; what it asks the creature
 * to do (move, swing at a random creature) is said to the table.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** The tag on a failure against a gibbering mouther's Gibbering: its d8 decides the creature's turn. */
export const GIBBERING_TAG = "gibbering";
/** The tag on Confusion's failure: a d10 at the start of each of the bearer's turns. */
export const CONFUSED_TAG = "confused";

const DIRECTIONS_D4 = ["north", "east", "south", "west"] as const;
const DIRECTIONS_D8 = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** Rewrites one effect on the creature for the rest of its turn. */
function forThisTurn(actor: Actor, effect: Effect, name: string, tags: readonly string[], speedZero: boolean): void {
  actor.effects = actor.effects.map((candidate) =>
    candidate.id === effect.id
      ? {
          ...candidate,
          name: name.slice(0, 120),
          tags: [...new Set([...candidate.tags, ...tags])].slice(0, 8),
          ...(speedZero ? { speedZero: true } : {})
        }
      : candidate
  );
}

/**
 * SRD Gibbering, on a failed save: "The target rolls 1d8 to determine what it does during the current turn: 1-4: The
 * target does nothing. 5-6: The target takes no action or Bonus Action and uses all its movement to move in a random
 * direction. 7-8: The target makes a melee attack against a randomly determined creature within its reach or does
 * nothing if it can't make such an attack." The failure's effect lasts the turn and takes what the roll forbids.
 */
export function gibberingTurn(target: Actor, random: (sides: number) => number): EffectNarration[] {
  const effect = target.effects.find((candidate) => candidate.tags.includes(GIBBERING_TAG));
  if (!effect) return [];
  const roll = random(8);
  const said = (text: string): EffectNarration => ({
    kind: "effect",
    text: `${target.name} rolls ${roll} on the d8 for Gibbering: ${text}`,
    actorId: target.id,
    ...sourceOf(effect)
  });
  if (roll <= 4) {
    forThisTurn(
      target,
      effect,
      "Gibbering: does nothing",
      [NO_ACTIONS_TAG, NO_BONUS_ACTIONS_TAG, NO_REACTIONS_TAG],
      true
    );
    return [said("it does nothing this turn.")];
  }
  if (roll <= 6) {
    const direction = DIRECTIONS_D8[random(8) - 1] ?? "north";
    forThisTurn(target, effect, "Gibbering: wanders", [NO_ACTIONS_TAG, NO_BONUS_ACTIONS_TAG], false);
    return [said(`it takes no action or Bonus Action and uses all its movement to move ${direction}.`)];
  }
  forThisTurn(target, effect, "Gibbering: lashes out", [NO_BONUS_ACTIONS_TAG], false);
  return [
    said(
      "it makes a melee attack against a randomly determined creature within its reach, or does nothing if it can't."
    )
  ];
}

/**
 * SRD Confusion: "An affected target can't take Bonus Actions or Reactions, and it rolls 1d10 at the start of each of
 * its turns to determine its behavior for that turn." 1: no action, and all its movement in a random direction (1d4);
 * 2-6: it doesn't move or take actions; 7-8: no movement, and its action is a melee attack against a random creature
 * within its reach, or nothing; 9-10: it acts and moves normally. What the roll forbids lasts the turn.
 */
export function confusedTurn(state: GameState, actorId: string, random: (sides: number) => number): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const confusion = actor?.effects.find((effect) => effect.tags.includes(CONFUSED_TAG));
  if (!actor || !confusion || actor.hp.current <= 0) return [];
  const roll = random(10);
  const said = (text: string): EffectNarration => ({
    kind: "effect",
    text: `${actor.name} rolls ${roll} on the d10 for Confusion: ${text}`,
    actorId: actor.id,
    ...sourceOf(confusion)
  });
  // The turn's limits ride an effect of their own that ends with the turn (and with the spell, by its cast).
  const turn = (name: string, tags: readonly string[], speedZero: boolean) => {
    actor.effects = [
      ...actor.effects.filter((effect) => effect.id !== `${confusion.id}:turn`),
      makeEffect({
        id: `${confusion.id}:turn`,
        name,
        tags: [...tags],
        sourceActorId: confusion.sourceActorId,
        sourceName: confusion.sourceName,
        startedRound: state.combat.round,
        duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
        ...(confusion.castId !== undefined ? { castId: confusion.castId } : {}),
        ...(speedZero ? { speedZero: true } : {})
      })
    ];
  };
  if (roll === 1) {
    const direction = DIRECTIONS_D4[random(4) - 1] ?? "north";
    turn("Confusion: wanders", [NO_ACTIONS_TAG], false);
    return [said(`it takes no action and uses all its movement to move ${direction}.`)];
  }
  if (roll <= 6) {
    turn("Confusion: stands dazed", [NO_ACTIONS_TAG], true);
    return [said("it doesn't move or take actions this turn.")];
  }
  if (roll <= 8) {
    turn("Confusion: lashes out", [], true);
    return [
      said(
        "it doesn't move, and its action is a melee attack against a randomly determined creature within its reach, or nothing if there is none."
      )
    ];
  }
  return [said("it can act and move normally this turn.")];
}
