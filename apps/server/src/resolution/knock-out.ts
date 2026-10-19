import { CommandRejectedError } from "../game-store.js";
import type { ResolveContext } from "./context.js";

/**
 * SRD "Knocking Out a Creature": "When you would reduce a creature to 0 Hit Points with a melee attack, you can
 * instead reduce the creature to 1 Hit Point and give it the Unconscious condition." The attacker chooses it with the
 * hit; the damage it owes then lands nonlethal on every apply path (the GM's Apply, a player's proposal or direct
 * damage), which is where the drop to 0 is known.
 */

const meleeAttack = (ctx: ResolveContext) =>
  ctx.attack !== null && (ctx.riderFilters.attackKinds ?? []).includes("melee");

const landed = (ctx: ResolveContext) =>
  ctx.attack !== null &&
  (ctx.attack.outcome === "hit" || ctx.attack.outcome === "crit" || ctx.attack.outcome === "unknown");

/** Refuses a knock-out asked of anything but a melee attack. */
export function checkKnockOut(ctx: ResolveContext): void {
  if (ctx.input.knockOut === true && !meleeAttack(ctx))
    throw new CommandRejectedError(`${ctx.action.name} isn't a melee attack, so it can't knock a creature out.`);
}

/** A previewed melee hit offers the knock-out with its confirm. */
export const knockOutOffered = (ctx: ResolveContext): boolean =>
  meleeAttack(ctx) && landed(ctx) && ctx.targets.length === 1;

/** A confirmed melee hit the attacker chose to knock out with. */
export const knocksOut = (ctx: ResolveContext): boolean =>
  ctx.input.knockOut === true && meleeAttack(ctx) && landed(ctx);
