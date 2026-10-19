import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import { douseFire } from "./hazards.js";
import { douseCarriedLights, exposedFlame, protectedFlame } from "./item-light.js";
import { endSpellZone } from "./spell-endings.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { endZoneAndItsSpell, insideTest, liveZones, type ZoneDeps } from "./spell-zones.js";
import { dispelFogUnder } from "./vision/cast-sight.js";
import { settleFire } from "./zone-fire.js";

/**
 * What a standing spell area does to fire, fog and clouds (SRD 5.2.1): Sleet Storm's "exposed flames in the area are
 * doused" and Create Water's rain "extinguishing exposed flames there"; Gust of Wind "disperses gas or vapor, and it
 * extinguishes candles and similar unprotected flames in the area", giving a lantern's protected flame "a 50 percent
 * chance to extinguish" it; Destroy Water destroys fog. A cloud a strong wind disperses (Cloudkill, Incendiary Cloud,
 * Stinking Cloud, Fog Cloud) ends with its spell. Settled after every command, from where the areas and creatures
 * stand, so a torch carried into the sleet goes out as it arrives; an area that acts once (Create or Destroy Water)
 * then ends.
 */

type Deps = Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog" | "rollDie" | "newId" | "now">;

/** Whether any standing area acts on fire, fog or clouds, or burns (Web), so settling is worth a look. */
export function holdsZoneOutcomes(state: GameState, catalog: Deps["catalog"]): boolean {
  return state.combat.spellZones.some((zone) => {
    const trigger = zoneContentOf(zone, catalog)?.trigger;
    return (
      zone.flammable === true ||
      trigger?.douses === true ||
      trigger?.wind === true ||
      trigger?.destroysFog === true ||
      trigger?.instant === true
    );
  });
}

const tokenOf = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId && token.position !== null);

/** Whether the cells of `other`'s area and this one's share any ground: a cell centre of the smaller box that both
 *  contain. */
function overlaps(
  state: GameState,
  one: Readonly<{ zone: SpellZone; inside: (point: { x: number; y: number }, sizeCells: number) => boolean }>,
  other: Readonly<{ zone: SpellZone; inside: (point: { x: number; y: number }, sizeCells: number) => boolean }>,
  cellPx: number
): boolean {
  const box = (zone: SpellZone) => {
    const area = state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
    if (!area) return null;
    const { origin, target } = area.geometry;
    const reach = Math.hypot(target.x - origin.x, target.y - origin.y);
    return { minX: origin.x - reach, maxX: origin.x + reach, minY: origin.y - reach, maxY: origin.y + reach };
  };
  const a = box(one.zone);
  const b = box(other.zone);
  if (!a || !b) return false;
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  for (let x = Math.floor(minX / cellPx) * cellPx + cellPx / 2; x <= maxX; x += cellPx)
    for (let y = Math.floor(minY / cellPx) * cellPx + cellPx / 2; y <= maxY; y += cellPx)
      if (one.inside({ x, y }, 1) && other.inside({ x, y }, 1)) return true;
  return false;
}

/** Puts out the fires and flames, disperses the clouds and clears the fog the standing areas reach. Returns the lines
 *  for the table. */
export function settleZoneOutcomes(state: GameState, deps: Deps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const calibration = deps.geometry?.calibration;
  if (!calibration) return events;
  const pixelsPerFoot = calibration.cellSizePx / calibration.distancePerCell;
  const placed = (zone: SpellZone) => {
    const content = zoneContentOf(zone, deps.catalog);
    const inside = content ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
    return content && inside ? { zone, content, inside } : null;
  };
  for (const zone of liveZones(state)) {
    const acting = placed(zone);
    if (!acting) continue;
    const { trigger, name } = acting.content;
    if (!trigger.douses && !trigger.wind && !trigger.destroysFog) continue;
    // The creatures standing in it, and the flames they carry.
    for (const creature of state.actors) {
      const token = tokenOf(state, creature.id);
      if (!token || !acting.inside(token.position!, token.sizeCells, token.altitudeFeet ?? 0)) continue;
      if (trigger.douses || trigger.wind) {
        events.push(...douseFire(state, creature, name));
        const tried = new Set(zone.windTried ?? []);
        const lines = douseCarriedLights(
          creature,
          deps.catalog,
          state.rest.clockHours,
          (light, row) => {
            if (exposedFlame(light)) return true;
            // A lantern in the wind: its 50 percent chance, once while it stays in the area.
            if (!trigger.wind || !protectedFlame(light)) return false;
            const key = `${creature.id}:${row.id}`;
            if (tried.has(key)) return false;
            tried.add(key);
            return deps.rollDie(2) === 1;
          },
          name
        );
        if (trigger.wind) zone.windTried = [...tried].slice(-200);
        events.push(...lines.map((text) => ({ kind: "effect" as const, text, actorId: creature.id })));
      }
    }
    // A wind disperses the clouds it reaches, and water destroys the fog.
    const by = trigger.wind ? "wind" : trigger.destroysFog ? "water" : null;
    if (by && zone.annotationId) {
      for (const other of liveZones(state)) {
        if (other.id === zone.id) continue;
        const cloud = placed(other);
        if (!cloud?.content.trigger.endsBy?.includes(by)) continue;
        if (!overlaps(state, acting, cloud, calibration.cellSizePx)) continue;
        events.push(
          {
            kind: "effect",
            text: `${name} ${by === "wind" ? "disperses" : "destroys"} ${cloud.content.name}.`,
            actorId: other.casterId
          },
          ...endSpellZone(state, other)
        );
      }
      events.push(
        ...dispelFogUnder(state, {
          annotationId: zone.annotationId,
          casterId: zone.casterId,
          spellId: zone.spellId,
          widthFeet: acting.content.area?.widthFeet ?? null,
          pixelsPerFoot,
          by
        })
      );
    }
  }
  // An area that acts once (Create Water's rain) is gone once it has.
  for (const zone of liveZones(state))
    if (zone.annotationId !== null && zoneContentOf(zone, deps.catalog)?.trigger.instant)
      events.push(...endZoneAndItsSpell(state, zone.id));
  // Fire that reached the webs sets them burning (Web).
  events.push(...settleFire(state, deps));
  return events;
}

/** Whether settling would change anything now: tried on a copy, so nothing is written and no die is spent. */
export function zoneOutcomesPending(state: GameState, deps: Deps): boolean {
  if (!holdsZoneOutcomes(state, deps.catalog)) return false;
  const trial = structuredClone(state);
  const events = settleZoneOutcomes(trial, { ...deps, rollDie: () => 1 });
  return events.length > 0 || JSON.stringify(trial.combat.spellZones) !== JSON.stringify(state.combat.spellZones);
}
