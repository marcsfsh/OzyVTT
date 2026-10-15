import type { FeatureAction, FeatureSaveDc, FeatureUses, ItemSpellCast, SpellReference } from "@vtt/content-srd-5.2.1";
import { abilityModifier, isMonkWeapon, weaponAbilityModifierFrom, type RiderAbility } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";

/**
 * Actions synthesised from what a character carries: an equipped weapon's swing, an item's declared actions and
 * its spell casts. Read-time twins of the builder's `interpretAction`, recomputed on every derivation so an item
 * that leaves takes its actions with it.
 */

const ACTION_ID_PREFIX = "item-";
/** The derived-action id namespace, so a consumer can tell an item action from a stat-block one. */
export const itemActionId = (itemId: string, suffix?: string) =>
  `${ACTION_ID_PREFIX}${itemId}${suffix ? `-${suffix}` : ""}`;
export const isItemActionId = (id: string) => id.startsWith(ACTION_ID_PREFIX);
/** The `<itemId>[-<suffix>]` part of a derived action id. */
export const itemActionRest = (id: string) => id.slice(ACTION_ID_PREFIX.length);

/** The builtin's id, so a character's own unarmed strike shadows the generic builtin everywhere. */
export const UNARMED_STRIKE_ACTION_ID = "unarmed-strike";

/** The bearer's total character level, for a `by-level` use table. Absent (a bare token) reads as 1. */
function bearerLevel(definition: ActorDefinition | undefined): number {
  const classes = definition?.character?.classes ?? [];
  const total = classes.reduce((sum, entry) => sum + entry.level, 0);
  return total >= 1 ? total : 1;
}

/** Authored uses to `ActionUsesSchema`, clamped to 1-20 like `resolvedUseLimit`; below 1 means no charges. An
 *  item action carries the action form (with `recharge`), a cast the feature form (with `scaling`). */
function usesOf(
  uses: FeatureUses | ActorAction["uses"],
  definition: ActorDefinition | undefined
): ActorAction["uses"] | undefined {
  if (!uses) return undefined;
  const limit = uses.limit ?? ("scaling" in uses ? scaledLimit(uses.scaling, definition) : undefined);
  if (limit === undefined || limit < 1) return undefined;
  return {
    limit: Math.min(20, limit),
    per: uses.per,
    ...(uses.pool ? { pool: uses.pool } : {}),
    ...("recharge" in uses && uses.recharge !== undefined ? { recharge: uses.recharge } : {})
  };
}

