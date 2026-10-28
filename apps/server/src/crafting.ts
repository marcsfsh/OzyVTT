import { isDead, type CraftingProject, type GameState } from "@vtt/domain";
import type { EquipmentReference, SpellReference } from "@vtt/content-srd-5.2.1";
import { abilityModifier } from "@vtt/rules-5e";
import {
  catalogIdOf,
  resolveSpellcasting,
  type ActorDefinition,
  type Currency,
  type InventoryItem
} from "@vtt/schemas";
import { toolProficiencies } from "./ability-checks.js";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import type { EffectNarration } from "./effects.js";
import {
  deriveEquipment,
  effectiveSkillTier,
  type EquipmentCatalog,
  type EquipmentDerivation
} from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { clockMinutesOf } from "./game-time.js";
import { setInventoryItem } from "./inventory.js";
import { materialRows, materialWords, neededOf } from "./resolution/components.js";
import { carriedRow } from "./utilize.js";

/**
 * Crafting as downtime (SRD 5.2.1 Equipment: Crafting Nonmagical Items, Brewing Potions of Healing, Scribing Spell
 * Scrolls; Magic Items: Crafting Magic Items). A character starts a project with the tool its maker needs, proficient
 * with it, and pays its raw materials from the purse: half a nonmagical item's cost (round down), 25 GP for a Potion of
 * Healing, the Spell Scroll Costs table's gold, or the Magic Item Crafting table's by rarity. The work is 8-hour days
 * (a nonmagical item's cost in GP divided by 10, a fraction rounded up; a potion 1 day; the tables' days), which pass
 * as the GM passes downtime on the clock (8 hours of work a game day at most) or logs days of it. Helpers with the
 * tool's proficiency divide the time. A finished item joins its crafter's pack: a scroll with the scribe's spell save
 * DC and attack bonus, a cantrip at the scribe's level. Each tool's Craft line says what it makes.
 */

/** "For each day of crafting, you must work for 8 hours." */
export const WORK_DAY_MINUTES = 8 * 60;
const DAY_MINUTES = 24 * 60;
/** "Normally, only one other character can assist you, but the GM might allow more assistants." */
const PLAYER_HELPERS = 1;
const MAX_HELPERS = 6;
const MAX_PROJECTS = 100;

const HERBALISM_KIT = "herbalism-kit";
const CALLIGRAPHERS_SUPPLIES = "calligraphers-supplies";
const POTION_OF_HEALING = "potion-of-healing";
/** The magic Spell Scroll record, which bears a spell of any level. */
const SPELL_SCROLL = "spell-scroll";
const COMPONENT_POUCH = "component-pouch";
/** "A character who has proficiency with the Herbalism Kit can create a Potion of Healing ... 25 GP of raw material
 *  over the course of 1 day (8 hours of work)." */
const POTION_COST_GP = 25;

/** Scribing Spell Scrolls, Spell Scroll Costs: days and gold by the spell's level (0 is a cantrip). */
const SCROLL_COSTS: ReadonlyArray<Readonly<{ days: number; costGp: number }>> = [
  { days: 1, costGp: 15 },
  { days: 1, costGp: 25 },
  { days: 3, costGp: 100 },
  { days: 5, costGp: 150 },
  { days: 10, costGp: 1000 },
  { days: 25, costGp: 1500 },
  { days: 40, costGp: 10000 },
  { days: 50, costGp: 12500 },
  { days: 60, costGp: 15000 },
  { days: 120, costGp: 50000 }
];

/** Crafting Magic Items, Magic Item Crafting Time and Cost, by rarity; halved for a consumable other than a scroll. */
const MAGIC_COSTS: Readonly<Record<string, Readonly<{ days: number; costGp: number }>>> = {
  common: { days: 5, costGp: 50 },
  uncommon: { days: 10, costGp: 200 },
  rare: { days: 50, costGp: 2000 },
  "very-rare": { days: 125, costGp: 20000 },
  legendary: { days: 250, costGp: 100000 }
};

/** Magic Item Tools: the tool each category of magic item needs. Armor, weapons and wondrous items built on a
 *  nonmagical item take that item's tool (`magicToolsFor`). */
const MAGIC_TOOLS: Readonly<Record<string, readonly string[]>> = {
  armor: ["leatherworkers-tools", "smiths-tools", "weavers-tools"],
  potion: ["alchemists-supplies", HERBALISM_KIT],
  ring: ["jewelers-tools"],
  rod: ["woodcarvers-tools"],
  scroll: [CALLIGRAPHERS_SUPPLIES],
  staff: ["woodcarvers-tools"],
  wand: ["woodcarvers-tools"],
  weapon: ["leatherworkers-tools", "smiths-tools", "woodcarvers-tools"],
  wondrous: ["tinkers-tools"]
};

type Actor = GameState["actors"][number];
export type CraftKind = CraftingProject["kind"];

/** What crafting reads of the content: every record the crafter's reader may see, and the spells. */
export type CraftingDeps = Readonly<{
  catalog: EquipmentCatalog;
  items: () => readonly EquipmentReference[];
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  random?: (sides: number) => number;
}>;

const toCp = (gp: number) => Math.round(gp * 100);

// ---- what each tool makes ----------------------------------------------------------------------------------------

/** The names a record answers to in a Craft line: "Bottle, Glass" is a Glass Bottle, "Ladder (10-foot)" a Ladder,
 *  "Flask or Tankard" a Flask, "Crossbow Bolts (20)" Bolts. */
