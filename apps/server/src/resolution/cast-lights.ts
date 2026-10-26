import type { GameState } from "@vtt/domain";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { setRowFlame } from "../item-light.js";
import { rowRecord } from "../item-records.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { distance } from "../vision/geometry.js";
import { lightZone, waitsUnlit } from "../zone-kindling.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * What a cast or an action does to the flames on the map (SRD 5.2.1): Druidcraft's and Prestidigitation's Fire Play
 * ("You instantaneously light or snuff out a candle, a torch, or a small campfire"), Elementalism's Beckon Fire (embers
 * that "can light candles, torches, or lamps"), a Frost Brand drawn ("extinguish all nonmagical flames within 30 feet of
 * yourself") and a Sun Blade's Magic action ("expand the blade's light's radius or reduce it by 5 feet"). A flame is a
 * light set on the map that no spell made (`out` while snuffed) or a burning light a creature carries (`item-light.ts`).
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

const tokenAt = (state: GameState, actorId: string): Point | null =>
  state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;

/** Feet from the user to a point on the map, or null when the map can't say. */
function feetTo(ctx: ResolveContext, at: Point): number | null {
  const from = tokenAt(ctx.state, ctx.attacker.id);
  const pixelsPerFoot = ctx.state.combat.vision.measure?.pixelsPerFoot;
  return from && pixelsPerFoot ? distance(from, at) / pixelsPerFoot : null;
}

/** The light a cast is aimed at, checked against the spell: one it can light, a flame no spell made, in reach. */
export function checkLightTarget(ctx: ResolveContext): void {
  const { input, state } = ctx;
  if (input.lightId === undefined) return;
  const kindles = spellOf(ctx)?.effect?.kindles;
  if (!kindles) throw new CommandRejectedError(`${ctx.action.name} doesn't light or put out a flame.`);
  const light = state.combat.vision.lights.find((candidate) => candidate.id === input.lightId);
  if (!light?.position || light.source !== undefined)
    throw new CommandRejectedError("Choose a candle, torch or fire set on the map.");
  const feet = feetTo(ctx, light.position);
  if (feet !== null && feet > kindles.feet + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(
      `That light is ${Math.round(feet)} ft away, beyond ${ctx.action.name}'s ${kindles.feet} ft.`
    );
  if (light.out !== true && kindles.snuffs !== true)
    throw new CommandRejectedError(`${ctx.action.name} can light a flame, and that one is burning.`);
}

/** Lights or puts out the flame a cast is aimed at: a light on the map, or the burning lights a creature it targets
 *  carries (each it can light, or with `snuffs` those burning put out). */
export function applyKindles(ctx: ResolveContext): void {
  const kindles = spellOf(ctx)?.effect?.kindles;
  if (!kindles || ctx.input.commit === false) return;
  const { state, input } = ctx;
  const say = (text: string, actorId: string) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId }));
  if (input.lightId !== undefined) {
    const lightId = input.lightId;
    const relit = state.combat.vision.lights.find((light) => light.id === lightId)?.out === true;
    state.combat = {
      ...state.combat,
      vision: {
        ...state.combat.vision,
        lights: state.combat.vision.lights.map((light) =>
          light.id !== lightId
            ? light
            : relit
              ? (({ out: _out, ...rest }) => rest)(light)
              : { ...light, out: true as const }
        )
      }
    };
    say(relit ? `${ctx.action.name} lights a flame.` : `${ctx.action.name} snuffs out a flame.`, ctx.attacker.id);
    return;
  }
  const catalog = ctx.deps.catalog;
  for (const target of ctx.targets) {
    const flames = target.inventory.filter(
      (row) => row.quantity > 0 && rowRecord(catalog, row)?.light?.burnHours !== undefined
    );
    const burning = flames.filter((row) => row.lit === true);
    const changed =
      burning.length > 0 && kindles.snuffs
        ? setRowFlame(state, target, burning[0]!.id, false, catalog)
        : flames.length > 0
          ? setRowFlame(state, target, flames.find((row) => row.lit !== true)?.id ?? flames[0]!.id, true, catalog)
          : null;
    if (changed) say(changed, target.id);
  }
}

