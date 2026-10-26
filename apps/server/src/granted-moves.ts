import type { EffectInstance, GameState } from "@vtt/domain";
import type { ActionMove, ActionTeleport, ActorDefinition, TeleportLanding } from "@vtt/schemas";
import { rollDice } from "@vtt/rules-5e";
import {
  addEffect,
  endEffect,
  makeEffect,
  NO_REACTIONS_TAG,
  turnEndDuration,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import { areEnemies } from "./creature-sides.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import type { FallDeps } from "./falling.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { conditionLabel, isIncapacitated } from "./condition-rules.js";
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
    awayFromActorId?: string;
    towardActorId?: string;
    throughCreatures?: ActionMove["throughCreatures"];
    dropsHeld?: true;
    thenHide?: true;
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
    ...(input.owedActionId ? { owedActionId: input.owedActionId } : {}),
    ...(input.awayFromActorId ? { awayFromActorId: input.awayFromActorId } : {}),
    ...(input.towardActorId ? { towardActorId: input.towardActorId } : {}),
    ...(input.throughCreatures ? { throughCreatures: input.throughCreatures } : {}),
    ...(input.dropsHeld ? { dropsHeld: true as const } : {}),
    ...(input.thenHide ? { thenHide: true as const } : {})
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
  input: Readonly<{ id: string; name: string; teleport: ActionTeleport; passengerId?: string }>
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
        ...(input.teleport.failDamage ? { failDamage: input.teleport.failDamage } : {}),
        ...(input.teleport.landing ? { landing: structuredClone(input.teleport.landing) } : {}),
        ...(input.passengerId ? { passengerId: input.passengerId } : {}),
        ...(input.teleport.smoke ? { smoke: true as const } : {}),
        ...(input.teleport.costFeet !== undefined ? { costFeet: input.teleport.costFeet } : {})
      }
    })
  ];
}

/** A teleport an effect lets its bearer take once on each of its turns (Tree Stride), granted for the turn now running
 *  when it is the bearer's. */
export function teleportsEachTurn(state: GameState, actorId: string, id: string): void {
  if (state.combat.turnActorId !== actorId) return;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const effect = actor?.effects.find((candidate) => candidate.teleportEachTurn !== undefined);
  if (!actor || !effect?.teleportEachTurn) return;
  grantTeleport(state, actor, { id, name: effect.name, teleport: { ...effect.teleportEachTurn } });
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

/** The creatures whose spaces a move through them entered, kept on its grant for the action it owes. */
export function recordEntered(actor: Actor, effectId: string, entered: readonly string[]): void {
  if (entered.length === 0) return;
  actor.effects = actor.effects.map((effect) =>
    effect.id === effectId && effect.grantedMove
      ? {
          ...effect,
          grantedMove: {
            ...effect.grantedMove,
            entered: [...new Set([...(effect.grantedMove.entered ?? []), ...entered])].slice(0, 50)
          }
        }
      : effect
  );
}

/** The creatures the move this action gave its user has entered so far, or null when it gave none. */
export function enteredOnMoveOf(actor: Actor, actionId: string): readonly string[] | null {
  const grant = actor.effects.find((effect) => effect.grantedMove?.owedActionId === actionId)?.grantedMove;
  return grant ? (grant.entered ?? []) : null;
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

/** An effect that makes its creature flee with its Reaction (Dissonant Whispers: "must immediately use its Reaction,
 *  if available, to move as far away from you as it can, using the safest route"). The pipeline's settle step turns it
 *  into a move of the creature's Speed away from the effect's source (`compelledMoves`). */
export const FLEES_WITH_REACTION_TAG = "flees-with-reaction";

/** Whether a creature has a flight to start. */
export const fleesNow = (state: GameState) =>
  state.actors.some((actor) => actor.effects.some((effect) => effect.tags.includes(FLEES_WITH_REACTION_TAG)));

/** Each creature an effect makes flee spends its Reaction, when it has one it can take, on a move of its Speed that
 *  must end farther from the source, provoking as any move does; with none, nothing moves. The effect goes either way. */
export function compelledMoves(
  state: GameState,
  deps: Pick<FallDeps, "resolveDefinition" | "catalog" | "newId">
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    const flee = actor.effects.find((effect) => effect.tags.includes(FLEES_WITH_REACTION_TAG));
    if (!flee) continue;
    actor.effects = actor.effects.filter((effect) => effect.id !== flee.id);
    const inFight = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);
    const canReact =
      inFight &&
      !state.combat.reactionsUsed.includes(actor.id) &&
      !isIncapacitated(actor) &&
      !actor.effects.some((effect) => effect.tags.includes(NO_REACTIONS_TAG));
    if (!canReact || !flee.sourceActorId) continue;
    const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
    const feet = grantFeet(actor, { speed: "full" }, definition, deps.catalog);
    state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed, actor.id] };
    if (feet <= 0) continue;
    grantMove(state, actor, {
      id: deps.newId(),
      name: flee.name,
      feet,
      provokes: true,
      awayFromActorId: flee.sourceActorId
    });
    events.push({
      kind: "reaction",
      text: `${actor.name} uses its Reaction to flee: it may move ${feet} ft away from ${flee.sourceName ?? "the source"}.`,
      actorId: actor.id,
      ...(flee.sourceName ? { source: { actorId: flee.sourceActorId, name: flee.sourceName } } : {})
    });
  }
  return events;
}

