import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem, SaveCondition } from "@vtt/schemas";
import {
  abilityModifier,
  armorWeightOf,
  collectRiders,
  effectiveSlot,
  gatePasses,
  sumRiders,
  weaponAbilityModifierFrom,
  type ArmorWeight,
  type RiderAbility,
  type RiderCarrier,
  type RiderContext,
  type RiderModifier,
  type RiderTrigger,
  type ResolvedRider
} from "@vtt/rules-5e";
import { IMPLEMENTED_MASTERIES, type MasteryInForce } from "./weapon-mastery.js";

/** Re-exported so importers keep one name; declared beside the mastery handlers that read it. */
export type { MasteryInForce };

/**
 * Every item contribution is a pure function of (definition, inventory, catalog), recomputed whole on
 * every read and never merged into the definition or stored on the actor: unequipping needs no undo,
 * and there is no new state for a projection to leak. Riders live on the content record, never on
 * `InventoryItem`, and are gated on attunement, so a cursed item's mechanics can't reach the player
 * before it is attuned. Never pre-apply a cursed rider.
 */

// Structural views of the catalog records (the content schema's inferred types are assignable to these).

/** The rider block every carrier shares. `grants.when` gates the grants (absent = unconditional).
 *  `grants.spells` is not read: granted spells are baked at build time (an item's are dropped). */
export type RiderBlockLike = Readonly<{
  modifiers?: readonly RiderModifier[];
  grants?: Readonly<{
    skills?: readonly string[];
    expertise?: readonly string[];
    tools?: readonly string[];
    languages?: readonly string[];
    saves?: readonly string[];
    damageResistances?: readonly string[];
    armor?: readonly string[];
    weapons?: readonly string[];
    damageImmunities?: readonly string[];
    conditionImmunities?: readonly string[];
    when?: readonly RiderTrigger[];
  }>;
  actions?: readonly RiderActionLike[];
  /** Standing effects the item carries while active (see `itemEffectCarrier`). */
  effects?: readonly ItemEffectLike[];
  uses?: RiderUsesLike;
}>;
/** Limited uses as authored; `limit` is optional because `scaling` can give the count instead. */
export type RiderUsesLike = Readonly<{
  limit?: number;
  per: string;
  pool?: string;
  recharge?: number;
  scaling?:
    | Readonly<{ type: "proficiency-bonus" }>
    | Readonly<{ type: "ability-modifier"; ability: RiderAbility; minimum?: number }>
    | Readonly<{ type: "by-level"; table: readonly Readonly<{ level: number; limit: number }>[] }>
    /** Reads the class table's printed column; an item has no class table, so this resolves to nothing (see `usesOf`). */
    | Readonly<{ type: "class-resource"; id: string }>;
}>;
/** A `FeatureAction` as synthesised here; `attack`/`save` name an ability and the number is derived at read time. */
export type RiderActionLike = Readonly<{
  id: string;
  name: string;
  description?: string;
  activation?: "action" | "bonus-action" | "reaction" | "other";
  attack?: Readonly<{
    ability: RiderAbility | "spellcasting";
    proficient?: boolean;
    reachFeet?: number;
    rangeFeet?: number;
    rangeNormalFeet?: number;
    count?: number;
    criticalBonusDice?: number;
  }>;
  save?: Readonly<{ ability: RiderAbility; dc: FeatureSaveDcLike } & SaveOutcomeLike>;
  damage?: readonly Readonly<{ formula: string; type: string }>[];
  uses?: RiderUsesLike;
}>;
/** `SaveOutcomeFields`: what a success does to the damage and the condition a failure imposes. */
export type SaveOutcomeLike = Readonly<{ successDamage: "half" | "none"; failureCondition: SaveCondition | null }>;
/** `FeatureSaveDcSchema`'s three printed forms: the character's own spell DC, a flat number, or `base + ability (+ PB)`. */
export type FeatureSaveDcLike =
  "spellcasting" | number | Readonly<{ base?: number; ability: RiderAbility; proficiencyBonus?: boolean }>;
/** An item effect, read as a standing rider while the item is active rather than written onto the actor. */
export type ItemEffectLike = Readonly<{
  name?: string;
  tags?: readonly string[];
  modifiers?: readonly ItemEffectModifierLike[];
}>;
/** An `EffectModifier` structurally: the rider fields plus `damageTypes`, which only the effect vocabulary carries. */
export type ItemEffectModifierLike = RiderModifier & Readonly<{ damageTypes?: readonly string[] }>;
export type EquipmentRecordLike = RiderBlockLike &
  Readonly<{
    id: string;
    name: string;
    category?: string;
    slot?: string;
    /** Read for its mastery, and in full when the record is the base of a template bind. */
    weapon?: Readonly<{
      category?: string;
      damageDice?: string;
      damageType?: string;
      rangeFeet?: number | null;
      longRangeFeet?: number | null;
      mastery?: string;
      properties?: readonly string[];
    }> | null;
    /** The armor block, read when the record is the base of a template armor bind. */
    armor?: Readonly<{
      acBase: number;
      addDexModifier: boolean;
      dexModifierCap: number | null;
      stealthDisadvantage: boolean;
      strengthRequired: number | null;
    }> | null;
    /** Which bases a template item may bind to; `baseIds` are resolved ids, so the check is membership. */
    appliesTo?: Readonly<{ label: string; baseIds: readonly string[] }> | null;
    isMagic?: boolean;
    attunement?: Readonly<{ required?: boolean; restrictedTo?: readonly string[] }> | null;
    cursed?: boolean;
    casts?: readonly ItemSpellCastLike[];
    grantsFeatIds?: readonly string[];
  }>;
