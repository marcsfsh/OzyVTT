import type { ContentActionSummary } from "@vtt/domain";
import { signed } from "./format";

/** "rage-active" → "Rage Active": an effect tag or an action id as a person reads it. */
export const tagLabel = (tag: string) =>
  tag
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** "1d12 hours", "7 days": the wait a pool spent for a time names. */
export const afterWords = (afterHours: string | undefined) =>
  afterHours === undefined
    ? "some time"
    : /^\d+$/.test(afterHours) && Number(afterHours) % 24 === 0
      ? `${Number(afterHours) / 24} day${Number(afterHours) === 24 ? "" : "s"}`
      : `${afterHours} hour${afterHours === "1" ? "" : "s"}`;

/** How a limited use comes back, as a sheet says it ("Short Rest"): one back at the start of the bearer's next turn
 *  (Peerless Aim) is once a round. The rests are SRD rules terms, so they are capitalised. */
export const usesScopeLabel = (per: NonNullable<ContentActionSummary["usesPer"]>) =>
  per === "own-turn"
    ? "round"
    : per === "short-rest"
      ? "Short Rest"
      : per === "long-rest"
        ? "Long Rest"
        : per.replace(/-/g, " ");

/** An area as the SRD sizes it: a Sphere's or a Cylinder's radius, another shape's length or side ("5-foot-radius
 *  cylinder", "30-foot cone"). */
export const areaWords = (area: Readonly<{ shape: string; sizeFeet: number }>) =>
  area.shape === "sphere" || area.shape === "cylinder"
    ? `${area.sizeFeet}-foot-radius ${area.shape}`
    : `${area.sizeFeet}-foot ${area.shape}`;

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
  if (action.healing) parts.push(`Heals ${action.healing.formula}`);
  // The charge pool: a limited-use feature has no roll, so this line is its mechanic.
  if (action.usesLimit !== null)
    parts.push(
      action.usesPer === "recharge"
        ? `Recharge ${action.usesRecharge}${(action.usesRecharge ?? 6) < 6 ? "-6" : ""}`
        : action.usesPer === "never"
          ? `${action.usesLimit} uses, not regained`
          : action.usesPer === "time"
            ? `${action.usesLimit}, back ${afterWords(action.usesAfterHours)} after the first`
            : `${action.usesLimit}/${action.usesPer === null ? "" : usesScopeLabel(action.usesPer)}`
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
