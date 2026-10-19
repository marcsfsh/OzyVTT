import type { GameState, VisionArea, VisionLight, VisionSource } from "@vtt/domain";
import type { SightEffect } from "@vtt/schemas";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "../effects.js";
import { resolveAreas, sourceLive, templateCentre } from "./areas.js";
import { blocks, distance, distanceToSegment, insidePolygon, type Point, type Segment } from "./geometry.js";

/**
 * The lights and areas a spell or an action leaves on the map (Light, Daylight, Dancing Lights, Darkness, Fog Cloud,
 * a darkmantle's Darkness Aura), each tied to what keeps it: the caster's Concentration, the effect its cast leaves on
 * the caster, or a number of rounds. When that ends, so does the light or the area, and a later spell may dispel it
 * (Darkness dispels spell light of level 2 or lower that it overlaps; Daylight, Darkness of level 3 or lower).
 */

/** A uuid made from a command id and a salt, the same on every retry of the command. */
export function derivedUuid(base: string, salt: string): string {
  const hex = (seed: number) => {
    let hash = seed >>> 0;
    for (const character of `${base}|${salt}`) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  const digits = `${hex(0x811c9dc5)}${hex(0x9e3779b9)}${hex(0x85ebca6b)}${hex(0xc2b2ae35)}`;
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4${digits.slice(13, 16)}-8${digits.slice(17, 20)}-${digits.slice(20, 32)}`;
}

/** Drops the live scene's lights and areas whose cast, effect or rounds have ended, or whose placed area is gone. Runs
 *  after every command. */
export function pruneEndedSight(state: GameState): void {
  const vision = state.combat.vision;
  if (vision.lights.length === 0 && vision.areas.length === 0) return;
  const annotations = new Set(state.combat.annotations.map((annotation) => annotation.id));
  const lights = vision.lights.filter(
    (light) =>
      sourceLive(state, light.source) && (light.annotationId === undefined || annotations.has(light.annotationId))
  );
  const areas = vision.areas.filter(
    (area) =>
      sourceLive(state, area.source) && (area.shape.type !== "template" || annotations.has(area.shape.annotationId))
  );
  if (lights.length === vision.lights.length && areas.length === vision.areas.length) return;
  state.combat = { ...state.combat, vision: { ...vision, lights, areas } };
}

export type CastSightInput = Readonly<{
  /** The command that cast it: the ids of what it makes derive from it, and its placed template has it as its id. */
  commandId: string;
  casterId: string;
  sight: SightEffect;
  spellId?: string;
  /** The action that made it when no spell did, so using it again replaces or puts out the last. */
  actionId?: string;
  level?: number;
  /** The caster's Concentration on this cast, or the effect the cast leaves on its caster, that keeps it. */
  castId?: string | null;
  effectId?: string | null;
  targetIds: readonly string[];
  /** The cast placed its area on the map as an annotation with the command's id. */
  areaPlaced: boolean;
  /** The area's line width, for a Line template. */
  widthFeet?: number | null;
  /** A ringed wall's thickness: the area is the circle's edge alone (Wall of Fire's ring). */
  ringFeet?: number;
}>;

/**
 * Puts a cast's light and area on the live scene, ending the same caster's earlier cast of the same spell first
 * ("casting it again ends the earlier"), then dispels the spell light or Darkness it overlaps. Returns what it
 * dispelled, for the table.
 */
export function applyCastSight(state: GameState, input: CastSightInput): EffectNarration[] {
  const { sight, commandId, casterId } = input;
  const vision = state.combat.vision;
  const casterAt = state.combat.tokens.find((token) => token.actorId === casterId)?.position ?? null;
  const source: VisionSource = {
    casterId,
    ...(input.spellId !== undefined ? { spellId: input.spellId } : {}),
    ...(input.spellId === undefined && input.actionId !== undefined ? { actionId: input.actionId } : {}),
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.castId ? { castId: input.castId } : {}),
    ...(input.effectId ? { effectId: input.effectId } : {}),
    ...(sight.rounds !== undefined && state.combat.active ? { untilRound: state.combat.round + sight.rounds - 1 } : {})
  };
  const earlier = (made: Readonly<{ source?: VisionSource }>) =>
    made.source?.casterId === casterId &&
    (input.spellId !== undefined
      ? made.source.spellId === input.spellId
      : input.actionId !== undefined && made.source.actionId === input.actionId);
  let lights = vision.lights.filter((light) => !earlier(light));
  let areas = vision.areas.filter((area) => !earlier(area));
  // A second use of a toggle puts out what the first made.
  if (sight.toggles && (lights.length < vision.lights.length || areas.length < vision.areas.length)) {
    state.combat = { ...state.combat, vision: { ...vision, lights, areas } };
    return [];
  }

  const made: VisionLight[] = [];
  const light = sight.light;
  if (light) {
    const radii = {
      brightFeet: light.brightFeet,
      dimFeet: light.dimFeet,
      ...(light.sunlight ? { sunlight: true as const } : {}),
      source
    };
    const carriedBy = (actorId: string, salt: string): VisionLight => ({
      id: derivedUuid(commandId, salt),
      position: null,
      actorId,
      ...radii
    });
    const placedAt = (at: Point, salt: string): VisionLight => ({
      id: derivedUuid(commandId, salt),
      position: { x: Math.max(0, at.x), y: Math.max(0, at.y) },
      actorId: null,
      ...radii
    });
    if (light.on === "caster") made.push(carriedBy(casterId, "light"));
    else if (light.on === "targets") {
      const carriers = input.targetIds.length > 0 ? input.targetIds : [casterId];
      carriers.forEach((actorId, index) => made.push(carriedBy(actorId, `light-${index}`)));
    } else if (light.on === "area" && input.areaPlaced)
      made.push({
        id: derivedUuid(commandId, "light"),
        position: null,
        actorId: null,
        annotationId: commandId,
        ...radii
      });
    else if (casterAt) {
      // Set down beside the caster, a little apart, for the GM or its player to move.
      const count = light.on === "point" ? (light.count ?? 1) : 1;
      const step = 20;
      for (let index = 0; index < count; index++) {
        const angle = (2 * Math.PI * index) / count;
        const offset = count === 1 ? 0 : step;
        made.push(
          placedAt(
            { x: casterAt.x + offset * Math.cos(angle), y: casterAt.y + offset * Math.sin(angle) },
            `light-${index}`
          )
        );
      }
    }
  }
  lights = [...lights, ...made].slice(-100);

  const area = sight.area;
  if (area) {
    let shape: VisionArea["shape"] | null = null;
    if (area.aroundSelfFeet !== undefined)
      shape = { type: "emanation", actorId: casterId, radiusFeet: area.aroundSelfFeet };
    else if (input.areaPlaced)
      shape = {
        type: "template",
        annotationId: commandId,
        widthFeet: input.widthFeet ?? null,
        ...(input.ringFeet !== undefined ? { ringFeet: input.ringFeet } : {})
      };
    if (shape) {
      const made: VisionArea = {
        id: derivedUuid(commandId, "area"),
        kind: area.kind,
        shape,
        ...(area.sparesUser ? { sparedActorId: casterId } : {}),
        ...(area.dispersedBy ? { dispersedBy: [...area.dispersedBy] } : {}),
        source
      };
      areas = [...areas, made].slice(-100);
    }
  }
  state.combat = { ...state.combat, vision: { ...vision, lights, areas } };
  return sight.dispels ? dispelOverlapping(state, input, sight.dispels) : [];
}

/** A spell area that clears the fog and clouds it overlaps while it stands (Gust of Wind's Line, Destroy Water's Cube),
 *  measured on the map's own scale so it works whether or not the scene's vision is on. Ends each spell whose fog it
 *  clears. */
export function dispelFogUnder(
  state: GameState,
  input: Readonly<{
    annotationId: string;
    casterId: string;
    spellId: string;
    widthFeet: number | null;
    pixelsPerFoot: number;
    by: "wind" | "water";
  }>
): EffectNarration[] {
  return dispelOverlapping(
    state,
    {
      commandId: input.annotationId,
      casterId: input.casterId,
      sight: {},
      spellId: input.spellId,
      targetIds: [],
      areaPlaced: true,
      widthFeet: input.widthFeet
    },
    { kind: "fog" },
    input.pixelsPerFoot,
    input.by
  );
}

/** A shape on the map: a circle of light, or an area's outline. */
type Shape = Readonly<{ circle: Readonly<{ at: Point; radius: number }> } | { outline: readonly Point[] }>;

const edgesOfOutline = (outline: readonly Point[]): Segment[] =>
  outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length]!;
    return { ax: point.x, ay: point.y, bx: next.x, by: next.y };
  });

/** Whether two shapes share any of the map. */
function overlap(a: Shape, b: Shape): boolean {
  if ("circle" in a && "circle" in b) return distance(a.circle.at, b.circle.at) < a.circle.radius + b.circle.radius;
  if ("circle" in a || "circle" in b) {
    const circle = "circle" in a ? a.circle : (b as { circle: { at: Point; radius: number } }).circle;
    const outline = "outline" in a ? a.outline : (b as { outline: readonly Point[] }).outline;
    return (
      insidePolygon(circle.at, outline) ||
      edgesOfOutline(outline).some((edge) => distanceToSegment(circle.at, edge) < circle.radius)
    );
  }
  const left = (a as { outline: readonly Point[] }).outline;
  const right = (b as { outline: readonly Point[] }).outline;
  return (
    left.some((point) => insidePolygon(point, right)) ||
    right.some((point) => insidePolygon(point, left)) ||
    edgesOfOutline(left).some((edge) =>
      edgesOfOutline(right).some((other) => blocks(edge, { x: other.ax, y: other.ay }, { x: other.bx, y: other.by }))
    )
  );
}

function lightPosition(state: GameState, light: VisionLight): Point | null {
  if (light.position) return light.position;
  if (light.actorId) return state.combat.tokens.find((token) => token.actorId === light.actorId)?.position ?? null;
  const annotation = state.combat.annotations.find((entry) => entry.id === light.annotationId);
  return annotation ? templateCentre(annotation) : null;
}

/** What a dispelling cast covers: the area it placed, else its light's Bright Light. */
function reachOf(state: GameState, input: CastSightInput, pixelsPerFoot: number): Shape[] {
  const vision = state.combat.vision;
  const placed: VisionArea[] = input.areaPlaced
    ? [
        {
          id: derivedUuid(input.commandId, "reach"),
          kind: "dim",
          shape: { type: "template", annotationId: input.commandId, widthFeet: input.widthFeet ?? null }
        }
      ]
    : vision.areas.filter((area) => area.id === derivedUuid(input.commandId, "area"));
  const shapes: Shape[] = resolveAreas(placed, state.combat, pixelsPerFoot).map((area) => ({ outline: area.outline }));
  const own = new Set(
    ["light", "light-0", "light-1", "light-2", "light-3"].map((salt) => derivedUuid(input.commandId, salt))
  );
  for (const light of vision.lights) {
    if (!own.has(light.id)) continue;
    const at = lightPosition(state, light);
    if (at && light.brightFeet > 0) shapes.push({ circle: { at, radius: light.brightFeet * pixelsPerFoot } });
  }
  return shapes;
}

/** Ends the spell that made a dispelled light or Darkness: its Concentration, or the effect that keeps it. */
function endSpellOf(state: GameState, source: VisionSource): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors)
    for (const effect of [...actor.effects]) {
      const sustains =
        (source.castId !== undefined && effect.castId === source.castId && effect.tags.includes(CONCENTRATING_TAG)) ||
        (source.effectId !== undefined && effect.id === source.effectId);
      if (sustains) events.push(...endEffectIfPresent(state, actor.id, effect.id));
    }
  return events;
}

/** Dispels the spell light, Darkness or fog of a low enough level that the cast overlaps ("If any of this spell's area
 *  overlaps with an area of Bright Light or Dim Light created by a spell of level 2 or lower, the spell that created
 *  the light is dispelled"), ending the spell that made it. */
function dispelOverlapping(
  state: GameState,
  input: CastSightInput,
  dispels: NonNullable<SightEffect["dispels"]>,
  scale?: number,
  /** What clears fog: a strong wind (Gust of Wind), or water that destroys fog (Destroy Water). */
  by: "wind" | "water" = "wind"
): EffectNarration[] {
  const pixelsPerFoot = scale ?? state.combat.vision.measure?.pixelsPerFoot;
  if (!pixelsPerFoot) return [];
  const reach = reachOf(state, input, pixelsPerFoot);
  if (reach.length === 0) return [];
  const dispellable = (source: VisionSource | undefined): source is VisionSource =>
    source !== undefined &&
    source.spellId !== undefined &&
    !(source.casterId === input.casterId && source.spellId === input.spellId) &&
    (dispels.upToLevel === undefined || (source.level ?? 0) <= dispels.upToLevel);
  const vision = state.combat.vision;
  const ended: VisionSource[] = [];
  const keep = (source: VisionSource | undefined, shape: Shape | null) => {
    if (!dispellable(source) || shape === null || !reach.some((own) => overlap(own, shape))) return true;
    ended.push(source);
    return false;
  };
  const lights =
    dispels.kind === "light"
      ? vision.lights.filter((light) => {
          const at = lightPosition(state, light);
          const radius = (light.brightFeet + light.dimFeet) * pixelsPerFoot;
          return keep(light.source, at ? { circle: { at, radius } } : null);
        })
      : vision.lights;
  const resolved = new Map(resolveAreas(vision.areas, state.combat, pixelsPerFoot).map((area) => [area.id, area]));
  const areas = vision.areas.filter((area) => {
    // Only fog and clouds clear; an opaque wall or sleet stands in the wind.
    const gone =
      (dispels.kind === "darkness" && area.kind === "magical-darkness") ||
      (dispels.kind === "fog" && area.dispersedBy?.includes(by) === true);
    const shape = resolved.get(area.id);
    return !gone || keep(area.source, shape ? { outline: shape.outline } : null);
  });
  state.combat = { ...state.combat, vision: { ...vision, lights, areas } };
  // A dispelled spell ends whole: what else it made goes with it.
  const events = ended.flatMap((source) => endSpellOf(state, source));
  pruneEndedSight(state);
  return events;
}