/** Every nonmagical flame within the action's reach goes out (a Frost Brand drawn). */
export function applyDouses(ctx: ResolveContext): void {
  const douses = ctx.action.douses;
  if (!douses || ctx.input.commit === false) return;
  const { state, attacker } = ctx;
  const near = (at: Point | null) => {
    const feet = at ? feetTo(ctx, at) : null;
    return feet !== null && feet <= douses.feet + DISTANCE_TOLERANCE_FEET;
  };
  let snuffed = 0;
  state.combat = {
    ...state.combat,
    vision: {
      ...state.combat.vision,
      lights: state.combat.vision.lights.map((light) => {
        if (light.source !== undefined || light.out === true || !near(light.position)) return light;
        snuffed += 1;
        return { ...light, out: true as const };
      })
    }
  };
  for (const creature of state.actors as Actor[]) {
    if (creature.id !== attacker.id && !near(tokenAt(state, creature.id))) continue;
    for (const row of creature.inventory.filter((entry) => entry.lit === true)) {
      const line = setRowFlame(state, creature, row.id, false, ctx.deps.catalog);
      if (line) ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text: line, actorId: creature.id }));
    }
  }
  if (snuffed > 0)
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        text: `${ctx.action.name} puts out ${snuffed === 1 ? "a flame" : `${snuffed} flames`} nearby.`,
        actorId: attacker.id
      })
    );
}

/** A Tinderbox lights the spilled oil within its reach (SRD Tinderbox: lighting "anything else with exposed fuel" takes
 *  a Bonus Action). */
export function applyLightsArea(ctx: ResolveContext): void {
  const lights = ctx.action.lightsArea;
  if (!lights || ctx.input.commit === false) return;
  const { state, attacker, deps } = ctx;
  const near = state.combat.spellZones.filter((zone) => {
    if (!waitsUnlit(zone, deps.catalog)) return false;
    const area = state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
    const feet = deps.zoneFeet?.(attacker.id, zone.id) ?? (area ? feetTo(ctx, area.geometry.origin) : null);
    return feet !== null && feet <= lights.feet + DISTANCE_TOLERANCE_FEET;
  });
  if (near.length === 0)
    throw new CommandRejectedError(`There is no spilled oil within ${lights.feet} feet of ${attacker.name} to light.`);
  for (const zone of near)
    for (const event of lightZone(state, zone, deps.catalog)) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** A Sun Blade's Magic action: its light 5 feet wider or narrower, its Bright Light kept between the bounds. */
export function applyAdjustsLight(ctx: ResolveContext): void {
  const adjusts = ctx.action.adjustsLight;
  if (!adjusts || ctx.input.commit === false) return;
  const { attacker, deps } = ctx;
  const rowId = sourceItemOf(ctx.action, deriveEquipment(attacker, deps.definition, deps.catalog), attacker.inventory);
  const row = attacker.inventory.find((entry) => entry.id === rowId);
  const light = row ? rowRecord(deps.catalog, row)?.light : undefined;
  if (!row || !light) throw new CommandRejectedError(`${ctx.action.name} has no light to change.`);
  const bright = light.brightFeet + (row.lightStepFeet ?? 0) + adjusts.stepFeet;
  if (bright < adjusts.minFeet || bright > adjusts.maxFeet)
    throw new CommandRejectedError(
      `${row.name}'s Bright Light reaches ${adjusts.minFeet} to ${adjusts.maxFeet} ft, and it is at ${bright - adjusts.stepFeet} ft.`
    );
  const step = bright - light.brightFeet;
  attacker.inventory = attacker.inventory.map((entry) => {
    if (entry.id !== row.id) return entry;
    const { lightStepFeet: _step, ...rest } = entry;
    return step === 0 ? rest : { ...rest, lightStepFeet: step };
  });
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      text: `${row.name} now sheds Bright Light ${bright} ft and Dim Light ${bright} ft beyond.`,
      actorId: attacker.id
    })
  );
}
