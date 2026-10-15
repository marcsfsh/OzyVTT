import type { ActionResolution, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { masteryMissDamage } from "./weapon-mastery.js";
import { rollAttack } from "./resolution/attack.js";
import type { DefinitionAction, ResolveContext, ResolveDependencies, ResolveInput } from "./resolution/context.js";
import { rollRiderDamage, rollWeaponDamage } from "./resolution/damage.js";
import { commitEconomy, evaluateActionEconomy, useLimitFor } from "./resolution/economy.js";
import { applyGrant } from "./resolution/grant.js";
import { applyMasteryForces, masterySwingOf, offeredPush } from "./resolution/masteries.js";
import { applyOnHitEffects } from "./resolution/on-hit.js";
import { parkActionSave, parkReaction } from "./resolution/pending.js";
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
  rollAttack(ctx);
  // Preview: the d20 is rolled and shown, nothing else applies. The economy was validated already, so an
  // illegal attack is blocked before the preview roll.
  if (ctx.attack !== null && input.commit === false) return previewOf(ctx);

  rollWeaponDamage(ctx);
  ctx.masterySwing = masterySwingOf(ctx);
  // Graze fires on a miss, when no other damage rolled.
  ctx.bonusDamage.push(...masteryMissDamage(ctx.masterySwing));
  rollRiderDamage(ctx);
  ctx.builtin?.hitDamage?.(ctx);

  applyOnHitEffects(ctx);
  applyMasteryForces(ctx);
  applyGrant(ctx);

  parkReaction(ctx);
  ctx.builtin?.forcedSave?.(ctx);
  parkActionSave(ctx);

  commitEconomy(ctx);
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
    preview: true
  };
}

function resolutionOf(ctx: ResolveContext): ActionResolution {
  const { state, action, attacker, targets, damage, bonusDamage, warnings } = ctx;
  const instance = state.combat.turn.actionInstance;
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
    damageTotal:
      damage.reduce((sum, part) => sum + part.total, 0) + bonusDamage.reduce((sum, part) => sum + part.amount, 0),
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
    ...(ctx.effectsEnded.length > 0 ? { effectsEnded: ctx.effectsEnded } : {})
  };
}

/** Read-only availability per action (the `available-actions` API). Target-specific rules are omitted. */
export function actionAvailability(
  state: GameState,
  attacker: GameState["actors"][number],
  actions: ReadonlyArray<DefinitionAction>,
  definition: ActorDefinition | undefined,
  builtin = false,
  siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? []
): ReadonlyArray<{
  id: string;
  name: string;
  activation: DefinitionAction["activation"];
  available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>;
  usesRemaining: number | null;
  componentsRemaining: number | null;
  builtin?: boolean;
}> {
  return actions.map((action) => {
    const evaluation = evaluateActionEconomy(state, attacker, action, [], definition, undefined, siblings);
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
      reaction: action.reaction ?? null
    };
  });
}
