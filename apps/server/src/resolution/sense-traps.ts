import { zoneContentOf } from "../spell-zone-state.js";
import { liveZones } from "../spell-zones.js";
import { trapRecord } from "../traps.js";
import { insidePolygon } from "../vision/geometry.js";
import { sceneSight } from "../vision/sight.js";
import { tableLineOf, type ResolveContext } from "./context.js";

type Point = Readonly<{ x: number; y: number }>;

/** What a trap's danger is, as Find Traps tells it ("You do learn the general nature of the danger"). */
const NATURE: Readonly<Record<string, string>> = {
  "collapsing-roof": "a ceiling rigged to collapse",
  "falling-net": "a net rigged to fall",
  "fire-casting-statue": "a statue that breathes fire",
  "hidden-pit": "a hidden pit",
  "poisoned-darts": "poisoned darts",
  "poisoned-needle": "a poisoned needle",
  "rolling-stone": "a rolling stone",
  "spiked-pit": "a spiked pit"
};

/**
 * SRD Find Traps: "You sense any trap within range that is within line of sight ... This spell reveals that a trap is
 * present but not its location. You do learn the general nature of the danger posed by a trap you sense." The traps
 * the app holds count: those set on the map, the warding spells' areas (Glyph of Warding, Symbol, Alarm) and set items
 * (a Hunting Trap, spread Caltrops). Each within the range whose middle the caster sees (any within range with dynamic
 * vision off) is told to the caster's player by its nature alone (`sensed`), never where it is; the GM hears where.
 */
export function senseTraps(ctx: ResolveContext): void {
  const reach = ctx.action.sensesTraps;
  if (!reach || ctx.input.commit === false) return;
  const { state, attacker, deps } = ctx;
  const at = state.combat.tokens.find((token) => token.actorId === attacker.id)?.position;
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot ?? deps.pixelsPerFoot;
  if (!at || !pixelsPerFoot) {
    ctx.sensed.push("The map can't measure the spell's range here, so the GM tells you what you sense.");
    return;
  }
  const sight = sceneSight(state, {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  const seen = sight.enabled ? sight.areaOf([attacker.id]) : null;
  const inReach = (point: Point) =>
    Math.hypot(point.x - at.x, point.y - at.y) / pixelsPerFoot <= reach.feet + 2.5 &&
    (seen === null || seen.some((area) => insidePolygon(point, area)));
  const sensed: Array<Readonly<{ nature: string; point: Point }>> = [];
  for (const trap of state.combat.traps ?? []) {
    if (trap.state === "disarmed") continue;
    const middle = { x: trap.area.x + trap.area.width / 2, y: trap.area.y + trap.area.height / 2 };
    if (inReach(middle))
      sensed.push({ nature: NATURE[trap.trapId] ?? trapRecord(trap.trapId)?.name ?? "a trap", point: middle });
  }
  for (const zone of liveZones(state)) {
    if (zone.casterId === attacker.id) continue;
    const content = zoneContentOf(zone, deps.catalog);
    const area = state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
    if (!content || !area) continue;
    const trigger = content.trigger;
    // A trap is "any object or mechanism that was created to cause damage or other danger": a glyph, an alarm, a set
    // item that springs; a spell's lasting area in the open (a Web) is no trap.
    const nature = trigger.alerts
      ? "a magical alarm"
      : trigger.glyph || trigger.hidden
        ? `a magical glyph (${content.name})`
        : trigger.once && zone.rule !== undefined
          ? `a set trap (${content.name})`
          : null;
    if (nature && inReach(area.geometry.origin)) sensed.push({ nature, point: area.geometry.origin });
  }
  const name = ctx.action.name;
  if (sensed.length === 0) {
    ctx.sensed.push(`${name}: you sense no trap within ${reach.feet} feet.`);
    return;
  }
  ctx.sensed.push(
    `${name}: you sense ${sensed.length === 1 ? "a trap" : `${sensed.length} traps`} within ${reach.feet} feet: ${sensed.map((entry) => entry.nature).join("; ")}. Where ${sensed.length === 1 ? "it is" : "they are"}, the spell doesn't say.`
  );
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      text: `${name} senses for ${attacker.name}: ${sensed.map((entry) => `${entry.nature} ${Math.round(Math.hypot(entry.point.x - at.x, entry.point.y - at.y) / pixelsPerFoot)} feet away`).join("; ")}.`,
      actorId: attacker.id,
      gmOnly: true
    })
  );
}
