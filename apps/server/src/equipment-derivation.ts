import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";
import {
  abilityModifier, armorWeightOf, collectRiders, effectiveSlot, sumRiders,
  type ArmorWeight, type RiderAbility, type RiderCarrier, type RiderContext, type RiderModifier, type ResolvedRider
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

/**
 * The rider block every carrier shares (`featureRiders`), as this module reads it.
 *
 * `grants` names ALL TEN keys `FeatureGrantsSchema` offers. It used to name six, and the other four
 * (armor, weapons, damageImmunities, conditionImmunities) were authored in the homebrew editor,
 * stored on the record, and dropped here without a trace - the reading surface was the whole
 * silence. Every key below has a consumer; see `takeGrants` and its callers.
 */
export type RiderBlockLike = Readonly<{
  modifiers?: readonly RiderModifier[];
  grants?: Readonly<{
    skills?: readonly string[]; expertise?: readonly string[]; tools?: readonly string[];
    languages?: readonly string[]; saves?: readonly string[]; damageResistances?: readonly string[];
    armor?: readonly string[]; weapons?: readonly string[];
    damageImmunities?: readonly string[]; conditionImmunities?: readonly string[];
  }>;
  actions?: readonly RiderActionLike[];
  /** Standing effects the item carries while active (see `itemEffectCarrier`). */
  effects?: readonly ItemEffectLike[];
  uses?: RiderUsesLike;
}>;
/**
 * Limited uses as the AUTHORING vocabulary actually prints them. `FeatureUsesSchema.limit` is
 * OPTIONAL - a `scaling` rule is the second way to express a count - and an item spreads the very
 * same `featureRiders` object a class feature does, so an item's `uses` carries `scaling` too.
 *
 * This view used to claim `limit: number`. It was wrong, and because `apps/server/test/` was outside
 * the TypeScript program (hazard H1) the compile-time claim in `item-riders.test.ts` could not say
 * so: `EquipmentReferenceSchema`'s own output type has never been assignable to `EquipmentRecordLike`.
 * `usesOf` resolves the printed forms against the bearer, the same way `character-build.ts`'s
 * `resolvedUseLimit` does for a feature.
 */
export type RiderUsesLike = Readonly<{
  limit?: number; per: string; pool?: string; recharge?: number;
  scaling?:
    | Readonly<{ type: "proficiency-bonus" }>
    | Readonly<{ type: "ability-modifier"; ability: RiderAbility; minimum?: number }>
    | Readonly<{ type: "by-level"; table: readonly Readonly<{ level: number; limit: number }>[] }>
    /** Reads the class table's printed column by `classResources.id`. An ITEM has no class table, so it resolves to nothing here - see `scaledLimit`. */
    | Readonly<{ type: "class-resource"; id: string }>;
}>;
/**
 * A `FeatureAction` as synthesised here.
 *
 * `attack` and `save` carry the TEMPLATE forms (`FeatureAttackSchema` / `FeatureSaveSchema`): a
 * content record cannot know the bearer's ability scores, so it names the ability and the number is
 * derived at read time - exactly what `character-build.ts`'s `interpretAction` does at build time
 * for a feature. Both halves were authored-and-dropped before this: an item action resolved as a
 * damage-only prompt with no to-hit and no save, while the SAME authored shape on a class feature
 * became a real attack.
 */
export type RiderActionLike = Readonly<{
  id: string; name: string; description?: string;
  activation?: "action" | "bonus-action" | "reaction" | "other";
  attack?: Readonly<{
    ability: RiderAbility | "spellcasting"; proficient?: boolean;
    reachFeet?: number; rangeFeet?: number; rangeNormalFeet?: number; count?: number; criticalBonusDice?: number;
  }>;
  save?: Readonly<{ ability: RiderAbility; dc: FeatureSaveDcLike }>;
  damage?: readonly Readonly<{ formula: string; type: string }>[];
  uses?: RiderUsesLike;
}>;
/** `FeatureSaveDcSchema`'s three printed forms: the character's own spell DC, a flat number, or `base + ability (+ PB)`. */
export type FeatureSaveDcLike = "spellcasting" | number | Readonly<{ base?: number; ability: RiderAbility; proficiencyBonus?: boolean }>;
/**
 * One effect an item carries (`EffectGrantSchema`, the actor-side vocabulary). Read as a STANDING
 * rider carrier while the item is active rather than written onto the actor: an item effect is not
 * a live effect anyone cast, it is a property of wearing the thing, and writing it would need an
 * un-write on unequip - the exact accumulation this module exists to avoid.
 */
export type ItemEffectLike = Readonly<{
  name?: string;
  tags?: readonly string[];
  modifiers?: readonly ItemEffectModifierLike[];
}>;
/** An `EffectModifier` structurally: the rider fields plus `damageTypes`, which only the effect vocabulary carries. */
export type ItemEffectModifierLike = RiderModifier & Readonly<{ damageTypes?: readonly string[] }>;
export type EquipmentRecordLike = RiderBlockLike & Readonly<{
  id: string; name: string; category?: string;
  slot?: string;
  /**
   * The weapon block, read for its MASTERY only - the damage/range half already reaches the engine
   * through the inventory row. Resolved from the catalog by item id rather than stored on the row,
   * which is the same rule an item's riders follow ("Mechanics resolve by `item.id` against the
   * content catalog, which never leaves the server"). No schema change on the wire, no migration, and
   * a GM who re-authors a homebrew weapon's mastery sees it on the next read.
   */
  weapon?: Readonly<{ mastery?: string }> | null;
  isMagic?: boolean;
  attunement?: Readonly<{ required?: boolean; restrictedTo?: readonly string[] }> | null;
  cursed?: boolean;
  casts?: readonly ItemSpellCastLike[];
  grantsFeatIds?: readonly string[];
}>;
/** `ItemSpellCastSchema` in full - all five fields, not just the two that used to be read. */
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
  id: string; name: string; level: number;
  attackRoll?: boolean;
  damage?: Readonly<{ roll: string | null; types: readonly string[] }>;
  save?: RiderAbility | null;
  description?: string;
  castingOptions?: readonly Readonly<{ type: string; damageRoll: string | null; targetCount: number | null }>[];
}>;
export type FeatRecordLike = Readonly<{ id: string; name: string; feature: RiderBlockLike }>;
/**
 * A class / subclass / species / lineage / background FEATURE, or a chosen inline option, as this
 * module reads it. Structurally a `FeatureRecord` (or a `FeatureOption`, which carries the identical
 * `featureRiders` vocabulary): the record IS the rider block, where a feat's is one level down.
 */
