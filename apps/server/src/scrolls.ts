import { cantripScalingOf, cantripTierAt, type EquipmentReference, type SpellReference } from "@vtt/content-srd-5.2.1";
import { abilityModifier, type RiderAbility } from "@vtt/rules-5e";
import {
  catalogIdOf,
  resolveSpellcasting,
  type AbilityId,
  type ActorAction,
  type ActorDefinition,
  type InventoryItem
} from "@vtt/schemas";
import type { CheckSubject } from "./ability-checks.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { castAreaOf, itemActionId, spellCastMechanics } from "./item-actions.js";
import { itemRowOfAction } from "./item-charges.js";

/**
 * SRD Spell Scroll: a scroll bears one spell. A reader whose spell list has it casts it at its own level with no slot
 * and no Material components; a spell above the levels the reader can cast needs an ability check with their
 * spellcasting ability (DC 10 + the spell's level), and a failure loses the spell. The save DC and attack bonus come
 * from the scroll table, by the spell's level. A Thief's Use Magic Device reads any scroll with Intelligence: a
 * cantrip or level 1 spell reliably, a higher one after an Intelligence (Arcana) check.
 */

/** The Spell Scroll table's save DC and attack bonus, by spell level (0 is a cantrip). */
const SCROLL_NUMBERS: ReadonlyArray<Readonly<{ saveDc: number; attackBonus: number }>> = [
  { saveDc: 13, attackBonus: 5 },
  { saveDc: 13, attackBonus: 5 },
  { saveDc: 13, attackBonus: 5 },
  { saveDc: 15, attackBonus: 7 },
  { saveDc: 15, attackBonus: 7 },
  { saveDc: 17, attackBonus: 9 },
  { saveDc: 17, attackBonus: 9 },
  { saveDc: 18, attackBonus: 10 },
  { saveDc: 18, attackBonus: 10 },
  { saveDc: 19, attackBonus: 11 }
];

export const scrollNumbers = (level: number) => SCROLL_NUMBERS[Math.max(0, Math.min(9, level))];

/** The rule a scroll in a spell the reader can't read breaks (`rules-families.ts`). */
export const SCROLL_UNREADABLE = "spell.scroll-unreadable";

/** The id suffix of the action that reads a scroll. */
const READ_SUFFIX = "read";

/** The feature that lets a Thief read any scroll. */
const USE_MAGIC_DEVICE = "use-magic-device";

const ABILITY_NAMES: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** The spell levels a scroll record holds, worded for a refusal ("a cantrip", "a level 1 spell"). */
function levelsWord(range: NonNullable<EquipmentReference["spellScroll"]>): string {
  const word = (level: number) => (level === 0 ? "a cantrip" : `a level ${level} spell`);
  return range.minLevel === range.maxLevel
    ? word(range.minLevel)
    : `${word(range.minLevel)} to level ${range.maxLevel}`;
}

/** Why a spell can't go on this scroll, or null when it can. */
export function scrollSpellProblem(record: EquipmentReference, spell: SpellReference, itemName: string): string | null {
  const range = record.spellScroll;
  if (!range) return `${itemName} is not a Spell Scroll.`;
  return spell.level < range.minLevel || spell.level > range.maxLevel
    ? `${itemName} holds ${levelsWord(range)}, and ${spell.name} is ${spell.level === 0 ? "a cantrip" : `level ${spell.level}`}.`
    : null;
}

/** "Action", "Bonus Action", "Reaction"; anything longer is outside the turn's
 *  economy, as the builder reads a spell's casting time. */
function activationOf(castingTime: string): ActorAction["activation"] {
  if (/bonus/i.test(castingTime)) return "bonus-action";
  if (/reaction/i.test(castingTime)) return "reaction";
  return /^(?:1 )?action$/i.test(castingTime.trim()) ? "action" : "other";
}

export type ScrollCheck = Readonly<{ ability: RiderAbility; dc: number; skill: "arcana" | null }>;

/** Whether this reader can read a scroll of this spell, the ability they cast it with, and the check a spell above
 *  their levels needs first. */
export type ScrollReading = Readonly<
  { readable: false; message: string } | { readable: true; ability: RiderAbility | null; check: ScrollCheck | null }
>;

type Readable = Extract<ScrollReading, { readable: true }>;

/** The highest level of spell slot the sheet has, Pact Magic included. */
function highestSlotLevel(definition: ActorDefinition): number {
  const casting = definition.spellcasting;
  const slots = (casting?.slots ?? []).filter((slot) => slot.max > 0).map((slot) => slot.level);
  const pact = casting?.pact && casting.pact.max > 0 ? [casting.pact.level] : [];
  return Math.max(0, ...slots, ...pact);
}

/**
 * The reading rules for one reader. A creature without a class (a stat block) is the GM's to judge, so it reads any
 * scroll with no check. A character reads a spell on one of its classes' spell lists, or any spell with Use Magic
 * Device; whichever way needs no check wins.
 */
