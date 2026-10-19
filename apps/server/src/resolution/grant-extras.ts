import { abilityModifier, isMeleeWeapon } from "@vtt/rules-5e";
import {
  catalogIdOf,
  resolveSpellcasting,
  type AbilityId,
  type ActorDefinition,
  type DamageType,
  type EffectInstance,
  type GrantOption,
  type InventoryItem,
  type Modifier
} from "@vtt/schemas";
import { spellClassOf } from "../class-features.js";
import { END_EFFECT_ACTION_ID } from "../ending-actions.js";
import { ammunitionOf } from "../ammunition.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { spellOf } from "./concentration.js";
import type { DefinitionAction, LiveActor, ResolveContext, ResolveInput } from "./context.js";

/**
 * What a grant or a failed save adds to its effect beyond the shared fields `grant.ts` and `pending.ts` write: the
 * option the caster picked (Fire Shield's warm or chill, Bestow Curse's curse), hit points each turn, wards by creature
 * type, Bonus Action forms of generic actions, an action that ends it, a later action of the spell its bearer may take
 * (Dragon's Breath), and a binding to one carried weapon (Magic Weapon, Shillelagh).
 */

type Grant = NonNullable<DefinitionAction["grants"]>;
type EndAction = NonNullable<Grant["endAction"]>;

/** The choices an action offers: its grant's, else its failed save's. */
export type Offered = Readonly<{ options: readonly GrantOption[]; perTarget: boolean }>;

export function optionsOf(action: DefinitionAction): Offered | null {
  const grant = action.grants;
  if (grant?.options) return { options: grant.options, perTarget: grant.optionsPerTarget === true };
  const failure = action.save?.failureEffect;
  if (failure?.options) return { options: failure.options, perTarget: failure.optionsPerTarget === true };
  return null;
}

/** Refuses a pick the action doesn't offer, and a weapon its own grant can't bind, before anything rolls. */
export function checkChoices(
  action: DefinitionAction,
  input: ResolveInput,
  attacker: LiveActor,
  catalog: EquipmentCatalog | undefined
): void {
  const offered = optionsOf(action);
  // End an Effect's pick is the way out it takes (`resolution/endings.ts`).
  const own = action.id === END_EFFECT_ACTION_ID ? [] : [input.optionId];
  const picks = [...own, ...Object.values(input.targetOptions ?? {})].filter(
    (pick): pick is string => typeof pick === "string"
  );
  for (const pick of picks)
    if (!offered?.options.some((option) => option.id === pick))
      throw new CommandRejectedError(`${action.name} doesn't offer that choice.`);
  if (Object.keys(input.targetOptions ?? {}).some((id) => !input.targetIds.includes(id)))
    throw new CommandRejectedError("Each choice must be for one of the action's targets.");
  const binds = action.grants?.bindsWeapon;
  if (input.itemId != null && !binds && !action.rebindsRow)
    throw new CommandRejectedError(`${action.name} isn't cast on a weapon.`);
  if (binds && input.itemId != null && action.grants!.target === "self")
    fittingRow(attacker, binds, input.itemId, catalog, action.name);
}

/** The option picked for one recipient: its own under `optionsPerTarget`, else the resolve's, else the first. */
export function optionFor(
  ctx: Pick<ResolveContext, "input" | "warnings">,
  offered: Offered | null,
  recipient: Pick<LiveActor, "id" | "name">,
  what: string
): GrantOption | null {
  if (!offered) return null;
  const pick = (offered.perTarget ? ctx.input.targetOptions?.[recipient.id] : undefined) ?? ctx.input.optionId;
  const found = pick == null ? undefined : offered.options.find((option) => option.id === pick);
  if (found) return found;
  ctx.warnings.push(`${what} on ${recipient.name}: nothing was picked, so it is ${offered.options[0]!.name}.`);
  return offered.options[0]!;
}

/** An effect's name with the option picked for it: "Fire Shield (Chill Shield)". */
export const withOptionName = (name: string, option: GrantOption | null): string =>
  (option ? `${name} (${option.name})` : name).slice(0, 120);

/** The caster's spell numbers for the spell this resolve casts: its class's, else the sheet's, else worked out. */
export function casterSpellNumbers(
  definition: ActorDefinition | undefined,
  spellId: string | undefined
): Readonly<{
  ability: AbilityId | null;
  modifier: number;
  saveDc: number;
  attackBonus: number;
}> {
  const casting = resolveSpellcasting(definition?.spellcasting, spellClassOf(definition, spellId) ?? undefined);
  const ability = casting?.ability ?? null;
  const modifier = ability && definition ? abilityModifier(definition.abilityScores[ability]) : 0;
  const proficiency = definition?.proficiencyBonus ?? 2;
  return {
    ability,
    modifier,
    saveDc: casting?.saveDc ?? 8 + proficiency + modifier,
    attackBonus: casting?.attackBonus ?? proficiency + modifier
  };
}

