import type { GameState, PendingSave } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";

/**
 * A spell turned back on its caster after a successful save against it (SRD 5.2.1 Ring of Spell Turning: "deflect that
 * spell back at the spell's caster; the caster must make a saving throw against the spell using its own spell save
 * DC"; Staff of Charming: "turn the spell back on its caster as if you had cast the spell"). The caster then owes the
 * same save the bearer made, against the DC the answer names, with the same damage and the same failure; the bearer
 * is its source. What the spell's caster concentrated on stays theirs, so the turned copy holds no Concentration.
 */
export function turnSaveBack(
  state: GameState,
  pending: PendingSave,
  bearer: Readonly<{ id: string; name: string }>,
  dc: number,
  newId: () => string
): EffectNarration[] {
  const caster = state.actors.find((actor) => actor.id === pending.sourceActorId);
  if (!caster || caster.id === bearer.id) return [];
  const {
    confirmed: _confirmed,
    repeatOf: _repeatOf,
    callId: _callId,
    zoneId: _zoneId,
    touchedZone: _touchedZone,
    onFailEffect,
    onSuccessEffect,
    ...rest
  } = structuredClone(pending);
  const asBearer = <T extends NonNullable<PendingSave["onFailEffect"]>>(effect: T): T => {
    const { castId: _castId, ...kept } = effect;
    return { ...kept, sourceActorId: bearer.id, sourceName: bearer.name } as T;
  };
  const turned: PendingSave = {
    ...rest,
    id: newId(),
    targetActorId: caster.id,
    sourceActorId: bearer.id,
    sourceName: bearer.name,
    dc,
    ...(onFailEffect ? { onFailEffect: asBearer(onFailEffect) } : {}),
    ...(onSuccessEffect ? { onSuccessEffect: asBearer(onSuccessEffect) } : {})
  };
  state.combat = { ...state.combat, pendingSaves: [...state.combat.pendingSaves, turned] };
  return [
    {
      kind: "effect",
      text: `${bearer.name} turns ${pending.actionName} back on ${caster.name}, who makes a DC ${dc} saving throw against it.`,
      actorId: caster.id
    }
  ];
}