function scaledLimit(scaling: FeatureUses["scaling"], definition: ActorDefinition | undefined): number | undefined {
  if (!scaling) return undefined;
  if (scaling.type === "proficiency-bonus") return definition?.proficiencyBonus ?? 0;
  if (scaling.type === "ability-modifier")
    return Math.max(scaling.minimum, scoreModifierOf(definition, scaling.ability));
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
export function itemAction(
  itemId: string,
  declared: FeatureAction,
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
  const save = declared.save
    ? {
        ...declared.save,
        dc: resolveSaveDc(declared.save.dc, definition),
        ...(declared.save.dc === "spellcasting" ? { spellcasting: true } : {})
      }
    : undefined;
  const uses = usesOf(declared.uses, definition);
  return {
    id: itemActionId(itemId, declared.id),
    name: declared.name,
    activation: declared.activation,
    description: declared.description,
    ...(attack ? { attack } : {}),
    ...(save ? { save } : {}),
    damage: declared.damage.map((part) => ({ ...part })),
    ...(uses ? { uses } : {})
  };
}

/** `FeatureSaveDcSchema`'s three forms, resolved against the bearer. Clamped to the action schema's 1-40. */
function resolveSaveDc(dc: FeatureSaveDc, definition: ActorDefinition | undefined): number {
  const caster = casterNumbers(definition);
  if (dc === "spellcasting")
    return clampDc(caster.saveDc ?? 8 + scoreModifierOf(definition, caster.ability) + caster.proficiencyBonus);
  if (typeof dc === "number") return clampDc(dc);
  return clampDc(
    dc.base + scoreModifierOf(definition, dc.ability) + (dc.proficiencyBonus ? caster.proficiencyBonus : 0)
  );
}
const clampDc = (value: number) => Math.max(1, Math.min(40, Math.round(value)));

/** A synthesised cast action with the spell's mechanics. `atLevel` picks the SRD upcast row; `ability`
 *  and `saveDc` override; an unresolvable spell degrades to a name-only action. */
export function castAction(
  itemId: string,
  cast: ItemSpellCast,
  itemName: string,
  definition: ActorDefinition | undefined,
  spell: SpellReference | undefined
): ActorAction {
  const spellName = spell?.name ?? cast.spellId.replace(/-/g, " ");
  const level = cast.atLevel ?? spell?.level ?? 0;
  const uses = usesOf(cast.uses, definition);
  const base: ActorAction = {
    id: itemActionId(itemId, `cast-${cast.spellId}`),
    name: `Cast ${spellName} (${itemName})`,
    activation: "action",
    description: spell?.description ?? `Cast ${spellName} from ${itemName}.`,
    damage: [],
    // Set even when the catalog cannot resolve the record, since `spell-id-is` gates on the authored id.
    spellId: cast.spellId,
    ...(uses ? { uses } : {}),
    // The bearer's own slot is spent on top of the item's charges when the item says so.
    ...(cast.consumesSpellSlot && level >= 1 ? { spellSlot: { level: Math.min(9, level) } } : {})
  };
  if (!spell) return base;

  const caster = casterNumbers(definition);
  // An authored `ability` powers the item; absent, the wielder's own.
  const ability = cast.ability ?? caster.ability;
  const upcast =
    level > spell.level
      ? (spell.castingOptions.find((option) => option.type === `slot_level_${level}`)?.damageRoll ?? null)
      : null;
  const formula = upcast ?? spell.damage.roll;
  const damageType = spell.damage.types[0] ?? "force";
  const attackBonus =
    cast.ability !== undefined || caster.attackBonus === null
      ? scoreModifierOf(definition, ability) + caster.proficiencyBonus
      : caster.attackBonus;
  // Only the wielder's own spell save DC is theirs to raise; a printed DC or the item's own ability is not.
  const bearersDc = cast.saveDc === undefined && cast.ability === undefined && caster.saveDc !== null;
  const saveDc =
    cast.saveDc ??
    (cast.ability !== undefined || caster.saveDc === null
      ? 8 + scoreModifierOf(definition, ability) + caster.proficiencyBonus
      : caster.saveDc);
  return {
    ...base,
    ...(spell.area ? { area: spell.area } : {}),
    ...(spell.attackRoll ? { attack: { bonus: attackBonus } } : {}),
    ...(spell.save
      ? { save: { ...spell.save, dc: clampDc(saveDc), ...(bearersDc ? { spellcasting: true } : {}) } }
      : {}),
    ...(formula ? { damage: [{ formula, type: damageType }] } : {})
  };
}

/** Martial Arts reaches this swing: the bearer has it, it is in force (no armour, no shield) and this is a Monk weapon. */
function martialArtsSwing(item: InventoryItem, definition: ActorDefinition, martialArtsInForce: boolean) {
  const weapon = item.weapon;
  if (!martialArtsInForce || !weapon || !definition.character?.martialArts) return null;
  return isMonkWeapon(weapon.category, weapon.properties ?? [], weapon.rangeFeet)
    ? definition.character.martialArts
    : null;
}

/** Finesse takes the better of STR and DEX, ranged takes DEX, else STR; a Monk weapon under Martial Arts takes the
 *  better too. Shared with Graze. */
export function weaponAbilityModifier(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  martialArtsInForce = false
): number {
  const weapon = item.weapon;
  if (!weapon || !definition) return 0;
  const str = abilityModifier(definition.abilityScores.str);
  const dex = abilityModifier(definition.abilityScores.dex);
  if (martialArtsSwing(item, definition, martialArtsInForce)) return Math.max(str, dex);
  // The rule lives in `@vtt/rules-5e` so the sheet's tap-to-roll preview derives the same number.
  return weaponAbilityModifierFrom(weapon.properties ?? [], weapon.rangeFeet, str, dex);
}

/** The bigger of two single-term dice by average ("1d6" vs "1d8"); anything else keeps the weapon's own. */
function biggerDie(weaponDice: string, martialArtsDie: string): string {
  const average = (dice: string) => {
    const match = /^(\d+)d(\d+)$/.exec(dice.trim());
    return match ? (Number(match[1]) * (Number(match[2]) + 1)) / 2 : null;
  };
  const own = average(weaponDice);
  const art = average(martialArtsDie);
  return own !== null && art !== null && art > own ? martialArtsDie : weaponDice;
}

/**
 * Whether weapon training covers a weapon: its category, its id, or a qualified slice of Martial read against its
 * properties ("martial-light" is the Monk's, "martial-finesse-or-light" the Rogue's). A "-weapons" suffix, as an
 * authored grant spells it ("martial-weapons"), names the same thing.
 */
export function trainingCovers(
  slugs: readonly string[],
  weapon: Readonly<{ category: string; properties?: readonly string[] }>,
  ids: readonly string[]
): boolean {
  const properties = weapon.properties ?? [];
  return slugs.some((raw) => {
    const slug = raw.replace(/-weapons$/, "");
    if (slug === weapon.category || ids.includes(slug)) return true;
    if (weapon.category !== "martial") return false;
    if (slug === "martial-light") return properties.includes("light");
    if (slug === "martial-finesse") return properties.includes("finesse");
    if (slug === "martial-finesse-or-light") return properties.includes("finesse") || properties.includes("light");
    return false;
  });
}

/** An attack action for an equipped weapon. Absent `proficiencies.weapons` means "not recorded", so proficient. */
export function weaponAction(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  grantedWeapons: readonly string[] = [],
  martialArtsInForce = false
): ActorAction | null {
  const weapon = item.weapon;
  if (!weapon || !definition) return null;
  const properties = weapon.properties ?? [];
  const modifier = weaponAbilityModifier(item, definition, martialArtsInForce);
  // Martial Arts: the Monk may roll its die in place of the weapon's, so the bigger one is rolled.
  const martialArts = martialArtsSwing(item, definition, martialArtsInForce);
  const dice = martialArts ? biggerDie(weapon.damageDice, martialArts.die) : weapon.damageDice;
  const trained = definition.proficiencies?.weapons;
  // A bound template row also answers to its base weapon's id for proficiency.
  const ids = item.baseId !== undefined ? [item.id, item.baseId] : [item.id];
  const proficient =
    trained === undefined || trainingCovers(grantedWeapons, weapon, ids) || trainingCovers(trained, weapon, ids);
  const bonus = modifier + (proficient ? definition.proficiencyBonus : 0);
  const damageFormula = `${dice}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`;
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