/**
 * What a granted teleport's arrival does near the space it lands in (a mummy lord's Whirlwind of Sand: "Each creature
 * of its choice that it can see within 5 feet of its destination space has the Blinded condition until the end of the
 * mummy's next turn"): each enemy the traveler sees that near takes the conditions, until the end of its next turn.
 */
export function landTeleport(
  state: GameState,
  traveler: Actor,
  landing: TeleportLanding,
  name: string,
  deps: ConditionImmunitySource &
    Readonly<{
      commandId: string;
      distanceFeet: (actorIdA: string, actorIdB: string) => number | null;
      sees: (viewerId: string, targetId: string) => boolean;
    }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const entry of state.combat.initiative) {
    const other = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!other || other.id === traveler.id || other.hp.current <= 0) continue;
    if (!areEnemies(traveler, other, deps.resolveDefinition)) continue;
    const distance = deps.distanceFeet(traveler.id, other.id);
    if (distance === null || distance > landing.withinFeet + DISTANCE_TOLERANCE_FEET) continue;
    if (!deps.sees(traveler.id, other.id)) continue;
    addEffect(
      state,
      other.id,
      makeEffect({
        id: `${deps.commandId}:landing:${other.id}`,
        name: `${landing.conditions.map(conditionLabel).join(" and ")} by ${name}`.slice(0, 120),
        sourceActorId: traveler.id,
        sourceName: traveler.name,
        startedRound: state.combat.round,
        duration: turnEndDuration(state, "until-source-turn-end", traveler.id),
        linkedConditionIds: [...landing.conditions]
      }),
      events,
      deps
    );
  }
  return events;
}

/** A roc's Swoop ends by dropping what it grapples: each grapple it holds ends, and a creature it carried into the air
 *  falls from there (`settleFalls`). */
export function dropGrappled(state: GameState, grapplerId: string): EffectNarration[] {
  const grappler = state.actors.find((actor) => actor.id === grapplerId);
  const events: EffectNarration[] = [];
  for (const held of state.actors)
    for (const effect of held.effects.filter(
      (candidate) => candidate.sourceActorId === grapplerId && candidate.tags.includes("grapple")
    )) {
      events.push(...endEffect(state, held.id, effect.id));
      events.push({
        kind: "effect",
        text: `${grappler?.name ?? "Its grappler"} drops ${held.name}.`,
        actorId: held.id,
        ...(grappler ? { source: { actorId: grappler.id, name: grappler.name } } : {})
      });
    }
  return events;
}

/** The tag on the effect that lets its bearer take the Hide action freely once, after a move that says so. */
export const THEN_HIDE_TAG = "then-hide";

/** "At the end of this movement, the weretiger can take the Hide action": the Hide is offered until the turn ends, and
 *  takes no action of its own (`resolution/economy.ts`). */
export function offerHideAfterMove(state: GameState, actorId: string, name: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || !state.combat.active) return [];
  addEffect(
    state,
    actorId,
    makeEffect({
      id: `${actorId}:then-hide:${state.combat.round}`,
      name: name.replace(/\s*\(.*\)$/, "").slice(0, 120),
      tags: [THEN_HIDE_TAG],
      sourceActorId: actorId,
      sourceName: actor.name,
      startedRound: state.combat.round,
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
      bonusActions: ["hide"]
    })
  );
  return [{ kind: "effect", text: `${actor.name} can take the Hide action now.`, actorId, gmOnly: true }];
}
