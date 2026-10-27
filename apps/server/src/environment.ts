import { CALM_ENVIRONMENT, isDead, type GameState, type SceneEnvironment } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition, type Modifier } from "@vtt/schemas";
import { requireGm, type Initiator } from "./authorization.js";
import { exhaustionLevel } from "./condition-rules.js";
import { CommandRejectedError } from "./game-store.js";
import {
  addEffect,
  applyCondition,
  conditionGained,
  endEffectIfPresent,
  makeEffect,
  type EffectNarration
} from "./effects.js";
import { deriveEquipment, itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { startFall, type FallDeps } from "./falling.js";
import { douseFire } from "./hazards.js";
import { previewDamage } from "./hit-points.js";
import { douseCarriedLights, exposedFlame } from "./item-light.js";
import { rollSaveAtOnce } from "./saving-throws.js";
import { endSpellZone } from "./spell-endings.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { liveZones } from "./spell-zones.js";
import { specialSpeedsOf } from "./speed.js";
import type { SquareGridCalibration } from "./grid-calibration.js";
import { waterOf } from "./water.js";

/**
 * The scene's climate and weather (SRD 5.2.1 Gameplay Toolbox, Environmental Effects), set by the GM per scene
 * (`combat.environment`). The creatures placed on the live scene's map are exposed to it:
 * - Extreme cold: a DC 10 Constitution save at the end of each hour or a level of Exhaustion; Resistance or Immunity to
 *   Cold damage succeeds, so do a creature in a Bedroll (an equipped row) and one wearing a cold-tolerant item (a Ring
 *   of Warmth), and one wrapped in a Blanket has Advantage.
 * - Extreme heat: for a creature with no drinkable water (no Waterskin with water left), a Constitution save at the end
 *   of each hour, DC 5 the first hour and 1 more each hour after, with Disadvantage in Medium or Heavy armor; Fire
 *   Resistance or Immunity succeeds.
 * - Frigid water: immersed in the painted water, a creature lasts minutes equal to its Constitution score, then makes a
 *   DC 10 Constitution save each minute or gains a level of Exhaustion; Cold Resistance or Immunity succeeds.
 * - Deep water: after each hour swimming in it, a creature without a Swim Speed makes a DC 10 Constitution save.
 * - High altitude: each hour travelled counts as 2 toward Extended Travel's 8 hours (`travelHoursPass`).
 * - Heavy precipitation: everything is Lightly Obscured (`vision/sight.ts`), Wisdom (Perception) checks have
 *   Disadvantage, and heavy rain puts out open flames.
 * - Strong wind: Disadvantage on ranged weapon attack rolls, open flames go out, fog disperses, and a flier must land at
 *   the end of its turn or fall; a sandstorm also gives Disadvantage on Wisdom (Perception) checks.
 * The saves on the clock are rolled at once by the server, as hunger's are. What weather gives a creature's rolls is an
 * effect it holds while it stands on the scene's map, settled after every command.
 */

type Actor = GameState["actors"][number];

export type EnvironmentDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: (sides: number) => number;
}>;

/** The tag of the effect weather leaves on each creature on the scene's map. */
export const WEATHER_TAG = "weather";
const WEATHER_EFFECT = "weather";
/** "Must succeed on a DC 10 Constitution saving throw at the end of each hour or gain 1 Exhaustion level". */
const COLD_DC = 10;
const FRIGID_DC = 10;
const DEEP_DC = 10;
/** "The DC is 5 for the first hour and increases by 1 for each additional hour." */
const HEAT_FIRST_DC = 5;
/** SRD Extended Travel: "more than 8 hours per day ... The DC is 10 plus 1 for each hour past 8 hours." */
const TRAVEL_DAY_HOURS = 8;
const TRAVEL_DC = 10;
const ROUNDS_PER_MINUTE = 10;
/** The longest stretch of time worked through minute by minute or hour by hour (time.pass's own ceiling). */
const MAX_HOURS = 720;

export const BEDROLL_ID = "bedroll";
export const BLANKET_ID = "blanket";

/** The live scene's environment; calm when a state predates it. */
export const environmentOf = (state: GameState): SceneEnvironment => state.combat.environment ?? CALM_ENVIRONMENT;

