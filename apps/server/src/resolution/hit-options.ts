import type { HitOffer, HitOptionChoice } from "@vtt/domain";
import { isMeleeWeapon, parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { catalogIdOf, DamageTypeSchema, DiceFormulaSchema, type HitRiderEffect } from "@vtt/schemas";
import { ABILITY_NAMES } from "../ability-checks.js";
import { builtinBaseId } from "../builtin-actions.js";
import { holdsFeature } from "../class-features.js";
import { isIncapacitated } from "../condition-rules.js";
import { areAllies } from "../creature-sides.js";
import { addEffect, applyCondition, makeEffect, type EffectNarration } from "../effects.js";
import { sourceItemOf } from "../equipment-derivation.js";
import { RulesBlockedError } from "../game-store.js";
import { upcastAction, UNARMED_STRIKE_ACTION_ID } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { SMITE_OF_PROTECTION_TAG } from "../paladin-auras.js";
import { effectiveModeFor, overrideCovers, overrideWaives } from "../rules-families.js";
import { useCostOf } from "../use-cost.js";
import { recordRoll, sizeAtMost, tableLineOf, type DefinitionAction, type ResolveContext } from "./context.js";
import { beginConcentration } from "./concentration.js";
import { criticalExpression } from "./damage.js";
import { commitEconomy, evaluateActionEconomy, planEconomy, spendSlot } from "./economy.js";
import { applyHitOutcome, forceMove, grantHalfSpeedMove, openRiderSave, rollPlain } from "./hit-rider-outcomes.js";
import { hitRiderOf, type HitRider } from "./hit-riders.js";
import { dealsDamage } from "./on-hit.js";
import { spendHitPointDie } from "./hit-point-die.js";

/**
 * Extras a hit can carry, which the attacker chooses on the attack's preview and spends with the hit (SRD Sneak
 * Attack, the smites, Stunning Strike, Brutal Strike, a monster's charge). Their dice join the hit's damage, so a
 * crit doubles them ("If the attack involves other damage dice, such as from the Rogue's Sneak Attack feature, you
 * also roll those dice twice") and the target's defences meet them as part of the one hit. A rider with a save opens
 * it on the hit's target, its dice riding the save. On a miss nothing is spent.
 */

const landed = (ctx: ResolveContext) =>
  ctx.attack !== null &&
  (ctx.attack.outcome === "hit" || ctx.attack.outcome === "crit" || ctx.attack.outcome === "unknown");

/** SRD Monk weapons: "Simple Melee weapons and Martial Melee weapons that have the Light property". */
function monkWeapon(ctx: ResolveContext): boolean {
  const weapon = ctx.attacker.inventory.find((item) => item.id === ctx.riderItemId)?.weapon;
  if (!weapon || !isMeleeWeapon(weapon.properties ?? [], weapon.rangeFeet, weapon.melee)) return false;
  return weapon.category === "simple" || (weapon.properties ?? []).includes("light");
}

/** An Unarmed Strike Flurry of Blows grants: it spends a strike the Bonus Action opened. */
function fromFlurry(ctx: ResolveContext): boolean {
  const open = ctx.state.combat.turn.bonusActionInstance;
  const planned = ctx.plan.bonusInstance;
  return (
    open !== null &&
    planned !== null &&
    open.actorId === ctx.attacker.id &&
    planned !== open &&
    !ctx.plan.markBonus &&
    ctx.siblings.some(
      (sibling) =>
        sibling.activation === "bonus-action" &&
        (sibling.multiattack ?? []).some((component) => component.actionId === UNARMED_STRIKE_ACTION_ID)
    )
  );
}

/** The pact weapon (SRD Pact of the Blade): the weapon of the kind the Warlock picked for it. Any other weapon may be a
 *  magic weapon the Warlock bonded instead, which the attacker vouches for. */
function pactWeapon(ctx: ResolveContext): true | string {
  const picked = ctx.deps.definition?.character?.choices?.find(
    (choice) => choice.kind === "weapon" && choice.payload?.featureId === "pact-of-the-blade"
  )?.id;
  const item = ctx.attacker.inventory.find((row) => row.id === ctx.riderItemId);
  if (picked !== undefined && item && (catalogIdOf(item) === picked || item.baseId === picked)) return true;
  return `Only with ${ctx.attacker.name}'s pact weapon.`;
}

/** Whether this hit can carry the rider: true, false, or what the engine couldn't check for the attacker to vouch for. */
function qualifies(ctx: ResolveContext, rider: HitRider, action: DefinitionAction): true | false | string {
  const kinds = ctx.riderFilters.attackKinds ?? [];
  const attack = ctx.action.attack!;
  const weapon = kinds.includes("weapon");
  const unarmed = kinds.includes("unarmed") || builtinBaseId(ctx.action.id) === UNARMED_STRIKE_ACTION_ID;
  let verdict: true | string = true;
  switch (rider.rides) {
    case "attack-roll":
      break;
    case "weapon":
      if (!weapon) return false;
      break;
    case "melee-weapon-or-unarmed":
      if (!unarmed && !(weapon && attack.reachFeet !== undefined)) return false;
      break;
    case "finesse-or-ranged-weapon": {
      const finesse = (ctx.riderFilters.weaponProperties ?? []).includes("finesse");
      const rangedWeapon = attack.reachFeet === undefined && attack.rangeFeet !== undefined;
      if (!weapon || (!finesse && !rangedWeapon)) return false;
      break;
    }
    case "monk-weapon-or-unarmed":
      if (!unarmed && !(weapon && monkWeapon(ctx))) return false;
      break;
    case "unarmed":
      if (!unarmed) return false;
      break;
    case "flurry-of-blows":
      if (!unarmed || !fromFlurry(ctx)) return false;
      break;
    case "strength-attack":
      if ((!weapon && !unarmed) || ctx.riderFilters.ability !== "str") return false;
      break;
    case "pact-weapon":
      if (!weapon) return false;
      verdict = pactWeapon(ctx);
      break;
    case "this-weapon":
    case "melee-this-weapon":
      if (!weapon || sourceItemOf(action, ctx.derivation, ctx.attacker.inventory) !== ctx.riderItemId) return false;
      if (rider.rides === "melee-this-weapon" && !kinds.includes("melee")) return false;
      break;
  }
  if (rider.ownTurn && ctx.state.combat.turnActorId !== ctx.attacker.id) return false;
  if (rider.declaredBeforeRoll && ctx.forgoneAdvantageBy !== action.id) return false;
  if (rider.maxTargetSize && !sizeAtMost(ctx.targets[0].size, rider.maxTargetSize)) return false;
  if (rider.sneakAttack) {
    const sneak = sneakAttackQualifies(ctx);
    if (sneak === false) return false;
    if (typeof sneak === "string") verdict = sneak;
  }
  return verdict;
}

/** SRD Sneak Attack: Advantage, or an ally within 5 feet of the target who isn't Incapacitated, without Disadvantage. */
function sneakAttackQualifies(ctx: ResolveContext): true | false | string {
  const mode = ctx.rollMode?.mode ?? "normal";
  if (mode === "advantage") return true;
  if (mode === "disadvantage") return false;
  const { state, attacker, deps } = ctx;
  const target = ctx.targets[0];
  let unmeasured = false;
  for (const entry of state.combat.initiative) {
    const ally = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!ally || ally.id === attacker.id || ally.id === target.id) continue;
    if (!areAllies(attacker, ally, deps.resolveDefinition) || ally.hp.current <= 0 || isIncapacitated(ally)) continue;
    // An ally hidden from the table never qualifies a visible attacker on its own: the offer would reveal it.
    if (ctx.hiddenFromTable(ally.id) && !ctx.hiddenFromTable(attacker.id)) continue;
    const apart = deps.distanceFeet?.(ally.id, target.id) ?? null;
    if (apart === null) unmeasured = true;
    else if (apart <= 5 + DISTANCE_TOLERANCE_FEET) return true;
  }
  return unmeasured ? "The map can't show whether an ally is within 5 feet of the target." : false;
}

