import type { HitOffer } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { DamageTypeSchema, DiceFormulaSchema } from "@vtt/schemas";
import { isIncapacitated } from "../condition-rules.js";
import { areAllies } from "../creature-sides.js";
import { addEffect, applyCondition, makeEffect, type EffectNarration } from "../effects.js";
import { RulesBlockedError } from "../game-store.js";
import { upcastAction } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { effectiveModeFor, overrideCovers, overrideWaives } from "../rules-families.js";
import { recordRoll, sizeAtMost, tableLineOf, type DefinitionAction, type ResolveContext } from "./context.js";
import { beginConcentration } from "./concentration.js";
import { criticalExpression } from "./damage.js";
import { commitEconomy, evaluateActionEconomy, planEconomy } from "./economy.js";
import { hitRiderOf, type HitRider } from "./hit-riders.js";

/**
 * Extras a hit can carry, which the attacker chooses on the attack's preview and spends with the hit (SRD Sneak
 * Attack, the smites, Divine Strike, Primal Strike, a monster's charge). Their dice join the hit's damage, so a
 * crit doubles them ("If the attack involves other damage dice, such as from the Rogue's Sneak Attack feature, you
 * also roll those dice twice") and the target's defences meet them as part of the one hit. On a miss nothing is
 * spent.
 */

const landed = (ctx: ResolveContext) =>
  ctx.attack !== null &&
  (ctx.attack.outcome === "hit" || ctx.attack.outcome === "crit" || ctx.attack.outcome === "unknown");

