import type { GameState } from "@vtt/domain";
import type { CheckSight } from "../ability-checks.js";
import { crossesSpace, mapCover } from "../cover.js";
import { distance } from "./geometry.js";
import { definitionOf, sensesOf, type Senses, type SightContent } from "./senses.js";
import { sceneSight, type LightAt, type Obscurement } from "./sight.js";

/**
 * The questions the rules ask of sight (SRD 5.2.1): "a creature you can see", "while the source of fear is within line
 * of sight", "while in sunlight", "in a Lightly Obscured space". With dynamic vision on, the sight engine answers from
 * the map. With it off, what the engine still knows answers: the Blinded and Invisible conditions, and Blindsight,
 * Truesight and See Invisibility by the distance between the tokens. Light and line of sight are then the GM's, and
 * a rule that needs them keeps its printed effect.
 */

type Actor = GameState["actors"][number];

/** Feet of slack on a sense's range, as the sight engine allows. */
const RANGE_SLACK_FEET = 0.5;

export type SightRules = Readonly<{
  /** Dynamic vision is on for the live scene. */
  visionOn: boolean;
  /** Whether `viewerId` can see `targetId`: by the map with vision on, else by the conditions and the senses. */
  canSee: (viewerId: string, targetId: string) => boolean;
  /** Whether nothing blocks a line of sight between them, whatever the light; null with vision off or a token off the
   *  map, where the GM decides. */
  lineOfSight: (fromId: string, toId: string) => boolean | null;
  /** The light where a creature stands; null with vision off or no token. */
  lightAt: (actorId: string) => LightAt | null;
  /** How obscured a creature's space is to anyone looking at it; null with vision off or no token. */
  obscurementOf: (actorId: string) => Obscurement | null;
  /** How obscured `targetId` is to `viewerId`, after the viewer's Darkvision and other senses ("you can see in Dim
   *  Light within that range as if it were Bright Light"); null with vision off or a token off the map. */
  obscuredTo: (viewerId: string, targetId: string) => Obscurement | null;
  /** The creature's senses, read live. */
  sensesOf: (actorId: string) => Senses | null;
}>;

/** The distance between two creatures' tokens in feet, centre to centre, when the map's scale is known. */
function centreFeet(state: GameState, a: string, b: string): number | null {
  const pixelsPerFoot = state.combat.vision?.measure?.pixelsPerFoot;
  const at = (actorId: string) => state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  const from = at(a);
  const to = at(b);
  if (!pixelsPerFoot || !from || !to) return null;
  return distance(from, to) / pixelsPerFoot;
}

const has = (actor: Actor, conditionId: string) => actor.conditions.some((condition) => condition.id === conditionId);
const outlined = (actor: Actor) => actor.effects.some((effect) => effect.tags.includes("outlined"));

/** The rules' sight over one state. `distanceFeet` measures between two creatures (edge to edge, as the rules do);
 *  without it the map's scale measures centre to centre. */
export function sightRules(
  state: GameState,
  content: SightContent = {},
  distanceFeet?: (a: string, b: string) => number | null
): SightRules {
  const sight = sceneSight(state, content);
  const actors = new Map(state.actors.map((actor) => [actor.id, actor]));
  const sensesMemo = new Map<string, Senses>();
  const sensesFor = (actorId: string): Senses | null => {
    const actor = actors.get(actorId);
    if (!actor) return null;
    let senses = sensesMemo.get(actorId);
    if (!senses) sensesMemo.set(actorId, (senses = sensesOf(state, actor, content)));
    return senses;
  };
  const placed = (actorId: string) => sight.positionOf(actorId) !== null;
  const measure = (a: string, b: string) => distanceFeet?.(a, b) ?? centreFeet(state, a, b);

  const canSee = (viewerId: string, targetId: string): boolean => {
    if (viewerId === targetId) return true;
    if (sight.enabled && placed(viewerId) && placed(targetId)) return sight.sees(viewerId, targetId);
    const viewer = actors.get(viewerId);
    const target = actors.get(targetId);
    if (!viewer || !target) return false;
    const senses = sensesFor(viewerId);
    const feet = measure(viewerId, targetId);
    const reaches = (range: number) => range > 0 && feet !== null && feet <= range + RANGE_SLACK_FEET;
    const blindsight = senses !== null && reaches(senses.blindsight);
    if (has(viewer, "blinded")) return blindsight;
    if (has(target, "invisible") && !outlined(target))
      return blindsight || (senses !== null && (reaches(senses.truesight) || reaches(senses.seeInvisibility)));
    return true;
  };

  const lineOfSight = (fromId: string, toId: string): boolean | null =>
    sight.enabled && placed(fromId) && placed(toId) ? sight.lineOfSight(fromId, toId) : null;

  const lightAt = (actorId: string): LightAt | null => {
    const at = sight.enabled ? sight.positionOf(actorId) : null;
    return at ? sight.lightAt(at) : null;
  };

  const obscurementOf = (actorId: string): Obscurement | null => {
    const at = sight.enabled ? sight.positionOf(actorId) : null;
    return at ? sight.obscurementAt(at) : null;
  };

  const obscuredTo = (viewerId: string, targetId: string): Obscurement | null => {
    const from = sight.enabled ? sight.positionOf(viewerId) : null;
    const at = sight.enabled ? sight.positionOf(targetId) : null;
    if (!from || !at) return null;
    const feet = distance(from, at) / (state.combat.vision?.measure?.pixelsPerFoot ?? 1);
    return obscurementFor(sight.fogAt(at), sight.lightAt(at), sensesFor(viewerId), feet);
  };

  return { visionOn: sight.enabled, canSee, lineOfSight, lightAt, obscurementOf, obscuredTo, sensesOf: sensesFor };
}

