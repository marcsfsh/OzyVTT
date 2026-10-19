import type { SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { RulesBlockedError } from "./game-store.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideWaives,
  rulesInForce,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, typeOf, type ZoneDeps } from "./spell-zones.js";

/**
 * The barriers a spell's area raises at its edge (SRD 5.2.1): Antilife Shell "prevents creatures other than Constructs
 * and Undead from passing or reaching through it", a Magic Circle's chosen creatures "can't willingly enter the
 * Cylinder by nonmagical means", and "creatures can't teleport into" Forbiddance's ward. A barred step closes the path
 * the movement cost finds, so a walk goes round the area and a move into it is refused as a shut path; a teleport and
 * a melee attack across the edge are refused by their own checks.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;
type Bars = NonNullable<ZoneTrigger["bars"]>;

/** Whether a barrier holds this creature back: the types it names, or every type but the ones it lets through, of the
 *  sizes it names and in the air when it says so. */
function heldBack(
  bars: Bars,
  type: string | null,
  creature?: Readonly<{ size: string | undefined; flying: boolean }>
): boolean {
  if (bars.sizes && !bars.sizes.some((size) => size === (creature?.size ?? "medium"))) return false;
  if (bars.flying && !creature?.flying) return false;
  if (bars.types) return type !== null && bars.types.includes(type);
  if (bars.except) return type === null || !bars.except.includes(type);
  return true;
}

/** The standing barriers and the inside test of each, for this creature. */
function barriersFor(
  state: GameState,
  creature: Actor,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
) {
  const type = typeOf(creature, deps);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === creature.id);
  const body = { size: creature.size, flying: token?.airborne !== undefined };
  return liveZones(state).flatMap((zone) => {
    const content = zoneContentOf(zone, deps.catalog);
    const bars = content?.trigger.bars;
    // The caster of an Emanation carries it; its own shell doesn't hold it.
    if (!content || !bars || !heldBack(bars, type, body)) return [];
    if (content.trigger.around === "caster" && zone.casterId === creature.id) return [];
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    return inside ? [{ zone, bars, inside }] : [];
  });
}

/** A step from one position to the next that a barrier bars the mover from taking, as the movement cost's test; null
 *  when no barrier holds it back. */
export function barredStepFor(
  state: GameState,
  moverId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): ((from: Point, to: Point, sizeCells: number) => boolean) | null {
  const mover = state.actors.find((actor) => actor.id === moverId);
  if (!mover) return null;
  const barriers = barriersFor(state, mover, deps);
  if (barriers.length === 0) return null;
  return (from, to, sizeCells) =>
    barriers.some(({ bars, inside }) => {
      const was = inside(from, sizeCells);
      const is = inside(to, sizeCells);
      return bars.way === "both" ? was !== is : !was && is;
    });
}

/** A barrier's rule through the table's rules mode: strict refuses (unless the GM's override waives it, or one this
 *  turn covers it), assisted lets it through as the note returned, freeform says nothing. */
export function policeBarrier(
  state: GameState,
  override: RulesOverride | null,
  rule: RuleId,
  message: string
): string | null {
  const mode = effectiveModeFor(rulesInForce(state), rule);
  if (mode === "freeform" || overrideWaives(override, rule)) return null;
  if (mode === "strict" && !overrideCovers(state.combat.turn, rule)) throw new RulesBlockedError(rule, message);
  return message;
}

/**
 * SRD Globe of Invulnerability: "Any spell of level 5 or lower cast from outside the barrier can't affect anything within
 * it", one level higher for each slot level above 6. The creatures among `targetIds` such a barrier keeps a spell cast
 * at `castLevel` by `casterId` from, with the barrier's name.
 */
