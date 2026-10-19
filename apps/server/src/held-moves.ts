import type { GameState } from "@vtt/domain";
import { setAltitude } from "./altitude.js";
import { isIncapacitated } from "./condition-rules.js";
import type { EffectNarration } from "./effects.js";
import { dragAlong } from "./movement-rules.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * SRD 5.2.1 Opportunity Attacks: "The attack occurs right before the creature leaves your reach." A move that provokes
 * stops at the last point of its way still in reach (`combat.heldMove`) while the prompts it opened are open. Once
 * they are all answered or declined, the settle step finishes the move, unless the attacks left the mover unable to
 * go on (at 0 Hit Points, Incapacitated, Grappled or Prone): then it stays where it was hit, and the movement the rest
 * of the way would have cost comes back.
 */

type Point = Readonly<{ x: number; y: number }>;
type Held = NonNullable<GameState["combat"]["heldMove"]>;

/** Stops a provoking move at the edge of reach until its Opportunity Attacks are answered. */
export function holdMove(
  state: GameState,
  geometry: TokenMapGeometry,
  input: Readonly<{
    actorId: string;
    at: Point;
    altitudeFeet: number;
    to: Point;
    toAltitudeFeet: number;
    airborne?: "fly" | "levitate";
    promptIds: readonly string[];
    refundFeet: number;
    dragged: readonly string[];
  }>
): void {
  const held: Held = {
    actorId: input.actorId,
    at: { ...input.at },
    to: { ...input.to },
    ...(input.toAltitudeFeet > 0 ? { toAltitudeFeet: input.toAltitudeFeet } : {}),
    ...(input.airborne ? { airborne: input.airborne } : {}),
    promptIds: [...input.promptIds],
    refundFeet: Math.max(0, Math.round(input.refundFeet * 10) / 10),
    dragged: [...input.dragged]
  };
  state.combat = { ...state.combat, heldMove: held };
  moveEncounterToken(state, input.actorId, input.at, geometry);
  setAltitude(state, input.actorId, input.altitudeFeet, input.altitudeFeet > 0 ? input.airborne : undefined);
}

/** Whether a held move's prompts are all answered, so it can finish or stop. */
export function heldMoveReady(state: GameState): boolean {
  const held = state.combat.heldMove;
  if (!held) return false;
  return !state.combat.pendingReactions.some((prompt) => held.promptIds.includes(prompt.id));
}

/** Finishes a held move whose Opportunity Attacks are answered, or stops it where it stands. */
export function settleHeldMove(state: GameState, geometry: TokenMapGeometry): EffectNarration[] {
  const held = state.combat.heldMove;
  if (!held || !heldMoveReady(state)) return [];
  state.combat = { ...state.combat, heldMove: null };
  const mover = state.actors.find((actor) => actor.id === held.actorId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === held.actorId);
  if (!mover || !token?.position) return [];
  const stopped =
    mover.hp.current <= 0 ||
    isIncapacitated(mover) ||
    mover.conditions.some((condition) => condition.id === "grappled" || condition.id === "prone");
  if (stopped) {
    // Its own turn's movement the rest of the way would have spent is its again.
    if (state.combat.turnActorId === mover.id && held.refundFeet > 0)
      state.combat = {
        ...state.combat,
        turn: {
          ...state.combat.turn,
          movementUsedFeet: Math.max(0, state.combat.turn.movementUsedFeet - held.refundFeet)
        }
      };
    return [{ kind: "effect", text: `${mover.name} is stopped where it was struck.`, actorId: mover.id }];
  }
  const from = token.position;
  moveEncounterToken(state, mover.id, held.to, geometry);
  setAltitude(state, mover.id, held.toAltitudeFeet ?? 0, held.airborne);
  const arrived = state.combat.tokens.find((candidate) => candidate.actorId === mover.id)?.position;
  if (arrived) dragAlong(state, held.dragged, from, arrived, geometry);
  return [{ kind: "effect", text: `${mover.name} carries on with its move.`, actorId: mover.id }];
}