function craftNames(record: EquipmentReference): string[] {
  const base = record.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const names = new Set([record.name.toLowerCase(), base.toLowerCase()]);
  const comma = /^(.+?), (.+)$/.exec(base);
  if (comma) {
    names.add(comma[1]!.toLowerCase());
    names.add(`${comma[2]} ${comma[1]}`.toLowerCase());
  } else for (const part of base.split(" or ")) names.add(part.trim().toLowerCase());
  if (record.category === "ammunition") names.add(base.split(" ").pop()!.toLowerCase());
  return [...names];
}

/** The armor weight a body armor's numbers give it. */
function armorWeight(record: EquipmentReference): "light" | "medium" | "heavy" | null {
  if (!record.armor || record.category !== "armor") return null;
  if (!record.armor.addDexModifier) return "heavy";
  return record.armor.dexModifierCap === null ? "light" : "medium";
}

/** "Club, Greatclub, Quarterstaff, and Whip": the names an exception lists, matched as a name or its first words
 *  ("Hide" is Hide Armor). */
function excepted(list: string): (record: EquipmentReference) => boolean {
  const names = list
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  return (record) =>
    names.some((name) => record.name.toLowerCase() === name || record.name.toLowerCase().startsWith(`${name} `));
}

/** The Craft line's entries ("Craft: Ink, Spell Scroll."), split on the commas outside parentheses. */
export function craftEntries(description: string | null | undefined): string[] {
  const line = /Craft:\s*([^.]+)\./.exec(description ?? "")?.[1];
  if (!line) return [];
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of line) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      entries.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim() !== "") entries.push(current.trim());
  return entries.map((entry) => entry.replace(/_/g, ""));
}

/** One Craft entry's records: a named item (or every kind of a focus), or a band of weapons or armor. */
export function craftEntryItems(entry: string, items: readonly EquipmentReference[]): EquipmentReference[] {
  const plain = items.filter((record) => !record.isMagic && record.category !== "equipment-pack");
  const melee = /^Any Melee weapon(?: \(except (.+)\))?$/i.exec(entry);
  if (melee) {
    const out = melee[1] ? excepted(melee[1]) : () => false;
    return plain.filter((record) => record.weapon?.melee === true && !out(record));
  }
  const ranged = /^Ranged weapons(?: \(except (.+)\))?$/i.exec(entry);
  if (ranged) {
    const out = ranged[1] ? excepted(ranged[1]) : () => false;
    return plain.filter((record) => record.weapon && record.weapon.melee === false && !out(record));
  }
  const armor = /^(Light|Medium|Heavy) armor(?: \(except (.+)\))?$/i.exec(entry);
  if (armor) {
    const out = armor[2] ? excepted(armor[2]) : () => false;
    return plain.filter((record) => armorWeight(record) === armor[1]!.toLowerCase() && !out(record));
  }
  const name = entry.toLowerCase();
  return plain.filter((record) => craftNames(record).includes(name));
}

/** The records a tool's Craft line makes. A Spell Scroll and a Potion of Healing are scribed and brewed instead. */
export function toolCrafts(
  tool: EquipmentReference | undefined,
  items: readonly EquipmentReference[]
): EquipmentReference[] {
  if (!tool) return [];
  return craftEntries(tool.description).flatMap((entry) =>
    /^Spell Scroll$/i.test(entry) ? [] : craftEntryItems(entry, items)
  );
}

/** Which tools' Craft lines make each nonmagical record, by record id: built once for a lookup over the catalog. */
type CraftIndex = ReadonlyMap<string, readonly string[]>;

function craftIndex(items: readonly EquipmentReference[]): CraftIndex {
  const index = new Map<string, string[]>();
  for (const tool of items)
    if (tool.category === "tool")
      for (const made of toolCrafts(tool, items)) index.set(made.id, [...(index.get(made.id) ?? []), tool.id]);
  return index;
}

/** The tools whose Craft line makes this nonmagical record. */
const toolsMaking = (recordId: string, index: CraftIndex): readonly string[] => [...new Set(index.get(recordId) ?? [])];

// ---- costs and checks ----------------------------------------------------------------------------------------------

/** A magic item's category as the SRD prints it first in its description ("Potion, Rare", "Armor (Shield)"). */
function magicCategory(record: EquipmentReference): string {
  const printed = /^(Wondrous Item|Potion|Scroll|Weapon|Armor|Ring|Rod|Staff|Wand)\b/.exec(
    record.description ?? ""
  )?.[1];
  if (printed) return printed === "Wondrous Item" ? "wondrous" : printed.toLowerCase();
  if (record.category === "ammunition") return "weapon";
  if (record.category === "shield") return "armor";
  return record.category === "wondrous-item" ? "wondrous" : record.category;
}

/** A consumable other than a Spell Scroll halves a magic item's time and cost. */
const consumable = (record: EquipmentReference) =>
  record.consumedOnUse === true || magicCategory(record) === "potion" || record.category === "ammunition";

/** The tools that can make a magic item: its base's maker for armor, a weapon or ammunition built on one, else the
 *  Magic Item Tools table's. */
function magicToolsFor(record: EquipmentReference, baseId: string | undefined, index: CraftIndex): readonly string[] {
  const category = magicCategory(record);
  if (baseId !== undefined && (category === "armor" || category === "weapon")) {
    const makers = toolsMaking(baseId, index);
    if (makers.length > 0) return makers;
  }
  return MAGIC_TOOLS[category] ?? [];
}

