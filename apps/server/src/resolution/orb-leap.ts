import type { ResolveContext } from "./context.js";

/**
 * SRD Chromatic Orb: "If you roll the same number on two or more of the d8s, the orb leaps to a different creature of
 * your choice within 30 feet of the target. Make an attack roll against the new target, and make a new damage roll."
 * The server sees the dice, so it says when the orb leaps and how many leaps the slot allows (one for a level 1 slot,
 * one per level above that); the next target is the caster's to aim at.
 */
export function orbLeap(ctx: ResolveContext): void {
  const { action, attack, state, input } = ctx;
  if (action.spellId !== "chromatic-orb" || attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit"))
    return;
  const faces = state.rolls
    .filter((roll) => roll.commandId === input.commandId && roll.purpose === "damage")
    .flatMap((roll) => roll.dice.filter((die) => die.sides === 8 && die.kept).map((die) => die.face));
  if (new Set(faces).size === faces.length) return;
  const slot = ctx.plan.castLevel ?? 1;
  const leaps = slot <= 1 ? 1 : slot;
  const target = ctx.targets[0];
  ctx.tableNarration.push({
    kind: "effect",
    text: `Two of Chromatic Orb's d8s match: the orb leaps to a different creature of ${ctx.attacker.name}'s choice within 30 feet of ${target?.name ?? "the target"}, with a new attack roll and damage roll of the same type (up to ${leaps} ${leaps === 1 ? "leap" : "leaps"}, each creature once).`,
    actorIds: [ctx.attacker.id]
  });
}