export type FeatureRecordLike = RiderBlockLike & Readonly<{ id: string; name: string }>;
/**
 * How `definition.character.features` names one record.
 *
 * A bare id would be AMBIGUOUS and silently wrong: `unarmored-defense` is a Barbarian feature and a
 * Monk feature with different mechanics, `weapon-mastery` belongs to five classes, `spellcasting` to
 * seven, and every class has an `epic-boon`. `kind` + `sourceId` make the lookup exact.
 */
export type CharacterFeatureRef = Readonly<{ id: string; kind: "class" | "subclass" | "species" | "lineage" | "background" | "option"; sourceId: string }>;

/**
 * The rider families `buildCharacterDefinition`'s `interpretFeature` FOLDS INTO the ActorDefinition
 * at build time, and which therefore must NOT be collected again from a feat carrier below.
 *
 * This list and `character-build.ts`'s `CARRIER_RIDER_DISPOSITION` are the two halves of ONE
 * partition of the 21-variant vocabulary, and the partition is what rules out double-counting:
 *
 *   - THESE SEVEN describe a permanent change to the SHAPE OF THE SHEET, and baking is the correct
 *     reading for a feat specifically (`ITEM_REFUSED_MODIFIER_TYPES`' own note: "Both stay fully
 *     available on a FEATURE or FEAT carrier, where baking is correct: a feat is granted once and
 *     never un-granted"). `ability-score` is already inside `definition.abilityScores`,
 *     `hit-points-per-level` inside `hitPoints.maximum`, `speed` inside `speedFeet`, `armor-class`
 *     inside `armorClass` + the `armorClassBonus` extension, `initiative` inside `initiativeBonus`,
 *     `unarmored-defense` inside `armorClass`.
 *     Collecting any of them here would apply the feat's bonus a SECOND time on every read.
 *     `darkvision` is in the list because the builder's switch claims it as an explicit display-only
 *     no-op; leaving it out would split ownership of one variant across both files.
 *   - EVERYTHING ELSE is inherently roll-time (a `roll-mode`, a trigger-gated `attack-bonus`, a
 *     crit-only `extra-damage`) or live state (`spell-slot`, `resource-bonus`), which a build-time
 *     fold structurally cannot express. Those become carriers, read by the SAME `collectRiders` an
 *     item's riders go through.
 *
 * `extra-attack` USED TO BE THE EIGHTH, and moving it out is the whole of that fix. Baking it was
 * not merely a worse reading, it was a fold onto nothing: the builder raised `attack.count` on the
 * actions a FEATURE declares, and no martial class declares one - a Fighter's, Barbarian's, Monk's,
 * Ranger's and Paladin's swings are all derived from equipped inventory, which this very list then
 * excluded from the collector. Measured before the fix: at every level, for every one of those five
 * classes, `definition.actions.filter(a => a.attack)` is EMPTY, so Extra Attack changed no number a
 * player could ever act on. It is now a standing rider like any other, consumed by
 * `effective-actions.ts`'s `withStandingRiders` against `weaponActionIds` below.
 *
 * It lives HERE, next to the filter that reads it, rather than in `character-build.ts` where the
 * baking happens: this module imports no other server module, so `character-build.ts` can import it
 * without a cycle, while the reverse would drag the whole content library into a leaf.
 */
export const BUILDER_BAKED_MODIFIER_TYPES = [
  "ability-score", "hit-points-per-level", "speed", "armor-class",
  "initiative", "unarmored-defense", "darkvision"
] as const;
const BUILDER_BAKED: ReadonlySet<string> = new Set(BUILDER_BAKED_MODIFIER_TYPES);

/**
 * WHICH OF THE EIGHT MASTERIES THE ENGINE ACTUALLY IMPLEMENTS - the one place that answers it.
 *
 * The SRD defines exactly eight mastery properties, and all 38 weapons now name one. That data is
 * worth nothing on its own: a slug on 38 records that no engine path reads is the "built but unwired"
 * failure this repo has already shipped three times, and it looks identical to a feature that works.
 * So the derivation refuses to advertise a mastery it cannot honour, and this set is the gate.
 *
 * Implemented, and proved at the far end (a rolled number, a die that changes):
 *   graze - `action-resolution.ts` rolls the ability modifier as damage on a MISS.
 *   sap   - `action-resolution.ts` puts a real effect on the target; its next attack rolls 2d20kl1.
 *
 * NOT implemented, and therefore deliberately inert rather than half-wired. Each needs engine surface
 * that does not exist yet, sized in the Stage 5 report:
 *   push   - moves a token 10 feet directly away; needs the attack path to write a position.
 *   slow   - -10 Speed until the attacker's next turn; the effect vocabulary has no speed modifier.
 *   topple - a Constitution save the WEAPON triggers, then Prone; the save path is action-declared.
 *   cleave - a second attack roll against a different creature inside one resolution.
 *   nick   - moves the Light property's extra attack out of the bonus action; a turn-economy change.
 *   vex    - Advantage on the attacker's next attack AGAINST THAT CREATURE; effects have no target
 *            scoping, so there is nowhere to hang "against this one foe" today.
 */
