import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";
import {
  abilityModifier, armorWeightOf, collectRiders, effectiveSlot, sumRiders,
  type ArmorWeight, type RiderCarrier, type RiderContext, type RiderModifier, type ResolvedRider
} from "@vtt/rules-5e";

/**
 * ============================================================================================
 * THE RECONCILIATION CONTRACT
 * ============================================================================================
 *
 * Every item contribution is a PURE FUNCTION of (definition, inventory, catalog), recomputed WHOLE
 * on every read, and NEVER merged into the ActorDefinition. Replace-whole IS the un-grant.
 *
 * That single rule is what makes a circlet able to grant a skill and an item able to grant a feat
 * without the first unequip corrupting the sheet. Nothing accumulates, so nothing has to be undone:
 * removing the circlet removes its row from the derivation, and the next read shows the base tier.
 *
 * WHY NOT THE BUILDER. `buildCharacterDefinition` interprets features at step 6 and assembles
 * inventory at step 10 - inventory is an OUTPUT of the build, not an input. The build runs once and
 * has no un-grant pass, and neither a bundled monster nor a PDF import runs it at all. Reconciliation
 * is the only path all three actor origins traverse, which is why `reconcileArmorClass` already
 * worked for all three and why generalising IT is the correct move.
 *
 * WHY NOT MERGED INTO THE DEFINITION. The owner's projection hands them their whole `definition` and
 * their whole `inventory` verbatim. Anything written into `definition.proficiencies` would ship to
 * the player the moment it was written, so "never merge" is a VIEWER-SAFETY rule as much as a
 * correctness one.
 *
 * WHY DERIVED-AT-READ RATHER THAN A STORED `actor.equipment` BLOCK. The design calls for the whole
 * recomputation to land in a derived block on the actor. Storing it would need an additive field on
 * `ActorSchema` (@vtt/schemas) AND a matching entry in BOTH `projections.ts`'s strip and
 * `PlayerActor`'s `Omit` (@vtt/domain) - and a new per-actor field that reaches only one of those
 * two lists is precisely how GM state leaks. Those packages belong to another engineer on this
 * branch, so the block is computed on demand here instead: same whole-recompute, same replace-whole
 * un-grant, and it adds NO actor state at all, so there is nothing for a projection to leak. When
 * the field lands, `reconcileEquipment` writes exactly this value and both lists gain one entry.
 *
 * RIDERS LIVE ON THE CONTENT RECORD, never on `InventoryItem`. The inventory row carries only the
 * non-secret `magic` marker, so a cursed item's mechanics are structurally unable to reach the
 * player: there is nothing on the row to leak. Riders are gated on attunement, so a cursed item
 * contributes NOTHING until it is attuned. Never pre-apply a cursed rider for any reason.
 */

// ---------------------------------------------------------------------------------------------
// Structural views of the catalog records. Declared here rather than imported so this file compiles
// against the SPEC while the authoring schemas land in @vtt/content-srd-5.2.1: a Zod type inferred
// from the matching shape is assignable to these, so nothing changes when they arrive.
// ---------------------------------------------------------------------------------------------

/** The rider block every carrier shares (`featureRiders`), as this module reads it. */
export type RiderBlockLike = Readonly<{
  modifiers?: readonly RiderModifier[];
  grants?: Readonly<{
    skills?: readonly string[]; expertise?: readonly string[]; tools?: readonly string[];
    languages?: readonly string[]; saves?: readonly string[]; damageResistances?: readonly string[];
  }>;
  actions?: readonly RiderActionLike[];
  uses?: Readonly<{ limit: number; per: string; pool?: string; recharge?: number }>;
}>;
/** A `FeatureAction` as synthesised here - only the fields an item action can carry. */
export type RiderActionLike = Readonly<{
  id: string; name: string; description?: string;
  activation?: "action" | "bonus-action" | "reaction" | "other";
  damage?: readonly Readonly<{ formula: string; type: string }>[];
  uses?: Readonly<{ limit: number; per: string; pool?: string; recharge?: number }>;
}>;
export type EquipmentRecordLike = RiderBlockLike & Readonly<{
  id: string; name: string; category?: string;
  slot?: string;
  isMagic?: boolean;
  attunement?: Readonly<{ required?: boolean; restrictedTo?: readonly string[] }> | null;
  cursed?: boolean;
  casts?: readonly Readonly<{ spellId: string; uses?: Readonly<{ limit: number; per: string; pool?: string }> }>[];
  grantsFeatIds?: readonly string[];
}>;
export type FeatRecordLike = Readonly<{ id: string; name: string; feature: RiderBlockLike }>;

