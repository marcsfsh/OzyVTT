import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { InventoryItem } from "@vtt/schemas";
import { holdsFeature } from "../class-features.js";
import { startTimedPool } from "../clock-pools.js";
import { itemRowOfAction, lastChargeLine, lastChargeRollFor, regainOnTwenty } from "../item-charges.js";
import { endItemMagic } from "../item-spent.js";
import { recordRoll, type DefinitionAction, type ResolveContext } from "./context.js";
import { useLimitFor, type EconomyPlan } from "./economy.js";

type Spend = EconomyPlan["spendUse"];

/** SRD Use Magic Device (Thief): "Whenever you use a magic item property that expends charges, roll 1d6. On a roll of
 *  6, you use the property without expending the charges." Rolled after the charges are spent, which a 6 gives back.
 *  Returns whether it did. */
function savedByUseMagicDevice(ctx: ResolveContext, action: DefinitionAction, spendUse: Spend): boolean {
  const { attacker, deps, warnings } = ctx;
  if (!spendUse || spendUse.per === "turn" || spendUse.amount < 1) return false;
  if (!itemRowOfAction(action.id, attacker.inventory)) return false;
  if (!holdsFeature(deps.definition, "use-magic-device", "Use Magic Device")) return false;
  const rolled = resolveDice(parseDiceFormula("1d6"), deps.random);
  recordRoll(ctx, rolled, "manual", "Use Magic Device");
  if (rolled.total !== 6) return false;
  const { key, amount } = spendUse;
  const left = Math.max(0, (attacker.actionUses[key] ?? 0) - amount);
  const { [key]: _spent, ...others } = attacker.actionUses;
  attacker.actionUses = left > 0 ? { ...others, [key]: left } : others;
  warnings.push(`Use Magic Device: the d6 shows 6, so ${attacker.name} spends no charges.`);
  return true;
}

/** What spending the last charge does to the item, by its record: it is destroyed, loses its magic, or turns into
 *  another item. */
function spendTheItem(ctx: ResolveContext, item: InventoryItem, record: EquipmentReference): string | null {
  const outcome = record.charges?.lastCharge;
  return outcome ? endItemMagic(ctx.attacker, item, outcome, ctx.deps.definition, ctx.deps.catalog) : null;
}

/** SRD charged items: "If you expend the last charge, roll 1d20". Rolled once this resolve has spent the last one: a
 *  1 does what the item says (most crumble), a 20 gives some back where the item says so (Staff of Power). An item
 *  that never regains its charges is spent with no roll (a Chime of Opening cracks). */
export function rollLastCharge(ctx: ResolveContext): void {
  afterItemSpend(ctx, ctx.action, ctx.plan.spendUse);
}

/** What spending an item's charges sets off, for the resolved action or a property that rode its hit (a Staff of
 *  Striking's charge): Use Magic Device's d6, a timed pool's wait, and the last charge's d20. */
export function afterItemSpend(ctx: ResolveContext, action: DefinitionAction, spendUse: Spend): void {
  const { attacker, deps, siblings, warnings } = ctx;
  if (!spendUse || spendUse.per === "turn") return;
  if (savedByUseMagicDevice(ctx, action, spendUse)) return;
  // A pool spent for a time starts its wait on its first use ("can't be used again until 1d12 hours have passed"), or
  // once the creature it brought leaves (a figurine reverting).
  const waitsForItsCreature = action.summons?.waitsFromEnd === true && (ctx.summoned?.length ?? 0) > 0;
  if (spendUse.per === "time" && action.uses?.afterHours && !waitsForItsCreature) {
    const line = startTimedPool(ctx.state, attacker, spendUse.key, action.name, action.uses.afterHours, deps.random);
    if (line) warnings.push(line);
  }
  const due = lastChargeRollFor(action, attacker.inventory, deps.catalog);
  if (!due || (attacker.actionUses[spendUse.key] ?? 0) < useLimitFor(siblings, action)) return;
  const charges = due.record.charges!;
  if (!charges.lastChargeRoll) {
    const line = spendTheItem(ctx, due.item, due.record);
    if (line) warnings.push(`${due.item.name}'s last charge is spent. ${line}`);
    return;
  }
  const rolled = resolveDice(parseDiceFormula("1d20"), deps.random);
  recordRoll(ctx, rolled, "manual");
  if (rolled.total === 1) {
    const line = spendTheItem(ctx, due.item, due.record);
    warnings.push(
      line ? `${due.item.name}'s last charge is spent and the d20 shows 1. ${line}` : lastChargeLine(due.item.name, 1)
    );
    return;
  }
  if (rolled.total === 20 && charges.lastChargeTwenty) {
    warnings.push(regainOnTwenty(attacker, spendUse.key, due.item.name, charges.lastChargeTwenty, deps.random));
    return;
  }
  warnings.push(lastChargeLine(due.item.name, rolled.total));
}
