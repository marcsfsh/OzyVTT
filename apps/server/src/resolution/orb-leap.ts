import { CommandRejectedError } from "../game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import type { DefinitionAction, ResolveContext } from "./context.js";

/**
 * SRD Chromatic Orb: "If you roll the same number on two or more of the d8s, the orb leaps to a different creature of
 * your choice within 30 feet of the target. Make an attack roll against the new target, and make a new damage roll.
 * The orb can't leap again unless you roll the same number on two or more of the d8s again." "The orb can leap a
 * maximum number of times equal to the level of the slot expended, and a creature can be targeted only once by each
 * casting of this spell."
 *
 * The server sees the dice: a hit whose d8s match leaves the cast's action open for one more orb, which the caster casts
 * again at no further cost against a creature within 30 feet of the last one, of the same type, each creature once,
 * up to the slot's number of leaps (one for a level 1 slot).
 */

const ORB = "chromatic-orb";
const LEAP_FEET = 30;

type Leap = NonNullable<NonNullable<ResolveContext["state"]["combat"]["turn"]["actionInstance"]>["leap"]>;

/** The leap open for this attacker's orb, if this cast continues one. */
function openLeap(ctx: Pick<ResolveContext, "state" | "attacker" | "action">): Leap | undefined {
  const open = ctx.state.combat.turn.actionInstance;
  if (ctx.action.spellId !== ORB || !open || open.actorId !== ctx.attacker.id || !open.leap) return undefined;
  return (open.components[ctx.action.id] ?? 0) > 0 ? open.leap : undefined;
}

/** A leap's target, checked before anything rolls, and its damage type kept: a creature not struck by this casting,
 *  within 30 feet of the last target. */
export function checkOrbLeap(ctx: ResolveContext): DefinitionAction {
  const leap = openLeap(ctx);
  if (!leap) return ctx.action;
  const target = ctx.targets[0];
  if (!target) return ctx.action;
  const named = ctx.hiddenFromInitiator(target.id) ? "That creature" : target.name;
  if (leap.struck.includes(target.id))
    throw new CommandRejectedError(`${named} was already struck by this Chromatic Orb; it leaps to another creature.`);
  const apart = ctx.deps.distanceFeet?.(leap.fromId, target.id) ?? null;
  if (apart !== null && apart > LEAP_FEET + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(`The orb leaps only to a creature within ${LEAP_FEET} feet of its last target.`);
  const type = leap.damageType;
  return type ? { ...ctx.action, damage: ctx.action.damage.map((part) => ({ ...part, type })) } : ctx.action;
}

/** After the hit: matching d8s open one more leap while the slot allows one, and a leap taken counts. */
export function orbLeap(ctx: ResolveContext): void {
  const { action, attack, state, input, attacker } = ctx;
  if (action.spellId !== ORB || input.commit === false || attack === null) return;
  const target = ctx.targets[0];
  const before = openLeap(ctx) ?? state.combat.turn.actionInstance?.leap;
  const leaping = before !== undefined && state.combat.turn.actionInstance?.actorId === attacker.id;
  const slot = ctx.plan.castLevel ?? 1;
  const allowed = slot <= 1 ? 1 : slot;
  const left = leaping ? before!.left : allowed;
  const struck = [...(leaping ? before!.struck : []), ...(target ? [target.id] : [])];
  const hit = attack.outcome === "hit" || attack.outcome === "crit";
  const faces = state.rolls
    .filter((roll) => roll.commandId === input.commandId && roll.purpose === "damage")
    .flatMap((roll) => roll.dice.filter((die) => die.sides === 8 && die.kept).map((die) => die.face));
  const matched = hit && new Set(faces).size !== faces.length;
  const current = state.combat.turn.actionInstance;
  // A single orb opens no instance of its own; a leap makes one, keeping the cast's slot.
  const instance =
    current && current.actorId === attacker.id
      ? current
      : { actorId: attacker.id, components: {}, ...(ctx.plan.castLevel ? { slotLevel: ctx.plan.castLevel } : {}) };
  if (!matched || left <= 0 || !target) {
    // No leap now: the cast's action is done.
    if (current?.leap && current.actorId === attacker.id)
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, actionInstance: { ...current, components: { [action.id]: 0 } } }
      };
    return;
  }
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      actionInstance: {
        ...instance,
        components: { ...instance.components, [action.id]: 1 },
        ...(instance.slotLevel === undefined && ctx.plan.castLevel ? { slotLevel: ctx.plan.castLevel } : {}),
        leap: {
          fromId: target.id,
          struck,
          left: left - 1,
          ...(action.damage[0]?.type ? { damageType: action.damage[0].type } : {})
        }
      }
    }
  };
  ctx.tableNarration.push({
    kind: "effect",
    text: `Two of Chromatic Orb's d8s match: the orb leaps. ${attacker.name} casts it again at no cost against a different creature within 30 feet of ${target.name} (${left} ${left === 1 ? "leap" : "leaps"} left).`,
    actorIds: [attacker.id]
  });
}
