/**
 * The spells a stat block's actions cast, as data (`ActorAction.castsSpells`), read from the SRD 5.2.1 printings when
 * the bundle is built: a Spellcasting action's lists ("- **At Will:** Detect Magic, Fear", "- **1/Day Each:**
 * Fireball"), and the other actions that cast a spell or a choice of spells ("The mage casts Misty Step, using the
 * same spellcasting ability as Spellcasting", "Legendary Action. The dragon uses Spellcasting to cast Fear"). The
 * server makes each listed spell a cast action from the spell's own record (`monster-spells.ts` there), so this only
 * names the spells, their uses and the numbers they are cast with.
 */
import { abilityModifier } from "@vtt/rules-5e";
import type { AbilityId, ActorAction } from "@vtt/schemas";

type CastsSpells = NonNullable<ActorAction["castsSpells"]>;
type Entry = CastsSpells["spells"][number];
type Numbers = Pick<CastsSpells, "ability" | "saveDc" | "attackBonus">;

const ABILITIES: Readonly<Record<string, AbilityId>> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha"
};

/** A spell's id from its printed name, as the spell bundle slugs it ("Heroes' Feast" -> "heroes-feast"). */
export const spellIdOfName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** "Fireball (level 5 version)" -> the name and the level; a bare name casts at the spell's own level. */
function spellOf(printed: string): Readonly<{ name: string; atLevel?: number }> {
  const match = /^(.+?)\s*\(level (\d) version\)$/.exec(printed.trim());
  return match ? { name: match[1]!, atLevel: Number(match[2]) } : { name: printed.trim() };
}

/** The id of the cast action an entry becomes: the action's own id and the spell, and the level when it isn't the
 *  spell's own. */
const entryId = (actionId: string, spellId: string, atLevel?: number) =>
  `${actionId}-${spellId}${atLevel !== undefined ? `-level-${atLevel}` : ""}`;

/** "using Charisma as the spellcasting ability (spell save DC 17, +9 to hit with spell attacks)": the ability and what
 *  the text prints; a DC or attack bonus it leaves out comes from the ability (8 + PB + modifier, PB + modifier). */
function numbersOf(
  text: string,
  creature: Readonly<{ abilityScores: Readonly<Record<AbilityId, number>>; proficiencyBonus: number }>
): Numbers | null {
  const using =
    /\busing ([A-Z][a-z]+) as (?:the )?spellcasting ability(?: \(spell save DC (\d+)(?:, ([+-]\d+) to hit with spell attacks)?\))?/.exec(
      text
    );
  const ability = using ? ABILITIES[using[1]!.toLowerCase()] : undefined;
  if (!using || !ability) return null;
  const modifier = abilityModifier(creature.abilityScores[ability]);
  const saveDc = using[2] ? Number(using[2]) : 8 + creature.proficiencyBonus + modifier;
  const attackBonus = using[3] ? Number(using[3]) : saveDc - 8;
  return { ability, saveDc, attackBonus };
}

/** A Spellcasting action's lists: "- **At Will:** A, B" (no limit) and "- **2/Day Each:** C" (two uses of each). */
function listedSpells(actionId: string, text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.matchAll(/^- \*\*(At Will|(\d)\/Day(?: Each)?):\*\*[ \t]*(.*)$/gm)) {
    const perDay = line[2] ? Number(line[2]) : undefined;
    for (const printed of (line[3] ?? "").split(/,\s*/).filter((name) => name.trim().length > 0)) {
      const { name, atLevel } = spellOf(printed);
      const spellId = spellIdOfName(name);
      entries.push({
        id: entryId(actionId, spellId, atLevel),
        spellId,
        name,
        ...(atLevel !== undefined ? { atLevel } : {}),
        ...(perDay !== undefined ? { perDay } : {})
      });
    }
  }
  return entries;
}

/** "casts Bless, Lesser Restoration, or Sanctuary" / "casts the Misty Step spell" / "casts Fear": the spells named. */
function namedSpells(clause: string): Array<Readonly<{ name: string; atLevel?: number }>> {
  const bare = clause.replace(/^the (.+) spell$/, "$1");
  return bare
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .filter((name) => name.trim().length > 0)
    .map(spellOf);
}

/**
 * Reads the creature's casting: its Spellcasting action's lists and numbers, then every other action that casts. An
 * action that casts one spell becomes that cast itself (`self`), keeping its own cost (a legendary action, a 3/Day
 * Misty Step); one that casts a choice of spells lists them, sharing its uses. A Multiattack that lets Spellcasting
 * fill a place ("It can replace one attack with a use of Spellcasting to cast Shatter") names the cast it means, which
 * joins the list when it is cast at another level. Reactions stay as they are (Protective Magic's Shield is its own
 * reaction).
 */
