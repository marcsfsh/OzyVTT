import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { lastChargeLine, lastChargeRollFor } from "../item-charges.js";
import { recordRoll, type ResolveContext } from "./context.js";
import { useLimitFor } from "./economy.js";

/** SRD charged items: "If you expend the last charge, roll 1d20." Rolled once this resolve has spent the last one;
 *  what a 1 does is the item's own text, so the GM is told and decides. */
export function rollLastCharge(ctx: ResolveContext): void {
  const { action, attacker, plan, deps, siblings, warnings } = ctx;
  if (!plan.spendUse || plan.spendUse.per === "turn") return;
  const due = lastChargeRollFor(action, attacker.inventory, deps.catalog);
  if (!due || (attacker.actionUses[plan.spendUse.key] ?? 0) < useLimitFor(siblings, action)) return;
  const rolled = resolveDice(parseDiceFormula("1d20"), deps.random);
  recordRoll(ctx, rolled, "manual");
  warnings.push(lastChargeLine(due.item.name, rolled.total));
}
