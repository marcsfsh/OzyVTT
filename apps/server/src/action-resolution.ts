import {
  owedDamageParts,
  owedDamageTotal,
  type ActionAvailability,
  type ActionResolution,
  type GameState
} from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { BUILTIN_TARGETING } from "./builtin-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { masteryMissDamage } from "./weapon-mastery.js";
import { spendAmmunition } from "./resolution/ammunition.js";
import { useUpConsumable } from "./resolution/consumables.js";
import { consumableRowFor } from "./consumables.js";
import { rollAttack } from "./resolution/attack.js";
import { rollLastCharge } from "./resolution/charges.js";
import type { DefinitionAction, ResolveContext, ResolveDependencies, ResolveInput } from "./resolution/context.js";
import { rollRiderDamage, rollWeaponDamage, spendDamageUses } from "./resolution/damage.js";
import { commitEconomy, evaluateActionEconomy, useLimitFor } from "./resolution/economy.js";
import { applyGrant } from "./resolution/grant.js";
import { readScroll } from "./resolution/scroll.js";
import { applyHealing } from "./resolution/heal.js";
import { recordCleaveOpening, recordLightAttack, recordLoadingShot } from "./resolution/extra-attacks.js";
import { applyMasteryForces, masterySwingOf, offeredPush, spendSap, spendVex } from "./resolution/masteries.js";
import { hitOffersOf, rollHitOptions, spendHitOptions } from "./resolution/hit-options.js";
import { applyOnHitEffects } from "./resolution/on-hit.js";
import { parkActionSave, parkForAcReaction, parkReaction } from "./resolution/pending.js";
import { startConcentration } from "./resolution/concentration.js";
import { applyRageRules } from "./resolution/rage.js";
import { releaseHideAndReady } from "./resolution/release.js";
import { openResolve } from "./resolution/validate.js";

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
  action: DefinitionAction,
  input: ResolveInput,
  deps: ResolveDependencies
): ActionResolution {
  const ctx = openResolve(state, action, input, deps);
  ctx.builtin?.check?.(ctx);
  ctx.builtin?.apply?.(ctx);
  // A failed check to read a scroll spends the cast and the scroll, and nothing else happens.
  if (readScroll(ctx)) {
    commitEconomy(ctx);
    useUpConsumable(ctx);
    return { ...resolutionOf(ctx), save: null };
  }
  rollAttack(ctx);
  // Preview: the d20 is rolled and shown, nothing else applies. The economy was validated already, so an
  // illegal attack is blocked before the preview roll.
  if (ctx.attack !== null && input.commit === false) return previewOf(ctx);
  // The roll is made, so a Vex marker or a Sap it read is spent; a finishing replay already spent them.
  if (input.economyPaid !== true) {
    spendVex(ctx);
    spendSap(ctx);
  }
  // A hit the target's Parry or Shield may still turn into a miss: the attack is spent, and the answer finishes it.
  if (parkForAcReaction(ctx)) {
    commitEconomy(ctx);
    rollLastCharge(ctx);
    spendAmmunition(ctx);
    useUpConsumable(ctx);
    recordLightAttack(ctx);
    recordLoadingShot(ctx);
    releaseHideAndReady(ctx);
    return { ...resolutionOf(ctx), save: null, waitingOnReaction: true };
  }

  rollWeaponDamage(ctx);
  ctx.masterySwing = masterySwingOf(ctx);
  // Graze fires on a miss, when no other damage rolled.
  ctx.bonusDamage.push(...masteryMissDamage(ctx.masterySwing));
  rollRiderDamage(ctx);
  ctx.builtin?.hitDamage?.(ctx);
  rollHitOptions(ctx);
  // What the stat block leaves to the GM (damage on later turns) is said where the GM reads the result.
  if (ctx.action.reminder) ctx.warnings.push(ctx.action.reminder);

  applyOnHitEffects(ctx);
  applyMasteryForces(ctx);
  applyGrant(ctx);
  startConcentration(ctx);
  applyHealing(ctx);

  parkReaction(ctx);
  ctx.builtin?.forcedSave?.(ctx);
  parkActionSave(ctx);
  applyRageRules(ctx);

  commitEconomy(ctx);
  spendHitOptions(ctx);
  spendDamageUses(ctx);
  rollLastCharge(ctx);
  spendAmmunition(ctx);
  useUpConsumable(ctx);
  recordLightAttack(ctx);
  recordLoadingShot(ctx);
  recordCleaveOpening(ctx);
  releaseHideAndReady(ctx);
  return resolutionOf(ctx);
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
    preview: true,
    ...withOffers(hitOffersOf(ctx))
  };
}