export function spellWardedTargets(
  state: GameState,
  input: Readonly<{ casterId: string; castLevel: number; targetIds: readonly string[] }>,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): Array<Readonly<{ actorId: string; ward: string }>> {
  const warded: Array<Readonly<{ actorId: string; ward: string }>> = [];
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    const wards = content?.trigger.wardsSpells;
    if (!content || wards === undefined) continue;
    if (input.castLevel > wards + Math.max(0, zone.level - (content.spell?.level ?? zone.level))) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!inside) continue;
    const within = (actorId: string) => {
      const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
      return token?.position ? inside(token.position, token.sizeCells) : false;
    };
    // Cast from inside, the barrier is no barrier.
    if (within(input.casterId)) continue;
    for (const actorId of input.targetIds)
      if (within(actorId) && !warded.some((entry) => entry.actorId === actorId))
        warded.push({ actorId, ward: zone.name });
  }
  return warded;
}

/** The area a teleport may not end in (Forbiddance), by name, or null. */
export function teleportBarredAt(
  state: GameState,
  to: Point,
  sizeCells: number,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): string | null {
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content?.trigger.noTeleport) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (inside?.(to, sizeCells)) return zone.name;
  }
  return null;
}

/**
 * SRD Antilife Shell: an affected creature "can cast spells or make attacks with Ranged or Reach weapons through the
 * barrier", and nothing else reaches through it. Why a melee attack can't reach a target across such an Emanation's edge
 * (one inside it and the other out), or null. Measured from the shell's caster, as an Emanation is.
 */
export function reachBarredBy(
  state: GameState,
  attacker: Actor,
  action: Pick<ActorAction, "attack" | "spellId">,
  targets: readonly Actor[],
  deps: Readonly<{
    resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
    distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  }>
): string | null {
  const attack = action.attack;
  // A ranged attack, a Reach weapon and a spell go through.
  if (!attack || attack.rangeFeet !== undefined || (attack.reachFeet ?? 5) > 5 || action.spellId !== undefined)
    return null;
  if (!deps.distanceFeet || !deps.resolveDefinition) return null;
  const type = typeOf(attacker, { resolveDefinition: deps.resolveDefinition });
  for (const zone of liveZones(state)) {
    const trigger = zoneContentOf(zone, deps.catalog)?.trigger;
    if (!trigger?.bars?.reach || trigger.around !== "caster" || !heldBack(trigger.bars, type)) continue;
    const reach = trigger.feet ?? 5;
    const within = (actorId: string) => {
      if (actorId === zone.casterId) return true;
      const apart = deps.distanceFeet!(zone.casterId, actorId);
      return apart !== null && apart <= reach + DISTANCE_TOLERANCE_FEET;
    };
    const across = targets.find((target) => within(target.id) !== within(attacker.id));
    if (across) return `${attacker.name} can't reach through ${zone.name} to ${across.name}.`;
  }
  return null;
}

/**
 * SRD Antilife Shell: "If you move so that an affected creature is forced to pass through the barrier, the spell ends."
 * Its caster's move that sweeps the Emanation's edge across a creature it holds back ends the caster's Concentration on
 * it. `path` is where the caster went.
 */
export function shellsForcedBy(
  state: GameState,
  casterId: string,
  path: readonly Point[],
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (path.length < 2) return events;
  for (const zone of liveZones(state)) {
    if (zone.casterId !== casterId || zone.castId === null) continue;
    const content = zoneContentOf(zone, deps.catalog);
    const bars = content?.trigger.bars;
    if (!content || !bars || content.trigger.around !== "caster") continue;
    const crossed = state.actors.some((creature) => {
      const token = state.combat.tokens.find((candidate) => candidate.actorId === creature.id);
      if (creature.id === casterId || !token?.position || !heldBack(bars, typeOf(creature, deps))) return false;
      const sides = path.map((point) =>
        insideTest(state, zone, content.trigger, content, deps.geometry, point)?.(token.position!, token.sizeCells)
      );
      return sides.some((side) => side !== sides[0]);
    });
    if (!crossed) continue;
    const caster = state.actors.find((actor) => actor.id === casterId);
    const concentration = caster?.effects.find(
      (effect) => effect.castId === zone.castId && effect.tags.includes(CONCENTRATING_TAG)
    );
    events.push({
      kind: "effect",
      text: `${zone.name} ends: its barrier was forced through a creature.`,
      actorId: casterId
    });
    if (concentration) events.push(...endEffectIfPresent(state, casterId, concentration.id));
  }
  return events;
}