/** The dice a rider adds at a slot level (a smite cast higher rolls more). */
function riderAction(ctx: ResolveContext, action: DefinitionAction, slotLevel: number | undefined): DefinitionAction {
  const spell = action.spellId ? ctx.deps.catalog?.spellRecord?.(action.spellId) : undefined;
  return slotLevel !== undefined && spell && action.spellSlot && slotLevel > action.spellSlot.level
    ? upcastAction(action, spell, slotLevel)
    : action;
}

/** The spell slots a slot-cast rider can use now, lowest first. */
function openSlots(ctx: ResolveContext, action: DefinitionAction): number[] {
  if (!action.spellSlot) return [];
  return (ctx.attacker.spellSlots ?? [])
    .filter((slot) => slot.level >= action.spellSlot!.level && slot.remaining > 0)
    .map((slot) => slot.level)
    .sort((left, right) => left - right);
}

/** The Pact Magic slot a rider spends (Eldritch Smite), or null with none left. */
function openPactSlot(ctx: ResolveContext): number | null {
  const pact = ctx.attacker.pactSlots;
  return pact && pact.remaining > 0 ? pact.level : null;
}

const capitalised = (type: string) => (type.length > 0 ? `${type[0].toUpperCase()}${type.slice(1)}` : type);
const titled = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => capitalised(word))
    .join(" ");

