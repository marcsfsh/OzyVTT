import type { GameState } from "@vtt/domain";
import type { ActionReaction } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { DamageDeps } from "./hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { offerableReaction } from "./reaction-offers.js";
import type { LiveActor } from "./resolution/context.js";

type StrikeReaction = Extract<ActionReaction, { trigger: "damaged-by-creature" }>;

/**
 * Damage from a creature opens the damaged creature's strike-back reaction (Hellish Rebuke, Storm's Thunder,
 * Retaliation) as a prompt; answering it strikes that creature (reactions.ts). Out of range on the map opens nothing;
 * an unmeasurable distance is left to the table. A hidden source opens nothing either, since the prompt would name
 * it to the damaged creature's player, and the GM resolves that by hand. Returns the line that announces the prompt.
 */
export function offerDamageReaction(
  state: GameState,
  victim: LiveActor,
  sourceActorId: string,
  deps: DamageDeps
): EffectNarration | null {
  if (!state.combat.active || !deps.newId || victim.hp.current <= 0 || victim.id === sourceActorId) return null;
  const source = state.actors.find((candidate) => candidate.id === sourceActorId);
  if (
    !source ||
    source.visibility === "gm-only" ||
    source.hp.current <= 0 ||
    !state.combat.initiative.some((entry) => entry.actorId === source.id) ||
    // One reaction a round, so a second hit from a Multiattack adds no second prompt.
    state.combat.pendingReactions.some((entry) => entry.actorId === victim.id && entry.kind === "damaged-by-creature")
  )
    return null;
  const distance = deps.distanceFeet?.(victim.id, source.id) ?? null;
  const offer = offerableReaction(
    state,
    victim,
    (reaction): reaction is StrikeReaction =>
      reaction.trigger === "damaged-by-creature" &&
      (reaction.rangeFeet === undefined ||
        distance === null ||
        distance <= reaction.rangeFeet + DISTANCE_TOLERANCE_FEET),
    deps
  );
  if (!offer) return null;
  const id = deps.newId();
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id,
        kind: "damaged-by-creature" as const,
        actorId: victim.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: source.id,
        sourceName: source.name,
        targetActorId: source.id,
        triggerCommandId: deps.commandId ?? id,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: null,
        rollsAttack: offer.reaction.response === "melee-attack" || offer.action.attack !== undefined,
        parkedAttack: null,
        createdAt: deps.now ? Date.parse(deps.now()) : Date.now()
      }
    ]
  };
  return {
    kind: "reaction",
    text: `${victim.name} may use ${offer.action.name} against ${source.name}.`,
    actorId: victim.id
  };
}
