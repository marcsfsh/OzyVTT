import type { PendingSave } from "@vtt/domain";
import type { ActionReaction } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { halvedDamageParts, previewDamage } from "../hit-points.js";
import { offerableReaction } from "../reaction-offers.js";
import { applyFailureEffect, createPendingSaves } from "../saving-throws.js";
import type { ResolveContext } from "./context.js";
import { damagePartsOf } from "./damage.js";

type HalfDamageReaction = Extract<ActionReaction, { response: "half-damage" }>;
type AcBonusReaction = Extract<ActionReaction, { response: "ac-bonus" }>;

/** A hit on a combatant with a matching declared reaction (Uncanny Dodge) parks the damage in a prompt:
 *  "use" spends the reaction and applies half, "decline" applies it in full (see reactions.ts). The
 *  reaction window follows the economy family, so freeform movement does not silence it. */
export function parkReaction(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit") || !deps.resolveDefinition) return;
  const target = targets[0];
  const proposedParts = damagePartsOf(ctx);
  const proposedTotal = proposedParts.reduce((sum, part) => sum + part.amount, 0);
  if (proposedTotal <= 0 || target.id === attacker.id) return;
  const offer = offerableReaction(
    state,
    target,
    (reaction): reaction is HalfDamageReaction => reaction.response === "half-damage",
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
  if (!offer) return;
  // Both answers weighed through the reactor's defences now, so its buttons name what each would take off.
  const damageDeps = { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  const weigh = (parts: typeof proposedParts) =>
    previewDamage(state, target.id, { amount: 0, parts }, damageDeps).totalApplied;
  const halved = halvedDamageParts(proposedParts);
  const weighed = { use: halved.length > 0 ? weigh(halved) : 0, decline: weigh(proposedParts) };
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "hit-by-attack" as const,
        actorId: target.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: null,
        triggerCommandId: input.commandId,
        proposedDamage: proposedTotal,
        proposedDamageParts: proposedParts,
        critical: ctx.crit,
        weighed,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: null,
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: offer.action.name });
}

/**
 * An attack that would hit a target holding an AC reaction (Parry, Shield) stops at the roll: the target is prompted,
 * and the answer finishes the attack with the same die, against the raised AC if the reaction was used (see
 * reactions.ts). Offered only when the bonus would turn the hit into a miss; a critical hit lands whatever the AC.
 * True when the attack was parked: the caller spends its economy and stops there.
 */
export function parkForAcReaction(ctx: ResolveContext): boolean {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (
    attack === null ||
    attack.outcome !== "hit" ||
    attack.targetAc === null ||
    input.economyPaid === true ||
    !deps.resolveDefinition
  )
    return false;
  const target = targets[0];
  if (target.id === attacker.id) return false;
  const targetAc = attack.targetAc;
  const melee = ctx.riderFilters.attackKinds?.includes("melee") === true;
  const offer = offerableReaction(
    state,
    target,
    (reaction): reaction is AcBonusReaction =>
      reaction.response === "ac-bonus" &&
      (reaction.melee !== true || melee) &&
      attack.total < targetAc + reaction.amount,
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
  if (!offer) return false;
  const cover = input.cover === "half" || input.cover === "three-quarters" ? input.cover : null;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "attack-would-hit" as const,
        actorId: target.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: null,
        triggerCommandId: input.commandId,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: offer.reaction.amount,
        rollsAttack: false,
        parkedAttack: {
          actionId: ctx.action.id,
          builtin: input.builtin === true,
          attackNatural: input.attackTotal === undefined ? attack.naturalRoll : null,
          attackTotal: input.attackTotal ?? null,
          cover,
          conditionId: input.conditionId ?? null,
          attackKinds: (input.attackKinds ?? []).filter(
            (kind): kind is "reaction" | "opportunity" => kind === "reaction" || kind === "opportunity"
          ),
          pushFeet: input.pushFeet ?? null,
          slotLevel: ctx.plan.spendSpellSlot?.level ?? null,
          distanceFeet: deps.distanceFeet?.(attacker.id, target.id) ?? null,
          initiatorRole: deps.initiatorRole ?? "gm",
          initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
          untilNextTurn: offer.reaction.untilNextTurn === true
        },
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: offer.action.name });
  return true;
}

/** Conditions a failed save leaves on their own rather than on its effect: Prone ends by standing up, and
 *  Exhaustion stacks and leaves with rests. */
const BARE_FAILURE_CONDITIONS: ReadonlySet<string> = new Set(["prone", "exhaustion"]);

