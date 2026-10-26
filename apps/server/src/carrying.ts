import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { ResolvedRider } from "@vtt/rules-5e";
import { holdsFeature } from "./class-features.js";
import { carriedPounds } from "./containers.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/** What a creature carries against what it can carry (SRD 5.2.1 Carrying Capacity), and the most it can drag, lift
 *  or push. */
export type Carrying = Readonly<{ pounds: number; capacity: number; dragLimit: number }>;

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
/** Pounds a creature can carry per point of Strength, by size (the SRD's Carrying Capacity table). */
const POUNDS_PER_STRENGTH: readonly number[] = [7.5, 15, 15, 30, 60, 120];
/** The table's Drag/Lift/Push column is twice its Carry column, size by size. */
const DRAG_MULTIPLIER = 2;
/** SRD Coins: "fifty coins weigh a pound." */
const COINS_PER_POUND = 50;

/**
 * The weight a creature carries (each row's weight times its count, what its containers hold as they weigh it, and its
 * coins) and the most it can carry: its Strength times its size's figure, counted one size up by a
 * `carrying-capacity-larger` rider (Powerful Build) or a stat block's Beast of Burden. Null for a creature with no
 * sheet or stat block.
 */
export function carryingOf(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  standing: readonly ResolvedRider[]
): Carrying | null {
  // A definition stub with no ability scores has no Strength to carry with.
  const strength = (definition?.abilityScores as ActorDefinition["abilityScores"] | undefined)?.str;
  if (!definition || strength === undefined) return null;
  const rows = carriedPounds(actor.inventory, catalog);
  const purse = actor.currency;
  const coins = purse ? purse.pp + purse.gp + purse.ep + purse.sp + purse.cp : 0;
  const larger =
    standing.some((rider) => rider.modifier.type === "carrying-capacity-larger") ||
    holdsFeature(definition, "beast-of-burden", "Beast of Burden")
      ? 1
      : 0;
  const rank = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(actor.size ?? "medium")) + larger);
  const capacity = strength * POUNDS_PER_STRENGTH[rank]!;
  return {
    pounds: Math.round((rows + coins / COINS_PER_POUND) * 10) / 10,
    capacity,
    dragLimit: capacity * DRAG_MULTIPLIER
  };
}

/** SRD Carrying Capacity: "While dragging, lifting, or pushing weight in excess of the maximum weight you can carry,
 *  your Speed can be no more than 5 feet." A load beyond capacity is one dragged. */
export const OVERLOADED_SPEED_FEET = 5;

export const overloaded = (carrying: Carrying | null): boolean =>
  carrying !== null && carrying.pounds > carrying.capacity;

/** A load beyond what the creature can drag, lift or push doesn't move with it: its Speed is 0. */
export const immovable = (carrying: Carrying | null): boolean =>
  carrying !== null && carrying.pounds > carrying.dragLimit;
