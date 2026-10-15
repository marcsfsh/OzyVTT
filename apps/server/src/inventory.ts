import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition, Currency, InventoryItem } from "@vtt/schemas";
import { abilityModifier, armorClassFromEquipment, effectiveSlot } from "@vtt/rules-5e";
import { armorClassRiderOf, spellSlotMaxima, unarmoredDefenseOf } from "./actor-roster.js";
import { deriveEquipment, itemIsActive, withResolvedSlots, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

const MAX_ITEMS = 200;
const MAX_ATTUNED = 3;

/** How many of a slot may be equipped at once. Anything unlisted is unlimited (weapons, gear, consumables). */
const SLOT_CAPACITY: Readonly<Record<string, number>> = {
  ring: 2,
  head: 1,
  neck: 1,
  shoulders: 1,
  hands: 1,
  belt: 1,
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
  // Unarmored Defense comes from the definition because this is the write a shield arrives on; the
  // catalog lets older sheets resolve the feature from content.
  const derived = armorClassFromEquipment(
    abilityModifier(definition.abilityScores.dex),
    withResolvedSlots(actor.inventory, deps.catalog),
    unarmoredDefenseOf(definition, deps.catalog)
  );
  // The builder's flat rider (Defense) and item riders are both re-applied from scratch.
  actor.armorClass =
    (derived === null ? definition.armorClass : derived + armorClassRiderOf(definition)) + derivation.armorClass;

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

/** SRD attunement cap (3) and slot capacity; a GM write bypasses both. Items with no record may still
 *  attune (counted) but get no slot. */
function enforceEquipRules(actor: Actor, incoming: InventoryItem, deps: InventoryDeps): void {
  if (deps.role === "gm") return;
  const others = actor.inventory.filter((entry) => entry.id !== incoming.id);
  if (incoming.attuned && incoming.quantity > 0) {
    const attuned = others.filter((entry) => entry.attuned);
    if (attuned.length >= MAX_ATTUNED) {
      throw new CommandRejectedError(
        `Already attuned to ${MAX_ATTUNED} items (${attuned
          .slice(0, MAX_ATTUNED)
          .map((entry) => entry.name)
          .join(", ")}) - break one first.`
      );
    }
  }
  if (!incoming.equipped || incoming.quantity <= 0 || !deps.catalog) return;
  const slot = effectiveSlot({
    slot: deps.catalog.equipmentRecord(incoming.id)?.slot ?? incoming.magic?.slot,
    category: incoming.category
  });
  const capacity = SLOT_CAPACITY[slot];
  if (capacity === undefined) return;
  const worn = others.filter(
    (entry) =>
      entry.equipped &&
      entry.quantity > 0 &&
      effectiveSlot({
        slot: deps.catalog!.equipmentRecord(entry.id)?.slot ?? entry.magic?.slot,
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

/** Once attuned, a cursed item can't be unattuned, unequipped or deleted by a player; a GM can ("remove curse"). */
function enforceCurse(actor: Actor, incoming: InventoryItem, deps: InventoryDeps): void {
  if (deps.role === "gm" || !deps.catalog) return;
  const existing = actor.inventory.find((entry) => entry.id === incoming.id);
  if (!existing?.attuned || deps.catalog.equipmentRecord(incoming.id)?.cursed !== true) return;
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
  const record = deps.catalog?.equipmentRecord(item.id);
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
  // A removal never binds, so a row whose base left the catalog can still be removed.
  if (item.quantity > 0)
    item = bindTemplateItem(
      item,
      deps,
      actor.inventory.find((entry) => entry.id === item.id)
    );
  enforceCurse(actor, item, deps);
  enforceEquipRules(actor, item, deps);
  if (item.quantity <= 0) actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id);
  else {
    const index = actor.inventory.findIndex((entry) => entry.id === item.id);
    if (index >= 0)
      actor.inventory = actor.inventory.map((entry, position) => (position === index ? { ...item } : entry));
    else {
      if (actor.inventory.length >= MAX_ITEMS)
        throw new CommandRejectedError("This character's pack is full - remove something first.");
      actor.inventory = [...actor.inventory, { ...item }];
    }
  }
  reconcileEquipment(actor, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined, deps);
}

/** Set the whole coin purse. Owner-scoped by the caller. */
export function setCurrency(state: GameState, actorId: string, currency: Currency): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.currency = { ...currency };
}

export { itemIsActive };
