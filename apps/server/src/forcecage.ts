import type { GameState } from "@vtt/domain";
import { resolveSpellcasting, type ActorDefinition } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { rollSaveAtOnce } from "./saving-throws.js";

/**
 * SRD 5.2.1 Forcecage: "A creature inside the cage can't leave it by nonmagical means. If the creature tries to use
 * teleportation or interplanar travel to leave, it must first make a Charisma saving throw. On a success, the creature
 * can use that magic to exit the cage. On a failure, the creature doesn't exit the cage and wastes the use of the
 * teleportation spell or effect." The cage's bars already stop a walk; a teleport out of it takes the save, which the
 * server rolls against its caster's spell save DC.
 */

type Point = Readonly<{ x: number; y: number }>;

/** Each standing cage: its caster and the box its walls enclose. */
function cagesOf(
  state: GameState
): Array<Readonly<{ casterId: string; box: Readonly<Record<"x0" | "y0" | "x1" | "y1", number>> }>> {
  const groups = new Map<string, { casterId: string; points: Point[] }>();
  for (const wall of state.combat.vision.walls) {
    const source = wall.source;
    if (source?.spellId !== "forcecage") continue;
    const key = source.castId ?? source.effectId ?? source.casterId;
    const group = groups.get(key) ?? { casterId: source.casterId, points: [] };
    group.points.push(wall.a, wall.b);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ casterId, points }) => ({
    casterId,
    box: {
      x0: Math.min(...points.map((point) => point.x)),
      y0: Math.min(...points.map((point) => point.y)),
      x1: Math.max(...points.map((point) => point.x)),
      y1: Math.max(...points.map((point) => point.y))
    }
  }));
}

const within = (box: Readonly<Record<"x0" | "y0" | "x1" | "y1", number>>, point: Point) =>
  point.x > box.x0 && point.x < box.x1 && point.y > box.y0 && point.y < box.y1;

/** A teleport from inside a cage to outside it: the Charisma save against the caster's spell save DC, and on a failure
 *  the narration that keeps the creature in. Null when the teleport leaves no cage. */
export function teleportOutOfCage(
  state: GameState,
  moverId: string,
  from: Point,
  to: Point,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
    rollDie: (sides: number) => number;
  }>
): Readonly<{ held: boolean; events: EffectNarration[] }> | null {
  const cage = cagesOf(state).find(({ box }) => within(box, from) && !within(box, to));
  const mover = state.actors.find((actor) => actor.id === moverId);
  if (!cage || !mover) return null;
  const caster = state.actors.find((actor) => actor.id === cage.casterId);
  const definition = caster?.definitionId ? deps.resolveDefinition(caster.definitionId) : undefined;
  const dc = resolveSpellcasting(definition?.spellcasting)?.saveDc;
  if (dc === undefined)
    return {
      held: false,
      events: [
        {
          kind: "effect",
          text: `${mover.name} teleports out of the Forcecage. Its Charisma save is the GM's to roll.`,
          actorId: moverId
        }
      ]
    };
  const save = rollSaveAtOnce(state, mover, "cha", { ...deps, magical: true });
  const held = save.total < dc;
  return {
    held,
    events: [
      {
        kind: "effect",
        text: held
          ? `${mover.name} fails a DC ${dc} Charisma saving throw (${save.total}) and stays in the Forcecage. The teleport is wasted.`
          : `${mover.name} succeeds on a DC ${dc} Charisma saving throw (${save.total}) and teleports out of the Forcecage.`,
        actorId: moverId
      }
    ]
  };
}