export type EquipmentCatalog = Readonly<{
  equipmentRecord: (id: string) => EquipmentRecordLike | undefined;
  featRecord?: (id: string) => FeatRecordLike | undefined;
}>;

type CatalogSource = Readonly<{ equipmentRecord: (id: string) => unknown; featRecord: (id: string) => unknown }>;
const ADAPTED = new WeakMap<CatalogSource, EquipmentCatalog>();

/**
 * Adapt a `ContentView` to the catalog this module reads. The cast is deliberate and isolated to this
 * one function: the content records are the AUTHORING surface and the structural views above are the
 * READING surface, so exactly one place has to move if the authored shape changes.
 *
 * Resolve play-time riders for the **GM** audience. A homebrew item can be GM-only, and a player must
 * still be able to roll their own cursed sword - a player-audience view would resolve it to nothing
 * and silently make the item mundane. What the player is allowed to *browse* is a separate gate on
 * the catalog read, not on the rules engine.
 */
export function equipmentCatalogOf(view: CatalogSource): EquipmentCatalog {
  const cached = ADAPTED.get(view);
  if (cached) return cached;
  const adapted: EquipmentCatalog = {
    equipmentRecord: (id) => view.equipmentRecord(id) as EquipmentRecordLike | undefined,
    featRecord: (id) => view.featRecord(id) as FeatRecordLike | undefined
  };
  ADAPTED.set(view, adapted);
  return adapted;
}

// ---------------------------------------------------------------------------------------------
// The derived block
// ---------------------------------------------------------------------------------------------

type SourcedTier = Readonly<{ id: string; proficiency: "proficient" | "expertise"; sourceItemId: string }>;
type Sourced = Readonly<{ id: string; sourceItemId: string }>;

/** Everything the actor's active items currently contribute. REPLACED WHOLE on every recompute. */
export type EquipmentDerivation = Readonly<{
  skills: readonly SourcedTier[];
  saves: readonly Sourced[];
  tools: readonly Sourced[];
  languages: readonly Sourced[];
  damageResistances: readonly Sourced[];
  /** Feat ids the active items grant, depth 1. Their riders are already folded into this same block. */
  featIds: readonly Readonly<{ id: string; name: string; sourceItemId: string }>[];
  armorClass: number; initiative: number; speed: number;
  saveBonus: number; checkBonus: number;
  spellSaveDc: readonly Readonly<{ amount: number; classId?: string }>[];
  spellAttackBonus: readonly Readonly<{ amount: number; classId?: string }>[];
  spellSlots: readonly Readonly<{ level: number; amount: number }>[];
  resourceBonus: readonly Readonly<{ poolId: string; amount: number }>[];
  /**
   * Every active carrier with its `when` lists INTACT. This is the design's `conditional` set, kept
   * as carriers rather than bare modifiers because the roll-time collector needs the label (which
   * becomes the roll card's explanation) and the source item id (which `scope: "this-item"` matches
   * against). Momentary riders are evaluated from here at the moment they name.
   */
  carriers: readonly RiderCarrier[];
  /** The bearer's flattened trigger facts, computed once so every later pass reads the same values. */
  context: Omit<RiderContext, "moment">;
  /** Item-granted actions and synthesised weapon attacks, keyed `item-<itemId>`. */
  actions: readonly ActorAction[];
  /** Provenance for the sheet ("Stealth (Circlet of Shadows)"). */
  sources: readonly Readonly<{ itemId: string; itemName: string; summary: string }>[];
}>;

