import type { PendingSave } from "@vtt/domain";
import type { ActionReaction } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { HAZARDS } from "../hazards.js";
import { halvedDamageParts, previewDamage } from "../hit-points.js";
import { offerableReaction } from "../reaction-offers.js";
import { applyFailureEffect, createPendingSaves } from "../saving-throws.js";
import type { ResolveContext } from "./context.js";
import { coverBonusOf, coverFor } from "../cover.js";
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
          slotLevel: ctx.plan.castLevel,
          damageType: input.damageType ?? null,
          bonusDice: (attack.bonusDice ?? []).flatMap((entry) =>
            entry.total === null ? [] : [{ label: entry.label, dice: entry.dice, total: entry.total }]
          ),
          distanceFeet: deps.distanceFeet?.(attacker.id, target.id) ?? null,
          initiatorRole: deps.initiatorRole ?? "gm",
          initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
          untilNextTurn: offer.reaction.untilNextTurn === true,
          // The extras chosen for the hit ride the replay, spent only if it still hits.
          hitOptions: (input.hitOptions ?? []).map((choice) => ({ ...choice }))
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
 * grapple's escape DC and range, ending on damage, the damage it deals at the start of each turn, and the
 * Concentration the cast is sustained by, what the action declares a failure leaves besides (Bane's -1d4), and the
 * hazard it starts (Alchemist's Fire's burning). Charmed's "can't attack the charmer" and Grappled's "except the
 * grappler" read the source from it. Undefined when every condition stays bare and the action declares nothing more.
 */
export function failureEffectFor(
  ctx: Pick<ResolveContext, "action" | "attacker" | "castId">,
  conditionIds: readonly string[]
): PendingSave["onFailEffect"] {
  const { action, attacker, castId } = ctx;
  const save = action.save;
  if (!save) return undefined;
  const linked = conditionIds.filter((id) => !BARE_FAILURE_CONDITIONS.has(id));
  // What the failure leaves besides conditions (Bane's -1d4, Faerie Fire's outline), declared by the action.
  const declared = save.failureEffect;
  // Alchemist's Fire sets its target burning, Oil covers it: an effect of its own, or riding the conditions.
  const hazard = save.failureHazard ? HAZARDS[save.failureHazard] : undefined;
  if (linked.length === 0 && !declared && !hazard) return undefined;
  const grapple = linked.includes("grappled");
  const duration = save.failureDuration ?? declared?.duration ?? hazard?.duration;
  const ongoingDamage = save.ongoingDamage ?? hazard?.ongoingDamage;
  return {
    name: (
      declared?.name ??
      (linked.length > 0 ? `${conditionLabel(linked[0]!)} by ${attacker.name} (${action.name})` : hazard!.name)
    ).slice(0, 120),
    tags: [...(grapple ? ["grapple"] : []), ...(declared?.tags ?? []), ...(hazard ? [hazard.tag] : [])].slice(0, 8),
    modifiers: [...(declared?.modifiers ?? [])],
    linkedConditionIds: linked,
    // An escape DC the text doesn't print is the grapple's own DC, as the 2024 rules set it.
    escapeDc: grapple ? (save.escapeDc ?? save.dc) : null,
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    ...(duration ? { duration } : {}),
    ...(save.repeatSave ? { repeatSave: { ability: save.ability, dc: save.dc } } : {}),
    ...(save.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(save.speedZero ? { speedZero: true } : {}),
    ...(grapple ? { endsWhenSourceDefeated: true, rangeFeet: save.rangeFeet ?? action.attack?.reachFeet ?? 5 } : {}),
    ...(ongoingDamage ? { ongoingDamage } : {}),
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
  const { state, action, attacker, targets, input, deps, attack } = ctx;
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
  const parts = rider ? [] : damagePartsOf(ctx);
  // Cover adds to Dexterity saving throws (SRD Cover), each target's own: the GM's choice for this resolve, else the
  // cover the GM marked it with, unless the save ignores it (Sacred Flame). Carried on the prompt.
  const saveBonusOf = (target: (typeof targets)[number]) =>
    action.save!.ability === "dex" && !action.save!.ignoresCover ? coverBonusOf(coverFor(input.cover, target)) : 0;
  const groups = new Map<number, string[]>();
  for (const target of saving) groups.set(saveBonusOf(target), [...(groups.get(saveBonusOf(target)) ?? []), target.id]);
  for (const [saveBonus, targetIds] of groups)
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability: action.save.ability,
      dc: action.save.dc,
      targetIds,
      proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
      proposedDamageParts: parts,
      saveBonus,
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
