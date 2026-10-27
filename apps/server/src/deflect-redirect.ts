import type { GameState, PendingReaction } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActionReaction, ActorDefinition } from "@vtt/schemas";
import { bestCover, mapCover, standingCover } from "./cover.js";
import { actionPools, effectiveActions } from "./effective-actions.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { createPendingSaves } from "./pending-saves.js";
import { abilityModifier, type LiveActor } from "./resolution/context.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { sightRules } from "./vision/rules.js";

/**
 * Deflect Attacks (SRD 5.2.1): "If you reduce the damage to 0, you can expend 1 Focus Point to redirect some of the
 * attack's force." The creatures it may hit are listed on the damage prompt, one picked with the answer, and the
 * redirect happens only when the rolled reduction brings the damage to 0 and a Focus Point is left.
 */

const FOCUS_POOL = "focus-points";

type Content = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** The Focus Points the Monk has left. */
function focusLeft(reactor: LiveActor, content: Content): number {
  const definition = reactor.definitionId ? content.resolveDefinition(reactor.definitionId) : undefined;
  const pool = actionPools(effectiveActions(definition, reactor, content.catalog)).find(
    (entry) => entry.id === FOCUS_POOL
  );
  return pool ? Math.max(0, pool.limit - (reactor.actionUses[FOCUS_POOL] ?? 0)) : 0;
}

/** "A creature you can see within 5 feet of yourself if the attack was a melee attack or a creature you can see within
 *  60 feet of yourself that isn't behind Total Cover if the attack was a ranged attack." Empty while no Focus Point
 *  is left. */
export function redirectChoicesFor(
  state: GameState,
  reactor: LiveActor,
  reaction: ActionReaction,
  hitKinds: readonly string[],
  content: Content
): Array<{ actorId: string; name: string }> {
  if (reaction.response !== "reduce-damage" || reaction.redirectsAtZero !== true) return [];
  if (focusLeft(reactor, content) < 1 || !content.distanceFeet) return [];
  const ranged = hitKinds.includes("ranged");
  const reach = ranged ? 60 : 5;
  const sight = sightRules(state, content, content.distanceFeet);
  return state.actors
    .filter((creature) => creature.id !== reactor.id && creature.hp.current > 0)
    .filter((creature) => {
      const feet = content.distanceFeet!(reactor.id, creature.id);
      if (feet === null || feet > reach || !sight.canSee(reactor.id, creature.id)) return false;
      return !ranged || bestCover(standingCover(creature), mapCover(state, reactor.id, creature.id)) !== "total";
    })
    .slice(0, 12)
    .map((creature) => ({ actorId: creature.id, name: creature.name }));
}

/**
 * Spends the Focus Point and opens the creature's Dexterity save against "two rolls of your Martial Arts die plus
 * your Dexterity modifier", of the attack's largest damage type. Returns the table's line, or null when the redirect
 * can't happen (the damage isn't 0, no Focus Point is left, or the pick isn't on the prompt).
 */
export function redirectForce(
  state: GameState,
  input: Readonly<{
    reactor: LiveActor;
    pending: PendingReaction;
    redirectTo: string | undefined;
    remaining: number;
    commandId: string;
    role: "gm" | "player";
  }>,
  deps: Content & Readonly<{ random: RandomSource; newRollId: () => string; gmSessionId: string; now: () => string }>
): EffectNarration | null {
  const { reactor, pending, redirectTo, remaining, commandId } = input;
  if (remaining > 0 || !redirectTo || !(pending.redirectChoices ?? []).some((choice) => choice.actorId === redirectTo))
    return null;
  const creature = state.actors.find((candidate) => candidate.id === redirectTo && candidate.hp.current > 0);
  if (!creature || focusLeft(reactor, deps) < 1) return null;
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  const die = definition?.character?.martialArts?.die ?? "1d6";
  const dex = abilityModifier(definition, "dex");
  // Monk's Focus: "The save DC equals 8 plus your Wisdom modifier and Proficiency Bonus."
  const dc = 8 + abilityModifier(definition, "wis") + (definition?.proficiencyBonus ?? 0);
  const type =
    [...pending.proposedDamageParts].sort((left, right) => right.amount - left.amount)[0]?.type ?? "bludgeoning";
  const formula = `2${die.slice(1)}${dex === 0 ? "" : dex > 0 ? ` + ${dex}` : ` - ${-dex}`}`;
  const rolled = resolveDice(parseDiceFormula(formula), deps.random);
  const amount = Math.max(0, rolled.total);
  reactor.actionUses = { ...reactor.actionUses, [FOCUS_POOL]: (reactor.actionUses[FOCUS_POOL] ?? 0) + 1 };
  recordRoll(state, {
    id: deps.newRollId(),
    commandId,
    initiatorSessionId: deps.gmSessionId,
    initiatorRole: input.role,
    initiatorLabel: reactor.name,
    label: `${pending.actionName}: redirected force`.slice(0, 80),
    actorId: reactor.id,
    purpose: "damage",
    visibility: reactor.visibility === "public" ? "public" : "gm-only",
    formula: rolled.expression.source,
    normalizedFormula: rolled.expression.normalized,
    ...rolledTerms(rolled),
    total: amount,
    createdAt: deps.now()
  });
  createPendingSaves(state, {
    sourceActorId: reactor.id,
    sourceName: reactor.name,
    actionName: `${pending.actionName} (redirect)`,
    ability: "dex",
    dc,
    targetIds: [creature.id],
    proposedDamage: amount,
    proposedDamageParts: [{ amount, type }],
    halfOnSuccess: false,
    conditionIds: [],
    replaceExisting: false,
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
  return {
    kind: "reaction",
    actorId: reactor.id,
    text: `${reactor.name} spends a Focus Point to redirect the attack's force at ${creature.name}: DC ${dc} Dexterity save or ${amount} ${type} damage.`
  };
}