/** Whether this hit can carry the rider: true, false, or what the engine couldn't check for the attacker to vouch for. */
function qualifies(ctx: ResolveContext, rider: HitRider): true | false | string {
  const kinds = ctx.riderFilters.attackKinds ?? [];
  const attack = ctx.action.attack!;
  const weapon = kinds.includes("weapon");
  if (rider.rides === "weapon" && !weapon) return false;
  if (
    rider.rides === "melee-weapon-or-unarmed" &&
    !kinds.includes("unarmed") &&
    !(weapon && attack.reachFeet !== undefined)
  )
    return false;
  if (rider.rides === "finesse-or-ranged-weapon") {
    const finesse = (ctx.riderFilters.weaponProperties ?? []).includes("finesse");
    const rangedWeapon = attack.reachFeet === undefined && attack.rangeFeet !== undefined;
    if (!weapon || (!finesse && !rangedWeapon)) return false;
  }
  if (rider.ownTurn && ctx.state.combat.turnActorId !== ctx.attacker.id) return false;
  return rider.sneakAttack ? sneakAttackQualifies(ctx) : true;
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

const capitalised = (type: string) => (type.length > 0 ? `${type[0].toUpperCase()}${type.slice(1)}` : type);

/** What choosing it spends, in the card's words. */
function costOf(action: DefinitionAction, slotLevel: number | undefined): string | null {
  const costs = [
    ...(action.spellSlot && slotLevel !== undefined ? [`a level ${slotLevel} spell slot`] : []),
    ...(action.uses ? [action.uses.per === "turn" ? "once per turn" : `a use of ${action.name}`] : []),
    ...(action.activation === "bonus-action" ? ["your Bonus Action"] : [])
  ];
  return costs.length > 0 ? costs.join(" and ") : null;
}

/** Whether the rider's own economy allows it now: its uses, its slot, and a Bonus Action the hit didn't take. */
function affordable(ctx: ResolveContext, action: DefinitionAction): boolean {
  if (action.activation === "bonus-action" && ctx.plan.markBonus) return false;
  const slots = openSlots(ctx, action);
  if (action.spellSlot && slots.length === 0) return false;
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
      unverified: `Only if ${ctx.attacker.name} moved ${charge.feet ?? 20}+ feet straight toward the target just before the hit.`
    });
  for (const action of ctx.siblings) {
    const rider = hitRiderOf(action);
    if (!rider || action.id === ctx.action.id) continue;
    const verdict = qualifies(ctx, rider);
    if (verdict === false || !affordable(ctx, action)) continue;
    const slotLevels = openSlots(ctx, action);
    const dice = riderAction(ctx, action, slotLevels[0]).damage.map((part) => part.formula);
    if (dice.length === 0) continue;
    const types = rider.damageTypes ?? (rider.weaponType ? [ctx.action.damage[0]?.type ?? "untyped"] : null);
    offers.push({
      id: action.id,
      name: action.name,
      dice: `${dice.join(" + ")} ${types ? types.map(capitalised).join(" or ") : capitalised(action.damage[0]?.type ?? "")}`.trim(),
      cost: costOf(action, slotLevels[0]),
      ...(rider.damageTypes ? { damageTypes: rider.damageTypes } : {}),
      ...(slotLevels.length > 0 ? { slotLevels } : {}),
      ...(typeof verdict === "string" ? { unverified: verdict } : {})
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

/** Rolls the chosen extras into the hit's damage. Their costs are spent after the hit's own (`spendHitOptions`). */
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
  for (const choice of chosen) {
    if (choice.id === "charge") {
      const charge = chargeOf(ctx);
      if (!charge) {
        refuse(ctx, `${ctx.action.name} has no charge against ${target.name}.`);
        continue;
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
      continue;
    }
    const action = ctx.siblings.find((candidate) => candidate.id === choice.id);
    const rider = action ? hitRiderOf(action) : undefined;
    if (!action || !rider) {
      refuse(ctx, `${ctx.attacker.name} has no ${choice.id} to add to this hit.`);
      continue;
    }
    const verdict = qualifies(ctx, rider);
    if (verdict === false)
      refuse(
        ctx,
        rider.sneakAttack
          ? `Sneak Attack needs a Finesse or Ranged weapon and Advantage, or an ally within 5 feet of ${target.name} and no Disadvantage.`
          : `${action.name} can't ride this attack.`
      );
    else if (typeof verdict === "string") ctx.warnings.push(`${action.name}: ${verdict} The attacker confirmed it.`);
    const slotLevel = action.spellSlot ? (choice.slotLevel ?? openSlots(ctx, action)[0]) : undefined;
    const cast = riderAction(ctx, action, slotLevel);
    const pick = choice.damageType && rider.damageTypes?.includes(choice.damageType) ? choice.damageType : undefined;
    for (const part of cast.damage) {
      const type = rider.weaponType
        ? (ctx.action.damage[0]?.type ?? part.type)
        : (pick ?? rider.damageTypes?.[0] ?? part.type);
      roll(part.formula, type, action.name);
    }
    const creatureType = ctx.riderFilters.targetCreatureType;
    if (rider.versus && creatureType !== undefined && rider.versus.creatureTypes.includes(creatureType))
      roll(rider.versus.formula, cast.damage[0]?.type ?? "radiant", `${action.name} (${capitalised(creatureType)})`);
    if (rider.marks) {
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
          name: rider.marks.name,
          tags: [rider.marks.tag],
          sourceActorId: ctx.attacker.id,
          sourceName: ctx.attacker.name,
          sourceActionId: action.id,
          startedRound: ctx.state.combat.round,
          duration: { type: "rounds", remaining: rider.marks.rounds },
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
    if (rider.lingers) lingerOn(ctx, target, action, cast, rider.lingers);
    if (rider.reminder) ctx.warnings.push(rider.reminder);
    ctx.hitRiders.push({ action, ...(slotLevel !== undefined ? { slotLevel } : {}) });
  }
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

/** Spends what each chosen extra costs (its uses, its slot, its Bonus Action), once the hit's own economy is in. */
export function spendHitOptions(ctx: ResolveContext): void {
  for (const { action, slotLevel } of ctx.hitRiders) {
    const economy = planEconomy(
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
      ctx.warnings,
      undefined,
      ctx.siblings,
      true
    );
    commitEconomy({
      state: ctx.state,
      attacker: ctx.attacker,
      input: { ...(ctx.input.override ? { override: ctx.input.override } : {}) },
      plan: economy.plan,
      overridden: economy.overridden
    });
  }
}