/** What choosing it spends, in the card's words. */
function costOf(action: DefinitionAction, rider: HitRider, slotLevel: number | undefined): string | null {
  const uses = action.uses;
  const spent = useCostOf(action);
  const costs = [
    ...(action.spellSlot && slotLevel !== undefined ? [`a level ${slotLevel} spell slot`] : []),
    ...(rider.pactSlotDie ? ["a Pact Magic slot"] : []),
    ...(uses && !rider.declaredBeforeRoll
      ? [
          uses.per === "turn"
            ? "once per turn"
            : uses.pool && uses.pool !== action.id
              ? `${spent} ${spent === 1 ? "use" : "uses"} of ${titled(uses.pool)}`
              : `a use of ${action.name}`
        ]
      : []),
    ...(rider.oncePerTurn ? ["once per turn"] : []),
    ...(action.activation === "bonus-action" ? ["your Bonus Action"] : [])
  ];
  return costs.length > 0 ? [...new Set(costs)].join(" and ") : null;
}

/** Whether the rider's own economy allows it now: its uses, its slot, and a Bonus Action the hit didn't take. A
 *  declared rider was paid for when it was tapped. */
function affordable(ctx: ResolveContext, action: DefinitionAction, rider: HitRider): boolean {
  if (rider.declaredBeforeRoll) return true;
  if (action.activation === "bonus-action" && ctx.plan.markBonus) return false;
  const slots = openSlots(ctx, action);
  if (action.spellSlot && slots.length === 0) return false;
  if (rider.pactSlotDie && openPactSlot(ctx) === null) return false;
  const evaluation = evaluateActionEconomy(
    ctx.state,
    ctx.attacker,
    action,
    [],
    ctx.deps.definition,
    undefined,
    ctx.siblings,
    slots[0],
    true
  );
  return evaluation.violations.length === 0;
}

/** The charge a monster's attack prints, when the target is small enough for it. */
function chargeOf(ctx: ResolveContext) {
  const charge = ctx.action.conditionalDamage?.find((variant) => variant.when === "charge");
  if (!charge) return undefined;
  return charge.maxTargetSize === undefined || sizeAtMost(ctx.targets[0].size, charge.maxTargetSize)
    ? charge
    : undefined;
}

/** The effects a rider offers this hit: the ones its bearer holds the feature and item for, against a target small
 *  enough. */
function offeredEffects(ctx: ResolveContext, rider: HitRider): HitRiderEffect[] {
  const target = ctx.targets[0];
  return (rider.effects ?? []).filter(
    (effect) =>
      (effect.requiresFeature === undefined ||
        holdsFeature(ctx.deps.definition, effect.requiresFeature, titled(effect.requiresFeature))) &&
      (effect.requiresItem === undefined ||
        ctx.attacker.inventory.some((item) => item.quantity > 0 && catalogIdOf(item) === effect.requiresItem)) &&
      (effect.maxTargetSize === undefined || sizeAtMost(target.size, effect.maxTargetSize))
  );
}

