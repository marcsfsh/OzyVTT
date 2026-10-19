import type { GameState } from "@vtt/domain";
import type { ActionReaction } from "@vtt/schemas";
import { areAllies } from "../creature-sides.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { offerableReaction, slotChoiceOf } from "../reaction-offers.js";
import { sightRules } from "../vision/rules.js";
import { attackUsedAsRanged } from "./attack.js";
import type { DefinitionAction, LiveActor, ResolveContext } from "./context.js";
import { parkedAttackOf } from "./pending.js";

/**
 * An attack another creature may turn onto someone else before it rolls (SRD 5.2.1): the Goblin Boss's Redirect
 * Attack ("The goblin chooses a Small or Medium ally within 5 feet of itself. The goblin and that ally swap places, and
 * the ally becomes the target of the attack instead") and an Arrow-Catching Shield ("Whenever an attacker makes a
 * ranged attack roll against a target within 5 feet of you, you can take a Reaction to become the target of the
 * attack instead"). The attack stops before its d20: the reactor is prompted, and the answer rolls the attack at
 * whichever creature it ends at (`reactions.ts`).
 */

type Redirect = Extract<ActionReaction, { response: "redirect-to-ally" }>;
type BecomeTarget = Extract<ActionReaction, { response: "become-target" }>;

/** The allies a Redirect Attack may hand the attack to: in the fight, standing, of a size it names and within its
 *  reach, never the attacker. Nearest first. */
function redirectAllies(ctx: ResolveContext, reactor: LiveActor, reaction: Redirect): LiveActor[] {
  const { state, attacker, deps } = ctx;
  const distance = deps.distanceFeet;
  if (!distance || !deps.resolveDefinition) return [];
  const resolve = deps.resolveDefinition;
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  const reach = (reaction.rangeFeet ?? 5) + DISTANCE_TOLERANCE_FEET;
  return state.actors
    .flatMap((other) => {
      if (other.id === reactor.id || other.id === attacker.id || !inFight.has(other.id) || other.hp.current <= 0)
        return [];
      if (!areAllies(reactor, other, resolve)) return [];
      const size = other.size ?? "medium";
      if (reaction.allySizes && !reaction.allySizes.includes(size as NonNullable<Redirect["allySizes"]>[number]))
        return [];
      const apart = distance(reactor.id, other.id);
      return apart !== null && apart <= reach ? [{ other, apart }] : [];
    })
    .sort((left, right) => left.apart - right.apart)
    .map(({ other }) => other);
}

/** Whether the reactor sees the attacker on the live map; with vision off, the GM's call, so it does. */
function sees(ctx: ResolveContext, viewer: LiveActor, target: LiveActor): boolean {
  const { state, deps } = ctx;
  if (!deps.resolveDefinition) return true;
  const rules = sightRules(
    state,
    { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) },
    deps.distanceFeet
  );
  return rules.canSee(viewer.id, target.id);
}

type Offer = Readonly<{
  reactor: LiveActor;
  action: DefinitionAction;
  choices?: readonly LiveActor[];
}>;

/** The first creature that may turn the attack: its target's own Redirect Attack, then a creature near the target
 *  that may take the attack on itself. */
function redirectOffer(ctx: ResolveContext): Offer | null {
  const { state, attacker, targets, deps, action } = ctx;
  const target = targets[0]!;
  if (!deps.resolveDefinition || !action.attack) return null;
  const lookup = { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  const own = offerableReaction(
    state,
    target,
    (reaction): reaction is Redirect => reaction.response === "redirect-to-ally",
    lookup
  );
  if (own && sees(ctx, target, attacker)) {
    const choices = redirectAllies(ctx, target, own.reaction);
    if (choices.length > 0) return { reactor: target, action: own.action, choices };
  }
  const distance = deps.distanceFeet;
  if (!distance) return null;
  const ranged = attackUsedAsRanged(action.attack, distance(attacker.id, target.id));
  for (const entry of state.combat.initiative) {
    const reactor = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!reactor || reactor.id === attacker.id || reactor.id === target.id || reactor.hp.current <= 0) continue;
    const offer = offerableReaction(
      state,
      reactor,
      (reaction): reaction is BecomeTarget => reaction.response === "become-target" && (!reaction.ranged || ranged),
      lookup
    );
    if (!offer) continue;
    const apart = distance(reactor.id, target.id);
    if (apart !== null && apart <= (offer.reaction.rangeFeet ?? 5) + DISTANCE_TOLERANCE_FEET)
      return { reactor, action: offer.action };
  }
  return null;
}

/**
 * Stops an attack before its roll when a creature may turn it (see above), and prompts that creature. True when the
 * attack was parked: the caller spends its economy and stops there. Not offered on a look, a preview, a replay that
 * already asked, outside a fight or for an attack at several targets.
 */
export function parkForRedirect(ctx: ResolveContext): boolean {
  const { state, attacker, targets, input, deps } = ctx;
  if (
    !ctx.action.attack ||
    input.commit === false ||
    input.redirectSettled === true ||
    !state.combat.active ||
    targets.length !== 1 ||
    targets[0]!.id === attacker.id
  )
    return false;
  const offer = redirectOffer(ctx);
  if (!offer) return false;
  const target = targets[0]!;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "attack-targeted" as const,
        actorId: offer.reactor.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: target.id,
        targetName: target.name,
        ...(offer.choices
          ? { redirectChoices: offer.choices.map((ally) => ({ actorId: ally.id, name: ally.name })) }
          : {}),
        triggerCommandId: input.commandId,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: parkedAttackOf(ctx, false),
        ...slotChoiceOf(offer.reactor, offer.action),
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({
    actorId: offer.reactor.id,
    actorName: offer.reactor.name,
    actionName: offer.action.name
  });
  return true;
}

/** Redirect Attack's "swap places": the two tokens trade positions and heights on the map. */
export function swapPlaces(state: GameState, actorIdA: string, actorIdB: string): void {
  const tokenA = state.combat.tokens.find((token) => token.actorId === actorIdA);
  const tokenB = state.combat.tokens.find((token) => token.actorId === actorIdB);
  if (!tokenA || !tokenB) return;
  const place = (token: typeof tokenA) => ({
    position: token.position,
    altitudeFeet: token.altitudeFeet,
    airborne: token.airborne
  });
  const [atA, atB] = [place(tokenA), place(tokenB)];
  state.combat = {
    ...state.combat,
    tokens: state.combat.tokens.map((token) =>
      token.actorId === actorIdA ? { ...token, ...atB } : token.actorId === actorIdB ? { ...token, ...atA } : token
    )
  };
}
