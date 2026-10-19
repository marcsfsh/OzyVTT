import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { AnnotationPoint, AnnotationShapeKind, GameState, SpellZone } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { moveAnnotation, shapeGeometry, type AnnotationActor } from "./annotations.js";
import { tokensInTemplate } from "./area-targeting.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { laterRowOf } from "./item-actions.js";
import { DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import type { RulesOverride } from "./rules-families.js";
import { liveZones, zonesAfterAreaMove, type ZoneDeps } from "./spell-zones.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { policeBarrier } from "./zone-barriers.js";

/**
 * Moving a spell's area with what the spell offers on later turns (SRD 5.2.1 Moonbeam: "On each of your later turns, you
 * can take a Magic action to move the Cylinder up to 60 feet"; Flaming Sphere: "As a Bonus Action, you can move the
 * sphere up to 30 feet. If you ram the sphere into a creature, that creature makes the save"). The action's template is
 * where the area goes: the area moves there if that is within the spell's reach of where it stood, the creatures it
 * moves onto make the action's save, and the area then acts on whoever it now covers as when it is dragged.
 */

type Placed = Readonly<{ shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }>;

/** How far a later action of a spell moves the spell's area, or null when it moves none. */
export function areaMoveOf(
  action: Pick<ActorAction, "id" | "spellId">,
  catalog: Pick<EquipmentCatalog, "spellRecord"> | undefined
): Readonly<{ spell: SpellReference; feet: number }> | null {
  const spell = action.spellId ? catalog?.spellRecord?.(action.spellId) : undefined;
  const feet = spell ? laterRowOf(spell, action.id)?.movesArea?.feet : undefined;
  return spell && feet !== undefined ? { spell, feet } : null;
}

export type AreaMove = Readonly<{
  zone: SpellZone;
  before: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
  /** The creatures the area moves onto, for the action's save. */
  movedOnto: readonly string[];
  /** A rules note let through by the table's rules mode. */
  note: string | null;
}>;

/**
 * Checks a move of the caster's area to `placed`: the area must stand on the map, and the move be no farther than the
 * spell allows (policed as a range rule, so the GM may allow it). Changes nothing.
 */
export function planAreaMove(
  state: GameState,
  input: Readonly<{
    casterId: string;
    spell: SpellReference;
    feet: number;
    placed: Placed;
    override: RulesOverride | null;
    widthFeet: number | null;
  }>,
  geometry: TokenMapGeometry
): AreaMove {
  const calibration = geometry.calibration!;
  const zone = liveZones(state).find(
    (candidate) => candidate.casterId === input.casterId && candidate.spellId === input.spell.id
  );
  const area = zone?.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  if (!zone || !area || area.shape === null)
    throw new CommandRejectedError(`${input.spell.name}'s area isn't on the map. Place it first.`);
  const snapped = shapeGeometry(calibration, input.placed.shape, input.placed.origin, input.placed.target);
  const moved = mapDistance(geometry, area.geometry.origin, snapped.origin)?.value ?? 0;
  const note =
    moved > input.feet + DISTANCE_TOLERANCE_FEET
      ? policeBarrier(
          state,
          input.override,
          "range.out-of-range",
          `${input.spell.name}'s area moves up to ${input.feet} feet; that move is ${Math.round(moved)} feet.`
        )
      : null;
  const before = new Set(tokensInTemplate(state, calibration, area.geometry, area.shape, input.widthFeet));
  const movedOnto = tokensInTemplate(state, calibration, snapped, area.shape, input.widthFeet).filter(
    (id) => !before.has(id) && id !== input.casterId
  );
  return { zone, before: { origin: area.geometry.origin, target: area.geometry.target }, movedOnto, note };
}

/** Moves the area as planned and lets it act on whoever it now covers. `table` is the GM's session, whose the area's
 *  shape is. */
export function moveArea(
  state: GameState,
  move: AreaMove,
  placed: Placed,
  table: AnnotationActor,
  deps: ZoneDeps & Readonly<{ geometry: TokenMapGeometry }>
): EffectNarration[] {
  const annotationId = move.zone.annotationId!;
  moveAnnotation(state, annotationId, placed.origin, placed.target, table, deps.geometry);
  return zonesAfterAreaMove(state, annotationId, move.before, deps);
}