export function withSpellcasting(
  actions: readonly ActorAction[],
  creature: Readonly<{ abilityScores: Readonly<Record<AbilityId, number>>; proficiencyBonus: number }>,
  knownSpell: (spellId: string) => boolean
): ActorAction[] {
  const spellcasting = actions.find((action) => action.id === "spellcasting");
  const listNumbers = spellcasting ? numbersOf(spellcasting.description, creature) : null;
  const listed = spellcasting && listNumbers ? listedSpells(spellcasting.id, spellcasting.description) : [];
  const added: Entry[] = [];
  /** The list entry a use of Spellcasting casts, added to the list when the text casts it at another level. */
  const listEntry = (name: string, atLevel?: number): Entry | null => {
    const spellId = spellIdOfName(name);
    if (!spellcasting || !knownSpell(spellId)) return null;
    const found = [...listed, ...added].find((entry) => entry.spellId === spellId && entry.atLevel === atLevel);
    if (found) return found;
    const entry: Entry = {
      id: entryId(spellcasting.id, spellId, atLevel),
      spellId,
      name,
      ...(atLevel ? { atLevel } : {})
    };
    added.push(entry);
    return entry;
  };

  const cast = actions.map((action): ActorAction => {
    if (action === spellcasting || action.activation === "reaction" || action.castsSpells) return action;
    const body = action.description.replace(/^Legendary Action[^.]*\.\s*/, "");
    // "The dragon uses Spellcasting to cast Fear" / "... Guiding Bolt (level 2 version)" / "Invisibility on itself".
    const viaList =
      /\buses Spellcasting to cast ([A-Z][A-Za-z'’ ]+?(?: \(level \d version\))?)(?= on itself|[.,])/.exec(body);
    if (viaList && listNumbers) {
      const { name, atLevel } = spellOf(viaList[1]!);
      const spellId = spellIdOfName(name);
      if (!knownSpell(spellId)) return action;
      return {
        ...action,
        castsSpells: {
          ...listNumbers,
          self: true,
          spells: [{ id: action.id, spellId, name, ...(atLevel !== undefined ? { atLevel } : {}) }]
        }
      };
    }
    // "The mage casts Misty Step, using the same spellcasting ability as Spellcasting." / "The doppelganger casts
    // Detect Thoughts, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 12)."
    const casts =
      /\bcasts ((?:the )?[A-Z][A-Za-z'’ ]+?(?: \(level \d version\))?(?:,? (?:or )?[A-Z][A-Za-z'’ ]+?(?: \(level \d version\))?)*?)(?: on (?:itself|that creature))?, (?:requiring [^,]+ and )?using (the same spellcasting ability as Spellcasting|[A-Z][a-z]+ as (?:the )?spellcasting ability)/.exec(
        body
      );
    if (!casts) return action;
    const numbers = casts[2]!.startsWith("the same") ? listNumbers : numbersOf(body, creature);
    const spells = namedSpells(casts[1]!)
      .map(({ name, atLevel }) => ({ name, atLevel, spellId: spellIdOfName(name) }))
      .filter(({ spellId }) => knownSpell(spellId));
    if (!numbers || spells.length === 0) return action;
    const self = spells.length === 1;
    return {
      ...action,
      castsSpells: {
        ...numbers,
        ...(self ? { self: true as const } : {}),
        spells: spells.map(({ name, atLevel, spellId }) => ({
          id: self ? action.id : entryId(action.id, spellId, atLevel),
          spellId,
          name,
          ...(atLevel !== undefined ? { atLevel } : {})
        }))
      }
    };
  });

  // A Multiattack's "use of Spellcasting to cast Shatter" names that cast; "a use of Spellcasting" alone, any of them.
  const rewired = cast.map((action): ActorAction => {
    if (!spellcasting || !action.multiattack) return action;
    const named = /\bSpellcasting to cast ([A-Z][A-Za-z'’ ]+?(?: \(level \d version\))?)(?=[.,]| or )/.exec(
      action.description
    );
    const target = named ? spellOf(named[1]!) : null;
    const entry = target ? listEntry(target.name, target.atLevel) : null;
    const anyOf = [...listed, ...added].map((one) => one.id).slice(0, 8);
    const ids = entry ? [entry.id] : anyOf;
    if (ids.length === 0) return action;
    const swap = (list: readonly string[]) => list.flatMap((id) => (id === spellcasting.id ? ids : [id])).slice(0, 8);
    return {
      ...action,
      multiattack: action.multiattack.map((component) =>
        component.actionId === spellcasting.id && ids.length === 1
          ? { ...component, actionId: ids[0]! }
          : component.actionId === spellcasting.id
            ? { ...component, actionId: ids[0]!, or: ids.slice(1) }
            : component.or?.includes(spellcasting.id)
              ? { ...component, or: swap(component.or) }
              : component
      ),
      ...(action.multiattackReplacements
        ? {
            multiattackReplacements: action.multiattackReplacements.map((replacement) =>
              replacement.actionIds.includes(spellcasting.id)
                ? { ...replacement, actionIds: swap(replacement.actionIds) }
                : replacement
            )
          }
        : {})
    };
  });

  const entries = [...listed, ...added].filter((entry) => knownSpell(entry.spellId));
  return rewired.map((action) =>
    action === spellcasting && listNumbers && entries.length > 0
      ? { ...action, castsSpells: { ...listNumbers, spells: entries } }
      : action
  );
}
