import type { FeatureAction, FeatureSaveDc, FeatureUses, ItemSpellCast, SpellReference } from "@vtt/content-srd-5.2.1";
import { spellRangeFeet } from "@vtt/content-srd-5.2.1/spell-effect";
import {
  abilityModifier,
  formulaPlus,
  isMeleeWeapon,
  isMonkWeapon,
  weaponAbilityModifierFrom,
  type RiderAbility
} from "@vtt/rules-5e";
import {
  catalogIdOf,
  MAX_ACTION_USES,
  type ActorAction,
  type ActorDefinition,
  type InventoryItem,
  type OngoingDamage
} from "@vtt/schemas";

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

/** A carried item: its row id, and the catalog record it copies. */
export type CarriedItem = Readonly<{ id: string; recordId?: string }>;

/**
 * An item's shared charge pool, counted per carried copy: the row's id stands in for the record's, so two Wands of
 * Fireballs are two pools and a wand's spent charges are its own ("wand-of-fireballs-charges" on the row
 * "wand-of-fireballs-2" counts as "wand-of-fireballs-2-charges"). Kept within the pool slug's 60 characters.
 */
export function itemPool(item: CarriedItem, pool: string): string {
  const catalogId = catalogIdOf(item);
  const suffix = pool.startsWith(`${catalogId}-`) ? pool.slice(catalogId.length + 1) : pool;
  const key = `${item.id}-${suffix}`;
  return key.length <= 60 ? key : `${item.id.slice(0, Math.max(1, 59 - suffix.length))}-${suffix}`.slice(0, 60);
}

/** Authored uses to `ActionUsesSchema`, clamped to its range like `resolvedUseLimit`; below 1 means no charges. An
 *  item action carries the action form (with `recharge`), a cast the feature form (with `scaling`). A shared pool
 *  is counted per carried copy (`itemPool`); an unpooled use is already, by the action's own id. */