export const EMPTY_DERIVATION: EquipmentDerivation = Object.freeze({
  skills: [], saves: [], tools: [], languages: [], damageResistances: [], featIds: [],
  armorClass: 0, initiative: 0, speed: 0, saveBonus: 0, checkBonus: 0,
  spellSaveDc: [], spellAttackBonus: [], spellSlots: [], resourceBonus: [],
  carriers: [], context: {}, actions: [], sources: []
});

/**
 * Whether an item's riders apply at all. Equipped, present, and - when the catalog record requires
 * attunement - attuned. This is the boundary a cursed item hides behind: before attunement it
 * contributes nothing, so there is no delta for any projection to leak.
 *
 * An item with NO catalog record (a PDF import, a hand-typed row, deleted homebrew) fails open to
 * mundane - the same documented fail-open as `armorClassRiderOf`.
 */
export function itemIsActive(item: InventoryItem, record: EquipmentRecordLike | undefined): boolean {
  if (item.quantity <= 0 || !item.equipped) return false;
  const requiresAttunement = record?.attunement?.required === true || item.magic?.attunementRequired === true;
  return requiresAttunement ? item.attuned : true;
}

/** The bearer's static/dynamic facts, flattened once so every trigger reads plain values. */
function bearerContext(actor: Actor, definition: ActorDefinition | undefined, active: readonly ActiveItem[]): Omit<RiderContext, "moment"> {
  const worn = active.filter((entry) => entry.item.armor !== undefined);
  const bodyArmor = worn.find((entry) => effectiveSlot(slotView(entry)) === "armor");
  const identity = definition?.character;
  const proficiencies = definition?.proficiencies;
  return {
    attunedItemIds: actor.inventory.filter((item) => item.attuned).map((item) => item.id),
    armorWeight: bodyArmor ? armorWeightOf(bodyArmor.item.armor!) : null,
    shieldEquipped: worn.some((entry) => effectiveSlot(slotView(entry)) === "shield"),
    classIds: (identity?.classes ?? []).map((entry) => entry.id),
    speciesId: identity?.race?.id ?? null,
    proficientWeapons: proficiencies?.weapons ?? [],
    proficientArmor: proficiencies?.armor ?? [],
    proficientTools: proficiencies?.tools ?? [],
    proficientSkills: (proficiencies?.skills ?? []).map((entry) => entry.id),
    effectTags: actor.effects.flatMap((effect) => effect.tags),
    hitPointFraction: actor.hp.maximum > 0 ? actor.hp.current / actor.hp.maximum : 0,
    bearerConditionIds: actor.conditions.map((condition) => condition.id)
  };
}

type ActiveItem = Readonly<{ item: InventoryItem; record: EquipmentRecordLike | undefined }>;
/** `effectiveSlot` input: the catalog's mechanical slot wins, then the row's marker, then category. */
const slotView = (entry: ActiveItem) => ({ slot: entry.record?.slot ?? entry.item.magic?.slot, category: entry.item.category });

/**
 * Derive the whole equipment contribution. Pure: reads the actor and the catalog, writes nothing.
 *
 * Feats an item grants are folded in at DEPTH 1 - the feat's own riders join this block, and nothing
 * the feat names is followed further. A cycle is structurally impossible because the grant edge is
 * one-directional: an item may name feats, and no feature, feat or option ever names an item.
 */
/*
 * Deliberately NOT memoized. The obvious key - the inventory array's identity, which `setInventoryItem`
 * replaces on every write - is wrong: the derivation also depends on `actor.effects`, `actor.conditions`
 * and `actor.hp`, which the dynamic gates read and which change without the inventory ever moving. A
 * cache keyed on inventory alone would serve a stale "while raging" rider, which is exactly the class of
 * guard-that-does-not-fire this feature exists to avoid. Recomputing is a handful of map lookups over at
 * most a few dozen equipped items; a home-group table will never notice it.
 */
