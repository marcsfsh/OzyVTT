import type { Summon } from "@vtt/schemas";

/** What the user of an action that summons picks as they use it: which creature (Find Familiar's forms, an Ivory Goat)
 *  and its creature type (a familiar is a Celestial, Fey or Fiend); `action.resolve`'s `summon`. */
export type SummonChoices = Readonly<{
  forms?: ReadonlyArray<Readonly<{ monsterId: string; form?: string; label: string }>>;
  creatureTypes?: readonly string[];
}>;

const words = (id: string) => id.replace(/-/g, " ");
const capital = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** The picks an action's summons offers, or undefined when it offers none (one creature, or a die picks it). */
export function summonChoicesOf(summons: Summon | undefined): SummonChoices | undefined {
  if (!summons) return undefined;
  const forms =
    summons.die === undefined && summons.creatures.length > 1
      ? summons.creatures.map((row) => ({
          monsterId: row.monsterId,
          ...(row.form ? { form: row.form } : {}),
          label: row.except?.name ?? capital(`${words(row.monsterId)}${row.form ? ` (${words(row.form)})` : ""}`)
        }))
      : undefined;
  const creatureTypes =
    summons.creatureTypes && summons.creatureTypes.length > 1 ? [...summons.creatureTypes] : undefined;
  if (!forms && !creatureTypes) return undefined;
  return { ...(forms ? { forms } : {}), ...(creatureTypes ? { creatureTypes } : {}) };
}
