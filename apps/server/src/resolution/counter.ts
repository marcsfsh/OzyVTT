import type { ActionReaction } from "@vtt/schemas";
import { areAllies } from "../creature-sides.js";
import { isItemActionId, laterRowOf } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { offerableReaction, slotChoiceOf } from "../reaction-offers.js";
import { hiddenFrom } from "../vision/audience.js";
import { sceneSight } from "../vision/sight.js";
import { spellOf } from "./concentration.js";
import type { ResolveContext } from "./context.js";
type CounterReaction = Extract<ActionReaction, { response: "counter" }>;

/** The components a cast is made with, after what its stat block or item goes without: Counterspell needs at least one
 *  to see the casting. */
function castWithComponents(ctx: ResolveContext): boolean {
  const spell = spellOf(ctx);
  if (!spell || laterRowOf(spell, ctx.action.id) !== undefined || isItemActionId(ctx.action.id)) return false;
  const waived = new Set(
    (ctx.deps.definition?.actions ?? []).flatMap((parent) =>
      parent.castsSpells &&
      ((parent.castsSpells.self && parent.id === ctx.action.id) ||
        parent.castsSpells.spells.some((entry) => entry.id === ctx.action.id))
        ? (parent.castsSpells.waives ?? [])
        : []
    )
  );
  return (["verbal", "somatic", "material"] as const).some(
    (component) => spell.components[component] && !waived.has(component)
  );
}

/**
 * SRD 5.2.1 Counterspell: "when you see a creature within 60 feet of yourself casting a spell with Verbal, Somatic, or
 * Material components". Each creature in the fight that could cast it now (its Reaction unspent, a slot left) and
 * isn't the caster's ally is offered the reaction, when it can see the caster (the map's vision, when on) and stands
 * within its range (when the map measures it). The cast waits before anything of it happens: its action is spent now,
 * and its slot, its limited use and its consumed materials only if it goes ahead. True when the cast was parked.
 */
export function parkForCounterspell(ctx: ResolveContext): boolean {
  const { state, attacker, input, deps, action } = ctx;
  if (input.economyPaid === true || input.commit === false || !deps.resolveDefinition || !castWithComponents(ctx))
    return false;
  const content = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  const sight = sceneSight(state, content);
  const prompts = state.combat.initiative.flatMap((entry) => {
    const reactor = state.actors.find((actor) => actor.id === entry.actorId);
    if (!reactor || reactor.id === attacker.id) return [];
    const distance = deps.distanceFeet?.(reactor.id, attacker.id) ?? null;
    const offer = offerableReaction(
      state,
      reactor,
      (reaction): reaction is CounterReaction =>
        reaction.response === "counter" &&
        (reaction.rangeFeet === undefined ||
          distance === null ||
          distance <= reaction.rangeFeet + DISTANCE_TOLERANCE_FEET),
      { resolveDefinition: deps.resolveDefinition!, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
    );
    if (!offer || areAllies(reactor, attacker, deps.resolveDefinition)) return [];
    if (sight.enabled && !sight.sees(reactor.id, attacker.id)) return [];
    // A caster hidden from the reactor's player isn't seen casting.
    const owner = reactor.kind === "player-character" ? reactor.ownerSessionId : null;
    if (owner !== null && hiddenFrom(state, content, owner)(attacker.id)) return [];
    return [{ reactor, offer }];
  });
  if (prompts.length === 0) return false;
  const slot = ctx.plan.spendSpellSlot;
  // What the cast would use up waits with it; the components were read when the economy was planned.
  const spends = ctx.plan.componentSpends ?? [];
  const parkedCast = {
    actionId: action.id,
    castCommandId: input.commandId,
    targetIds: ctx.targets.map((target) => target.id),
    areaPlaced: input.areaPlaced === true,
    slot: slot ? { level: slot.level, pact: slot.pact === true } : null,
    use: ctx.plan.spendUse ? { ...ctx.plan.spendUse } : null,
    componentSpends: spends.map((spend) => ({ ...spend })),
    conditionId: input.conditionId ?? null,
    damageType: input.damageType ?? null,
    ability: input.ability ?? null,
    holdKey: input.holdKey ?? null,
    initiatorRole: deps.initiatorRole ?? "gm",
    initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId
  } as const;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      ...prompts.map(({ reactor, offer }) => ({
        id: deps.newRollId(),
        kind: "casts-spell" as const,
        actorId: reactor.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: attacker.id,
        triggerCommandId: input.commandId,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: null,
        parkedCast: structuredClone(parkedCast),
        ...slotChoiceOf(reactor, offer.action),
        createdAt: Date.parse(deps.now())
      }))
    ]
  };
  for (const { reactor, offer } of prompts)
    ctx.reactionPrompts.push({ actorId: reactor.id, actorName: reactor.name, actionName: offer.action.name });
  return true;
}
