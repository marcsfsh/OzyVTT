import type { ActionResolution, GameState } from "@vtt/domain";
import { catalogIdOf, type ActorAction, type InventoryItem } from "@vtt/schemas";
import { addEffect, endEffectIfPresent, makeEffect } from "./effects.js";
import { castAction, itemAction, itemActionId } from "./item-actions.js";
import { withVariant } from "./item-records.js";
import type { ResolveDependencies, ResolveInput } from "./resolution/context.js";

/**
 * An item's table of outcomes (SRD 5.2.1 Wand of Wonder: "That location becomes the point of origin of a spell or other
 * magical effect determined by rolling on the Wand of Wonder Effects table"; a Hat of Many Spells' failure; a Deck of
 * Illusions' card). Once the action that rolls is done, the server rolls the table's die and takes the row it lands
 * on. A row names one of the item's own actions or casts, offered nowhere else (`grantedOnly`): one that acts on its
 * user alone, or rolls a table of its own, happens at once; one aimed at a point or a creature is given to its user for
 * the rest of the turn, at no cost, to place as the sheet places any (a Fireball's sphere), and spent when taken. A row
 * with nothing of its own is told to the table.
 */

/** The tag on the effect that hands its user a rolled outcome to take this turn. */
export const ROLLED_OUTCOME_TAG = "rolled-outcome";

type Resolve = (
  state: GameState,
  action: ActorAction,
  input: ResolveInput,
  deps: ResolveDependencies
) => ActionResolution;

/** The item action or cast a row names, built as its row builds it. */
export function outcomeAction(
  item: InventoryItem,
  then: string,
  deps: Pick<ResolveDependencies, "catalog" | "definition">
): ActorAction | null {
  const base = deps.catalog?.equipmentRecord(catalogIdOf(item));
  if (!base) return null;
  const record = withVariant(base, item);
  const declared = record.actions.find((action) => action.id === then);
  if (declared) return itemAction(item, declared, deps.definition);
  const cast = record.casts.find((entry) => `cast-${entry.spellId}` === then);
  return cast ? castAction(item, cast, item.name, deps.definition, deps.catalog?.spellRecord?.(cast.spellId)) : null;
}

/** Rolls the action's table once it is done and takes the row it lands on; returns the resolution with what the roll
 *  did. `item` is the row the action came from, read before the action could use it up. */
export function rollOutcome(
  state: GameState,
  action: ActorAction,
  input: ResolveInput,
  deps: ResolveDependencies,
  resolution: ActionResolution,
  item: InventoryItem | null,
  resolve: Resolve
): ActionResolution {
  const table = action.rollsOn!;
  const user = state.actors.find((actor) => actor.id === input.actorId);
  if (!user) return resolution;
  const face = deps.random(table.die);
  const row = table.rows.find((entry) => face >= entry.from && face <= entry.to);
  const told = (text: string) => ({ kind: "effect" as const, text, actorIds: [user.id] });
  const lines = [
    told(`${user.name} rolls ${face} on the d${table.die} for ${action.name}: ${row?.name ?? "nothing"}.`)
  ];
  const built = row?.then && item ? outcomeAction(item, row.then, deps) : null;
  if (!built) return { ...resolution, tableNarration: [...(resolution.tableNarration ?? []), ...lines] };
  // On its user alone, or another roll: it happens now.
  if (built.rollsOn !== undefined || built.targets?.who === "self") {
    const inner = resolve(
      state,
      built,
      {
        actorId: user.id,
        targetIds: built.targets?.who === "self" ? [user.id] : [],
        commandId: deps.newRollId(),
        economyPaid: true
      },
      deps
    );
    return {
      ...inner,
      actionId: resolution.actionId,
      actionName: resolution.actionName,
      tableNarration: [...(resolution.tableNarration ?? []), ...lines, ...(inner.tableNarration ?? [])],
      warnings: [...(resolution.warnings ?? []), ...(inner.warnings ?? [])]
    };
  }
  // Aimed somewhere: its user places it this turn.
  addEffect(
    state,
    user.id,
    makeEffect({
      id: `${input.commandId}:outcome`,
      name: `${built.name} (${action.name})`.slice(0, 120),
      tags: [ROLLED_OUTCOME_TAG],
      sourceActorId: user.id,
      sourceName: user.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
      grantedItemAction: {
        recordId: catalogIdOf(item!),
        ...(item!.variantId !== undefined ? { variantId: item!.variantId } : {}),
        actionId: row!.then!,
        rowId: item!.id
      }
    })
  );
  lines.push(told(`${user.name} takes ${built.name} now, at no further cost.`));
  return { ...resolution, tableNarration: [...(resolution.tableNarration ?? []), ...lines] };
}

/** A rolled outcome its user took is spent. */
export function spendRolledOutcome(state: GameState, actorId: string, actionId: string): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const given = actor?.effects.find(
    (effect) =>
      effect.tags.includes(ROLLED_OUTCOME_TAG) &&
      effect.grantedItemAction !== undefined &&
      itemActionId(effect.grantedItemAction.rowId, effect.grantedItemAction.actionId) === actionId
  );
  if (given) endEffectIfPresent(state, actorId, given.id);
}