/** An end action as the effect keeps it, its DC resolved: the spell save DC the action carries, else the caster's. */
export function resolvedEndAction(
  ctx: Pick<ResolveContext, "action" | "deps">,
  endAction: EndAction | undefined
): Partial<Pick<EffectInstance, "endAction">> {
  if (!endAction) return {};
  const dc =
    endAction.dc !== "spellcasting"
      ? endAction.dc
      : ctx.action.save?.spellcasting
        ? ctx.action.save.dc
        : casterSpellNumbers(ctx.deps.definition, ctx.action.spellId).saveDc;
  return { endAction: { ...endAction, dc: Math.max(1, Math.min(40, dc)) } };
}

/** What an option adds to an effect's own parts. */
export function optionParts(option: GrantOption | null): Readonly<{
  tags: readonly string[];
  modifiers: readonly Modifier[];
  conditions: readonly string[];
  conditionImmunities: readonly string[];
  suppresses: readonly string[];
}> {
  return {
    tags: option?.tags ?? [],
    modifiers: option?.modifiers ?? [],
    conditions: option?.conditions ?? [],
    conditionImmunities: option?.conditionImmunities ?? [],
    suppresses: option?.suppressesConditions ?? []
  };
}

/** The grant's own extra fields for one recipient, with the option picked for it. */
export function grantExtras(
  ctx: ResolveContext,
  grant: Grant,
  recipient: LiveActor,
  option: GrantOption | null
): Partial<EffectInstance> {
  const bonusActions = [...new Set([...(grant.bonusActions ?? []), ...(option?.bonusActions ?? [])])];
  return {
    ...(grant.hitPointsEachTurn !== undefined ? { hitPointsEachTurn: grant.hitPointsEachTurn } : {}),
    ...(grant.conditionWards ? { conditionWards: structuredClone(grant.conditionWards) } : {}),
    ...(bonusActions.length > 0 ? { bonusActions: bonusActions.slice(0, 3) } : {}),
    ...resolvedEndAction(ctx, grant.endAction),
    ...(grant.shrinksEachLongRest ? { shrinksEachLongRest: true as const } : {}),
    ...(option ? { optionId: option.id } : {}),
    ...(option?.speedZero ? { speedZero: true } : {}),
    ...(grant.endsOnDamage || option?.endsOnDamage ? { endsOnDamage: true } : {}),
    ...struckOf(grant, option),
    ...unarmedStrikeOf(ctx, option),
    ...grantedSpellActionOf(ctx, grant, option, recipient)
  };
}

/** Alter Self's natural weapons: the Unarmed Strike's die, type and ability, the granter's spellcasting one resolved. */
function unarmedStrikeOf(
  ctx: ResolveContext,
  option: GrantOption | null
): Partial<Pick<EffectInstance, "unarmedStrike">> {
  const strike = option?.unarmedStrike;
  if (!strike) return {};
  const ability =
    strike.ability === "spellcasting"
      ? casterSpellNumbers(ctx.deps.definition, ctx.action.spellId).ability
      : strike.ability;
  return {
    unarmedStrike: { ...(ability ? { ability } : {}), dice: strike.dice, damageTypes: [strike.damageType] }
  };
}

/** Fire Shield: what a creature that hits the bearer in melee takes, of the type the option picked (warm: Fire,
 *  chill: Cold). */
function struckOf(grant: Grant, option: GrantOption | null): Partial<Pick<EffectInstance, "struck">> {
  const struck = grant.struck;
  const type = option?.damageType;
  if (!struck?.damage || !type) return {};
  return { struck: { ...structuredClone(struck), damage: struck.damage.map((part) => ({ ...part, type })) } };
}

/** Dragon's Breath: the spell's later action the recipient may take while it lasts, at the numbers it was cast with
 *  and the damage type picked then. */
function grantedSpellActionOf(
  ctx: ResolveContext,
  grant: Grant,
  option: GrantOption | null,
  recipient: LiveActor
): Partial<Pick<EffectInstance, "grantedSpellAction">> {
  if (grant.grantsLaterAction === undefined) return {};
  const spell = spellOf(ctx);
  const later = spell?.effect?.laterActions?.find((row) => row.name === grant.grantsLaterAction);
  if (!spell || !later) {
    ctx.warnings.push(`${recipient.name} gets no action from ${ctx.action.name}: the spell has none by that name.`);
    return {};
  }
  const numbers = casterSpellNumbers(ctx.deps.definition, ctx.action.spellId);
  const picked = ctx.input.damageType ?? null;
  const damageType = (option?.damageType ??
    (picked !== null && ctx.action.damageTypes?.includes(picked as never) ? picked : ctx.action.damageTypes?.[0])) as
    DamageType | undefined;
  return {
    grantedSpellAction: {
      spellId: spell.id,
      name: later.name,
      level: ctx.plan.castLevel ?? spell.level,
      saveDc: ctx.action.save?.spellcasting ? ctx.action.save.dc : numbers.saveDc,
      attackBonus: numbers.attackBonus,
      modifier: Math.max(-5, Math.min(15, numbers.modifier)),
      ...(damageType ? { damageType } : {})
    }
  };
}