const hasArcana = (definition: ActorDefinition | undefined, derivation: EquipmentDerivation) =>
  effectiveSkillTier(definition, derivation, "arcana") !== "none";

/** Whether the character has this spell ready on a day of work: a cantrip or spell it knows, prepared where its class
 *  prepares spells. */
export function spellReady(actor: Actor, definition: ActorDefinition | undefined, spellId: string): boolean {
  const spell = definition?.spellcasting?.spells.find((entry) => entry.id === spellId);
  if (!spell) return false;
  if (spell.level === 0 || spell.alwaysPrepared || actor.preparedSpellIds.includes(spell.id)) return true;
  const classes = definition!.spellcasting!.classes ?? [];
  const casting = classes.length === 1 ? classes[0] : classes.find((entry) => entry.classId === spell.classId);
  return casting?.prepared === undefined;
}

/** The scribe's spell save DC and attack bonus for this spell, and its level for a cantrip. */
function scribeNumbers(definition: ActorDefinition, spellId: string) {
  const spell = definition.spellcasting?.spells.find((entry) => entry.id === spellId);
  const casting = resolveSpellcasting(definition.spellcasting, spell?.classId);
  const modifier = casting ? abilityModifier(definition.abilityScores[casting.ability]) : 0;
  const level = (definition.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0);
  return {
    saveDc: Math.max(1, Math.min(40, casting?.saveDc ?? 8 + definition.proficiencyBonus + modifier)),
    attackBonus: Math.max(-5, Math.min(30, casting?.attackBonus ?? definition.proficiencyBonus + modifier)),
    casterLevel: Math.max(1, Math.min(20, level))
  };
}

/** What the scribe must have at hand for a spell's Material components: each priced material, and a Component Pouch
 *  or a Spellcasting Focus for the rest. Null when it has them. */
function materialsMissing(actor: Actor, spell: SpellReference, deps: CraftingDeps): string | null {
  if (!spell.components.material) return null;
  for (const part of spell.components.costly ?? []) {
    if (part.coins) continue;
    const needed = neededOf(part, 1);
    const have = materialRows(actor.inventory, part).reduce((sum, row) => sum + row.quantity, 0);
    if (have < needed) return `${actor.name} needs ${materialWords(part, needed)} at hand to scribe ${spell.name}.`;
  }
  if ((spell.components.costly ?? []).length > 0) return null;
  const focus = actor.inventory.some(
    (row) =>
      row.quantity > 0 &&
      (catalogIdOf(row) === COMPONENT_POUCH || deps.catalog.equipmentRecord(catalogIdOf(row))?.category === "focus")
  );
  return focus
    ? null
    : `${actor.name} needs a Component Pouch or a Spellcasting Focus at hand to scribe ${spell.name}.`;
}

// ---- paying -------------------------------------------------------------------------------------------------------

const COIN_CP: Readonly<Record<keyof Currency, number>> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

export const purseCp = (currency: Currency) =>
  (Object.keys(COIN_CP) as Array<keyof Currency>).reduce((sum, coin) => sum + currency[coin] * COIN_CP[coin], 0);

/** The purse after paying `cost` copper, the change made in gold, silver and copper; null when it holds too little. */
export function payFromPurse(currency: Currency, cost: number): Currency | null {
  let left = purseCp(currency) - cost;
  if (left < 0) return null;
  const take = (coin: keyof Currency, kept: number) => {
    left -= kept * COIN_CP[coin];
    return kept;
  };
  const pp = take("pp", Math.min(currency.pp, Math.floor(left / COIN_CP.pp)));
  const gp = take("gp", Math.floor(left / COIN_CP.gp));
  const ep = take("ep", Math.min(currency.ep, Math.floor(left / COIN_CP.ep)));
  const sp = take("sp", Math.floor(left / COIN_CP.sp));
  return { pp, gp, ep, sp, cp: take("cp", left) };
}

