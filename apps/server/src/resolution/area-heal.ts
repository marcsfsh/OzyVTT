import { isDead } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { CommandRejectedError } from "../game-store.js";
import { healActor } from "../hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { recordRoll, tableLineOf, type ResolveContext } from "./context.js";

/**
 * An action's `areaHeal` (SRD Land's Aid): "One creature of your choice in that area regains a number of Hit Points
 * equal to 2d6", a roll of its own beside the area's save. The creature is picked with the use (`aidTo`) and checked
 * before anything rolls: it stands where one area holds it with the creatures picked for the save, and the area centres
 * within its range of the user. None picked, nobody heals.
 */

/** How far a creature in the area can be from the user and from any other creature in it: the range to its centre plus
 *  its radius, and its width. */
function reachOf(ctx: ResolveContext): Readonly<{ fromUser: number | null; across: number | null }> {
  const area = ctx.action.area;
  if (!area || (area.shape !== "sphere" && area.shape !== "cylinder")) return { fromUser: null, across: null };
  return {
    fromUser: area.rangeFeet === undefined ? null : area.rangeFeet + area.sizeFeet,
    across: area.sizeFeet * 2
  };
}

/** The creature the area's healing goes to, refused when the area can't hold it; null when none is picked. */
export function areaHealRecipient(ctx: ResolveContext): string | null {
  const recipientId = ctx.input.aidTo;
  if (!ctx.action.areaHeal) {
    if (recipientId !== undefined)
      throw new CommandRejectedError(`${ctx.action.name} heals no one to pick a creature for.`);
    return null;
  }
  if (recipientId === undefined) return null;
  const recipient = ctx.state.actors.find((actor) => actor.id === recipientId);
  if (!recipient || isDead(recipient))
    throw new CommandRejectedError(`Choose a living creature in ${ctx.action.name}'s area to regain Hit Points.`);
  const distance = ctx.deps.distanceFeet;
  const { fromUser, across } = reachOf(ctx);
  const far = (apart: number | null, limit: number | null) =>
    apart !== null && limit !== null && apart > limit + DISTANCE_TOLERANCE_FEET;
  if (recipientId !== ctx.attacker.id && far(distance?.(ctx.attacker.id, recipientId) ?? null, fromUser))
    throw new CommandRejectedError(`${recipient.name} is beyond the area ${ctx.action.name} centres within reach.`);
  for (const target of ctx.targets)
    if (target.id !== recipientId && far(distance?.(target.id, recipientId) ?? null, across))
      throw new CommandRejectedError(
        `${recipient.name} and ${target.name} are too far apart for one area of ${ctx.action.name}.`
      );
  return recipientId;
}

/** Rolls the area's healing and restores it to the creature picked. */
export function applyAreaHeal(ctx: ResolveContext): void {
  const heal = ctx.action.areaHeal;
  const recipientId = areaHealRecipient(ctx);
  if (!heal || recipientId === null) return;
  const recipient = ctx.state.actors.find((actor) => actor.id === recipientId)!;
  const rolled = rollDice(heal.formula, ctx.deps.random);
  recordRoll(ctx, rolled, "healing");
  const before = recipient.hp.current;
  // The use is already authorized; its user heals whoever it picked in the area.
  const events = healActor(ctx.state, recipient.id, Math.max(0, rolled.total), { role: "gm" });
  const regained = recipient.hp.current - before;
  ctx.tableNarration.push({
    kind: "heal",
    text: `${recipient.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${ctx.action.name}).`,
    actorIds: [recipient.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event, "heal"));
  ctx.healing = {
    total: rolled.total,
    targets: [...(ctx.healing?.targets ?? []), { targetId: recipient.id, targetName: recipient.name, regained }]
  };
}
