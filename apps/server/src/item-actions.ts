import type { FeatureAction, FeatureSaveDc, FeatureUses, ItemSpellCast, SpellReference } from "@vtt/content-srd-5.2.1";
import { abilityModifier, weaponAbilityModifierFrom, type RiderAbility } from "@vtt/rules-5e";
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
  const save = declared.save ? { ...declared.save, dc: resolveSaveDc(declared.save.dc, definition) } : undefined;
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
  const saveDc =
    cast.saveDc ??
    (cast.ability !== undefined || caster.saveDc === null
      ? 8 + scoreModifierOf(definition, ability) + caster.proficiencyBonus
      : caster.saveDc);
  return {
    ...base,
    ...(spell.attackRoll ? { attack: { bonus: attackBonus } } : {}),
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
