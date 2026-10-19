import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction, StrikesFrom } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { laterRowOf } from "./item-actions.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET, footprintOf, mapDistance } from "./movement-narration.js";
import type { RulesOverride } from "./rules-families.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { policeBarrier } from "./zone-barriers.js";

/**
 * A spell's force that strikes for its caster (SRD 5.2.1 Spiritual Weapon: "you can immediately make one melee spell
 * attack against one creature within 5 feet of the force ... As a Bonus Action on your later turns, you can move the
 * force up to 20 feet and repeat the attack"; Arcane Sword; Conjure Fey's spirit, which teleports). The cast's attack
 * reaches from the point the force appears at; a later attack first moves the force, as far as the spell allows, and
 * reaches from there. The force itself is a summoned token (`summons.ts`) whose `strikesFrom` says so.
 */

type Point = Readonly<{ x: number; y: number }>;

export type StrikeOrigin = Readonly<{
  /** The force on the map, for a later attack; null at the cast, before it appears. */
  markerId: string | null;
  /** Where the attack reaches from. */
  at: Point;
  strikes: StrikesFrom;
  /** A rules note the GM's table let through (a move longer than the spell allows). */
  note: string | null;
}>;

/** How the spell's force strikes, when the spell brings one. */
function strikesOf(action: Pick<ActorAction, "summons">, spell: SpellReference | undefined): StrikesFrom | undefined {
  return action.summons?.strikesFrom ?? spell?.effect?.summons?.strikesFrom;
}

/**
 * Where this action reaches from: the point its cast places the force at, or the force after a later action moves it
 * there. With no point picked, the force goes to its first target where it can (in its space at the cast, there on a
 * later turn when that is within its move), else it stays. Null when the action reaches from its user, or nothing is
 * on the map to measure from.
 */
export function strikeOriginFor(
  state: GameState,
  input: Readonly<{
    userId: string;
    action: Pick<ActorAction, "id" | "summons">;
    spell: SpellReference | undefined;
    at: Point | undefined;
    targetId: string | undefined;
    override: RulesOverride | null;
  }>,
  geometry: TokenMapGeometry | null
): StrikeOrigin | null {
  const { action, spell } = input;
  if (!geometry || !spell) return null;
  const strikes = strikesOf(action, spell);
  if (!strikes) return null;
  const positionOf = (actorId: string | undefined) =>
    actorId ? (state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null) : null;
  const userAt = positionOf(input.userId);
  const targetAt = positionOf(input.targetId);
  if (laterRowOf(spell, action.id) === undefined) {
    // The cast: the force appears at the point picked (its range is checked as it is placed).
    const at = input.at ?? targetAt ?? userAt;
    return at ? { markerId: null, at, strikes, note: null } : null;
  }
  const marker = state.actors.find(
    (actor) =>
      actor.summon?.by === input.userId && actor.summon.spell?.id === spell.id && actor.summon.strikesFrom !== undefined
  );
  const from = marker ? state.combat.tokens.find((token) => token.actorId === marker.id)?.position : undefined;
  if (!marker) throw new CommandRejectedError(`${spell.name}'s force isn't on the map. Cast it again.`);
  if (!from) return null;
  const toTarget =
    targetAt && (mapDistance(geometry, from, targetAt)?.value ?? Infinity) <= strikes.moveFeet + DISTANCE_TOLERANCE_FEET
      ? targetAt
      : null;
  const to = input.at ?? toTarget ?? from;
  const moved = mapDistance(geometry, from, to)?.value ?? 0;
  const note =
    moved > strikes.moveFeet + DISTANCE_TOLERANCE_FEET
      ? policeBarrier(
          state,
          input.override,
          "range.out-of-range",
          `${marker.name} ${strikes.teleports ? "teleports" : "moves"} up to ${strikes.moveFeet} feet; that is ${Math.round(moved)} feet.`
        )
      : null;
  return { markerId: marker.id, at: to, strikes, note };
}

/** The attack as it strikes from the force: reaching `reachFeet` from it, with no range of its own. */
export function struckFrom<A extends Pick<ActorAction, "attack">>(action: A, origin: StrikeOrigin): A {
  if (!action.attack) return action;
  const { rangeFeet: _range, rangeNormalFeet: _normal, ...attack } = action.attack;
  return { ...action, attack: { ...attack, reachFeet: origin.strikes.reachFeet } };
}

/** Distances for the attack: from the force for its user, edge to edge to the target's space; others as measured. */
export function distanceFromForce(
  state: GameState,
  userId: string,
  origin: StrikeOrigin,
  geometry: TokenMapGeometry,
  measured: (a: string, b: string) => number | null
): (a: string, b: string) => number | null {
  const marker = origin.markerId
    ? state.combat.tokens.find((token) => token.actorId === origin.markerId)
    : state.combat.tokens.find((token) => token.actorId === userId);
  return (a, b) => {
    if (a !== userId || !marker) return measured(a, b);
    const target = state.combat.tokens.find((token) => token.actorId === b);
    if (!target?.position) return null;
    const force = footprintOf({ sizeCells: 1, sizePx: marker.sizePx / Math.max(1, marker.sizeCells ?? 1) }, origin.at);
    return creatureDistance(geometry, force, footprintOf(target, target.position))?.value ?? null;
  };
}

/** After a later attack, the force stands where it moved. */
export function settleForce(state: GameState, origin: StrikeOrigin, geometry: TokenMapGeometry): void {
  if (!origin.markerId) return;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === origin.markerId);
  if (!token?.position || (token.position.x === origin.at.x && token.position.y === origin.at.y)) return;
  moveEncounterToken(state, origin.markerId, origin.at, geometry);
}
