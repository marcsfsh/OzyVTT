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
  // Unarmored Defense is read from the definition (`unarmoredDefenseOf`) because THIS is the write a
  // shield actually arrives on: equipping one used to replace a Barbarian's Constitution AC with a
  // flat 10 + Dex + 2 and leave them worse off than bare-handed (U28). The catalog goes with it so a
  // sheet stored before that fix - which carries no such extension key - resolves its own authored
  // feature here instead of silently landing back on the pre-U28 arithmetic.
  const derived = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(actor.inventory, deps.catalog), unarmoredDefenseOf(definition, deps.catalog));
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

/**
 * C9: BIND a template magic item to the base the player picked - server-side, because what a weapon
 * does is a game decision. A catalog record carrying `appliesTo` is a TEMPLATE (the SRD's "Weapon
 * (Any Simple or Martial)"): its row derives nothing until bound, and its stats come only from here.
 *
 *   - The pick is VALIDATED: a `baseId` outside the record's resolved list is refused naming the
 *     printed eligibility ("Dwarven Thrower applies to Warhammer"), so a client can never bind a
 *     hammer to a greatsword.
 *   - The base's stats are COPIED onto the row by the server, verbatim from the catalog - any
 *     client-supplied `weapon`/`armor` block on a template row is overwritten (bound) or stripped
 *     (unbound), never trusted. The copy re-runs on every write, so base-weapon errata reach
 *     already-bound rows on their next touch.
 *   - A single-base template AUTO-BINDS (client ruling 2026-08-14: no question with one answer),
 *     which is also what quietly repairs a legacy row on its first touch.
 *   - An UNBOUND choice template stays a legal row (legacy saves hold them): it derives no attack
 *     and no AC, and the sheet offers the pick. Refusing it here would break every ordinary edit
 *     (quantity, equip) to a pre-C9 row.
 *
 * Four rules the 2026-08-14 adversarial review added, each a hole it reproduced:
 *
 *   - A NON-TEMPLATE row STRIPS a client-supplied `baseId` instead of storing it: the derivation
 *     trusts `baseId` as a second identity for proficiency and weapon mastery, so a forged one on an
 *     ordinary greatsword row would self-grant both. No legitimate payload carries it there.
 *   - A write that OMITS `baseId` INHERITS the stored row's pick: the sheet's free-text add mints
 *     ids by slug ("Weapon, +1" -> "weapon-1"), and without the inherit that collision silently
 *     unbound a bound row. A never-bound row still edits unrefused and stays unbound.
 *   - A non-GM write may not CHANGE an existing pick: changing the pick is remove-and-re-add (the
 *     client's ruling), and an in-place swap would also hollow `enforceCurse` - re-binding a cursed
 *     row is re-choosing what it is without ever taking it off. A GM write may (the audited
 *     override, same as the slot and attunement caps).
 *   - A STALE pick FAILS OPEN on an existing bind: when the recorded base no longer resolves (a
 *     homebrew base deleted, a template narrowed), an already-bound row keeps its stored copied
 *     stats rather than throwing - otherwise every edit AND the removal itself would refuse, and
 *     the row would be stuck on the sheet for the GM too. A FRESH bind to an invalid base still
 *     refuses by name.
 */
export function bindTemplateItem(item: InventoryItem, deps: InventoryDeps, stored?: InventoryItem): InventoryItem {
  const record = deps.catalog?.equipmentRecord(item.id);
  const appliesTo = record?.appliesTo;
  if (!record || !appliesTo) {
    if (item.baseId === undefined) return item;
    const { baseId: _forged, ...rest } = item;
    return rest;
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
  const invalid = !appliesTo.baseIds.includes(baseId) || shieldBase
    || (record.category === "weapon" ? !(base?.weapon?.damageDice && base.weapon.damageType && base.weapon.category) : !stats);
  if (invalid) {
    // The stale-pick fail-open: the row already carried this pick and the server's own copy of its
    // stats. Keep both frozen (no errata can reach a base that is gone) and let the write through.
    if (stored?.baseId === baseId && (stored.weapon !== undefined || stored.armor !== undefined)) {
      const { weapon: _clientWeapon, armor: _clientArmor, ...bare } = item;
      return { ...bare, baseId, ...(stored.weapon !== undefined ? { weapon: { ...stored.weapon } } : {}), ...(stored.armor !== undefined ? { armor: { ...stored.armor } } : {}) };
    }
    if (!appliesTo.baseIds.includes(baseId)) throw new CommandRejectedError(`${item.name} applies to ${appliesTo.label} - "${baseId}" is not one of its printed bases.`);
    if (shieldBase) throw new CommandRejectedError(`"${baseId}" is a shield, and a shield cannot be a template's base - its armor block carries its +2 bonus, not a body AC.`);
    throw new CommandRejectedError(`The catalog has no ${record.category === "weapon" ? "weapon" : "armor"} stats for "${baseId}" - ${item.name} cannot be bound to it.`);
  }
  const { weapon: _clientWeapon, armor: _clientArmor, ...bare } = item;
  if (record.category === "weapon") {
    const weaponStats = base!.weapon!;
    return {
      ...bare, baseId,
      weapon: {
        category: weaponStats.category === "martial" ? "martial" : "simple",
        damageDice: weaponStats.damageDice!, damageType: weaponStats.damageType!,
        rangeFeet: weaponStats.rangeFeet ?? null, longRangeFeet: weaponStats.longRangeFeet ?? null,
        ...(weaponStats.properties !== undefined ? { properties: [...weaponStats.properties] } : {})
      }
    };
  }
  const armorStats = base!.armor!;
  return {
    ...bare, baseId,
    armor: {
      acBase: armorStats.acBase, addDexModifier: armorStats.addDexModifier, dexModifierCap: armorStats.dexModifierCap,
      stealthDisadvantage: armorStats.stealthDisadvantage, strengthRequired: armorStats.strengthRequired
    }
  };
}

/** Upsert one inventory item by id; quantity 0 removes it. Owner-scoped by the caller. Re-derives the
 *  whole equipment contribution (AC, slot maxima) from the resulting loadout. */
export function setInventoryItem(state: GameState, actorId: string, item: InventoryItem, resolveDefinition: (definitionId: string) => ActorDefinition | undefined, deps: InventoryDeps = {}): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  // A removal copies no stats, so it never binds: a row whose recorded base has left the catalog
  // must still be removable, by its owner and by the GM alike (the review's stuck-row reproduction).
  if (item.quantity > 0) item = bindTemplateItem(item, deps, actor.inventory.find((entry) => entry.id === item.id));
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
