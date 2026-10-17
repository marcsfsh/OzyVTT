/** Small display formatters shared by the table's sheets, runners and browsers. */
import type { ActionResolution, DamageApplication } from "@vtt/domain";

/**
 * What the target's defences did to a hit, as the server weighed it: "3 less from damage reduction; 9 fire
 * became 4 (resistance: Ring of Fire Resistance)". The reduction comes first, as the server applies it. Empty when
 * nothing changed the numbers.
 */
export function damageAdjustments(parts: DamageApplication["parts"] | undefined, flatReduction = 0): string {
  const adjusted = flatReduction > 0 ? [`${flatReduction} less from damage reduction`] : [];
  for (const part of parts ?? [])
    if (part.adjustment !== null)
      adjusted.push(
        `${part.amount} ${part.type} became ${part.adjusted} (${part.adjustment === "resistance-and-vulnerability" ? "resistance and vulnerability" : part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""})`
      );
  return adjusted.join("; ");
}

/** A bonus with its sign: "+3", "-1", "+0". */
export const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

export const titleCase = (value: string) => (value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value);

/** CR as the books print it: fractional ratings render as 1/8, 1/4, 1/2. */
export const formatChallenge = (rating: number) =>
  rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);

/** An id built from a typed name, capped at 60 characters; "item" when nothing usable is left. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";

/** "1d8 + 3 piercing = 7 + 3d6 piercing (Sneak Attack) = 11 + 2 Rage": each rolled part, named when an extra rode the
 *  hit, then the flat lines. */
export function damageBreakdown(result: Pick<ActionResolution, "damage" | "bonusDamage">): string {
  return [
    ...result.damage.map(
      (part) => `${part.formula} ${part.type}${part.source ? ` (${part.source})` : ""} = ${part.total}`
    ),
    ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
  ].join(" + ");
}

const SPELL_LEVEL_NOTE = /\s*\((?:Cantrip|\d+(?:st|nd|rd|th))\b[^)]*\)\s*$/i;

/** An action's name without the spell level its list adds ("Shield (1st, Reaction)" reads "Shield", "Fire Bolt
 *  (Cantrip)" reads "Fire Bolt"), for buttons and headings that already say what kind of action it is. An item's
 *  name in brackets stays, since it says where the spell comes from, and so does "(ritual)". */
export function plainActionName(name: string): string {
  return name.replace(SPELL_LEVEL_NOTE, "").trim() || name;
}
/** Whether an action casts a spell, so its button says "Cast": a built character's spell action, or a stat block's
 *  action that carries a spell level. */
export function castsSpell(actionId: string, name: string): boolean {
  return actionId.startsWith("spell-") || SPELL_LEVEL_NOTE.test(name);
}