/** The GM sets the live scene's climate and weather, or a prepared scene's with `encounterId`. */
export function setEnvironment(
  state: GameState,
  encounterId: string | undefined,
  environment: Partial<SceneEnvironment>,
  scope: Initiator
): void {
  requireGm(scope, "Only the GM sets the weather.");
  if (encounterId === undefined || encounterId === state.combat.activeEncounterId) {
    state.combat = { ...state.combat, environment: { ...environmentOf(state), ...environment } };
    return;
  }
  const scene = state.combat.encounters.find((candidate) => candidate.id === encounterId);
  if (!scene) throw new CommandRejectedError("That encounter no longer exists.");
  state.combat = {
    ...state.combat,
    encounters: state.combat.encounters.map((candidate) =>
      candidate.id === encounterId
        ? {
            ...candidate,
            combat: {
              ...candidate.combat,
              environment: { ...(candidate.combat.environment ?? CALM_ENVIRONMENT), ...environment }
            }
          }
        : candidate
    )
  };
}

/** The creatures the scene's environment reaches: alive, placed on the live map, and in time. */
function exposedCreatures(state: GameState, actorIds?: ReadonlySet<string>): Actor[] {
  const placed = new Set(state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId));
  return state.actors.filter(
    (actor) =>
      placed.has(actor.id) && !isDead(actor) && !actor.archived && (actorIds === undefined || actorIds.has(actor.id))
  );
}

const definitionOf = (actor: Actor, deps: Pick<EnvironmentDeps, "resolveDefinition">) =>
  actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;

