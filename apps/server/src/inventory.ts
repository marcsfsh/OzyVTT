import type { Actor, GameState } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition, type Currency, type InventoryItem } from "@vtt/schemas";
import { effectiveSlot } from "@vtt/rules-5e";
import { spellSlotMaxima, storedArmorClass } from "./actor-roster.js";
import { deriveEquipment, itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { castAction, itemAction } from "./item-actions.js";
import { CommandRejectedError } from "./game-store.js";

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
    const attuned = others.filter((entry) => entry.attuned && needsAttunement(entry, deps));
    const limit = attunementLimit(actor, definition, deps);
    if (attuned.length >= limit) {
      throw new CommandRejectedError(
        `Already attuned to ${limit} items (${attuned
          .slice(0, limit)
          .map((entry) => entry.name)
          .join(", ")}) - break one first.`
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
        ? `${worn[0].name} already occupies the ${slot} slot - take it off first.`
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
 *   - a stale pick on an already-bound row fails open, keeping its stored stats.
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
  const record = deps.catalog?.equipmentRecord(catalogIdOf(item));
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
    throw new CommandRejectedError(`${item.name} is already bound - remove it and add it again to change what it is.`);
  }
  const base = deps.catalog?.equipmentRecord(baseId);
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
        `${item.name} applies to ${appliesTo.label} - "${baseId}" is not one of its printed bases.`
      );
    if (shieldBase)
      throw new CommandRejectedError(
        `"${baseId}" is a shield, and a shield cannot be a template's base - its armor block carries its +2 bonus, not a body AC.`
      );
    throw new CommandRejectedError(
      `The catalog has no ${record.category === "weapon" ? "weapon" : "armor"} stats for "${baseId}" - ${item.name} cannot be bound to it.`
    );
  }
  const { weapon: _clientWeapon, armor: _clientArmor, ...bare } = item;
  return record.category === "weapon"
    ? { ...bare, baseId, weapon: weaponStatsFrom(base!.weapon)! }
    : { ...bare, baseId, armor: armorStatsFrom(base!.armor)! };
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
export function setInventoryItem(
  state: GameState,
  actorId: string,
  item: InventoryItem,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  deps: InventoryDeps = {}
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  // A row naming itself as its own record is the plain form.
  if (item.recordId === item.id) {
    const { recordId: _same, ...plain } = item;
    item = plain;
  }
  // A removal never binds, so a row whose base left the catalog can still be removed.
  if (item.quantity > 0)
    item = bindTemplateItem(
      item,
      deps,
      actor.inventory.find((entry) => entry.id === item.id)
    );
  item = withDamageTypeChoice(actor, item, deps);
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  enforceCurse(actor, item, deps);
  enforceEquipRules(actor, item, definition, deps);
  if (item.quantity <= 0) {
    // The charges a row spent leave with it, so a new copy under the same id starts full.
    const removed = actor.inventory.find((entry) => entry.id === item.id);
    const spentKeys = removed ? chargeKeysOf(removed, definition, deps) : [];
    if (spentKeys.length > 0)
      actor.actionUses = Object.fromEntries(
        Object.entries(actor.actionUses).filter(([key]) => !spentKeys.includes(key))
      );
    actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id);
  } else {
    const index = actor.inventory.findIndex((entry) => entry.id === item.id);
    if (index >= 0)
      actor.inventory = actor.inventory.map((entry, position) => (position === index ? { ...item } : entry));
    else {
      if (actor.inventory.length >= MAX_ITEMS)
        throw new CommandRejectedError("This character's pack is full - remove something first.");
      actor.inventory = [...actor.inventory, { ...item }];
    }
  }
  reconcileEquipment(actor, definition, deps);
}

/** The charge pools a row's own actions and casts count in, in the record's order, whether or not the row is worn. */
function chargeKeysOf(item: InventoryItem, definition: ActorDefinition | undefined, deps: InventoryDeps): string[] {
  const record = deps.catalog?.equipmentRecord(catalogIdOf(item));
  if (!record) return [];
  const actions = [
    ...record.actions.map((declared) => itemAction(item, declared, definition)),
    ...record.casts.map((cast) => castAction(item, cast, item.name, definition, undefined))
  ];
  const keys = actions.flatMap((action) =>
    action.uses && action.uses.per !== "turn" ? [action.uses.pool ?? action.id] : []
  );
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
  const row = from.inventory.find((entry) => entry.id === itemId);
  if (!row) throw new CommandRejectedError("That item is no longer in the pack.");
  if (to.inventory.length >= MAX_ITEMS)
    throw new CommandRejectedError(`${to.name}'s pack is full - remove something first.`);
  const catalogId = catalogIdOf(row);
  const taken = new Set(to.inventory.map((entry) => entry.id));
  let id = catalogId;
  for (let copy = 2; taken.has(id); copy += 1) id = `${catalogId.slice(0, 76)}-${copy}`;
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
  return { name: row.name };
}

/** Set the whole coin purse. Owner-scoped by the caller. */
export function setCurrency(state: GameState, actorId: string, currency: Currency): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.currency = { ...currency };
}

export { itemIsActive };