/** `ItemSpellCastSchema` in full. */
export type ItemSpellCastLike = Readonly<{
  spellId: string;
  /** Cast at this slot level; absent = the spell's own level. */
  atLevel?: number;
  /** Which ability powers it; absent = the wielder's own spellcasting ability. */
  ability?: RiderAbility;
  /** A flat printed DC ("save DC 15"), overriding any derivation. */
  saveDc?: number;
  /** Whether casting it also spends one of the bearer's own spell slots. */
  consumesSpellSlot?: boolean;
  uses?: RiderUsesLike;
}>;
/** The catalog's spell record, as the cast synthesis reads it (`SpellReference`). */
export type SpellRecordLike = Readonly<{
  id: string;
  name: string;
  level: number;
  attackRoll?: boolean;
  damage?: Readonly<{ roll: string | null; types: readonly string[] }>;
  save?: (Readonly<{ ability: RiderAbility }> & SaveOutcomeLike) | null;
  description?: string;
  castingOptions?: readonly Readonly<{ type: string; damageRoll: string | null; targetCount: number | null }>[];
}>;
export type FeatRecordLike = Readonly<{ id: string; name: string; feature: RiderBlockLike }>;
/** A class/subclass/species/lineage/background feature or chosen option; the record is the rider block. */
export type FeatureRecordLike = RiderBlockLike & Readonly<{ id: string; name: string }>;
/** How `definition.character.features` names one record; ids alone are ambiguous across classes. */
export type CharacterFeatureRef = Readonly<{
  id: string;
  kind: "class" | "subclass" | "species" | "lineage" | "background" | "option";
  sourceId: string;
}>;

/** Rider types `interpretFeature` bakes into the definition at build time, so they must not also be
 *  collected from feat/feature carriers. With `CARRIER_RIDER_DISPOSITION` this partitions the rider
 *  vocabulary. Declared here because this module is import-safe for `character-build.ts`. */
export const BUILDER_BAKED_MODIFIER_TYPES = [
  "ability-score",
  "hit-points-per-level",
  "speed",
  "armor-class",
  "initiative",
  "unarmored-defense",
  "darkvision"
] as const;
const BUILDER_BAKED: ReadonlySet<string> = new Set(BUILDER_BAKED_MODIFIER_TYPES);

/** Whether a mastery slug has a behaviour; derived from `weapon-mastery.ts`'s handler registry. */
export const masteryReaches = (mastery: string): boolean => IMPLEMENTED_MASTERIES.has(mastery);

export type EquipmentCatalog = Readonly<{
  equipmentRecord: (id: string) => EquipmentRecordLike | undefined;
  featRecord?: (id: string) => FeatRecordLike | undefined;
  /** The class/subclass/species/lineage/background feature (or inline option) a sheet's `character.features` entry names. */
  featureRecord?: (ref: CharacterFeatureRef) => FeatureRecordLike | undefined;
  /** The spell an item's `casts` entry names, so the synthesised cast can resolve real damage/attack/save. */
  spellRecord?: (id: string) => SpellRecordLike | undefined;
}>;

type CatalogSource = Readonly<{
  equipmentRecord: (id: string) => unknown;
  featRecord: (id: string) => unknown;
  featureRecord?: (ref: CharacterFeatureRef) => unknown;
  spellRecord?: (id: string) => unknown;
}>;
const ADAPTED = new WeakMap<CatalogSource, EquipmentCatalog>();

/** Adapts a `ContentView` to this module's catalog. GM audience, so a player can still roll their own
 *  GM-only item; what a player may browse is gated on the catalog read. */
export function equipmentCatalogOf(view: CatalogSource): EquipmentCatalog {
  const cached = ADAPTED.get(view);
  if (cached) return cached;
  const adapted: EquipmentCatalog = {
    equipmentRecord: (id) => view.equipmentRecord(id) as EquipmentRecordLike | undefined,
    featRecord: (id) => view.featRecord(id) as FeatRecordLike | undefined,
    ...(view.featureRecord
      ? { featureRecord: (ref: CharacterFeatureRef) => view.featureRecord!(ref) as FeatureRecordLike | undefined }
      : {}),
    ...(view.spellRecord ? { spellRecord: (id: string) => view.spellRecord!(id) as SpellRecordLike | undefined } : {})
  };
  ADAPTED.set(view, adapted);
  return adapted;
}

// The derived block

type SourcedTier = Readonly<{ id: string; proficiency: "proficient" | "expertise"; sourceItemId: string }>;
type Sourced = Readonly<{ id: string; sourceItemId: string }>;

