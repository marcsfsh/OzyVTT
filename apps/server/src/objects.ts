import {
  OBJECT_ARMOR_CLASS,
  OBJECT_HIT_POINTS,
  type EffectInstance,
  type GameState,
  type ObjectSize,
  type ObjectSubstance,
  type VisionWall
} from "@vtt/domain";
import { adjustDamageParts, normalizeDamageType, type DamagePart } from "@vtt/rules-5e";
import type { ObjectPrint, ObjectStats } from "@vtt/schemas";
import { endEffectIfPresent, type EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";
import { clockMinutesOf } from "./game-time.js";

/**
 * Objects (SRD 5.2.1 Rules Glossary: Object, Breaking Objects, Damage Threshold): one model that a door or a stretch of
 * wall on the map, a spell's panel of ice or stone, and the Net or web that holds a creature share. An object has an
 * Armor Class and Hit Points, Immunity to Poison and Psychic damage, fails every saving throw, and is destroyed at 0 Hit
 * Points: a broken door or panel opens the way, and a broken net frees the creature it held.
 */

type Actor = GameState["actors"][number];

/** Every object's own immunities: "Objects have Immunity to Poison and Psychic damage." */
const ALWAYS_IMMUNE = ["poison", "psychic"] as const;

/** An object as the SRD prints it, at full Hit Points. */
export function objectFrom(print: ObjectPrint): ObjectStats {
  return { ...print, hitPoints: { current: print.hitPoints, maximum: print.hitPoints } };
}

/** An object the GM describes by substance and size, with the table's Armor Class and Hit Points. */
export function objectOf(
  name: string,
  substance: ObjectSubstance,
  size: ObjectSize,
  build: "fragile" | "resilient"
): ObjectStats {
  return objectFrom({
    name,
    armorClass: OBJECT_ARMOR_CLASS[substance],
    hitPoints: OBJECT_HIT_POINTS[size][build]
  });
}

export type ObjectDamage = Readonly<{
  /** What it takes, after its defences and its damage threshold. */
  total: number;
  /** Each part as its defences left it. */
  parts: ReadonlyArray<Readonly<{ type: string; amount: number; adjusted: number }>>;
  /** The whole instance fell short of its damage threshold. */
  belowThreshold: boolean;
}>;

/**
 * Damage one attack or effect deals an object: doubled first for a Siege Monster ("deals double damage to objects and
 * structures"), then through the object's immunities (Poison and Psychic always), resistances and vulnerabilities, and
 * none at all when the whole of it is below its damage threshold.
 */
export function weighObjectDamage(
  object: Pick<ObjectStats, "immunities" | "resistances" | "vulnerabilities" | "damageThreshold" | "immuneToAll">,
  parts: readonly DamagePart[],
  options: Readonly<{ siege?: boolean }> = {}
): ObjectDamage {
  if (object.immuneToAll) {
    return {
      total: 0,
      parts: parts.map((part) => ({ type: part.type, amount: part.amount, adjusted: 0 })),
      belowThreshold: false
    };
  }
  const doubled = options.siege ? parts.map((part) => ({ ...part, amount: part.amount * 2 })) : parts;
  const adjusted = adjustDamageParts(doubled, {
    immunities: [...ALWAYS_IMMUNE, ...(object.immunities ?? [])],
    resistances: object.resistances ?? [],
    vulnerabilities: object.vulnerabilities ?? []
  });
  const total = adjusted.reduce((sum, part) => sum + Math.max(0, part.adjusted), 0);
  const belowThreshold = object.damageThreshold !== undefined && total > 0 && total < object.damageThreshold;
  return {
    total: belowThreshold ? 0 : total,
    parts: adjusted.map((part) => ({
      type: normalizeDamageType(part.type),
      amount: part.amount,
      adjusted: part.adjusted
    })),
    belowThreshold
  };
}

/** Whether the oil a thrown flask left on an object is still wet: through its round in this fight, or its minute on the
 *  game clock. */
function oilStillWet(state: GameState, stats: ObjectStats): boolean {
  const until = stats.oiledUntil;
  if (!until) return false;
  if (state.combat.active && until.round !== undefined) return state.combat.round <= until.round;
  return until.minute !== undefined && clockMinutesOf(state) < until.minute;
}

/** A door the GM gave no statistics: a Medium, resilient wooden one (AC 15, 18 Hit Points). */
export const WOODEN_DOOR: ObjectStats = objectOf("Door", "wood", "medium", "resilient");

/** Where an object is: on a wall or door of the live map, or holding a creature as the effect it left. */
export type ObjectRef = Readonly<{ wallId: string }> | Readonly<{ actorId: string; effectId: string }>;

export type FoundObject = Readonly<{
  stats: ObjectStats;
  /** The wall it is, when it is one. */
  wall?: VisionWall;
  /** The creature it holds and the effect that holds it. */
  holding?: Readonly<{ actor: Actor; effect: EffectInstance }>;
}>;

/** The object a reference names on the live scene, or null when it is gone or isn't an object. */
export function findObject(state: GameState, ref: ObjectRef): FoundObject | null {
  if ("wallId" in ref) {
    const wall = state.combat.vision.walls.find((candidate) => candidate.id === ref.wallId);
    if (wall && !wall.object && wall.kind === "door") return { stats: WOODEN_DOOR, wall };
    return wall?.object ? { stats: wall.object, wall } : null;
  }
  const actor = state.actors.find((candidate) => candidate.id === ref.actorId);
  const effect = actor?.effects.find((candidate) => candidate.id === ref.effectId);
  return actor && effect?.heldBy ? { stats: effect.heldBy, holding: { actor, effect } } : null;
}

export type ObjectHit = Readonly<{
  name: string;
  damage: ObjectDamage;
  hitPointsLeft: number;
  destroyed: boolean;
  events: EffectNarration[];
}>;

/**
 * Deals typed damage to an object and breaks it at 0 Hit Points: a wall or door is gone from the map, which opens the
 * way for sight and movement, and what held a creature lets it go (its effect ends).
 */
export function damageObject(
  state: GameState,
  ref: ObjectRef,
  parts: readonly DamagePart[],
  options: Readonly<{ siege?: boolean }> = {}
): ObjectHit {
  const found = findObject(state, ref);
  if (!found) throw new CommandRejectedError("That object is no longer there.");
  // SRD Oil: "If the target takes Fire damage before the oil dries (after 1 minute), the target takes an extra 5 Fire
  // damage from burning oil." The oil burns off as it does.
  const oiled = oilStillWet(state, found.stats);
  const burning = oiled && parts.some((part) => part.amount > 0 && part.type.trim().toLowerCase() === "fire");
  const damage = weighObjectDamage(found.stats, burning ? [...parts, { amount: 5, type: "fire" }] : parts, options);
  const left = Math.max(0, found.stats.hitPoints.current - damage.total);
  const { oiledUntil: _oil, ...dry } = found.stats;
  const stats: ObjectStats = {
    ...(burning || !oiled ? dry : found.stats),
    hitPoints: { ...found.stats.hitPoints, current: left }
  };
  const destroyed = left === 0 && damage.total > 0;
  const events: EffectNarration[] = [];
  if (found.wall) {
    const walls = state.combat.vision.walls;
    state.combat = {
      ...state.combat,
      vision: {
        ...state.combat.vision,
        walls: destroyed
          ? walls.filter((wall) => wall.id !== found.wall!.id)
          : walls.map((wall) => (wall.id === found.wall!.id ? { ...wall, object: stats } : wall))
      }
    };
  } else if (found.holding) {
    const { actor, effect } = found.holding;
    if (destroyed) {
      events.push({
        kind: "effect",
        text: `${stats.name} is destroyed, and ${actor.name} is free.`,
        actorId: actor.id
      });
      events.push(...endEffectIfPresent(state, actor.id, effect.id));
    } else
      actor.effects = actor.effects.map((candidate) =>
        candidate.id === effect.id ? { ...candidate, heldBy: stats } : candidate
      );
  }
  return { name: stats.name, damage, hitPointsLeft: left, destroyed, events };
}

/** Sets or clears a wall's or door's statistics as an object (the GM's), keeping its damage when only the numbers
 *  change. */
export function setWallObject(state: GameState, wallId: string, object: ObjectStats | null): void {
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === wallId);
  if (!wall) throw new CommandRejectedError("That wall is no longer there.");
  const next: VisionWall = { ...wall };
  if (object === null) delete next.object;
  else
    next.object = {
      ...object,
      hitPoints: {
        maximum: object.hitPoints.maximum,
        current: Math.min(object.hitPoints.current, object.hitPoints.maximum)
      }
    };
  state.combat = {
    ...state.combat,
    vision: {
      ...state.combat.vision,
      walls: state.combat.vision.walls.map((candidate) => (candidate.id === wallId ? next : candidate))
    }
  };
}
