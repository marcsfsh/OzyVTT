import type { GameState } from "@vtt/domain";
import type { EffectInstance } from "@vtt/schemas";
import { endEffect, type EffectNarration } from "./effects.js";

/** The tag Warding Bond's effect carries on the warded creature; its source is the caster bound to it. */
export const WARDING_BOND_TAG = "warding-bond";
/** "The spell ends if ... the two of you are separated by more than 60 feet." */
const BOND_REACH_FEET = 60;

type Distance = ((actorIdA: string, actorIdB: string) => number | null) | null;
type Bond = Readonly<{ bearerId: string; effect: EffectInstance }>;

const isBond = (effect: EffectInstance) => effect.tags.includes(WARDING_BOND_TAG);

function bondsIn(state: GameState): Bond[] {
  return state.actors.flatMap((actor) =>
    actor.effects.filter(isBond).map((effect) => ({ bearerId: actor.id, effect }))
  );
}

/** The caster bound to a warded creature, who takes the same damage it takes. Null when it isn't warded by another. */
export function bondCasterOf(state: GameState, bearerId: string): string | null {
  const bearer = state.actors.find((actor) => actor.id === bearerId);
  const bond = bearer?.effects.find((effect) => isBond(effect) && effect.sourceActorId !== bearerId);
  const caster = bond?.sourceActorId ? state.actors.find((actor) => actor.id === bond.sourceActorId) : undefined;
  return caster && caster.hp.current > 0 ? caster.id : null;
}

/** Why a bond ends now: its caster is gone or at 0 Hit Points, or the two are more than 60 feet apart on the map. */
function breaksBecause(state: GameState, bond: Bond, distanceFeet: Distance): string | null {
  const caster = state.actors.find((actor) => actor.id === bond.effect.sourceActorId);
  if (!caster) return "its caster is gone";
  if (caster.hp.current <= 0) return `${caster.name} dropped to 0 Hit Points`;
  const apart = distanceFeet?.(bond.bearerId, caster.id) ?? null;
  return apart !== null && apart > BOND_REACH_FEET ? "the two are more than 60 feet apart" : null;
}

export const holdsBonds = (state: GameState) => state.actors.some((actor) => actor.effects.some(isBond));

export function needsBondSettling(state: GameState, distanceFeet: Distance): boolean {
  return bondsIn(state).some((bond) => breaksBecause(state, bond, distanceFeet) !== null);
}

/** After every command: each Warding Bond whose caster dropped to 0 or moved more than 60 feet away ends. */
export function settleBonds(state: GameState, distanceFeet: Distance): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const bond of bondsIn(state)) {
    const why = breaksBecause(state, bond, distanceFeet);
    if (why === null) continue;
    events.push(...endEffect(state, bond.bearerId, bond.effect.id), {
      kind: "condition",
      text: `${bond.effect.name} ends: ${why}.`,
      actorId: bond.bearerId
    });
  }
  return events;
}

/** "The spell ends if ... the spell is cast again on either of the connected creatures": a new bond on a creature ends
 *  the bonds that already tie it to another, as bearer or as caster. */
export function endCrossedBonds(state: GameState, bearerId: string, keptId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const bond of bondsIn(state)) {
    if (bond.effect.id === keptId && bond.bearerId === bearerId) continue;
    if (bond.bearerId !== bearerId && bond.effect.sourceActorId !== bearerId) continue;
    events.push(...endEffect(state, bond.bearerId, bond.effect.id));
  }
  return events;
}