/** Everything the actor's active items currently contribute. Replaced whole on every recompute. */
export type EquipmentDerivation = Readonly<{
  skills: readonly SourcedTier[];
  saves: readonly Sourced[];
  tools: readonly Sourced[];
  languages: readonly Sourced[];
  damageResistances: readonly Sourced[];
  /** Damage the bearer takes double of while the item's effect is active. */
  damageVulnerabilities: readonly Sourced[];
  /** Damage the bearer ignores entirely while the item is active; read by the damage pipeline beside the definition's own. */
  damageImmunities: readonly Sourced[];
  /** Conditions the item refuses; `setCondition` narrates the skip as it does for an innate immunity. */
  conditionImmunities: readonly Sourced[];
  /** Armor training the item grants: a `proficient-with` gate input and the sheet's provenance. */
  armorProficiencies: readonly Sourced[];
  /** Weapon training the item grants; `weaponAction` adds the proficiency bonus for a weapon it covers. */
  weaponProficiencies: readonly Sourced[];
  /** Feat ids the active items grant, depth 1. Their riders are already folded into this same block. */
  featIds: readonly Readonly<{ id: string; name: string; sourceItemId: string }>[];
  armorClass: number;
  initiative: number;
  speed: number;
  saveBonus: number;
  checkBonus: number;
  spellSaveDc: readonly Readonly<{ amount: number; classId?: string }>[];
  spellAttackBonus: readonly Readonly<{ amount: number; classId?: string }>[];
  spellSlots: readonly Readonly<{ level: number; amount: number }>[];
  resourceBonus: readonly Readonly<{ poolId: string; amount: number }>[];
  /** Active carriers with `when` intact; the roll-time collector needs their label and source item id. */
  carriers: readonly RiderCarrier[];
  /** The bearer's flattened trigger facts, computed once so every later pass reads the same values. */
  context: Omit<RiderContext, "moment">;
  /** Item-granted actions and synthesised weapon attacks, keyed `item-<itemId>`. */
  actions: readonly ActorAction[];
  /** Weapon swings synthesised from equipped weapons: the only actions Extra Attack multiplies. */
  weaponActionIds: readonly string[];
  /** Mastery per weapon swing: only when the weapon has one, the bearer picked that weapon, and it is implemented. */
  masteryByActionId: Readonly<Record<string, MasteryInForce>>;
  /** Provenance for the sheet ("Stealth (Circlet of Shadows)"). */
  sources: readonly Readonly<{ itemId: string; itemName: string; summary: string }>[];
}>;

export const EMPTY_DERIVATION: EquipmentDerivation = Object.freeze({
  skills: [],
  saves: [],
  tools: [],
  languages: [],
  damageResistances: [],
  damageVulnerabilities: [],
  damageImmunities: [],
  conditionImmunities: [],
  armorProficiencies: [],
  weaponProficiencies: [],
  featIds: [],
  armorClass: 0,
  initiative: 0,
  speed: 0,
  saveBonus: 0,
  checkBonus: 0,
  spellSaveDc: [],
  spellAttackBonus: [],
  spellSlots: [],
  resourceBonus: [],
  carriers: [],
  context: {},
  actions: [],
  weaponActionIds: [],
  masteryByActionId: {},
  sources: []
});

/** Whether an item's riders apply: equipped, present and (if required) attuned. A cursed item contributes
 *  nothing before attunement. No catalog record fails open to mundane. */
export function itemIsActive(item: InventoryItem, record: EquipmentRecordLike | undefined): boolean {
  if (item.quantity <= 0 || !item.equipped) return false;
  const requiresAttunement = record?.attunement?.required === true || item.magic?.attunementRequired === true;
  return requiresAttunement ? item.attuned : true;
}

/** The bearer's facts flattened once; `granted` adds item-granted training and effect tags to the sheet's own. */
function bearerContext(
  actor: Actor,
  definition: ActorDefinition | undefined,
  active: readonly ActiveItem[],
  granted: Readonly<{
    weapons: readonly string[];
    armor: readonly string[];
    tools: readonly string[];
    effectTags: readonly string[];
  }>
): Omit<RiderContext, "moment"> {
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
    proficientWeapons: [...(proficiencies?.weapons ?? []), ...granted.weapons],
    proficientArmor: [...(proficiencies?.armor ?? []), ...granted.armor],
    proficientTools: [...(proficiencies?.tools ?? []), ...granted.tools],
    proficientSkills: (proficiencies?.skills ?? []).map((entry) => entry.id),
    effectTags: [...actor.effects.flatMap((effect) => effect.tags), ...granted.effectTags],
    hitPointFraction: actor.hp.maximum > 0 ? actor.hp.current / actor.hp.maximum : 0,
    bearerConditionIds: actor.conditions.map((condition) => condition.id)
  };
}

/** The character's own feats as rider carriers, recomputed from `character.feats` and the catalog (so
 *  homebrew edits apply on the next read and nothing new is stored). No `sourceItemId`: they apply to
 *  every action of the bearer. */
function characterFeatCarriers(
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): readonly RiderCarrier[] {
  const feats = definition?.character?.feats ?? [];
  if (feats.length === 0 || !catalog.featRecord) return [];
  const carriers: RiderCarrier[] = [];
  for (const held of feats) {
    // Fail open: an unknown or deleted feat contributes prose only.
    const record = catalog.featRecord(held.id);
    if (!record) continue;
    const modifiers = (record.feature.modifiers ?? []).filter(ridesOnTheBearer);
    if (modifiers.length > 0) carriers.push({ label: record.name, modifiers });
  }
  return carriers;
}

/** The character's own features and chosen options as rider carriers, from `character.features`.
 *  Definitions without the array (PDF imports, monsters) get none. */
function characterFeatureCarriers(
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): readonly RiderCarrier[] {
  const features = definition?.character?.features ?? [];
  if (features.length === 0 || !catalog.featureRecord) return [];
  const carriers: RiderCarrier[] = [];
  for (const held of features) {
    // Fail open: a deleted or renamed feature contributes prose only.
    const record = catalog.featureRecord(held);
    if (!record) continue;
    const modifiers = (record.modifiers ?? []).filter(ridesOnTheBearer);
    if (modifiers.length > 0) carriers.push({ label: record.name, modifiers });
  }
  return carriers;
}

