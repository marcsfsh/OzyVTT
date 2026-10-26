import type { AttackKind } from "@vtt/rules-5e";
import type { DamageSource } from "@vtt/schemas";
import type { DefinitionAction, LiveActor, ResolveContext } from "./context.js";

const WEAPON_DAMAGE = new Set(["bludgeoning", "piercing", "slashing"]);

/**
 * A stat block's own attack swings no carried weapon, so its kinds say only melee or ranged. One that deals
 * Bludgeoning, Piercing or Slashing damage and is no spell or Unarmed Strike is made with a weapon (a goblin's
 * Shortbow, a guard's Spear), and at range with a Ranged weapon, for what reads the weapon (a Shield of Missile
 * Attraction).
 */
export function withStatBlockWeaponKinds(
  kinds: readonly AttackKind[],
  action: DefinitionAction,
  attacker: LiveActor,
  riderItemId: string | null
): AttackKind[] {
  const statBlock =
    riderItemId === null &&
    attacker.kind !== "player-character" &&
    action.attack !== undefined &&
    action.spellId === undefined &&
    !kinds.includes("spell") &&
    !kinds.includes("unarmed") &&
    action.damage.some((part) => WEAPON_DAMAGE.has(part.type));
  if (!statBlock) return [...kinds];
  const added = new Set<AttackKind>(kinds);
  added.add("weapon");
  if (kinds.includes("melee")) added.add("melee-weapon");
  if (kinds.includes("ranged")) {
    added.add("ranged-weapon");
    if (action.attack?.reachFeet === undefined) added.add("ranged-weapon-kind");
  }
  return [...added];
}

/**
 * What deals this resolve's damage, carried to where it lands so a defence can read it (`hit-points.ts`): the spell the
 * action is, the carried row it was made with, how its attack was made, and whether its Fire keeps its force
 * underwater. Undefined when there is nothing to tell.
 */
export function damageSourceOf(
  ctx: Pick<ResolveContext, "action" | "attacker" | "riderItemId" | "riderFilters">
): DamageSource | undefined {
  const kinds = withStatBlockWeaponKinds(ctx.riderFilters.attackKinds ?? [], ctx.action, ctx.attacker, ctx.riderItemId);
  const source: DamageSource = {
    ...(ctx.action.spellId !== undefined ? { spellId: ctx.action.spellId } : {}),
    ...(ctx.riderItemId !== null ? { rowId: ctx.riderItemId } : {}),
    ...(kinds.length > 0 ? { attackKinds: kinds.slice(0, 12) } : {}),
    ...(ctx.action.fireUnderwater ? { fireUnderwater: true as const } : {})
  };
  return Object.keys(source).length > 0 ? source : undefined;
}

/** The field a record that carries damage spreads in, absent when nothing dealt it that a defence reads. */
export const withDamageSource = (source: DamageSource | undefined) => (source ? { damageSource: source } : {});
