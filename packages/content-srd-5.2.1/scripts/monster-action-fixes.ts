/**
 * Reviewed stat-block actions the readers can't finish from the text, keyed `<creature>/<action>`; each says why. What
 * a fix names replaces what was read, so the engine runs it and the GM's reminder says only what is left.
 */
import type { ActorAction, OnHitRider } from "@vtt/schemas";

export type MonsterActionFix = Readonly<{
  why: string;
  /** The damage in place of the reader's. */
  damage?: ActorAction["damage"];
  /** The damage types a use picks from (Chromatic Orb's shape). */
  damageTypes?: ActorAction["damageTypes"];
  /** What a hit leaves, in place of the reader's. */
  onHit?: OnHitRider[];
  /** The GM's reminder in place of the reader's; null drops it. */
  reminder?: string | null;
}>;

export const MONSTER_ACTION_FIXES: Readonly<Record<string, MonsterActionFix>> = {
  "half-dragon/dragon-s-breath": {
    why: "the damage is of the type chosen for the Draconic Origin trait, which each use picks",
    damage: [{ formula: "8d6", type: "fire" }],
    damageTypes: ["acid", "cold", "fire", "lightning", "poison"]
  },
  "rust-monster/antennae": {
    why: "the penalty is on one carried armor or weapon, which items don't track",
    reminder:
      "On a failure, the armor or weapon the rust monster targeted takes a cumulative -1 penalty: to the AC it offers, or to its attack rolls. Change the item by hand. Armor whose AC falls to 10, or a weapon at -5, is destroyed, and Mending removes the penalty."
  }
};

/** The fields a fix sets on its action. */
export function fixedFields(fix: MonsterActionFix | undefined): Partial<ActorAction> {
  if (!fix) return {};
  return {
    ...(fix.damage ? { damage: fix.damage.map((part) => ({ ...part })) } : {}),
    ...(fix.damageTypes ? { damageTypes: [...fix.damageTypes] } : {}),
    ...(fix.onHit ? { onHit: structuredClone(fix.onHit) } : {}),
    ...(typeof fix.reminder === "string" ? { reminder: fix.reminder } : {})
  };
}