/** Own feats/features whose grants block is gated; ungated ones are already baked into the definition. */
function characterGatedGrants(
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): readonly FeatureRecordLike[] {
  const gated: FeatureRecordLike[] = [];
  for (const held of definition?.character?.feats ?? []) {
    const record = catalog.featRecord?.(held.id);
    if ((record?.feature.grants?.when?.length ?? 0) > 0)
      gated.push({ ...record!.feature, id: record!.id, name: record!.name });
  }
  for (const held of definition?.character?.features ?? []) {
    const record = catalog.featureRecord?.(held);
    if ((record?.grants?.when?.length ?? 0) > 0) gated.push(record!);
  }
  return gated;
}

/** Which of a feat's authored riders this carrier may hand to the collector. */
function ridesOnTheBearer(modifier: RiderModifier): boolean {
  // Already inside the definition's own numbers; see BUILDER_BAKED_MODIFIER_TYPES.
  if (BUILDER_BAKED.has(modifier.type)) return false;
  // `scope: "this-item"` on a carrier with no item would degrade to "bearer" in `scopeOf`, turning
  // "only with this weapon" into "always"; fail closed instead.
  return modifier.scope !== "this-item";
}

type ActiveItem = Readonly<{ item: InventoryItem; record: EquipmentRecordLike | undefined }>;
/** `effectiveSlot` input: the catalog's mechanical slot wins, then the row's marker, then category. */
const slotView = (entry: ActiveItem) => ({
  slot: entry.record?.slot ?? entry.item.magic?.slot,
  category: entry.item.category
});

/** Derives the whole equipment contribution. Pure. Item-granted feats fold in at depth 1 (nothing names
 *  an item, so no cycles). Not memoized: effects, conditions and hp change without the inventory moving. */
