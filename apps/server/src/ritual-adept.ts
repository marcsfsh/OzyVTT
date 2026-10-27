import type { Actor } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { catalogIdOf, type ActorAction, type ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { castAreaOf, ritualSpellActionId, spellCastMechanics } from "./item-actions.js";

/** Whether the sheet holds this class's feature. */
export const hasClassFeature = (definition: ActorDefinition | undefined, id: string, classId: string): boolean =>
  definition?.character?.features?.some(
    (feature) => feature.id === id && feature.kind === "class" && feature.sourceId === classId
  ) === true;

/** Whether the character carries its spellbook, which Ritual Adept reads from. */
export const carriesSpellbook = (actor: Pick<Actor, "inventory">): boolean =>
  actor.inventory.some((item) => catalogIdOf(item) === "spellbook" && item.quantity > 0);

/**
 * SRD 5.2.1 Wizard, Ritual Adept: "You can cast any spell as a Ritual if that spell has the Ritual tag and the spell is
 * in your spellbook. You needn't have the spell prepared, but you must read from the book to cast a spell in this
 * way." The sheet mints a Ritual cast for each spell on it; a spell recorded in the book beyond the sheet
 * (`Actor.spellbook`) gets its Ritual cast here, at the Wizard's numbers, while the book is carried.
 */
export function spellbookRituals(
  definition: ActorDefinition | undefined,
  actor: Pick<Actor, "spellbook" | "inventory"> | undefined,
  catalog: EquipmentCatalog | undefined
): ActorAction[] {
  const casting = definition?.spellcasting;
  if (!actor || !casting || !catalog?.spellRecord || actor.spellbook.length === 0) return [];
  if (!hasClassFeature(definition, "ritual-adept", "wizard") || !carriesSpellbook(actor)) return [];
  const wizard = casting.classes?.find((entry) => entry.classId === "wizard") ?? casting;
  const numbers = {
    attackBonus: wizard.attackBonus ?? casting.attackBonus ?? 0,
    saveDc: wizard.saveDc ?? casting.saveDc ?? 10,
    bearersDc: true,
    modifier: abilityModifier(definition.abilityScores[wizard.ability])
  };
  const onSheet = new Set(casting.spells.map((spell) => spell.id));
  return actor.spellbook.flatMap((entry) => {
    const spell = onSheet.has(entry.id) ? undefined : catalog.spellRecord!(entry.id);
    if (!spell?.ritual) return [];
    const mechanics = spellCastMechanics(spell, numbers);
    return [
      {
        id: ritualSpellActionId(spell.id),
        name: `${spell.name} (ritual)`,
        activation: "action",
        description: spell.description.slice(0, 12000),
        ...mechanics,
        ...castAreaOf(spell, mechanics),
        spellId: spell.id
      } as ActorAction
    ];
  });
}
