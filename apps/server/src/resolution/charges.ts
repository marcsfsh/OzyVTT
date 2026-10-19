import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { InventoryItem } from "@vtt/schemas";
import { holdsFeature } from "../class-features.js";
import { startTimedPool } from "../clock-pools.js";
import { bindTemplateItem, reconcileEquipment } from "../inventory.js";
import { chargePoolsOfRow, itemRowOfAction, lastChargeLine, lastChargeRollFor, rollRegain } from "../item-charges.js";
import { recordRoll, type ResolveContext } from "./context.js";
import { useLimitFor } from "./economy.js";

/** SRD Use Magic Device (Thief): "Whenever you use a magic item property that expends charges, roll 1d6. On a roll of
 *  6, you use the property without expending the charges." Rolled after the charges are spent, which a 6 gives back.
 *  Returns whether it did. */
function savedByUseMagicDevice(ctx: ResolveContext): boolean {
  const { action, attacker, plan, deps, warnings } = ctx;
  if (!plan.spendUse || plan.spendUse.per === "turn" || plan.spendUse.amount < 1) return false;
  if (!itemRowOfAction(action.id, attacker.inventory)) return false;
  if (!holdsFeature(deps.definition, "use-magic-device", "Use Magic Device")) return false;
  const rolled = resolveDice(parseDiceFormula("1d6"), deps.random);
  recordRoll(ctx, rolled, "manual", "Use Magic Device");
  if (rolled.total !== 6) return false;
  const { key, amount } = plan.spendUse;
  const left = Math.max(0, (attacker.actionUses[key] ?? 0) - amount);
  const { [key]: _spent, ...others } = attacker.actionUses;
  attacker.actionUses = left > 0 ? { ...others, [key]: left } : others;
  warnings.push(`Use Magic Device: the d6 shows 6, so ${attacker.name} spends no charges.`);
  return true;
}

/** What spending the last charge does to the item, by its record: it is destroyed, or turns into a plain item. */
function spendTheItem(ctx: ResolveContext, item: InventoryItem, record: EquipmentReference): string | null {
  const { attacker, deps } = ctx;
  const outcome = record.charges?.lastCharge;
  if (!outcome) return null;
  // The row's charges go with it, so a copy added later starts full.
  const keys = [...chargePoolsOfRow(item, deps.definition, deps.catalog).keys()];
  attacker.actionUses = Object.fromEntries(Object.entries(attacker.actionUses).filter(([key]) => !keys.includes(key)));
  if (outcome === "destroyed") {
    attacker.inventory = attacker.inventory.filter((entry) => entry.id !== item.id);
    reconcileEquipment(attacker, deps.definition, { catalog: deps.catalog });
    return `${item.name} is destroyed.`;
  }
  const plain = deps.catalog?.equipmentRecord(outcome.becomes);
  const name = plain?.name ?? outcome.becomes;
  const row = bindTemplateItem(
    { id: item.id, name, quantity: 1, equipped: item.equipped, attuned: false, recordId: outcome.becomes },
    { catalog: deps.catalog, role: "gm" }
  );
  attacker.inventory = attacker.inventory.map((entry) => (entry.id === item.id ? row : entry));
  reconcileEquipment(attacker, deps.definition, { catalog: deps.catalog });
  return `${item.name} loses its magic and is a ${name} now.`;
}

/** SRD charged items: "If you expend the last charge, roll 1d20". Rolled once this resolve has spent the last one: a
 *  1 does what the item says (most crumble), a 20 gives some back where the item says so (Staff of Power). An item
 *  that never regains its charges is spent with no roll (a Chime of Opening cracks). */
export function rollLastCharge(ctx: ResolveContext): void {
  const { action, attacker, plan, deps, siblings, warnings } = ctx;
  if (!plan.spendUse || plan.spendUse.per === "turn") return;
  if (savedByUseMagicDevice(ctx)) return;
  // A pool spent for a time starts its wait on its first use ("can't be used again until 1d12 hours have passed").
  if (plan.spendUse.per === "time" && action.uses?.afterHours) {
    const line = startTimedPool(
      ctx.state,
      attacker,
      plan.spendUse.key,
      action.name,
      action.uses.afterHours,
      deps.random
    );
    if (line) warnings.push(line);
  }
  const due = lastChargeRollFor(action, attacker.inventory, deps.catalog);
  if (!due || (attacker.actionUses[plan.spendUse.key] ?? 0) < useLimitFor(siblings, action)) return;
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
    const back = Math.min(rollRegain(charges.lastChargeTwenty, deps.random), attacker.actionUses[plan.spendUse.key]);
    const left = (attacker.actionUses[plan.spendUse.key] ?? 0) - back;
    const { [plan.spendUse.key]: _spent, ...others } = attacker.actionUses;
    attacker.actionUses = left > 0 ? { ...others, [plan.spendUse.key]: left } : others;
    warnings.push(
      `${due.item.name}'s last charge is spent and the d20 shows 20, so it regains ${back} charge${back === 1 ? "" : "s"}.`
    );
    return;
  }
  warnings.push(lastChargeLine(due.item.name, rolled.total));
}
