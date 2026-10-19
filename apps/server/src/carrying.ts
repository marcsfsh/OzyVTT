import type { Actor } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import type { ResolvedRider } from "@vtt/rules-5e";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/** What a creature carries against what it can (SRD 5.2.1 Carrying Capacity). */
export type Carrying = Readonly<{ pounds: number; capacity: number }>;

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
/** Pounds a creature can carry per point of Strength, by size (the SRD's Carrying Capacity table). */
const POUNDS_PER_STRENGTH: readonly number[] = [7.5, 15, 15, 30, 60, 120];
/** SRD Coins: "fifty coins weigh a pound." */
const COINS_PER_POUND = 50;

/**
 * The weight a creature carries (each row's weight times its count, and its coins) and the most it can carry: its
 * Strength times its size's figure, a `carrying-capacity-larger` rider counting it one size up (Powerful Build). Null
 * for a creature with no sheet, whose stat block says nothing of what it carries.
 */
export function carryingOf(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  standing: readonly ResolvedRider[]
): Carrying | null {
  if (definition?.schemaId !== "vtt.actor-character") return null;
  const rows = actor.inventory.reduce((sum, item) => {
    const each = item.weightEach ?? catalog?.equipmentRecord(catalogIdOf(item))?.weightLb ?? 0;
    return sum + each * Math.max(0, item.quantity);
  }, 0);
  const purse = actor.currency;
  const coins = purse ? purse.pp + purse.gp + purse.ep + purse.sp + purse.cp : 0;
  const larger = standing.some((rider) => rider.modifier.type === "carrying-capacity-larger") ? 1 : 0;
  const rank = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(actor.size ?? "medium")) + larger);
  return {
    pounds: Math.round((rows + coins / COINS_PER_POUND) * 10) / 10,
    capacity: definition.abilityScores.str * POUNDS_PER_STRENGTH[rank]!
  };
}

/** SRD Carrying Capacity: "While dragging, lifting, or pushing weight in excess of the maximum weight you can carry,
 *  your Speed can be no more than 5 feet." A load beyond capacity is one dragged. */
export const OVERLOADED_SPEED_FEET = 5;

export const overloaded = (carrying: Carrying | null): boolean =>
  carrying !== null && carrying.pounds > carrying.capacity;
