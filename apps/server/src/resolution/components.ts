import type { SpellMaterial, SpellReference } from "@vtt/content-srd-5.2.1";
import { effectiveSlot } from "@vtt/rules-5e";
import { catalogIdOf, type ActorDefinition, type Currency, type InventoryItem } from "@vtt/schemas";
import { animatedRowIds } from "../animated-items.js";
import { CANT_SPEAK_TAG, HANDS_BOUND_TAG } from "../effects.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { isItemActionId, laterRowOf } from "../item-actions.js";
import { isDivineCast } from "../divine-intervention.js";
import type { RuleId } from "../rules-families.js";
import { scrollOfAction } from "../scrolls.js";
import type { DefinitionAction, LiveActor } from "./context.js";

/**
 * SRD 5.2.1 Components. A spell with a Verbal component needs a caster who can speak. A Somatic one needs a free
 * hand. A Material one needs a Component Pouch or a Spellcasting Focus the caster's class may use, and a hand to reach
 * it, or the material itself when it has a worth or the spell consumes it (`SpellReference.components.costly`). A
 * weapon in hand is stowed or drawn with the cast's free object interaction, so only what can't be let go of fills a
 * hand: a Shield, which takes an action to doff, or hands an effect binds. A focus borne on that Shield (a Holy Symbol
 * emblem) serves the Material component, and its hand makes the gestures of such a spell. A spell cast from a magic
 * item needs no components; one read from a Spell Scroll needs no Material ones. A stat block casts with what its
 * Spellcasting says it goes without ("requiring no Material components"), and since stat blocks list no gear, only
 * its Verbal component is checked.
 */

type Component = "verbal" | "somatic" | "material";
export type ComponentGap = Readonly<{ rule: RuleId; message: string }>;

/** What a cast takes from the pack when it resolves: a consumed material's row, or coins from the purse. */
export type ComponentSpend = Readonly<
  { rowId: string; count: number } | { coins: Readonly<{ unit: keyof Currency; amount: number }> }
>;

export type ComponentReading = Readonly<{ gaps: readonly ComponentGap[]; spends: readonly ComponentSpend[] }>;

const NONE: ComponentReading = { gaps: [], spends: [] };

/** The focus kinds a class names (`spellcasting.focus`) and the gear rows of each, by catalog id. */
const FOCUS_ROWS: Readonly<Record<string, (catalogId: string) => boolean>> = {
  "arcane-focus": (id) => id.startsWith("arcane-focus"),
  "druidic-focus": (id) => id.startsWith("druidic-focus"),
  "holy-symbol": (id) => id.startsWith("holy-symbol"),
  "musical-instrument": (id) => id.startsWith("instrument-")
};

/** A Holy Symbol borne on a Shield or fabric, which serves while it is equipped with no hand of its own. */
const EMBLEM_ID = "holy-symbol-emblem";
const POUCH_ID = "component-pouch";
/** "You can use an Arcane Focus or your spellbook as a Spellcasting Focus for your Wizard spells." */
const SPELLBOOK_FOCUS: Readonly<Record<string, string>> = { wizard: "spellbook" };

const carried = (row: InventoryItem) => row.quantity > 0;
const equipped = (row: InventoryItem) => row.equipped && carried(row);

/** The components a stat block's Spellcasting says this cast goes without. */
function waivedBy(definition: ActorDefinition | undefined, action: DefinitionAction): ReadonlySet<Component> {
  // Divine Intervention: "without expending a spell slot or needing Material components".
  if (isDivineCast(action.id)) return new Set(["material"]);
  for (const parent of definition?.actions ?? []) {
    const casts = parent.castsSpells;
    if (!casts?.waives) continue;
    if ((casts.self && parent.id === action.id) || casts.spells.some((entry) => entry.id === action.id))
      return new Set(casts.waives);
  }
  return new Set();
}

/** The focus kinds this cast may use: the spell's own class's, else any of the character's classes'. */
function focusKinds(
  definition: ActorDefinition | undefined,
  spellId: string,
  catalog: EquipmentCatalog | undefined
): { kinds: string[]; books: string[] } {
  const entry = definition?.spellcasting?.spells.find((spell) => spell.id === spellId);
  const classIds = entry?.classId
    ? [entry.classId]
    : (definition?.character?.classes ?? []).map((row) => row.id).filter((id) => id.length > 0);
  const kinds = classIds.flatMap((id) => {
    const focus = catalog?.classRecord?.(id)?.spellcasting?.focus;
    return focus ? [focus] : [];
  });
  return { kinds, books: classIds.flatMap((id) => (SPELLBOOK_FOCUS[id] ? [SPELLBOOK_FOCUS[id]!] : [])) };
}

