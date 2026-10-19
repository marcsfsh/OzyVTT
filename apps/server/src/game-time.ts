import { ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import { ageEffects, type EffectNarration } from "./effects.js";
import { endZone } from "./spell-zone-state.js";
import { zoneHeld } from "./spell-zones.js";

/**
 * The game clock (ADR-0029) and what lasts on it. A round is 6 seconds, so 10 rounds make a minute: in a fight, what
 * lasts in rounds counts the fight's turns; outside one, the clock moves only when the GM passes time or the party
 * rests, and that time counts down what lasts in rounds (10 a minute), what lasts in minutes or hours, and ends what
 * lasts until a turn. A fight doesn't move the clock: its rounds are its own time.
 */

/** The clock's ceiling, as the state schema bounds it. */
const CLOCK_LIMIT_MINUTES = 10_000_000 * 60 + 59;

/** Minutes of game time since the campaign's clock started. */
export const clockMinutesOf = (state: GameState) => state.rest.clockHours * 60 + state.rest.clockMinutes;

/** The creatures time passes for: everyone but a parked fight's combatants, frozen with the fight they wait in, and a
 *  replay's copies. */
function creaturesInTime(state: GameState): Set<string> {
  const frozen = new Set(
    state.combat.scenes.flatMap((scene) =>
      scene.id !== state.combat.activeSceneId && scene.combat.active
        ? scene.combat.initiative.map((entry) => entry.actorId)
        : []
    )
  );
  return new Set(
    state.actors.filter((actor) => !frozen.has(actor.id) && actor.replaySceneId === undefined).map((actor) => actor.id)
  );
}

/**
 * Moves the game clock `minutes` on, and counts the time down on every creature's effects (`ageEffects`). A spell
 * area ends with the effect that keeps it, or once the time outlasts the rounds it lasts. Returns what ended.
 */
export function passGameTime(state: GameState, minutes: number): EffectNarration[] {
  if (minutes <= 0) return [];
  const total = Math.min(CLOCK_LIMIT_MINUTES, clockMinutesOf(state) + minutes);
  state.rest = { ...state.rest, clockHours: Math.floor(total / 60), clockMinutes: total % 60 };
  const events = ageEffects(state, creaturesInTime(state), minutes);
  for (const zone of [...state.combat.spellZones]) {
    const ends =
      zone.rounds !== null
        ? zone.rounds - (state.combat.round - zone.startedRound) <= minutes * ROUNDS_PER_MINUTE
        : !zoneHeld(state, zone);
    if (!ends || zone.bursting) continue;
    endZone(state, zone.id);
    events.push({ kind: "effect", text: `${zone.name} ends.`, actorId: zone.casterId });
  }
  return events;
}