/** "25 GP", "7 GP 5 SP", "4 CP". */
export function coinsWords(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const copper = cp % 10;
  const parts = [gp > 0 ? `${gp} GP` : "", sp > 0 ? `${sp} SP` : "", copper > 0 ? `${copper} CP` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 GP";
}

// ---- the plan for one project -------------------------------------------------------------------------------------

export type CraftRequest = Readonly<{
  actorId: string;
  itemId: string;
  spellId?: string;
  baseId?: string;
  toolId?: string;
}>;

export type CraftPlan = Readonly<{
  kind: CraftKind;
  itemName: string;
  toolId: string;
  /** Copper the raw materials cost, a base's price included. */
  materialsCp: number;
  workMinutes: number;
  baseId?: string;
  /** A carried base the magic item is made on, used up as the project starts. */
  baseRowId?: string;
  spellId?: string;
  scroll?: CraftingProject["scroll"];
  preparedSpellIds: readonly string[];
}>;

/** A tool the crafter can work with: proficient, and carrying it. */
function requireTool(actor: Actor, proficient: readonly string[], toolId: string, deps: CraftingDeps, why: string) {
  const name = deps.catalog.equipmentRecord(toolId)?.name ?? toolId;
  if (!proficient.includes(toolId)) throw new CommandRejectedError(`${why} takes proficiency with ${name}.`);
  if (!carriedRow(actor, toolId)) throw new CommandRejectedError(`${actor.name} needs ${name} in the pack to craft.`);
}

/** Picks the tool for a project from those that can make it, as asked or the first the crafter can work with. */
function pickTool(
  actor: Actor,
  proficient: readonly string[],
  candidates: readonly string[],
  asked: string | undefined,
  deps: CraftingDeps,
  why: string
): string {
  if (asked !== undefined) {
    if (!candidates.includes(asked)) {
      const name = deps.catalog.equipmentRecord(asked)?.name ?? asked;
      throw new CommandRejectedError(`${why} isn't made with ${name}.`);
    }
    requireTool(actor, proficient, asked, deps, why);
    return asked;
  }
  const ready = candidates.find((tool) => proficient.includes(tool) && carriedRow(actor, tool));
  if (ready) return ready;
  const named = candidates.map((tool) => deps.catalog.equipmentRecord(tool)?.name ?? tool);
  throw new CommandRejectedError(
    named.length > 0
      ? `${why} takes ${named.join(" or ")}, with proficiency and in the pack.`
      : `No tool's Craft line makes it. Your GM decides whether it can be made.`
  );
}

/** The project a request makes, checked against the crafter's proficiencies, tools, spells and materials. */
export function planCraft(actor: Actor, request: CraftRequest, deps: CraftingDeps): CraftPlan {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const proficient = toolProficiencies(definition, derivation);
  const items = deps.items();
  const record = items.find((candidate) => candidate.id === request.itemId);
  if (!record) throw new CommandRejectedError("There is no such item to craft.");
  // Brewing Potions of Healing.
  if (record.id === POTION_OF_HEALING) {
    requireTool(actor, proficient, HERBALISM_KIT, deps, "Brewing a Potion of Healing");
    return {
      kind: "potion-of-healing",
      itemName: record.name,
      toolId: HERBALISM_KIT,
      materialsCp: toCp(POTION_COST_GP),
      workMinutes: WORK_DAY_MINUTES,
      preparedSpellIds: []
    };
  }
  // Scribing Spell Scrolls.
  if (record.spellScroll) return planScroll(actor, record, request, definition, derivation, proficient, deps);
  if (record.isMagic) return planMagicItem(actor, record, request, definition, derivation, proficient, deps);
  // Crafting Nonmagical Items.
  if (record.costGp === null || record.costGp <= 0)
    throw new CommandRejectedError(`${record.name} has no price to craft it from. Your GM decides what it costs.`);
  const toolId = pickTool(
    actor,
    proficient,
    toolsMaking(record.id, craftIndex(items)),
    request.toolId,
    deps,
    `Crafting ${record.name}`
  );
  return {
    kind: "item",
    itemName: record.name,
    toolId,
    // "Raw materials worth half its purchase cost (round down)"; "divide its purchase cost in GP by 10 (round a
    // fraction up to a day)".
    materialsCp: Math.floor(toCp(record.costGp) / 2),
    workMinutes: Math.max(1, Math.ceil(record.costGp / 10)) * WORK_DAY_MINUTES,
    preparedSpellIds: []
  };
}

function planScroll(
  actor: Actor,
  record: EquipmentReference,
  request: CraftRequest,
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  proficient: readonly string[],
  deps: CraftingDeps
): CraftPlan {
  if (request.spellId === undefined) throw new CommandRejectedError("Choose the spell to scribe.");
  const spell = deps.catalog.spellRecord?.(request.spellId);
  if (!spell) throw new CommandRejectedError("There is no such spell to scribe.");
  const range = record.spellScroll!;
  if (spell.level < range.minLevel || spell.level > range.maxLevel)
    throw new CommandRejectedError(`${record.name} can't bear ${spell.name}.`);
  // "You must have proficiency in the Arcana skill or with Calligrapher's Supplies."
  if (!hasArcana(definition, derivation) && !proficient.includes(CALLIGRAPHERS_SUPPLIES))
    throw new CommandRejectedError(
      `Scribing a scroll takes proficiency in Arcana or with Calligrapher's Supplies, which ${actor.name} lacks.`
    );
  if (!carriedRow(actor, CALLIGRAPHERS_SUPPLIES))
    throw new CommandRejectedError(`${actor.name} needs Calligrapher's Supplies in the pack to scribe a scroll.`);
  if (!definition || !spellReady(actor, definition, spell.id))
    throw new CommandRejectedError(`${actor.name} must have ${spell.name} prepared on each day of the inscription.`);
  const missing = materialsMissing(actor, spell, deps);
  if (missing) throw new CommandRejectedError(missing);
  const cost = SCROLL_COSTS[spell.level]!;
  return {
    kind: "spell-scroll",
    itemName: `Spell Scroll (${spell.name})`,
    toolId: CALLIGRAPHERS_SUPPLIES,
    materialsCp: toCp(cost.costGp),
    workMinutes: cost.days * WORK_DAY_MINUTES,
    spellId: spell.id,
    scroll: scribeNumbers(definition, spell.id),
    preparedSpellIds: [spell.id]
  };
}

function planMagicItem(
  actor: Actor,
  record: EquipmentReference,
  request: CraftRequest,
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  proficient: readonly string[],
  deps: CraftingDeps
): CraftPlan {
  const cost = record.rarity ? MAGIC_COSTS[record.rarity] : undefined;
  if (!cost) throw new CommandRejectedError(`${record.name} has no rarity the crafting table prices.`);
  // "You and any assistants must have proficiency in the Arcana skill."
  if (!hasArcana(definition, derivation))
    throw new CommandRejectedError(`Crafting a magic item takes proficiency in Arcana, which ${actor.name} lacks.`);
  const baseIds = record.appliesTo?.baseIds ?? [];
  if (baseIds.length > 0 && (request.baseId === undefined || !baseIds.includes(request.baseId)))
    throw new CommandRejectedError(`Choose what ${record.name} is made on: ${record.appliesTo!.label}.`);
  const baseId = baseIds.length > 0 ? request.baseId : undefined;
  const items = deps.items();
  const toolId = pickTool(
    actor,
    proficient,
    magicToolsFor(record, baseId, craftIndex(items)),
    request.toolId,
    deps,
    `Crafting ${record.name}`
  );
  // "If a magic item allows its user to cast any spells from it, you must have all those spells prepared."
  const spellIds = [...new Set(record.casts.map((cast) => cast.spellId))];
  const unready = spellIds.find((spellId) => !spellReady(actor, definition, spellId));
  if (unready)
    throw new CommandRejectedError(
      `${actor.name} must have ${deps.catalog.spellRecord?.(unready)?.name ?? unready} prepared on each day of crafting.`
    );
  // "If a magic item incorporates an item that has a purchase cost ... you must also pay that entire cost or craft
  // that item": a carried base is used, else its price is paid.
  const base = baseId !== undefined ? items.find((candidate) => candidate.id === baseId) : undefined;
  const baseRow = base
    ? actor.inventory.find((row) => row.quantity > 0 && catalogIdOf(row) === base.id && row.variantId === undefined)
    : undefined;
  const halved = consumable(record) ? 2 : 1;
  return {
    kind: "magic-item",
    itemName: base ? `${record.name} (${base.name})` : record.name,
    toolId,
    materialsCp: toCp(cost.costGp / halved) + (base && !baseRow ? toCp(base.costGp ?? 0) : 0),
    workMinutes: Math.ceil((cost.days * WORK_DAY_MINUTES) / halved),
    ...(baseId !== undefined ? { baseId } : {}),
    ...(baseRow ? { baseRowId: baseRow.id } : {}),
    preparedSpellIds: spellIds
  };
}

// ---- commands -------------------------------------------------------------------------------------------------------

const inFight = (state: GameState, actorId: string) =>
  state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);