/** Whether the creature has Resistance or Immunity to this damage type, as a hit of it would read it. */
function shrugsOff(state: GameState, actor: Actor, type: string, deps: EnvironmentDeps): boolean {
  const preview = previewDamage(
    state,
    actor.id,
    { amount: 10, parts: [{ amount: 10, type }] },
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
  return preview.parts.some(
    (part) =>
      part.adjustment === "resistance" ||
      part.adjustment === "immunity" ||
      part.adjustment === "resistance-and-vulnerability"
  );
}

/** Whether a row of this gear is equipped: a Bedroll the creature is in, a Blanket it is wrapped in. */
const using = (actor: Actor, id: string) =>
  actor.inventory.some((row) => (row.recordId ?? row.id) === id && row.equipped && row.quantity > 0);

/** Whether it carries drinkable water: a Waterskin with water left. */
const hasWater = (actor: Actor) =>
  actor.inventory.some(
    (row) => (row.recordId ?? row.id) === "waterskin" && (row.waterPints ?? row.quantity * 4) > 0 && row.quantity > 0
  );

/** One Exhaustion level from the environment, with its line; Exhaustion 6 kills. */
function gainLevel(state: GameState, actor: Actor, why: string, events: EffectNarration[]): void {
  const before = exhaustionLevel(actor);
  if (applyCondition(actor, "exhaustion") !== "applied") return;
  events.push({ kind: "condition", text: `${actor.name} gains a level of Exhaustion (${why}).`, actorId: actor.id });
  events.push(...conditionGained(state, actor, "exhaustion", before));
}

/** A Constitution save the environment asks, rolled at once: a failure is a level of Exhaustion. */
function enduranceSave(
  state: GameState,
  actor: Actor,
  input: Readonly<{ dc: number; why: string; advantageFrom?: string; disadvantageFrom?: string }>,
  deps: EnvironmentDeps,
  events: EffectNarration[]
): void {
  const save = rollSaveAtOnce(state, actor, "con", {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    rollDie: deps.random,
    ...(input.advantageFrom ? { advantageFrom: input.advantageFrom } : {}),
    ...(input.disadvantageFrom ? { disadvantageFrom: input.disadvantageFrom } : {})
  });
  const kept = save.total >= input.dc;
  const mode =
    save.rollMode.mode === "advantage"
      ? `, Advantage (${input.advantageFrom ?? "its riders"})`
      : save.rollMode.mode === "disadvantage"
        ? `, Disadvantage (${input.disadvantageFrom ?? "its riders"})`
        : "";
  events.push({
    kind: "effect",
    text: `${actor.name} endures ${input.why}: DC ${input.dc} CON save, ${save.total} (d20 ${save.natural}${mode}), ${kept ? "a success" : "a failure"}.`,
    actorId: actor.id
  });
  if (!kept) gainLevel(state, actor, input.why, events);
}

/** The tag of a worn item that keeps its wearer unharmed by freezing cold (a Ring of Warmth: "unharmed by temperatures
 *  of 0 degrees Fahrenheit or lower"; Boots of the Winterlands). */
export const COLD_TOLERANT_TAG = "cold-tolerant";

/** Whether an active item it carries bears this tag. */
const wearsTagged = (actor: Actor, tag: string, deps: Pick<EnvironmentDeps, "catalog">) =>
  actor.inventory.some((row) => {
    const record = deps.catalog?.equipmentRecord(catalogIdOf(row));
    return record?.tags.includes(tag) === true && itemIsActive(row, record);
  });

/** The end of an hour of extreme cold for one creature. */
function coldHour(state: GameState, actor: Actor, deps: EnvironmentDeps, events: EffectNarration[]): void {
  if (shrugsOff(state, actor, "cold", deps) || using(actor, BEDROLL_ID) || wearsTagged(actor, COLD_TOLERANT_TAG, deps))
    return;
  enduranceSave(
    state,
    actor,
    { dc: COLD_DC, why: "the extreme cold", ...(using(actor, BLANKET_ID) ? { advantageFrom: "Blanket" } : {}) },
    deps,
    events
  );
}

/** The end of an hour of extreme heat for one creature: one with water to drink is spared, and its count starts over. */
function heatHour(state: GameState, actor: Actor, deps: EnvironmentDeps, events: EffectNarration[]): void {
  if (shrugsOff(state, actor, "fire", deps) || hasWater(actor)) {
    if (actor.exposure?.heatHours) actor.exposure = { ...actor.exposure, heatHours: 0 };
    return;
  }
  const hours = actor.exposure?.heatHours ?? 0;
  actor.exposure = { ...actor.exposure, heatHours: hours + 1 };
  const weight = deriveEquipment(actor, definitionOf(actor, deps), deps.catalog).context.armorWeight;
  enduranceSave(
    state,
    actor,
    {
      dc: HEAT_FIRST_DC + hours,
      why: "the extreme heat",
      ...(weight === "medium" || weight === "heavy" ? { disadvantageFrom: `${weight} armor` } : {})
    },
    deps,
    events
  );
}

/** Rounds immersed in frigid water pass for one creature: past its Constitution score in minutes, each further minute
 *  asks a save. Out of the water, the count starts over. */
function frigidRounds(
  state: GameState,
  actor: Actor,
  rounds: number,
  inWater: boolean,
  deps: EnvironmentDeps,
  events: EffectNarration[]
): void {
  if (!inWater) {
    if (actor.exposure?.frigidRounds) actor.exposure = { ...actor.exposure, frigidRounds: 0 };
    return;
  }
  const before = actor.exposure?.frigidRounds ?? 0;
  const after = Math.min(1_000_000, before + rounds);
  actor.exposure = { ...actor.exposure, frigidRounds: after };
  if (shrugsOff(state, actor, "cold", deps)) return;
  const grace = (definitionOf(actor, deps)?.abilityScores.con ?? 10) * ROUNDS_PER_MINUTE;
  const minutesPast = (count: number) => Math.max(0, Math.floor((count - grace) / ROUNDS_PER_MINUTE));
  const saves = Math.min(MAX_HOURS * 60, minutesPast(after) - minutesPast(before));
  for (let save = 0; save < saves && !isDead(actor); save += 1)
    enduranceSave(state, actor, { dc: FRIGID_DC, why: "the frigid water" }, deps, events);
}

/** Minutes swimming in deep water pass for one creature without a Swim Speed: each full hour asks a save. */
function deepMinutes(
  state: GameState,
  actor: Actor,
  minutes: number,
  inWater: boolean,
  deps: EnvironmentDeps,
  events: EffectNarration[]
): void {
  const definition = definitionOf(actor, deps);
  const swims = specialSpeedsOf(actor, definition, deriveEquipment(actor, definition, deps.catalog)).swim !== undefined;
  if (!inWater || swims) {
    if (actor.exposure?.deepMinutes) actor.exposure = { ...actor.exposure, deepMinutes: 0 };
    return;
  }
  const total = (actor.exposure?.deepMinutes ?? 0) + minutes;
  const hours = Math.min(MAX_HOURS, Math.floor(total / 60));
  actor.exposure = { ...actor.exposure, deepMinutes: total % 60 };
  for (let hour = 0; hour < hours && !isDead(actor); hour += 1)
    enduranceSave(state, actor, { dc: DEEP_DC, why: "swimming in deep water" }, deps, events);
}

/**
 * Game time passes outside a fight (`passGameTime`): each hour's end in extreme cold or heat, and each minute in frigid
 * or deep water, for every creature placed on the live scene's map.
 */
export function environmentOverTime(
  state: GameState,
  actorIds: ReadonlySet<string>,
  fromMinute: number,
  toMinute: number,
  deps: EnvironmentDeps
): EffectNarration[] {
  const environment = environmentOf(state);
  const events: EffectNarration[] = [];
  const creatures = exposedCreatures(state, actorIds);
  const hours = Math.min(MAX_HOURS, Math.floor(toMinute / 60) - Math.floor(fromMinute / 60));
  for (const actor of creatures) {
    if (!environment.heat && actor.exposure?.heatHours) actor.exposure = { ...actor.exposure, heatHours: 0 };
    for (let hour = 0; hour < hours && !isDead(actor); hour += 1) {
      if (environment.cold) coldHour(state, actor, deps, events);
      if (environment.heat && !isDead(actor)) heatHour(state, actor, deps, events);
    }
    const inWater = waterOf(state, actor.id, null, deps) !== null;
    if (environment.frigidWater && !isDead(actor))
      frigidRounds(state, actor, (toMinute - fromMinute) * ROUNDS_PER_MINUTE, inWater, deps, events);
    if (environment.deepWater && !isDead(actor))
      deepMinutes(state, actor, toMinute - fromMinute, inWater, deps, events);
  }
  return events;
}

/**
 * The end of a creature's turn in a fight: a round more in frigid water, and in a strong wind a flier that hasn't
 * landed falls ("A flying creature in a strong wind must land at the end of its turn or fall").
 */
export function environmentAtTurnEnd(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined,
  deps: EnvironmentDeps & Pick<FallDeps, "newId" | "now">
): EffectNarration[] {
  const environment = environmentOf(state);
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || isDead(actor)) return [];
  const events: EffectNarration[] = [];
  if (environment.frigidWater)
    frigidRounds(state, actor, 1, waterOf(state, actorId, calibration, deps) !== null, deps, events);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (environment.wind !== "none" && token && (token.altitudeFeet ?? 0) > 0 && token.airborne === "fly") {
    events.push({
      kind: "effect",
      text: `The strong wind brings ${actor.name} down: it didn't land by the end of its turn.`,
      actorId
    });
    events.push(
      ...startFall(
        state,
        { actorId, feet: token.altitudeFeet ?? 0 },
        {
          resolveDefinition: deps.resolveDefinition,
          ...(deps.catalog ? { catalog: deps.catalog } : {}),
          random: deps.random,
          newId: deps.newId,
          now: deps.now
        }
      )
    );
  }
  return events;
}