export function deriveEquipment(actor: Actor, definition: ActorDefinition | undefined, catalog: EquipmentCatalog | undefined): EquipmentDerivation {
  if (!catalog) return EMPTY_DERIVATION;
  // TWO lists, and the difference matters. `equipped` is what makes a weapon SWINGABLE; `active`
  // (equipped AND, where the record demands it, attuned) is what makes its RIDERS apply. An unattuned
  // magic sword is still a sword - it just has no +1 - and a cursed blade before attunement is
  // indistinguishable from a mundane one, which is exactly the hiding boundary.
  const equipped: ActiveItem[] = [];
  const active: ActiveItem[] = [];
  for (const item of actor.inventory) {
    if (item.quantity <= 0 || !item.equipped) continue;
    const record = catalog.equipmentRecord(item.id);
    const entry = { item, record };
    equipped.push(entry);
    if (itemIsActive(item, record)) active.push(entry);
  }
  if (equipped.length === 0) return EMPTY_DERIVATION;

  const carriers: RiderCarrier[] = [];
  const featIds: Array<{ id: string; name: string; sourceItemId: string }> = [];
  const actions: ActorAction[] = [];
  const sources: Array<{ itemId: string; itemName: string; summary: string }> = [];
  const skills: SourcedTier[] = [];
  const saves: Sourced[] = [];
  const tools: Sourced[] = [];
  const languages: Sourced[] = [];
  const damageResistances: Sourced[] = [];

  const takeGrants = (block: RiderBlockLike, itemId: string) => {
    const grants = block.grants;
    if (!grants) return;
    for (const id of grants.skills ?? []) skills.push({ id, proficiency: "proficient", sourceItemId: itemId });
    for (const id of grants.expertise ?? []) skills.push({ id, proficiency: "expertise", sourceItemId: itemId });
    for (const id of grants.saves ?? []) saves.push({ id, sourceItemId: itemId });
    for (const id of grants.tools ?? []) tools.push({ id, sourceItemId: itemId });
    for (const id of grants.languages ?? []) languages.push({ id, sourceItemId: itemId });
    for (const id of grants.damageResistances ?? []) damageResistances.push({ id, sourceItemId: itemId });
  };

  for (const entry of active) {
    const { item, record } = entry;
    const label = record?.name ?? item.name;
    const isWeapon = effectiveSlot(slotView(entry)) === "weapon" || item.weapon !== undefined;
    if (record) {
      carriers.push({ label, modifiers: record.modifiers ?? [], sourceItemId: item.id, isWeapon });
      takeGrants(record, item.id);
      for (const declared of record.actions ?? []) actions.push(itemAction(item.id, declared, label));
      for (const cast of record.casts ?? []) actions.push(castAction(item.id, cast, label));
      // Depth 1: the feat's riders join THIS block, so unequipping removes them in one recomputation.
      for (const featId of record.grantsFeatIds ?? []) {
        const feat = catalog.featRecord?.(featId);
        if (!feat) continue;
        featIds.push({ id: feat.id, name: feat.name, sourceItemId: item.id });
        carriers.push({ label: `${feat.name} (${label})`, modifiers: feat.feature.modifiers ?? [], sourceItemId: item.id });
        takeGrants(feat.feature, item.id);
      }
      if ((record.modifiers?.length ?? 0) > 0 || record.grants || (record.grantsFeatIds?.length ?? 0) > 0) {
        sources.push({ itemId: item.id, itemName: label, summary: summarise(record) });
      }
    }
  }
  // Weapon attacks come from the EQUIPPED list, not the active one (see above).
  for (const entry of equipped) {
    const weaponAttack = weaponAction(entry.item, definition);
    if (weaponAttack) actions.push(weaponAttack);
  }

  // The STANDING + CONDITIONAL pass: riders naming no moment whose static and dynamic gates pass.
  const context = bearerContext(actor, definition, equipped);
  const standing = collectRiders(carriers, { ...context, moment: null });
  return {
    context,
    skills, saves, tools, languages, damageResistances, featIds,
    armorClass: sumRiders(standing, "armor-class"),
    initiative: sumRiders(standing, "initiative"),
    speed: sumRiders(standing, "speed"),
    saveBonus: sumRiders(standing, "save-bonus"),
    checkBonus: sumRiders(standing, "check-bonus"),
    spellSaveDc: amountsWithClass(standing, "spell-save-dc"),
    spellAttackBonus: amountsWithClass(standing, "spell-attack-bonus"),
    spellSlots: standing.flatMap((rider) => rider.modifier.type === "spell-slot" && rider.modifier.level !== undefined
      ? [{ level: rider.modifier.level, amount: rider.modifier.amount ?? 0 }] : []),
    resourceBonus: standing.flatMap((rider) => rider.modifier.type === "resource-bonus" && rider.modifier.poolId !== undefined
      ? [{ poolId: rider.modifier.poolId, amount: rider.modifier.amount ?? 0 }] : []),
    carriers, actions, sources
  };
}

