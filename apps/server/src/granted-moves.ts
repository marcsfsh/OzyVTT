import type { EffectInstance, GameState } from "@vtt/domain";
import type { ActionMove, ActionTeleport, ActorDefinition } from "@vtt/schemas";
import { rollDice } from "@vtt/rules-5e";
import { makeEffect, type EffectNarration } from "./effects.js";
import type { FallDeps } from "./falling.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { currentTravelSpeedFeet, type TravelMode } from "./speed.js";

/**
 * Movement an action or feature grants beside the turn's own (SRD 5.2.1): "the dragon moves up to half its Speed",
 * "you can move up to half your Speed without provoking Opportunity Attacks" (Tactical Shift), and teleports ("teleports
 * up to 60 feet to an unoccupied space it can see", Misty Step). Each is an effect on the creature that belongs to the
 * turn it was granted in, so it lapses when that turn ends, and the movement rules spend it: a granted move is charged
 * to its own allowance, on the creature's turn or off it, and provokes unless the text says otherwise; a granted
 * teleport is checked for range, an unoccupied space and sight, and needs no GM go-ahead.
 */

type Actor = GameState["actors"][number];
export type MoveGrant = NonNullable<EffectInstance["grantedMove"]>;
export type TeleportGrant = NonNullable<EffectInstance["grantedTeleport"]>;

export const GRANTED_MOVE_TAG = "granted-move";
export const GRANTED_TELEPORT_TAG = "granted-teleport";

/** Whether a grant still belongs to the turn now running. */
const current = (state: GameState, grant: Readonly<{ round: number; turnActorId: string | null }>) =>
  grant.round === state.combat.round && grant.turnActorId === state.combat.turnActorId;

/** Feet of a grant: half or all of the way's Speed as it stands, rounded down to 5 feet (SRD "half your Speed"). */
export function grantFeet(
  actor: Actor,
  move: Pick<ActionMove, "speed" | "mode">,
  definition: ActorDefinition | undefined,
  catalog?: EquipmentCatalog
): number {
  const derivation = deriveEquipment(actor, definition, catalog);
  const speed = currentTravelSpeedFeet(actor, derivation, definition, move.mode ?? "walk") ?? 0;
  const feet = move.speed === "half" ? speed / 2 : speed;
  return Math.max(0, Math.floor(feet / 5) * 5);
}

/** Gives a creature a move beside its turn's own, for the turn now running. */
export function grantMove(
  state: GameState,
  actor: Actor,
  input: Readonly<{
    id: string;
    name: string;
    feet: number;
    mode?: TravelMode;
    provokes: boolean;
    straight?: true;
    jump?: true;
    costFeet?: number;
    owedActionId?: string;
  }>
): void {
  const grant: MoveGrant = {
    feet: input.feet,
    ...(input.mode ? { mode: input.mode } : {}),
    provokes: input.provokes,
    ...(input.straight ? { straight: true as const } : {}),
    ...(input.jump ? { jump: true as const, costFeet: input.costFeet ?? 0 } : {}),
    round: state.combat.round,
    turnActorId: state.combat.turnActorId,
    ...(input.owedActionId ? { owedActionId: input.owedActionId } : {})
  };
  actor.effects = [
    ...actor.effects.filter((effect) => effect.grantedMove === undefined),
    makeEffect({
      id: input.id,
      name: input.name,
      tags: [GRANTED_MOVE_TAG],
      duration: { type: "encounter" },
      grantedMove: grant
    })
  ];
}

/** Gives a creature a teleport to take during the turn now running. */
export function grantTeleport(
  state: GameState,
  actor: Actor,
  input: Readonly<{ id: string; name: string; teleport: ActionTeleport }>
): void {
  actor.effects = [
    ...actor.effects.filter((effect) => effect.grantedTeleport === undefined),
    makeEffect({
      id: input.id,
      name: input.name,
      tags: [GRANTED_TELEPORT_TAG],
      duration: { type: "encounter" },
      grantedTeleport: {
        feet: input.teleport.feet,
        round: state.combat.round,
        turnActorId: state.combat.turnActorId,
        ...(input.teleport.unseen ? { unseen: true as const } : {}),
        ...(input.teleport.failDamage ? { failDamage: input.teleport.failDamage } : {})
      }
    })
  ];
}

