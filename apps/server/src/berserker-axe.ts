import type { GameState } from "@vtt/domain";
import { catalogIdOf } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import { createPendingSaves } from "./pending-saves.js";

/**
 * SRD Berserker Axe, Curse: "Whenever another creature damages you while the axe is in your possession, you must succeed
 * on a DC 15 Wisdom saving throw or go berserk. While berserk, you must use your action each round to attack the
 * creature nearest to you ... You are berserk until you start your turn with no creatures within 60 feet of you that
 * you can see or hear." The save opens as a prompt; a failure leaves the Berserk effect, which ends at the start of a
 * turn with no other creature within 60 feet (`calmAtTurnStart`).
 */

type Actor = GameState["actors"][number];

export const AXE_BERSERK_TAG = "axe-berserk";
const AXE_ID = "berserker-axe";
const CURSE_DC = 15;
/** "No creatures within 60 feet of you". */
const CALM_FEET = 60;

/** The bearer carries an attuned Berserker Axe, whose curse holds it. */
function cursedByTheAxe(actor: Actor): boolean {
  return actor.inventory.some((row) => row.attuned && catalogIdOf(row) === AXE_ID);
}

/** Damage from another creature: the cursed bearer saves or goes berserk. One prompt at a time, and none while it is
 *  berserk already. */
export function berserkerCurse(
  state: GameState,
  actor: Actor,
  sourceActorId: string | undefined,
  deps: Readonly<{ newId: () => string; now: () => string }>
): EffectNarration[] {
  if (!sourceActorId || sourceActorId === actor.id || actor.hp.current <= 0 || !cursedByTheAxe(actor)) return [];
  if (actor.effects.some((effect) => effect.tags.includes(AXE_BERSERK_TAG))) return [];
  if (state.combat.pendingSaves.some((save) => save.targetActorId === actor.id && save.actionName === "Berserker Axe"))
    return [];
  createPendingSaves(state, {
    sourceActorId: null,
    sourceName: "Berserker Axe",
    actionName: "Berserker Axe",
    ability: "wis",
    dc: CURSE_DC,
    targetIds: [actor.id],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    onFailEffect: {
      name: "Berserk (Berserker Axe)",
      tags: [AXE_BERSERK_TAG],
      linkedConditionIds: [],
      escapeDc: null,
      sourceActorId: null,
      sourceName: "Berserker Axe",
      sourceActionId: AXE_ID
    },
    extra: {
      failureNote: `${actor.name} goes berserk: each round its action attacks the creature nearest to it, one at random among the nearest, and its extra attacks move on to the next nearest once one falls.`
    },
    magical: true,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  return [
    {
      kind: "condition",
      text: `${actor.name} is damaged while its Berserker Axe's curse holds: DC ${CURSE_DC} WIS save or go berserk.`,
      actorId: actor.id
    }
  ];
}

/** "Until you start your turn with no creatures within 60 feet of you that you can see or hear": with the map's
 *  distances, a turn that starts with no other creature that near ends it. */
export function calmAtTurnStart(
  state: GameState,
  actorId: string,
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined
): string | null {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const berserk = actor?.effects.find((effect) => effect.tags.includes(AXE_BERSERK_TAG));
  if (!actor || !berserk || !distanceFeet) return null;
  const near = state.combat.initiative.some((entry) => {
    if (entry.actorId === actorId) return false;
    const other = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!other || other.hp.current <= 0) return false;
    const feet = distanceFeet(actorId, other.id);
    return feet === null || feet <= CALM_FEET;
  });
  return near ? null : berserk.id;
}