/** The rider's dice, in the type the hit or the pick makes them. */
function diceOf(ctx: ResolveContext, action: DefinitionAction, rider: HitRider, slotLevel: number | undefined): string {
  const pact = rider.pactSlotDie ? openPactSlot(ctx) : null;
  const dice =
    pact !== null && rider.pactSlotDie
      ? [`${pact + 1}${rider.pactSlotDie.slice(1)}`]
      : riderAction(ctx, action, slotLevel).damage.map((part) => part.formula);
  if (dice.length === 0) return "";
  const types = rider.damageTypes ?? (rider.weaponType ? [ctx.action.damage[0]?.type ?? "untyped"] : null);
  return `${dice.join(" + ")} ${types ? types.map(capitalised).join(" or ") : capitalised(action.damage[0]?.type ?? "")}`.trim();
}

/** The extras a previewed hit may carry, for the card to offer. Empty unless the attack would land. */
export function hitOffersOf(ctx: ResolveContext): HitOffer[] {
  if (!landed(ctx) || ctx.targets.length !== 1) return [];
  const offers: HitOffer[] = [];
  const charge = chargeOf(ctx);
  if (charge)
    offers.push({
      id: "charge",
      name: "Charge",
      dice: charge.damage.map((part) => `${part.formula} ${capitalised(part.type)}`).join(" + "),
      cost: null,
      unverified: `Only if ${ctx.attacker.name} moved ${charge.feet ?? 20}+ feet straight toward the target immediately before the hit.`
    });
  for (const action of ctx.siblings) {
    const rider = hitRiderOf(action);
    if (!rider || action.id === ctx.action.id) continue;
    const verdict = qualifies(ctx, rider, action);
    if (verdict === false || !affordable(ctx, action, rider)) continue;
    const effects = offeredEffects(ctx, rider);
    if (rider.effectRequired && effects.length === 0) continue;
    const slotLevels = openSlots(ctx, action);

    const dice = diceOf(ctx, action, rider, slotLevels[0]);
    // A rider that only rolls dice needs dice; one that does something else (a save, an effect) is offered anyway.
    if (dice === "" && !action.save && !rider.applies && effects.length === 0) continue;
    const notes = [
      typeof verdict === "string" ? verdict : null,
      rider.dealsDamage ? "Only if the hit deals damage." : null
    ]
      .filter((note): note is string => note !== null)
      .join(" ");
    offers.push({
      id: action.id,
      name: action.name,
      dice: action.save ? "" : dice,
      ...(action.save
        ? {
            save: `The target makes a ${ABILITY_NAMES[action.save.ability]} saving throw.${dice !== "" ? ` A failure deals ${dice}.` : ""}`
          }
        : {}),
      cost: costOf(action, rider, slotLevels[0]),
      ...(rider.damageTypes ? { damageTypes: rider.damageTypes } : {}),
      ...(slotLevels.length > 0 ? { slotLevels } : {}),
      ...(notes !== "" ? { unverified: notes } : {}),
      ...(effects.length > 0
        ? {
            effects: effects.map((effect) => ({
              id: effect.id,
              name: effect.name,
              ...(effect.forgoesDice ? { cost: `-${effect.forgoesDice}d6` } : {})
            })),
            effectsChoose: rider.effectsChoose ?? 1
          }
        : {}),
      ...(rider.effectRequired ? { effectRequired: true as const } : {})
    });
  }
  return offers;
}

/** Refuses an extra this hit can't carry, unless the GM's override covers the targeting family. */
function refuse(ctx: ResolveContext, message: string): void {
  const rule = "attack.hit-option-unqualified" as const;
  if (effectiveModeFor(ctx.state.combat, rule) === "freeform") return;
  if (overrideWaives(ctx.input.override, rule) || overrideCovers(ctx.state.combat.turn, rule)) return;
  if (effectiveModeFor(ctx.state.combat, rule) === "strict") throw new RulesBlockedError(rule, message);
  ctx.warnings.push(message);
}