const IMPLEMENTED_MASTERIES: ReadonlySet<string> = new Set(["graze", "sap"]);
/**
 * One weapon swing's mastery, as the resolver needs it. The ability modifier travels with the slug
 * because Graze deals "damage equal to the ability modifier you used to make the attack roll", and
 * that choice (finesse takes the better of Str/Dex, a ranged weapon takes Dex) is `weaponAction`'s
 * to make - recomputing it at the resolver would be a second copy of the rule, free to drift.
 */
export type MasteryInForce = Readonly<{ id: string; abilityModifier: number }>;

/** Does this mastery slug reach a real behaviour today? The derivation omits it entirely when not. */
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
    featRecord: (id) => view.featRecord(id) as FeatRecordLike | undefined,
    ...(view.featureRecord ? { featureRecord: (ref: CharacterFeatureRef) => view.featureRecord!(ref) as FeatureRecordLike | undefined } : {}),
    ...(view.spellRecord ? { spellRecord: (id: string) => view.spellRecord!(id) as SpellRecordLike | undefined } : {})
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
  /** Damage the bearer ignores entirely while the item is active; read by the damage pipeline beside the definition's own. */
  damageImmunities: readonly Sourced[];
  /** Conditions the item refuses; `setCondition` narrates the skip exactly as it does for an innate immunity. */
  conditionImmunities: readonly Sourced[];
  /** Armor training the item grants - a rider gate input (`proficient-with`) and the sheet's provenance. */
  armorProficiencies: readonly Sourced[];
  /** Weapon training the item grants; `weaponAction` adds the proficiency bonus for a weapon it covers. */
  weaponProficiencies: readonly Sourced[];
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
  /**
   * WHICH of `actions` are real WEAPON SWINGS - the subset `weaponAction` synthesised from an
   * equipped weapon, as opposed to an item's declared action or a wand's synthesised spell cast.
   *
   * Extra Attack is the reason this exists and the reason it has to be a list rather than a guess.
   * "You can attack twice whenever you take the ATTACK ACTION" - so the rider must raise the count on
   * a swing and on nothing else. Inferring it from `action.attack !== undefined` would hand the same
   * multiplier to a Wand of Magic Missiles' cast and to any item action that happens to roll to hit,
   * which is a rules bug that would look exactly like the feature working.
   */
  weaponActionIds: readonly string[];
  /**
   * THE MASTERY IN FORCE for each weapon swing, keyed by action id - and ONLY where the bearer has
   * actually unlocked it.
   *
   * Two things have to be true for a mastery to do anything, and this map is where they meet:
   * the weapon has one (the SRD table's Mastery column, all 38 rows), and the character has spent one
   * of their Weapon Mastery picks ON THAT WEAPON. A Fighter 1 knows three weapons' masteries, not
   * every weapon's - so a greatsword in the hands of someone who picked longbow, flail and rapier
   * grazes for nothing, and that is the SRD's own rule, not a limitation.
   *
   * A weapon whose mastery is unlocked but not yet IMPLEMENTED is simply absent from this map, so
   * `masteryReaches` below is the single honest answer to "does this slug do anything today".
   */
  masteryByActionId: Readonly<Record<string, MasteryInForce>>;
  /** Provenance for the sheet ("Stealth (Circlet of Shadows)"). */
  sources: readonly Readonly<{ itemId: string; itemName: string; summary: string }>[];
}>;

