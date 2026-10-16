import type { Actor } from "@vtt/domain";
import type {
  EquipmentReference,
  FeatReference,
  FeatureOption,
  FeatureRecord,
  SpellReference
} from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type ActorAction, type ActorDefinition, type InventoryItem, type Modifier } from "@vtt/schemas";
import {
  armorWeightOf,
  collectRiders,
  effectiveSlot,
  gatePasses,
  isMeleeWeapon,
  sumRiders,
  type RiderAbility,
  type RiderCarrier,
  type RiderContext,
  type RiderMoment,
  type ResolvedRider,
  type RollModeSource
} from "@vtt/rules-5e";
import { isIncapacitated } from "./condition-rules.js";
import {
  castAction,
  extraAttackAction,
  isItemActionId,
  itemAction,
  itemActionRest,
  UNARMED_STRIKE_ACTION_ID,
  weaponAbilityModifier,
  weaponSwing
} from "./item-actions.js";
import { freesLightExtraAttack, IMPLEMENTED_MASTERIES, type MasteryInForce } from "./weapon-mastery.js";

/**
 * Every rider contribution is a pure function of (actor, definition, catalog), recomputed whole on every read
 * and never merged into the definition or stored on the actor: unequipping or an effect ending needs no undo,
 * and there is no new state for a projection to leak. Carriers are the active items (and the feats they grant),
 * the character's own feats and features, and the actor's live effects, all read by one evaluator
 * (`collectRiders`) against one context. Riders live on the content record, never on `InventoryItem`, and are
 * gated on attunement, so a cursed item's mechanics can't reach the player before it is attuned. Never
 * pre-apply a cursed rider.
 */

/** How `definition.character.features` names one record; ids alone are ambiguous across classes. */
export type CharacterFeatureRef = Readonly<{
  id: string;
  kind: "class" | "subclass" | "species" | "lineage" | "background" | "option";
  sourceId: string;
}>;

/** A carrier of the feature rider block: a class/subclass/species/background feature or an inline option. */
type RiderBlock = FeatureRecord | FeatureOption;

/** Modifier types `interpretFeature` bakes into the definition at build time, so they must not also be
 *  collected from feat/feature carriers. With `CARRIER_RIDER_DISPOSITION` this partitions the vocabulary.
 *  Declared here because this module is import-safe for `character-build.ts`. */
export const BUILDER_BAKED_MODIFIER_TYPES = [
  "ability-score",
  "hit-points-per-level",
  "speed",
  "initiative",
  "unarmored-defense",
  "darkvision"
] as const satisfies readonly Modifier["type"][];
const BUILDER_BAKED: ReadonlySet<string> = new Set(BUILDER_BAKED_MODIFIER_TYPES);

/** Whether a mastery slug has a behaviour; derived from `weapon-mastery.ts`'s handler registry. */
export const masteryReaches = (mastery: string): boolean => IMPLEMENTED_MASTERIES.has(mastery);

/** The catalog hooks the derivation reads. A `ContentView` at the GM audience satisfies it, so a player can still
 *  roll their own GM-only item; what a player may browse is gated on the catalog read. */
export type EquipmentCatalog = Readonly<{
  equipmentRecord: (id: string) => EquipmentReference | undefined;
  featRecord?: (id: string) => FeatReference | undefined;
  /** The class/subclass/species/lineage/background feature (or inline option) a sheet's `character.features` entry names. */
  featureRecord?: (ref: CharacterFeatureRef) => RiderBlock | undefined;
  /** The spell an item's `casts` entry names, so the synthesised cast can resolve real damage/attack/save. */
  spellRecord?: (id: string) => SpellReference | undefined;
}>;

/** Narrows a content view to the four hooks the derivation reads. */
export function equipmentCatalogOf(view: EquipmentCatalog): EquipmentCatalog {
  return {
    equipmentRecord: view.equipmentRecord,
    ...(view.featRecord ? { featRecord: view.featRecord } : {}),
    ...(view.featureRecord ? { featureRecord: view.featureRecord } : {}),
    ...(view.spellRecord ? { spellRecord: view.spellRecord } : {})
  };
}

// The derived block