const withOffers = (offers: ReturnType<typeof hitOffersOf>) => (offers.length > 0 ? { hitOffers: offers } : {});

/** With no attack roll and no save, every target takes the damage (SRD Magic Missile: "A dart deals 1d4 + 1 Force
 *  damage to its target"), owed like a hit's: the GM's Apply, or a player's proposal or direct damage. */
function damageTargetsOf(ctx: ResolveContext): ActionResolution["damageTargets"] {
  if (ctx.attack !== null || ctx.action.save || ctx.builtinSave) return undefined;
  const parts = owedDamageParts(ctx);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0 || ctx.targets.length === 0) return undefined;
  return ctx.targets.map((target) => ({ targetId: target.id, targetName: target.name, parts, total }));
}

function resolutionOf(ctx: ResolveContext): ActionResolution {
  const { state, action, attacker, targets, damage, bonusDamage, warnings } = ctx;
  const instance = state.combat.turn.actionInstance;
  const damageTargets = damageTargetsOf(ctx);
  return {
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
    // What every apply path lands: a negative part deals 0 of its type rather than eating another's.
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
    ...(ctx.effectsEnded.length > 0 ? { effectsEnded: ctx.effectsEnded } : {}),
    ...(ctx.healing ? { healing: ctx.healing } : {}),
    ...(ctx.opens ? { opens: ctx.opens } : {}),
    ...(damageTargets ? { damageTargets } : {})
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
      catalog
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
      else if (action.attack && instance.components["attack"] !== undefined)
        componentsRemaining = instance.components["attack"];
    }
    return {
      id: action.id,
      name: action.name,
      activation: action.activation,
      available: evaluation.violations.length === 0,
      violations: evaluation.violations,
      usesRemaining,
      componentsRemaining,
      ...(builtin ? { builtin: true } : {}),
      // Display values only (ADR-0007), from the effective list; resolution recomputes from the id.
      description: action.description,
      attackBonus: action.attack?.bonus ?? null,
      reachFeet: action.attack?.reachFeet ?? null,
      rangeFeet: action.attack?.rangeFeet ?? null,
      rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
      attackCount: action.attack?.count ?? null,
      saveAbility: action.save?.ability ?? null,
      saveDc: action.save?.dc ?? null,
      damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
      usesLimit: action.uses ? useLimitFor(siblings, action) : null,
      usesPer: action.uses?.per ?? null,
      usesPool: action.uses?.pool ?? null,
      requiresEffectTag: action.requiresEffectTag ?? null,
      multiattack: action.multiattack
        ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count }))
        : null,
      reaction: action.reaction ?? null,
      healing: action.healing ? { formula: action.healing.formula } : null,
      // A builtin says what the stat block's action list says of it (Help picks one creature, Dodge none).
      targeting: builtin
        ? (BUILTIN_TARGETING[action.id] ?? "none")
        : tapTargeting(action, consumableRowFor(action, attacker.inventory, catalog) !== null)
    };
  });
}

/** Who a tap of this action picks, as the resolver will take it: one creature for an attack, a grant aimed at a
 *  target or a heal (a potion: the drinker); several for a save or damage with no attack roll, or a divided heal;
 *  none for what acts on its user (a self heal, Rage, a scroll of Detect Magic). Null for an action with nothing
 *  structured to resolve. */
function tapTargeting(action: DefinitionAction, usesUpItem: boolean): "none" | "single" | "multi" | null {
  if (action.attack || action.grants?.target === "target") return "single";
  if (action.save || action.damage.length > 0) return "multi";
  if (action.healing) return action.healing.self ? "none" : action.healing.divided ? "multi" : "single";
  const structured =
    action.grants !== undefined ||
    action.multiattack !== undefined ||
    action.uses !== undefined ||
    action.spellSlot !== undefined ||
    usesUpItem;
  return structured ? "none" : null;
}