export function deriveEquipment(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): EquipmentDerivation {
  if (!catalog) return EMPTY_DERIVATION;
  // `equipped` makes a weapon swingable; `active` (also attuned where required) makes its riders apply.
  // An unattuned cursed blade is indistinguishable from a mundane one.
  const equipped: ActiveItem[] = [];
  const active: ActiveItem[] = [];
  for (const item of actor.inventory) {
    if (item.quantity <= 0 || !item.equipped) continue;
    const record = catalog.equipmentRecord(item.id);
    const entry = { item, record };
    equipped.push(entry);
    if (itemIsActive(item, record)) active.push(entry);
  }
  // Feats and features carry riders even with nothing equipped, so the empty shortcut checks all four sources.
  const featCarriers = characterFeatCarriers(definition, catalog);
  const featureCarriers = characterFeatureCarriers(definition, catalog);
  const gatedGrants = characterGatedGrants(definition, catalog);
  if (equipped.length === 0 && featCarriers.length === 0 && featureCarriers.length === 0 && gatedGrants.length === 0)
    return EMPTY_DERIVATION;
  /** Feats the character already holds, so an item granting one adds nothing twice. */
  const heldFeatIds = new Set((definition?.character?.feats ?? []).map((feat) => feat.id));

  const carriers: RiderCarrier[] = [...featCarriers, ...featureCarriers];
  const featIds: Array<{ id: string; name: string; sourceItemId: string }> = [];
  const actions: ActorAction[] = [];
  const sources: Array<{ itemId: string; itemName: string; summary: string }> = [];
  const skills: SourcedTier[] = [];
  const saves: Sourced[] = [];
  const tools: Sourced[] = [];
  const languages: Sourced[] = [];
  const damageResistances: Sourced[] = [];
  const damageVulnerabilities: Sourced[] = [];
  const damageImmunities: Sourced[] = [];
  const conditionImmunities: Sourced[] = [];
  const armorProficiencies: Sourced[] = [];
  const weaponProficiencies: Sourced[] = [];
  const itemEffectTags: string[] = [];

  // Gated grants see the bearer's own sheet and live state, not what other grants hand over in this same
  // recompute (circular). Chained grants therefore don't fire: under-granting beats over-granting.
  const gateContext = bearerContext(actor, definition, equipped, { weapons: [], armor: [], tools: [], effectTags: [] });

  /** Returns whether the block's gate held, so a caller can skip provenance for one that did not. */
  const takeGrants = (block: RiderBlockLike, itemId: string): boolean => {
    const grants = block.grants;
    if (!grants) return false;
    // Absent or empty `when` is unconditional. A trigger this build cannot evaluate refuses the whole block.
    if (!gatePasses(grants.when, gateContext, itemId)) return false;
    for (const id of grants.skills ?? []) skills.push({ id, proficiency: "proficient", sourceItemId: itemId });
    for (const id of grants.expertise ?? []) skills.push({ id, proficiency: "expertise", sourceItemId: itemId });
    for (const id of grants.saves ?? []) saves.push({ id, sourceItemId: itemId });
    for (const id of grants.tools ?? []) tools.push({ id, sourceItemId: itemId });
    for (const id of grants.languages ?? []) languages.push({ id, sourceItemId: itemId });
    for (const id of grants.damageResistances ?? []) damageResistances.push({ id, sourceItemId: itemId });
    for (const id of grants.damageImmunities ?? []) damageImmunities.push({ id, sourceItemId: itemId });
    for (const id of grants.conditionImmunities ?? []) conditionImmunities.push({ id, sourceItemId: itemId });
    for (const id of grants.armor ?? []) armorProficiencies.push({ id, sourceItemId: itemId });
    for (const id of grants.weapons ?? []) weaponProficiencies.push({ id, sourceItemId: itemId });
    return true;
  };

  /** An item's own effects, read as standing riders (see `ItemEffectLike`). */
  const takeEffects = (block: RiderBlockLike, itemId: string, itemLabel: string) => {
    for (const effect of block.effects ?? []) {
      const label = effect.name ? `${effect.name} (${itemLabel})` : itemLabel;
      for (const tag of effect.tags ?? []) itemEffectTags.push(tag);
      const modifiers: RiderModifier[] = [];
      for (const modifier of effect.modifiers ?? []) {
        // Effect-vocabulary resistances/vulnerabilities are defenses, not riders, so they join the grants.
        if (modifier.type === "damage-resistance" || modifier.type === "damage-vulnerability") {
          const into = modifier.type === "damage-resistance" ? damageResistances : damageVulnerabilities;
          for (const id of modifier.damageTypes ?? []) into.push({ id, sourceItemId: itemId });
          continue;
        }
        modifiers.push(...asRiderModifiers(modifier));
      }
      if (modifiers.length > 0) carriers.push({ label, modifiers, sourceItemId: itemId });
    }
  };

  for (const entry of active) {
    const { item, record } = entry;
    const label = record?.name ?? item.name;
    const isWeapon = effectiveSlot(slotView(entry)) === "weapon" || item.weapon !== undefined;
    if (record) {
      carriers.push({ label, modifiers: record.modifiers ?? [], sourceItemId: item.id, isWeapon });
      takeGrants(record, item.id);
      takeEffects(record, item.id, label);
      for (const declared of record.actions ?? []) actions.push(itemAction(item.id, declared, label, definition));
      for (const cast of record.casts ?? []) actions.push(castAction(item.id, cast, label, definition, catalog));
      // Depth 1: the feat's riders join this block, so unequipping removes them in one recomputation.
      for (const featId of record.grantsFeatIds ?? []) {
        // Already a builder carrier (with its baked half in the definition); granting again would double it.
        if (heldFeatIds.has(featId)) continue;
        const feat = catalog.featRecord?.(featId);
        if (!feat) continue;
        featIds.push({ id: feat.id, name: feat.name, sourceItemId: item.id });
        carriers.push({
          label: `${feat.name} (${label})`,
          modifiers: feat.feature.modifiers ?? [],
          sourceItemId: item.id
        });
        takeGrants(feat.feature, item.id);
        takeEffects(feat.feature, item.id, `${feat.name} (${label})`);
      }
      if (
        (record.modifiers?.length ?? 0) > 0 ||
        record.grants ||
        (record.effects?.length ?? 0) > 0 ||
        (record.grantsFeatIds?.length ?? 0) > 0
      ) {
        sources.push({ itemId: item.id, itemName: label, summary: summarise(record) });
      }
    }
  }
  // Gated grants on own feats/features (the builder baked only ungated ones). The `feature:<id>` source
  // is never in `attunedItemIds`, so an `attuned` gate on a feature fails closed.
  for (const record of gatedGrants) {
    const sourceId = `feature:${record.id}`;
    if (takeGrants(record, sourceId))
      sources.push({ itemId: sourceId, itemName: record.name, summary: summarise(record) });
  }

  // Weapon attacks come from the equipped list, not the active one. Item-granted weapon training
  // already applies in this recomputation.
  const grantedWeaponIds = weaponProficiencies.map((entry) => entry.id);
  const weaponActionIds: string[] = [];
  // Weapons this character spent a Weapon Mastery pick on, read from the stored choice ledger.
  const unlocked = new Set(
    (definition?.character?.choices ?? []).filter((row) => row.kind === "weapon-mastery").map((row) => row.id)
  );
  const masteryByActionId: Record<string, MasteryInForce> = {};
  for (const entry of equipped) {
    const weaponAttack = weaponAction(entry.item, definition, grantedWeaponIds);
    if (!weaponAttack) continue;
    actions.push(weaponAttack);
    weaponActionIds.push(weaponAttack.id);
    // A template row bound via `baseId` is that base weapon, so it carries the base's mastery and a pick
    // on that weapon kind covers it (SRD picks are per weapon kind).
    const baseRecord = entry.item.baseId !== undefined ? catalog.equipmentRecord(entry.item.baseId) : undefined;
    const mastery = catalog.equipmentRecord(entry.item.id)?.weapon?.mastery ?? baseRecord?.weapon?.mastery;
    const unlockedHere =
      unlocked.has(entry.item.id) || (entry.item.baseId !== undefined && unlocked.has(entry.item.baseId));
    // The weapon has a mastery, the bearer unlocked this weapon, and the engine implements it.
    if (mastery && unlockedHere && masteryReaches(mastery)) {
      masteryByActionId[weaponAttack.id] = {
        id: mastery,
        abilityModifier: weaponAbilityModifier(entry.item, definition)
      };
    }
  }
  // A builder-minted unarmed strike (Monk Martial Arts) is a weapon swing too, so Extra Attack reaches it.
  if (definition?.actions.some((action) => action.id === UNARMED_STRIKE_ACTION_ID && action.attack !== undefined)) {
    weaponActionIds.push(UNARMED_STRIKE_ACTION_ID);
  }

  // The standing + conditional pass: riders naming no moment whose static and dynamic gates pass.
  const context = bearerContext(actor, definition, equipped, {
    weapons: grantedWeaponIds,
    armor: armorProficiencies.map((entry) => entry.id),
    tools: tools.map((entry) => entry.id),
    effectTags: itemEffectTags
  });
  const standing = collectRiders(carriers, { ...context, moment: null });
  return {
    context,
    skills,
    saves,
    tools,
    languages,
    damageResistances,
    damageVulnerabilities,
    damageImmunities,
    conditionImmunities,
    armorProficiencies,
    weaponProficiencies,
    featIds,
    armorClass: sumRiders(standing, "armor-class"),
    initiative: sumRiders(standing, "initiative"),
    // No production reader yet: item speed riders do not affect movement (`effectiveSpeedFeet` reads only
    // effects), and item authoring refuses `speed` riders for that reason.
    speed: sumRiders(standing, "speed"),
    saveBonus: sumRiders(standing, "save-bonus"),
    checkBonus: sumRiders(standing, "check-bonus"),
    spellSaveDc: amountsWithClass(standing, "spell-save-dc"),
    spellAttackBonus: amountsWithClass(standing, "spell-attack-bonus"),
    spellSlots: standing.flatMap((rider) =>
      rider.modifier.type === "spell-slot" && rider.modifier.level !== undefined
        ? [{ level: rider.modifier.level, amount: rider.modifier.amount ?? 0 }]
        : []
    ),
    resourceBonus: standing.flatMap((rider) =>
      rider.modifier.type === "resource-bonus" && rider.modifier.poolId !== undefined
        ? [{ poolId: rider.modifier.poolId, amount: rider.modifier.amount ?? 0 }]
        : []
    ),
    carriers,
    actions,
    weaponActionIds,
    masteryByActionId,
    sources
  };
}