/** The effects picked for a rider, checked against what it offers and how many one hit carries. */
function pickedEffects(
  ctx: ResolveContext,
  rider: HitRider,
  action: DefinitionAction,
  choice: HitOptionChoice
): HitRiderEffect[] {
  const offered = offeredEffects(ctx, rider);
  const picked = [...new Set(choice.effects ?? [])].flatMap((id) => {
    const effect = offered.find((candidate) => candidate.id === id);
    if (effect) return [effect];
    const named = rider.effects?.find((candidate) => candidate.id === id)?.name ?? id;
    refuse(ctx, `${action.name} can't add ${named} to this hit.`);
    return [];
  });
  const most = rider.effectsChoose ?? 1;
  if (picked.length > most) {
    refuse(ctx, `${action.name} adds ${most === 1 ? "one effect" : `up to ${most} effects`} to a hit.`);
    return picked.slice(0, most);
  }
  if (rider.effectRequired && picked.length === 0 && offered.length > 0)
    refuse(ctx, `Choose one of ${action.name}'s effects for this hit.`);
  return picked;
}

/** The rider's dice less the dice its effects forgo (a Cunning Strike's die cost), taken off the first part. */
function lessForgone(
  damage: DefinitionAction["damage"],
  forgone: number,
  action: DefinitionAction,
  ctx: ResolveContext
): DefinitionAction["damage"] {
  if (forgone === 0 || damage.length === 0) return damage;
  const [first, ...rest] = damage;
  const match = /^(\d+)d(\d+)(.*)$/.exec(first.formula.replace(/\s+/g, ""));
  if (!match) return damage;
  const count = Number(match[1]) - forgone;
  if (count < 0) {
    refuse(ctx, `${action.name} has ${match[1]}d${match[2]} to forgo, and the effects cost ${forgone}d${match[2]}.`);
    return [];
  }
  return count === 0 ? rest : [{ ...first, formula: `${count}d${match[2]}${match[3]}` }, ...rest];
}

/** Rolls the chosen extras into the hit's damage and opens their saves. Their costs are spent after the hit's own
 *  (`spendHitOptions`). */
