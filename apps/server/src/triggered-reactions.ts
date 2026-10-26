import type { GameState, PendingReaction } from "@vtt/domain";
import type { ActionReaction, ActorDefinition, DamageType } from "@vtt/schemas";
import { areAllies } from "./creature-sides.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { offerableReaction, slotChoiceOf, type ReactionOffer } from "./reaction-offers.js";
import type { DefinitionAction } from "./resolution/context.js";
import { AURA_IMMUNE_TAG, traitActionId } from "./statblock-traits.js";
import { hiddenFrom } from "./vision/audience.js";
import { sceneSight, type SceneSight } from "./vision/sight.js";

/**
 * Reactions a stat block sets off with something other than damage from a creature (Hellish Rebuke's
 * `damage-reactions.ts`) or a hit's held damage (`damage-window.ts`): an attack roll that hits the reactor (a rust
 * monster's Reflexive Antennae), a creature starting or ending its turn, or ending a move, near it (a chain devil's
 * Unnerving Gaze, an octopus's Ink Cloud, a nalfeshnee's Pursuit), or damage it takes (a giant octopus's Ink Cloud, a
 * black pudding's Split). Each opens a `triggered` prompt; what "use" does is the declared response's
 * (`reactions.ts`).
 */

type Actor = GameState["actors"][number];
type Cause = NonNullable<PendingReaction["cause"]>;

export type TriggerDeps = Readonly<{
  newId: () => string;
  now?: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  commandId?: string;
}>;

/** What a creature's turn or move sets off near it, and the cause its prompt names. */
const NEAR_CAUSES = {
  "starts-turn-near": "turn-start",
  "ends-turn-near": "turn-end",
  "ends-move-near": "move-end"
} as const satisfies Record<string, Cause>;
export type NearTrigger = keyof typeof NEAR_CAUSES;

const rangeOf = (reaction: ActionReaction): number | undefined =>
  "rangeFeet" in reaction ? reaction.rangeFeet : undefined;

const within = (distance: number | null, feet: number | undefined) =>
  feet === undefined || distance === null || distance <= feet + DISTANCE_TOLERANCE_FEET;

/** The target succeeded against this action of this reactor earlier, which keeps it immune for the fight (a chain
 *  devil's gaze: "immune to this devil's Unnerving Gaze for 24 hours"). */
function immuneTo(target: Actor, reactor: Actor, action: DefinitionAction): boolean {
  const key = traitActionId(action.name);
  return target.effects.some(
    (effect) =>
      effect.tags.includes(AURA_IMMUNE_TAG) && effect.sourceActorId === reactor.id && effect.sourceActionId === key
  );
}

/** Whether a reactor could take a prompt now: in the fight, up, and not already asked by one of these. */
function mayBeAsked(state: GameState, reactor: Actor): boolean {
  return (
    reactor.hp.current > 0 &&
    state.combat.initiative.some((entry) => entry.actorId === reactor.id) &&
    !state.combat.pendingReactions.some((entry) => entry.actorId === reactor.id && entry.kind === "triggered")
  );
}

/** A player's reactor gets no prompt that would point at a creature hidden from them; the GM runs that by hand. */
function hiddenFromReactor(state: GameState, reactor: Actor, other: Actor, deps: TriggerDeps): boolean {
  const owner = reactor.kind === "player-character" ? reactor.ownerSessionId : null;
  if (owner === null || other.id === reactor.id) return false;
  const content = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  return other.visibility === "gm-only" || hiddenFrom(state, content, owner)(other.id);
}

/** Opens the prompt and returns the line that announces it, its source masked for the table when hidden. */
function openTriggered(
  state: GameState,
  reactor: Actor,
  source: Actor | null,
  cause: Cause,
  offer: ReactionOffer<ActionReaction>,
  deps: TriggerDeps
): EffectNarration {
  const id = deps.newId();
  const other = source && source.id !== reactor.id ? source : null;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id,
        kind: "triggered" as const,
        cause,
        actorId: reactor.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: source?.id ?? null,
        sourceName: source?.name ?? reactor.name,
        targetActorId: other?.id ?? null,
        triggerCommandId: deps.commandId ?? id,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: null,
        ...slotChoiceOf(reactor, offer.action),
        createdAt: deps.now ? Date.parse(deps.now()) : Date.now()
      }
    ]
  };
  const response = offer.reaction.response;
  const text =
    other && response === "strike-back"
      ? `${reactor.name} may use ${offer.action.name} against ${other.name}.`
      : other && response === "teleport-near"
        ? `${reactor.name} may use ${offer.action.name} to follow ${other.name}.`
        : `${reactor.name} may use ${offer.action.name}.`;
  return {
    kind: "reaction",
    text,
    actorId: reactor.id,
    ...(other ? { source: { actorId: other.id, name: other.name } } : {})
  };
}

/**
 * A creature's turn starting or ending, or its move ending, near the creatures that answer it: a chain devil's
 * Unnerving Gaze ("A creature the devil can see starts its turn within 30 feet of the devil and can see the devil"), an
 * octopus's Ink Cloud ("A creature ends its turn within 5 feet of the octopus while underwater"), a nalfeshnee's
 * Pursuit ("Another creature the nalfeshnee can see ends its move within 120 feet"). Each such reactor within range,
 * with the sight the trigger asks for, gets a prompt. The reactor's own allies set off nothing, since these stat
 * blocks aim them at foes; a creature off the map, or one that can't be measured to, sets off nothing either.
 */