/**
 * What a failed save puts on its target, as one source-linked effect (SRD: each condition ends by its own rules):
 * the conditions with their printed duration, the save repeated at the end of each of the target's turns, a
 * grapple's escape DC and range, ending on damage, and the Concentration the cast is sustained by. Charmed's
 * "can't attack the charmer" and Grappled's "except the grappler" read the source from it. Undefined when every
 * condition stays bare.
 */
export function failureEffectFor(
  ctx: Pick<ResolveContext, "action" | "attacker" | "castId">,
  conditionIds: readonly string[]
): PendingSave["onFailEffect"] {
  const { action, attacker, castId } = ctx;
  const save = action.save;
  if (!save) return undefined;
  const linked = conditionIds.filter((id) => !BARE_FAILURE_CONDITIONS.has(id));
  if (linked.length === 0) return undefined;
  const grapple = linked.includes("grappled");
  return {
    name: `${conditionLabel(linked[0])} by ${attacker.name} (${action.name})`.slice(0, 120),
    tags: grapple ? ["grapple"] : [],
    linkedConditionIds: linked,
    // An escape DC the text doesn't print is the grapple's own DC, as the 2024 rules set it.
    escapeDc: grapple ? (save.escapeDc ?? save.dc) : null,
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    ...(save.failureDuration ? { duration: save.failureDuration } : {}),
    ...(save.repeatSave ? { repeatSave: { ability: save.ability, dc: save.dc } } : {}),
    ...(save.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(save.speedZero ? { speedZero: true } : {}),
    ...(grapple ? { endsWhenSourceDefeated: true, rangeFeet: save.rangeFeet ?? action.attack?.reachFeet ?? 5 } : {}),
    ...(castId !== null ? { castId } : {}),
    sourceActionId: action.id
  };
}

/**
 * A save action parks one pending save per target; the outcome auto-applies (see saving-throws.ts). When the
 * action also attacks, the save is the hit's rider (a ghoul's paralysing claw): it is owed only on a hit, and
 * the damage already rode the hit, so the save proposes none of its own. A save that a low enough target fails
 * outright (Power Word Stun) lands at once, and only its repeated save can end it.
 */
export function parkActionSave(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps, damage, attack } = ctx;
  if (!action.save) return;
  const rider = attack !== null;
  if (rider && attack.outcome !== "hit" && attack.outcome !== "crit") return;
  // The GM's explicit choice wins over the condition the action declares.
  const conditionIds = input.conditionId ? [input.conditionId] : action.save.failureConditions;
  const onFailEffect = failureEffectFor(ctx, conditionIds);
  let saving = targets;
  const threshold = action.save.failsAtHitPoints;
  if (threshold !== undefined) {
    saving = [];
    for (const target of targets) {
      if (target.hp.current > threshold) {
        ctx.warnings.push(
          `${target.name} has more than ${threshold} hit points - ${action.name} doesn't affect it that way.`
        );
        continue;
      }
      const events = [
        ...conditionIds
          .filter((id) => !onFailEffect?.linkedConditionIds.includes(id))
          .flatMap((id) => setCondition(state, target.id, id, true, undefined, { role: "gm" }, conditionDeps(deps))),
        ...(onFailEffect
          ? applyFailureEffect(
              state,
              target.id,
              onFailEffect,
              `${input.commandId}:${target.id}:fail`,
              conditionDeps(deps)
            )
          : [])
      ];
      for (const event of events)
        ctx.tableNarration.push({ kind: "effect", text: event.text, actorIds: [event.actorId] });
    }
  }
  if (saving.length === 0) return;
  createPendingSaves(state, {
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    actionName: action.name,
    ability: action.save.ability,
    dc: action.save.dc,
    targetIds: saving.map((target) => target.id),
    proposedDamage: rider ? 0 : damage.reduce((sum, part) => sum + part.total, 0),
    proposedDamageParts: rider ? [] : damage.map((part) => ({ amount: part.total, type: part.type })),
    // Cover adds to Dexterity saving throws (SRD Cover) - carried on the prompt.
    saveBonus: action.save.ability === "dex" ? ctx.coverBonus : 0,
    halfOnSuccess: action.save.successDamage === "half",
    conditionIds,
    ...(onFailEffect ? { onFailEffect } : {}),
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
}

const conditionDeps = (deps: ResolveContext["deps"]) => ({
  ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
  ...(deps.catalog ? { catalog: deps.catalog } : {})
});
