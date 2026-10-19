import type { GameState } from "@vtt/domain";
import type { ActionReaction, ActorDefinition } from "@vtt/schemas";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { evaluateActionEconomy } from "./resolution/economy.js";
import type { DefinitionAction, LiveActor } from "./resolution/context.js";
import { familyModeFor } from "./rules-families.js";

/** The slot levels a reaction spell can be cast with by this reactor, lowest first (its spell slots and its Pact Magic
 *  slot at or above the spell's level with one left), for the prompt's slot choice. Empty for a reaction with no slot. */
export function slotChoiceOf(
  reactor: Pick<LiveActor, "spellSlots" | "pactSlots">,
  action: Pick<DefinitionAction, "spellSlot">
): Partial<Readonly<{ slotLevels: number[] }>> {
  const base = action.spellSlot?.level;
  if (base === undefined) return {};
  const levels = new Set<number>();
  for (const slot of reactor.spellSlots ?? []) if (slot.level >= base && slot.remaining > 0) levels.add(slot.level);
  const pact = reactor.pactSlots;
  if (pact && pact.level >= base && pact.remaining > 0) levels.add(pact.level);
  return levels.size > 0 ? { slotLevels: [...levels].sort((left, right) => left - right) } : {};
}

/** The most prompts that may wait at once; past it a trigger opens nothing and the GM rules by hand. */
export const MAX_PENDING_REACTIONS = 20;

export type ReactionOffer<R extends ActionReaction> = Readonly<{ action: DefinitionAction; reaction: R }>;

/**
 * The reactor's first declared reaction that `wanted` accepts and that it could take right now: it is in the fight,
 * able to act, its reaction unspent, and the action's own uses or spell slot not run out. Null when the economy is
 * freeform (the reaction window follows the economy family) or the prompt list is full.
 */
export function offerableReaction<R extends ActionReaction>(
  state: GameState,
  reactor: LiveActor,
  wanted: (reaction: ActionReaction) => reaction is R,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
  }>
): ReactionOffer<R> | null {
  if (
    familyModeFor(state.combat, "economy") === "freeform" ||
    state.combat.pendingReactions.length >= MAX_PENDING_REACTIONS ||
    !state.combat.initiative.some((entry) => entry.actorId === reactor.id)
  )
    return null;
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  // The effective list, so an item-granted reaction is found and its uses are pooled like the sheet's.
  const actions = effectiveActions(definition, reactor, deps.catalog);
  for (const action of actions) {
    const reaction = action.reaction;
    if (action.activation !== "reaction" || !reaction || !wanted(reaction)) continue;
    // The same checks a resolve of the action runs: able to act, reaction unspent, uses and slots left.
    // With the catalog, so a scroll the reactor can't read isn't offered.
    const evaluation = evaluateActionEconomy(
      state,
      reactor,
      action,
      [],
      definition,
      undefined,
      actions,
      undefined,
      false,
      deps.catalog
    );
    if (evaluation.violations.length > 0) continue;
    return { action, reaction };
  }
  return null;
}
