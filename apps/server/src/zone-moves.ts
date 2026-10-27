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

type MovesArea = NonNullable<NonNullable<ReturnType<typeof laterRowOf>>["movesArea"]>;

/** How far a later action of a spell moves the spell's area, and on what terms, or null when it moves none. */
export function areaMoveOf(
  action: Pick<ActorAction, "id" | "spellId">,
  catalog: Pick<EquipmentCatalog, "spellRecord"> | undefined
): Readonly<{ spell: SpellReference; feet: number; fromCaster: boolean; terms: MovesArea }> | null {
  const spell = action.spellId ? catalog?.spellRecord?.(action.spellId) : undefined;
  const moves = spell ? laterRowOf(spell, action.id)?.movesArea : undefined;
  return spell && moves !== undefined
    ? { spell, feet: moves.feet, fromCaster: moves.fromCaster === true, terms: moves }
    : null;
}

/** The `turnUses` key a move that goes with its caster's own leaves, so it is taken once a turn. */
const withMoveKey = (casterId: string, spellId: string) => `${casterId}:moves-with:${spellId}`;

/** Why a move on these terms can't be made now, or null: one that goes with its caster's move needs the caster to have
 *  moved on its own turn, once a turn. */
function movesWithCaster(state: GameState, casterId: string, spell: SpellReference): string | null {
  const combat = state.combat;
  if (!combat.active || !combat.initiative.some((entry) => entry.actorId === casterId)) return null;
  if (combat.turnActorId !== casterId) return `${spell.name}'s area moves only on its caster's turn.`;
  if (combat.turn.movementUsedFeet <= 0) return `${spell.name}'s area moves when its caster moves. Move first.`;
  if ((combat.turn.turnUses[withMoveKey(casterId, spell.id)] ?? 0) > 0)
    return `${spell.name}'s area has already moved this turn.`;
  return null;
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
    fromCaster?: boolean;
    /** The rest of the spell's terms for the move (`movesArea`). */
    terms?: MovesArea;
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
  const terms = input.terms;
  const snapped = shapeGeometry(calibration, input.placed.shape, input.placed.origin, input.placed.target);
  // An area placed again from its caster (Gust of Wind's Line, turned) starts where the caster stands now.
  const caster = state.combat.tokens.find((token) => token.actorId === input.casterId)?.position;
  const fromCaster = input.fromCaster === true && caster !== undefined && caster !== null;
  const apart = (from: AnnotationPoint, to: AnnotationPoint) => mapDistance(geometry, from, to)?.value ?? 0;
  const notes: Array<string | null> = [];
  const refuse = (rule: Parameters<typeof policeBarrier>[2], message: string) =>
    notes.push(policeBarrier(state, input.override, rule, message));
  // A move that goes with its caster's own (Conjure Animals' pack) waits for the caster to move, once a turn.
  const waits = terms?.withCasterMove ? movesWithCaster(state, input.casterId, input.spell) : null;
  if (waits) refuse("economy.not-your-turn", waits);
  if (terms?.steersDrift) {
    // A steered drift (Incendiary Cloud): from where the cloud stood as its caster's turn began, the full distance,
    // ending farther from the caster.
    const from = zone.driftFrom;
    if (!from) throw new CommandRejectedError(`${input.spell.name} drifts at the start of its caster's turn.`);
    const moved = apart(from.origin, snapped.origin);
    if (Math.abs(moved - input.feet) > calibration.distancePerCell / 2)
      refuse(
        "range.out-of-range",
        `${input.spell.name} drifts ${input.feet} feet; that move is ${Math.round(moved)} feet.`
      );
    // Away: any heading that takes it farther from the caster, measured straight (a grid's diagonal rule would call a
    // step sideways no farther).
    const straight = (point: AnnotationPoint) => (caster ? Math.hypot(point.x - caster.x, point.y - caster.y) : 0);
    if (caster && straight(snapped.origin) <= straight(from.origin) + 1)
      refuse("range.out-of-range", `${input.spell.name} drifts away from its caster.`);
  } else if (terms?.anywhereInRange && caster) {
    // An illusion goes to any spot within the spell's range of its caster (Silent Image, Major Image).
    const out = apart(caster, snapped.origin);
    if (out > input.feet + DISTANCE_TOLERANCE_FEET)
      refuse(
        "range.out-of-range",
        `${input.spell.name}'s area moves to a spot within ${input.feet} feet of its caster; that one is ${Math.round(out)} feet away.`
      );
    const now = apart(caster, area.geometry.origin);
    if (terms.casterInRange && now > input.feet + DISTANCE_TOLERANCE_FEET)
      refuse(
        "range.out-of-range",
        `${input.spell.name}'s caster must be within ${input.feet} feet of it to move it; it is ${Math.round(now)} feet away.`
      );
  } else {
    const moved = apart(fromCaster ? caster : area.geometry.origin, snapped.origin);
    if (fromCaster && moved > calibration.distancePerCell + DISTANCE_TOLERANCE_FEET)
      refuse(
        "range.out-of-range",
        `${input.spell.name}'s area starts at its caster; that one starts ${Math.round(moved)} feet away.`
      );
    else if (!fromCaster && moved > input.feet + DISTANCE_TOLERANCE_FEET)
      refuse(
        "range.out-of-range",
        `${input.spell.name}'s area moves up to ${input.feet} feet; that move is ${Math.round(moved)} feet.`
      );
  }
  // "To an unoccupied space": no creature's space covers the spot it moves to.
  if (terms?.unoccupied) {
    const taken = state.combat.tokens.find(
      (token) =>
        token.position !== null &&
        token.actorId !== input.casterId &&
        Math.abs(token.position.x - snapped.origin.x) < (calibration.cellSizePx * token.sizeCells) / 2 &&
        Math.abs(token.position.y - snapped.origin.y) < (calibration.cellSizePx * token.sizeCells) / 2
    );
    if (taken) refuse("movement.occupied", `${input.spell.name}'s area moves to an unoccupied space.`);
  }
  const note = notes.find((entry) => entry !== null) ?? null;
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
  deps: ZoneDeps & Readonly<{ geometry: TokenMapGeometry }>,
  terms?: MovesArea
): EffectNarration[] {
  const annotationId = move.zone.annotationId!;
  moveAnnotation(state, annotationId, placed.origin, placed.target, table, deps.geometry);
  // The drift is steered for this turn.
  if (terms?.steersDrift) delete move.zone.driftFrom;
  if (terms?.withCasterMove && state.combat.active) {
    const key = withMoveKey(move.zone.casterId, move.zone.spellId);
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
    };
  }
  return zonesAfterAreaMove(state, annotationId, move.before, deps);
}