function usesOf(
  uses: FeatureUses | ActorAction["uses"],
  definition: ActorDefinition | undefined,
  item: CarriedItem
): ActorAction["uses"] | undefined {
  if (!uses) return undefined;
  const limit = uses.limit ?? ("scaling" in uses ? scaledLimit(uses.scaling, definition) : undefined);
  if (limit === undefined || limit < 1) return undefined;
  return {
    limit: Math.min(MAX_ACTION_USES, limit),
    per: uses.per,
    ...(uses.pool ? { pool: itemPool(item, uses.pool) } : {}),
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

/** The bearer's spellcasting numbers. A non-caster gets the bare ability modifier. */
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
  item: CarriedItem,
  declared: FeatureAction,
  definition: ActorDefinition | undefined
): ActorAction {
  const itemId = item.id;
  const caster = casterNumbers(definition);
  let attack: ActorAction["attack"];
  if (declared.attack) {
    const { ability, proficient, ...rest } = declared.attack;
    const resolved = ability === "spellcasting" ? caster.ability : ability;
    // A spell-powered item attack on a non-caster uses the bare modifier and still resolves.
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
  const uses = usesOf(declared.uses, definition, item);
  // "1d10 + your Dexterity modifier" taken off the damage (Gloves of Missile Snaring), read off the bearer.
  const added = declared.adds
    ? (declared.adds.abilityModifier ? scoreModifierOf(definition, declared.adds.abilityModifier) : 0) +
      (declared.adds.proficiencyBonus ? caster.proficiencyBonus : 0)
    : 0;
  const reaction =
    declared.reaction?.response === "reduce-damage" && added !== 0
      ? { ...declared.reaction, formula: formulaPlus(declared.reaction.formula, added) }
      : declared.reaction;
  return {
    id: itemActionId(itemId, declared.id),
    name: declared.name,
    activation: declared.activation,
    description: declared.description,
    ...(attack ? { attack } : {}),
    ...(save ? { save } : {}),
    damage: declared.damage.map((part) => ({ ...part })),
    // A Potion of Healing's 2d4 + 2.
    ...(declared.healing ? { healing: { ...declared.healing } } : {}),
    ...(uses ? { uses } : {}),
    // Charges one use spends (a Staff of Striking's 2 or 3).
    ...(declared.useCost !== undefined ? { useCost: declared.useCost } : {}),
    // A thrown flask uses one attack of the Attack action; the action's other attacks stay open.
    ...(declared.replacesAttack ? { replacesAttack: true } : {}),
    // What drinking or applying it puts on the user (Antitoxin's Advantage, a coat of poison).
    ...(declared.grants ? { grants: structuredClone(declared.grants) } : {}),
    ...(declared.area ? { area: { ...declared.area } } : {}),
    // Who it may target (a flask's one creature within 20 feet) and the hit it rides (a staff's charge on a hit).
    ...(declared.targets ? { targets: structuredClone(declared.targets) } : {}),
    ...(declared.ridesHit ? { ridesHit: itemHitRider(declared.ridesHit, definition) } : {}),
    ...(declared.onHit ? { onHit: structuredClone(declared.onHit) } : {}),
    // A roll it answers (a Ring of Evasion's Evade) and the trigger it is offered on (a Reaction's).
    ...(declared.answer ? { answer: structuredClone(declared.answer) } : {}),
    ...(reaction ? { reaction: { ...reaction } } : {})
  };
}

/** An item's hit rider with its DC as the bearer's number; how many effects it carries doesn't grow with level. */
function itemHitRider(
  rider: NonNullable<FeatureAction["ridesHit"]>,
  definition: ActorDefinition | undefined
): NonNullable<ActorAction["ridesHit"]> {
  const { saveDc, effectsChooseByLevel: _byLevel, ...rest } = structuredClone(rider);
  return { ...rest, ...(saveDc !== undefined ? { saveDc: resolveSaveDc(saveDc, definition) } : {}) };
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
  item: CarriedItem,
  cast: ItemSpellCast,
  itemName: string,
  definition: ActorDefinition | undefined,
  spell: SpellReference | undefined
): ActorAction {
  const itemId = item.id;
  const spellName = spell?.name ?? cast.spellId.replace(/-/g, " ");
  const level = cast.atLevel ?? spell?.level ?? 0;
  const uses = usesOf(cast.uses, definition, item);
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
    ...(cast.consumesSpellSlot && level >= 1 ? { spellSlot: { level: Math.min(9, level) } } : {}),
    // Who the item's cast may affect beside the spell's own targets (a ring's Fear: Beasts only).
    ...(cast.targets ? { targets: structuredClone(cast.targets) } : {})
  };
  if (!spell) return base;

  const caster = casterNumbers(definition);
  // An authored `ability` powers the item; absent, the wielder's own.
  const ability = cast.ability ?? caster.ability;
  const upcast =
    level > spell.level
      ? (spell.castingOptions.find((option) => option.type === `slot_level_${level}`)?.damageRoll ?? null)
      : null;
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
  const mechanics = spellCastMechanics(
    spell,
    { attackBonus, saveDc: clampDc(saveDc), bearersDc, modifier: scoreModifierOf(definition, ability) },
    { roll: upcast }
  );
  return {
    ...base,
    ...castAreaOf(spell, mechanics),
    ...mechanics,
    // A Reaction spell (Shield, Hellish Rebuke) is cast from the item as a Reaction, offered when its trigger happens.
    ...(spell.effect?.reaction
      ? { activation: "reaction" as const, reaction: structuredClone(spell.effect.reaction) }
      : {})
  };
}

/** The template a cast places: the spell's area, unless the caster picks its targets in that area (Mass Cure Wounds'
 *  six, Slow's six, Sleep's creatures of the caster's choice), which the cast then picks one by one. */
export function castAreaOf(spell: SpellReference, mechanics: Pick<ActorAction, "healing">): Pick<ActorAction, "area"> {
  return spell.area && !mechanics.healing && !spell.effect?.picksInArea ? { area: spell.area } : {};
}

/** A cast's grant, its "spellcasting ability modifier" fixed at the caster's for this spell. */
function castGrant(grant: NonNullable<ActorAction["grants"]>, modifier: number): NonNullable<ActorAction["grants"]> {
  const copy = structuredClone(grant);
  if (copy.temporaryHitPointsEachTurn !== "spellcasting-modifier") return copy;
  const { temporaryHitPointsEachTurn: _each, ...rest } = copy;
  return modifier >= 1 ? { ...rest, temporaryHitPointsEachTurn: Math.min(100, modifier) } : rest;
}

/** What an action casting this spell does, from the spell's cast model (`SpellReference.effect`): its spell
 *  attacks, its save, its damage and its healing. `scaled.roll` (an upcast row, a cantrip's tier) replaces only dice
 *  the source's own roll gave, so a reviewed whole-cast roll (Magic Missile's three darts) stands. An attack
 *  spell's save is left to the GM (Ice Knife's burst). */
export function spellCastMechanics(
  spell: SpellReference,
  numbers: Readonly<{ attackBonus: number; saveDc: number; bearersDc: boolean; modifier: number }>,
  scaled: Readonly<{ roll?: string | null; attacks?: number }> = {}
): Pick<ActorAction, "damage"> &
  Partial<
    Pick<
      ActorAction,
      | "attack"
      | "save"
      | "healing"
      | "darts"
      | "damageTypes"
      | "grants"
      | "onHit"
      | "missDamage"
      | "burst"
      | "drain"
      | "endsConditions"
      | "endsOneCondition"
      | "dispel"
      | "endsCurses"
    >
  > {
  // No cast model: the save still applies, and the rest is the GM's.
  const effect = spell.effect ?? { attacks: 0, damage: [], healing: null };
  const scale = (formula: string) => (scaled.roll && formula === spell.damage.roll ? scaled.roll : formula);
  const attacks = scaled.attacks ?? effect.attacks;
  // A save made later or by someone else (Spirit Guardians, Haste) is not the cast's.
  const castSave = effect.noCastSave ? null : spell.save;
  const damage = spellDamage(effect.damage, scale, numbers.modifier);
  return {
    damage,
    // What its damage drains as it lands (Vampiric Touch's healing, Harm's lower Hit Point maximum).
    ...(effect.drain ? { drain: { ...effect.drain } } : {}),
    ...(effect.darts ? { darts: effect.darts } : {}),
    // The type the caster picks: of the damage (Chromatic Orb), of the Resistance it grants (Protection from Energy), or
    // of the area it leaves (Conjure Elemental's element).
    ...(effect.damageTypes &&
    (damage.length > 0 ||
      effect.grant !== undefined ||
      (effect.laterActions ?? []).some((row) => row.zone !== undefined && row.damage.length > 0))
      ? { damageTypes: [...effect.damageTypes] }
      : {}),
    ...(attacks > 0
      ? {
          attack: {
            bonus: numbers.attackBonus,
            ...(attacks > 1 ? { count: Math.min(10, attacks) } : {}),
            ...spellAttackReach(spell)
          },
          // What a hit lands besides its damage (Ray of Sickness's Poisoned), and what a miss still deals (Acid Arrow).
          ...(effect.onHit ? { onHit: structuredClone(effect.onHit) } : {}),
          ...(effect.missDamage ? { missDamage: effect.missDamage } : {}),
          // What bursts after the attack, at the caster's spell save DC (Ice Knife).
          ...(effect.burst ? { burst: { ...structuredClone(effect.burst), dc: numbers.saveDc } } : {})
        }
      : castSave
        ? {
            save: {
              ...castSave,
              // A save the caster makes itself is at the DC the spell prints (Contact Other Plane's 15).
              ...(effect.selfSave
                ? { dc: effect.selfSave.dc, bySelf: true as const }
                : { dc: numbers.saveDc, ...(numbers.bearersDc ? { spellcasting: true } : {}) }),
              ...(effect.failureEffect ? { failureEffect: structuredClone(effect.failureEffect) } : {})
            }
          }
        : {}),
    // What the cast leaves on its targets (Bless, Hunter's Mark), sourced by the caster; Heroism's Temporary Hit Points
    // are the caster's modifier for this spell.
    ...(effect.grant ? { grants: castGrant(effect.grant, numbers.modifier) } : {}),
    ...(effect.healing
      ? {
          healing: {
            formula: formulaPlus(scale(effect.healing.formula), effect.healing.addsModifier ? numbers.modifier : 0),
            ...(effect.healing.divided ? { divided: true as const } : {}),
            ...(effect.healing.toMaximum ? { toMaximum: true as const } : {}),
            ...(effect.healing.self ? { self: true as const } : {}),
            ...(effect.healing.temporary ? { temporary: true as const } : {})
          }
        }
      : {}),
    // Conditions the cast ends (Heal's Blinded, Deafened and Poisoned; Lesser Restoration's pick).
    ...(effect.endsConditions
      ? {
          endsConditions: [...effect.endsConditions],
          ...(effect.endsOneCondition ? { endsOneCondition: true as const } : {})
        }
      : {}),
    // The spells it ends on its target (Dispel Magic), and the curses (Remove Curse).
    ...(effect.dispel ? { dispel: { ...effect.dispel } } : {}),
    ...(effect.endsCurses ? { endsCurses: true as const } : {})
  };
}

/** A cast model's damage parts as an action's: scaled (an upcast row, a cantrip tier), and with the caster's
 *  spellcasting modifier where the spell adds it (Spiritual Weapon's 1d8 + it). */
function spellDamage(
  parts: NonNullable<SpellReference["effect"]>["damage"],
  scale: (formula: string) => string,
  modifier: number
): ActorAction["damage"] {
  return parts.map((part) => ({
    formula: part.addsModifier ? formulaPlus(scale(part.formula), modifier) : scale(part.formula),
    type: part.type
  }));
}

/** The id of the action that casts a spell as a Ritual. */
export const ritualSpellActionId = (spellId: string): string => `spell-${spellId}-ritual`;

/** A casting time of a minute or more ("10 minutes", "8 hours"). */
export const isLongCastingTime = (castingTime: string): boolean => /\b\d+\s*(?:minute|hour)s?\b/i.test(castingTime);

/** The id of the action a spell's later action is minted as ("spell-spirit-guardians-then-save"). */
export const laterSpellActionId = (spellId: string, name: string): string =>
  `spell-${spellId}-then-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** The later action of a spell this action id names, if it is one. */
export function laterRowOf(
  spell: SpellReference,
  actionId: string
): NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number] | undefined {
  return (spell.effect?.laterActions ?? []).find((row) => laterSpellActionId(spell.id, row.name) === actionId);
}

/** One of the things a spell lets its caster do after the cast (`SpellReference.effect.laterActions`), as an action
 *  with the caster's numbers: no slot, the spell's own level (a cantrip's tier through `scaled.roll`). */
export function laterSpellAction(
  spell: SpellReference,
  later: NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number],
  numbers: Readonly<{ attackBonus: number; saveDc: number; bearersDc: boolean; modifier: number }>,
  scaled: Readonly<{ roll?: string | null }> = {}
): ActorAction {
  const scale = (formula: string) => (scaled.roll && formula === spell.damage.roll ? scaled.roll : formula);
  const damage = spellDamage(later.damage, scale, numbers.modifier);
  return {
    id: laterSpellActionId(spell.id, later.name),
    name: `${spell.name}: ${later.name}`,
    activation: later.activation,
    description: `${later.when}\n\n${spell.description}`.slice(0, 12000),
    damage,
    ...(later.attackRange
      ? {
          attack: {
            bonus: numbers.attackBonus,
            ...(later.attackRange.kind === "melee"
              ? { reachFeet: later.attackRange.feet }
              : { rangeFeet: later.attackRange.feet })
          },
          ...(later.onHit ? { onHit: structuredClone(later.onHit) } : {})
        }
      : later.save
        ? { save: { ...later.save, dc: numbers.saveDc, ...(numbers.bearersDc ? { spellcasting: true } : {}) } }
        : {}),
    ...(spell.effect?.damageTypes && damage.length > 0 ? { damageTypes: [...spell.effect.damageTypes] } : {}),
    ...(later.area ? { area: later.area } : {}),
    ...(later.drain ? { drain: { ...later.drain } } : {}),
    // Moving a mark lands the cast's grant on the new creature (`moveMark`).
    ...(later.movesGrant && spell.effect?.grant ? { grants: structuredClone(spell.effect.grant) } : {}),
    spellId: spell.id
  };
}

/** Where a spell's attack reaches, as the attack block carries it: a melee spell attack's `reachFeet` or a ranged
 *  one's `rangeFeet` (no long range: a spell has one range). A cast model from before the build recorded it falls
 *  back to the spell's range, Touch and Self being melee. */
export function spellAttackReach(
  spell: Pick<SpellReference, "effect" | "range">
): Pick<NonNullable<ActorAction["attack"]>, "reachFeet" | "rangeFeet"> {
  const feet = spellRangeFeet(spell.range);
  const reach =
    spell.effect?.attackRange ??
    (feet !== null
      ? { kind: "ranged" as const, feet }
      : spell.range.text !== null && !/^(?:touch|self)/i.test(spell.range.text)
        ? null
        : { kind: "melee" as const, feet: 5 });
  // A range the map can't measure (Sight) is left unchecked; a 5-foot reach would be wrong for it.
  if (reach === null) return { rangeFeet: 5280 };
  return reach.kind === "melee" ? { reachFeet: reach.feet } : { rangeFeet: reach.feet };
}

/** A spell action made before its attack carried a range (an older sheet), given the spell's: otherwise the economy
 *  reads it as a 5-foot melee swing. Unchanged when it has one, or casts no attack. */
export function withSpellAttackReach(action: ActorAction, spell: SpellReference | undefined): ActorAction {
  const attack = action.attack;
  if (!attack || !spell || attack.reachFeet !== undefined || attack.rangeFeet !== undefined) return action;
  return { ...action, attack: { ...attack, ...spellAttackReach(spell) } };
}

/** A spell action made before the cast model carried effects (an older sheet), given the spell's: Bless's d4 and
 *  Bane's penalty land without a rebuild. A later action (Spiritual Weapon's attack) leaves none. */
export function withSpellEffects(action: ActorAction, spell: SpellReference | undefined): ActorAction {
  const effect = spell?.effect;
  if (!spell || !effect || action.spellId !== spell.id) return action;
  const later = (effect.laterActions ?? []).find((row) => laterSpellActionId(spell.id, row.name) === action.id);
  if (later)
    return {
      ...action,
      ...(action.attack && action.onHit === undefined && later.onHit ? { onHit: structuredClone(later.onHit) } : {}),
      ...(action.drain === undefined && later.drain ? { drain: { ...later.drain } } : {})
    };
  const hitRiders =
    action.attack !== undefined
      ? {
          ...(action.onHit === undefined && effect.onHit ? { onHit: structuredClone(effect.onHit) } : {}),
          ...(action.missDamage === undefined && effect.missDamage ? { missDamage: effect.missDamage } : {})
        }
      : {};
  action = {
    ...action,
    ...hitRiders,
    // The light it sheds and the fog or Darkness it fills (`vision/cast-sight.ts`).
    ...(action.sight === undefined && spell.sight ? { sight: structuredClone(spell.sight) } : {}),
    ...(action.drain === undefined && effect.drain ? { drain: { ...effect.drain } } : {}),
    ...(action.endsConditions === undefined && effect.endsConditions
      ? {
          endsConditions: [...effect.endsConditions],
          ...(effect.endsOneCondition ? { endsOneCondition: true as const } : {})
        }
      : {})
  };
  const grants = action.grants === undefined && effect.grant ? structuredClone(effect.grant) : undefined;
  const failureEffect =
    action.save && !action.save.failureEffect && effect.failureEffect
      ? structuredClone(effect.failureEffect)
      : undefined;
  const saveFields = action.save ? newerSaveFields(action.save, spell.save) : {};
  if (!grants && !failureEffect && Object.keys(saveFields).length === 0) return action;
  return {
    ...action,
    ...(grants ? { grants } : {}),
    ...(action.save ? { save: { ...action.save, ...saveFields, ...(failureEffect ? { failureEffect } : {}) } } : {})
  };
}

/** The conditions a caster picks one of for this action's failed save (Blindness/Deafness), read from the spell too
 *  for a sheet built before its cast carried them, or the ones a cure ends one of; empty when the action offers no
 *  choice. */
export function conditionChoicesOf(
  action: Pick<ActorAction, "save" | "spellId" | "endsConditions" | "endsOneCondition">,
  spell: SpellReference | undefined
): readonly string[] {
  // The one condition a cure ends (Lesser Restoration).
  if (action.endsOneCondition && action.endsConditions) return action.endsConditions;
  if (!action.save) return [];
  return action.save.conditionChoices ?? (spell?.id === action.spellId ? (spell?.save?.conditionChoices ?? []) : []);
}

/** Save outcome fields the build has added since a sheet was made, which its cast copied without: the conditions a
 *  caster picks from (Blindness/Deafness). */
const NEWER_SAVE_FIELDS = ["conditionChoices"] as const;

function newerSaveFields(
  save: NonNullable<ActorAction["save"]>,
  printed: SpellReference["save"]
): Partial<NonNullable<ActorAction["save"]>> {
  if (!printed) return {};
  const fields: Record<string, unknown> = {};
  for (const key of NEWER_SAVE_FIELDS)
    if (save[key] === undefined && printed[key] !== undefined) fields[key] = structuredClone(printed[key]);
  return fields as Partial<NonNullable<ActorAction["save"]>>;
}

/** Martial Arts reaches this swing: the bearer has it, it is in force (no armour, no shield) and this is a Monk weapon. */
function martialArtsSwing(item: InventoryItem, definition: ActorDefinition, martialArtsInForce: boolean) {
  const weapon = item.weapon;
  if (!martialArtsInForce || !weapon || !definition.character?.martialArts) return null;
  return isMonkWeapon(weapon.category, weapon.properties ?? [], weapon.rangeFeet, weapon.melee)
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
  return weaponSwing(item, definition, grantedWeapons, martialArtsInForce)?.action ?? null;
}

/** A weapon's attack action, with the dice and ability modifier its damage was built from. */
export type WeaponSwing = Readonly<{ action: ActorAction; dice: string; modifier: number }>;

/** The id suffix of a Versatile weapon's two-handed attack. */
export const TWO_HANDED_SUFFIX = "two-handed";

/** `twoHanded` mints a Versatile weapon's two-handed attack (its own action, `item-<id>-two-handed`) with the
 *  Versatile die; null when the weapon has none. */
export function weaponSwing(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  grantedWeapons: readonly string[] = [],
  martialArtsInForce = false,
  options: Readonly<{ twoHanded?: boolean }> = {}
): WeaponSwing | null {
  const weapon = item.weapon;
  if (!weapon || !definition) return null;
  if (options.twoHanded && !weapon.versatileDice) return null;
  const properties = weapon.properties ?? [];
  const modifier = weaponAbilityModifier(item, definition, martialArtsInForce);
  const weaponDice = options.twoHanded ? weapon.versatileDice! : weapon.damageDice;
  // Martial Arts: the Monk may roll its die in place of the weapon's, so the bigger one is rolled.
  const martialArts = martialArtsSwing(item, definition, martialArtsInForce);
  const dice = martialArts ? biggerDie(weaponDice, martialArts.die) : weaponDice;
  const trained = definition.proficiencies?.weapons;
  // A bound template row also answers to its base weapon's id for proficiency.
  const ids = item.baseId !== undefined ? [catalogIdOf(item), item.baseId] : [catalogIdOf(item)];
  const proficient =
    trained === undefined || trainingCovers(grantedWeapons, weapon, ids) || trainingCovers(trained, weapon, ids);
  const bonus = modifier + (proficient ? definition.proficiencyBonus : 0);
  const action: ActorAction = {
    id: itemActionId(item.id, options.twoHanded ? TWO_HANDED_SUFFIX : undefined),
    name: options.twoHanded ? `${item.name} (two-handed)` : item.name,
    activation: "action",
    description: options.twoHanded
      ? `Attack with ${item.name} in both hands (Versatile).`
      : `Attack with ${item.name}.`,
    attack: {
      bonus,
      // Only a Melee weapon has a reach: a Dart thrown at an adjacent creature is still a ranged attack.
      ...(isMeleeWeapon(properties, weapon.rangeFeet, weapon.melee)
        ? { reachFeet: properties.includes("reach") ? 10 : 5 }
        : {}),
      ...(weapon.rangeFeet !== null
        ? { rangeFeet: weapon.longRangeFeet ?? weapon.rangeFeet, rangeNormalFeet: weapon.rangeFeet }
        : {})
    },
    damage: [{ formula: withModifier(dice, modifier), type: weapon.damageType }]
  };
  return { action, dice, modifier };
}

/** "1d8 + 3", "1d4 - 1", or the dice alone. A fixed amount ("1", a Blowgun) stays as it is: the SRD adds no ability
 *  modifier to fixed damage that doesn't use a roll. */
const withModifier = (dice: string, modifier: number) =>
  !/d/i.test(dice)
    ? dice
    : `${dice}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`;

/**
 * The extra attack a weapon can make beside its own (SRD 5.2.1), minted with it: the Light property's (after an
 * attack with a different Light weapon in the Attack action, as a Bonus Action, or inside that action with Nick) and
 * Cleave's (after a melee hit, at a second creature). Either is once per turn, and neither adds a positive ability
 * modifier to its damage, unless Two-Weapon Fighting puts it back on the Light one. The economy checks what opens it.
 */
export function extraAttackAction(
  item: InventoryItem,
  swing: WeaponSwing,
  kind: "light" | "cleave",
  options: Readonly<{ insideAttackAction?: boolean; keepModifier?: boolean }> = {}
): ActorAction {
  const { action, dice, modifier } = swing;
  const attack = action.attack!;
  const light = kind === "light";
  return {
    id: itemActionId(item.id, kind),
    name: light ? `${item.name} (Light extra attack)` : `${item.name} (Cleave)`,
    activation: light && !options.insideAttackAction ? "bonus-action" : "other",
    description: light
      ? `The Light property's extra attack with ${item.name}, after attacking with a different Light weapon in the Attack action this turn${options.insideAttackAction ? ", made as part of that action (Nick)" : ""}. Once per turn.`
      : `Cleave: after a melee hit with ${item.name}, attack another target within 5 feet of the one you hit and within your reach. Once per turn.`,
    // Cleave is a melee swing even with a thrown weapon.
    attack: light ? attack : { bonus: attack.bonus, reachFeet: attack.reachFeet ?? 5 },
    damage: [
      {
        formula: withModifier(dice, options.keepModifier ? modifier : Math.min(0, modifier)),
        type: action.damage[0]!.type
      }
    ],
    uses: { limit: 1, per: "turn", pool: light ? "light-extra-attack" : "cleave" },
    extraAttack: { kind, itemId: item.id }
  };
}

