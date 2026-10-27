import type { ActorAction } from "@vtt/schemas";
import { ABILITY_NAMES, type CheckSubject } from "./ability-checks.js";

/**
 * A check an item's cast asks first (an Amulet of the Planes: "make a DC 15 Intelligence (Arcana) check. On a
 * successful check, you cast Plane Shift"). A failure spends the use, the spell isn't cast, and what the item says a
 * failure does is the GM's to settle. Read the same way in a fight and outside one.
 */

type CastCheck = NonNullable<ActorAction["castCheck"]>;

/** What the check rolls. */
export const castCheckSubject = (check: CastCheck): CheckSubject => ({
  ability: check.ability,
  ...(check.skill ? { skill: check.skill } : {})
});

/** The check as the roll log names it: "Intelligence (Arcana) check for Cast Plane Shift (Amulet of the Planes)". */
export function castCheckLabel(check: CastCheck, actionName: string): string {
  const skill = check.skill ? ` (${check.skill[0]!.toUpperCase()}${check.skill.slice(1).replace(/-/g, " ")})` : "";
  return `${ABILITY_NAMES[check.ability]}${skill} check for ${actionName}`;
}

/** What the table reads when the check fails. */
export const castCheckFailedLine = (userName: string, actionName: string): string =>
  `${userName} fails the check for ${actionName}: the spell isn't cast, and the GM settles what the item says a failure does.`;