function projectOf(state: GameState, projectId: string): CraftingProject {
  const project = state.crafting.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new CommandRejectedError("That project is no longer under way.");
  return project;
}

function writeProjects(state: GameState, projects: readonly CraftingProject[]): void {
  state.crafting = { ...state.crafting, projects: [...projects] };
}

/** A character starts a project: its player for their own character, the GM for anyone, outside a fight. The raw
 *  materials are paid from the purse, and a carried base is used up. Returns the line the table reads. */
export function startCraft(
  state: GameState,
  request: CraftRequest,
  scope: Initiator,
  deps: CraftingDeps & Readonly<{ newId: () => string }>
): string {
  requireActorAccess(scope, state, request.actorId, "resource", "You can only craft with your own character.");
  const actor = state.actors.find((candidate) => candidate.id === request.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  if (inFight(state, actor.id)) throw new CommandRejectedError("Crafting is downtime. End the encounter first.");
  if (isDead(actor)) throw new CommandRejectedError(`${actor.name} is dead.`);
  if (state.crafting.projects.length >= MAX_PROJECTS)
    throw new CommandRejectedError("Too many projects are under way. Finish or cancel one first.");
  const plan = planCraft(actor, request, deps);
  const paid = payFromPurse(actor.currency, plan.materialsCp);
  if (!paid)
    throw new CommandRejectedError(
      `${plan.itemName} takes ${coinsWords(plan.materialsCp)} of raw materials, and ${actor.name}'s purse holds ${coinsWords(purseCp(actor.currency))}.`
    );
  actor.currency = paid;
  if (plan.baseRowId !== undefined)
    actor.inventory = actor.inventory.flatMap((row) =>
      row.id !== plan.baseRowId ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []
    );
  const project: CraftingProject = {
    id: deps.newId(),
    crafterId: actor.id,
    itemId: request.itemId,
    itemName: plan.itemName.slice(0, 120),
    kind: plan.kind,
    toolId: plan.toolId,
    ...(plan.baseId !== undefined ? { baseId: plan.baseId } : {}),
    ...(plan.spellId !== undefined ? { spellId: plan.spellId } : {}),
    ...(plan.scroll ? { scroll: { ...plan.scroll } } : {}),
    preparedSpellIds: [...plan.preparedSpellIds],
    helperIds: [],
    workMinutes: plan.workMinutes,
    doneMinutes: 0,
    paidCp: plan.materialsCp,
    startedAt: clockMinutesOf(state)
  };
  writeProjects(state, [...state.crafting.projects, project]);
  const days = Math.round((plan.workMinutes / WORK_DAY_MINUTES) * 10) / 10;
  return `${actor.name} starts crafting ${plan.itemName}: ${coinsWords(plan.materialsCp)} of raw materials and ${days} ${days === 1 ? "day" : "days"} of work.`;
}

/** A character joins a project as a helper, or leaves it: the helper's player or the GM. A helper needs the tool's
 *  proficiency (and Arcana for a magic item); a player's character joins only a project with no helper yet. */
export function setCraftHelper(
  state: GameState,
  input: Readonly<{ projectId: string; actorId: string; helping: boolean }>,
  scope: Initiator,
  deps: CraftingDeps
): string {
  requireActorAccess(scope, state, input.actorId, "resource", "You can only help with your own character.");
  const project = projectOf(state, input.projectId);
  const helper = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!helper) throw new CommandRejectedError("That character no longer exists.");
  const crafter = state.actors.find((candidate) => candidate.id === project.crafterId)?.name ?? "the crafter";
  if (!input.helping) {
    if (!project.helperIds.includes(helper.id))
      throw new CommandRejectedError(`${helper.name} isn't helping with ${project.itemName}.`);
    writeProjects(
      state,
      state.crafting.projects.map((entry) =>
        entry.id === project.id ? { ...entry, helperIds: entry.helperIds.filter((id) => id !== helper.id) } : entry
      )
    );
    return `${helper.name} stops helping ${crafter} with ${project.itemName}.`;
  }
  if (helper.id === project.crafterId || project.helperIds.includes(helper.id))
    throw new CommandRejectedError(`${helper.name} works on ${project.itemName} already.`);
  const limit = scope.role === "gm" ? MAX_HELPERS : PLAYER_HELPERS;
  if (project.helperIds.length >= limit)
    throw new CommandRejectedError(
      scope.role === "gm"
        ? `${project.itemName} has ${MAX_HELPERS} helpers already.`
        : `Only one other character can assist with ${project.itemName}. Your GM can allow more.`
    );
  const definition = helper.definitionId ? deps.resolveDefinition(helper.definitionId) : undefined;
  const derivation = deriveEquipment(helper, definition, deps.catalog);
  const tool = deps.catalog.equipmentRecord(project.toolId)?.name ?? project.toolId;
  if (!toolProficiencies(definition, derivation).includes(project.toolId))
    throw new CommandRejectedError(`Helping with ${project.itemName} takes proficiency with ${tool}.`);
  if (project.kind === "magic-item" && !hasArcana(definition, derivation))
    throw new CommandRejectedError(
      `Helping craft a magic item takes proficiency in Arcana, which ${helper.name} lacks.`
    );
  writeProjects(
    state,
    state.crafting.projects.map((entry) =>
      entry.id === project.id ? { ...entry, helperIds: [...entry.helperIds, helper.id] } : entry
    )
  );
  return `${helper.name} helps ${crafter} craft ${project.itemName}.`;
}