export function rollHitOptions(ctx: ResolveContext): void {
  const chosen = ctx.input.hitOptions ?? [];
  if (chosen.length === 0 || !landed(ctx) || ctx.targets.length !== 1) return;
  const target = ctx.targets[0];
  const roll = (formula: string, type: string, source: string) => {
    const expression = parseDiceFormula(formula);
    const rolled = resolveDice(ctx.crit ? criticalExpression(expression) : expression, ctx.deps.random);
    recordRoll(ctx, rolled, "damage");
    ctx.damage.push({ formula: rolled.expression.source, type, total: rolled.total, source });
  };
  // "And deal damage to it" is judged on the hit as it stands, before any extra joins it.
  const hitDealsDamage = dealsDamage(ctx);
  // Riders on one pool are alternatives (a Staff of Striking's 1, 2 or 3 charges), so one hit takes one of them.
  const byPool = new Map<string, string>();
  for (const choice of chosen) {
    const action = ctx.siblings.find((candidate) => candidate.id === choice.id);
    const pool = action?.uses?.pool;
    if (!action || !pool) continue;
    const other = byPool.get(pool);
    if (other !== undefined)
      refuse(ctx, `${other} and ${action.name} spend the same uses, so a hit takes one of them.`);
    byPool.set(pool, action.name);
  }
  for (const choice of chosen) {
    if (choice.id === "charge") {
      rollCharge(ctx, roll);
      continue;
    }
    const action = ctx.siblings.find((candidate) => candidate.id === choice.id);
    const rider = action ? hitRiderOf(action) : undefined;
    if (!action || !rider) {
      refuse(ctx, `${ctx.attacker.name} has no ${choice.id} to add to this hit.`);
      continue;
    }
    const verdict = qualifies(ctx, rider, action);
    if (verdict === false)
      refuse(
        ctx,
        rider.sneakAttack
          ? `Sneak Attack needs a Finesse or Ranged weapon and Advantage, or an ally within 5 feet of ${target.name} and no Disadvantage.`
          : `${action.name} can't ride this attack.`
      );
    else if (typeof verdict === "string") ctx.warnings.push(`${action.name}: ${verdict} The attacker confirmed it.`);
    if (rider.dealsDamage && !hitDealsDamage) {
      ctx.warnings.push(`${action.name}: the hit dealt ${target.name} no damage, so it adds nothing.`);
      continue;
    }
    const effects = pickedEffects(ctx, rider, action, choice);
    const slotLevel = action.spellSlot ? (choice.slotLevel ?? openSlots(ctx, action)[0]) : undefined;
    const pactSlot = rider.pactSlotDie ? openPactSlot(ctx) : null;
    if (rider.pactSlotDie && pactSlot === null) {
      refuse(ctx, `${ctx.attacker.name} has no Pact Magic slot left for ${action.name}.`);
      continue;
    }
    // Its own economy (uses, once per turn, slot, Bonus Action) refuses it before anything it does lands; it is
    // planned again and spent once the hit's own is in (`spendHitOptions`), and its notes are said then. A declared
    // rider was paid for when it was tapped.
    if (!rider.declaredBeforeRoll) riderEconomy(ctx, action, slotLevel, []);
    const cast = riderAction(ctx, action, slotLevel);
    const forgone = effects.reduce((sum, effect) => sum + (effect.forgoesDice ?? 0), 0);
    const parts =
      pactSlot !== null && rider.pactSlotDie
        ? [{ formula: `${pactSlot + 1}${rider.pactSlotDie.slice(1)}`, type: cast.damage[0]?.type ?? "force" }]
        : lessForgone(cast.damage, forgone, action, ctx);
    const pick =
      choice.damageType && rider.damageTypes?.includes(choice.damageType as never) ? choice.damageType : undefined;
    const typeOf = (part: DefinitionAction["damage"][number]) =>
      rider.weaponType ? (ctx.action.damage[0]?.type ?? part.type) : (pick ?? rider.damageTypes?.[0] ?? part.type);
    const creatureType = ctx.riderFilters.targetCreatureType;
    const spared = creatureType !== undefined && (rider.sparesCreatureTypes ?? []).includes(creatureType);
    if (action.save) {
      // The rider's save carries its dice: rolled now, dealt on a failure, none on a success.
      const failureDamage = spared ? [] : parts.map((part) => rollPlain(ctx, part.formula, typeOf(part), action.name));
      if (spared)
        ctx.warnings.push(`${action.name}: ${target.name} is a ${capitalised(creatureType)} and takes no damage.`);
      openRiderSave(ctx, target, action, {
        name: action.name,
        ability: action.save.ability,
        dc: action.save.dc,
        failureConditions: action.save.failureConditions,
        ...(action.save.failureDuration ? { failureDuration: action.save.failureDuration } : {}),
        ...(action.save.repeatSave ? { repeatSave: true as const } : {}),
        ...(action.save.endsOnDamage ? { endsOnDamage: true as const } : {}),
        ...(action.save.failureEffect ? { failureEffect: action.save.failureEffect } : {}),
        ...(action.save.successEffect ? { successEffect: action.save.successEffect } : {}),
        ...(action.save.failurePush ? { failurePush: action.save.failurePush } : {}),
        failureDamage
      });
    } else if (!spared) for (const part of parts) roll(part.formula, typeOf(part), action.name);
    if (rider.versus && creatureType !== undefined && rider.versus.creatureTypes.includes(creatureType))
      roll(rider.versus.formula, cast.damage[0]?.type ?? "radiant", `${action.name} (${capitalised(creatureType)})`);
    if (rider.applies) applyHitOutcome(ctx, target, action, rider.applies, "applies");
    if (rider.marks) markOn(ctx, target, action, rider.marks, slotLevel);
    if (rider.lingers) lingerOn(ctx, target, action, cast, rider.lingers);
    if (action.spellId === "divine-smite") smiteOfProtection(ctx);
    for (const effect of effects) applyEffect(ctx, target, action, rider, effect);
    if (rider.reminder) ctx.warnings.push(rider.reminder);
    ctx.hitRiders.push({
      action,
      ...(slotLevel !== undefined ? { slotLevel } : {}),
      ...(pactSlot !== null ? { pactSlot } : {})
    });
  }
}

