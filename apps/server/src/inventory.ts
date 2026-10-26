import type { Actor, GameState } from "@vtt/domain";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, rowUsesKey, type ActorDefinition, type Currency, type InventoryItem } from "@vtt/schemas";
import { effectiveSlot, wornBodyArmor } from "@vtt/rules-5e";
import { refreshBaseArmorClass, spellSlotMaxima, storedArmorClass } from "./actor-roster.js";
import { deriveEquipment, itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { castAction, isItemActionId, itemAction } from "./item-actions.js";
import { keepAmmunitionCount } from "./ammunition.js";
import { keepLightState } from "./item-light.js";
import { endConditionsImmuneTo, endEffect, MAGE_ARMOR_TAG, type EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";
import { holdsFeature } from "./class-features.js";
import { itemRowOfAction, rollStartingCharges } from "./item-charges.js";
import { liveHitPointBonus } from "./live-abilities.js";
import { scrollSpellProblem } from "./scrolls.js";
import { endBindingsOfGoneRows } from "./bound-weapons.js";
import {
  copyKeyOf,
  rowRecord,
  rowWeaponFor,
  variantOf,
  variantPickedBy,
  withVariant,
  withWeaponChanges
} from "./item-records.js";
import { requireActorAccess, type Initiator } from "./authorization.js";
import { spendBonusAction } from "./item-light.js";
import { withVariantPick } from "./item-variants.js";
import { attunementRefusal } from "./attunement.js";
import { donInFight } from "./held-items.js";
import { nestedIn, placeInContainer, type Placement } from "./containers.js";
import { chargeHandling } from "./object-interactions.js";
import { keepDisguise, mintDisguise, shownName } from "./disguised-items.js";

const MAX_ITEMS = 200;
/** SRD: "a creature can't be attuned to more than three magic items at a time"; Use Magic Device raises it. */
const MAX_ATTUNED = 3;

/** How many of a slot may be worn at once, as the SRD lists them: "one pair of footwear, one pair of gloves or
 *  gauntlets, one pair of bracers, one suit of armor, one item of headwear, or one cloak", and one Shield. Anything
 *  unlisted is unlimited (rings, amulets, belts, robes, lenses, weapons, gear). */
const SLOT_CAPACITY: Readonly<Record<string, number>> = {
  head: 1,
  shoulders: 1,
  hands: 1,
  bracers: 1,
  feet: 1,
  armor: 1,
  shield: 1
};

/** Optional dependencies for reconciliation. Absent means riders are inert and every gate fails open. */
export type InventoryDeps = Readonly<{
  /** Resolves an item's catalog record, the only place riders live. */
  catalog?: EquipmentCatalog;
  /** Who is writing. A GM write bypasses the attunement cap and slot capacity (the audited override). */
  role?: "gm" | "player";
  /** The spells this writer may put on a scroll: a player's own catalog, so a GM-only spell can't be probed for.
   *  Absent: the catalog's. */
  pickableSpell?: (id: string) => SpellReference | undefined;
  /** The server's dice, for the charges a copy holds when it is added (a Necklace of Fireballs' 1d6 + 3 beads). */
  random?: (sides: number) => number;
}>;

/** Reconciles equipment onto the actor after an inventory write, recomputed whole so unequipping needs no
 *  undo. Only stored live state is written: `armorClass` (the resolver reads a target's stored AC) and
 *  `spellSlots` (item slots arrive full; removal clamps `remaining`). */
export function reconcileEquipment(
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: InventoryDeps = {}
): void {
  if (!definition) return;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  actor.armorClass = storedArmorClass(actor, definition, deps.catalog);
  refreshBaseArmorClass(actor, definition, deps.catalog);

  if (actor.spellSlots && definition.spellcasting) {
    const maxByLevel = new Map(
      spellSlotMaxima(definition, derivation.spellSlots).map((entry) => [entry.level, entry.max] as const)
    );
    const seen = new Set(actor.spellSlots.map((slot) => slot.level));
    // An item-added slot arrives full; removing the item clamps `remaining` back down.
    actor.spellSlots = [
      ...actor.spellSlots.map((slot) => {
        const max = maxByLevel.get(slot.level);
        if (max === undefined) return slot;
        const previous = maxOf(definition, slot.level);
        return {
          ...slot,
          remaining: Math.min(max, max > previous ? slot.remaining + (max - previous) : slot.remaining)
        };
      }),
      ...[...maxByLevel].filter(([level]) => !seen.has(level)).map(([level, max]) => ({ level, remaining: max }))
    ].sort((a, b) => a.level - b.level);
  }
}

const maxOf = (definition: ActorDefinition, level: number) =>
  spellSlotMaxima(definition).find((entry) => entry.level === level)?.max ?? 0;

/** Whether an attuned row takes one of the bearer's attunement slots: a catalog item only when it needs attunement (a
 *  mundane dagger marked attuned takes none); a row the catalog doesn't know always does. */
function needsAttunement(item: InventoryItem, deps: InventoryDeps): boolean {
  const record = deps.catalog?.equipmentRecord(catalogIdOf(item));
  return record ? record.attunement?.required === true : true;
}

/** How many magic items the bearer may attune at once: three, plus any `attunement-slots` rider (Use Magic Device). */
export function attunementLimit(actor: Actor, definition: ActorDefinition | undefined, deps: InventoryDeps): number {
  return MAX_ATTUNED + deriveEquipment(actor, definition, deps.catalog).attunementSlots;
}

/** SRD attunement limit and slot capacity; a GM write bypasses both. Items with no record may still attune
 *  (counted when their marker needs it) but get no slot. */
function enforceEquipRules(
  actor: Actor,
  incoming: InventoryItem,
  definition: ActorDefinition | undefined,
  deps: InventoryDeps
): void {
  if (deps.role === "gm") return;
  const others = actor.inventory.filter((entry) => entry.id !== incoming.id);
  if (incoming.attuned && incoming.quantity > 0 && needsAttunement(incoming, deps)) {
    // SRD Attunement: "You can't attune to more than one copy of an item."
    const record = deps.catalog?.equipmentRecord(catalogIdOf(incoming));
    const copy = others.find((entry) => entry.attuned && copyKeyOf(record, entry) === copyKeyOf(record, incoming));
    if (copy && record)
      throw new CommandRejectedError(
        `${actor.name} is already attuned to a ${copy.name}. A creature can't attune to more than one copy of an item.`
      );
    const attuned = others.filter((entry) => entry.attuned && needsAttunement(entry, deps));
    const limit = attunementLimit(actor, definition, deps);
    if (attuned.length >= limit) {
      throw new CommandRejectedError(
        `Already attuned to ${limit} items (${attuned
          .slice(0, limit)
          .map((entry) => entry.name)
          .join(", ")}). Break one first.`
      );
    }
  }
  if (!incoming.equipped || incoming.quantity <= 0 || !deps.catalog) return;
  const slot = effectiveSlot({
    slot: deps.catalog.equipmentRecord(catalogIdOf(incoming))?.slot ?? incoming.magic?.slot,
    category: incoming.category
  });
  const capacity = SLOT_CAPACITY[slot];
  if (capacity === undefined) return;
  const worn = others.filter(
    (entry) =>
      entry.equipped &&
      entry.quantity > 0 &&
      effectiveSlot({
        slot: deps.catalog!.equipmentRecord(catalogIdOf(entry))?.slot ?? entry.magic?.slot,
        category: entry.category
      }) === slot
  );
  if (worn.length >= capacity) {
    throw new CommandRejectedError(
      capacity === 1
        ? `${worn[0].name} already occupies the ${slot} slot. Take it off first.`
        : `Only ${capacity} ${slot} items can be worn at once.`
    );
  }
}

/**
 * "The GM chooses the type" (Ring of Resistance): only the GM picks, and only from the record's choices. Any other
 * write keeps the stored pick, so a sheet that never saw it cannot clear or change it.
 */
function withDamageTypeChoice(actor: Actor, item: InventoryItem, deps: InventoryDeps): InventoryItem {
  if (deps.role !== "gm") {
    const stored = actor.inventory.find((entry) => entry.id === item.id)?.chosenDamageType;
    const { chosenDamageType: _sent, ...rest } = item;
    return stored ? { ...rest, chosenDamageType: stored } : rest;
  }
  if (item.chosenDamageType === undefined) return item;
  const choices = deps.catalog?.equipmentRecord(catalogIdOf(item))?.damageTypeChoice;
  if (!choices) throw new CommandRejectedError(`${item.name} has no damage type to choose.`);
  if (!choices.includes(item.chosenDamageType))
    throw new CommandRejectedError(`${item.name} can resist ${choices.join(", ")}.`);
  return item;
}

/**
 * A Spell Scroll bears one spell (`spellId`), checked against the catalog and the levels the scroll holds. An omitted
 * pick keeps the stored one, only the GM may change a pick once made, a row the bearer's catalog no longer knows
 * keeps its stored pick, and a row of anything else carries none. Unpicked, a scroll stays legal and casts nothing.
 */
function withScrollSpell(item: InventoryItem, deps: InventoryDeps, stored?: InventoryItem): InventoryItem {
  if (!deps.catalog) return item;
  const record = deps.catalog.equipmentRecord(catalogIdOf(item));
  const { spellId: sent, ...rest } = item;
  if (!record?.spellScroll) return rest;
  const spellId = sent ?? stored?.spellId;
  if (spellId === undefined) return rest;
  if (spellId === stored?.spellId) return { ...rest, spellId };
  if (deps.role !== "gm" && stored?.spellId !== undefined)
    throw new CommandRejectedError(`${item.name} already bears a spell. Only the GM can change it.`);
  const lookup = deps.role !== "gm" && deps.pickableSpell ? deps.pickableSpell : deps.catalog.spellRecord;
  const spell = lookup?.(spellId);
  if (!spell) throw new CommandRejectedError(`There is no spell "${spellId}" to put on ${item.name}.`);
  const problem = scrollSpellProblem(record, spell, item.name);
  if (problem) throw new CommandRejectedError(problem);
  return { ...rest, spellId };
}

/** Once attuned, a cursed item can't be unattuned, unequipped or deleted by a player; a GM can ("remove curse"). */
function enforceCurse(actor: Actor, incoming: InventoryItem, deps: InventoryDeps): void {
  if (deps.role === "gm" || !deps.catalog) return;
  const existing = actor.inventory.find((entry) => entry.id === incoming.id);
  if (!existing?.attuned || deps.catalog.equipmentRecord(catalogIdOf(incoming))?.cursed !== true) return;
  const releasing = incoming.quantity <= 0 || !incoming.attuned || !incoming.equipped;
  if (releasing) throw new CommandRejectedError(`${existing.name} will not come off. Ask the GM.`);
}

/**
 * Binds a template magic item (a record with `appliesTo`) to the base the player picked, server-side:
 *   - a `baseId` outside the resolved list is refused; a single-base template auto-binds;
 *   - base stats are copied from the catalog on every write; client `weapon`/`armor` is never trusted;
 *   - an unbound choice template stays legal but derives nothing;
 *   - a non-template row's `baseId` is stripped (it would self-grant proficiency and mastery);
 *   - an omitted `baseId` inherits the stored pick; only the GM may change an existing pick (an in-place
 *     swap would bypass `enforceCurse`);
 *   - a stale pick on an already-bound row fails open and keeps its stored stats.
 */
export function bindTemplateItem(item: InventoryItem, deps: InventoryDeps, stored?: InventoryItem): InventoryItem {
  return withMagicMarker(bindTemplateStats(item, deps, stored), deps);
}

/** The sheet's Attune control reads the row's marker, so a catalog magic item gets one from its record; a mundane
 *  record clears any marker. Only what the item's printed type line already says (magic, needs attunement, where it
 *  is worn), never a rider. A row the catalog doesn't know keeps what it was sent. */
/** Stamps the catalog's magic marker on every carried row, for rows stored before the marker existed or whose
 *  record changed since, so the sheet's Attune control reads the record. True when any row changed. */
export function reconcileMagicMarkers(state: GameState, catalog: EquipmentCatalog): boolean {
  let changed = false;
  for (const actor of state.actors) {
    const rows = actor.inventory.map((item) => {
      const next = withMagicMarker(item, { catalog });
      const same =
        next.magic?.isMagic === item.magic?.isMagic &&
        next.magic?.attunementRequired === item.magic?.attunementRequired &&
        next.magic?.slot === item.magic?.slot;
      return same ? item : next;
    });
    if (rows.some((row, index) => row !== actor.inventory[index])) {
      actor.inventory = rows;
      changed = true;
    }
  }
  return changed;
}

function withMagicMarker(item: InventoryItem, deps: InventoryDeps): InventoryItem {
  const record = deps.catalog?.equipmentRecord(catalogIdOf(item));
  if (!record) return item;
  const { magic: _sent, ...rest } = item;
  const attunementRequired = record.attunement?.required === true;
  if (!record.isMagic && !attunementRequired) return rest;
  return {
    ...rest,
    magic: { isMagic: record.isMagic, attunementRequired, ...(record.slot ? { slot: record.slot } : {}) }
  };
}

function bindTemplateStats(item: InventoryItem, deps: InventoryDeps, stored?: InventoryItem): InventoryItem {
  // The copy's kind or form can change how it swings (a Rod of Lordly Might's battleaxe).
  const printed = deps.catalog?.equipmentRecord(catalogIdOf(item));
  const record = printed ? withVariant(printed, item) : undefined;
  const appliesTo = record?.appliesTo;
  if (!record || !appliesTo) {
    // A non-template row never carries a baseId (it would self-grant proficiency and mastery). Its stats
    // come from the catalog; only a GM may give stats to an item the catalog does not know.
    const { baseId: _forged, weapon, armor, ...rest } = item;
    if (!record) {
      const trusted = deps.role === "gm" || deps.catalog === undefined;
      return trusted ? { ...rest, ...(weapon ? { weapon } : {}), ...(armor ? { armor } : {}) } : rest;
    }
    const catalogWeapon = weaponStatsFrom(record.weapon);
    const catalogArmor = armorStatsFrom(record.armor);
    return {
      ...rest,
      ...(catalogWeapon ? { weapon: catalogWeapon } : {}),
      ...(catalogArmor ? { armor: catalogArmor } : {})
    };
  }
  const baseId = item.baseId ?? stored?.baseId ?? (appliesTo.baseIds.length === 1 ? appliesTo.baseIds[0] : undefined);
  if (baseId === undefined) {
    const { weapon: _weapon, armor: _armor, ...unbound } = item;
    return unbound;
  }
  if (deps.role !== "gm" && stored?.baseId !== undefined && baseId !== stored.baseId) {
    throw new CommandRejectedError(`${item.name} is already bound. Remove it and add it again to change what it is.`);
  }
  const base = deps.catalog?.equipmentRecord(baseId);
  // Magic ammunition is a piece of one kind (an arrow, a bolt): the pick says which launchers fire it, and it has no
  // weapon stats to copy.
  if (record.category === "ammunition") {
    const { weapon: _weapon, armor: _armor, ...bare } = item;
    if (appliesTo.baseIds.includes(baseId) && base?.ammunition !== undefined) return { ...bare, baseId };
    if (stored?.baseId === baseId) return { ...bare, baseId };
    throw new CommandRejectedError(
      `${item.name} applies to ${appliesTo.label}, and "${baseId}" is not one of the kinds it can be.`
    );
  }
  const stats = record.category === "weapon" ? base?.weapon : base?.armor;
  const shieldBase = record.category !== "weapon" && base?.category === "shield";
  const invalid =
    !appliesTo.baseIds.includes(baseId) ||
    shieldBase ||
    (record.category === "weapon"
      ? !(base?.weapon?.damageDice && base.weapon.damageType && base.weapon.category)
      : !stats);
  if (invalid) {
    // Stale-pick fail-open: keep the stored pick and copied stats, and let the write through.
    if (stored?.baseId === baseId && (stored.weapon !== undefined || stored.armor !== undefined)) {
      const { weapon: _clientWeapon, armor: _clientArmor, ...bare } = item;
      return {
        ...bare,
        baseId,
        ...(stored.weapon !== undefined ? { weapon: { ...stored.weapon } } : {}),
        ...(stored.armor !== undefined ? { armor: { ...stored.armor } } : {})
      };
    }
    if (!appliesTo.baseIds.includes(baseId))
      throw new CommandRejectedError(
        `${item.name} applies to ${appliesTo.label}, and "${baseId}" is not one of its printed bases.`
      );
    if (shieldBase)
      throw new CommandRejectedError(
        `"${baseId}" is a shield, and a shield cannot be a template's base: its armor block carries a +2 bonus where a body armor carries its AC.`
      );
    throw new CommandRejectedError(
      `The catalog has no ${record.category === "weapon" ? "weapon" : "armor"} stats for "${baseId}", so ${item.name} cannot be bound to it.`
    );
  }
  const { weapon: _clientWeapon, armor: _clientArmor, ...bare } = item;
  if (record.category !== "weapon")
    return { ...bare, baseId, armor: withoutDrawbacks(armorStatsFrom(base!.armor)!, record) };
  // A form with no weapon leaves the row none; one with its own block swings as that.
  const form = variantOf(printed, item);
  if (form?.weapon === null) return { ...bare, baseId };
  const formed = form?.weapon ? weaponStatsFrom(form.weapon) : undefined;
  return { ...bare, baseId, weapon: formed ?? withWeaponChanges(weaponStatsFrom(base!.weapon)!, record.weaponChanges) };
}

type CatalogRecord = NonNullable<ReturnType<NonNullable<InventoryDeps["catalog"]>["equipmentRecord"]>>;

/** An inventory row's weapon block from a catalog record, or undefined when the record has no usable one. */
function weaponStatsFrom(stats: CatalogRecord["weapon"]): InventoryItem["weapon"] {
  if (!stats?.damageDice || !stats.damageType || !stats.category) return undefined;
  return {
    category: stats.category === "martial" ? "martial" : "simple",
    damageDice: stats.damageDice,
    damageType: stats.damageType,
    rangeFeet: stats.rangeFeet ?? null,
    longRangeFeet: stats.longRangeFeet ?? null,
    ...(stats.melee !== undefined ? { melee: stats.melee } : {}),
    ...(stats.versatileDice !== undefined ? { versatileDice: stats.versatileDice } : {}),
    ...(stats.properties !== undefined ? { properties: [...stats.properties] } : {})
  };
}

/** Mithral armor has no Stealth Disadvantage and no Strength requirement, whatever its base prints. */
function withoutDrawbacks(armor: NonNullable<InventoryItem["armor"]>, record: CatalogRecord): InventoryItem["armor"] {
  return record.removesArmorDrawbacks ? { ...armor, stealthDisadvantage: false, strengthRequired: null } : armor;
}

function armorStatsFrom(stats: CatalogRecord["armor"]): InventoryItem["armor"] {
  if (!stats) return undefined;
  return {
    acBase: stats.acBase,
    addDexModifier: stats.addDexModifier,
    dexModifierCap: stats.dexModifierCap,
    stealthDisadvantage: stats.stealthDisadvantage,
    strengthRequired: stats.strengthRequired
  };
}

/** Upserts one inventory item by id; quantity 0 removes it. Owner-scoped by the caller. Re-derives the
 *  equipment contribution (AC, slot maxima) from the resulting loadout. */
/** A studied book's spent magic is the server's record: an edit keeps it as stored and can't set it. */
function keepDormant(stored: InventoryItem | undefined, item: InventoryItem): InventoryItem {
  const { dormant: _sent, ...rest } = item;
  return stored?.dormant ? { ...rest, dormant: true } : rest;
}

/** What only a cast writes on a row: Identify's mark and the spells a Ring of Spell Storing holds. A sheet write keeps
 *  the stored ones and can't add any. */
function keepCastMarks(stored: InventoryItem | undefined, item: InventoryItem): InventoryItem {
  const { identified: _identified, storedCasts: _casts, ...rest } = item;
  return {
    ...rest,
    ...(stored?.identified ? { identified: true as const } : {}),
    ...(stored?.storedCasts ? { storedCasts: structuredClone(stored.storedCasts) } : {})
  };
}

/** A scribed scroll's numbers are the server's record (`crafting.ts`): an edit keeps them as stored and can't set
 *  them. */
function keepScribed(stored: InventoryItem | undefined, item: InventoryItem): InventoryItem {
  const { scribed: _sent, ...rest } = item;
  return stored?.scribed ? { ...rest, scribed: { ...stored.scribed } } : rest;
}

/** The penalty acid or rust left on a row is the server's record (`row-penalties.ts`): an edit keeps it as stored, and
 *  only Mending removes it. */
function keepPenalty(stored: InventoryItem | undefined, item: InventoryItem): InventoryItem {
  const { penalty: _sent, ...rest } = item;
  return stored?.penalty !== undefined ? { ...rest, penalty: stored.penalty } : rest;
}

/** SRD Ephemeral (a will-o'-wisp): "The wisp can't wear or carry anything." */
function refuseToCarry(actor: Actor, definition: ActorDefinition | undefined): void {
  if (holdsFeature(definition, "ephemeral", "Ephemeral"))
    throw new CommandRejectedError(`${actor.name} can't wear or carry anything.`);
}

export function setInventoryItem(
  state: GameState,
  actorId: string,
  item: InventoryItem,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  deps: InventoryDeps = {}
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (item.quantity > 0 && !actor.inventory.some((entry) => entry.id === item.id))
    refuseToCarry(actor, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined);
  // A row naming itself as its own record is the plain form.
  if (item.recordId === item.id) {
    const { recordId: _same, ...plain } = item;
    item = plain;
  }
  // A copy that passes for another item takes that item's id as it arrives, and keeps its record and disguise after.
  if (item.quantity > 0 && !actor.inventory.some((entry) => entry.id === item.id))
    item = mintDisguise(item, new Set(actor.inventory.map((entry) => entry.id)), deps.catalog);
  item = keepDisguise(
    actor.inventory.find((entry) => entry.id === item.id),
    item,
    deps.role
  );
  // A pack added to the sheet is the things it holds, each joining its stack or starting one.
  const contents = deps.catalog?.equipmentRecord(catalogIdOf(item))?.contents;
  if (contents && item.quantity > 0 && !actor.inventory.some((entry) => entry.id === item.id))
    return contents.flatMap((content) => {
      const record = deps.catalog!.equipmentRecord(content.id);
      const stack = actor.inventory.find((entry) => entry.id === content.id);
      const quantity = content.quantity * item.quantity;
      const row: InventoryItem = stack
        ? { ...stack, quantity: stack.quantity + quantity }
        : {
            id: content.id,
            name: record?.name ?? content.id,
            quantity,
            equipped: false,
            attuned: false,
            ...(record ? { category: record.category } : {}),
            ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {})
          };
      return setInventoryItem(state, actorId, row, resolveDefinition, deps);
    });
  // What the item is (a found copy's kind, which the GM says) is read before it binds, since a form can change how it
  // swings.
  item = withVariantPick(actor, item, deps);
  // A removal never binds, so a row whose base left the catalog can still be removed.
  if (item.quantity > 0)
    item = bindTemplateItem(
      item,
      deps,
      actor.inventory.find((entry) => entry.id === item.id)
    );
  item = withDamageTypeChoice(actor, item, deps);
  if (item.quantity > 0)
    item = withScrollSpell(
      item,
      deps,
      actor.inventory.find((entry) => entry.id === item.id)
    );
  item = keepAmmunitionCount(
    actor.inventory.find((entry) => entry.id === item.id),
    item,
    deps.catalog
  );
  item = keepDormant(
    actor.inventory.find((entry) => entry.id === item.id),
    item
  );
  item = keepCastMarks(
    actor.inventory.find((entry) => entry.id === item.id),
    item
  );
  item = keepScribed(
    actor.inventory.find((entry) => entry.id === item.id),
    item
  );
  item = keepPenalty(
    actor.inventory.find((entry) => entry.id === item.id),
    item
  );
  // Whether a light burns is the server's: lit with item.set-light, put out by stowing it.
  item = keepLightState(
    actor.inventory.find((entry) => entry.id === item.id),
    item,
    state.rest.clockHours
  );
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  // Where it sits: loose, or in a container that holds it.
  const placement = placeInContainer(
    actor,
    item,
    actor.inventory.find((entry) => entry.id === item.id),
    deps.catalog,
    deps.role
  );
  item = placement.item;
  enforceCurse(actor, item, deps);
  enforceEquipRules(actor, item, definition, deps);
  // Armor goes on and comes off on the clock: body armor not at all in a fight, a Shield with the Utilize action.
  donInFight(
    state,
    actor,
    actor.inventory.find((entry) => entry.id === item.id),
    item,
    deps.catalog?.equipmentRecord(catalogIdOf(item))?.slot ?? item.magic?.slot,
    deps.role
  );
  // Drawing a weapon, or taking a thing out of a container, is an object interaction in a fight.
  chargeHandling(
    state,
    actor,
    actor.inventory.find((entry) => entry.id === item.id),
    item,
    deps.role,
    deps.catalog,
    definition
  );
  // When attunement may start or end is a player's rule; the GM attunes anyone at any time.
  if (deps.role === "player") {
    const refusal = attunementRefusal(
      state,
      actor,
      item,
      actor.inventory.find((entry) => entry.id === item.id),
      definition,
      deps.catalog?.equipmentRecord(catalogIdOf(item))
    );
    if (refusal) throw new CommandRejectedError(refusal);
  }
  // What a worn item does to Constitution moves the Hit Point maximum; measured before and after the write.
  const hitPointsBefore = definition ? liveHitPointBonus(actor, definition, deps.catalog) : 0;
  const before = actor.inventory.find((entry) => entry.id === item.id);
  if (item.quantity <= 0) {
    // The charges a row spent leave with it, so a new copy under the same id starts full.
    const removed = actor.inventory.find((entry) => entry.id === item.id);
    const spentKeys = removed ? chargeKeysOf(removed, definition, deps) : [];
    if (spentKeys.length > 0)
      actor.actionUses = Object.fromEntries(
        Object.entries(actor.actionUses).filter(([key]) => !spentKeys.includes(key))
      );
    // What it held spills out, loose.
    actor.inventory = actor.inventory
      .filter((entry) => entry.id !== item.id)
      .map((entry) => (entry.containerId === item.id ? looseRow(entry) : entry));
  } else {
    const index = actor.inventory.findIndex((entry) => entry.id === item.id);
    if (index >= 0)
      actor.inventory = actor.inventory.map((entry, position) => (position === index ? { ...item } : entry));
    else {
      if (actor.inventory.length >= MAX_ITEMS)
        throw new CommandRejectedError("This character's pack is full. Remove something first.");
      actor.inventory = [...actor.inventory, { ...item }];
      // A new copy holds the charges its record rolls for it, which never come back.
      if (deps.random) rollStartingCharges(actor, item, definition, deps.catalog, deps.random);
    }
  }
  const destroyed = destroyRows(state, actor, placement);
  reconcileEquipment(actor, definition, deps);
  if (definition) moveHitPointMaximum(actor, liveHitPointBonus(actor, definition, deps.catalog) - hitPointsBefore);
  return [
    ...destroyed,
    ...immuneConditionsEnd(actor, definition, deps),
    ...donningEndsMageArmor(state, actor),
    ...endBindingsOfGoneRows(state, actor),
    ...(before ? endGrantsOfPutAway(state, actor, before, deps) : [])
  ];
}

/** A row taken out of a container that is gone. */
function looseRow(row: InventoryItem): InventoryItem {
  const { containerId: _container, compartment: _compartment, ...loose } = row;
  return loose;
}

/** What a write destroyed (an overloaded Bag of Holding, two extradimensional spaces): those rows and all they held
 *  leave the pack. */
function destroyRows(state: GameState, actor: Actor, placement: Placement): EffectNarration[] {
  if (placement.destroys.length === 0) return [];
  const gone = new Set(placement.destroys.flatMap((id) => [id, ...nestedIn(actor.inventory, id).map((row) => row.id)]));
  actor.inventory = actor.inventory.filter((row) => !gone.has(row.id));
  return [
    { kind: "effect" as const, text: placement.why ?? "", actorId: actor.id },
    ...endBindingsOfGoneRows(state, actor)
  ].filter((event) => event.text !== "");
}

/** A Hit Point maximum that a changed Constitution raises or lowers: current Hit Points move with a gain, and stay
 *  within the maximum after a loss. */
function moveHitPointMaximum(actor: Actor, change: number): void {
  if (change === 0) return;
  const maximum = Math.max(1, actor.hp.maximum + change);
  const current = change > 0 && actor.hp.current > 0 ? actor.hp.current + change : actor.hp.current;
  actor.hp = { ...actor.hp, maximum, current: Math.min(maximum, current) };
}

/**
 * What a worn item's own action gave its user ends once the item is no longer worn (Cloak of Invisibility: "The effect
 * ends early if you ... cease wearing the cloak"; a Ring of Invisibility's until "you remove the ring"): taken off,
 * unattuned or put away. A potion or flask, used up by its use, leaves what it gave, and so does a spell the item cast.
 */
function endGrantsOfPutAway(
  state: GameState,
  actor: Actor,
  before: InventoryItem,
  deps: InventoryDeps
): EffectNarration[] {
  const record = rowRecord(deps.catalog, before);
  if (!record || record.consumedOnUse) return [];
  const now = actor.inventory.find((entry) => entry.id === before.id);
  // What a Dragon Orb's peering leaves lasts "for as long as you remain attuned to it", held or not.
  const lasting = record.attunementHeldBy
    ? (row: InventoryItem | undefined) => row !== undefined && row.quantity > 0 && row.attuned
    : (row: InventoryItem | undefined) => row !== undefined && itemIsActive(row, rowRecord(deps.catalog, row));
  if (!lasting(before) || lasting(now)) return [];
  // A spell cast from it ends with it only where the item says so (a Hat of Disguise's Disguise Self).
  const endsWith = new Set((record.casts ?? []).filter((cast) => cast.endsWithItem).map((cast) => cast.spellId));
  const gone = actor.effects.filter(
    (effect) =>
      effect.sourceActorId === actor.id &&
      (effect.spell === undefined || endsWith.has(effect.spell.id)) &&
      effect.sourceActionId !== null &&
      isItemActionId(effect.sourceActionId) &&
      itemRowOfAction(effect.sourceActionId, [before, ...actor.inventory])?.id === before.id
  );
  return gone.flatMap((effect) => endEffect(state, actor.id, effect.id));
}

/** SRD Immunity: an item that now makes its bearer immune to a condition (a Periapt of Proof against Poison put on)
 *  ends the one it has. */
function immuneConditionsEnd(
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: InventoryDeps
): EffectNarration[] {
  if (!definition || !deps.catalog) return [];
  const immunities = deriveEquipment(actor, definition, deps.catalog).conditionImmunities;
  return immunities.flatMap((entry) => endConditionsImmuneTo(actor, [entry.id], entry.source));
}

/** SRD Remove Curse: "If the object is a cursed magic item, its curse remains, but the spell breaks its owner's
 *  Attunement to the object so it can be removed or discarded." Each cursed item the creature is attuned to loses the
 *  Attunement (the curse stays on the item); the names of those items. */
export function breakCursedAttunement(
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: InventoryDeps,
  only?: Readonly<{ rowId?: string }>
): string[] {
  const all = actor.inventory.filter(
    (row) => row.attuned === true && deps.catalog?.equipmentRecord(catalogIdOf(row))?.cursed === true
  );
  // One curse (Greater Restoration): the row named, else the first.
  const cursed = only ? all.filter((row) => row.id === (only.rowId ?? all[0]?.id)).slice(0, 1) : all;
  if (cursed.length === 0) return [];
  actor.inventory = actor.inventory.map((row) => (cursed.includes(row) ? { ...row, attuned: false } : row));
  reconcileEquipment(actor, definition, deps);
  return cursed.map((row) => row.name);
}

/** SRD Mage Armor: "The spell ends early if the target dons armor." A Shield is no armor here: it still adds to it. */
function donningEndsMageArmor(state: GameState, actor: Actor): EffectNarration[] {
  if (!wornBodyArmor(actor.inventory)) return [];
  return actor.effects
    .filter((effect) => effect.tags.includes(MAGE_ARMOR_TAG))
    .flatMap((effect) => endEffect(state, actor.id, effect.id));
}

/** The charge pools a row's own actions and casts count in, in the record's order, whether or not the row is worn. */
function chargeKeysOf(item: InventoryItem, definition: ActorDefinition | undefined, deps: InventoryDeps): string[] {
  const record = rowRecord(deps.catalog, item);
  if (!record) return [];
  const actions = [
    ...record.actions.map((declared) => itemAction(item, declared, definition)),
    ...record.casts.map((cast) => castAction(item, cast, item.name, definition, undefined))
  ];
  const keys = actions.flatMap((action) =>
    action.uses && action.uses.per !== "turn" ? [action.uses.pool ?? action.id] : []
  );
  if (record.uses) keys.push(rowUsesKey(item));
  return keys.filter((key, index) => keys.indexOf(key) === index);
}

/**
 * Hands one carried row, whole, from one character to another (the GM's "pass me the wand"): it arrives
 * unequipped and unattuned, under a free row id, and the charges it has spent go with it, since they belong to the
 * item and not to whoever held it.
 */
export function giveItem(
  state: GameState,
  fromActorId: string,
  toActorId: string,
  itemId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  deps: InventoryDeps = {}
): Readonly<{ name: string }> {
  const from = state.actors.find((candidate) => candidate.id === fromActorId);
  const to = state.actors.find((candidate) => candidate.id === toActorId);
  if (!from || !to) throw new CommandRejectedError("That combatant no longer exists.");
  if (from.id === to.id) throw new CommandRejectedError("Choose another character to give it to.");
  refuseToCarry(to, to.definitionId ? resolveDefinition(to.definitionId) : undefined);
  const row = from.inventory.find((entry) => entry.id === itemId);
  if (!row) throw new CommandRejectedError("That item is no longer in the pack.");
  if (to.inventory.length >= MAX_ITEMS)
    throw new CommandRejectedError(`${to.name}'s pack is full. Remove something first.`);
  const catalogId = catalogIdOf(row);
  const taken = new Set(to.inventory.map((entry) => entry.id));
  // A disguised copy's id comes from the item it passes for, so the new holder's row doesn't name it either.
  const base = row.disguisedAs ?? catalogId;
  let id = base;
  for (let copy = 2; taken.has(id); copy += 1) id = `${base.slice(0, 76)}-${copy}`;
  const { recordId: _recordId, ...plain } = row;
  const moved: InventoryItem = {
    ...plain,
    id,
    ...(id !== catalogId ? { recordId: catalogId } : {}),
    equipped: false,
    attuned: false
  };
  const fromDefinition = from.definitionId ? resolveDefinition(from.definitionId) : undefined;
  const toDefinition = to.definitionId ? resolveDefinition(to.definitionId) : undefined;
  const oldKeys = chargeKeysOf(row, fromDefinition, deps);
  const newKeys = chargeKeysOf(moved, toDefinition, deps);
  const fromUses = { ...from.actionUses };
  const toUses = { ...to.actionUses };
  oldKeys.forEach((key, index) => {
    const spent = fromUses[key];
    delete fromUses[key];
    if (spent !== undefined && newKeys[index] !== undefined) toUses[newKeys[index]] = spent;
  });
  from.actionUses = fromUses;
  to.actionUses = toUses;
  from.inventory = from.inventory.filter((entry) => entry.id !== itemId);
  to.inventory = [...to.inventory, moved];
  reconcileEquipment(from, fromDefinition, deps);
  reconcileEquipment(to, toDefinition, deps);
  endBindingsOfGoneRows(state, from);
  // What the item gave its old holder ends as it leaves them.
  endGrantsOfPutAway(state, from, row, deps);
  return { name: shownName(row, deps.catalog) };
}

/** Set the whole coin purse. Owner-scoped by the caller. */
export function setCurrency(state: GameState, actorId: string, currency: Currency): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.currency = { ...currency };
}