const OBSCUREMENT_ORDER: readonly Obscurement[] = ["none", "light", "heavy"];

/** A point's obscurement as one viewer finds it, `feet` away: Darkvision sees Dim Light as Bright and Darkness as Dim
 *  within its range, Devil's Sight and Truesight see both normally, and Blindsight needs no sight. Fog and foliage
 *  obscure whatever the light. */
function obscurementFor(fog: Obscurement, light: LightAt, senses: Senses | null, feet: number): Obscurement {
  const within = (range: number) => range > 0 && feet <= range + RANGE_SLACK_FEET;
  if (senses && within(senses.blindsight)) return "none";
  let seen: Obscurement = light.level === "bright" ? "none" : light.level === "dim" ? "light" : "heavy";
  const piercing = senses !== null && (within(senses.truesight) || within(senses.devilsSight));
  if (light.magical) seen = piercing ? "none" : "heavy";
  else if (piercing) seen = "none";
  else if (senses && within(senses.darkvision)) seen = light.level === "dark" ? "light" : "none";
  return OBSCUREMENT_ORDER[Math.max(OBSCUREMENT_ORDER.indexOf(seen), OBSCUREMENT_ORDER.indexOf(fog))]!;
}

/** The creature a Frightened creature fears, read from the effect that gave it the condition; null when the GM set it
 *  by hand or no effect names its source. */
export function fearSources(actor: Actor): string[] {
  return actor.effects
    .filter((effect) => effect.linkedConditionIds.includes("frightened") && effect.sourceActorId !== null)
    .map((effect) => effect.sourceActorId!);
}

/**
 * SRD Frightened: "Disadvantage on ability checks and attack rolls while the source of fear is within line of sight."
 * With dynamic vision on and a source the effect names, only while a line of sight joins them; otherwise (vision off,
 * a source set by hand, a token off the map) whenever the condition is on.
 */
export function frightenedApplies(actor: Actor, rules: SightRules): boolean {
  if (!has(actor, "frightened")) return false;
  const sources = fearSources(actor);
  if (sources.length === 0 || !rules.visionOn) return true;
  return sources.some((sourceId) => rules.lineOfSight(actor.id, sourceId) !== false);
}

/** The light-sensitivity traits that bear on one kind of roll where the creature stands (Sunlight Sensitivity, Light
 *  Sensitivity, a vampire's sunlight), by name; none with vision off, where the light is the GM's. */
export function lightSensitivities(
  state: GameState,
  actor: Actor,
  roll: "attack" | "check" | "save",
  rules: SightRules,
  content: SightContent
): string[] {
  const light = rules.lightAt(actor.id);
  if (!light) return [];
  const names: string[] = [];
  for (const trait of definitionOf(state, actor, content)?.traitMechanics ?? []) {
    if (trait.kind !== "light-sensitivity" || !trait.rolls.includes(roll)) continue;
    const exposed = trait.light === "sunlight" ? light.sunlight : light.level === "bright";
    if (exposed) names.push(trait.name);
  }
  return names;
}

/** What sight decides about one ability check `actor` makes, for `checkPlan` (`CheckSight`): Frightened's line of
 *  sight, the light it stands in, and how obscured the creature it is finding is to it. */
