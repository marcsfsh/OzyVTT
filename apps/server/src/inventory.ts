import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition, Currency, InventoryItem } from "@vtt/schemas";
import { abilityModifier, armorClassFromEquipment, effectiveSlot } from "@vtt/rules-5e";
import { armorClassRiderOf, spellSlotMaxima } from "./actor-roster.js";
import { deriveEquipment, itemIsActive, withResolvedSlots, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

const MAX_ITEMS = 200;
const MAX_ATTUNED = 3;

/** How many of a slot may be equipped at once. Anything unlisted is unlimited (weapons, gear, consumables). */
const SLOT_CAPACITY: Readonly<Record<string, number>> = {
  ring: 2, head: 1, neck: 1, shoulders: 1, hands: 1, belt: 1, feet: 1, armor: 1, shield: 1
};

/** Optional dependencies for the reconciliation. Absent = riders are inert and every gate fails open. */
export type InventoryDeps = Readonly<{
  /** Resolves an item's catalog record - where riders live, and the ONLY place they live. */
  catalog?: EquipmentCatalog;
  /** Who is writing. A GM write bypasses the attunement cap and slot capacity (the audited override). */
  role?: "gm" | "player";
}>;

/**
 * RECONCILE the whole equipment contribution onto the actor - the generalisation of what
 * `reconcileArmorClass` did for AC alone.
 *
 * The contract: every item contribution is a pure function of (definition, inventory, catalog),
 * recomputed WHOLE on every inventory write and never merged into the definition. There is nothing
 * to reverse on unequip because nothing was ever accumulated - REPLACE-WHOLE IS THE UN-GRANT. That
 * is what lets a circlet grant a skill and an item grant a feat without the first unequip corrupting
 * the sheet, and it is why this, and not the character builder, is the right home: this is the only
 * path a builder-made PC, a PDF import and a bundled monster all traverse.
 *
 * Most of the derivation is read on demand (see `deriveEquipment`'s header for why it adds no actor
 * state). What has to be WRITTEN here is the handful of fields that are genuinely stored live state:
 *
 *   - `armorClass`  - the resolver reads `target.armorClass` off the live actor and has no
 *                     definition in hand for the target, so AC must stay stored + reconciled.
 *   - `spellSlots`  - `remaining` is spent during play and is clamped against the maximum, so an
 *                     item that adds a slot must hand it over full, and taking the item off must
 *                     clamp back down rather than strand `remaining > max`.
 */
export function reconcileEquipment(actor: Actor, definition: ActorDefinition | undefined, deps: InventoryDeps = {}): void {
  if (!definition) return;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const derived = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(actor.inventory, deps.catalog));
  // The builder's flat non-equipment rider (the Defense fighting style) still rides on top; the item
  // riders join it. Both are re-applied from scratch, so neither can be dropped by the other.
  actor.armorClass = (derived === null ? definition.armorClass : derived + armorClassRiderOf(definition)) + derivation.armorClass;

  if (actor.spellSlots && definition.spellcasting) {
    const maxByLevel = new Map(spellSlotMaxima(definition, derivation.spellSlots).map((entry) => [entry.level, entry.max] as const));
    const seen = new Set(actor.spellSlots.map((slot) => slot.level));
    // An item that ADDS a slot hands it over full (the obvious table behaviour); removing the item
    // clamps `remaining` back down, which is what stops a spent bonus slot stranding above its max.
    actor.spellSlots = [
      ...actor.spellSlots.map((slot) => {
        const max = maxByLevel.get(slot.level);
        if (max === undefined) return slot;
        const previous = maxOf(definition, slot.level);
        return { ...slot, remaining: Math.min(max, max > previous ? slot.remaining + (max - previous) : slot.remaining) };
      }),
      ...[...maxByLevel].filter(([level]) => !seen.has(level)).map(([level, max]) => ({ level, remaining: max }))
    ].sort((a, b) => a.level - b.level);
  }
}

const maxOf = (definition: ActorDefinition, level: number) => spellSlotMaxima(definition).find((entry) => entry.level === level)?.max ?? 0;

/**
 * The SRD attunement cap (3) and slot capacity, enforced SERVER-SIDE because the server owns game
 * decisions. Both are GM-overridable: a GM-role write bypasses them, which is the one-tap audited
 * override the rest of the rules engine already uses.
 *
 * Items with NO catalog record are grandfathered: attuning is allowed (it still counts toward the
 * cap) and no slot is derived. Every item that exists today has no record, and anything stricter
 * would silently break existing characters.
 */
function enforceEquipRules(actor: Actor, incoming: InventoryItem, deps: InventoryDeps): void {
  if (deps.role === "gm") return;
  const others = actor.inventory.filter((entry) => entry.id !== incoming.id);
  if (incoming.attuned && incoming.quantity > 0) {
    const attuned = others.filter((entry) => entry.attuned);
    if (attuned.length >= MAX_ATTUNED) {
      throw new CommandRejectedError(`Already attuned to ${MAX_ATTUNED} items (${attuned.slice(0, MAX_ATTUNED).map((entry) => entry.name).join(", ")}) - break one first.`);
    }
  }
  if (!incoming.equipped || incoming.quantity <= 0 || !deps.catalog) return;
  const slot = effectiveSlot({ slot: deps.catalog.equipmentRecord(incoming.id)?.slot ?? incoming.magic?.slot, category: incoming.category });
  const capacity = SLOT_CAPACITY[slot];
  if (capacity === undefined) return;
  const worn = others.filter((entry) => entry.equipped && entry.quantity > 0
    && effectiveSlot({ slot: deps.catalog!.equipmentRecord(entry.id)?.slot ?? entry.magic?.slot, category: entry.category }) === slot);
  if (worn.length >= capacity) {
    throw new CommandRejectedError(capacity === 1
      ? `${worn[0].name} already occupies the ${slot} slot - take it off first.`
      : `Only ${capacity} ${slot} items can be worn at once.`);
  }
}

/**
 * A cursed item cannot be taken off by the person wearing it. Once attuned, a PLAYER write may not
 * unattune, unequip, or delete it; a GM write always may - that is "remove curse", and it needs no
 * new command. A cursed item occupies an attunement slot it will not release, which is correct 5e.
 */
function enforceCurse(actor: Actor, incoming: InventoryItem, deps: InventoryDeps): void {
  if (deps.role === "gm" || !deps.catalog) return;
  const existing = actor.inventory.find((entry) => entry.id === incoming.id);
  if (!existing?.attuned || deps.catalog.equipmentRecord(incoming.id)?.cursed !== true) return;
  const releasing = incoming.quantity <= 0 || !incoming.attuned || !incoming.equipped;
  if (releasing) throw new CommandRejectedError(`${existing.name} will not come off. Ask the GM.`);
}

/** Upsert one inventory item by id; quantity 0 removes it. Owner-scoped by the caller. Re-derives the
 *  whole equipment contribution (AC, slot maxima) from the resulting loadout. */
export function setInventoryItem(state: GameState, actorId: string, item: InventoryItem, resolveDefinition: (definitionId: string) => ActorDefinition | undefined, deps: InventoryDeps = {}): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  enforceCurse(actor, item, deps);
  enforceEquipRules(actor, item, deps);
  if (item.quantity <= 0) actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id);
  else {
    const index = actor.inventory.findIndex((entry) => entry.id === item.id);
    if (index >= 0) actor.inventory = actor.inventory.map((entry, position) => position === index ? { ...item } : entry);
    else {
      if (actor.inventory.length >= MAX_ITEMS) throw new CommandRejectedError("This character's pack is full - remove something first.");
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
