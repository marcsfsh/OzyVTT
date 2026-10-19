import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import type { ResolveContext } from "./resolution/context.js";

/**
 * Time Stop (SRD 5.2.1): "you take 1d4 + 1 turns in a row ... This spell ends if one of the actions you use during
 * this period, or any effects that you create during it, affects a creature other than you ... In addition, the spell
 * ends if you move to a place more than 1,000 feet from the location where you cast it." The cast rolls the turns
 * (`startTimeStop`); a turn change gives the caster the next one while any are left (`timeStopGoesOn`); a resolve that
 * reaches another creature, or a move too far, ends it (`breakTimeStop`).
 */

export const TIME_STOP_SPELL_ID = "time-stop";
const RANGE_FEET = 1000;

/** The cast: the server rolls 1d4 + 1 and the caster takes that many turns in a row, this one first. */
export function startTimeStop(
  state: GameState,
  casterId: string,
  random: (sides: number) => number
): Readonly<{ turns: number; face: number }> {
  const face = random(4);
  const turns = face + 1;
  const at = state.combat.tokens.find((token) => token.actorId === casterId)?.position ?? null;
  state.combat = {
    ...state.combat,
    // The turns after this one: it is the first.
    timeStop: { actorId: casterId, turnsLeft: Math.min(5, turns - 1), at: at ? { ...at } : null }
  };
  return { turns, face };
}

/** Whether the turn now ending passes to the Time Stop's caster again; spends one of its turns when it does. */
export function timeStopGoesOn(state: GameState): boolean {
  const stop = state.combat.timeStop;
  if (!stop || stop.actorId !== state.combat.turnActorId) return false;
  if (stop.turnsLeft <= 0) {
    state.combat = { ...state.combat, timeStop: null };
    return false;
  }
  state.combat = { ...state.combat, timeStop: { ...stop, turnsLeft: stop.turnsLeft - 1 } };
  return true;
}

/** Ends a running Time Stop early: its caster affected another creature, or went too far. */
export function breakTimeStop(state: GameState, casterId: string, why: string): EffectNarration[] {
  const stop = state.combat.timeStop;
  if (!stop || stop.actorId !== casterId) return [];
  state.combat = { ...state.combat, timeStop: null };
  const name = state.actors.find((actor) => actor.id === casterId)?.name ?? "The caster";
  return [{ kind: "effect", text: `Time Stop ends: ${name} ${why}.`, actorId: casterId }];
}

/** A move that takes the caster more than 1,000 feet from where it cast Time Stop ends it. */
export function timeStopOutOfRange(
  state: GameState,
  casterId: string,
  distance: (a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>) => number | null
): EffectNarration[] {
  const stop = state.combat.timeStop;
  const at = state.combat.tokens.find((token) => token.actorId === casterId)?.position;
  if (!stop || stop.actorId !== casterId || !stop.at || !at) return [];
  const feet = distance(stop.at, at);
  return feet !== null && feet > RANGE_FEET ? breakTimeStop(state, casterId, "moved more than 1,000 feet away") : [];
}

/** The resolve's part: casting Time Stop rolls its turns, and anything else its caster does to another creature while
 *  it runs ends it. */
export function applyTimeStop(ctx: ResolveContext): void {
  const { state, attacker, action, input, targets, deps } = ctx;
  if (input.commit === false || input.ready === true) return;
  const say = (text: string) =>
    ctx.tableNarration.push({
      kind: "effect",
      text,
      actorIds: [attacker.id],
      ...(ctx.hiddenFromTable(attacker.id) ? { gmOnly: true } : {})
    });
  if (action.spellId === TIME_STOP_SPELL_ID) {
    const { turns, face } = startTimeStop(state, attacker.id, deps.random);
    say(`${attacker.name} stops time and takes ${turns} turns in a row (1d4 + 1: ${face} + 1).`);
    return;
  }
  if (targets.some((target) => target.id !== attacker.id))
    for (const event of breakTimeStop(state, attacker.id, "affected another creature")) say(event.text);
}
