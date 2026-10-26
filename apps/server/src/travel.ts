import { isDead, type GameState } from "@vtt/domain";
import type { Modifier } from "@vtt/schemas";
import { endEffectIfPresent, makeEffect } from "./effects.js";

/**
 * SRD 5.2.1 Travel Pace: "While traveling outside combat, a group can move at a Fast, Normal, or Slow pace ... Fast.
 * Traveling at a Fast pace imposes Disadvantage on a traveler's Wisdom (Perception or Survival) and Dexterity
 * (Stealth) checks. Normal ... imposes Disadvantage on Dexterity (Stealth) checks. Slow ... grants Advantage on Wisdom
 * (Perception or Survival) checks." While the GM passes time on the road (`time.pass` with a pace) each character
 * travelling holds the pace as an effect whose riders every check reads, Passive Perception included. Passing time
 * without a pace, resting, or rolling Initiative ends it.
 */

export type TravelPace = "fast" | "normal" | "slow";

/** The tag on the effect a travel pace leaves on each traveller. */
export const TRAVEL_TAG = "travel-pace";
const TRAVEL_EFFECT_ID = "travel-pace";

const PACE_NAMES: Readonly<Record<TravelPace, string>> = {
  fast: "Fast pace",
  normal: "Normal pace",
  slow: "Slow pace"
};

/** A check rider of the pace: Advantage or Disadvantage on checks with one ability and these skills. */
const paceRider = (
  mode: "advantage" | "disadvantage",
  ability: "wis" | "dex",
  skills: readonly string[]
): Modifier => ({
  type: "roll-mode",
  roll: "check",
  mode,
  when: [
    { type: "on-ability-check" },
    { type: "ability-is", abilities: [ability] },
    { type: "skill-is", skills: [...skills] }
  ]
});

const PACE_RIDERS: Readonly<Record<TravelPace, readonly Modifier[]>> = {
  fast: [paceRider("disadvantage", "wis", ["perception", "survival"]), paceRider("disadvantage", "dex", ["stealth"])],
  normal: [paceRider("disadvantage", "dex", ["stealth"])],
  slow: [paceRider("advantage", "wis", ["perception", "survival"])]
};

const inFight = (state: GameState, actorId: string) =>
  state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);

/** The characters who travel with the party: every living, unarchived player character out of a fight. */
function travellers(state: GameState) {
  return state.actors.filter(
    (actor) => actor.kind === "player-character" && !actor.archived && !isDead(actor) && !inFight(state, actor.id)
  );
}

/** The tag naming the pace on its effect ("travel-fast"). */
const paceTag = (pace: TravelPace) => `travel-${pace}`;

/** The pace the party travels at now, read from its travellers; null when nobody is on the road. */
export function travelPaceOf(state: GameState): TravelPace | null {
  for (const actor of state.actors)
    for (const pace of Object.keys(PACE_NAMES) as TravelPace[])
      if (actor.effects.some((effect) => effect.tags.includes(paceTag(pace)))) return pace;
  return null;
}

/** The party travels on at `pace`, or stops (null): each traveller's pace effect is replaced or ended. */
export function setTravelPace(state: GameState, pace: TravelPace | null): void {
  endTravelFor(
    state,
    state.actors.map((actor) => actor.id)
  );
  if (pace === null) return;
  for (const actor of travellers(state))
    actor.effects = [
      ...actor.effects,
      makeEffect({
        id: TRAVEL_EFFECT_ID,
        name: PACE_NAMES[pace],
        duration: { type: "manual" },
        tags: [TRAVEL_TAG, paceTag(pace)],
        sourceName: "Travel",
        startedRound: state.combat.round,
        modifiers: PACE_RIDERS[pace].map((rider) => structuredClone(rider))
      })
    ];
}

/** Travel stops for these creatures: they rest, or roll Initiative ("While traveling outside combat"). */
export function endTravelFor(state: GameState, actorIds: ReadonlySet<string> | readonly string[]): void {
  const ids = new Set(actorIds);
  for (const actor of state.actors)
    if (ids.has(actor.id) && actor.effects.some((effect) => effect.id === TRAVEL_EFFECT_ID))
      endEffectIfPresent(state, actor.id, TRAVEL_EFFECT_ID);
}
