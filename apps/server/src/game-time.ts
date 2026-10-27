import { ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import { ageEffects, type EffectNarration } from "./effects.js";
import { dawnRegains, dawnsBetween, rearmTimedPools, type ClockDeps } from "./clock-pools.js";
import { endZone } from "./spell-zone-state.js";
import { afterDays } from "./rest-triggers.js";
import { breathOverTime } from "./breath.js";
import { endOfDays } from "./survival.js";
import { zoneHeld } from "./spell-zones.js";
import { dueOnTheClock } from "./timed-revival.js";
import { drynessOverTime } from "./water.js";
import { environmentOverTime } from "./environment.js";
import { healingOverTime } from "./clock-healing.js";

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
    state.combat.encounters.flatMap((scene) =>
      scene.id !== state.combat.activeEncounterId && scene.combat.active
        ? scene.combat.initiative.map((entry) => entry.actorId)
        : []
    )
  );
  return new Set(
    state.actors
      .filter((actor) => !frozen.has(actor.id) && actor.replayEncounterId === undefined)
      .map((actor) => actor.id)
  );
}

/**
 * Moves the game clock `minutes` on, and counts the time down on every creature's effects (`ageEffects`). A spell
 * area ends with the effect that keeps it, or once the time outlasts the rounds it lasts. A pool spent for a time comes
 * back once it has passed, and with a dawn hour each dawn passed gives back what items regain at dawn
 * (`clock-pools.ts`, which rolls with `deps`). With `deps`, what acts every 24 hours does too (`afterDays`: a mummy's
 * curse). Returns what ended, came back or acted.
 */
export function passGameTime(state: GameState, minutes: number, deps?: ClockDeps): EffectNarration[] {
  if (minutes <= 0) return [];
  const before = clockMinutesOf(state);
  const total = Math.min(CLOCK_LIMIT_MINUTES, before + minutes);
  state.rest = { ...state.rest, clockHours: Math.floor(total / 60), clockMinutes: total % 60 };
  const inTime = creaturesInTime(state);
  const events = ageEffects(state, inTime, minutes);
  events.push(...rearmTimedPools(state, inTime));
  if (state.rest.dawnHour !== null && deps)
    events.push(...dawnRegains(state, inTime, dawnsBetween(before, total, state.rest.dawnHour), deps));
  // Outside a fight a creature holding its breath spends it as the minutes pass.
  if (!state.combat.active) events.push(...breathOverTime(state, inTime, total - before));
  if (deps) {
    events.push(...afterDays(state, inTime, before, total, deps));
    // The dead whose time has come back, rise or spawn (`timed-revival.ts`).
    events.push(...dueOnTheClock(state, inTime, before, deps));
    // Each midnight the clock crosses ends a day of eating and drinking.
    events.push(...endOfDays(state, inTime, before, total, deps));
    // A creature that must be submerged now and then counts its time out of water.
    events.push(...drynessOverTime(state, inTime, total - before, deps));
    // The scene's weather and water wear on the creatures placed in it, hour by hour and minute by minute.
    events.push(...environmentOverTime(state, inTime, before, total, deps));
    // What heals as time passes (a Ring of Regeneration, a Rod of Security's demiplane).
    events.push(...healingOverTime(state, inTime, before, total, deps));
  }
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
