import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { headingWords } from "./compelled-moves.js";
import {
  makeEffect,
  NO_ACTIONS_TAG,
  NO_BONUS_ACTIONS_TAG,
  NO_REACTIONS_TAG,
  sourceOf,
  type EffectNarration
} from "./effects.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";

/**
 * Tables the server rolls on for a creature (SRD 5.2.1): a gibbering mouther's d8 for a creature that failed its save
 * against Gibbering, and Confusion's d10 at the start of each of a confused creature's turns (with the direction it
 * wanders). What the roll forbids for the turn rides an effect that ends with the turn; a wander binds the turn's moves
 * to its direction and all its movement (`compelled-moves.ts`), and a swing at a random creature within reach picks
 * that creature, the one the creature's action may strike (`forcedAttack`, `resolution/economy.ts`).
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** What the tables read of the map: who stands within a creature's reach. */
export type RandomOutcomeDeps = Readonly<{
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
}>;

/** The tag on a failure against a gibbering mouther's Gibbering: its d8 decides the creature's turn. */
export const GIBBERING_TAG = "gibbering";
/** The tag on Confusion's failure: a d10 at the start of each of the bearer's turns. */
export const CONFUSED_TAG = "confused";

/** A direction in degrees, rolled on a d4 (Confusion: north, east, south, west) or a d8 (every eighth of a turn). */
const rolledHeading = (random: (sides: number) => number, sides: 4 | 8) => ((random(sides) - 1) * 360) / sides;

/** The creature's melee reach: its longest melee attack's, else 5 feet. */
function reachOf(actor: Actor, deps: RandomOutcomeDeps): number {
  const definition = actor.definitionId ? deps.resolveDefinition?.(actor.definitionId) : undefined;
  return Math.max(5, ...(definition?.actions ?? []).map((action) => action.attack?.reachFeet ?? 5));
}

/** A creature within the creature's reach picked at random; null when none stands there, undefined when the map can't
 *  tell. */
function randomWithinReach(
  state: GameState,
  actor: Actor,
  random: (sides: number) => number,
  deps: RandomOutcomeDeps
): Actor | null | undefined {
  if (!deps.distanceFeet) return undefined;
  const reach = reachOf(actor, deps);
  const near = state.actors.filter((other) => {
    if (other.id === actor.id || other.hp.current <= 0) return false;
    const apart = deps.distanceFeet!(actor.id, other.id);
    return apart !== null && apart <= reach + DISTANCE_TOLERANCE_FEET;
  });
  return near.length === 0 ? null : near[random(near.length) - 1]!;
}

/** A creature as the table hears of it: one hidden from players goes unnamed. */
const shownName = (actor: Actor) => (actor.visibility === "gm-only" ? "a creature" : actor.name);

/** Rewrites one effect on the creature for the rest of its turn. */
function forThisTurn(
  actor: Actor,
  effect: Effect,
  name: string,
  tags: readonly string[],
  speedZero: boolean,
  extra: Partial<Pick<Effect, "compelled" | "forcedAttack">> = {}
): void {
  actor.effects = actor.effects.map((candidate) =>
    candidate.id === effect.id
      ? {
          ...candidate,
          name: name.slice(0, 120),
          tags: [...new Set([...candidate.tags, ...tags])].slice(0, 8),
          ...(speedZero ? { speedZero: true } : {}),
          ...extra
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
export function gibberingTurn(
  state: GameState,
  target: Actor,
  random: (sides: number) => number,
  deps: RandomOutcomeDeps = {}
): EffectNarration[] {
  const effect = target.effects.find((candidate) => candidate.tags.includes(GIBBERING_TAG));
  if (!effect) return [];
  const roll = random(8);
  const said = (text: string): EffectNarration => ({
    kind: "effect",
    text: `${target.name} rolls ${roll} on the d8 for Gibbering: ${text}`,
    actorId: target.id,
    ...sourceOf(effect)
  });
  const nothing = () =>
    forThisTurn(
      target,
      effect,
      "Gibbering: does nothing",
      [NO_ACTIONS_TAG, NO_BONUS_ACTIONS_TAG, NO_REACTIONS_TAG],
      true
    );
  if (roll <= 4) {
    nothing();
    return [said("it does nothing this turn.")];
  }
  if (roll <= 6) {
    const heading = rolledHeading(random, 8);
    forThisTurn(target, effect, "Gibbering: wanders", [NO_ACTIONS_TAG, NO_BONUS_ACTIONS_TAG], false, {
      compelled: { way: "heading", heading, allMovement: true, once: true }
    });
    return [said(`it takes no action or Bonus Action and uses all its movement to move ${headingWords(heading)}.`)];
  }
  const victim = randomWithinReach(state, target, random, deps);
  if (victim === null) {
    nothing();
    return [said("no creature is within its reach, so it does nothing this turn.")];
  }
  forThisTurn(
    target,
    effect,
    "Gibbering: lashes out",
    [NO_BONUS_ACTIONS_TAG],
    false,
    victim ? { forcedAttack: { targetId: victim.id } } : {}
  );
  return [
    said(
      victim
        ? `it makes one melee attack against ${shownName(victim)}, picked at random within its reach.`
        : "it makes a melee attack against a randomly determined creature within its reach, or does nothing if it can't."
    )
  ];
}

/**
 * SRD Confusion: "An affected target can't take Bonus Actions or Reactions, and it rolls 1d10 at the start of each of
 * its turns to determine its behavior for that turn." 1: no action, and all its movement in a random direction (1d4);
 * 2-6: it doesn't move or take actions; 7-8: no movement, and its action is one melee attack against a random creature
 * within its reach, or nothing; 9-10: it acts and moves normally. What the roll forbids lasts the turn.
 */
export function confusedTurn(
  state: GameState,
  actorId: string,
  random: (sides: number) => number,
  deps: RandomOutcomeDeps = {}
): EffectNarration[] {
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
  const turn = (
    name: string,
    tags: readonly string[],
    speedZero: boolean,
    extra: Partial<Pick<Effect, "compelled" | "forcedAttack">> = {}
  ) => {
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
        ...(speedZero ? { speedZero: true } : {}),
        ...extra
      })
    ];
  };
  if (roll === 1) {
    const heading = rolledHeading(random, 4);
    turn("Confusion: wanders", [NO_ACTIONS_TAG], false, {
      compelled: { way: "heading", heading, allMovement: true, once: true }
    });
    return [said(`it takes no action and uses all its movement to move ${headingWords(heading)}.`)];
  }
  if (roll <= 6) {
    turn("Confusion: stands dazed", [NO_ACTIONS_TAG], true);
    return [said("it doesn't move or take actions this turn.")];
  }
  if (roll <= 8) {
    const victim = randomWithinReach(state, actor, random, deps);
    if (victim === null) {
      turn("Confusion: stands dazed", [NO_ACTIONS_TAG], true);
      return [said("it doesn't move, and no creature is within its reach, so it takes no action.")];
    }
    turn("Confusion: lashes out", [], true, victim ? { forcedAttack: { targetId: victim.id } } : {});
    return [
      said(
        victim
          ? `it doesn't move, and its action is one melee attack against ${shownName(victim)}, picked at random within its reach.`
          : "it doesn't move, and its action is a melee attack against a randomly determined creature within its reach, or nothing if there is none."
      )
    ];
  }
  return [said("it can act and move normally this turn.")];
}