function amountsWithClass(riders: readonly ResolvedRider[], type: string) {
  return riders.flatMap((rider) =>
    rider.modifier.type === type
      ? [{ amount: rider.modifier.amount ?? 0, ...(rider.modifier.classId ? { classId: rider.modifier.classId } : {}) }]
      : []
  );
}

function summarise(record: RiderBlockLike & Readonly<{ grantsFeatIds?: readonly string[] }>): string {
  const parts = (record.modifiers ?? []).map((modifier) => modifier.type);
  if (record.grants) parts.push("proficiencies");
  if ((record.effects?.length ?? 0) > 0) parts.push("effects");
  if ((record.grantsFeatIds?.length ?? 0) > 0) parts.push("feat");
  return parts.join(", ");
}

/** One item effect modifier in the rider vocabulary; legacy advantage variants normalise to `roll-mode`.
 *  `damage-bonus` has no rider equivalent and contributes nothing. */
function asRiderModifiers(modifier: ItemEffectModifierLike): readonly RiderModifier[] {
  const gate = {
    ...(modifier.when ? { when: modifier.when } : {}),
    ...(modifier.scope ? { scope: modifier.scope } : {})
  };
  const rollMode = (roll: RiderModifier["roll"], mode: "advantage" | "disadvantage"): RiderModifier => ({
    type: "roll-mode",
    roll,
    mode,
    ...gate,
    // A filtered rider is only evaluated inside a moment pass, so `ability-is` needs its moment named too.
    ...(modifier.ability
      ? {
          when: [
            ...(modifier.when ?? []),
            { type: roll === "save" ? "on-saving-throw" : "on-attack-roll" },
            { type: "ability-is", abilities: [modifier.ability] }
          ]
        }
      : {})
  });
  switch (modifier.type) {
    case "attack-advantage":
      return [rollMode("attack", "advantage")];
    case "attack-disadvantage":
      return [rollMode("attack", "disadvantage")];
    case "incoming-attack-advantage":
      return [rollMode("incoming-attack", "advantage")];
    case "incoming-attack-disadvantage":
      return [rollMode("incoming-attack", "disadvantage")];
    case "save-advantage":
      return [rollMode("save", "advantage")];
    case "save-disadvantage":
      return [rollMode("save", "disadvantage")];
    case "damage-bonus":
      return [];
    default:
      return [modifier];
  }
}

/** The bearer's total skill tier: the better of the definition's base and any item grant. */
export function effectiveSkillTier(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  skillId: string
): "none" | "proficient" | "expertise" {
  const base = definition?.proficiencies?.skills.find((entry) => entry.id === skillId)?.proficiency ?? "none";
  const granted = derivation.skills.filter((entry) => entry.id === skillId).map((entry) => entry.proficiency);
  const tiers = [base, ...granted];
  return tiers.includes("expertise") ? "expertise" : tiers.includes("proficient") ? "proficient" : "none";
}

