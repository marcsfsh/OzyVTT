import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction, StrikesFrom } from "@vtt/schemas";
import { INTERPOSING_TAG } from "./cover.js";
import { makeEffect } from "./effects.js";
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
type Actor = GameState["actors"][number];

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

/** An item's force (a Dancing Sword in the air, a Feather Token's whip): the action that puts it on the map strikes
 *  from the point it goes to, and a later action (`forceOf`) moves it first and strikes from there, kept within the
 *  feet of its user its item says. */
function itemStrikeOrigin(
  state: GameState,
  input: Readonly<{
    userId: string;
    action: Pick<ActorAction, "id" | "summons" | "forceOf">;
    at: Point | undefined;
    targetId: string | undefined;
    override: RulesOverride | null;
  }>,
  geometry: TokenMapGeometry
): StrikeOrigin | null {
  const { action } = input;
  const positionOf = (actorId: string | undefined) =>
    actorId ? (state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null) : null;
  const userAt = positionOf(input.userId);
  const targetAt = positionOf(input.targetId);
  if (action.summons?.strikesFrom) {
    const at = input.at ?? targetAt ?? userAt;
    return at ? { markerId: null, at, strikes: action.summons.strikesFrom, note: null } : null;
  }
  const marker = state.actors.find(
    (actor) => actor.summon?.by === input.userId && actor.summon.actionId === action.forceOf && actor.summon.strikesFrom
  );
  if (!marker) throw new CommandRejectedError(`It isn't on the map. Use ${action.forceOf ? "its item" : "it"} first.`);
  const strikes = marker.summon!.strikesFrom!;
  const from = positionOf(marker.id);
  if (!from) return null;
  const within = (point: Point) =>
    (mapDistance(geometry, from, point)?.value ?? Infinity) <= strikes.moveFeet + DISTANCE_TOLERANCE_FEET &&
    (strikes.withinFeetOfUser === undefined ||
      !userAt ||
      (mapDistance(geometry, userAt, point)?.value ?? Infinity) <= strikes.withinFeetOfUser + DISTANCE_TOLERANCE_FEET);
  const to = input.at ?? (targetAt && within(targetAt) ? targetAt : from);
  const notes: string[] = [];
  const moved = mapDistance(geometry, from, to)?.value ?? 0;
  if (moved > strikes.moveFeet + DISTANCE_TOLERANCE_FEET)
    notes.push(`${marker.name} flies up to ${strikes.moveFeet} feet; that is ${Math.round(moved)} feet.`);
  const apart = userAt ? (mapDistance(geometry, userAt, to)?.value ?? 0) : 0;
  if (strikes.withinFeetOfUser !== undefined && apart > strikes.withinFeetOfUser + DISTANCE_TOLERANCE_FEET)
    notes.push(
      `${marker.name} stays within ${strikes.withinFeetOfUser} feet of its user; that is ${Math.round(apart)}.`
    );
  const note = notes.length > 0 ? policeBarrier(state, input.override, "range.out-of-range", notes.join(" ")) : null;
  return { markerId: marker.id, at: to, strikes, note };
}

/** After an item force's attack: it counts, and goes back to its user after the last its item allows (a Dancing
 *  Sword's fourth). True when it went back. */
export function countForceStrike(
  state: GameState,
  userId: string,
  action: Pick<ActorAction, "id" | "forceOf">
): boolean {
  const actionId = action.forceOf ?? action.id;
  const marker = state.actors.find(
    (actor) => actor.summon?.by === userId && actor.summon.actionId === actionId && actor.summon.strikesFrom
  );
  const most = marker?.summon?.strikesFrom?.attacks;
  if (!marker || most === undefined) return false;
  const made = (marker.actionUses[STRIKES_KEY] ?? 0) + 1;
  marker.actionUses = { ...marker.actionUses, [STRIKES_KEY]: made };
  return made >= most;
}

/** The attacks an item's force has made, kept on the force. */
const STRIKES_KEY = "force-strikes";

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
    action: Pick<ActorAction, "id" | "summons" | "forceOf">;
    spell: SpellReference | undefined;
    at: Point | undefined;
    targetId: string | undefined;
    override: RulesOverride | null;
  }>,
  geometry: TokenMapGeometry | null
): StrikeOrigin | null {
  const { action, spell } = input;
  if (geometry && !spell && (action.forceOf !== undefined || action.summons?.strikesFrom))
    return itemStrikeOrigin(state, input, geometry);
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

/** The force a caster's spell keeps on the map (Arcane Hand), or undefined. */
export function forceOf(state: GameState, casterId: string, spellId: string): Actor | undefined {
  return state.actors.find(
    (actor) => actor.summon?.by === casterId && actor.summon.spell?.id === spellId && actor.summon.strikesFrom
  );
}

/** After a later action of a spell's force: Interposing Hand leaves it interposing until it causes another effect. */
export function settleInterposing(state: GameState, origin: StrikeOrigin, interposes: boolean): void {
  const marker = state.actors.find((actor) => actor.id === origin.markerId);
  if (!marker) return;
  const id = `${marker.id}:interposing`;
  const kept = marker.effects.filter((effect) => effect.id !== id);
  marker.effects = interposes
    ? [
        ...kept,
        makeEffect({
          id,
          name: "Interposing",
          duration: { type: "manual" },
          tags: [INTERPOSING_TAG],
          sourceActorId: marker.summon?.by ?? null
        })
      ]
    : kept;
}

/** The forces interposing for this creature (SRD 5.2.1 Arcane Hand: "The hand grants you Half Cover against attacks
 *  and other effects that originate from its space or that pass through it"). */
export function interposingFor(state: GameState, actorId: string): readonly Actor[] {
  return state.actors.filter(
    (actor) => actor.summon?.by === actorId && actor.effects.some((effect) => effect.tags.includes(INTERPOSING_TAG))
  );
}

/** Whether a token is a spell's force, which doesn't occupy its space: it covers no one unless it interposes. */
export const isForce = (actor: Pick<Actor, "summon">): boolean => actor.summon?.strikesFrom !== undefined;

/** A force pushing a creature goes with it, staying as near (Forceful Hand: "The hand moves with the target, remaining
 *  within 5 feet of it"). */
export function followPushed(state: GameState, forceId: string, before: Point, after: Point): void {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === forceId);
  if (!token?.position) return;
  token.position = { x: token.position.x + after.x - before.x, y: token.position.y + after.y - before.y };
}
