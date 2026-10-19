import { rollDice } from "@vtt/rules-5e";
import {
  actionChoicesOf,
  owedDamageParts,
  owedDamageTotal,
  summonChoicesOf,
  type ActionAvailability,
  type ActionResolution,
  type GameState
} from "@vtt/domain";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition, SaveCondition } from "@vtt/schemas";
import { conditionChoicesOf } from "./item-actions.js";
import { BUILTIN_TARGETING } from "./builtin-actions.js";
import { builtinCheckSkills, helpToolsOf } from "./resolution/builtins.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { hitRiderOf } from "./resolution/hit-riders.js";
import { masteryMissDamage } from "./weapon-mastery.js";
import { spendAmmunition } from "./resolution/ammunition.js";
import { useUpConsumable } from "./resolution/consumables.js";
import { consumableRowFor } from "./consumables.js";
import {
  rollAttack,
  spendDistraction,
  spendForgoneDeclaration,
  spendSteadyAim,
  spendSundering,
  spendUntilAttacked,
  spendUntilItActs,
  spendUntilOwnAttack
} from "./resolution/attack.js";
import { rollLastCharge } from "./resolution/charges.js";
import { recallSpellSlot } from "./resolution/spell-recall.js";
import { rollForAnAnswer } from "./resolution/divinations.js";
import { prayerShortRest, refuseThePrayedFor } from "./resolution/prayer-of-healing.js";
import { strikeADuplicate } from "./resolution/mirror-image.js";
import { checkOverchannel, overchannelBacklash } from "./resolution/overchannel.js";
import type {
  DefinitionAction,
  EndedEffect,
  ResolveContext,
  ResolveDependencies,
  ResolveInput
} from "./resolution/context.js";
import { tableLineOf } from "./resolution/context.js";
import { breakEnclosure } from "./enclosures.js";
import { withoutSourceName } from "./hidden-source.js";
import { dartDamageTargetsOf, rollRiderDamage, rollWeaponDamage, spendDamageUses } from "./resolution/damage.js";
import { commitEconomy, evaluateActionEconomy, useLimitFor } from "./resolution/economy.js";
import { planThisTurn } from "./resolution/multiattack-after.js";
import { pullOnAction, swallowOnAction } from "./resolution/swallowing.js";
import { inflictOnTargets } from "./resolution/inflicts.js";
import { applyGrant } from "./resolution/grant.js";
import { spendStudy, studyAMiss } from "./resolution/studied.js";
import { applyShapeShift, checkShapeShift } from "./resolution/shape-shift.js";
import { formsOffer } from "./transform/offer.js";
import { applyMovementGrants } from "./resolution/movement-grants.js";
import { applyTimeStop } from "./time-stop.js";
import { applySpellEndings } from "./resolution/dispel.js";
import { applySummons } from "./resolution/summon.js";
import { readScroll } from "./resolution/scroll.js";
import { slowedSpellFails } from "./resolution/slowed.js";
import { applyConditionCures, applyHealing } from "./resolution/heal.js";
import { stabilizeOnCast } from "./resolution/stabilize.js";
import { raiseOnAction, reviveOnCast } from "./resolution/revival.js";
import { killOnCast } from "./resolution/kill.js";
import {
  recordAttackRoll,
  recordCleaveOpening,
  recordHordeOpening,
  recordLightAttack,
  recordLoadingShot
} from "./resolution/extra-attacks.js";
import { recordAttackDealings } from "./resolution/dealings.js";
import { vitalityOnHit, vitalityRecipient } from "./resolution/vitality.js";
import { applyAreaHeal, areaHealRecipient } from "./resolution/area-heal.js";
import {
  applyMasteryForces,
  checkTacticalMaster,
  masterySwingOf,
  offeredPush,
  spendSap,
  spendVex,
  tacticalMasterOffer
} from "./resolution/masteries.js";
import { hitOffersOf, rollHitOptions, spendHitOptions } from "./resolution/hit-options.js";
import { applyOnHitEffects } from "./resolution/on-hit.js";
import { endTargetMarks } from "./resolution/action-targets.js";
import { markMultiattackDefense, strikeBackFromEffects, strikeBackOnHit } from "./resolution/struck.js";
import {
  parkActionSave,
  parkBurstSave,
  parkForAcReaction,
  parkForRollAnswer,
  parkHeldObjectSave,
  parkReaction
} from "./resolution/pending.js";
import { parkForRedirect } from "./resolution/redirect.js";
import { afterDivineWish } from "./divine-intervention.js";
import {
  markCastTurn,
  markSpellUp,
  openActionZone,
  openSpellZone,
  startConcentration
} from "./resolution/concentration.js";
import { parkForCounterspell } from "./resolution/counter.js";
import { placeCastSight } from "./resolution/cast-sight.js";
import { applyCastWalls, checkWallTarget } from "./resolution/cast-walls.js";
import { applyRageRules } from "./resolution/rage.js";
import { releaseHideAndReady } from "./resolution/release.js";
import { openResolve } from "./resolution/validate.js";
import { holdReadiedSpell } from "./resolution/ready.js";
import { checkKnockOut, knockOutOffered, knocksOut } from "./resolution/knock-out.js";
import { healLimit } from "./loose-healing.js";
import { passiveOf, unavailableReason } from "./availability-reasons.js";
import { finishLongCast, longCastStepOf, stepLongCast } from "./resolution/long-casting.js";
import { layOutProvisions } from "./resolution/provisions.js";
import { turnedAwayByWard } from "./resolution/ward.js";
import { orbLeap } from "./resolution/orb-leap.js";
import {
  shapedAction,
  shapedOutcome,
  shapingInForce,
  shapingOf,
  shapingOffers,
  withShapedSpell
} from "./resolution/metamagic.js";
import {
  answerHeldDamage,
  damageLookOffered,
  rollsHealingDice,
  damageTape,
  heldDamageFor,
  heldDamageLook,
  holdDamage,
  releaseHeldDamage,
  type DamageTape
} from "./resolution/held-damage.js";
import { CommandRejectedError } from "./game-store.js";