type SourcedTier = Readonly<{ id: string; proficiency: "proficient" | "expertise"; sourceItemId: string }>;
type Sourced = Readonly<{ id: string; sourceItemId: string }>;
/** A damage or condition defence and what the table is told grants it ("resistance: Raging"). */
type Defence = Readonly<{ id: string; source: string }>;

/** Everything the actor's carriers currently contribute. Replaced whole on every recompute. */
export type EquipmentDerivation = Readonly<{
  skills: readonly SourcedTier[];
  saves: readonly Sourced[];
  /** Read by the damage pipeline beside the definition's own defences. */
  damageResistances: readonly Defence[];
  damageVulnerabilities: readonly Defence[];
  damageImmunities: readonly Defence[];
  /** Conditions refused; `setCondition` narrates the skip as it does for an innate immunity. */
  conditionImmunities: readonly Defence[];
  /** The standing sums written onto the actor when its inventory changes. */
  armorClass: number;
  initiative: number;
  spellSlots: readonly Readonly<{ level: number; amount: number }>[];
  /** The standing halves of the save and check bonuses; the momentary halves are collected per roll. */
  saveBonus: number;
  checkBonus: number;
  /** Active carriers with `when` intact, for every roll-time pass. */
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
  /** Magic items the bearer may attune beyond the SRD's three (Use Magic Device). */
  attunementSlots: number;
  /** Equipped body armor the bearer has no training with (SRD Armor Training: Disadvantage on Strength and
   *  Dexterity D20 Tests, and no spellcasting), or null. */
  untrainedArmor: WornItem | null;
  /** An equipped Shield the bearer has no training with: it gives no AC. */
  untrainedShield: WornItem | null;
}>;

/** An equipped item the rules name in a refusal or a roll card. */
export type WornItem = Readonly<{ itemId: string; name: string }>;

export const EMPTY_DERIVATION: EquipmentDerivation = Object.freeze({
  skills: [],
  saves: [],
  damageResistances: [],
  damageVulnerabilities: [],
  damageImmunities: [],
  conditionImmunities: [],
  armorClass: 0,
  initiative: 0,
  spellSlots: [],
  saveBonus: 0,
  checkBonus: 0,
  carriers: [],
  context: {},
  actions: [],
  weaponActionIds: [],
  masteryByActionId: {},
  sources: [],
  attunementSlots: 0,
  untrainedArmor: null,
  untrainedShield: null
});

/** Whether an item's riders apply: equipped, present and (if required) attuned. A cursed item contributes
 *  nothing before attunement. No catalog record fails open to mundane. */
export function itemIsActive(item: InventoryItem, record: EquipmentReference | undefined): boolean {
  if (item.quantity <= 0 || !item.equipped) return false;
  const requiresAttunement = record?.attunement?.required === true || item.magic?.attunementRequired === true;
  return requiresAttunement ? item.attuned : true;
}

type ActiveItem = Readonly<{ item: InventoryItem; record: EquipmentReference | undefined }>;
/** `effectiveSlot` input: the catalog's mechanical slot wins, then the row's marker, then category. */
const slotView = (entry: ActiveItem) => ({
  slot: entry.record?.slot ?? entry.item.magic?.slot,
  category: entry.item.category
});

/** Whether recorded armor training covers one weight, or Shields. A sheet that records no armor training at all (an
 *  import, a monster: "a monster has training with any armor in its stat block") counts as trained. Slugs are
 *  matched as content and imports spell them ("heavy", "heavy-armor", "shields", "all-armor"). */
export function armorTrainingCovers(
  recorded: readonly string[] | undefined,
  granted: readonly string[],
  kind: "light" | "medium" | "heavy" | "shields"
): boolean {
  if (recorded === undefined) return true;
  return [...recorded, ...granted].some((raw) => {
    const slug = raw.replace(/-armor$/, "");
    return slug === kind || slug === "all" || (kind === "shields" && slug === "shield");
  });
}