export function scrollReading(
  definition: ActorDefinition | undefined,
  spell: SpellReference,
  catalog: EquipmentCatalog | undefined
): ScrollReading {
  const classes = definition?.character?.classes ?? [];
  if (!definition || classes.length === 0)
    return { readable: true, ability: (definition?.spellcasting?.ability ?? null) as RiderAbility | null, check: null };
  const onList = classes.flatMap((entry) => {
    const klass = catalog?.classRecord?.(entry.id);
    const subclass = entry.subclass ? catalog?.subclassRecord?.(entry.subclass.id) : undefined;
    const casting = subclass?.spellcasting ?? klass?.spellcasting;
    if (!casting || !spell.classes.includes(casting.spellListId ?? entry.id)) return [];
    const ability = (resolveSpellcasting(definition.spellcasting, entry.id)?.ability ??
      casting.ability) as RiderAbility;
    return [ability];
  });
  const fromList: Readable | null =
    onList.length > 0
      ? {
          readable: true,
          ability: onList[0],
          check:
            spell.level > highestSlotLevel(definition)
              ? { ability: onList[0], dc: 10 + spell.level, skill: null }
              : null
        }
      : null;
  const useMagicDevice = (definition.character?.features ?? []).some((feature) => feature.id === USE_MAGIC_DEVICE);
  const fromDevice: Readable | null = useMagicDevice
    ? {
        readable: true,
        ability: "int",
        check: spell.level > 1 ? { ability: "int", dc: 10 + spell.level, skill: "arcana" } : null
      }
    : null;
  const readings = [fromList, fromDevice].filter((reading): reading is Readable => reading !== null);
  const reading = readings.find((candidate) => candidate.check === null) ?? readings[0];
  return (
    reading ?? {
      readable: false,
      message: `${spell.name} is not on ${definition.name}'s spell list, so the scroll is unintelligible.`
    }
  );
}

/** The scroll row an action reads, with its record and spell, when the action is a scroll's. */
export function scrollOfAction(
  action: Pick<ActorAction, "id">,
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): Readonly<{ row: InventoryItem; record: EquipmentReference; spell: SpellReference }> | null {
  const row = itemRowOfAction(action.id, inventory);
  if (!row?.spellId || action.id !== itemActionId(row.id, READ_SUFFIX)) return null;
  const record = catalog?.equipmentRecord(catalogIdOf(row));
  const spell = catalog?.spellRecord?.(row.spellId);
  return record?.spellScroll && spell ? { row, record, spell } : null;
}

/** The reader's character level, which a cantrip's damage grows with; a stat block counts as level 1. */
function characterLevel(definition: ActorDefinition | undefined): number {
  return Math.max(
    1,
    (definition?.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0)
  );
}

/**
 * Reading the scroll as an action: the spell at its own level (no upcast) with the scroll's DC and attack bonus, no
 * slot, at the spell's casting time. The reader casts it, so a cantrip grows with the reader's level ("when you reach
 * levels 5 ..."), and its healing adds the reader's spellcasting modifier. Null when the row bears no spell the
 * catalog knows.
 */
export function scrollCastAction(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): ActorAction | null {
  const spell = item.spellId ? catalog?.spellRecord?.(item.spellId) : undefined;
  if (!spell) return null;
  const numbers = scrollNumbers(spell.level);
  const reading = scrollReading(definition, spell, catalog);
  const ability = reading.readable ? reading.ability : null;
  const modifier = definition && ability ? abilityModifier(definition.abilityScores[ability]) : 0;
  const tier =
    spell.level === 0 ? cantripTierAt(cantripScalingOf(spell.castingOptions), characterLevel(definition)) : null;
  const mechanics = spellCastMechanics(
    spell,
    { ...numbers, bearersDc: false, modifier },
    {
      roll: tier?.damageRoll ?? null,
      // Eldritch Blast's extra beams, as its caster's level gives them.
      ...(tier?.targetCount && spell.effect?.attacks ? { attacks: tier.targetCount } : {})
    }
  );
  return {
    id: itemActionId(item.id, READ_SUFFIX),
    name: `Cast ${spell.name} (${item.name})`,
    activation: activationOf(spell.castingTime),
    description:
      `Read the scroll to cast ${spell.name} with no spell slot and no Material components (save DC ${numbers.saveDc}, attack +${numbers.attackBonus}). It crumbles once the spell is cast. ${spell.description}`.slice(
        0,
        12000
      ),
    ...mechanics,
    ...castAreaOf(spell, mechanics),
    // A reaction spell's trigger rides the scroll's action too, so the table offers it when the trigger happens.
    ...(spell.effect?.reaction ? { reaction: structuredClone(spell.effect.reaction) } : {}),
    spellId: spell.id
  };
}

/** The check a spell above the reader's levels needs, as any ability check is made (`checkPlan`): the spellcasting
 *  ability, or Intelligence (Arcana) for Use Magic Device, with the label its result is read under. */
export function scrollCheckOf(
  check: ScrollCheck,
  spellName: string
): Readonly<{ subject: CheckSubject; label: string }> {
  if (check.skill === null)
    return {
      subject: { ability: check.ability },
      label: `${ABILITY_NAMES[check.ability]} check to cast ${spellName} from a scroll`
    };
  return {
    subject: { ability: check.ability, skill: check.skill },
    label: `Intelligence (Arcana) check to cast ${spellName} from a scroll`
  };
}

/** What the table reads when the check fails: the spell is gone, and the scroll with it. */
export const scrollLostLine = (readerName: string, spellName: string) =>
  `${readerName} fails to cast ${spellName} from the scroll, and the scroll is lost.`;