export const EMPTY_DERIVATION: EquipmentDerivation = Object.freeze({
  skills: [], saves: [], tools: [], languages: [], damageResistances: [], damageImmunities: [],
  conditionImmunities: [], armorProficiencies: [], weaponProficiencies: [], featIds: [],
  armorClass: 0, initiative: 0, speed: 0, saveBonus: 0, checkBonus: 0,
  spellSaveDc: [], spellAttackBonus: [], spellSlots: [], resourceBonus: [],
  carriers: [], context: {}, actions: [], weaponActionIds: [], masteryByActionId: {}, sources: []
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

/**
 * The bearer's static/dynamic facts, flattened once so every trigger reads plain values.
 *
 * `granted` folds the item-granted training and the tags an item's own effects carry INTO the same
 * context the definition's training feeds, so a rider gated on "proficient with martial weapons"
 * fires for training the gauntlets handed over, and one gated on an effect tag fires for an effect
 * the item carries. Grants are additive to the sheet's own training and never replace it.
 */
function bearerContext(actor: Actor, definition: ActorDefinition | undefined, active: readonly ActiveItem[], granted: Readonly<{ weapons: readonly string[]; armor: readonly string[]; tools: readonly string[]; effectTags: readonly string[] }>): Omit<RiderContext, "moment"> {
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

/**
 * THE CHARACTER'S OWN FEATS, as rider carriers - the fix for the asymmetry where a feat granted by an
 * ITEM got all 21 rider variants (it became a carrier at the `grantsFeatIds` fold below) while the
 * SAME feat taken in the character builder got only the 8 `interpretFeature` folds, the other 13
 * falling through a `switch` with no `default` and vanishing without a trace.
 *
 * RECOMPUTED PER CALL rather than persisted on the definition, deliberately:
 *
 *   - the ids are already on `definition.character.feats` (the builder writes the origin feat and
 *     every chosen feat there), and the riders already live on the catalog's feat record - so
 *     persisting them would be a THIRD copy of data that exists twice, free to drift when the GM
 *     edits a homebrew feat. Recomputing means an edited feat is correct on the next read.
 *   - storing them would need an additive field on `ActorDefinitionSchema` (@vtt/schemas), whose
 *     `character.feats` entry is `.strict()`, plus the matching projection review that any new
 *     definition field needs. Recomputing adds NO state at all, so there is nothing to project and
 *     nothing to leak - the same argument `deriveEquipment`'s header makes for the whole block.
 *   - it inherits replace-whole-is-the-un-grant for free. A respec that rewrites `character.feats`
 *     is correct on the next read with no migration.
 *
 * The cost is one catalog map lookup per feat (at most a handful) on every derivation. That is the
 * same order as the item loop this function sits next to, and the header above already declines to
 * memoize that for correctness reasons.
 *
 * Carriers get NO `sourceItemId`: a feat is worn by the BEARER, not by an item, so `collectRiders`
 * scopes its riders to the bearer and they apply to every action - which is the whole point.
 */
function characterFeatCarriers(definition: ActorDefinition | undefined, catalog: EquipmentCatalog): readonly RiderCarrier[] {
  const feats = definition?.character?.feats ?? [];
  if (feats.length === 0 || !catalog.featRecord) return [];
  const carriers: RiderCarrier[] = [];
  for (const held of feats) {
    // Fail open exactly like an item with no catalog record: an imported sheet's unknown feat, or a
    // homebrew feat the GM has since deleted, contributes prose only rather than throwing.
    const record = catalog.featRecord(held.id);
    if (!record) continue;
    const modifiers = (record.feature.modifiers ?? []).filter(ridesOnTheBearer);
    if (modifiers.length > 0) carriers.push({ label: record.name, modifiers });
  }
  return carriers;
}

/**
 * THE CHARACTER'S OWN CLASS, SUBCLASS, SPECIES, LINEAGE AND BACKGROUND FEATURES - and every chosen
 * inline option - as rider carriers. Issue `2e`.
 *
 * The near-twin of `characterFeatCarriers` above, and deliberately so: the two solve the identical
 * problem for two halves of the same sheet. `interpretFeature` in `character-build.ts` folds 8 of
 * the 21 rider variants into the definition at BUILD time; the other 13 are inherently roll-time (a
 * `roll-mode` is advantage at a moment, `extra-damage` is dice rolled on a hit, `spell-slot` and
 * `resource-bonus` are live maxima) and can only reach the table as carriers. A feat got there
 * because `character.feats` records its id. A class feature was recorded NOWHERE, so its 13
 * roll-time riders were authored, validated, and dropped - the Cleric with one usable action.
 *
 * Every argument in `characterFeatCarriers`'s header applies verbatim and is not repeated: recompute
 * rather than persist (the riders live on the catalog record, so an edited homebrew feature is
 * correct on the next read and a respec needs no migration), and no `sourceItemId`, because a class
 * feature is worn by the BEARER - `collectRiders` must scope its riders to every action.
 *
 * FAILS OPEN on an absent array. Definitions written before this field existed - PDF imports, the
 * example party, every bundled monster - have no `features` at all, and must keep working exactly as
 * they do today: no array means no carriers, never an error.
 */
function characterFeatureCarriers(definition: ActorDefinition | undefined, catalog: EquipmentCatalog): readonly RiderCarrier[] {
  const features = definition?.character?.features ?? [];
  if (features.length === 0 || !catalog.featureRecord) return [];
  const carriers: RiderCarrier[] = [];
  for (const held of features) {
    // Same fail-open as a feat with no catalog record: a homebrew class the GM has since deleted, or
    // a feature renamed out from under a stored sheet, contributes prose only rather than throwing.
    const record = catalog.featureRecord(held);
    if (!record) continue;
    const modifiers = (record.modifiers ?? []).filter(ridesOnTheBearer);
    if (modifiers.length > 0) carriers.push({ label: record.name, modifiers });
  }
  return carriers;
}

/** Which of a feat's authored riders this carrier may hand to the collector. */
function ridesOnTheBearer(modifier: RiderModifier): boolean {
  // Already inside the definition's own numbers - see BUILDER_BAKED_MODIFIER_TYPES.
  if (BUILDER_BAKED.has(modifier.type)) return false;
  // `scope: "this-item"` names an item this carrier does not have. `scopeOf` in @vtt/rules-5e
  // DEGRADES that to `"bearer"` for a carrier with no `sourceItemId`, which would silently turn an
  // authored "only when swinging this weapon" into "always" - the exact failure mode `passes`'
  // `default: return false` exists to prevent. So it fails CLOSED here instead. (The right long-term
  // home for this is a publish-time authoring error on the homebrew validator, not a silent drop.)
  return modifier.scope !== "this-item";
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
  // A character's own feats AND features carry riders whether or not they are holding anything, so
  // the nothing-equipped shortcut has to clear all three sources before it returns the empty block.
  const featCarriers = characterFeatCarriers(definition, catalog);
  const featureCarriers = characterFeatureCarriers(definition, catalog);
  if (equipped.length === 0 && featCarriers.length === 0 && featureCarriers.length === 0) return EMPTY_DERIVATION;
  /** Feats the character already HOLDS - so an item that grants one they have adds nothing twice. */
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
  const damageImmunities: Sourced[] = [];
  const conditionImmunities: Sourced[] = [];
  const armorProficiencies: Sourced[] = [];
  const weaponProficiencies: Sourced[] = [];
  const itemEffectTags: string[] = [];

  const takeGrants = (block: RiderBlockLike, itemId: string) => {
    const grants = block.grants;
    if (!grants) return;
    for (const id of grants.skills ?? []) skills.push({ id, proficiency: "proficient", sourceItemId: itemId });
    for (const id of grants.expertise ?? []) skills.push({ id, proficiency: "expertise", sourceItemId: itemId });
    for (const id of grants.saves ?? []) saves.push({ id, sourceItemId: itemId });
    for (const id of grants.tools ?? []) tools.push({ id, sourceItemId: itemId });
    for (const id of grants.languages ?? []) languages.push({ id, sourceItemId: itemId });
    for (const id of grants.damageResistances ?? []) damageResistances.push({ id, sourceItemId: itemId });
    // The four that used to be dropped on the floor.
    for (const id of grants.damageImmunities ?? []) damageImmunities.push({ id, sourceItemId: itemId });
    for (const id of grants.conditionImmunities ?? []) conditionImmunities.push({ id, sourceItemId: itemId });
    for (const id of grants.armor ?? []) armorProficiencies.push({ id, sourceItemId: itemId });
    for (const id of grants.weapons ?? []) weaponProficiencies.push({ id, sourceItemId: itemId });
  };

  /** An item's own effects, read as standing riders (see `ItemEffectLike`). */
  const takeEffects = (block: RiderBlockLike, itemId: string, itemLabel: string) => {
    for (const effect of block.effects ?? []) {
      const label = effect.name ? `${effect.name} (${itemLabel})` : itemLabel;
      for (const tag of effect.tags ?? []) itemEffectTags.push(tag);
      const modifiers: RiderModifier[] = [];
      for (const modifier of effect.modifiers ?? []) {
        // `damage-resistance` is the effect vocabulary's own shape (a LIST of types, no amount); it
        // is a defense, not a rider, so it joins the resistance grants rather than the collector.
        if (modifier.type === "damage-resistance") {
          for (const id of modifier.damageTypes ?? []) damageResistances.push({ id, sourceItemId: itemId });
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
      // Depth 1: the feat's riders join THIS block, so unequipping removes them in one recomputation.
      for (const featId of record.grantsFeatIds ?? []) {
        // The bearer already took this feat in the builder, where it is ALREADY a carrier (and its
        // baked half is already in the definition). Granting it again would double every rider on it.
        if (heldFeatIds.has(featId)) continue;
        const feat = catalog.featRecord?.(featId);
        if (!feat) continue;
        featIds.push({ id: feat.id, name: feat.name, sourceItemId: item.id });
        carriers.push({ label: `${feat.name} (${label})`, modifiers: feat.feature.modifiers ?? [], sourceItemId: item.id });
        takeGrants(feat.feature, item.id);
        takeEffects(feat.feature, item.id, `${feat.name} (${label})`);
      }
      if ((record.modifiers?.length ?? 0) > 0 || record.grants || (record.effects?.length ?? 0) > 0 || (record.grantsFeatIds?.length ?? 0) > 0) {
        sources.push({ itemId: item.id, itemName: label, summary: summarise(record) });
      }
    }
  }
  // Weapon attacks come from the EQUIPPED list, not the active one (see above). Item-granted weapon
  // training is collected above, so a gauntlet that grants martial weapons pays the proficiency
  // bonus on the axe in the same recomputation.
  const grantedWeaponIds = weaponProficiencies.map((entry) => entry.id);
  const weaponActionIds: string[] = [];
  // Which weapons this character has spent a Weapon Mastery pick on. The builder already stores the
  // ledger verbatim on the definition, so no new state is needed - the picks are read back from the
  // same rows level-up and respec prefill from. `id` is the WEAPON id; the mastery is the weapon's.
  const unlocked = new Set((definition?.character?.choices ?? [])
    .filter((row) => row.kind === "weapon-mastery").map((row) => row.id));
  const masteryByActionId: Record<string, MasteryInForce> = {};
  for (const entry of equipped) {
    const weaponAttack = weaponAction(entry.item, definition, grantedWeaponIds);
    if (!weaponAttack) continue;
    actions.push(weaponAttack);
    weaponActionIds.push(weaponAttack.id);
    const mastery = catalog.equipmentRecord(entry.item.id)?.weapon?.mastery;
    // BOTH gates: the weapon has a mastery AND the bearer unlocked THIS weapon - plus the third,
    // that the engine can actually honour it (see `masteryReaches`).
    if (mastery && unlocked.has(entry.item.id) && masteryReaches(mastery)) {
      masteryByActionId[weaponAttack.id] = { id: mastery, abilityModifier: weaponAbilityModifier(entry.item, definition) };
    }
  }
  // THE BEARER'S OWN UNARMED STRIKE IS A WEAPON SWING. A Monk's is minted by the builder (the
  // printed Martial Arts die, Dexterity or Strength - see `martialArtsStrike`), so it lives on the
  // DEFINITION rather than being derived from an inventory row here. `extraAttacksFor` tests
  // membership of this list BY ID, so without this line a Monk 5's Extra Attack multiplied the
  // quarterstaff and not the strike the whole class is built around.
  if (definition?.actions.some((action) => action.id === UNARMED_STRIKE_ACTION_ID && action.attack !== undefined)) {
    weaponActionIds.push(UNARMED_STRIKE_ACTION_ID);
  }

  // The STANDING + CONDITIONAL pass: riders naming no moment whose static and dynamic gates pass.
  const context = bearerContext(actor, definition, equipped, {
    weapons: grantedWeaponIds, armor: armorProficiencies.map((entry) => entry.id),
    tools: tools.map((entry) => entry.id), effectTags: itemEffectTags
  });
  const standing = collectRiders(carriers, { ...context, moment: null });
  return {
    context,
    skills, saves, tools, languages, damageResistances, damageImmunities, conditionImmunities,
    armorProficiencies, weaponProficiencies, featIds,
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
    carriers, actions, weaponActionIds, masteryByActionId, sources
  };
}

function amountsWithClass(riders: readonly ResolvedRider[], type: string) {
  return riders.flatMap((rider) => rider.modifier.type === type
    ? [{ amount: rider.modifier.amount ?? 0, ...(rider.modifier.classId ? { classId: rider.modifier.classId } : {}) }] : []);
}

function summarise(record: EquipmentRecordLike): string {
  const parts = (record.modifiers ?? []).map((modifier) => modifier.type);
  if (record.grants) parts.push("proficiencies");
  if ((record.effects?.length ?? 0) > 0) parts.push("effects");
  if ((record.grantsFeatIds?.length ?? 0) > 0) parts.push("feat");
  return parts.join(", ");
}

/**
 * One effect modifier, in the RIDER vocabulary the collector reads.
 *
 * The two vocabularies overlap by construction (`attack-bonus`, `extra-damage` and `roll-mode` are
 * literally the same three schemas, declared once in @vtt/schemas), so those pass through untouched.
 * The six legacy advantage/disadvantage variants say the same thing in the older shape and are
 * normalised into `roll-mode` here - the same normalisation `toRollModes` does on the actor side,
 * restated structurally because this module imports no schema package.
 *
 * `damage-bonus` (a flat +N to the bearer's damage, whatever type the weapon deals) has NO rider
 * equivalent - `extra-damage` needs its own formula AND type - so an item effect carrying one
 * contributes nothing here. That is stated rather than silently dropped: authoring it as an
 * `extra-damage` modifier on the item itself is the supported way to say it.
 */
function asRiderModifiers(modifier: ItemEffectModifierLike): readonly RiderModifier[] {
  const gate = { ...(modifier.when ? { when: modifier.when } : {}), ...(modifier.scope ? { scope: modifier.scope } : {}) };
  const rollMode = (roll: RiderModifier["roll"], mode: "advantage" | "disadvantage"): RiderModifier => ({
    type: "roll-mode", roll, mode, ...gate,
    // `save-advantage` narrows by ability; the rider vocabulary says that with an `ability-is`
    // FILTER, and a filter is only ever evaluated inside a moment pass (the standing pass skips
    // anything filtered). So the moment has to be named alongside it or the rider fires in neither.
    ...(modifier.ability
      ? { when: [...(modifier.when ?? []), { type: roll === "save" ? "on-saving-throw" : "on-attack-roll" }, { type: "ability-is", abilities: [modifier.ability] }] }
      : {})
  });
  switch (modifier.type) {
    case "attack-advantage": return [rollMode("attack", "advantage")];
    case "attack-disadvantage": return [rollMode("attack", "disadvantage")];
    case "incoming-attack-advantage": return [rollMode("incoming-attack", "advantage")];
    case "incoming-attack-disadvantage": return [rollMode("incoming-attack", "disadvantage")];
    case "save-advantage": return [rollMode("save", "advantage")];
    case "save-disadvantage": return [rollMode("save", "disadvantage")];
    case "damage-bonus": return [];
    default: return [modifier];
  }
}

/** The bearer's total skill tier: the better of the definition's base and any item grant (criterion 11). */
export function effectiveSkillTier(definition: ActorDefinition | undefined, derivation: EquipmentDerivation, skillId: string): "none" | "proficient" | "expertise" {
  const base = definition?.proficiencies?.skills.find((entry) => entry.id === skillId)?.proficiency ?? "none";
  const granted = derivation.skills.filter((entry) => entry.id === skillId).map((entry) => entry.proficiency);
  const tiers = [base, ...granted];
  return tiers.includes("expertise") ? "expertise" : tiers.includes("proficient") ? "proficient" : "none";
}

/**
 * The ITEM NAMES that raised one skill's tier, for the sheet's "Stealth (Circlet of Shadows)" tooltip.
 *
 * Reads `derivation.skills` (which carries `sourceItemId` per grant) and resolves each id through
 * `derivation.sources` for the catalog's display name, falling back to the raw id when the item
 * contributed a grant but no summary row. Deduped and order-preserving, so two items granting the
 * same skill read as a list rather than a repetition. Empty when the tier is entirely the base sheet's.
 */
export function skillTierSources(derivation: EquipmentDerivation, skillId: string): readonly string[] {
  const names: string[] = [];
  for (const entry of derivation.skills) {
    if (entry.id !== skillId) continue;
    const name = derivation.sources.find((source) => source.itemId === entry.sourceItemId)?.itemName ?? entry.sourceItemId;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The flat item bonus to one ability check - the mirror of `saveRiderBonus`, and `check-bonus`'s
 * FIRST consumer (its `CARRIER_RIDER_DISPOSITION` entry moves from `"unread"` to `"standing"` with
 * this function).
 *
 * `derivation.checkBonus` is the already-summed STANDING half ("+1 to all ability checks"); only the
 * momentary riders are added here, and they are disjoint from the standing pass by construction - a
 * rider naming `on-ability-check` is excluded from the moment-less collection that produced
 * `checkBonus`. Passing `ability`/`skill` into the context is what lets `ability-is` and `skill-is`
 * narrow "+5 to Stealth checks" to the one row it names instead of every row on the sheet.
 */
export function checkRiderBonus(derivation: EquipmentDerivation, narrow: Readonly<{ ability?: RiderAbility; skill?: string }>): number {
  const momentary = collectRiders(derivation.carriers, {
    ...derivation.context,
    ...(narrow.ability !== undefined ? { ability: narrow.ability } : {}),
    ...(narrow.skill !== undefined ? { skill: narrow.skill } : {}),
    moment: "on-ability-check"
  });
  return derivation.checkBonus + sumRiders(momentary, "check-bonus");
}

// ---------------------------------------------------------------------------------------------
// Synthesised actions
// ---------------------------------------------------------------------------------------------

const ACTION_ID_PREFIX = "item-";
/** The derived-action id namespace, so a consumer can tell an item action from a stat-block one. */
export const itemActionId = (itemId: string, suffix?: string) => `${ACTION_ID_PREFIX}${itemId}${suffix ? `-${suffix}` : ""}`;
export const isItemActionId = (id: string) => id.startsWith(ACTION_ID_PREFIX);

/**
 * THE ID A CHARACTER'S OWN UNARMED STRIKE MUST CARRY, and it is deliberately the BUILTIN's id.
 *
 * Every combatant can take the generic SRD Unarmed Strike (`builtin-actions.ts`), whose numbers are
 * materialised at resolve time as Strength + Proficiency Bonus for 1 + Strength - correct for
 * everyone except the one class built around the strike. A declared id SHADOWS its builtin
 * everywhere the two meet (`actionAvailability`'s builtin filter, `action.resolve`'s
 * `statBlockAction ?? builtinAction`), so a Monk whose builder minted this id gets exactly one
 * Unarmed Strike on the sheet - theirs, with the Martial Arts die - rather than two that disagree.
 *
 * Named here rather than in the builder because THIS module owns `weaponActionIds`, the list that
 * decides what Extra Attack may multiply.
 */
export const UNARMED_STRIKE_ACTION_ID = "unarmed-strike";

/** The bearer's total character level, for a `by-level` use table. Absent (a bare token) reads as 1. */
function bearerLevel(definition: ActorDefinition | undefined): number {
  const classes = definition?.character?.classes ?? [];
  const total = classes.reduce((sum, entry) => sum + entry.level, 0);
  return total >= 1 ? total : 1;
}

/**
 * `uses` -> `ActionUsesSchema`, resolving the scaling forms against the bearer.
 *
 * `ActionUsesSchema.limit` is a REQUIRED 1-20 integer, while the authored `FeatureUsesSchema.limit`
 * is optional whenever a `scaling` rule supplies the count. Emitting `{ limit: undefined }` produced
 * an action the actor schema rejects, so a homebrew item printing "proficiency bonus per long rest"
 * (schema-valid, publishable) broke its own bearer. Mirror `character-build.ts`'s `resolvedUseLimit`
 * and its `limit >= 1` / `Math.min(20, ...)` clamps: below 1 the item simply has no charges yet.
 */
function usesOf(uses: RiderUsesLike | undefined, definition: ActorDefinition | undefined): ActorAction["uses"] | undefined {
  if (!uses) return undefined;
  const per = uses.per as NonNullable<ActorAction["uses"]>["per"];
  const limit = uses.limit ?? scaledLimit(uses.scaling, definition);
  if (limit === undefined || limit < 1) return undefined;
  return { limit: Math.min(20, limit), per, ...(uses.pool ? { pool: uses.pool } : {}), ...(uses.recharge !== undefined ? { recharge: uses.recharge } : {}) };
}

function scaledLimit(scaling: RiderUsesLike["scaling"], definition: ActorDefinition | undefined): number | undefined {
  if (!scaling) return undefined;
  if (scaling.type === "proficiency-bonus") return definition?.proficiencyBonus ?? 0;
  if (scaling.type === "ability-modifier") return Math.max(scaling.minimum ?? 1, scoreModifierOf(definition, scaling.ability));
  // `class-resource` reads a CLASS TABLE's printed column, which a built definition no longer
  // carries - the builder resolved it to a flat number at build time, which is the only place the
  // row exists. An ITEM authored with it therefore grants no uses rather than guessing a count.
  if (scaling.type === "class-resource") return undefined;
  const level = bearerLevel(definition);
  const rows = [...scaling.table].filter((row) => row.level <= level).sort((left, right) => left.level - right.level);
  return rows.length > 0 ? rows[rows.length - 1].limit : 0;
}

/**
 * The bearer's own spellcasting ability, and the numbers derived from it. An item that names
 * `"spellcasting"` (or omits its ability entirely) borrows the wielder's; a bare token or a sheet
 * with no casting falls back to the bare ability modifier, never to a thrown error - the same
 * fail-open every other derivation path takes.
 */
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

/**
 * An item action, with its ATTACK and SAVE halves resolved.
 *
 * The authored shapes are the feature templates (an item record cannot know the bearer's ability
 * scores), so this is the read-time twin of `character-build.ts`'s build-time `interpretAction`:
 * `attack.ability` + `proficient` become a to-hit bonus, and `save.dc`'s three printed forms become
 * one number. Both used to be dropped, which is why an item-granted action resolved as a
 * damage-only prompt while the identical authored shape on a class feature became a real attack.
 */
function itemAction(itemId: string, declared: RiderActionLike, itemName: string, definition: ActorDefinition | undefined): ActorAction {
  const caster = casterNumbers(definition);
  let attack: ActorAction["attack"];
  if (declared.attack) {
    const { ability, proficient, ...rest } = declared.attack;
    const resolved = ability === "spellcasting" ? caster.ability : ability;
    // A spell-powered item attack on a non-caster keeps the item's printed reach/range and the
    // bare modifier: display-only degradation beats refusing to derive the action at all.
    const bonus = ability === "spellcasting" && caster.attackBonus !== null
      ? caster.attackBonus
      : scoreModifierOf(definition, resolved) + (proficient === false ? 0 : caster.proficiencyBonus);
    attack = { bonus, ...rest };
  }
  const save = declared.save ? { ability: declared.save.ability, dc: resolveSaveDc(declared.save.dc, definition) } : undefined;
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
  if (dc === "spellcasting") return clampDc(caster.saveDc ?? 8 + scoreModifierOf(definition, caster.ability) + caster.proficiencyBonus);
  if (typeof dc === "number") return clampDc(dc);
  return clampDc((dc.base ?? 8) + scoreModifierOf(definition, dc.ability) + (dc.proficiencyBonus === false ? 0 : caster.proficiencyBonus));
}
const clampDc = (value: number) => Math.max(1, Math.min(40, Math.round(value)));

/**
 * Criterion 4: "cast Message once per day while attuned" is a synthesised action with its own charges
 * - and, since the cast details stopped being inert, with the SPELL's own mechanics.
 *
 * `atLevel` picks the SRD upcast row (`castingOptions` "slot_level_N", the same rows the sheet's
 * cast-at control reads), so a Wand of Fireballs at level 5 rolls 10d6 rather than 8d6. `ability`
 * and `saveDc` override the derivation the way a printed item line does ("save DC 15"), and
 * `consumesSpellSlot` rides the additive `ActionSchema.spellSlot` field the resolver's economy
 * checks and spends. A spell the catalog cannot resolve degrades to today's name-only action rather
 * than failing the whole derivation - a GM may have deleted the homebrew spell an item names.
 */
function castAction(itemId: string, cast: ItemSpellCastLike, itemName: string, definition: ActorDefinition | undefined, catalog: EquipmentCatalog): ActorAction {
  const spell = catalog.spellRecord?.(cast.spellId);
  const spellName = spell?.name ?? cast.spellId.replace(/-/g, " ");
  const level = cast.atLevel ?? spell?.level ?? 0;
  const base: ActorAction = {
    id: itemActionId(itemId, `cast-${cast.spellId}`),
    name: `Cast ${spellName} (${itemName})`,
    activation: "action",
    description: spell?.description ?? `Cast ${spellName} from ${itemName}.`,
    damage: [],
    // WHICH spell this is, so a `spell-id-is` rider can gate on it. Set even when the catalog cannot
    // resolve the record: the id is what the item authored, and it is what the gate names.
    spellId: cast.spellId,
    ...(usesOf(cast.uses, definition) ? { uses: usesOf(cast.uses, definition)! } : {}),
    // The bearer's OWN slot, on top of the item's charges, when the item says so.
    ...(cast.consumesSpellSlot === true && level >= 1 ? { spellSlot: { level: Math.min(9, level) } } : {})
  };
  if (!spell) return base;

  const caster = casterNumbers(definition);
  // An authored `ability` powers the item ("Intelligence, save DC 15"); absent, the wielder's own.
  const ability = cast.ability ?? caster.ability;
  const upcast = level > spell.level
    ? spell.castingOptions?.find((option) => option.type === `slot_level_${level}`)?.damageRoll ?? null
    : null;
  const formula = upcast ?? spell.damage?.roll ?? null;
  const damageType = spell.damage?.types?.[0] ?? "force";
  const attackBonus = cast.ability !== undefined || caster.attackBonus === null
    ? scoreModifierOf(definition, ability) + caster.proficiencyBonus
    : caster.attackBonus;
  const saveDc = cast.saveDc ?? (cast.ability !== undefined || caster.saveDc === null
    ? 8 + scoreModifierOf(definition, ability) + caster.proficiencyBonus
    : caster.saveDc);
  return {
    ...base,
    ...(spell.attackRoll === true ? { attack: { bonus: attackBonus } } : {}),
    ...(spell.save ? { save: { ability: spell.save, dc: clampDc(saveDc) } } : {}),
    ...(formula ? { damage: [{ formula, type: damageType }] } : {})
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
/**
 * WHICH ABILITY MODIFIER THIS WEAPON SWINGS WITH - Finesse takes the better of Strength and Dexterity,
 * a genuinely ranged weapon takes Dexterity, everything else takes Strength.
 *
 * Extracted from `weaponAction` rather than copied because Graze needs the SAME number ("damage equal
 * to the ability modifier you used to make the attack roll"). Two copies of a rule with a Finesse
 * branch in it is two copies that can disagree, and the disagreement would be a wrong damage number
 * on a miss - visible to a player and hard to trace back here.
 */
export function weaponAbilityModifier(item: InventoryItem, definition: ActorDefinition | undefined): number {
  const weapon = item.weapon;
  if (!weapon || !definition) return 0;
  const properties = weapon.properties ?? [];
  const str = abilityModifier(definition.abilityScores.str);
  const dex = abilityModifier(definition.abilityScores.dex);
  const ranged = weapon.rangeFeet !== null && !properties.includes("thrown");
  return properties.includes("finesse") ? Math.max(str, dex) : ranged ? dex : str;
}

export function weaponAction(item: InventoryItem, definition: ActorDefinition | undefined, grantedWeapons: readonly string[] = []): ActorAction | null {
  const weapon = item.weapon;
  if (!weapon || !definition) return null;
  const properties = weapon.properties ?? [];
  const modifier = weaponAbilityModifier(item, definition);
  const trained = definition.proficiencies?.weapons;
  const granted = grantedWeapons.includes(weapon.category) || grantedWeapons.includes(item.id);
  const proficient = granted || trained === undefined || trained.includes(weapon.category) || trained.includes(item.id);
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