/** The rider's own economy at this hit, refused under the table's rules mode like any action's. */
function riderEconomy(
  ctx: ResolveContext,
  action: DefinitionAction,
  slotLevel: number | undefined,
  warnings: string[]
) {
  return planEconomy(
    ctx.state,
    ctx.attacker,
    action,
    {
      actorId: ctx.attacker.id,
      targetIds: [],
      commandId: ctx.input.commandId,
      ...(ctx.input.override ? { override: ctx.input.override } : {}),
      ...(slotLevel !== undefined ? { slotLevel } : {})
    },
    ctx.deps.definition,
    warnings,
    undefined,
    ctx.siblings,
    true
  );
}

/** A monster's charge: its dice join the hit's, and what it imposes lands. */
function rollCharge(ctx: ResolveContext, roll: (formula: string, type: string, source: string) => void): void {
  const target = ctx.targets[0];
  const charge = chargeOf(ctx);
  if (!charge) {
    refuse(ctx, `${ctx.action.name} has no charge against ${target.name}.`);
    return;
  }
  for (const part of charge.damage) roll(part.formula, part.type, "Charge");
  for (const conditionId of charge.conditions ?? []) {
    if (applyCondition(target, conditionId, { immunities: ctx.deps }) === "applied")
      ctx.effectsApplied.push({
        targetId: target.id,
        targetName: target.name,
        name: "Charge",
        conditionIds: [conditionId]
      });
  }
}

/** One picked effect: its save at the rider's DC, its effect, its push, the move it gives, the Invisible it keeps. */
function applyEffect(
  ctx: ResolveContext,
  target: ResolveContext["targets"][number],
  action: DefinitionAction,
  rider: HitRider,
  effect: HitRiderEffect
): void {
  const name = `${action.name}: ${effect.name}`;
  if (effect.save) {
    const dc = rider.saveDc ?? action.save?.dc;
    if (dc === undefined) ctx.warnings.push(`${name}: no save DC is recorded, so the GM sets it.`);
    else
      openRiderSave(ctx, target, action, {
        name,
        ability: effect.save.ability,
        dc,
        failureConditions: effect.save.failureConditions,
        ...(effect.save.failureDuration ? { failureDuration: effect.save.failureDuration } : {}),
        ...(effect.save.repeatSave ? { repeatSave: true as const } : {}),
        ...(effect.save.endsOnDamage ? { endsOnDamage: true as const } : {}),
        ...(effect.save.failureEffect ? { failureEffect: effect.save.failureEffect } : {}),
        ...(effect.save.failurePush ? { failurePush: effect.save.failurePush } : {})
      });
  }
  if (effect.applies) applyHitOutcome(ctx, target, action, effect.applies, effect.id);
  if (effect.push && (effect.push.maxTargetSize === undefined || sizeAtMost(target.size, effect.push.maxTargetSize)))
    forceMove(ctx, target, name, effect.push);
  if (effect.grantsHalfSpeedMove) grantHalfSpeedMove(ctx, name);
  if (effect.keepsHidden) ctx.keepsHidden = true;
  if (effect.spendsHitPointDie) spendHitPointDie(ctx, name);
}

/** A lasting effect on the target held by the attacker's Concentration (Shining Smite): the next attack roll against
 *  it has Advantage while it lasts. */
function markOn(
  ctx: ResolveContext,
  target: ResolveContext["targets"][number],
  action: DefinitionAction,
  marks: NonNullable<HitRider["marks"]>,
  slotLevel: number | undefined
): void {
  // A Concentration smite starts the caster's Concentration as any cast does, and its mark is held by it.
  const spell = action.spellId ? ctx.deps.catalog?.spellRecord?.(action.spellId) : undefined;
  const castId = spell?.concentration ? `${ctx.input.commandId}:${action.id}` : undefined;
  if (spell && castId) beginConcentration(ctx, spell, castId, slotLevel ?? spell.level);
  const ended: EffectNarration[] = [];
  const effect = addEffect(
    ctx.state,
    target.id,
    makeEffect({
      id: `${ctx.input.commandId}:${action.id}:${target.id}`,
      name: marks.name,
      tags: [marks.tag],
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      sourceActionId: action.id,
      startedRound: ctx.state.combat.round,
      duration: { type: "rounds", remaining: marks.rounds },
      concentration: true,
      ...(castId !== undefined ? { castId } : {}),
      modifiers: [{ type: "roll-mode", roll: "incoming-attack", mode: "advantage" }]
    }),
    ended,
    ctx.deps
  );
  for (const event of ended) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds: [] });
}