/** The action cast with a higher slot, from the spell's printed row for that slot: its roll replaces the one the
 *  cast's own roll gave, in the damage and the healing (Cure Wounds' 4d8, Heal's 80), and its count is the rays or
 *  darts the cast makes (Scorching Ray's fourth ray, Magic Missile's fourth dart). A count of targets (Bless, Hold
 *  Person) is a targeting limit and is read elsewhere. */
/** "The damage (both initial and later) increases": what a hit leaves dealing later (Acid Arrow's 2d4) gains the dice
 *  the higher slot adds to the hit, die for die. */
function withScaledOngoing<Rider extends Readonly<{ ongoingDamage?: OngoingDamage }>>(
  rider: Rider,
  base: string | null,
  roll: string | null
): Rider {
  const dice = (formula: string | null) => /^(\d+)d(\d+)$/.exec(formula?.trim() ?? "");
  const from = dice(base);
  const to = dice(roll);
  if (!rider.ongoingDamage || !from || !to || from[2] !== to[2]) return rider;
  const added = Number(to[1]) - Number(from[1]);
  if (added <= 0) return rider;
  return {
    ...rider,
    ongoingDamage: {
      ...rider.ongoingDamage,
      damage: rider.ongoingDamage.damage.map((part) => {
        const own = dice(part.formula);
        return own && own[2] === from[2] ? { ...part, formula: `${Number(own[1]) + added}d${own[2]}` } : part;
      })
    }
  };
}

