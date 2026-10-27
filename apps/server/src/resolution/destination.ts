import { setAltitude } from "../altitude.js";
import { endEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { travelBudgetFeet } from "../speed.js";
import { sceneSight } from "../vision/sight.js";
import { policeBarrier } from "../zone-barriers.js";
import { sizeAtMost, type LiveActor, type ResolveContext } from "./context.js";

/**
 * An action that sets a creature down in a space its use picks (`destination`, SRD 5.2.1): a bulette's Deadly Leap
 * ("spends 5 feet of movement to jump to a space within 15 feet that contains one or more Large or smaller creatures")
 * and a kraken's Fling ("throws a Large or smaller creature Grappled by it to a space it can see within 60 feet of itself
 * that isn't in the air"). The space is checked before anything is spent, the creature is set down there as the action
 * resolves, and its save then falls on that creature and each creature in its space.
 */

type Landing = Readonly<{
  mover: LiveActor;
  at: Readonly<{ x: number; y: number }>;
  sharers: readonly string[];
}>;

const SIZE_WORDS: Readonly<Record<string, string>> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan"
};

/** The space a destination action lands in, checked: refused when the use names none, or one out of its reach, sight
 *  or terms. Null for any other action, or when the map can't place it (the GM moves the token). */
function landingOf(ctx: ResolveContext): Landing | null {
  const destination = ctx.action.destination;
  if (!destination) return null;
  const { attacker, input, state } = ctx;
  const point = input.destination;
  if (!point) throw new CommandRejectedError(`Choose the space ${ctx.action.name} lands in.`);
  const mover = destination.who === "user" ? attacker : ctx.targets[0];
  if (!mover) throw new CommandRejectedError(`Choose the creature ${ctx.action.name} throws.`);
  if (destination.who === "target" && ctx.targets.length !== 1)
    throw new CommandRejectedError(`${ctx.action.name} throws one creature.`);
  const placed = ctx.deps.destinationAt?.(mover.id, point, attacker.id) ?? null;
  if (placed === null) return null;
  const police = (rule: Parameters<typeof policeBarrier>[2], message: string) => {
    const said = policeBarrier(state, input.override ?? null, rule, message);
    if (said) ctx.warnings.push(said);
  };
  if (placed.feet > destination.feet + DISTANCE_TOLERANCE_FEET)
    police(
      "range.out-of-range",
      `That space is ${Math.round(placed.feet)} ft from ${attacker.name}, beyond ${ctx.action.name}'s ${destination.feet} ft.`
    );
  if (destination.seen) {
    const sight = sceneSight(state, {
      ...(ctx.deps.resolveDefinition ? { definition: ctx.deps.resolveDefinition } : {}),
      ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
    });
    if (sight.enabled && !sight.seesPoint(attacker.id, placed.at))
      police("target.unseen", `${attacker.name} can't see that space.`);
  }
  if (destination.onto) {
    const onto = destination.onto;
    const holds = placed.sharers.some((id) => sizeAtMost(state.actors.find((actor) => actor.id === id)?.size, onto));
    if (!holds)
      police(
        "movement.jump",
        `${ctx.action.name} lands only in a space with a ${SIZE_WORDS[onto] ?? onto} or smaller creature in it.`
      );
  }
  // "Spends 5 feet of movement": the user's own, on its turn in a fight.
  if (destination.costFeet !== undefined && state.combat.active && state.combat.turnActorId === attacker.id) {
    const budget = travelBudgetFeet(attacker, ctx.derivation, ctx.deps.definition, "walk");
    const used = state.combat.turn.movementUsedFeet;
    if (budget !== null && used + destination.costFeet > budget + DISTANCE_TOLERANCE_FEET)
      police(
        "movement.exceeds-speed",
        `${attacker.name} has ${Math.max(0, budget - used)} ft of movement left, and ${ctx.action.name} spends ${destination.costFeet} ft.`
      );
  }
  return { mover, at: placed.at, sharers: placed.sharers };
}

/** Checks the space before anything is spent. */
export function checkDestination(ctx: ResolveContext): void {
  if (ctx.input.commit === false || ctx.input.moveFirst === true) return;
  landingOf(ctx);
}

/** Sets the creature down in the space, lets a thrown creature go, spends the user's movement, and makes the creature
 *  set down and those in its space the action's targets. */
export function landAtDestination(ctx: ResolveContext): void {
  const destination = ctx.action.destination;
  if (!destination || ctx.input.commit === false || ctx.input.moveFirst === true) return;
  const landing = landingOf(ctx);
  const { attacker, state } = ctx;
  if (landing === null) {
    ctx.warnings.push(
      `The map can't place ${ctx.action.name}'s landing. Move the token, and choose the creatures in that space.`
    );
    return;
  }
  const { mover, at } = landing;
  ctx.deps.placeToken?.(mover.id, at);
  if (destination.ground) setAltitude(state, mover.id, 0, undefined);
  // A thrown creature leaves its thrower's grip.
  if (mover.id !== attacker.id)
    for (const effect of mover.effects.filter(
      (candidate) => candidate.sourceActorId === attacker.id && candidate.tags.includes("grapple")
    ))
      endEffect(state, mover.id, effect.id);
  if (destination.costFeet !== undefined && state.combat.active && state.combat.turnActorId === attacker.id)
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + destination.costFeet }
    };
  const caught = [
    ...(mover.id === attacker.id ? [] : [mover]),
    ...landing.sharers
      .map((id) => state.actors.find((actor) => actor.id === id))
      .filter((actor): actor is LiveActor => actor !== undefined)
  ];
  (ctx as { targets: readonly LiveActor[] }).targets = caught;
  const landedOn = caught.filter((actor) => actor.id !== mover.id).map((actor) => actor.name);
  // Everyone the line names, so the feed keeps it from players when any of them is hidden.
  ctx.tableNarration.push({
    kind: "movement",
    text:
      mover.id === attacker.id
        ? `${attacker.name} leaps onto ${landedOn.join(" and ") || "an empty space"}.`
        : `${attacker.name} throws ${mover.name}${landedOn.length > 0 ? `, which lands on ${landedOn.join(" and ")}` : ""}.`,
    actorIds: [attacker.id, ...caught.map((actor) => actor.id)],
    ...(ctx.hiddenFromTable(attacker.id) || caught.some((actor) => ctx.hiddenFromTable(actor.id))
      ? { gmOnly: true }
      : {})
  });
}