/** SRD Smite of Protection: "Whenever you cast Divine Smite, you and your allies have Half Cover while in your Aura of
 *  Protection. The aura has this benefit until the start of your next turn." */
function smiteOfProtection(ctx: ResolveContext): void {
  if (!holdsFeature(ctx.deps.definition, "smite-of-protection", "Smite of Protection")) return;
  addEffect(
    ctx.state,
    ctx.attacker.id,
    makeEffect({
      id: `${ctx.input.commandId}:smite-of-protection`,
      name: "Smite of Protection",
      tags: [SMITE_OF_PROTECTION_TAG],
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      sourceActionId: "smite-of-protection",
      startedRound: ctx.state.combat.round,
      duration: { type: "until-source-next-turn" }
    })
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${ctx.attacker.name}'s Smite of Protection gives Half Cover to the creatures in its aura until its next turn.`,
    actorIds: [ctx.attacker.id]
  });
}

/** SRD Searing Smite: "At the start of each of its turns until the spell ends, the target takes 1d6 Fire damage and then
 *  makes a Constitution saving throw", at the slot's dice ("All the damage increases"). Only typed dice can recur. */
function lingerOn(
  ctx: ResolveContext,
  target: ResolveContext["targets"][number],
  action: DefinitionAction,
  cast: DefinitionAction,
  lingers: NonNullable<HitRider["lingers"]>
): void {
  const damage = cast.damage.flatMap((part) => {
    const formula = DiceFormulaSchema.safeParse(part.formula);
    const type = DamageTypeSchema.safeParse(part.type);
    return formula.success && type.success ? [{ formula: formula.data, type: type.data }] : [];
  });
  // The spell asks for no save when it is cast, so its action carries none: the save is the spell's own, at the
  // caster's spell save DC.
  const spell = action.spellId ? ctx.deps.catalog?.spellRecord?.(action.spellId) : undefined;
  const ability = action.save?.ability ?? spell?.save?.ability;
  const dc = action.save?.dc ?? ctx.deps.definition?.spellcasting?.saveDc;
  if (damage.length === 0 || ability === undefined || dc === undefined) return;
  const effect = addEffect(
    ctx.state,
    target.id,
    makeEffect({
      id: `${ctx.input.commandId}:${action.id}:${target.id}`,
      name: lingers.name,
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      sourceActionId: action.id,
      startedRound: ctx.state.combat.round,
      duration: { type: "rounds", remaining: lingers.rounds },
      ongoingDamage: {
        damage: damage.slice(0, 2),
        at: "bearer-turn-start",
        saveToEnd: { ability, dc }
      }
    }),
    undefined,
    ctx.deps
  );
  ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds: [] });
}

/** Spends what each chosen extra costs (its uses, its slot, its Bonus Action), once the hit's own economy is in. A
 *  declared rider was paid for when it was tapped. */
export function spendHitOptions(ctx: ResolveContext): void {
  for (const { action, slotLevel, pactSlot } of ctx.hitRiders) {
    if (pactSlot !== undefined) spendSlot(ctx.attacker, { level: pactSlot, pact: true });
    if (hitRiderOf(action)?.declaredBeforeRoll) continue;
    const economy = riderEconomy(ctx, action, slotLevel, ctx.warnings);
    commitEconomy({
      state: ctx.state,
      attacker: ctx.attacker,
      input: { ...(ctx.input.override ? { override: ctx.input.override } : {}) },
      plan: economy.plan,
      overridden: economy.overridden
    });
  }
}