/** The rows a cast can use as its Spellcasting Focus. */
function focusRows(inventory: readonly InventoryItem[], kinds: readonly string[], books: readonly string[]) {
  return inventory.filter((row) => {
    if (!carried(row)) return false;
    const id = catalogIdOf(row);
    return books.includes(id) || kinds.some((kind) => FOCUS_ROWS[kind]?.(id) ?? id === kind);
  });
}

/** The hands the caster can't free for a cast: one for each Shield it wears, both while an effect binds them. `why`
 *  says what fills them, and `shield` whether a Shield's hand is among them. */
function boundHands(attacker: LiveActor): Readonly<{ free: boolean; shield: boolean; why: string }> {
  const binding = attacker.effects.find((effect) => effect.tags.includes(HANDS_BOUND_TAG));
  if (binding) return { free: false, shield: false, why: `${binding.name} binds both hands` };
  // An animated Shield hovers beside its user and fills no hand.
  const animated = animatedRowIds(attacker);
  const shields = attacker.inventory.filter(
    (row) =>
      equipped(row) &&
      !animated.has(row.id) &&
      effectiveSlot({ slot: row.magic?.slot, category: row.category }) === "shield"
  );
  return {
    free: shields.length < 2,
    shield: shields.length > 0,
    why: `${shields.map((row) => row.name).join(" and ")} fill both hands`
  };
}

/** How many of a material the cast needs. */
const neededOf = (material: SpellMaterial, targetCount: number) =>
  (material.count ?? 1) * (material.perTarget ? Math.max(1, targetCount) : 1);

/** The carried rows that are this material, by gear id or by a word of its name. */
function materialRows(inventory: readonly InventoryItem[], material: SpellMaterial): InventoryItem[] {
  return inventory.filter((row) => {
    if (!carried(row)) return false;
    const id = catalogIdOf(row);
    if (material.itemIds?.includes(id)) return true;
    const name = row.name.toLowerCase();
    return (material.matches ?? []).some((word) => name.includes(word.toLowerCase()));
  });
}

/** "a diamond worth 300+ GP", "4 ivory strips worth 50+ GP each". */
function materialWords(material: SpellMaterial, needed: number): string {
  const worth = material.costGp !== null ? ` worth ${material.costGp}+ GP${needed > 1 ? " each" : ""}` : "";
  return `${needed > 1 ? `${needed} ` : ""}${material.name}${worth}`;
}

/**
 * The components this cast lacks, as rules gaps with a sentence each, and what it uses up when it resolves. Empty for
 * what is no new cast (a spell's later action), a magic item's cast, or a spell the catalog doesn't hold.
 */
