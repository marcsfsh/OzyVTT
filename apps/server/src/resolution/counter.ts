import type { ActionReaction } from "@vtt/schemas";
import { areAllies } from "../creature-sides.js";
import { isItemActionId, laterRowOf } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { offerableReaction, slotChoiceOf } from "../reaction-offers.js";
import { scrollOfAction } from "../scrolls.js";
import { hiddenFrom } from "../vision/audience.js";
import { sceneSight } from "../vision/sight.js";
import { waivedBy } from "./components.js";
import { spellOf } from "./concentration.js";
import type { ResolveContext } from "./context.js";
import { heldReadiedSpell } from "./economy.js";
import { shapingOf } from "./metamagic.js";
type CounterReaction = Extract<ActionReaction, { response: "counter" | "absorb" }>;
type AbsorbReaction = Extract<ActionReaction, { response: "absorb" }>;

/** Whether an absorbing reaction can take this cast: a spell no higher than it cancels, aimed at the reactor alone with
 *  no area when it says so, and levels its pool still has room for. */
function absorbs(
  ctx: ResolveContext,
  reactor: Readonly<{ id: string; actionUses: Readonly<Record<string, number>> }>,
  reaction: AbsorbReaction,
  uses: Readonly<{ limit: number; pool?: string }> | undefined,
  actionId: string,
  level: number
): boolean {
  if (reaction.maxLevel !== undefined && level > reaction.maxLevel) return false;
  if (reaction.onlyAtReactor) {
    const spell = spellOf(ctx);
    if (ctx.targets.length !== 1 || ctx.targets[0]!.id !== reactor.id) return false;
    if (ctx.action.area !== undefined || (spell && spell.area !== null) || ctx.input.areaPlaced === true) return false;
  }
  if (!uses) return true;
  return (reactor.actionUses[uses.pool ?? actionId] ?? 0) + level <= uses.limit;
}

/** The components a cast is made with, after what its stat block or item goes without: Counterspell needs at least one
 *  to see the casting. A spell cast from a magic item "requires no components", so only a Spell Scroll's, read aloud
 *  without its Material ones, can be seen. */
function castWithComponents(ctx: ResolveContext): boolean {
  const spell = spellOf(ctx);
  if (!spell || laterRowOf(spell, ctx.action.id) !== undefined) return false;
  const scroll = scrollOfAction(ctx.action, ctx.attacker.inventory, ctx.deps.catalog) !== null;
  if (isItemActionId(ctx.action.id) && !scroll) return false;
  const waived = waivedBy(ctx.deps.definition, ctx.action);
  // A Subtle Spell is cast with no components but a consumed or priced material, which can still be seen.
  const subtle = shapingOf(ctx.input.shaping, "subtle-spell") !== undefined;
  return (["verbal", "somatic", "material"] as const).some(
    (component) =>
      spell.components[component] &&
      !waived.has(component) &&
      !(scroll && component === "material") &&
      (!subtle || (component === "material" && (spell.components.costly ?? []).length > 0))
  );
}

/**
 * SRD 5.2.1 Counterspell: "when you see a creature within 60 feet of yourself casting a spell with Verbal, Somatic, or
 * Material components". Each creature in the fight that could cast it now (its Reaction unspent, a slot left) and
 * isn't the caster's ally is offered the reaction, when it can see the caster (the map's vision, when on) and stands
 * within its range (when the map measures it). The text names no side, but the caster's own allies aren't asked: a
 * party casting would ask each of its counterspellers every time. The cast waits before anything of it happens: its
 * action is spent now, and its slot, its limited use and its consumed materials only if it goes ahead. A spell cast
 * to be held with the Ready action is seen as it is cast, not when it is let go, and one cast over several turns as
 * its casting begins. True when the cast was parked.
 */
export function parkForCounterspell(ctx: ResolveContext, beginsLongCast = false): boolean {
  const { state, attacker, input, deps, action } = ctx;
  const spell = spellOf(ctx);
  if (input.economyPaid === true || input.commit === false || !deps.resolveDefinition || !spell) return false;
  // Counterspell sees a casting by its components; an absorbing item takes the spell itself.
  const seenCasting = castWithComponents(ctx);
  const level = ctx.plan.castLevel ?? spell.level;
  // A readied spell let go was cast, and seen, when it was readied.
  if (input.ready !== true && heldReadiedSpell(attacker, action.id) !== undefined) return false;
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
        (reaction.response === "counter" &&
          seenCasting &&
          (reaction.rangeFeet === undefined ||
            distance === null ||
            distance <= reaction.rangeFeet + DISTANCE_TOLERANCE_FEET)) ||
        reaction.response === "absorb",
      { resolveDefinition: deps.resolveDefinition!, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
    );
    if (!offer || areAllies(reactor, attacker, deps.resolveDefinition)) return [];
    const absorbing = offer.reaction.response === "absorb" ? offer.reaction : null;
    if (absorbing && !absorbs(ctx, reactor, absorbing, offer.action.uses, offer.action.id, level)) return [];
    // A spell aimed at the reactor alone is absorbed whoever casts it, seen or not.
    if (absorbing?.onlyAtReactor) return [{ reactor, offer }];
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
    level,
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
    initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
    ...(input.shaping && input.shaping.length > 0 ? { shaping: input.shaping.map((entry) => ({ ...entry })) } : {}),
    ...(input.ready === true ? { ready: true as const } : {}),
    ...(beginsLongCast ? { beginsLongCast: true as const } : {})
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