export type { ResolveDependencies, ResolveInput };

/**
 * Resolves a definition action on the server (ADR-0020): validates economy and limited uses against
 * the rules mode, aggregates advantage, rolls attack and typed damage (2024 crit doubling), applies
 * on-hit riders and granted effects, records rolls and commits the economy. Damage is proposed; the
 * GM applies it with actor:apply-damage. Each step lives in `resolution/` and works on one shared
 * context; builtin actions add their special cases through `resolution/builtins.ts`.
 */
export function resolveDefinitionAction(
  state: GameState,
  declared: DefinitionAction,
  declaredInput: ResolveInput,
  declaredDeps: ResolveDependencies
): ActionResolution {
  const printed = declared.spellId ? declaredDeps.catalog?.spellRecord?.(declared.spellId) : undefined;
  // A spell of a minute or more cast in a fight takes the action on each of its caster's turns, and resolves on the
  // last with the targets, slot and shaping picked on the first.
  const longCast = longCastStepOf(state, declared, declaredInput, printed);
  // How its caster shapes the cast (Metamagic): every step reads the spell and the action as shaped.
  const stepped = longCast?.input ?? declaredInput;
  const { shaping: _sent, ...stepInput } = stepped;
  const shaping = shapingInForce(state, declared, stepped);
  // Overchannel rides the cast's shaping, beside Metamagic, as the sheet offers it.
  const input: ResolveInput =
    shaping.length > 0
      ? { ...stepInput, shaping, ...(shapingOf(shaping, "overchannel") ? { overchannel: true } : {}) }
      : stepInput;
  const shapedDeps = withShapedSpell(declaredDeps, declared.spellId, shaping);
  // The damage steps throw through a tape, so a look at the damage holds its dice and the confirm deals them.
  const tape = damageTape(shapedDeps.random);
  const ctx = openResolve(state, shapedAction(declared, shaping), input, { ...shapedDeps, random: tape.random });
  // Checked against the spell as printed, Transmuted Spell's type and Extended Spell's durations land on what it does.
  ctx.action = shapedOutcome(ctx.action, printed, shaping, ctx.plan.castLevel);
  const look = input.commit === false && input.damageLook === true;
  if (look && !ctx.action.damage.some((part) => /\d+d\d+/i.test(part.formula)) && !rollsHealingDice(ctx.action))
    throw new CommandRejectedError(`${ctx.action.name} rolls no damage dice to look at.`);
  if (input.damageAnswer && !look)
    throw new CommandRejectedError("Answer the damage on a look at it, before it is dealt.");
  checkOverchannel(ctx);
  checkTacticalMaster(ctx);
  // Who a cantrip's vitality goes to, and who an area's healing goes to, are checked before anything rolls.
  vitalityRecipient(ctx);
  areaHealRecipient(ctx);
  checkWallTarget(ctx);
  ctx.builtin?.check?.(ctx);
  // A form the action can't give is refused before anything is spent.
  checkShapeShift(ctx);
  // A look at the damage of an action with no attack roll throws its damage and nothing else.
  if (look && !ctx.action.attack) {
    // With no attack to roll it only sets the filters the damage riders read.
    rollAttack(ctx);
    return lookAtDamage(ctx, tape);
  }
  ctx.builtin?.apply?.(ctx);
  // A warded target (Sanctuary) asks its save as the attack or spell is made; a failure spends nothing and stops here.
  if (input.commit !== false && input.economyPaid !== true && turnedAwayByWard(ctx))
    return { ...resolutionOf(ctx), save: null };
  // A casting is seen as it begins: Counterspell may stop it on its first turn, its action spent and nothing else.
  if (longCast?.phase === "start" && input.longCastBegins !== true && parkForCounterspell(ctx, true)) {
    commitEconomy({ ...ctx, plan: { ...ctx.plan, spendSpellSlot: null, spendUse: null, componentSpends: [] } });
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
  }
  if (longCast && longCast.phase !== "finish") {
    stepLongCast(ctx, longCast);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  if (longCast) finishLongCast(ctx);
  // A readied spell is cast now and held: its slot and the action are spent, and nothing else happens yet. It is seen
  // as it is cast, so a Counterspell may stop it now.
  if (input.ready === true) {
    if (parkForCounterspell(ctx)) {
      commitEconomy({ ...ctx, plan: { ...ctx.plan, spendSpellSlot: null, spendUse: null, componentSpends: [] } });
      useUpConsumable(ctx);
      return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
    }
    holdReadiedSpell(ctx);
    commitEconomy(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  // The action's move taken before the rest of it: its cost is spent and the move granted, and the rest waits.
  if (input.moveFirst === true) {
    commitEconomy(ctx);
    applyMovementGrants(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  // A failed check to read a scroll spends the cast and the scroll, and nothing else happens.
  if (readScroll(ctx)) {
    commitEconomy(ctx);
    useUpConsumable(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  // Spread Caltrops or a set trap acts on whoever meets it later, so nothing is rolled now.
  if (openActionZone(ctx)) {
    commitEconomy(ctx);
    useUpConsumable(ctx);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  // A spell that Slow's chance makes fail spends its slot and its action, and nothing else happens.
  if (slowedSpellFails(ctx)) {
    commitEconomy(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  // A cast a Counterspell may stop waits before anything of it happens: its action is spent and it was seen cast, but
  // its slot, its limited use and the materials it consumes wait to see whether it goes ahead. A scroll read is used
  // up either way. A long casting was offered as it began.
  if (longCast?.phase !== "finish" && parkForCounterspell(ctx)) {
    commitEconomy({ ...ctx, plan: { ...ctx.plan, spendSpellSlot: null, spendUse: null, componentSpends: [] } });
    useUpConsumable(ctx);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
  }
  // An attack another creature may turn onto someone else before it rolls (Redirect Attack, Arrow-Catching Shield):
  // the attack is spent, and the answer rolls it at whichever creature it ends at.
  if (parkForRedirect(ctx)) {
    commitEconomy(ctx);
    recallSpellSlot(ctx);
    rollLastCharge(ctx);
    spendAmmunition(ctx);
    useUpConsumable(ctx);
    recordLightAttack(ctx);
    recordLoadingShot(ctx);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
  }
  // Disintegrate aimed at a creature in a sphere of force destroys the sphere and harms nothing inside.
  const shattered = input.commit === false ? null : breakEnclosure(state, ctx.action, ctx.targets, ctx.deps.catalog);
  if (shattered) {
    for (const event of shattered) ctx.tableNarration.push(tableLineOf(ctx, event));
    commitEconomy(ctx);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  rollAttack(ctx);
  checkKnockOut(ctx);
  // Preview: the d20 is rolled and shown, nothing else applies. The economy was validated already, so an
  // illegal attack is blocked before the preview roll.
  if (ctx.attack !== null && input.commit === false) return look ? lookAtDamage(ctx, tape) : previewOf(ctx);
  // The roll is made, so a Vex marker, a Sap or Guiding Bolt's light it read is spent; a finishing replay already
  // spent them, unless it was held before its roll.
  if (input.economyPaid !== true || input.redirectSettled === true) {
    spendVex(ctx);
    spendSap(ctx);
    spendDistraction(ctx);
    spendUntilAttacked(ctx);
    spendUntilOwnAttack(ctx);
    spendSteadyAim(ctx);
    spendForgoneDeclaration(ctx);
    // Studied Attacks: this roll spends the Fighter's mark on its target, and a miss leaves a new one.
    spendStudy(ctx);
    studyAMiss(ctx);
  }
  // A roll another creature may still answer (Cutting Words), or a hit the target's Parry or Shield may still turn into
  // a miss: the attack is spent, and the answer finishes it.
  if (parkForRollAnswer(ctx) || parkForAcReaction(ctx)) {
    commitEconomy(ctx);
    recallSpellSlot(ctx);
    rollLastCharge(ctx);
    spendAmmunition(ctx);
    useUpConsumable(ctx);
    recordLightAttack(ctx);
    recordLoadingShot(ctx);
    recordAttackRoll(ctx);
    recordAttackDealings(ctx);
    recordHordeOpening(ctx);
    releaseHideAndReady(ctx);
    spendUntilItActs(ctx);
    return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
  }

  // A duplicate of Mirror Image may take the settled hit.
  if (input.commit !== false) strikeADuplicate(ctx);
  spendSundering(ctx);
  // The dice a look held are dealt now, as they were looked at; without a look the server throws them.
  const heldLook = heldDamageFor(state, ctx.attacker.id, ctx.action.id);
  // The extras a hit carries throw their dice through the tape too, so a look at them deals what was looked at.
  rollDamage(ctx, tape, heldLook?.dice ?? [], () => rollHitOptions(ctx));
  releaseHeldDamage(state, ctx.attacker.id);
  // What the stat block leaves to the GM (damage on later turns) is said where the GM reads the result.
  if (ctx.action.reminder) ctx.warnings.push(ctx.action.reminder);

  applyOnHitEffects(ctx);
  strikeBackOnHit(ctx);
  strikeBackFromEffects(ctx);
  markMultiattackDefense(ctx);
  applyMasteryForces(ctx);
  startConcentration(ctx);
  markSpellUp(ctx);
  markCastTurn(ctx);
  openSpellZone(ctx);
  applyMovementGrants(ctx);
  applyTimeStop(ctx);
  applyGrant(ctx);
  swallowOnAction(ctx);
  pullOnAction(ctx);
  inflictOnTargets(ctx);
  applySummons(ctx);
  applyShapeShift(ctx);
  layOutProvisions(ctx);
  orbLeap(ctx);
  placeCastSight(ctx);
  applyCastWalls(ctx);
  refuseThePrayedFor(ctx);
  // A heal that was looked at restores the dice it showed.
  if (heldLook && rollsHealingDice(ctx.action)) {
    tape.start(heldLook.dice);
    applyHealing(ctx);
    tape.stop();
  } else applyHealing(ctx);
  applyAreaHeal(ctx);
  prayerShortRest(ctx);
  applyConditionCures(ctx);
  applySpellEndings(ctx);
  stabilizeOnCast(ctx);
  reviveOnCast(ctx);
  raiseOnAction(ctx);
  killOnCast(ctx);

  parkReaction(ctx);
  ctx.builtin?.forcedSave?.(ctx);
  parkActionSave(ctx);
  endTargetMarks(ctx);
  parkBurstSave(ctx);
  parkHeldObjectSave(ctx);
  applyRageRules(ctx);

  commitEconomy(ctx);
  vitalityOnHit(ctx);
  recallSpellSlot(ctx);
  afterDivineWish(ctx);
  rollForAnAnswer(ctx);
  overchannelBacklash(ctx);
  spendHitOptions(ctx);
  spendDamageUses(ctx);
  rollLastCharge(ctx);
  spendAmmunition(ctx);
  useUpConsumable(ctx);
  recordLightAttack(ctx);
  recordLoadingShot(ctx);
  recordAttackRoll(ctx);
  recordAttackDealings(ctx);
  recordCleaveOpening(ctx);
  recordHordeOpening(ctx);
  releaseHideAndReady(ctx);
  spendUntilItActs(ctx);
  return resolutionOf(ctx);
}

/** The damage steps: the action's own dice, Graze, the riders' dice and a builtin's. The tape gives back `held` first
 *  and notes which dice are the action's own. Returns the dice thrown. */
function rollDamage(
  ctx: ResolveContext,
  tape: DamageTape,
  held: Parameters<DamageTape["start"]>[0],
  extras: () => void = () => {}
): ReturnType<DamageTape["stop"]> {
  tape.start(held);
  tape.own(true);
  rollWeaponDamage(ctx);
  tape.own(false);
  ctx.masterySwing = masterySwingOf(ctx);
  // Graze fires on a miss, when no other damage rolled.
  ctx.bonusDamage.push(...masteryMissDamage(ctx.masterySwing));
  rollRiderDamage(ctx);
  ctx.builtin?.hitDamage?.(ctx);
  extras();
  return tape.stop();
}

/**
 * A look at the damage before it counts (`held-damage.ts`): an answer the look carries rerolls the held dice it picks
 * first; then the damage is thrown through the tape, the held dice coming back as they were, and held again. Nothing is
 * recorded, spent or applied: the confirm deals these dice.
 */
function lookAtDamage(ctx: ResolveContext, tape: DamageTape): ActionResolution {
  const { state, attacker, action, input } = ctx;
  let held = heldDamageFor(state, attacker.id, action.id);
  if (input.damageAnswer) {
    if (!held || held.dice.length === 0)
      throw new CommandRejectedError("Roll the damage first: an answer rerolls dice that were thrown.");
    held = answerHeldDamage(ctx, held, input.damageAnswer, tape.random);
  }
  ctx.silentRolls = true;
  const healing = rollsHealingDice(action) ? lookAtHealing(ctx, tape, held?.dice ?? []) : null;
  const dice = healing?.dice ?? rollDamage(ctx, tape, held?.dice ?? [], () => rollHitOptions(ctx, true));
  ctx.silentRolls = false;
  const kept = holdDamage(state, { actorId: attacker.id, actionId: action.id, dice, answers: held?.answers ?? [] });
  const { damage, bonusDamage } = ctx;
  return {
    ...previewOf(ctx),
    damage,
    damageTotal: owedDamageTotal({ damage, bonusDamage }),
    ...(bonusDamage.length > 0 ? { bonusDamage } : {}),
    heldDamage: heldDamageLook(ctx, kept, healing?.total)
  };
}

/** A heal's look: its dice thrown through the tape and held, nothing restored; the confirm restores them. */
function lookAtHealing(
  ctx: ResolveContext,
  tape: DamageTape,
  held: Parameters<DamageTape["start"]>[0]
): { dice: ReturnType<DamageTape["stop"]>; total: number } {
  tape.start(held);
  const total = rollDice(ctx.action.healing!.formula, tape.random).total;
  return { dice: tape.stop(), total };
}

/** The roll mode is reported only when some source shaped it. */
const rollModeOf = ({ rollMode }: ResolveContext) =>
  rollMode && (rollMode.advantage.length > 0 || rollMode.disadvantage.length > 0) ? { rollMode } : {};

function previewOf(ctx: ResolveContext): ActionResolution {
  return {
    actionName: ctx.action.name,
    activation: ctx.action.activation,
    attack: ctx.attack,
    save: null,
    damage: [],
    damageTotal: 0,
    crit: ctx.crit,
    ...rollModeOf(ctx),
    effectGranted: null,
    componentsRemaining: null,
    ...(ctx.warnings.length > 0 ? { warnings: ctx.warnings } : {}),
    overridden: ctx.overridden,
    push: offeredPush(ctx),
    ...withMasteryOptions(tacticalMasterOffer(ctx)),
    preview: true,
    ...withOffers(hitOffersOf(ctx)),
    // A hit's damage may be looked at before it counts, for an answer to it.
    ...(ctx.attack !== null &&
    ctx.attack.outcome !== "miss" &&
    ctx.attack.outcome !== "fumble" &&
    damageLookOffered(ctx.state, ctx.attacker, ctx.action, ctx.deps.definition, ctx.siblings)
      ? { damageLook: "offered" as const }
      : {}),
    ...(knockOutOffered(ctx) ? { knockOut: "offered" as const } : {})
  };
}

const withOffers = (offers: ReturnType<typeof hitOffersOf>) => (offers.length > 0 ? { hitOffers: offers } : {});
const withMasteryOptions = (options: ActionResolution["masteryOptions"] | undefined) =>
  options ? { masteryOptions: options } : {};

/** With no attack roll and no save, every target takes the damage, owed like a hit's: the GM's Apply, or a player's
 *  proposal or direct damage. A darts action owes each creature what its own darts dealt (SRD Magic Missile: "A dart
 *  deals 1d4 + 1 Force damage to its target"). */
function damageTargetsOf(ctx: ResolveContext): ActionResolution["damageTargets"] {
  if (ctx.attack !== null || ctx.action.save || ctx.builtinSave) return undefined;
  const darts = dartDamageTargetsOf(ctx);
  if (darts) return darts;
  const parts = owedDamageParts(ctx);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const struck = ctx.targets.filter((target) => !ctx.spared?.has(target.id));
  if (total <= 0 || struck.length === 0) return undefined;
  return struck.map((target) => ({ targetId: target.id, targetName: target.name, parts, total }));
}

/** An ended effect as the result tells it, to the initiator and in the table's toast: a source hidden from the
 *  initiator is masked in its name, as the projection masks it, and the source itself isn't told. */
function toldEnded(ctx: ResolveContext, { source, ...ended }: EndedEffect) {
  const masked = source?.actorId != null && ctx.hiddenFromInitiator(source.actorId);
  return masked ? { ...ended, name: withoutSourceName(ended.name, source.name) } : ended;
}

function resolutionOf(ctx: ResolveContext): ActionResolution {
  const { state, action, attacker, targets, damage, bonusDamage, warnings } = ctx;
  const instance = state.combat.turn.actionInstance;
  const damageTargets = damageTargetsOf(ctx);
  return {
    actionId: action.id,
    actionName: action.name,
    activation: action.activation,
    attack: ctx.attack,
    save: action.save
      ? {
          ability: action.save.ability,
          dc: action.save.dc,
          targets: targets.map((target) => ({ targetId: target.id, targetName: target.name }))
        }
      : ctx.builtinSave,
    damage,
    // What every apply path lands: a negative part deals 0 of its type and never eats into another's.
    damageTotal: owedDamageTotal({ damage, bonusDamage }),
    crit: ctx.crit,
    ...rollModeOf(ctx),
    ...(bonusDamage.length > 0 ? { bonusDamage } : {}),
    ...(ctx.effectsApplied.length > 0 ? { effectsApplied: ctx.effectsApplied } : {}),
    effectGranted: ctx.effectGranted,
    componentsRemaining:
      instance?.actorId === attacker.id && Object.values(instance.components).some((remaining) => remaining > 0)
        ? instance.components
        : null,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(ctx.tableNarration.length > 0 ? { tableNarration: ctx.tableNarration } : {}),
    overridden: ctx.overridden,
    ...(ctx.reactionPrompts.length > 0 ? { reactionPrompts: ctx.reactionPrompts } : {}),
    ...(ctx.check ? { check: ctx.check } : {}),
    ...(ctx.effectsEnded.length > 0 ? { effectsEnded: ctx.effectsEnded.map((ended) => toldEnded(ctx, ended)) } : {}),
    ...(ctx.healing ? { healing: ctx.healing } : {}),
    ...(ctx.opens ? { opens: ctx.opens } : {}),
    ...(damageTargets ? { damageTargets } : {}),
    ...(ctx.summoned && ctx.summoned.length > 0 ? { summoned: ctx.summoned } : {}),
    ...(knocksOut(ctx) ? { knockOut: "chosen" as const } : {})
  };
}

/** Read-only availability per action (the `available-actions` API). Target-specific rules are omitted. */
export function actionAvailability(
  state: GameState,
  attacker: GameState["actors"][number],
  actions: ReadonlyArray<DefinitionAction>,
  definition: ActorDefinition | undefined,
  builtin = false,
  siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? [],
  catalog?: EquipmentCatalog
): ReadonlyArray<ActionAvailability> {
  return actions.map((action): ActionAvailability => {
    // The spell an action casts, so a later action shows as waiting for it while the spell isn't up.
    const spell = action.spellId ? catalog?.spellRecord?.(action.spellId) : undefined;
    const evaluation = evaluateActionEconomy(
      state,
      attacker,
      action,
      [],
      definition,
      undefined,
      siblings,
      undefined,
      false,
      catalog,
      spell
    );
    let usesRemaining: number | null = null;
    if (action.uses) {
      const key = action.uses.pool ?? action.id;
      const spent =
        action.uses.per === "turn"
          ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0)
          : (attacker.actionUses[key] ?? 0);
      // Same pool arithmetic as the gate.
      usesRemaining = Math.max(0, useLimitFor(siblings, action) - spent);
    }
    const instance = state.combat.turn.actionInstance;
    let componentsRemaining: number | null = null;
    if (
      instance &&
      instance.actorId === attacker.id &&
      state.combat.turnActorId === attacker.id &&
      action.activation === "action" &&
      !action.multiattack
    ) {
      if (instance.components[action.id] !== undefined) componentsRemaining = instance.components[action.id];
      else if ((action.attack || action.replacesAttack) && instance.components["attack"] !== undefined)
        componentsRemaining = instance.components["attack"];
    }
    const reason = unavailableReason(evaluation.violations, { state, attacker, action, siblings, spell });
    const passive = passiveOf(action, builtin);
    const shaping = builtin ? undefined : shapingOffers(state, attacker, action, spell, definition, siblings);
    const damageLook = !builtin && damageLookOffered(state, attacker, action, definition, siblings);
    const forms = action.shapeShift ? formsOffer(state, attacker, action, definition, catalog) : undefined;
    return {
      id: action.id,
      name: action.name,
      activation: action.activation,
      available: evaluation.violations.length === 0,
      violations: evaluation.violations,
      // The sheet's one sentence for why not; the violations keep the full account.
      ...(reason !== undefined ? { reason } : {}),
      ...(passive !== undefined ? { passive } : {}),
      ...(shaping !== undefined ? { shaping } : {}),
      ...(damageLook ? { damageLook: true as const } : {}),
      // A template drawn for a higher slot grows as the cast's will (Fog Cloud).
      ...(spell?.effect?.areaPerSlot && action.area && action.spellSlot
        ? { areaPerSlot: { feet: spell.effect.areaPerSlot, level: spell.level } }
        : {}),
      ...(forms !== undefined ? { forms } : {}),
      ...(action.effectOptions
        ? { options: action.effectOptions.map((option) => ({ id: option.id, name: option.name })) }
        : {}),
      usesRemaining,
      componentsRemaining,
      ...(builtin ? { builtin: true } : {}),
      // A rider tapped before its roll (Brutal Strike) stays on the turn list.
      ...(hitRiderOf(action) && !hitRiderOf(action)!.declaredBeforeRoll ? { ridesAHit: true as const } : {}),
      // Display values only (ADR-0007), from the effective list; resolution recomputes from the id.
      description: action.description,
      attackBonus: action.attack?.bonus ?? null,
      reachFeet: action.attack?.reachFeet ?? null,
      rangeFeet: action.attack?.rangeFeet ?? null,
      rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
      ...(action.targets?.rangeFeet !== undefined ? { targetRangeFeet: action.targets.rangeFeet } : {}),
      attackCount: action.attack?.count ?? null,
      saveAbility: action.save?.ability ?? null,
      saveDc: action.save?.dc ?? null,
      damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
      usesLimit: action.uses ? useLimitFor(siblings, action) : null,
      usesPer: action.uses?.per ?? null,
      usesPool: action.uses?.pool ?? null,
      useCost: action.useCost ?? null,
      requiresEffectTag: action.requiresEffectTag ?? null,
      // The plan it makes this turn (a clay golem's three Slams after Hasten).
      multiattack: action.multiattack
        ? planThisTurn(state, attacker.id, action).multiattack!.map((component) => ({
            actionId: component.actionId,
            count: component.count,
            ...(component.or ? { or: [...component.or] } : {})
          }))
        : null,
      reaction: action.reaction ?? null,
      healing: action.healing ? { formula: action.healing.formula } : null,
      healTargets:
        action.healing && !action.healing.self && healLimit(action, spell, undefined) > 1
          ? healLimit(action, spell, undefined)
          : null,
      // A builtin says what the stat block's action list says of it (Help picks one creature, Dodge none).
      targeting: builtin
        ? (BUILTIN_TARGETING[action.id] ?? "none")
        : tapTargeting(action, consumableRowFor(action, attacker.inventory, catalog) !== null, spell),
      // A spell cast from an item picks as the spell's own cast does: darts by target, the type to deal.
      darts: action.darts ?? null,
      damageTypes: action.damageTypes ? [...action.damageTypes] : null,
      ...(conditionChoicesOf(action, spell).length > 0
        ? { conditionChoices: [...conditionChoicesOf(action, spell)] as SaveCondition[] }
        : {}),
      // The creature a summon brings and its creature type, picked as it is used (Find Familiar's forms).
      ...(summonChoicesOf(action.summons) ? { summonChoices: summonChoicesOf(action.summons)! } : {}),
      // An option, one for each target, or the weapon a grant binds to (Fire Shield, Bestow Curse, Magic Weapon).
      ...(actionChoicesOf(action) ? { choices: structuredClone(actionChoicesOf(action)!) } : {}),
      // Search, Study, Influence and Escape a Grapple are made with a skill the roller picks; Help with a Check helps
      // with a skill or one of its user's tools.
      ...(builtin && builtinCheckSkills(action.id).length > 0
        ? {
            checkSkills: [
              ...builtinCheckSkills(action.id),
              ...(action.id === "help-check"
                ? helpToolsOf(definition, deriveEquipment(attacker, definition, catalog), catalog)
                : [])
            ]
          }
        : {})
    };
  });
}

/** Who a tap of this action picks, as the resolver will take it: one creature for an attack, a grant aimed at a
 *  target or a heal (a potion: the drinker); several for a save, damage with no attack roll, a grant on each
 *  creature it targets (a scroll of Bless) or a divided heal; none for what acts on its user (a self heal, Rage, a
 *  scroll of Detect Magic). A spell that rolls nothing picks the creatures it names (Guidance's one), else none (Light).
 *  Null for an action with nothing structured to resolve. */
function tapTargeting(
  action: DefinitionAction,
  usesUpItem: boolean,
  spell: SpellReference | undefined
): "none" | "single" | "multi" | null {
  // A shape-shift on its user (Wild Shape, a werewolf's Shape-Shift), and leaving a form, aim at no one.
  if (action.endsForm || (action.shapeShift && !action.shapeShift.onTargets && !action.save)) return "none";
  if (action.attack || action.grants?.target === "target" || action.targets?.count === 1) return "single";
  if (action.save || action.damage.length > 0 || action.grants?.target === "targets") return "multi";
  if (action.healing) return action.healing.self ? "none" : action.healing.divided ? "multi" : "single";
  // A touch that ends a condition picks who it touches (Lesser Restoration).
  if (action.endsConditions) return "single";
  if (action.spellId !== undefined) {
    // A cast that acts only on a door or a wall (Knock, Arcane Lock, Stone Shape, Passwall) is aimed at one on the map.
    const walls = spell?.walls;
    if (walls && (walls.cuts || (walls.door && walls.door !== "open-or-close" && walls.door !== "close")))
      return "single";
    const named = spell?.effect?.targets;
    return named === undefined ? "none" : named.count > 1 || named.perSlot !== undefined ? "multi" : "single";
  }
  const structured =
    action.grants !== undefined ||
    action.move !== undefined ||
    action.teleport !== undefined ||
    action.leap !== undefined ||
    action.multiattack !== undefined ||
    action.uses !== undefined ||
    action.spellSlot !== undefined ||
    usesUpItem;
  return structured ? "none" : null;
}