/** Item names that raised a skill's tier, for the sheet's "Stealth (Circlet of Shadows)" tooltip. */
export function skillTierSources(derivation: EquipmentDerivation, skillId: string): readonly string[] {
  const names: string[] = [];
  for (const entry of derivation.skills) {
    if (entry.id !== skillId) continue;
    const name =
      derivation.sources.find((source) => source.itemId === entry.sourceItemId)?.itemName ?? entry.sourceItemId;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Momentary item bonus to one ability check, on top of the standing `derivation.checkBonus`. */
export function checkRiderBonus(
  derivation: EquipmentDerivation,
  narrow: Readonly<{ ability?: RiderAbility; skill?: string }>
): number {
  const momentary = collectRiders(derivation.carriers, {
    ...derivation.context,
    ...(narrow.ability !== undefined ? { ability: narrow.ability } : {}),
    ...(narrow.skill !== undefined ? { skill: narrow.skill } : {}),
    moment: "on-ability-check"
  });
  return derivation.checkBonus + sumRiders(momentary, "check-bonus");
}

// Synthesised actions

const ACTION_ID_PREFIX = "item-";
/** The derived-action id namespace, so a consumer can tell an item action from a stat-block one. */
export const itemActionId = (itemId: string, suffix?: string) =>
  `${ACTION_ID_PREFIX}${itemId}${suffix ? `-${suffix}` : ""}`;
export const isItemActionId = (id: string) => id.startsWith(ACTION_ID_PREFIX);

/** The builtin's id, so a character's own unarmed strike shadows the generic builtin everywhere. */
export const UNARMED_STRIKE_ACTION_ID = "unarmed-strike";

/** The bearer's total character level, for a `by-level` use table. Absent (a bare token) reads as 1. */
function bearerLevel(definition: ActorDefinition | undefined): number {
  const classes = definition?.character?.classes ?? [];
  const total = classes.reduce((sum, entry) => sum + entry.level, 0);
  return total >= 1 ? total : 1;
}

/** Authored `uses` to `ActionUsesSchema`, clamped to 1-20 like `resolvedUseLimit`; below 1 means no charges. */
function usesOf(
  uses: RiderUsesLike | undefined,
  definition: ActorDefinition | undefined
): ActorAction["uses"] | undefined {
  if (!uses) return undefined;
  const per = uses.per as NonNullable<ActorAction["uses"]>["per"];
  const limit = uses.limit ?? scaledLimit(uses.scaling, definition);
  if (limit === undefined || limit < 1) return undefined;
  return {
    limit: Math.min(20, limit),
    per,
    ...(uses.pool ? { pool: uses.pool } : {}),
    ...(uses.recharge !== undefined ? { recharge: uses.recharge } : {})
  };
}

function scaledLimit(scaling: RiderUsesLike["scaling"], definition: ActorDefinition | undefined): number | undefined {
  if (!scaling) return undefined;
  if (scaling.type === "proficiency-bonus") return definition?.proficiencyBonus ?? 0;
  if (scaling.type === "ability-modifier")
    return Math.max(scaling.minimum ?? 1, scoreModifierOf(definition, scaling.ability));
  // A class-resource column exists only at build time, so an item using it grants no uses.
  if (scaling.type === "class-resource") return undefined;
  const level = bearerLevel(definition);
  const rows = [...scaling.table].filter((row) => row.level <= level).sort((left, right) => left.level - right.level);
  return rows.length > 0 ? rows[rows.length - 1].limit : 0;
}

/** The bearer's spellcasting numbers, falling back to the bare ability modifier for non-casters. */
function casterNumbers(definition: ActorDefinition | undefined) {
  const casting = definition?.spellcasting;
  return {
    ability: (casting?.ability ?? null) as RiderAbility | null,
    saveDc: casting?.saveDc ?? null,
    attackBonus: casting?.attackBonus ?? null,
    proficiencyBonus: definition?.proficiencyBonus ?? 0
  };
}
const scoreModifierOf = (definition: ActorDefinition | undefined, ability: RiderAbility | null): number =>
  definition && ability ? abilityModifier(definition.abilityScores[ability]) : 0;

/** An item action with attack and save resolved: the read-time twin of `interpretAction`. */
function itemAction(
  itemId: string,
  declared: RiderActionLike,
  itemName: string,
  definition: ActorDefinition | undefined
): ActorAction {
  const caster = casterNumbers(definition);
  let attack: ActorAction["attack"];
  if (declared.attack) {
    const { ability, proficient, ...rest } = declared.attack;
    const resolved = ability === "spellcasting" ? caster.ability : ability;
    // A spell-powered item attack on a non-caster falls back to the bare modifier rather than failing.
    const bonus =
      ability === "spellcasting" && caster.attackBonus !== null
        ? caster.attackBonus
        : scoreModifierOf(definition, resolved) + (proficient === false ? 0 : caster.proficiencyBonus);
    attack = { bonus, ...rest };
  }
  const save = declared.save ? { ...declared.save, dc: resolveSaveDc(declared.save.dc, definition) } : undefined;
  return {
    id: itemActionId(itemId, declared.id),
    name: declared.name,
    activation: declared.activation ?? "action",
    description: declared.description ?? `${itemName}.`,
    ...(attack ? { attack } : {}),
    ...(save ? { save } : {}),
    damage: (declared.damage ?? []).map((part) => ({ ...part })),
    ...(usesOf(declared.uses, definition) ? { uses: usesOf(declared.uses, definition)! } : {})
  };
}

/** `FeatureSaveDcSchema`'s three forms, resolved against the bearer. Clamped to the action schema's 1-40. */
function resolveSaveDc(dc: FeatureSaveDcLike, definition: ActorDefinition | undefined): number {
  const caster = casterNumbers(definition);
  if (dc === "spellcasting")
    return clampDc(caster.saveDc ?? 8 + scoreModifierOf(definition, caster.ability) + caster.proficiencyBonus);
  if (typeof dc === "number") return clampDc(dc);
  return clampDc(
    (dc.base ?? 8) +
      scoreModifierOf(definition, dc.ability) +
      (dc.proficiencyBonus === false ? 0 : caster.proficiencyBonus)
  );
}
const clampDc = (value: number) => Math.max(1, Math.min(40, Math.round(value)));

/** A synthesised cast action with the spell's mechanics. `atLevel` picks the SRD upcast row; `ability`
 *  and `saveDc` override; an unresolvable spell degrades to a name-only action. */
function castAction(
  itemId: string,
  cast: ItemSpellCastLike,
  itemName: string,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): ActorAction {
  const spell = catalog.spellRecord?.(cast.spellId);
  const spellName = spell?.name ?? cast.spellId.replace(/-/g, " ");
  const level = cast.atLevel ?? spell?.level ?? 0;
  const base: ActorAction = {
    id: itemActionId(itemId, `cast-${cast.spellId}`),
    name: `Cast ${spellName} (${itemName})`,
    activation: "action",
    description: spell?.description ?? `Cast ${spellName} from ${itemName}.`,
    damage: [],
    // Set even when the catalog cannot resolve the record, since `spell-id-is` gates on the authored id.
    spellId: cast.spellId,
    ...(usesOf(cast.uses, definition) ? { uses: usesOf(cast.uses, definition)! } : {}),
    // The bearer's own slot is spent on top of the item's charges when the item says so.
    ...(cast.consumesSpellSlot === true && level >= 1 ? { spellSlot: { level: Math.min(9, level) } } : {})
  };
  if (!spell) return base;

  const caster = casterNumbers(definition);
  // An authored `ability` powers the item; absent, the wielder's own.
  const ability = cast.ability ?? caster.ability;
  const upcast =
    level > spell.level
      ? (spell.castingOptions?.find((option) => option.type === `slot_level_${level}`)?.damageRoll ?? null)
      : null;
  const formula = upcast ?? spell.damage?.roll ?? null;
  const damageType = spell.damage?.types?.[0] ?? "force";
  const attackBonus =
    cast.ability !== undefined || caster.attackBonus === null
      ? scoreModifierOf(definition, ability) + caster.proficiencyBonus
      : caster.attackBonus;
  const saveDc =
    cast.saveDc ??
    (cast.ability !== undefined || caster.saveDc === null
      ? 8 + scoreModifierOf(definition, ability) + caster.proficiencyBonus
      : caster.saveDc);
  return {
    ...base,
    ...(spell.attackRoll === true ? { attack: { bonus: attackBonus } } : {}),
    ...(spell.save ? { save: { ...spell.save, dc: clampDc(saveDc) } } : {}),
    ...(formula ? { damage: [{ formula, type: damageType }] } : {})
  };
}

/** Finesse takes the better of STR and DEX, ranged takes DEX, else STR. Shared with Graze. */
export function weaponAbilityModifier(item: InventoryItem, definition: ActorDefinition | undefined): number {
  const weapon = item.weapon;
  if (!weapon || !definition) return 0;
  // The rule lives in `@vtt/rules-5e` so the sheet's tap-to-roll preview derives the same number.
  return weaponAbilityModifierFrom(
    weapon.properties ?? [],
    weapon.rangeFeet,
    abilityModifier(definition.abilityScores.str),
    abilityModifier(definition.abilityScores.dex)
  );
}

/** An attack action for an equipped weapon. Absent `proficiencies.weapons` means "not recorded", so proficient. */
export function weaponAction(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  grantedWeapons: readonly string[] = []
): ActorAction | null {
  const weapon = item.weapon;
  if (!weapon || !definition) return null;
  const properties = weapon.properties ?? [];
  const modifier = weaponAbilityModifier(item, definition);
  const trained = definition.proficiencies?.weapons;
  // A bound template row also answers to its base weapon's id for proficiency.
  const ids = item.baseId !== undefined ? [item.id, item.baseId] : [item.id];
  const granted = grantedWeapons.includes(weapon.category) || ids.some((id) => grantedWeapons.includes(id));
  const proficient =
    granted || trained === undefined || trained.includes(weapon.category) || ids.some((id) => trained.includes(id));
  const bonus = modifier + (proficient ? definition.proficiencyBonus : 0);
  const damageFormula = `${weapon.damageDice}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`;
  return {
    id: itemActionId(item.id),
    name: item.name,
    activation: "action",
    description: `Attack with ${item.name}.`,
    attack: {
      bonus,
      ...(weapon.rangeFeet === null || properties.includes("thrown")
        ? { reachFeet: properties.includes("reach") ? 10 : 5 }
        : {}),
      ...(weapon.rangeFeet !== null
        ? { rangeFeet: weapon.longRangeFeet ?? weapon.rangeFeet, rangeNormalFeet: weapon.rangeFeet }
        : {})
    },
    damage: [{ formula: damageFormula, type: weapon.damageType }]
  };
}

/** The inventory with each row's mechanical slot resolved from the catalog (`effectiveSlot` needs it). */
export function withResolvedSlots(
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): readonly (InventoryItem & { slot?: string })[] {
  if (!catalog) return inventory;
  return inventory.map((item) => {
    const slot = catalog.equipmentRecord(item.id)?.slot ?? item.magic?.slot;
    return slot === undefined ? item : { ...item, slot };
  });
}

/** The item id a derived action belongs to, or null for a stat-block action. Drives `scope: "this-item"`. */
export function sourceItemOf(
  action: Pick<ActorAction, "id">,
  derivation: EquipmentDerivation,
  inventory: readonly InventoryItem[]
): string | null {
  if (!isItemActionId(action.id)) return null;
  const rest = action.id.slice(ACTION_ID_PREFIX.length);
  // Ids are `item-<itemId>` or `item-<itemId>-<suffix>`; the longest matching inventory id wins.
  let best: string | null = null;
  for (const item of inventory) {
    if ((rest === item.id || rest.startsWith(`${item.id}-`)) && (best === null || item.id.length > best.length))
      best = item.id;
  }
  return best ?? derivation.sources.find((source) => rest.startsWith(source.itemId))?.itemId ?? null;
}

/** The weapon property list for a derived action's item, so `weapon-property-is` can narrow. */
export function weaponPropertiesOf(itemId: string | null, inventory: readonly InventoryItem[]): readonly string[] {
  if (itemId === null) return [];
  return inventory.find((item) => item.id === itemId)?.weapon?.properties ?? [];
}

export type { ArmorWeight };
