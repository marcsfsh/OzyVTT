import { makeHitDicePool } from "@vtt/schemas";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { HIT_DICE_DOUBLED_TAG, HIT_DICE_MAXIMIZED_TAG } from "../death-saves.js";
import { healActor } from "../hit-points.js";
import { hitDieSizesToSpend, spendFromPool } from "../rests.js";
import { abilityModifier, recordRoll, tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD Lifedrinker: "you can expend one of your Hit Point Dice to roll it and regain a number of Hit Points equal to the
 * roll plus your Constitution modifier (minimum of 1 Hit Point)". The biggest die left goes first, as a rest spends
 * them.
 */
export function spendHitPointDie(ctx: ResolveContext, source: string): void {
  const { attacker, deps } = ctx;
  const pool = attacker.hitDice;
  const [sides] = pool ? hitDieSizesToSpend(pool.entries, 1) : [];
  if (!pool || sides === undefined) {
    ctx.warnings.push(`${source}: ${attacker.name} has no Hit Point Dice left to spend.`);
    return;
  }
  // A Potion of Vitality makes the die its maximum; a Periapt of Wound Closure doubles what it restores.
  const maximized = ctx.derivation.context.effectTags?.includes(HIT_DICE_MAXIMIZED_TAG) === true;
  const rolled = resolveDice(parseDiceFormula(`1d${sides}`), deps.random);
  if (!maximized) recordRoll(ctx, rolled, "healing", source);
  const face = maximized ? sides : rolled.total;
  const doubled = ctx.derivation.context.effectTags?.includes(HIT_DICE_DOUBLED_TAG) === true;
  const regained = Math.max(1, face + abilityModifier(deps.definition, "con")) * (doubled ? 2 : 1);
  attacker.hitDice = makeHitDicePool(spendFromPool(pool.entries, 1));
  for (const event of healActor(ctx.state, attacker.id, regained, { role: "gm" }))
    ctx.tableNarration.push(tableLineOf(ctx, event, "heal"));
  ctx.tableNarration.push({
    kind: "heal",
    text: `${source}: ${attacker.name} spends a Hit Point Die and regains ${regained} Hit Points.`,
    actorIds: [attacker.id]
  });
}
