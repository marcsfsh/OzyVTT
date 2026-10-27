import type { GameState, PendingSave } from "@vtt/domain";
import type { ActorDefinition, HitPointBand, SaveCondition } from "@vtt/schemas";
import { conditionLabel } from "./condition-rules.js";
import {
  addEffect,
  DEATH_WARD_TAG,
  effectDurationOf,
  endEffect,
  makeEffect,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import { killOutright, loseHitPoints, type DamageDeps } from "./hit-points.js";
import { OFF_PLANE_TAG } from "./off-plane.js";
import { creatureTypeOf } from "./statblock-facts.js";

/**
 * Saves whose failure acts by the target's Hit Points as it fails (SRD Divine Word, a solar's Slaying Bow, a sea hag's
 * Death Glare) and saves whose failure sends a creature of some types home (Divine Word). The band replaces the
 * failure's damage and conditions: the target dies (Death Ward negates that, an effect that kills without damage),
 * drops to 0 Hit Points, or has the band's conditions for its time. Above every band the failure is as printed.
 */

type Actor = GameState["actors"][number];
type SaveBlock = Readonly<{
  failureByHitPoints?: readonly HitPointBand[];
  failureBanishes?: readonly string[];
  banishedForGood?: true;
}>;

/** What a save block carries onto its pending saves of this; empty when it has neither. */
export function fatalFailureOf(
  save: SaveBlock
): Pick<PendingSave, "failureByHitPoints" | "failureBanishes" | "banishedForGood"> | null {
  if (!save.failureByHitPoints && !save.failureBanishes) return null;
  return {
    ...(save.failureByHitPoints ? { failureByHitPoints: structuredClone([...save.failureByHitPoints]) } : {}),
    ...(save.failureBanishes ? { failureBanishes: [...save.failureBanishes] } : {}),
    ...(save.failureBanishes && save.banishedForGood ? { banishedForGood: true as const } : {})
  };
}

/** The band a target falls in by its Hit Points now: the lowest whose threshold holds them. */
export function hitPointBandOf(pending: Pick<PendingSave, "failureByHitPoints">, target: Actor): HitPointBand | null {
  const bands = [...(pending.failureByHitPoints ?? [])].sort((left, right) => left.atOrBelow - right.atOrBelow);
  return bands.find((band) => target.hp.current <= band.atOrBelow) ?? null;
}

const conditionWords = (ids: readonly SaveCondition[]) => {
  const labels = ids.map((id) => conditionLabel(id));
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

/** What the target's band does as its save fails. */
export function applyHitPointBand(
  state: GameState,
  target: Actor,
  band: HitPointBand,
  pending: Pick<PendingSave, "actionName" | "sourceActorId" | "sourceName">,
  deps: DamageDeps & ConditionImmunitySource,
  id: string
): EffectNarration[] {
  const cause = pending.actionName;
  if (band.dies) return killOutright(state, target.id, cause, { withoutDamage: true, deps });
  if (band.dropsToZero) {
    // "The first time the target would drop to 0 Hit Points ... the target instead drops to 1 Hit Point".
    const ward = target.effects.find((effect) => effect.tags.includes(DEATH_WARD_TAG));
    if (ward && target.hp.current > 0) {
      target.hp = { ...target.hp, current: 1 };
      return [
        { kind: "condition", text: `${target.name} drops to 1 Hit Point instead (${ward.name}).`, actorId: target.id },
        ...endEffect(state, target.id, ward.id)
      ];
    }
    const lost = loseHitPoints(state, target.id, target.hp.current, deps);
    return [
      { kind: "condition", text: `${target.name} drops to 0 Hit Points (${cause}).`, actorId: target.id },
      ...lost.events
    ];
  }
  if (!band.conditions) return [];
  const events: EffectNarration[] = [];
  addEffect(
    state,
    target.id,
    makeEffect({
      id,
      name: `${conditionWords(band.conditions)} (${cause})`.slice(0, 120),
      sourceActorId: pending.sourceActorId,
      sourceName: pending.sourceName,
      startedRound: state.combat.round,
      duration: effectDurationOf(state, band.duration, target.id, pending.sourceActorId),
      linkedConditionIds: [...band.conditions],
      ...(band.endsOnDamage ? { endsOnDamage: true } : {}),
      ...(band.endedBy ? { endedBy: structuredClone(band.endedBy) } : {})
    }),
    events,
    deps
  );
  return events;
}

/** Divine Word: "a Celestial, an Elemental, a Fey, or a Fiend target that fails its save is forced back to its plane of
 *  origin ... and can't return to the current plane for 24 hours". It leaves the map (`off-plane.ts`) for that time, or
 *  until the GM brings it back when it is sent home for good (Dispel Evil and Good's Dismissal). */
export function banishOnFailure(
  state: GameState,
  target: Actor,
  pending: Pick<PendingSave, "actionName" | "sourceActorId" | "sourceName" | "failureBanishes" | "banishedForGood">,
  definition: ActorDefinition | undefined,
  id: string
): EffectNarration[] {
  const type = creatureTypeOf(target, definition);
  if (!pending.failureBanishes || type === null || !pending.failureBanishes.includes(type)) return [];
  addEffect(
    state,
    target.id,
    makeEffect({
      id,
      name: `Sent home (${pending.actionName})`.slice(0, 120),
      tags: [OFF_PLANE_TAG],
      sourceActorId: pending.sourceActorId,
      sourceName: pending.sourceName,
      startedRound: state.combat.round,
      duration: pending.banishedForGood ? { type: "manual" } : { type: "minutes", remaining: 24 * 60 }
    })
  );
  return [
    {
      kind: "condition",
      text: pending.banishedForGood
        ? `${target.name} is sent back to its home plane (${pending.actionName}).`
        : `${target.name} is forced back to its plane of origin and can't return for 24 hours (${pending.actionName}).`,
      actorId: target.id
    }
  ];
}
