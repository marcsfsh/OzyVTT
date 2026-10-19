import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { collectRiders } from "@vtt/rules-5e";
import { areAllies } from "../creature-sides.js";
import { deriveEquipment, type EquipmentCatalog } from "../equipment-derivation.js";

/**
 * Spells that can't reach a creature (`spell-ward` riders on its items, features and live effects): Nondetection's "The
 * target can't be targeted by any Divination spell", an Amulet of Proof against Detection and Location's wearer
 * ("unless the wearer allows it", taken as a spell from the wearer's own side), a Ring of Mind Shielding's immunity to
 * the magic that reads thoughts, lies and creature type. A ward keeps the spell from picking the creature as a target
 * (`spell-targets.ts`), leaves it out of the spell's area and lasting area, and hides it from the spell's detection.
 */

type Actor = GameState["actors"][number];

export type WardedSpell = Readonly<{ id: string; school: string }>;

export type WardContent = Readonly<{
  resolveDefinition?: ((definitionId: string) => ActorDefinition | undefined) | undefined;
  catalog?: EquipmentCatalog | undefined;
}>;

/** The `spell-ward` riders `target` bears, with their labels. */
function wardsOf(target: Actor, content: WardContent) {
  const definition = target.definitionId ? content.resolveDefinition?.(target.definitionId) : undefined;
  const derivation = deriveEquipment(target, definition, content.catalog);
  return collectRiders(derivation.carriers, { ...derivation.context, moment: null }).filter(
    (rider) => rider.modifier.type === "spell-ward"
  );
}

/** The name of what hides `target` from a magical sense that tells a creature's type (Divine Sense, Detect Evil and
 *  Good), or null: a Ring of Mind Shielding's "know your creature type". */
export function typeSenseWardOf(target: Actor, content: WardContent): string | null {
  return wardsOf(target, content).find((rider) => rider.modifier.typeSenses === true)?.label ?? null;
}

/** The name of what wards `target` against `spell` cast by `casterId` (null for a spell no one cast), or null. */
export function spellWardOf(
  state: GameState,
  target: Actor,
  spell: WardedSpell,
  casterId: string | null,
  content: WardContent
): string | null {
  const caster = casterId === null ? undefined : state.actors.find((actor) => actor.id === casterId);
  for (const rider of wardsOf(target, content)) {
    const ward = rider.modifier;
    const meets = (ward.schools ?? []).includes(spell.school) || (ward.spellIds ?? []).includes(spell.id);
    if (!meets) continue;
    if (
      ward.alliesAllowed &&
      caster &&
      (caster.id === target.id || areAllies(caster, target, content.resolveDefinition))
    )
      continue;
    return rider.label;
  }
  return null;
}