/** The carried row a grant binds to on its recipient, refused when it doesn't fit what the grant names. */
function fittingRow(
  bearer: Pick<LiveActor, "name" | "inventory">,
  binds: NonNullable<Grant["bindsWeapon"]>,
  itemId: string,
  catalog: EquipmentCatalog | undefined,
  what: string
): InventoryItem {
  const row = bearer.inventory.find((entry) => entry.id === itemId && entry.quantity > 0);
  if (!row)
    throw new CommandRejectedError(`${bearer.name} isn't carrying that ${binds.ammunition ? "ammunition" : "weapon"}.`);
  const problem = rowProblem(row, binds, catalog);
  if (problem) throw new CommandRejectedError(`${what} can't be cast on ${row.name}: ${problem}.`);
  return row;
}

/** Why a row doesn't fit a binding, or null when it does. */
function rowProblem(
  row: InventoryItem,
  binds: NonNullable<Grant["bindsWeapon"]>,
  catalog: EquipmentCatalog | undefined
): string | null {
  if (binds.ammunition) return ammunitionOf(row, catalog) === null ? "it isn't ammunition" : null;
  const weapon = row.weapon;
  if (!weapon) return "it isn't a weapon";
  const ids = row.baseId !== undefined ? [catalogIdOf(row), row.baseId] : [catalogIdOf(row)];
  if (binds.weaponIds && !binds.weaponIds.some((id) => ids.includes(id)))
    return `it works only on ${binds.weaponIds.join(" or ")}`;
  if (binds.nonmagical && catalog?.equipmentRecord(catalogIdOf(row))?.isMagic === true) return "it is already magical";
  if (binds.melee && !isMeleeWeapon(weapon.properties ?? [], weapon.rangeFeet, weapon.melee))
    return "it isn't a Melee weapon";
  return null;
}

/** The granter's character level, for dice that grow with it (Shillelagh's d10 at level 5). */
function granterLevel(definition: ActorDefinition | undefined): number {
  const total = (definition?.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0);
  return total >= 1 ? total : 1;
}

/**
 * The weapon a grant binds to and what it does to it: the row picked on the resolve (else the first carried one that
 * fits, which the GM is told), the ability and dice it swings with, the damage types its wielder may pick, and its
 * bonuses as `this-item` riders (Magic Weapon's +1 by slot, Sacred Weapon's Charisma). Nothing when no row fits.
 */
export function boundWeaponOf(
  ctx: ResolveContext,
  grant: Grant,
  recipient: LiveActor
): Readonly<{ fields: Partial<Pick<EffectInstance, "itemId" | "weapon">>; modifiers: Modifier[] }> | null {
  const binds = grant.bindsWeapon;
  if (!binds) return null;
  const { input, deps, warnings, action } = ctx;
  let row: InventoryItem | undefined;
  if (input.itemId != null) row = fittingRow(recipient, binds, input.itemId, deps.catalog, action.name);
  else {
    const carried = recipient.inventory.filter((entry) => entry.quantity > 0);
    row = [...carried.filter((entry) => entry.equipped), ...carried].find(
      (entry) => rowProblem(entry, binds, deps.catalog) === null
    );
    if (!row) {
      warnings.push(`${recipient.name} carries no weapon ${action.name} can be cast on, so nothing is bound.`);
      return null;
    }
    warnings.push(`${action.name}: no weapon was picked, so it is on ${row.name}.`);
  }
  const definition = deps.definition;
  const numbers = casterSpellNumbers(definition, action.spellId);
  const ability = binds.ability === "spellcasting" ? numbers.ability : (binds.ability ?? null);
  const level = granterLevel(definition);
  const dice = [...(binds.dice ?? [])]
    .filter((entry) => entry.level <= level)
    .sort((a, b) => b.level - a.level)[0]?.formula;
  const weapon = {
    ...(ability ? { ability } : {}),
    ...(dice ? { dice } : {}),
    ...(binds.damageTypes ? { damageTypes: [...binds.damageTypes] } : {})
  };
  const castLevel = ctx.plan.castLevel ?? spellOf(ctx)?.level ?? 1;
  const slotBonus = [...(binds.bonusBySlot ?? [])]
    .filter((entry) => entry.level <= castLevel)
    .sort((a, b) => b.level - a.level)[0]?.bonus;
  const abilityBonus = binds.attackBonusAbility
    ? Math.max(
        binds.attackBonusAbility.minimum,
        definition ? abilityModifier(definition.abilityScores[binds.attackBonusAbility.ability]) : 0
      )
    : 0;
  const attackBonus = (slotBonus ?? 0) + abilityBonus;
  const modifiers: Modifier[] = [
    ...(attackBonus !== 0 ? [{ type: "attack-bonus" as const, amount: attackBonus, scope: "this-item" as const }] : []),
    ...(slotBonus ? [{ type: "damage-bonus" as const, amount: slotBonus, scope: "this-item" as const }] : [])
  ];
  return {
    fields: { itemId: row.id, ...(Object.keys(weapon).length > 0 ? { weapon } : {}) },
    modifiers
  };
}