/** The worn body armor and Shield the bearer lacks training with. `granted` is item-granted armor training. */
export function armorTrainingGaps(
  inventory: readonly (InventoryItem & { slot?: string })[],
  definition: ActorDefinition | undefined,
  granted: readonly string[] = []
): Readonly<{ untrainedArmor: WornItem | null; untrainedShield: WornItem | null }> {
  const recorded = definition?.proficiencies?.armor;
  const worn = inventory.filter((item) => item.equipped && item.quantity > 0 && item.armor !== undefined);
  const view = (item: InventoryItem & { slot?: string }) => ({
    slot: item.slot ?? item.magic?.slot,
    category: item.category
  });
  const body = worn.find((item) => effectiveSlot(view(item)) === "armor");
  const shield = worn.find((item) => effectiveSlot(view(item)) === "shield");
  const untrained = (item: InventoryItem | undefined, kind: "light" | "medium" | "heavy" | "shields") =>
    item && !armorTrainingCovers(recorded, granted, kind) ? { itemId: item.id, name: item.name } : null;
  return {
    untrainedArmor: untrained(body, body ? armorWeightOf(body.armor!) : "light"),
    untrainedShield: untrained(shield, "shields")
  };
}

/** What wearing body armor costs (SRD Armor), as carriers every roll reads like any other rider: the Strength
 *  requirement's -10 feet, Disadvantage on Dexterity (Stealth) checks, and, without training, Disadvantage on
 *  Strength and Dexterity D20 Tests (attack rolls, saves, checks and Initiative, a Dexterity check). */
function bodyArmorCarriers(
  worn: ActiveItem | undefined,
  definition: ActorDefinition | undefined,
  untrained: boolean
): RiderCarrier[] {
  const body = worn?.item;
  const armor = body?.armor;
  if (!body || !armor) return [];
  const carriers: RiderCarrier[] = [];
  // Mithral keeps neither drawback, whatever a row bound before the rule copied from its base.
  const drawbacks = worn?.record?.removesArmorDrawbacks !== true;
  const strength = definition?.abilityScores.str;
  if (drawbacks && armor.strengthRequired !== null && strength !== undefined && strength < armor.strengthRequired)
    carriers.push({
      label: `${body.name} (needs Strength ${armor.strengthRequired})`,
      sourceItemId: body.id,
      modifiers: [{ type: "speed", amount: -10 }]
    });
  if (drawbacks && armor.stealthDisadvantage)
    carriers.push({
      label: `${body.name} (Stealth)`,
      sourceItemId: body.id,
      modifiers: [
        {
          type: "roll-mode",
          roll: "check",
          mode: "disadvantage",
          when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["stealth"] }]
        }
      ]
    });
  if (untrained) {
    const strOrDex = { type: "ability-is", abilities: ["str", "dex"] } as const;
    carriers.push({
      label: `${body.name} (no armor training)`,
      sourceItemId: body.id,
      modifiers: [
        {
          type: "roll-mode",
          roll: "attack",
          mode: "disadvantage",
          when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["melee", "ranged"] }]
        },
        { type: "roll-mode", roll: "save", mode: "disadvantage", when: [{ type: "on-saving-throw" }, strOrDex] },
        { type: "roll-mode", roll: "check", mode: "disadvantage", when: [{ type: "on-ability-check" }, strOrDex] },
        { type: "roll-mode", roll: "initiative", mode: "disadvantage" }
      ]
    });
  }
  return carriers;
}

