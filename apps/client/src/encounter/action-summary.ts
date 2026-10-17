import type { ContentActionSummary } from "@vtt/domain";
import { signed } from "./format";

/** "rage-active" → "Rage Active": an effect tag or an action id as a person reads it. */
export const tagLabel = (tag: string) =>
  tag
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * An action's mechanics as discrete lines, each drawn as its own bullet under the action's name:
 * to-hit and reach, attack count, a Multiattack plan (named from `all`), the save, each damage part,
 * the use pool, and a legendary cost.
 */
export function actionSummaryParts(action: ContentActionSummary, all: readonly ContentActionSummary[] = []): string[] {
  const parts: string[] = [];
  const componentName = (id: string) => all.find((candidate) => candidate.id === id)?.name ?? tagLabel(id);
  if (action.attackBonus !== null)
    parts.push(
      `${signed(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`
    );
  if (action.attackCount !== null && action.attackCount > 1) parts.push(`${action.attackCount} attacks`);
  if (action.multiattack)
    parts.push(
      action.multiattack
        .map(
          (component) =>
            `${component.count}× ${[component.actionId, ...(component.or ?? [])].map(componentName).join(" or ")}`
        )
        .join(" + ")
    );
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type} damage`);
  // The charge pool: a limited-use feature has no roll, so this line is its mechanic.
  if (action.usesLimit !== null)
    parts.push(
      action.usesPer === "recharge"
        ? `Recharge ${action.usesRecharge}${(action.usesRecharge ?? 6) < 6 ? "-6" : ""}`
        : `${action.usesLimit}/${action.usesPer === "long-rest" ? "long rest" : action.usesPer === "short-rest" ? "short rest" : action.usesPer}`
    );
  if (action.legendaryCost !== undefined)
    parts.push(
      `Legendary${action.legendaryCost > 1 ? ` ×${action.legendaryCost}` : ""}${action.legendaryOncePerRound ? ", once a round" : ""}`
    );
  return parts;
}

/** What is left of an open compound action ("1× Tail, 2× any attack", "2× Scimitar or Shortbow"), so the GM picks
 *  the next attack. */
export const componentLabel = (components: Record<string, number>, actions: readonly ContentActionSummary[] | null) =>
  Object.entries(components)
    .filter(([, remaining]) => remaining > 0)
    .map(
      ([key, remaining]) =>
        `${remaining}× ${
          key === "attack"
            ? "any attack"
            : key
                .split("|")
                .map((id) => actions?.find((candidate) => candidate.id === id)?.name ?? id)
                .join(" or ")
        }`
    )
    .join(", ");
