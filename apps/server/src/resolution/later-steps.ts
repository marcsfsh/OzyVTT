import { laterRowOf } from "../item-actions.js";
import { CommandRejectedError } from "../game-store.js";
import { liftLevitated } from "../lasting-spells.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { spellRangeFeet } from "@vtt/content-srd-5.2.1/spell-effect";
import { tableLineOf, type ResolveContext } from "./context.js";
import { spellOf } from "./concentration.js";

/**
 * What a spell's later action does by itself beyond rolls (SRD 5.2.1 Levitate: "You can change the target's altitude
 * by up to 20 feet in either direction on your turn ... you can take a Magic action to move the target, which must
 * remain within the spell's range"): the levitated creature rises or sinks, and a creature lifted out of the spell's
 * range is refused.
 */
export function liftOnAction(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const feet = spell ? laterRowOf(spell, ctx.action.id)?.liftFeet : undefined;
  if (!spell || feet === undefined || ctx.input.commit === false) return;
  const lifted = liftLevitated(ctx.state, ctx.attacker.id, feet);
  if (!lifted) throw new CommandRejectedError(`${ctx.attacker.name}'s ${spell.name} holds no creature on the map.`);
  const range = spellRangeFeet(spell.range);
  const apart = lifted.actorId === ctx.attacker.id ? 0 : ctx.deps.distanceFeet?.(ctx.attacker.id, lifted.actorId);
  if (range !== null && apart !== null && apart !== undefined && apart > range + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(`${lifted.name} must stay within ${range} feet of ${ctx.attacker.name}.`);
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      text:
        lifted.to === lifted.from
          ? `${lifted.name} stays at ${lifted.to} feet.`
          : `${lifted.name} ${lifted.to > lifted.from ? "rises" : "sinks"} to ${lifted.to} feet.`,
      actorId: lifted.actorId
    })
  );
}