/** The bearer's facts flattened once; `granted` adds item-granted training and effect tags to the sheet's own. */
function bearerContext(
  actor: Actor,
  definition: ActorDefinition | undefined,
  worn: readonly ActiveItem[],
  granted: Readonly<{
    weapons: readonly string[];
    armor: readonly string[];
    tools: readonly string[];
    effectTags: readonly string[];
  }>
): Omit<RiderContext, "moment"> {
  const armored = worn.filter((entry) => entry.item.armor !== undefined);
  const bodyArmor = armored.find((entry) => effectiveSlot(slotView(entry)) === "armor");
  const identity = definition?.character;
  const proficiencies = definition?.proficiencies;
  return {
    attunedItemIds: actor.inventory.filter((item) => item.attuned).map((item) => item.id),
    armorWeight: bodyArmor ? armorWeightOf(bodyArmor.item.armor!) : null,
    shieldEquipped: armored.some((entry) => effectiveSlot(slotView(entry)) === "shield"),
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

/** `scope: "this-item"` on a carrier that is no item would degrade to "bearer" in `scopeOf`, turning "only with
 *  this weapon" into "always"; fail closed instead. */
const notItemScoped = (modifier: Modifier): boolean => modifier.scope !== "this-item";

/** Which of a character's own feat or feature riders the collector may see: not the builder-baked ones, which
 *  are already inside the definition's numbers, except a gated `speed` the build leaves for the live loadout. */
const ridesOnTheBearer = (modifier: Modifier): boolean =>
  (!BUILDER_BAKED.has(modifier.type) || (modifier.type === "speed" && (modifier.when?.length ?? 0) > 0)) &&
  notItemScoped(modifier);

/** The character's own feats and features (with chosen options) as rider carriers, recomputed from the sheet and
 *  the catalog so homebrew edits apply on the next read. Definitions without the arrays (PDF imports, monsters)
 *  get none; a deleted or renamed record contributes prose only. */
function characterCarriers(definition: ActorDefinition | undefined, catalog: EquipmentCatalog): RiderCarrier[] {
  const blocks: Array<Readonly<{ name: string; modifiers: readonly Modifier[] }>> = [];
  for (const held of definition?.character?.feats ?? []) {
    const record = catalog.featRecord?.(held.id);
    if (record) blocks.push({ name: record.name, modifiers: record.feature.modifiers });
  }
  for (const held of definition?.character?.features ?? []) {
    const record = catalog.featureRecord?.(held);
    if (record) blocks.push(record);
  }
  return blocks.flatMap((block) => {
    const modifiers = block.modifiers.filter(ridesOnTheBearer);
    return modifiers.length > 0 ? [{ label: block.name, modifiers }] : [];
  });
}

/** Own feats/features whose grants block is gated; ungated ones are already baked into the definition. */
function characterGatedGrants(
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): ReadonlyArray<Readonly<{ id: string; name: string; block: RiderBlock }>> {
  const gated: Array<Readonly<{ id: string; name: string; block: RiderBlock }>> = [];
  for (const held of definition?.character?.feats ?? []) {
    const record = catalog.featRecord?.(held.id);
    if (record?.feature.grants?.when) gated.push({ id: record.id, name: record.name, block: record.feature });
  }
  for (const held of definition?.character?.features ?? []) {
    const record = catalog.featureRecord?.(held);
    if (record?.grants?.when) gated.push({ id: record.id, name: record.name, block: record });
  }
  return gated;
}

/** The actor's live effects as rider carriers. An effect that lapses while its bearer is incapacitated (Dodge)
 *  carries nothing then. */
function effectCarriers(actor: Actor): RiderCarrier[] {
  const incapacitated = isIncapacitated(actor);
  return actor.effects.flatMap((effect) => {
    if (effect.voidWhileIncapacitated && incapacitated) return [];
    const modifiers = effect.modifiers.filter(notItemScoped);
    if (modifiers.length === 0) return [];
    return [
      {
        label: effect.name,
        modifiers,
        sourceEffectId: effect.id,
        ...(effect.stackKey !== undefined ? { stackKey: effect.stackKey } : {})
      }
    ];
  });
}

/** Derives the whole rider contribution. Pure. Item-granted feats fold in at depth 1 (nothing names an item, so
 *  no cycles). Not memoized: effects, conditions and hp change without the inventory moving. Without a catalog
 *  only the live effects contribute. */
export function deriveEquipment(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): EquipmentDerivation {
  // `equipped` makes a weapon swingable; `active` (also attuned where required) makes its riders apply.
  // An unattuned cursed blade is indistinguishable from a mundane one.
  const equipped: ActiveItem[] = [];
  const active: ActiveItem[] = [];
  /** Potions and flasks in the pack: only their actions, which use one up. */
  const packed: ActiveItem[] = [];
  for (const item of catalog ? actor.inventory : []) {
    if (item.quantity <= 0) continue;
    const record = catalog!.equipmentRecord(catalogIdOf(item));
    const entry = { item, record };
    if (item.equipped) equipped.push(entry);
    if (item.equipped && itemIsActive(item, record)) active.push(entry);
    else if (record?.consumedOnUse) packed.push(entry);
  }
  const carriers: RiderCarrier[] = [
    ...(catalog ? characterCarriers(definition, catalog) : []),
    ...effectCarriers(actor)
  ];
  const gatedGrants = catalog ? characterGatedGrants(definition, catalog) : [];
  if (equipped.length === 0 && packed.length === 0 && carriers.length === 0 && gatedGrants.length === 0)
    return EMPTY_DERIVATION;
  /** Feats the character already holds, so an item granting one adds nothing twice. */
  const heldFeatIds = new Set((definition?.character?.feats ?? []).map((feat) => feat.id));

  const actions: ActorAction[] = [];
  const sources: Array<{ itemId: string; itemName: string; summary: string }> = [];
  const skills: SourcedTier[] = [];
  const saves: Sourced[] = [];
  const tools: string[] = [];
  const damageResistances: Defence[] = [];
  const damageImmunities: Defence[] = [];
  const conditionImmunities: Defence[] = [];
  const armorProficiencies: string[] = [];
  const weaponProficiencies: string[] = [];
  const itemEffectTags: string[] = [];

  // Gated grants see the bearer's own sheet and live state, not what other grants hand over in this same
  // recompute (circular). Chained grants therefore don't fire: under-granting beats over-granting.
  const gateContext = bearerContext(actor, definition, equipped, { weapons: [], armor: [], tools: [], effectTags: [] });

  /** Returns whether the block's gate held, so a caller can skip provenance for one that did not. */
  const takeGrants = (block: RiderBlock | EquipmentReference, itemId: string, source: string): boolean => {
    const grants = block.grants;
    if (!grants) return false;
    // Absent `when` is unconditional. A trigger this build cannot evaluate refuses the whole block.
    if (!gatePasses(grants.when, gateContext, itemId)) return false;
    for (const id of grants.skills) skills.push({ id, proficiency: "proficient", sourceItemId: itemId });
    for (const id of grants.expertise) skills.push({ id, proficiency: "expertise", sourceItemId: itemId });
    for (const id of grants.saves) saves.push({ id, sourceItemId: itemId });
    tools.push(...grants.tools);
    for (const id of grants.damageResistances) damageResistances.push({ id, source });
    for (const id of grants.damageImmunities) damageImmunities.push({ id, source });
    for (const id of grants.conditionImmunities) conditionImmunities.push({ id, source });
    armorProficiencies.push(...grants.armor);
    weaponProficiencies.push(...grants.weapons);
    return true;
  };

  /** An item's own effects apply while it is active, as carriers rather than live effects on the actor. */
  const takeEffects = (block: RiderBlock | EquipmentReference, itemId: string, itemLabel: string) => {
    for (const effect of block.effects) {
      itemEffectTags.push(...effect.tags);
      if (effect.modifiers.length === 0) continue;
      const label = effect.name ? `${effect.name} (${itemLabel})` : itemLabel;
      carriers.push({ label, modifiers: effect.modifiers, sourceItemId: itemId });
    }
  };

  for (const entry of active) {
    const { item, record } = entry;
    if (!record) continue;
    const label = record.name;
    const isWeapon = effectiveSlot(slotView(entry)) === "weapon" || item.weapon !== undefined;
    carriers.push({ label, modifiers: record.modifiers, sourceItemId: item.id, isWeapon });
    takeGrants(withChosenResistance(record, item), item.id, label);
    takeEffects(record, item.id, label);
    for (const declared of record.actions) actions.push(itemAction(item, declared, definition));
    for (const cast of record.casts)
      actions.push(castAction(item, cast, label, definition, catalog!.spellRecord?.(cast.spellId)));
    // Depth 1: the feat's riders join this block, so unequipping removes them in one recomputation.
    for (const featId of record.grantsFeatIds) {
      // Already a builder carrier (with its baked half in the definition); granting again would double it.
      if (heldFeatIds.has(featId)) continue;
      const feat = catalog!.featRecord?.(featId);
      if (!feat) continue;
      const featLabel = `${feat.name} (${label})`;
      carriers.push({ label: featLabel, modifiers: feat.feature.modifiers, sourceItemId: item.id });
      takeGrants(feat.feature, item.id, featLabel);
      takeEffects(feat.feature, item.id, featLabel);
    }
    if (record.modifiers.length > 0 || record.grants || record.effects.length > 0 || record.grantsFeatIds.length > 0)
      sources.push({ itemId: item.id, itemName: label, summary: summarise(record) });
  }
  for (const { item, record } of packed)
    for (const declared of record?.actions ?? []) actions.push(itemAction(item, declared, definition));
  // Gated grants on own feats/features (the builder baked only ungated ones). The `feature:<id>` source
  // is never in `attunedItemIds`, so an `attuned` gate on a feature fails closed.
  for (const { id, name, block } of gatedGrants) {
    const sourceId = `feature:${id}`;
    if (takeGrants(block, sourceId, name))
      sources.push({ itemId: sourceId, itemName: name, summary: summarise(block) });
  }

  // Weapon attacks come from the equipped list, not the active one. Item-granted weapon training
  // already applies in this recomputation.
  const weaponActionIds: string[] = [];
  // Weapons this character spent a Weapon Mastery pick on, read from the stored choice ledger.
  const unlocked = new Set(
    (definition?.character?.choices ?? []).filter((row) => row.kind === "weapon-mastery").map((row) => row.id)
  );
  const masteryByActionId: Record<string, MasteryInForce> = {};
  // Martial Arts holds only while the Monk wears no armour and wields no shield (SRD 5.2.1).
  const martialArtsInForce =
    definition?.character?.martialArts !== undefined &&
    !equipped.some(
      (entry) => entry.item.armor !== undefined && ["armor", "shield"].includes(effectiveSlot(slotView(entry)))
    );
  // The Light property's extra attack needs a second Light weapon in hand: another one, or a pair of the same.
  const lightWeaponsInHand = equipped
    .filter((entry) => entry.item.weapon?.properties?.includes("light"))
    .reduce((count, entry) => count + Math.max(1, entry.item.quantity), 0);
  const twoWeaponFighting = (definition?.character?.feats ?? []).some((feat) => feat.id === "two-weapon-fighting");
  // A Shield is strapped to one arm, so a Versatile weapon can't take its two-handed grip beside it.
  const shieldInHand = equipped.some(
    (entry) => entry.item.armor !== undefined && effectiveSlot(slotView(entry)) === "shield"
  );
  for (const equippedEntry of equipped) {
    const entry = { ...equippedEntry, item: withCatalogWeaponFacts(equippedEntry, catalog!) };
    const swing = weaponSwing(entry.item, definition, weaponProficiencies, martialArtsInForce);
    if (!swing) continue;
    const weaponAttack = swing.action;
    actions.push(weaponAttack);
    weaponActionIds.push(weaponAttack.id);
    const twoHanded = shieldInHand
      ? null
      : weaponSwing(entry.item, definition, weaponProficiencies, martialArtsInForce, { twoHanded: true });
    if (twoHanded) {
      actions.push(twoHanded.action);
      weaponActionIds.push(twoHanded.action.id);
    }
    const heavy = heavyWeaponCarrier(entry.item, definition);
    if (heavy) carriers.push(heavy);
    // A template row bound via `baseId` is that base weapon, so it carries the base's mastery and a pick
    // on that weapon kind covers it (SRD picks are per weapon kind).
    const baseRecord = entry.item.baseId !== undefined ? catalog!.equipmentRecord(entry.item.baseId) : undefined;
    const mastery = entry.record?.weapon?.mastery ?? baseRecord?.weapon?.mastery;
    const unlockedHere =
      unlocked.has(catalogIdOf(entry.item)) || (entry.item.baseId !== undefined && unlocked.has(entry.item.baseId));
    // The weapon has a mastery, the bearer unlocked this weapon, and the engine implements it.
    const inForce: MasteryInForce | null =
      mastery && unlockedHere && masteryReaches(mastery)
        ? { id: mastery, abilityModifier: weaponAbilityModifier(entry.item, definition, martialArtsInForce) }
        : null;
    if (inForce) masteryByActionId[weaponAttack.id] = inForce;
    if (inForce && twoHanded) masteryByActionId[twoHanded.action.id] = inForce;
    // The extra attacks the weapon can make beside its own (not Extra Attack's to multiply, so not weapon swings
    // for `weaponActionIds`). The Light one carries the weapon's mastery; Cleave's is the mastery itself.
    if (entry.item.weapon?.properties?.includes("light") && lightWeaponsInHand >= 2) {
      const extra = extraAttackAction(entry.item, swing, "light", {
        insideAttackAction: freesLightExtraAttack(inForce?.id),
        keepModifier: twoWeaponFighting
      });
      actions.push(extra);
      if (inForce) masteryByActionId[extra.id] = inForce;
    }
    if (inForce?.id === "cleave" && weaponAttack.attack?.reachFeet !== undefined)
      actions.push(extraAttackAction(entry.item, swing, "cleave"));
  }
  // A builder-minted unarmed strike (Monk Martial Arts) is a weapon swing too, so Extra Attack reaches it.
  if (definition?.actions.some((action) => action.id === UNARMED_STRIKE_ACTION_ID && action.attack !== undefined)) {
    weaponActionIds.push(UNARMED_STRIKE_ACTION_ID);
  }

  // Armor training counts what items grant in this same recomputation (Elven Chain-style training).
  const training = armorTrainingGaps(withResolvedSlots(actor.inventory, catalog), definition, armorProficiencies);
  const body = equipped.find((entry) => entry.item.armor !== undefined && effectiveSlot(slotView(entry)) === "armor");
  carriers.push(...bodyArmorCarriers(body, definition, training.untrainedArmor !== null));

  // The standing + conditional pass: riders naming no moment whose static and dynamic gates pass.
  const context = bearerContext(actor, definition, equipped, {
    weapons: weaponProficiencies,
    armor: armorProficiencies,
    tools,
    effectTags: itemEffectTags
  });
  const standing = collectRiders(carriers, { ...context, moment: null });
  return {
    context,
    skills,
    saves,
    damageResistances: [...damageResistances, ...defencesOf(standing, "damage-resistance")],
    damageVulnerabilities: defencesOf(standing, "damage-vulnerability"),
    damageImmunities,
    conditionImmunities,
    armorClass: sumRiders(standing, "armor-class"),
    // "Add your Proficiency Bonus" is proficiency, so it counts once however many carriers grant it.
    initiative:
      sumRiders(standing, "initiative") +
      (standing.some((rider) => rider.modifier.type === "initiative" && rider.modifier.proficiencyBonus)
        ? (definition?.proficiencyBonus ?? 0)
        : 0),
    saveBonus: sumRiders(standing, "save-bonus"),
    checkBonus: sumRiders(standing, "check-bonus"),
    spellSlots: standing.flatMap((rider) =>
      rider.modifier.type === "spell-slot" && rider.modifier.level !== undefined
        ? [{ level: rider.modifier.level, amount: rider.modifier.amount ?? 0 }]
        : []
    ),
    carriers,
    actions,
    weaponActionIds,
    masteryByActionId,
    sources,
    attunementSlots: sumRiders(standing, "attunement-slots"),
    ...training
  };
}

/** A weapon row with the catalog's melee band and Versatile die filled in, for rows stored before the row carried
 *  them (a bound template reads its base's). The row's own values win. */
function withCatalogWeaponFacts(entry: ActiveItem, catalog: EquipmentCatalog): InventoryItem {
  const weapon = entry.item.weapon;
  if (!weapon) return entry.item;
  const versatile = weapon.properties?.includes("versatile") === true;
  if (weapon.melee !== undefined && (weapon.versatileDice !== undefined || !versatile)) return entry.item;
  const stats =
    entry.record?.weapon ??
    (entry.item.baseId !== undefined ? catalog.equipmentRecord(entry.item.baseId)?.weapon : undefined);
  if (!stats) return entry.item;
  return {
    ...entry.item,
    weapon: {
      ...weapon,
      ...(weapon.melee === undefined && stats.melee !== undefined ? { melee: stats.melee } : {}),
      ...(weapon.versatileDice === undefined && versatile && stats.versatileDice
        ? { versatileDice: stats.versatileDice }
        : {})
    }
  };
}

/** SRD Heavy: Disadvantage on attack rolls with a Heavy Melee weapon below Strength 13, or a Heavy Ranged weapon
 *  below Dexterity 13. A carrier scoped to this weapon, so it rides the attack roll's roll-mode claims. */
function heavyWeaponCarrier(item: InventoryItem, definition: ActorDefinition | undefined): RiderCarrier | null {
  const weapon = item.weapon;
  if (!weapon?.properties?.includes("heavy") || !definition) return null;
  const melee = isMeleeWeapon(weapon.properties, weapon.rangeFeet, weapon.melee);
  if (definition.abilityScores[melee ? "str" : "dex"] >= 13) return null;
  return {
    label: `${item.name} is Heavy (${melee ? "Strength" : "Dexterity"} under 13)`,
    sourceItemId: item.id,
    isWeapon: true,
    modifiers: [
      {
        type: "roll-mode",
        roll: "attack",
        mode: "disadvantage",
        scope: "this-item",
        when: [{ type: "on-attack-roll" }]
      }
    ]
  };
}

/** The damage types standing `damage-resistance` or `damage-vulnerability` riders name, each with its carrier. */
function defencesOf(riders: readonly ResolvedRider[], type: "damage-resistance" | "damage-vulnerability"): Defence[] {
  return riders.flatMap((rider) =>
    rider.modifier.type === type ? (rider.modifier.damageTypes ?? []).map((id) => ({ id, source: rider.label })) : []
  );
}

/** "The GM chooses the type": the row's pick replaces the record's printed resistance, when it is one of the
 *  record's choices. */
function withChosenResistance(record: EquipmentReference, item: InventoryItem): EquipmentReference {
  const chosen = item.chosenDamageType;
  if (!chosen || !record.grants || !record.damageTypeChoice?.includes(chosen)) return record;
  return { ...record, grants: { ...record.grants, damageResistances: [chosen] } };
}

function summarise(record: RiderBlock | EquipmentReference): string {
  const parts: string[] = record.modifiers.map((modifier) => modifier.type);
  if (record.grants) parts.push("proficiencies");
  if (record.effects.length > 0) parts.push("effects");
  if ("grantsFeatIds" in record && record.grantsFeatIds.length > 0) parts.push("feat");
  return parts.join(", ");
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

/** The whole rider bonus to one ability check: the standing `derivation.checkBonus` plus the momentary
 *  `on-ability-check` riders that `narrow` lets through. */
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

export type RollModeClaims = { advantage: RollModeSource[]; disadvantage: RollModeSource[] };

/** Advantage and disadvantage the carriers claim on a named roll: the standing riders and those firing at
 *  `moment`, two disjoint passes. `filters` narrows the moment (`ability-is`, `attack-kind-is`, ...);
 *  `labelPrefix` marks claims made by the other side of an attack ("Target: "). */
export function rollModeClaims(
  derivation: EquipmentDerivation,
  rolls: readonly Extract<Modifier, { type: "roll-mode" }>["roll"][],
  moment: RiderMoment,
  filters: Omit<RiderContext, "moment"> = {},
  into: RollModeClaims = { advantage: [], disadvantage: [] },
  labelPrefix = ""
): RollModeClaims {
  for (const pass of [null, moment]) {
    for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ...filters, moment: pass })) {
      const { type, roll, mode } = rider.modifier;
      if (type !== "roll-mode" || roll === undefined || mode === undefined || !rolls.includes(roll)) continue;
      into[mode === "advantage" ? "advantage" : "disadvantage"].push({
        source: rider.sourceEffectId ?? `item:${rider.sourceItemId ?? rider.label}`,
        label: `${labelPrefix}${rider.label}`
      });
    }
  }
  return into;
}

/** The inventory with each row's mechanical slot resolved from the catalog (`effectiveSlot` needs it). */
export function withResolvedSlots(
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): readonly (InventoryItem & { slot?: string })[] {
  if (!catalog) return inventory;
  return inventory.map((item) => {
    const slot = catalog.equipmentRecord(catalogIdOf(item))?.slot ?? item.magic?.slot;
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
  const rest = itemActionRest(action.id);
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
