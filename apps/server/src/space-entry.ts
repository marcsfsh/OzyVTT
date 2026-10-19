import type { GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { EffectNarration } from "./effects.js";
import { ridesWith } from "./mounts.js";
import { createPendingSaves } from "./pending-saves.js";
import { failureEffectFor } from "./resolution/pending.js";
import type { ZoneDeps } from "./spell-zones.js";
import { traitOf } from "./statblock-traits.js";

/**
 * What a move sets off as the mover's space enters other creatures' spaces (SRD 5.2.1): a gelatinous cube's Ooze Cube
 * ("Other creatures can enter that space, but a creature that does so is subjected to the cube's Engulf and has
 * Disadvantage on the saving throw"). A teleport passes through no one. Fire Form's burn is `wall-passage.ts`'s.
 */

type Point = Readonly<{ x: number; y: number }>;
type Token = GameState["combat"]["tokens"][number];
type Actor = GameState["actors"][number];

const halfOf = (token: Token) => Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) / 2;

/** The creatures whose spaces a mover's space overlaps at some point of its path (each grid step, or every few feet
 *  off the grid), in no order. Its own token, those it carries or holds and those it shared a space with where it set
 *  out are left out. */
export function creaturesEntered(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  carried: readonly string[] = []
): string[] {
  const mover = state.combat.tokens.find((token) => token.actorId === moverId);
  if (!mover || path.length < 2) return [];
  // Squares overlap when they are nearer than their two halves on both axes; a corner passed diagonally isn't.
  const overlaps = (token: Token, at: Point) =>
    Math.max(Math.abs(at.x - token.position!.x), Math.abs(at.y - token.position!.y)) <
    (halfOf(token) + halfOf(mover)) * 0.9;
  const held = (actor: Actor | undefined) =>
    actor?.effects.some(
      (effect) =>
        effect.sourceActorId === moverId &&
        (effect.tags.includes("swallowed") || effect.linkedConditionIds.includes("grappled"))
    ) === true;
  return state.combat.tokens
    .filter((token) => token.position !== null && token.actorId !== moverId && !carried.includes(token.actorId))
    .filter((token) => !ridesWith(state, moverId, token.actorId))
    .filter((token) => !held(state.actors.find((actor) => actor.id === token.actorId)))
    .filter((token) => !overlaps(token, path[0]!) && path.slice(1).some((at) => overlaps(token, at)))
    .map((token) => token.actorId);
}

/** What the mover's entering other creatures' spaces along `path` does, as narration. */
export function spaceEntryAfterMove(
  state: GameState,
  input: Readonly<{ moverId: string; path: readonly Point[]; teleported?: boolean }>,
  deps: ZoneDeps
): EffectNarration[] {
  const mover = state.actors.find((actor) => actor.id === input.moverId);
  if (input.teleported === true || !state.combat.active || !mover) return [];
  const definitionOf = (actor: Actor) => (actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined);
  const entered = creaturesEntered(state, mover.id, input.path).flatMap((id) => {
    const actor = state.actors.find((candidate) => candidate.id === id);
    return actor ? [actor] : [];
  });
  const events: EffectNarration[] = [];
  for (const host of entered) engulfEntrant(state, host, mover, definitionOf(host), deps, events);
  return events;
}

/** A creature that enters a gelatinous cube's space makes its Engulf's save, with Disadvantage. */
function engulfEntrant(
  state: GameState,
  host: Actor,
  entrant: Actor,
  definition: Parameters<typeof traitOf>[0],
  deps: ZoneDeps,
  events: EffectNarration[]
): void {
  const trait = traitOf(definition, "engulfs-entrants");
  const action = trait ? definition?.actions.find((candidate) => candidate.id === trait.actionId) : undefined;
  const save = action?.save;
  if (!trait || !action || !save || host.hp.current <= 0) return;
  // Already inside it, or owing it this save from the same move.
  if (entrant.effects.some((effect) => effect.sourceActorId === host.id && effect.sourceActionId === action.id)) return;
  if (
    state.combat.pendingSaves.some(
      (pending) =>
        pending.targetActorId === entrant.id && pending.sourceActorId === host.id && pending.actionName === action.name
    )
  )
    return;
  const parts = action.damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
    type: part.type
  }));
  const onFail = failureEffectFor(
    { action, attacker: host, castId: null, riderItemId: null, deps: deps.catalog ? { catalog: deps.catalog } : {} },
    save.failureConditions
  );
  createPendingSaves(state, {
    sourceActorId: host.id,
    sourceName: host.name,
    actionName: action.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [entrant.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: save.successDamage === "half",
    conditionIds: save.failureConditions,
    ...(onFail ? { onFailEffect: onFail } : {}),
    disadvantage: { targetId: entrant.id, from: trait.name },
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  events.push({
    kind: "effect",
    text: `${entrant.name} enters ${host.name}'s space and makes a ${save.ability.toUpperCase()} save (DC ${save.dc}) against its ${action.name}, with Disadvantage.`,
    actorId: entrant.id,
    source: { actorId: host.id, name: host.name }
  });
}