export function offerNearbyReactions(
  state: GameState,
  moverId: string,
  trigger: NearTrigger,
  deps: TriggerDeps
): EffectNarration[] {
  const distanceFeet = deps.distanceFeet;
  const mover = state.actors.find((candidate) => candidate.id === moverId);
  if (!state.combat.active || !distanceFeet || !mover || mover.hp.current <= 0) return [];
  if (!state.combat.initiative.some((entry) => entry.actorId === mover.id)) return [];
  let sight: SceneSight | null = null;
  const sees = (viewerId: string, targetId: string) => {
    sight ??= sceneSight(state, {
      definition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    });
    return !sight.enabled || sight.sees(viewerId, targetId);
  };
  const events: EffectNarration[] = [];
  for (const entry of state.combat.initiative) {
    const reactor = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!reactor || reactor.id === mover.id || !mayBeAsked(state, reactor)) continue;
    if (areAllies(reactor, mover, deps.resolveDefinition)) continue;
    const distance = distanceFeet(reactor.id, mover.id);
    if (distance === null) continue;
    const offer = offerableReaction(
      state,
      reactor,
      (reaction): reaction is ActionReaction => {
        if (reaction.trigger !== trigger || !within(distance, rangeOf(reaction))) return false;
        if (reaction.response === "use-on-self") return reaction.underwater !== true || state.combat.underwater;
        if (reaction.response === "teleport-near") return sees(reactor.id, mover.id);
        if (reaction.response !== "strike-back") return false;
        if (reaction.sight !== undefined && !sees(reactor.id, mover.id)) return false;
        return reaction.sight !== "mutual" || sees(mover.id, reactor.id);
      },
      deps
    );
    if (!offer || immuneTo(mover, reactor, offer.action) || hiddenFromReactor(state, reactor, mover, deps)) continue;
    events.push(openTriggered(state, reactor, mover, NEAR_CAUSES[trigger], offer, deps));
  }
  return events;
}

/** An attack roll that hit the reactor, from a creature within the reaction's range (a rust monster's Reflexive
 *  Antennae: "An attack roll hits the rust monster"). Returns the line that announces the prompt. */
export function offerHitReaction(
  state: GameState,
  victim: Actor,
  attacker: Actor,
  deps: TriggerDeps
): EffectNarration | null {
  if (!state.combat.active || victim.id === attacker.id || !mayBeAsked(state, victim)) return null;
  if (!state.combat.initiative.some((entry) => entry.actorId === attacker.id) || attacker.hp.current <= 0) return null;
  const distance = deps.distanceFeet?.(victim.id, attacker.id) ?? null;
  const offer = offerableReaction(
    state,
    victim,
    (reaction): reaction is ActionReaction =>
      reaction.response === "strike-back" &&
      reaction.trigger === "hit-by-attack" &&
      within(distance, reaction.rangeFeet),
    deps
  );
  if (!offer || hiddenFromReactor(state, victim, attacker, deps)) return null;
  return openTriggered(state, victim, attacker, "hit", offer, deps);
}

/** What damage the reactor just took, as its own reactions to damage read it. */
export type TakenDamage = Readonly<{
  /** The types it was dealt, before its defences (Split: "is subjected to Lightning or Slashing damage"). */
  types: readonly string[];
  /** Hit points it lost to it. */
  applied: number;
  hpBefore: number;
  sourceActorId?: string | null;
}>;

/**
 * Damage the reactor took setting off its own reaction: a giant octopus's Ink Cloud ("The octopus takes damage while
 * underwater"), a black pudding's Split ("While the pudding is Large or Medium and has 10+ Hit Points, it becomes
 * Bloodied or is subjected to Lightning or Slashing damage"). Returns the line that announces the prompt.
 */
export function offerDamagedReaction(
  state: GameState,
  reactor: Actor,
  taken: TakenDamage,
  deps: TriggerDeps
): EffectNarration | null {
  if (!state.combat.active || !mayBeAsked(state, reactor)) return null;
  const bloodiedNow = taken.hpBefore * 2 > reactor.hp.maximum && reactor.hp.current * 2 <= reactor.hp.maximum;
  const size = reactor.size ?? (reactor.definitionId ? deps.resolveDefinition(reactor.definitionId)?.size : undefined);
  const offer = offerableReaction(
    state,
    reactor,
    (reaction): reaction is ActionReaction => {
      if (reaction.trigger !== "damaged") return false;
      if (reaction.response === "use-on-self")
        return taken.applied > 0 && (reaction.underwater !== true || state.combat.underwater);
      if (reaction.response !== "split") return false;
      if (size === undefined || !reaction.sizes.includes(size)) return false;
      if (reactor.hp.current < reaction.minHitPoints) return false;
      const typed = (reaction.damageTypes ?? []).some((type: DamageType) => taken.types.includes(type));
      return typed || (reaction.bloodied === true && bloodiedNow);
    },
    deps
  );
  if (!offer) return null;
  const source = taken.sourceActorId
    ? (state.actors.find((candidate) => candidate.id === taken.sourceActorId) ?? null)
    : null;
  return openTriggered(state, reactor, source, "damaged", offer, deps);
}