/** What the weather gives the rolls of a creature standing in it. */
function weatherRiders(environment: SceneEnvironment): Readonly<{ name: string; modifiers: Modifier[] }> | null {
  const names: string[] = [];
  const modifiers: Modifier[] = [];
  const perception = environment.precipitation !== "none" || environment.wind === "sandstorm";
  if (environment.precipitation === "rain") names.push("Heavy rain");
  if (environment.precipitation === "snow") names.push("Heavy snowfall");
  if (environment.wind === "strong") names.push("Strong wind");
  if (environment.wind === "sandstorm") names.push("Sandstorm");
  if (perception)
    modifiers.push({
      type: "roll-mode",
      roll: "check",
      mode: "disadvantage",
      when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["perception"] }]
    });
  if (environment.wind !== "none")
    modifiers.push({
      type: "roll-mode",
      roll: "attack",
      mode: "disadvantage",
      when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged-weapon"] }]
    });
  return names.length > 0 ? { name: names.join(" and "), modifiers } : null;
}

type SettleDeps = Readonly<{
  catalog?: EquipmentCatalog;
}>;

/**
 * Settles the weather after a command: each creature on the live map holds the weather's effect (its rolls' Advantage
 * and Disadvantage), a creature that left the map or a scene gone calm loses it, heavy rain or a strong wind puts out
 * the open flames it carries and the fire on it, and a strong wind disperses the clouds and fog that a wind ends.
 * Returns the lines for the table.
 */