/** A burst's dice at a slot `above` the spell's level ("The Cold damage increases by 1d6 for each spell slot level
 *  above 1"). */
function burstAt(burst: NonNullable<ActorAction["burst"]>, above: number): NonNullable<ActorAction["burst"]> {
  const added = (burst.diceAddedPerSlot ?? 0) * Math.max(0, above);
  if (added === 0) return burst;
  return {
    ...burst,
    damage: burst.damage.map((part, index) => {
      const dice = /^(\d+)(d\d+)(.*)$/.exec(part.formula);
      return index === 0 && dice ? { ...part, formula: `${Number(dice[1]) + added}${dice[2]}${dice[3]}` } : part;
    })
  };
}

export function upcastAction(action: ActorAction, spell: SpellReference, level: number): ActorAction {
  const row = spell.castingOptions.find((option) => option.type === `slot_level_${level}`);
  if (!row) return action;
  const roll = row.damageRoll;
  const swapFrom =
    (base: string | null | undefined) =>
    (formula: string): string => {
      if (!roll || !base) return formula;
      if (formula === base) return roll;
      const match = /^(\d+d\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(formula.trim());
      return match && match[1] === base
        ? formulaPlus(roll, (match[2] === "-" ? -1 : 1) * Number(match[3] ?? 0))
        : formula;
    };
  const damage = swapFrom(spell.damage.roll);
  const healing = swapFrom(spell.effect?.healing?.formula ?? spell.damage.roll);
  const above = Math.max(0, level - spell.level);
  // A flat amount for each level above ("5 additional Temporary Hit Points for each spell slot level above 1").
  const healingPerSlot = (spell.effect?.healing?.perSlot ?? 0) * above;
  const count = row.targetCount;
  const rays = count !== null && action.attack !== undefined && (spell.effect?.attacks ?? 0) > 1;
  const darts = count !== null && action.darts !== undefined;
  return {
    ...action,
    damage: action.damage.map((part) => ({ ...part, formula: damage(part.formula) })),
    ...(action.onHit ? { onHit: action.onHit.map((rider) => withScaledOngoing(rider, spell.damage.roll, roll)) } : {}),
    // A cast that deals no damage of its own scales its failure's damage on later turns (Ensnaring Strike's 1d6).
    ...(action.save?.ongoingDamage && action.damage.length === 0
      ? { save: { ...action.save, ...withScaledOngoing(action.save, spell.damage.roll, roll) } }
      : {}),
    ...(action.healing
      ? { healing: { ...action.healing, formula: formulaPlus(healing(action.healing.formula), healingPerSlot) } }
      : {}),
    // Aid's "Each target's Hit Points increase by 5 for each spell slot level above 2."
    ...(action.grants?.hitPointMaximumGain?.perSlot
      ? {
          grants: {
            ...action.grants,
            hitPointMaximumGain: {
              ...action.grants.hitPointMaximumGain,
              amount: Math.min(
                100,
                action.grants.hitPointMaximumGain.amount + action.grants.hitPointMaximumGain.perSlot * above
              )
            }
          }
        }
      : {}),
    ...(action.burst ? { burst: burstAt(action.burst, above) } : {}),
    ...(rays ? { attack: { ...action.attack!, count: Math.min(10, count) } } : {}),
    ...(darts ? { darts: Math.min(20, count) } : {})
  };
}