function amountsWithClass(riders: readonly ResolvedRider[], type: string) {
  return riders.flatMap((rider) => rider.modifier.type === type
    ? [{ amount: rider.modifier.amount ?? 0, ...(rider.modifier.classId ? { classId: rider.modifier.classId } : {}) }] : []);
}

function summarise(record: EquipmentRecordLike): string {
  const parts = (record.modifiers ?? []).map((modifier) => modifier.type);
  if (record.grants) parts.push("proficiencies");
  if ((record.grantsFeatIds?.length ?? 0) > 0) parts.push("feat");
  return parts.join(", ");
}

/** The bearer's total skill tier: the better of the definition's base and any item grant (criterion 11). */
export function effectiveSkillTier(definition: ActorDefinition | undefined, derivation: EquipmentDerivation, skillId: string): "none" | "proficient" | "expertise" {
  const base = definition?.proficiencies?.skills.find((entry) => entry.id === skillId)?.proficiency ?? "none";
  const granted = derivation.skills.filter((entry) => entry.id === skillId).map((entry) => entry.proficiency);
  const tiers = [base, ...granted];
  return tiers.includes("expertise") ? "expertise" : tiers.includes("proficient") ? "proficient" : "none";
}

// ---------------------------------------------------------------------------------------------
// Synthesised actions
// ---------------------------------------------------------------------------------------------

const ACTION_ID_PREFIX = "item-";
/** The derived-action id namespace, so a consumer can tell an item action from a stat-block one. */
export const itemActionId = (itemId: string, suffix?: string) => `${ACTION_ID_PREFIX}${itemId}${suffix ? `-${suffix}` : ""}`;
export const isItemActionId = (id: string) => id.startsWith(ACTION_ID_PREFIX);

function usesOf(uses: RiderBlockLike["uses"]): ActorAction["uses"] | undefined {
  if (!uses) return undefined;
  const per = uses.per as NonNullable<ActorAction["uses"]>["per"];
  return { limit: uses.limit, per, ...(uses.pool ? { pool: uses.pool } : {}), ...(uses.recharge !== undefined ? { recharge: uses.recharge } : {}) };
}

function itemAction(itemId: string, declared: RiderActionLike, itemName: string): ActorAction {
  return {
    id: itemActionId(itemId, declared.id),
    name: declared.name,
    activation: declared.activation ?? "action",
    description: declared.description ?? `${itemName}.`,
    damage: (declared.damage ?? []).map((part) => ({ ...part })),
    ...(usesOf(declared.uses) ? { uses: usesOf(declared.uses)! } : {})
  };
}

/** Criterion 4: "cast Message once per day while attuned" is a synthesised action with its own charges. */
function castAction(itemId: string, cast: { spellId: string; uses?: RiderBlockLike["uses"] }, itemName: string): ActorAction {
  return {
    id: itemActionId(itemId, `cast-${cast.spellId}`),
    name: `Cast ${cast.spellId.replace(/-/g, " ")} (${itemName})`,
    activation: "action",
    description: `Cast ${cast.spellId.replace(/-/g, " ")} from ${itemName}.`,
    damage: [],
    ...(usesOf(cast.uses) ? { uses: usesOf(cast.uses)! } : {})
  };
}