export function settleWeather(state: GameState, deps: SettleDeps): EffectNarration[] {
  const environment = environmentOf(state);
  const events: EffectNarration[] = [];
  const riders = weatherRiders(environment);
  const exposed = new Set(exposedCreatures(state).map((actor) => actor.id));
  for (const actor of state.actors) {
    const held = actor.effects.find((effect) => effect.id === WEATHER_EFFECT);
    const wanted = riders !== null && exposed.has(actor.id);
    const same =
      held !== undefined &&
      riders !== null &&
      held.name === riders.name &&
      JSON.stringify(held.modifiers) === JSON.stringify(riders.modifiers);
    if (held && (!wanted || !same)) endEffectIfPresent(state, actor.id, held.id);
    if (wanted && !same)
      addEffect(
        state,
        actor.id,
        makeEffect({
          id: WEATHER_EFFECT,
          name: riders.name,
          tags: [WEATHER_TAG],
          startedRound: state.combat.round,
          duration: { type: "manual" },
          modifiers: structuredClone(riders.modifiers)
        })
      );
  }
  // SRD: heavy rain "extinguishes open flames"; a strong wind "extinguishes open flames and disperses fog".
  const douses = environment.precipitation === "rain" || environment.wind !== "none";
  if (douses) {
    const by = environment.precipitation === "rain" ? "The heavy rain" : "The strong wind";
    for (const actor of state.actors) {
      if (!exposed.has(actor.id)) continue;
      events.push(...douseFire(state, actor, by));
      const lines = douseCarriedLights(actor, deps.catalog, state.rest.clockHours, (light) => exposedFlame(light), by);
      events.push(...lines.map((text) => ({ kind: "effect" as const, text, actorId: actor.id })));
    }
  }
  if (environment.wind !== "none")
    for (const zone of liveZones(state)) {
      const content = zoneContentOf(zone, deps.catalog);
      if (!content?.trigger.endsBy?.includes("wind") || zone.annotationId === null) continue;
      events.push(
        { kind: "effect", text: `The strong wind disperses ${content.name}.`, actorId: zone.casterId },
        ...endSpellZone(state, zone)
      );
    }
  return events;
}

/** Whether settling the weather would change anything now: tried on a copy, so nothing is written. */
export function weatherPending(state: GameState, deps: SettleDeps): boolean {
  const environment = environmentOf(state);
  const calm =
    environment.precipitation === "none" &&
    environment.wind === "none" &&
    !state.actors.some((actor) => actor.effects.some((effect) => effect.id === WEATHER_EFFECT));
  if (calm) return false;
  const trial = structuredClone(state);
  const events = settleWeather(trial, deps);
  return events.length > 0 || JSON.stringify(trial.actors) !== JSON.stringify(state.actors);
}

/**
 * The party travels for `hours` (SRD 5.2.1 Gameplay Toolbox, Extended Travel): each traveller's hours on the road since
 * its last Long Rest grow, twice as fast at high altitude, and at the end of each hour past 8 it makes a Constitution
 * save, DC 10 plus 1 for each hour past 8, or gains a level of Exhaustion.
 */
export function travelHoursPass(
  state: GameState,
  travellerIds: readonly string[],
  hours: number,
  deps: EnvironmentDeps
): EffectNarration[] {
  const rate = environmentOf(state).highAltitude ? 2 : 1;
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    if (!travellerIds.includes(actor.id) || isDead(actor)) continue;
    const before = actor.exposure?.travelHours ?? 0;
    const after = Math.min(100_000, before + hours * rate);
    actor.exposure = { ...actor.exposure, travelHours: after };
    const past = (count: number) => Math.max(0, Math.floor(count) - TRAVEL_DAY_HOURS);
    for (let hour = past(before) + 1; hour <= Math.min(past(after), MAX_HOURS) && !isDead(actor); hour += 1)
      enduranceSave(
        state,
        actor,
        { dc: TRAVEL_DC + hour, why: `travelling ${TRAVEL_DAY_HOURS + hour} hours` },
        deps,
        events
      );
  }
  return events;
}

/** A Long Rest ends the day's travel: the hours on the road count from zero again. */
export function restFromTravel(actor: Actor): void {
  if (actor.exposure?.travelHours) actor.exposure = { ...actor.exposure, travelHours: 0 };
}
