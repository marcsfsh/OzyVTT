import type { AnnotationPoint, AnnotationShapeKind, GameState } from "@vtt/domain";
import type { ActionArea } from "@vtt/schemas";
import { shapeGeometry, templateOfArea } from "./annotations.js";
import { tokensInTemplate } from "./area-targeting.js";
import { areaOriginHeight, creatureAtPoint, withinAreaHeight } from "./altitude.js";
import { CommandRejectedError } from "./game-store.js";
import { DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import type { TokenMapGeometry } from "./token-placement.js";

type Template = Readonly<{ shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }>;

/**
 * SRD 5.2.1 casts that place several areas at once: Fire Storm ("up to ten 10-foot Cubes, which you arrange as you like.
 * Each Cube must be contiguous with at least one other Cube") and Meteor Swarm ("four different points you can see
 * within range ... A creature in the area of more than one fiery explosion is affected only once"). Each template is
 * placed as the action's area makes it, no more than its `count`, each at a different point within the spell's range,
 * and touching another where the area says so. Who they catch is everyone under any of them, each once.
 */

/** The point a placed template is aimed at: a Sphere's centre, a Cube's middle. */
function aimOf(template: Template): AnnotationPoint {
  return template.shape === "square"
    ? { x: (template.origin.x + template.target.x) / 2, y: (template.origin.y + template.target.y) / 2 }
    : template.origin;
}

/** Two squares that share a stretch of edge or overlap (not only a corner). */
function touching(a: Template, b: Template): boolean {
  const box = (t: Template) => ({
    left: Math.min(t.origin.x, t.target.x),
    right: Math.max(t.origin.x, t.target.x),
    top: Math.min(t.origin.y, t.target.y),
    bottom: Math.max(t.origin.y, t.target.y)
  });
  const one = box(a);
  const two = box(b);
  const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
  const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
  return across >= -0.5 && down >= -0.5 && Math.max(across, down) > 0.5;
}

/**
 * Places the templates of one use and finds who they catch. Refuses more areas than the action makes, two at one point,
 * one beyond the spell's range from its caster, and a Cube touching no other where the area asks it to.
 */
export function placeTemplates(
  state: GameState,
  input: Readonly<{
    casterId: string;
    actionName: string;
    area: ActionArea;
    templates: readonly Template[];
    /** The spell's range in feet; null when it names none the map can measure. */
    rangeFeet: number | null;
    geometry: TokenMapGeometry;
  }>
): Readonly<{ placed: readonly Template[]; targetIds: string[] }> {
  const { area, templates, geometry, actionName } = input;
  const calibration = geometry.calibration;
  if (!calibration) throw new CommandRejectedError("Calibrate this map before placing an area template.");
  const most = area.count ?? 1;
  const noun = area.shape === "cube" ? "Cube" : area.shape === "sphere" ? "Sphere" : "area";
  if (templates.length > most)
    throw new CommandRejectedError(
      most === 1
        ? `${actionName} places one area.`
        : `${actionName} places up to ${most} ${noun}s, and ${templates.length} were placed.`
    );
  // As the table draws each one, and as it covers the grid.
  const placed = templates.map((template) => templateOfArea(calibration, template, area));
  const covers = placed.map((made) => ({
    shape: made.shape,
    ...shapeGeometry(calibration, made.shape, made.origin, made.target)
  }));
  const aims = covers.map(aimOf);
  if (aims.some((aim, index) => aims.findIndex((other) => other.x === aim.x && other.y === aim.y) !== index))
    throw new CommandRejectedError(`Each of ${actionName}'s ${noun}s goes at a different point.`);
  const caster = state.combat.tokens.find((token) => token.actorId === input.casterId)?.position;
  if (input.rangeFeet !== null && caster)
    for (const aim of aims) {
      const apart = mapDistance(geometry, caster, aim)?.value ?? null;
      if (apart !== null && apart > input.rangeFeet + DISTANCE_TOLERANCE_FEET)
        throw new CommandRejectedError(`Each of ${actionName}'s ${noun}s goes within ${input.rangeFeet} feet.`);
    }
  if (area.contiguous && covers.length > 1)
    covers.forEach((template, index) => {
      if (!covers.some((other, at) => at !== index && touching(template, other)))
        throw new CommandRejectedError(`Each of ${actionName}'s ${noun}s must touch at least one other.`);
    });
  const caught: string[] = [];
  for (const template of covers) {
    const under = tokensInTemplate(state, calibration, template, template.shape, area.widthFeet).filter(
      (id) =>
        id !== input.casterId && (!state.combat.active || state.combat.initiative.some((entry) => entry.actorId === id))
    );
    // Height: each area reaches up and down only as far as its shape does.
    const within = withinAreaHeight(
      state,
      under,
      area,
      areaOriginHeight(
        state,
        input.casterId,
        false,
        creatureAtPoint(state, calibration, aimOf(template)),
        calibration.distancePerCell
      ),
      () => null,
      calibration.distancePerCell
    );
    for (const id of within) if (!caught.includes(id)) caught.push(id);
  }
  return { placed, targetIds: caught };
}