/**
 * A concrete attack action for an equipped weapon, derived SERVER-SIDE from (definition, inventory).
 *
 * The client sheet derives its own equipped-weapon attacks today, and gets it wrong in three ways:
 * `finesse` is ignored (ability is picked purely on range), the proficiency bonus is added without
 * checking `proficiencies.weapons`, and it is a client computing a rolled number at all - a rule-2
 * server-authority hole this feature makes newly visible. This is the correct home; the client's
 * copy should be deleted in favour of it.
 *
 * Absent `proficiencies.weapons` means "not recorded", NOT "untrained", so proficiency is assumed -
 * which keeps every existing sheet's number exactly where it is.
 */
export function weaponAction(item: InventoryItem, definition: ActorDefinition | undefined): ActorAction | null {
  const weapon = item.weapon;
  if (!weapon || !definition) return null;
  const properties = weapon.properties ?? [];
  const str = abilityModifier(definition.abilityScores.str);
  const dex = abilityModifier(definition.abilityScores.dex);
  const ranged = weapon.rangeFeet !== null && !properties.includes("thrown");
  const modifier = properties.includes("finesse") ? Math.max(str, dex) : ranged ? dex : str;
  const trained = definition.proficiencies?.weapons;
  const proficient = trained === undefined || trained.includes(weapon.category) || trained.includes(item.id);
  const bonus = modifier + (proficient ? definition.proficiencyBonus : 0);
  const damageFormula = `${weapon.damageDice}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`;
  return {
    id: itemActionId(item.id),
    name: item.name,
    activation: "action",
    description: `Attack with ${item.name}.`,
    attack: {
      bonus,
      ...(weapon.rangeFeet === null || properties.includes("thrown") ? { reachFeet: properties.includes("reach") ? 10 : 5 } : {}),
      ...(weapon.rangeFeet !== null ? { rangeFeet: weapon.longRangeFeet ?? weapon.rangeFeet, rangeNormalFeet: weapon.rangeFeet } : {})
    },
    damage: [{ formula: damageFormula, type: weapon.damageType }]
  };
}

/**
 * The inventory, with each row's MECHANICAL slot resolved from the catalog. `armorClassFromEquipment`
 * hooks on `effectiveSlot`, and the row itself carries no `slot` - so without this a homebrew
 * `category: "relic"` that declares `slot: "armor"` would parse, store, project and derive nothing.
 */
export function withResolvedSlots(inventory: readonly InventoryItem[], catalog: EquipmentCatalog | undefined): readonly (InventoryItem & { slot?: string })[] {
  if (!catalog) return inventory;
  return inventory.map((item) => {
    const slot = catalog.equipmentRecord(item.id)?.slot ?? item.magic?.slot;
    return slot === undefined ? item : { ...item, slot };
  });
}

/** The item id a derived action belongs to, or null for a stat-block action. Drives `scope: "this-item"`. */
export function sourceItemOf(action: Pick<ActorAction, "id">, derivation: EquipmentDerivation, inventory: readonly InventoryItem[]): string | null {
  if (!isItemActionId(action.id)) return null;
  const rest = action.id.slice(ACTION_ID_PREFIX.length);
  // Ids are `item-<itemId>` or `item-<itemId>-<suffix>`; the longest matching inventory id wins.
  let best: string | null = null;
  for (const item of inventory) {
    if ((rest === item.id || rest.startsWith(`${item.id}-`)) && (best === null || item.id.length > best.length)) best = item.id;
  }
  return best ?? (derivation.sources.find((source) => rest.startsWith(source.itemId))?.itemId ?? null);
}

/** The weapon property list for a derived action's item, so `weapon-property-is` can narrow. */
export function weaponPropertiesOf(itemId: string | null, inventory: readonly InventoryItem[]): readonly string[] {
  if (itemId === null) return [];
  return inventory.find((item) => item.id === itemId)?.weapon?.properties ?? [];
}

export type { ArmorWeight };