export function checkSightFor(
  state: GameState,
  actor: Actor,
  content: SightContent,
  finding?: Actor,
  distanceFeet?: (a: string, b: string) => number | null
): CheckSight {
  const rules = sightRules(state, content, distanceFeet);
  const frightened = has(actor, "frightened") ? frightenedApplies(actor, rules) : undefined;
  const sensitive = lightSensitivities(state, actor, "check", rules, content);
  if (!finding)
    return {
      ...(frightened !== undefined ? { frightened } : {}),
      ...(sensitive.length > 0 ? { lightSensitivities: sensitive } : {})
    };
  const senses = rules.sensesOf(actor.id);
  const feet = distanceFeet?.(actor.id, finding.id) ?? null;
  const byBlindsight =
    senses !== null && senses.blindsight > 0 && feet !== null && feet <= senses.blindsight + RANGE_SLACK_FEET;
  return {
    ...(frightened !== undefined ? { frightened } : {}),
    ...(sensitive.length > 0 ? { lightSensitivities: sensitive } : {}),
    findingObscured: rules.obscuredTo(actor.id, finding.id),
    ...(byBlindsight ? { findingByBlindsight: true } : {})
  };
}

const SIZES: readonly string[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const sizeRank = (size: string | undefined) => SIZES.indexOf(size ?? "medium");

/**
 * SRD Hide: "you must succeed ... while you're Heavily Obscured or behind Three-Quarters Cover or Total Cover". With
 * dynamic vision on: whether the hider's space is Heavily Obscured (Darkness, fog, magical Darkness), or the walls give
 * it Three-Quarters or Total Cover from each of `enemyIds`. A Halfling's Naturally Stealthy lets a creature at least
 * one size larger between them serve. True with vision off, where the GM judges it.
 */
export function hidingPlace(
  state: GameState,
  content: SightContent,
  hiderId: string,
  enemyIds: readonly string[],
  naturallyStealthy: boolean
): boolean {
  const rules = sightRules(state, content);
  const obscured = rules.obscurementOf(hiderId);
  if (obscured === null || obscured === "heavy") return true;
  const tokens = state.combat.tokens;
  const hider = state.actors.find((actor) => actor.id === hiderId);
  const hiderAt = tokens.find((token) => token.actorId === hiderId)?.position;
  if (!hider || !hiderAt) return true;
  return enemyIds.every((enemyId) => {
    const cover = mapCover(state, enemyId, hiderId);
    if (cover === "three-quarters" || cover === "total") return true;
    const enemyAt = tokens.find((token) => token.actorId === enemyId)?.position;
    if (!enemyAt) return true;
    if (!naturallyStealthy) return false;
    return tokens.some((token) => {
      if (!token.position || token.actorId === hiderId || token.actorId === enemyId) return false;
      const other = state.actors.find((actor) => actor.id === token.actorId);
      if (!other || sizeRank(other.size) < sizeRank(hider.size) + 1) return false;
      const half = Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) / 2;
      return crossesSpace(enemyAt, hiderAt, token.position, half * 0.8);
    });
  });
}

/** Whether a searcher could see a hidden creature but for its hiding (SRD Search finding a creature that Hid): a line
 *  of sight between them, and it not Heavily Obscured to the searcher, nor the searcher Blinded beyond Blindsight. With
 *  vision off, false: whom a Search finds is then the GM's. */
export function couldSpot(
  state: GameState,
  content: SightContent,
  searcherId: string,
  hiderId: string,
  distanceFeet?: (a: string, b: string) => number | null
): boolean {
  const rules = sightRules(state, content, distanceFeet);
  if (rules.lineOfSight(searcherId, hiderId) !== true) return false;
  const searcher = state.actors.find((actor) => actor.id === searcherId);
  const senses = rules.sensesOf(searcherId);
  const feet = distanceFeet?.(searcherId, hiderId) ?? null;
  const byBlindsight = senses !== null && senses.blindsight > 0 && feet !== null && feet <= senses.blindsight + 0.5;
  if (byBlindsight) return true;
  if (!searcher || has(searcher, "blinded")) return false;
  return rules.obscuredTo(searcherId, hiderId) !== "heavy";
}

/** SRD light-level gates ("While in Dim Light or Darkness"): whether the creature stands in Dim Light or Darkness;
 *  true with vision off, where the light is the GM's. */
export function inDimLightOrDarkness(state: GameState, actorId: string, content: SightContent = {}): boolean {
  const light = sightRules(state, content).lightAt(actorId);
  return light === null || light.level !== "bright";
}