/** A project is called off by its crafter's player or the GM. Its raw materials are spent. */
export function cancelCraft(
  state: GameState,
  projectId: string,
  scope: Initiator
): Readonly<{ line: string; crafterId: string }> {
  const project = projectOf(state, projectId);
  requireActorAccess(scope, state, project.crafterId, "resource", "You can only cancel your own character's project.");
  writeProjects(
    state,
    state.crafting.projects.filter((entry) => entry.id !== projectId)
  );
  const crafter = state.actors.find((actor) => actor.id === project.crafterId)?.name ?? "The crafter";
  return { line: `${crafter} stops crafting ${project.itemName}.`, crafterId: project.crafterId };
}

/** Whether a worker can put in time now: alive, conscious and out of a fight. */
const canWork = (state: GameState, actor: Actor | undefined): actor is Actor =>
  actor !== undefined && !isDead(actor) && actor.hp.current > 0 && !inFight(state, actor.id);

/** Why the crafter can't work on the project today (a spell it must have prepared), or null. */
function idleReason(project: CraftingProject, crafter: Actor, deps: CraftingDeps): string | null {
  const definition = crafter.definitionId ? deps.resolveDefinition(crafter.definitionId) : undefined;
  const unready = project.preparedSpellIds.find((spellId) => !spellReady(crafter, definition, spellId));
  if (!unready) return null;
  const name = deps.catalog.spellRecord?.(unready)?.name ?? unready;
  return `${crafter.name} can't work on ${project.itemName} without ${name} prepared.`;
}

/** The progress `crafter` minutes of work make with these helpers' time beside it, each helper giving no more than
 *  the crafter works. */
const progressOf = (minutes: number, helperMinutes: readonly number[]) =>
  minutes + helperMinutes.reduce((sum, available) => sum + Math.min(minutes, available), 0);

/**
 * The GM passes downtime on the clock, from `from` to `to` minutes: each game day, every crafter works up to 8 hours on
 * its projects, oldest first, and each helper beside it, so long as each is alive, conscious and out of a fight.
 * Finished projects join their crafters' packs. Returns what the table reads.
 */
