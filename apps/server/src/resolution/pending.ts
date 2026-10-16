import type { ActionReaction } from "@vtt/schemas";
import { halvedDamageParts, previewDamage } from "../hit-points.js";
import { offerableReaction } from "../reaction-offers.js";
import { createPendingSaves } from "../saving-throws.js";
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

/**
 * A save action parks one pending save per target; the outcome auto-applies (see saving-throws.ts). When the
 * action also attacks, the save is the hit's rider (a ghoul's paralysing claw): it is owed only on a hit, and
 * the damage already rode the hit, so the save proposes none of its own.
 */
export function parkActionSave(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps, attack } = ctx;
  if (!action.save) return;
  const rider = attack !== null;
  if (rider && attack.outcome !== "hit" && attack.outcome !== "crit") return;
  const parts = rider ? [] : damagePartsOf(ctx);
  createPendingSaves(state, {
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    actionName: action.name,
    ability: action.save.ability,
    dc: action.save.dc,
    targetIds: targets.map((target) => target.id),
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    // Cover adds to Dexterity saving throws (SRD Cover) - carried on the prompt.
    saveBonus: action.save.ability === "dex" ? ctx.coverBonus : 0,
    halfOnSuccess: action.save.successDamage === "half",
    // The GM's explicit choice wins over the condition the action declares.
    conditionIds: input.conditionId ? [input.conditionId] : action.save.failureConditions,
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
}
