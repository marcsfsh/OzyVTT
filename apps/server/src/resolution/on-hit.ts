import { immuneToActionOf } from "../save-immunity.js";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import {
  addEffect,
  effectDurationOf,
  endEffect,
  makeEffect,
  SMOTHERING_TAG,
  type EffectNarration
} from "../effects.js";
import { startHoldingBreath } from "../breath.js";
import { previewDamage } from "../hit-points.js";
import { masteryHitEffects } from "../weapon-mastery.js";
import { endedEffect, sizeAtMost, tableLineOf, type DefinitionAction, type ResolveContext } from "./context.js";
import { damagePartsOf } from "./damage.js";
import { failureEffectFor, spellCastOf } from "./pending.js";
import { shotFrom } from "../ammunition.js";
import { createPendingSaves } from "../pending-saves.js";
import { forceMove, openRiderSave, rollPlain } from "./hit-rider-outcomes.js";
import { effectNameOf } from "../effect-names.js";
import { applyKillingHit } from "./kill.js";
import { lowerScore } from "./score-drain.js";
import { penalizeRow, wornNonmagicalArmor } from "../row-penalties.js";
import { HAZARDS } from "../hazards.js";

/** Whether this hit deals its target any damage after the target's defences: what Slow and Vex need. */
export function dealsDamage(ctx: ResolveContext): boolean {
  const { state, targets, deps } = ctx;
  const target = targets[0];
  if (!target) return false;
  const parts = damagePartsOf(ctx);
  if (parts.length === 0) return false;
  const damageDeps = deps.resolveDefinition
    ? { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
    : undefined;
  return previewDamage(state, target.id, { amount: 0, parts }, damageDeps).totalApplied > 0;
}

/** What a landed hit puts on its target: the action's declared on-hit riders and the weapon mastery's
 *  effects (Sap, Slow, Vex). */
export function applyOnHitEffects(ctx: ResolveContext): void {
  applyDeclaredRiders(ctx);
  exposeToPoisonCoat(ctx);
  // `addEffect` is idempotent by id, so its return is what gets narrated.
  for (const applied of masteryHitEffects(ctx.masterySwing, ctx.masterySwing ? dealsDamage(ctx) : true)) {
    const effect = addEffect(ctx.state, applied.targetId, makeEffect(applied.effect), undefined, ctx.deps);
    ctx.effectsApplied.push({
      targetId: applied.targetId,
      targetName: applied.targetName,
      name: effect.name,
      conditionIds: effect.linkedConditionIds
    });
  }
}

/** The tag every injury poison's coat carries; `coat-<poison id>` names the poison. */
export const POISON_COAT_TAG = "poison-coat";
const COAT_PREFIX = "coat-";

/**
 * SRD 5.2.1 Gameplay Toolbox, Injury poison: "The poison remains potent until delivered through a wound or washed off. A
 * creature that takes Piercing or Slashing damage from an object coated with the poison is exposed to its effects." A
 * hit with the weapon, or a shot drawing from the ammunition, that the attacker's coat is bound to, dealing Piercing or
 * Slashing damage the target takes, spends the coat and opens the poison's save on the target, its damage rolled now.
 */
function exposeToPoisonCoat(ctx: ResolveContext): void {
  const { state, attacker, attack, targets, deps, riderItemId } = ctx;
  if (attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit")) return;
  const target = targets[0];
  if (!target || riderItemId === null) return;
  const ammoRowId = shotFrom(attacker, riderItemId, deps.catalog)?.ammo?.row.id;
  const coat = attacker.effects.find(
    (effect) =>
      effect.tags.includes(POISON_COAT_TAG) &&
      effect.itemId !== undefined &&
      (effect.itemId === riderItemId || effect.itemId === ammoRowId)
  );
  if (!coat) return;
  const piercing = damagePartsOf(ctx).some((part) => part.type === "piercing" || part.type === "slashing");
  if (!piercing || !dealsDamage(ctx)) return;
  const poisonId = coat.tags.find((tag) => tag.startsWith(COAT_PREFIX))?.slice(COAT_PREFIX.length);
  const poison = poisonId ? deps.catalog?.equipmentRecord(poisonId) : undefined;
  if (!poison?.poison?.save) return;
  for (const event of endEffect(state, attacker.id, coat.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.effectsEnded.push(endedEffect(attacker, coat));
  const action = {
    id: `poison-${poison.id}`,
    name: poison.name,
    activation: "other" as const,
    description: poison.name,
    damage: structuredClone(poison.poison.damage),
    save: structuredClone(poison.poison.save)
  };
  const parts = action.damage.map((part) => rollPlain(ctx, part.formula, part.type, poison.name));
  const onFail = failureEffectFor(
    { action, attacker, riderItemId: null, deps: { catalog: deps.catalog }, castId: null },
    action.save.failureConditions
  );
  createPendingSaves(state, {
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    actionName: poison.name,
    ability: action.save.ability,
    dc: action.save.dc,
    targetIds: [target.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: action.save.successDamage === "half",
    conditionIds: [...action.save.failureConditions],
    ...(onFail ? { onFailEffect: onFail } : {}),
    ...(action.save.failureByMargin
      ? { extra: { failureByMargin: structuredClone(action.save.failureByMargin) } }
      : {}),
    replaceExisting: false,
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      text: `The ${poison.name} on the wound: ${target.name} makes a DC ${action.save.dc} ${action.save.ability.toUpperCase()} save.`,
      actorId: target.id,
      source: { actorId: attacker.id, name: attacker.name }
    })
  );
}

/** Declared on-hit riders apply as one source-linked effect each (ADR-0020 condition carve-out); a rider
 *  with a size limit skips a target that is too large. A grapple's effect carries its escape DC and range and ends
 *  with its grappler; a timed rider its printed duration. Prone and Exhaustion stand alone: Prone ends by standing
 *  up, and Exhaustion adds a level each time it lands. A rider can also pull the target, open a save whose failure
 *  leaves the effect (Giant Slayer, a Sword of Wounding), fire only on a rolled 20 or against some creature types, and
 *  spend a coat the bearer put on the weapon (a Dagger of Venom). */
function applyDeclaredRiders(ctx: ResolveContext): void {
  const { state, action, attacker, attack, targets, input, deps, warnings } = ctx;
  if (!action.onHit || attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit")) return;
  const target = targets[0];
  const immunities = {
    ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  const cast = spellCastOf(ctx);
  action.onHit.forEach((rider, index) => {
    // "When you roll a 20": the die itself, so a wider crit range doesn't fire it.
    if (rider.naturalTwenty && attack.naturalRoll !== 20) return;
    const creatureType = ctx.riderFilters.targetCreatureType;
    if (rider.creatureTypes && (creatureType === undefined || !rider.creatureTypes.includes(creatureType))) return;
    if (rider.maxTargetSize && !sizeAtMost(target.size, rider.maxTargetSize)) {
      warnings.push(
        `${target.name} is too large for ${action.name}'s ${rider.name ?? rider.conditions.map((condition) => conditionLabel(condition.id)).join("/")} rider.`
      );
      return;
    }
    if (rider.spendsEffectTag && !spendCoat(ctx, rider.spendsEffectTag)) return;
    if (rider.reminder) warnings.push(`${action.name}: ${rider.reminder}`);
    // A hit that can kill outright (Nine Lives Stealer, a Vorpal Sword) is its own outcome.
    if (rider.kills) {
      applyKillingHit(ctx, rider, index);
      return;
    }
    // A score the hit lowers (a shadow's Strength), which kills at 0.
    if (rider.lowersScore) lowerScore(ctx, rider, index);
    // Acid that eats the nonmagical armor the target wears (a black pudding's Pseudopod).
    const armor = rider.armorPenalty ? wornNonmagicalArmor(target, deps.catalog) : null;
    if (armor && deps.resolveDefinition)
      for (const event of penalizeRow(state, target.id, armor.id, {
        resolveDefinition: deps.resolveDefinition,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }))
        ctx.tableNarration.push(tableLineOf(ctx, event));
    if (rider.pull) forceMove(ctx, target, action.name, rider.pull, true);
    if (rider.hazard === "burning") setBurning(ctx, index);
    if (rider.save) {
      openOnHitSave(ctx, rider, index);
      return;
    }
    const bare = rider.conditions.filter((condition) => condition.id === "prone" || condition.id === "exhaustion");
    for (const condition of bare) {
      const events = setCondition(state, target.id, condition.id, true, undefined, { role: "gm" }, immunities);
      // A rider's Exhaustion levels each add one (SRD: cumulative).
      for (let extra = 1; condition.id === "exhaustion" && extra < (condition.level ?? 1); extra += 1)
        events.push(...setCondition(state, target.id, "exhaustion", true, undefined, { role: "gm" }, immunities));
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
      if (!events.some((event) => event.immune))
        ctx.effectsApplied.push({
          targetId: target.id,
          targetName: target.name,
          name: conditionLabel(condition.id),
          conditionIds: [condition.id]
        });
    }
    // "If the target is Medium or smaller and the darkmantle had Advantage on the attack roll, it covers the target":
    // the effect carries more when the roll had Advantage.
    const adds =
      rider.advantageAdds &&
      ctx.rollMode?.mode === "advantage" &&
      (rider.advantageAdds.maxTargetSize === undefined || sizeAtMost(target.size, rider.advantageAdds.maxTargetSize))
        ? rider.advantageAdds
        : undefined;
    const conditionIds = [...rider.conditions.map((condition) => condition.id), ...(adds?.conditions ?? [])].filter(
      (id) => id !== "prone" && id !== "exhaustion"
    );
    const tags = [...(rider.tags ?? []), ...(adds?.tags ?? [])];
    const modifiers = rider.modifiers ?? [];
    if (conditionIds.length === 0 && !rider.ongoingDamage && tags.length === 0 && modifiers.length === 0) return;
    // "The rug can give it the Grappled condition ... instead of dealing damage": the hit's damage goes.
    if (rider.insteadOfDamage) {
      ctx.damage.splice(0);
      ctx.bonusDamage.splice(0);
      warnings.push(`${action.name}: ${target.name} is held, and the hit deals no damage.`);
    }
    const grapple = conditionIds.includes("grappled");
    const gained: EffectNarration[] = [];
    const label = rider.name ?? (conditionIds[0] ? conditionLabel(conditionIds[0]) : action.name);
    // A rider on the attacker itself lasts to the end of this turn when it says the source's turn end.
    const bearer = rider.self ? attacker : target;
    const duration =
      rider.self && rider.duration?.type === "until-source-turn-end"
        ? { type: "until-source-turn-end" as const, skipsCurrentTurn: false }
        : effectDurationOf(state, rider.duration, bearer.id, attacker.id);
    const effect = addEffect(
      state,
      bearer.id,
      makeEffect({
        id: `${input.commandId}:hit:${bearer.id}:${index}`,
        name: rider.self
          ? `${label} (${effectNameOf(action.name)})`
          : `${label} by ${attacker.name} (${effectNameOf(action.name)})`,
        tags: [...(grapple ? ["grapple"] : []), ...tags],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        sourceActionId: `${action.id}:${index}`,
        startedRound: state.combat.round,
        duration,
        // "Cursed for 24 hours or until the incubus dies".
        endsWhenSourceDefeated: grapple || rider.endsWhenSourceDies === true,
        linkedConditionIds: conditionIds,
        modifiers: [...modifiers],
        escapeDc: rider.escapeDc ?? null,
        ...(grapple ? { rangeFeet: action.attack?.reachFeet ?? 5 } : {}),
        // A stirge attached, a rug smothering: what it deals each turn while it holds on, and it lets go as it dies.
        ...(rider.ongoingDamage ? { ongoingDamage: rider.ongoingDamage, endsWhenSourceDefeated: true } : {}),
        // A spell's hit (Ray of Sickness): the spell and its level, which Dispel Magic weighs.
        ...(cast ? { spell: { id: cast.spell.id, level: cast.level } } : {}),
        // The action that ends it ("The target or a creature within 5 feet of it can detach the stirge").
        ...(rider.endedBy ? { endedBy: structuredClone(rider.endedBy) } : {}),
        // What it does as its bearer rests or days pass (a mummy's curse).
        ...(rider.atRest ? { atRest: structuredClone(rider.atRest) } : {})
      }),
      gained,
      deps
    );
    // "Is suffocating" while the hold lasts (a rug smothering, a darkmantle covering): it holds its breath.
    if (tags.includes(SMOTHERING_TAG)) {
      const definition = bearer.definitionId ? deps.resolveDefinition?.(bearer.definitionId) : undefined;
      gained.push(...startHoldingBreath(state, bearer, definition));
    }
    for (const event of gained) ctx.tableNarration.push(tableLineOf(ctx, event));
    ctx.effectsApplied.push({ targetId: bearer.id, targetName: bearer.name, name: effect.name, conditionIds });
  });
}

/** A hit that sets its target burning (SRD Burning): the fire burns on whatever becomes of its source, and a creature
 *  already burning burns once. */
function setBurning(ctx: ResolveContext, index: number): void {
  const { state, action, attacker, targets, input, deps } = ctx;
  const target = targets[0];
  const burning = HAZARDS.burning;
  if (target.effects.some((effect) => effect.tags.includes(burning.tag))) return;
  const gained: EffectNarration[] = [];
  const effect = addEffect(
    state,
    target.id,
    makeEffect({
      id: `${input.commandId}:burn:${target.id}:${index}`,
      name: burning.name,
      tags: [burning.tag],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: `${action.id}:${index}`,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      linkedConditionIds: [],
      modifiers: [],
      ...(burning.ongoingDamage ? { ongoingDamage: burning.ongoingDamage } : {})
    }),
    gained,
    deps
  );
  for (const event of gained) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds: [] });
}

/** Ends the coat on the attacker that this hit spends (a Dagger of Venom's poison). False when none is on. */
function spendCoat(ctx: ResolveContext, tag: string): boolean {
  const coat = ctx.attacker.effects.find((effect) => effect.tags.includes(tag));
  if (!coat) return false;
  for (const event of endEffect(ctx.state, ctx.attacker.id, coat.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.effectsEnded.push(endedEffect(ctx.attacker, coat));
  return true;
}

/** The save an on-hit rider opens on the target at its printed DC: a failure takes the rider's damage, rolled now,
 *  and its conditions, tags and modifiers as one effect. */
function openOnHitSave(
  ctx: ResolveContext,
  rider: NonNullable<DefinitionAction["onHit"]>[number],
  index: number
): void {
  const { action, targets } = ctx;
  const save = rider.save!;
  const name = rider.name ? `${action.name}: ${rider.name}` : action.name;
  // "Success: The target is immune to this werewolf's curse for 24 hours."
  if (save.immuneOnSuccess && targets[0] && immuneToActionOf(targets[0], ctx.attacker.id, name)) {
    ctx.warnings.push(`${targets[0].name} is immune to ${ctx.attacker.name}'s ${rider.name ?? action.name}, so it makes no save.`);
    return;
  }
  const failureDamage = (save.failureDamage ?? []).map((part) => rollPlain(ctx, part.formula, part.type, action.name));
  const tags = rider.tags ?? [];
  const modifiers = rider.modifiers ?? [];
  openRiderSave(
    ctx,
    targets[0],
    { ...action, id: `${action.id}:${index}` },
    {
      name,
      ability: save.ability,
      dc: save.dc,
      failureConditions: rider.conditions.map((condition) => condition.id),
      ...(rider.duration ? { failureDuration: rider.duration } : {}),
      ...(save.repeatSave ? { repeatSave: true as const } : {}),
      ...(save.endsOnDamage ? { endsOnDamage: true as const } : {}),
      ...(tags.length > 0 || modifiers.length > 0
        ? { failureEffect: { name: rider.name ?? action.name, tags: [...tags], modifiers: [...modifiers] } }
        : {}),
      ...(failureDamage.length > 0 ? { failureDamage } : {}),
      ...(save.halfOnSuccess ? { halfOnSuccess: true as const } : {}),
      ...(save.immuneOnSuccess ? { immuneOnSuccess: true as const } : {}),
      ...(save.immuneMinutes !== undefined ? { immuneMinutes: save.immuneMinutes } : {})
    }
  );
}