/** The creature's granted move for this turn with feet left, if any. */
export function activeMoveGrant(
  state: GameState,
  actor: Actor
): (MoveGrant & { effectId: string; name: string }) | null {
  const effect = actor.effects.find(
    (candidate) => candidate.grantedMove !== undefined && current(state, candidate.grantedMove)
  );
  if (!effect?.grantedMove) return null;
  return { ...effect.grantedMove, effectId: effect.id, name: effect.name };
}

/** The creature's granted teleport for this turn, if any. */
export function activeTeleportGrant(
  state: GameState,
  actor: Actor
): (TeleportGrant & { effectId: string; name: string }) | null {
  const effect = actor.effects.find(
    (candidate) => candidate.grantedTeleport !== undefined && current(state, candidate.grantedTeleport)
  );
  if (!effect?.grantedTeleport) return null;
  return { ...effect.grantedTeleport, effectId: effect.id, name: effect.name };
}

/** Spends feet of a granted move; one spent to nothing goes, unless it still owes its action. */
export function spendMoveGrant(actor: Actor, effectId: string, feet: number): void {
  actor.effects = actor.effects.flatMap((effect) => {
    if (effect.id !== effectId || !effect.grantedMove) return [effect];
    const left = Math.max(0, effect.grantedMove.feet - feet);
    if (left <= 0 && effect.grantedMove.owedActionId === undefined) return [];
    return [{ ...effect, grantedMove: { ...effect.grantedMove, feet: Math.round(left) } }];
  });
}

/** The teleport is taken: its grant goes. */
export function spendTeleportGrant(actor: Actor, effectId: string): void {
  actor.effects = actor.effects.filter((effect) => effect.id !== effectId);
}

/** The action a move-first grant held is taken now: the grant no longer owes it. Returns whether one was owed. */
export function payOwedAction(state: GameState, actor: Actor, actionId: string): boolean {
  const grant = activeMoveGrant(state, actor);
  if (!grant || grant.owedActionId !== actionId) return false;
  actor.effects = actor.effects.flatMap((effect) => {
    if (effect.id !== grant.effectId || !effect.grantedMove) return [effect];
    const { owedActionId: _paid, ...rest } = effect.grantedMove;
    return rest.feet > 0 ? [{ ...effect, grantedMove: rest }] : [];
  });
  return true;
}

/** Grants from a turn that has ended go, quietly: they were never more than that turn's. */
export function dropStaleGrants(state: GameState): void {
  for (const actor of state.actors) {
    if (!actor.effects.some((effect) => effect.grantedMove !== undefined || effect.grantedTeleport !== undefined))
      continue;
    actor.effects = actor.effects.filter((effect) => {
      const grant = effect.grantedMove ?? effect.grantedTeleport;
      return grant === undefined || current(state, grant);
    });
  }
}

/** A teleport that arrives in a filled space fails and hurts (SRD Dimension Door: "you ... each take 4d6 Force damage,
 *  and the teleportation fails"); the caller has put the creature back where it was. */
export function failedTeleport(
  state: GameState,
  actor: Actor,
  formula: string,
  deps: FallDeps,
  events: EffectNarration[]
): void {
  const rolled = rollDice(formula, deps.random).total;
  const { application, events: landed } = applyDamageDetailed(
    state,
    actor.id,
    {
      amount: rolled,
      parts: [{ amount: rolled, type: "force" }],
      sourceName: "the failed teleport",
      sourceActorId: null
    },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.random,
      newId: deps.newId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
      ...(deps.commandId ? { commandId: deps.commandId } : {})
    }
  );
  events.push({
    kind: "damage",
    text: `${actor.name}'s teleport fails: that space is filled. It takes ${application.totalApplied} Force damage (${formula}: ${rolled})${damageAdjustmentDetail(application)}.`,
    actorId: actor.id
  });
  events.push(...landed);
}