export { itemIsActive };

export type ItemFormChange = Readonly<{ actorId: string; itemId: string; variantId: string | null }>;

/** A form that lasts until its holder's next turn starts (a Defender's bonus moved to AC) returns to the item's own as
 *  that turn starts, for its holder to pick again with its first attack. */
export function formsLapseAtTurnStart(
  state: GameState,
  actorId: string,
  catalog: EquipmentCatalog,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const lapsed = actor.inventory.filter(
    (row) =>
      row.variantId !== undefined && catalog.equipmentRecord(catalogIdOf(row))?.variantChoice?.untilTurnStart === true
  );
  if (lapsed.length === 0) return [];
  actor.inventory = actor.inventory.map((row) => {
    if (!lapsed.includes(row)) return row;
    const { variantId: _form, weapon: _weapon, ...own } = row;
    const weapon = rowWeaponFor(catalog, catalog.equipmentRecord(catalogIdOf(row))!, own);
    return weapon ? { ...own, weapon } : own;
  });
  reconcileEquipment(actor, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined, { catalog });
  return lapsed.map((row) => ({
    kind: "effect" as const,
    text: `${actor.name}'s ${row.name} returns to its own form.`,
    actorId
  }));
}

/** Its holder puts the item in another form (a Rod of Lordly Might's button, a Quarterstaff of the Acrobat turned into
 *  a pole), or back in its own with null, spending what the record says it costs. Returns the table's sentence. */
