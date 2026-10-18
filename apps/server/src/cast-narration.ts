import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActorAction } from "@vtt/schemas";
import { laterRowOf } from "./item-actions.js";

/** The spell this action casts anew, or null. What a spell lets its caster do later (Spiritual Weapon's attack) is no
 *  new cast. */
export function castSpellOf(
  action: Pick<ActorAction, "id" | "spellId">,
  spellRecord: ((spellId: string) => SpellReference | undefined) | undefined
): SpellReference | null {
  const spell = action.spellId ? spellRecord?.(action.spellId) : undefined;
  return spell && laterRowOf(spell, action.id) === undefined ? spell : null;
}

/** The names in a list, joined as the table reads them: "A", "A and B", "A, B and C". */
function joined(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The table's line for a cast: "Lyra casts Bless on Borin and Kael." Only the targets the table may see are named, and
 * the caster isn't named twice. Returns the line and the actors it names, so the feed gates it like any other.
 */
export function castLine(
  caster: Readonly<{ id: string; name: string }>,
  spellName: string,
  targets: ReadonlyArray<Readonly<{ id: string; name: string }>>,
  hiddenFromTable: (actorId: string) => boolean
): Readonly<{ text: string; actorIds: string[] }> {
  const named = targets.filter((target) => target.id !== caster.id && !hiddenFromTable(target.id));
  const on = named.length > 0 ? ` on ${joined(named.map((target) => target.name))}` : "";
  return {
    text: `${caster.name} casts ${spellName}${on}.`,
    actorIds: [caster.id, ...named.map((target) => target.id)]
  };
}
