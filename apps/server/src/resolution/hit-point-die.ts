import { makeHitDicePool } from "@vtt/schemas";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
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
  const rolled = resolveDice(parseDiceFormula(`1d${sides}`), deps.random);
  recordRoll(ctx, rolled, "healing", source);
  const regained = Math.max(1, rolled.total + abilityModifier(deps.definition, "con"));
  attacker.hitDice = makeHitDicePool(spendFromPool(pool.entries, 1));
  for (const event of healActor(ctx.state, attacker.id, regained, { role: "gm" }))
    ctx.tableNarration.push(tableLineOf(ctx, event, "heal"));
  ctx.tableNarration.push({
    kind: "heal",
    text: `${source}: ${attacker.name} spends a Hit Point Die and regains ${regained} Hit Points.`,
    actorIds: [attacker.id]
  });
}
