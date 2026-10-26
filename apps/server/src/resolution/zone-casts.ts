import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { SpellZone, VisionArea, VisionSource } from "@vtt/domain";
import type { AreaTrigger } from "@vtt/schemas";
import { CommandRejectedError } from "../game-store.js";
import { pickedZoneParts } from "../spell-zones.js";
import { derivedUuid } from "../vision/cast-sight.js";
import type { ResolveContext } from "./context.js";

/**
 * What a cast picks for the area it leaves and what the area places on the map as it is made (SRD 5.2.1): the creature
 * types a barrier wards (Magic Circle's "one or more of the following types", Hallow's ward), the properties it takes
 * (Private Sanctum's, Hallow's extra effect), a dome that must hold whole every creature in it (Tiny Hut), and the edge
 * sight can't pass and the light inside it.
 */

/** The width of the edge sight can't pass, in feet. */
const VEIL_FEET = 1;

/** The types a cast's barrier wards: those of the spell's types its caster named, or all of them. Throws on a type the
 *  spell doesn't offer. */
export function wardTypesOf(ctx: ResolveContext, trigger: AreaTrigger): string[] | undefined {
  const offered = trigger.bars?.types;
  if (!trigger.choosesTypes || !offered) return undefined;
  const asked = ctx.input.creatureTypes;
  if (!asked || asked.length === 0) return undefined;
  const wrong = asked.find((type) => !offered.includes(type as never));
  if (wrong) throw new CommandRejectedError(`${ctx.action.name} wards only ${offered.join(", ")}.`);
  return [...new Set(asked)];
}

/** The choices a cast makes for its zone: the types it wards and the parts it takes. */
export function zoneChoicesOf(
  ctx: ResolveContext,
  spell: SpellReference,
  trigger: AreaTrigger
): Pick<SpellZone, "wardTypes" | "parts"> {
  const wardTypes = wardTypesOf(ctx, trigger);
  const parts = trigger.picks ? pickedZoneParts(spell, ctx.input.option) : undefined;
  return { ...(wardTypes ? { wardTypes } : {}), ...(parts ? { parts } : {}) };
}

/**
 * SRD Tiny Hut: "The spell fails when you cast it if the Emanation isn't big enough to fully encapsulate all creatures in
 * its area." A barrier whose insiders pass it refuses the cast while a creature's space lies partly inside and partly
 * out, measured from the caster's space.
 */
export function refuseStraddlers(ctx: ResolveContext, trigger: AreaTrigger): void {
  if (!trigger.bars?.insiders || trigger.around !== "caster") return;
  const { state, attacker } = ctx;
  const caster = state.combat.tokens.find((token) => token.actorId === attacker.id && token.position !== null);
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot;
  if (!caster?.position || !pixelsPerFoot) return;
  const reach = ((trigger.feet ?? 5) + (5 * caster.sizeCells) / 2) * pixelsPerFoot;
  const cellPx = 5 * pixelsPerFoot;
  for (const token of state.combat.tokens) {
    if (!token.position || token.actorId === attacker.id) continue;
    const half = (cellPx * token.sizeCells) / 2 - 1;
    const corners = [-1, 1].flatMap((dx) =>
      [-1, 1].map((dy) => ({ x: token.position!.x + dx * half, y: token.position!.y + dy * half }))
    );
    const apart = corners.map((corner) => Math.hypot(corner.x - caster.position!.x, corner.y - caster.position!.y));
    const inside = apart.filter((distance) => distance <= reach).length;
    if (inside > 0 && inside < corners.length) {
      const name = state.actors.find((actor) => actor.id === token.actorId)?.name ?? "A creature";
      throw new CommandRejectedError(
        `${ctx.action.name} fails: the dome can't hold all of ${name}. Every creature in it must fit wholly inside.`
      );
    }
  }
}

/** SRD Hallow: "the spell fails if the radius includes an area already under the effect of Hallow". A circle placed
 *  over any of another standing area of the same spell refuses the cast. */
export function refuseOverlap(ctx: ResolveContext, spellId: string, trigger: AreaTrigger): void {
  const placed = ctx.input.placedArea;
  if (!trigger.exclusive || !placed || placed.shape !== "circle") return;
  const radius = Math.hypot(placed.target.x - placed.origin.x, placed.target.y - placed.origin.y);
  for (const zone of ctx.state.combat.spellZones) {
    if (zone.spellId !== spellId || zone.annotationId === null) continue;
    const area = ctx.state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
    if (!area || area.shape !== "circle") continue;
    const { origin, target } = area.geometry;
    const other = Math.hypot(target.x - origin.x, target.y - origin.y);
    if (Math.hypot(origin.x - placed.origin.x, origin.y - placed.origin.y) < radius + other)
      throw new CommandRejectedError(`${ctx.action.name} fails: its area takes in ground already under ${zone.name}.`);
  }
}

/** The edge sight can't pass (`veil`) and the light inside (`lighting`), placed with the zone and lasting as long as
 *  what keeps it. */
export function placeZoneSight(ctx: ResolveContext, zone: SpellZone, trigger: AreaTrigger): void {
  if (!trigger.veil && !trigger.lighting) return;
  const { state, attacker, input } = ctx;
  const vision = state.combat.vision;
  const pixelsPerFoot = vision.measure?.pixelsPerFoot;
  const caster = state.combat.tokens.find((token) => token.actorId === attacker.id && token.position !== null);
  const source: VisionSource = {
    casterId: attacker.id,
    spellId: zone.spellId,
    level: zone.level,
    ...(zone.castId !== null ? { castId: zone.castId } : {}),
    ...(zone.effectId !== undefined ? { effectId: zone.effectId } : {})
  };
  // An Emanation that stays where its caster stood is a circle round that point, out from the caster's space.
  const anchored =
    trigger.around === "caster" && zone.anchor && caster
      ? { x: zone.anchor.x, y: zone.anchor.y, radiusFeet: (trigger.feet ?? 5) + (5 * caster.sizeCells) / 2 }
      : null;
  const shape = (ringFeet?: number): VisionArea["shape"] | null =>
    anchored
      ? { type: "circle", ...anchored, ...(ringFeet !== undefined ? { ringFeet } : {}) }
      : zone.annotationId !== null && pixelsPerFoot
        ? {
            type: "template",
            annotationId: zone.annotationId,
            widthFeet: null,
            ...(ringFeet !== undefined ? { ringFeet } : {})
          }
        : null;
  const made: VisionArea[] = [];
  const veil = trigger.veil ? shape(VEIL_FEET) : null;
  if (veil)
    made.push({
      id: derivedUuid(input.commandId, "veil"),
      kind: "heavily-obscured",
      shape: veil,
      ...(trigger.veil?.oneWay ? { oneWay: true as const } : {}),
      source
    });
  const lit = trigger.lighting ? shape() : null;
  if (lit && trigger.lighting)
    made.push({
      id: derivedUuid(input.commandId, "lighting"),
      kind: trigger.lighting,
      shape: lit,
      ...(trigger.lightingFirm && trigger.lighting === "dark" ? { unlitBelow: Math.max(1, zone.level) } : {}),
      source
    });
  if (made.length === 0) return;
  state.combat = {
    ...state.combat,
    vision: {
      ...vision,
      areas: [...vision.areas.filter((area) => !made.some((one) => one.id === area.id)), ...made].slice(-100)
    }
  };
}