export function readComponents(
  input: Readonly<{
    attacker: LiveActor;
    action: DefinitionAction;
    spell: SpellReference | undefined;
    definition: ActorDefinition | undefined;
    catalog: EquipmentCatalog | undefined;
    /** The caster stands in an area where no sound can be made (Silence). Measured on the map by the caller. */
    silenced?: boolean;
    /** Subtle Spell: "without any Verbal, Somatic, or Material components, except Material components that are consumed
     *  by the spell or that have a cost specified in the spell". */
    subtle?: boolean;
    targetCount: number;
  }>
): ComponentReading {
  const { attacker, action, spell, definition, catalog } = input;
  if (!spell || laterRowOf(spell, action.id) !== undefined) return NONE;
  const scroll = scrollOfAction(action, attacker.inventory, catalog) !== null;
  // "Requires no components unless the item's description notes otherwise"; a scroll is read without Material ones.
  if (isItemActionId(action.id) && !scroll) return NONE;
  const waived = waivedBy(definition, action);
  const subtle = input.subtle === true;
  const needs = (component: Component) =>
    spell.components[component] && !waived.has(component) && !(subtle && component !== "material");
  const gaps: ComponentGap[] = [];
  const spends: ComponentSpend[] = [];
  const name = attacker.name;

  if (needs("verbal")) {
    const gag = attacker.effects.find((effect) => effect.tags.includes(CANT_SPEAK_TAG));
    if (gag || input.silenced)
      gaps.push({
        rule: "spell.no-verbal",
        message: gag
          ? `${name} can't speak while ${gag.name} lasts, and ${spell.name} has a Verbal component.`
          : `No sound can be made where ${name} stands, and ${spell.name} has a Verbal component.`
      });
  }
  // A stat block lists no gear, so its hands and materials are the GM's.
  if (definition?.character === undefined) return { gaps, spends };

  const somatic = needs("somatic");
  const material = needs("material") && !scroll;
  if (!somatic && !material) return { gaps, spends };
  const hands = boundHands(attacker);
  const freeHand = hands.free;
  const { kinds, books } = focusKinds(definition, spell.id, catalog);
  const focuses = focusRows(attacker.inventory, kinds, books);
  // An emblem borne on a Shield serves with no hand of its own, and the Shield's hand makes the gestures.
  const emblem = hands.shield && focuses.some((row) => equipped(row) && catalogIdOf(row) === EMBLEM_ID);
  const costly = material ? (spell.components.costly ?? []) : [];

  if (material && costly.length === 0 && !subtle) {
    const pouch = attacker.inventory.some((row) => carried(row) && catalogIdOf(row) === POUCH_ID);
    if (!pouch && focuses.length === 0)
      gaps.push({
        rule: "spell.no-material",
        message: `${spell.name} has a Material component (${spell.components.materialText ?? "see the spell"}), and ${name} carries no Component Pouch or Spellcasting Focus ${name} can use.`
      });
    else if (!freeHand && !emblem)
      gaps.push({
        rule: "spell.no-material",
        message: `${name} has no free hand to reach a Component Pouch or a focus for ${spell.name}: ${hands.why}.`
      });
  }
  for (const part of costly) {
    const needed = neededOf(part, input.targetCount);
    if (part.coins) {
      const purse = attacker.currency[part.coins.unit];
      if (purse < part.coins.amount * needed)
        gaps.push({
          rule: "spell.no-material",
          message: `${spell.name} uses up ${part.name}, and ${name}'s purse holds ${purse} ${part.coins.unit.toUpperCase()}.`
        });
      else if (part.consumed) spends.push({ coins: { unit: part.coins.unit, amount: part.coins.amount * needed } });
      continue;
    }
    const rows = materialRows(attacker.inventory, part);
    const have = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (have < needed) {
      gaps.push({
        rule: "spell.no-material",
        message: `${spell.name} needs ${materialWords(part, needed)}${part.consumed ? ", which the spell consumes" : ""}. Add it to ${name}'s gear. A Component Pouch or a focus can't stand in for it.`
      });
      continue;
    }
    if (!part.consumed) continue;
    let left = needed;
    for (const row of rows) {
      if (left <= 0) break;
      const taken = Math.min(left, row.quantity);
      spends.push({ rowId: row.id, count: taken });
      left -= taken;
    }
  }
  if (costly.length > 0 && !freeHand && !gaps.some((gap) => gap.rule === "spell.no-material"))
    gaps.push({
      rule: "spell.no-material",
      message: `${name} has no free hand to use ${spell.name}'s material: ${hands.why}.`
    });

  if (somatic && !freeHand && !(material && emblem))
    gaps.push({
      rule: "spell.no-free-hand",
      message: `${name} has no free hand for ${spell.name}'s Somatic component: ${hands.why}.`
    });
  return { gaps, spends };
}

/** Whether the cast is made with a Verbal component (SRD Hide: casting such a spell ends it): a new cast of a spell
 *  that has one, from neither a magic item (a Spell Scroll is read aloud) nor a stat block that goes without it, and
 *  not made Subtle. */
export function castsWithVerbal(
  input: Readonly<{
    attacker: LiveActor;
    action: DefinitionAction;
    spell: SpellReference | undefined;
    definition: ActorDefinition | undefined;
    catalog: EquipmentCatalog | undefined;
    subtle: boolean;
  }>
): boolean {
  const { attacker, action, spell, definition, catalog } = input;
  if (!spell || !spell.components.verbal || laterRowOf(spell, action.id) !== undefined || input.subtle) return false;
  if (isItemActionId(action.id) && scrollOfAction(action, attacker.inventory, catalog) === null) return false;
  return !waivedBy(definition, action).has("verbal");
}

/** What `readComponents` said a cast uses up, taken from the caster's pack and purse. */
export function spendComponents(attacker: LiveActor, spends: readonly ComponentSpend[]): void {
  for (const spend of spends) {
    if ("coins" in spend) {
      const purse = attacker.currency;
      attacker.currency = {
        ...purse,
        [spend.coins.unit]: Math.max(0, purse[spend.coins.unit] - spend.coins.amount)
      };
      continue;
    }
    attacker.inventory = attacker.inventory.flatMap((row) =>
      row.id !== spend.rowId
        ? [row]
        : row.quantity > spend.count
          ? [{ ...row, quantity: row.quantity - spend.count }]
          : []
    );
  }
}
