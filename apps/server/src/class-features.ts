import type { ActorDefinition } from "@vtt/schemas";

/**
 * Whether a sheet holds a feature the engine applies by name: a built character's feature by its content id, or a
 * trait printed under that name (an imported sheet, a stat block). The feature list records a feature once it is
 * gained, so holding it means having reached its level.
 */
export function holdsFeature(definition: ActorDefinition | undefined, id: string, traitName: string): boolean {
  if (!definition) return false;
  if ((definition.character?.features ?? []).some((feature) => feature.id === id)) return true;
  return Object.values(definition.extensions ?? {}).some((bag) => {
    const traits = bag !== null && typeof bag === "object" ? (bag as { traits?: unknown }).traits : undefined;
    return (
      Array.isArray(traits) &&
      traits.some(
        (trait) => trait !== null && typeof trait === "object" && (trait as { name?: unknown }).name === traitName
      )
    );
  });
}

/** The class a creature casts a spell as (its sheet entry's class), for riders on that class's spells (Innate
 *  Sorcery's Sorcerer spells); null for a spell from a species or a feat, or a sheet that names none. */
export function spellClassOf(definition: ActorDefinition | undefined, spellId: string | undefined): string | null {
  if (!definition || spellId === undefined) return null;
  return definition.spellcasting?.spells.find((entry) => entry.id === spellId)?.classId ?? null;
}
