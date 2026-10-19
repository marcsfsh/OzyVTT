import { loadSpells } from "@vtt/content-srd-5.2.1";
import { withSpellcasting } from "@vtt/content-srd-5.2.1/monster-spellcasting";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";

let srdSpellIds: ReadonlySet<string> | null = null;
/** Whether the SRD spell list holds a spell, which is what a stat block's casts can name. */
const isSrdSpell = (spellId: string) => (srdSpellIds ??= new Set(loadSpells().map((spell) => spell.id))).has(spellId);

/**
 * A stat block's actions with the spells its Spellcasting and casting actions name read into `castsSpells`, as the
 * content build reads the SRD's (`withSpellcasting`), so a stat block the GM imports or writes casts its list too.
 */
export function withStatBlockSpellcasting(
  actions: readonly ActorAction[],
  creature: Pick<ActorDefinition, "abilityScores" | "proficiencyBonus">
): ActorAction[] {
  return withSpellcasting(actions, creature, isSrdSpell);
}