export function workDuringDowntime(state: GameState, from: number, to: number, deps: CraftingDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const idle = new Set<string>();
  let cursor = from;
  while (cursor < to && state.crafting.projects.length > 0) {
    const day = Math.floor(cursor / DAY_MINUTES);
    const span = Math.min(to, (day + 1) * DAY_MINUTES) - cursor;
    const worked: Record<string, number> = state.crafting.day === day ? { ...state.crafting.worked } : {};
    const available = (actorId: string) => Math.max(0, Math.min(span, WORK_DAY_MINUTES - (worked[actorId] ?? 0)));
    const projects = state.crafting.projects.map((project) => ({ ...project }));
    for (const project of projects) {
      const crafter = state.actors.find((actor) => actor.id === project.crafterId);
      if (!canWork(state, crafter)) continue;
      const why = idleReason(project, crafter, deps);
      if (why) {
        if (!idle.has(project.id)) events.push({ kind: "effect", text: why, actorId: crafter.id });
        idle.add(project.id);
        continue;
      }
      const helpers = project.helperIds.filter((id) =>
        canWork(
          state,
          state.actors.find((actor) => actor.id === id)
        )
      );
      const own = available(crafter.id);
      if (own <= 0) continue;
      const helperTime = helpers.map(available);
      const needed = project.workMinutes - project.doneMinutes;
      // Only as long as the work needs: the least time whose progress finishes it.
      let minutes = own;
      if (progressOf(own, helperTime) > needed) {
        let low = 1;
        let high = own;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (progressOf(middle, helperTime) >= needed) high = middle;
          else low = middle + 1;
        }
        minutes = low;
      }
      project.doneMinutes = Math.min(project.workMinutes, project.doneMinutes + progressOf(minutes, helperTime));
      worked[crafter.id] = (worked[crafter.id] ?? 0) + minutes;
      helpers.forEach((id, index) => {
        worked[id] = (worked[id] ?? 0) + Math.min(minutes, helperTime[index]!);
      });
    }
    state.crafting = { ...state.crafting, projects, day, worked };
    events.push(...finishDone(state, deps));
    cursor += span;
  }
  return events;
}

/** The GM logs days of downtime work on one project (8 hours each for the crafter and each helper), with no time
 *  passing on the clock. */
export function logCraftDays(
  state: GameState,
  input: Readonly<{ projectId: string; days: number }>,
  scope: Initiator,
  deps: CraftingDeps
): EffectNarration[] {
  requireGm(scope, "Only the GM logs downtime.");
  const project = projectOf(state, input.projectId);
  const crafter = state.actors.find((actor) => actor.id === project.crafterId);
  if (!crafter) throw new CommandRejectedError("The crafter is no longer on the roster.");
  const why = idleReason(project, crafter, deps);
  if (why) throw new CommandRejectedError(why);
  const progress = input.days * WORK_DAY_MINUTES * (1 + project.helperIds.length);
  writeProjects(
    state,
    state.crafting.projects.map((entry) =>
      entry.id === project.id
        ? { ...entry, doneMinutes: Math.min(entry.workMinutes, entry.doneMinutes + progress) }
        : entry
    )
  );
  return finishDone(state, deps);
}

/** A free row id for a new copy in the pack: the record's own, or it with a number. */
function freeRowId(actor: Actor, base: string): string {
  const root = base.slice(0, 74);
  if (!actor.inventory.some((row) => row.id === root)) return root;
  for (let index = 2; ; index += 1)
    if (!actor.inventory.some((row) => row.id === `${root}-${index}`)) return `${root}-${index}`;
}

/** Each finished project leaves the list and its item joins its crafter's pack. */
function finishDone(state: GameState, deps: CraftingDeps): EffectNarration[] {
  const done = state.crafting.projects.filter((project) => project.doneMinutes >= project.workMinutes);
  if (done.length === 0) return [];
  writeProjects(
    state,
    state.crafting.projects.filter((project) => project.doneMinutes < project.workMinutes)
  );
  const events: EffectNarration[] = [];
  for (const project of done) {
    const crafter = state.actors.find((actor) => actor.id === project.crafterId);
    if (!crafter) continue;
    events.push(...addMade(state, crafter, project, deps));
    events.push({
      kind: "effect",
      text: `${crafter.name} finishes crafting ${project.itemName}.`,
      actorId: crafter.id
    });
  }
  return events;
}

/** The made item joins the crafter's pack: on its stack when it is a plain copy, else as a row of its own. */
function addMade(state: GameState, crafter: Actor, project: CraftingProject, deps: CraftingDeps): EffectNarration[] {
  const recordId = project.kind === "spell-scroll" ? SPELL_SCROLL : project.itemId;
  const record = deps.catalog.equipmentRecord(recordId);
  const resolveDefinition = deps.resolveDefinition;
  const inventoryDeps = { catalog: deps.catalog, role: "gm" as const, ...(deps.random ? { random: deps.random } : {}) };
  const plain = project.kind !== "spell-scroll" && project.baseId === undefined;
  const stack = plain
    ? crafter.inventory.find(
        (row) =>
          row.id === project.itemId &&
          row.recordId === undefined &&
          row.variantId === undefined &&
          row.spellId === undefined
      )
    : undefined;
  if (stack)
    return setInventoryItem(
      state,
      crafter.id,
      { ...stack, quantity: stack.quantity + 1 },
      resolveDefinition,
      inventoryDeps
    );
  const id = freeRowId(crafter, project.kind === "spell-scroll" ? `spell-scroll-${project.spellId}` : project.itemId);
  const row: InventoryItem = {
    id,
    name: project.kind === "spell-scroll" ? project.itemName : (record?.name ?? project.itemName),
    quantity: 1,
    equipped: false,
    attuned: false,
    ...(id !== recordId ? { recordId } : {}),
    ...(record ? { category: record.category } : {}),
    ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {}),
    ...(project.baseId !== undefined ? { baseId: project.baseId } : {}),
    ...(project.spellId !== undefined ? { spellId: project.spellId } : {})
  };
  const events = setInventoryItem(state, crafter.id, row, resolveDefinition, inventoryDeps);
  if (project.scroll) {
    // The scroll keeps its scribe's numbers, which no sheet edit can set.
    const scribed = { ...project.scroll };
    crafter.inventory = crafter.inventory.map((entry) => (entry.id === id ? { ...entry, scribed } : entry));
    events.push(...useUpScrollMaterials(crafter, project, deps));
  }
  return events;
}