export function setItemForm(
  state: GameState,
  change: ItemFormChange,
  initiator: Initiator,
  catalog: EquipmentCatalog,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): string {
  requireActorAccess(initiator, state, change.actorId, "inventory");
  const actor = state.actors.find((candidate) => candidate.id === change.actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const row = actor.inventory.find((entry) => entry.id === change.itemId && entry.quantity > 0);
  if (!row) throw new CommandRejectedError("That item isn't carried.");
  const record = catalog.equipmentRecord(catalogIdOf(row));
  if (!record?.variants || variantPickedBy(record) !== "holder")
    throw new CommandRejectedError(`${row.name} has no forms its holder can change.`);
  if (!row.equipped) throw new CommandRejectedError(`${actor.name} must hold ${row.name} to change its form.`);
  const variant =
    change.variantId === null ? null : record.variants.find((candidate) => candidate.id === change.variantId);
  if (variant === undefined) throw new CommandRejectedError(`${row.name} has no form "${change.variantId}".`);
  if ((row.variantId ?? null) === (variant?.id ?? null))
    throw new CommandRejectedError(`${row.name} is already in that form.`);
  // A Defender's split is made with the first attack of its wielder's turn and holds until its next turn starts.
  if (
    record.variantChoice?.untilTurnStart &&
    state.combat.active &&
    state.combat.initiative.some((entry) => entry.actorId === actor.id)
  ) {
    if (state.combat.turnActorId !== actor.id)
      throw new CommandRejectedError(`${actor.name} changes ${row.name}'s form only on its own turn.`);
    if (state.combat.turn.attackRolled === true)
      throw new CommandRejectedError(
        `${actor.name} has attacked this turn, so ${row.name} keeps its form until the start of its next turn.`
      );
  }
  if (record.variantChoice?.activation === "bonus-action")
    spendBonusAction(state, actor, initiator, `Change the form of ${row.name}`);
  const { variantId: _old, weapon: _weapon, ...rest } = row;
  const formed: InventoryItem = variant ? { ...rest, variantId: variant.id } : rest;
  // The form's weapon block, or none, replaces the row's; the item's own comes back with its own form.
  const weapon = rowWeaponFor(catalog, record, formed);
  const next: InventoryItem = weapon ? { ...formed, weapon } : formed;
  actor.inventory = actor.inventory.map((entry) => (entry.id === row.id ? next : entry));
  // A form can move the bearer's Armor Class (a Defender's bonus moved to AC).
  reconcileEquipment(actor, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined, { catalog });
  return `${actor.name} turns ${row.name} into ${variant ? variant.name : "its own form"}.`;
}