/** "If the spell consumes its Material components, they are consumed only when you complete the scroll." */
function useUpScrollMaterials(crafter: Actor, project: CraftingProject, deps: CraftingDeps): EffectNarration[] {
  const spell = project.spellId ? deps.catalog.spellRecord?.(project.spellId) : undefined;
  for (const part of spell?.components.costly ?? []) {
    if (!part.consumed || part.coins) continue;
    let left = neededOf(part, 1);
    for (const row of materialRows(crafter.inventory, part)) {
      if (left <= 0) break;
      const taken = Math.min(left, row.quantity);
      left -= taken;
      crafter.inventory = crafter.inventory.flatMap((entry) =>
        entry.id !== row.id ? [entry] : entry.quantity > taken ? [{ ...entry, quantity: entry.quantity - taken }] : []
      );
    }
  }
  return [];
}

// ---- what a character can make --------------------------------------------------------------------------------------

export type CraftOffer = Readonly<{
  id: string;
  name: string;
  kind: CraftKind;
  materialsCp: number;
  days: number;
  /** A magic weapon's or armor's choice of base. */
  baseIds?: readonly string[];
}>;

export type CraftingOffers = Readonly<{
  /** The tools the character is proficient with, each with what it makes. */
  tools: ReadonlyArray<Readonly<{ toolId: string; name: string; carried: boolean; items: readonly CraftOffer[] }>>;
  /** Scribing: the spells it can put on a scroll now, with the table's days and cost; null when it can't scribe. */
  scrolls: Readonly<{
    carried: boolean;
    spells: ReadonlyArray<Readonly<{ id: string; name: string; level: number; days: number; materialsCp: number }>>;
  }> | null;
  /** Magic items it can craft with Arcana and a tool it is proficient with. */
  magicItems: readonly (CraftOffer & Readonly<{ rarity: string; toolIds: readonly string[] }>)[];
  purseCp: number;
}>;

/** Everything a character could start now, priced as `planCraft` would (a magic base's price not included). */
export function craftingOffers(actor: Actor, deps: CraftingDeps): CraftingOffers {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const proficient = toolProficiencies(definition, derivation);
  const items = deps.items();
  const index = craftIndex(items);
  const days = (minutes: number) => Math.round((minutes / WORK_DAY_MINUTES) * 10) / 10;
  const tools = proficient.flatMap((toolId) => {
    const tool = items.find((record) => record.id === toolId);
    if (!tool || tool.category !== "tool") return [];
    const made: CraftOffer[] = toolCrafts(tool, items).flatMap((record): CraftOffer[] => {
      if (record.id === POTION_OF_HEALING)
        return toolId === HERBALISM_KIT
          ? [
              {
                id: record.id,
                name: record.name,
                kind: "potion-of-healing",
                materialsCp: toCp(POTION_COST_GP),
                days: 1
              }
            ]
          : [];
      if (record.costGp === null || record.costGp <= 0) return [];
      return [
        {
          id: record.id,
          name: record.name,
          kind: "item",
          materialsCp: Math.floor(toCp(record.costGp) / 2),
          days: Math.max(1, Math.ceil(record.costGp / 10))
        }
      ];
    });
    return made.length > 0
      ? [{ toolId, name: tool.name, carried: carriedRow(actor, toolId) !== undefined, items: made }]
      : [];
  });
  const scribes = hasArcana(definition, derivation) || proficient.includes(CALLIGRAPHERS_SUPPLIES);
  const scrolls = scribes
    ? {
        carried: carriedRow(actor, CALLIGRAPHERS_SUPPLIES) !== undefined,
        spells: (definition?.spellcasting?.spells ?? []).flatMap((entry) => {
          const spell = deps.catalog.spellRecord?.(entry.id);
          if (!spell || !spellReady(actor, definition, spell.id)) return [];
          const cost = SCROLL_COSTS[spell.level]!;
          return [
            { id: spell.id, name: spell.name, level: spell.level, days: cost.days, materialsCp: toCp(cost.costGp) }
          ];
        })
      }
    : null;
  const magicItems = hasArcana(definition, derivation)
    ? items.flatMap((record) => {
        const cost = record.isMagic && record.rarity && !record.spellScroll ? MAGIC_COSTS[record.rarity] : undefined;
        if (!cost) return [];
        const baseIds = record.appliesTo?.baseIds ?? [];
        const toolIds = [
          ...new Set(
            baseIds.length > 0
              ? baseIds.flatMap((baseId) => magicToolsFor(record, baseId, index))
              : magicToolsFor(record, undefined, index)
          )
        ].filter((toolId) => proficient.includes(toolId));
        if (toolIds.length === 0) return [];
        const halved = consumable(record) ? 2 : 1;
        return [
          {
            id: record.id,
            name: record.name,
            kind: "magic-item" as const,
            rarity: record.rarity!,
            toolIds,
            materialsCp: toCp(cost.costGp / halved),
            days: days(Math.ceil((cost.days * WORK_DAY_MINUTES) / halved)),
            ...(baseIds.length > 0 ? { baseIds } : {})
          }
        ];
      })
    : [];
  return { tools, scrolls, magicItems, purseCp: purseCp(actor.currency) };
}
