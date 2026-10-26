import type { CombatState, GameState, PlayerVision, PlayerVisionWall, VisionPolygon, VisionRect } from "@vtt/domain";
import { commandedBySession } from "../authorization.js";
import { revealedRegion } from "../fog.js";
import { intersect, type Rect } from "../rect-region.js";
import { flatPolygon, type Point, type Polygon } from "./geometry.js";
import {
  decodeBits,
  emptyBits,
  encodeBits,
  exploredGridFor,
  isMarked,
  markedRects,
  markPolygons,
  type ExploredGrid
} from "./explored.js";
import { sensesOf, type SightContent } from "./senses.js";
import { isEthereal, needsEtherealSight, seesIntoEthereal } from "../ethereal.js";
import { distance } from "./geometry.js";
import { spellWardOf } from "../resolution/spell-wards.js";
import { derivedUuid } from "./cast-sight.js";
import { sceneSight, sightIsCached, wallPieces } from "./sight.js";

/**
 * What each audience may know of the creatures on the map (ADR-0023): a player sees through their own characters, the
 * table screen and a replay through the whole party. With dynamic vision on, that is what those characters perceive;
 * with manual fog on, a creature wholly under the fog is left out too. This is the projections' one source for "may
 * this audience know of that creature".
 */

type Actor = GameState["actors"][number];
type Token = CombatState["tokens"][number];

export type AudienceSight = Readonly<{
  /** Dynamic vision is on for the live scene; when false `perceived` doesn't apply. */
  enabled: boolean;
  /** Creatures this audience must not learn of at all, treated as hidden from it like a GM-only one: on the live
   *  scene, those that aren't player characters and that none of its viewers perceive or that stand wholly under the
   *  fog; and those staged in a prepared scene in the same way, until they stand where the party can see them. */
  hidden: ReadonlySet<string>;
  /** With dynamic vision on, the placed creatures whose tokens it may receive. */
  perceived: ReadonlySet<string>;
  /** Placed creatures, its viewers aside, whose whole space the live scene's manual fog covers: their tokens stay off
   *  its map. */
  fogged: ReadonlySet<string>;
  /** Whose eyes it sees through. */
  viewerIds: readonly string[];
}>;

const NONE: ReadonlySet<string> = new Set();
const OFF: AudienceSight = { enabled: false, hidden: NONE, perceived: NONE, fogged: NONE, viewerIds: [] };

/** Whether an audience may receive a creature's token (the creature itself being known to it). */
export const tokenShown = (sight: AudienceSight, actorId: string) =>
  !sight.fogged.has(actorId) && (!sight.enabled || sight.perceived.has(actorId));

/** A token's space as a rect: its cells, or the drawn token on a map without a grid. */
function spaceOf(token: Token): Rect | null {
  if (!token.position) return null;
  const side = Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells);
  return { x: token.position.x - side / 2, y: token.position.y - side / 2, width: side, height: side };
}

/** The placed creatures whose whole space a scene's manual fog covers; none while its fog is off. A token any part of
 *  which is revealed is not covered. */
export function fogCovered(combat: Readonly<{ fog?: CombatState["fog"]; tokens: readonly Token[] }>): Set<string> {
  const covered = new Set<string>();
  if (combat.fog?.enabled !== true) return covered;
  const revealed = revealedRegion(combat.fog);
  if (revealed === "everything") return covered;
  for (const token of combat.tokens) {
    const space = spaceOf(token);
    if (space && !revealed.some((rect) => intersect(rect, space) !== null)) covered.add(token.actorId);
  }
  return covered;
}

/** A scene's combatants not yet on its map while its fog is on. The party can't see a creature that isn't there, so
 *  under the fog it stays unknown until it is placed where the fog is lifted, as dynamic vision treats it. */
function unplacedUnderFog(
  combat: Readonly<{ fog?: CombatState["fog"]; initiative: CombatState["initiative"]; tokens: readonly Token[] }>
): Set<string> {
  const unplaced = new Set<string>();
  if (combat.fog?.enabled !== true) return unplaced;
  const placedIds = new Set(combat.tokens.flatMap((token) => (token.position ? [token.actorId] : [])));
  for (const actorId of [...combat.initiative.map((entry) => entry.actorId), ...combat.tokens.map((t) => t.actorId)])
    if (!placedIds.has(actorId)) unplaced.add(actorId);
  return unplaced;
}

/** The creatures other than player characters staged in a prepared scene, and not on the live map, that the party
 *  couldn't see there: all of them with that scene's vision on, those wholly under its fog with fog on. The GM's
 *  ambush stays a secret while it is set up. */
function stagedUnseen(state: GameState): Set<string> {
  const live = new Set(state.combat.initiative.map((entry) => entry.actorId));
  const staged = new Set<string>();
  for (const scene of state.combat.scenes) {
    if (scene.id === state.combat.activeSceneId) continue;
    // A recording made before dynamic vision has none on its scenes either.
    const unseen =
      scene.combat.vision?.enabled === true
        ? new Set(scene.combat.initiative.map((entry) => entry.actorId))
        : new Set([...fogCovered(scene.combat), ...unplacedUnderFog(scene.combat)]);
    for (const actorId of unseen) if (!live.has(actorId)) staged.add(actorId);
  }
  const kinds = new Map(state.actors.map((actor) => [actor.id, actor.kind]));
  for (const actorId of staged) if (kinds.get(actorId) === "player-character") staged.delete(actorId);
  return staged;
}

/** With dynamic vision off, the creatures on the Border Ethereal that none of `viewerIds` sees into that plane to
 *  perceive: Truesight or See Invisibility by the distance between the tokens, or a viewer there itself. Dynamic vision
 *  answers the same question from the map. */
function etherealUnseen(state: GameState, viewerIds: readonly string[], content: SightContent): string[] {
  const ethereal = state.actors.filter((actor) => isEthereal(actor));
  if (ethereal.length === 0) return [];
  const pixelsPerFoot = state.combat.vision?.measure?.pixelsPerFoot;
  const at = (actorId: string) => state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  const viewers = viewerIds.flatMap((viewerId) => {
    const viewer = state.actors.find((actor) => actor.id === viewerId);
    return viewer ? [viewer] : [];
  });
  return ethereal
    .filter((target) => {
      const where = at(target.id);
      return !viewers.some((viewer) => {
        if (viewer.id === target.id || !needsEtherealSight(viewer, target)) return true;
        const from = at(viewer.id);
        const feet = pixelsPerFoot && from && where ? distance(from, where) / pixelsPerFoot : null;
        return seesIntoEthereal(sensesOf(state, viewer, content), feet);
      });
    })
    .map((actor) => actor.id);
}

/** The creatures seen only through a divination's sensor (Arcane Eye, Clairvoyance) that a ward keeps from it
 *  (Nondetection: "can't be perceived through magical scrying sensors"). */
function wardedFromSensors(
  state: GameState,
  viewerIds: readonly string[],
  perceivedBy: (viewerIds: readonly string[]) => ReadonlySet<string>,
  content: SightContent
): string[] {
  const sensors = viewerIds.flatMap((viewerId) => {
    const sensor = state.actors.find((actor) => actor.id === viewerId);
    const spell = sensor?.summon?.spell ? content.catalog?.spellRecord?.(sensor.summon.spell.id) : undefined;
    return sensor && spell?.school === "divination" ? [{ sensor, spell }] : [];
  });
  if (sensors.length === 0) return [];
  const eyes = new Set(viewerIds.filter((viewerId) => !sensors.some(({ sensor }) => sensor.id === viewerId)));
  const byEyes = perceivedBy([...eyes]);
  const wardContent = { resolveDefinition: content.definition, catalog: content.catalog };
  return state.actors
    .filter(
      (actor) =>
        !byEyes.has(actor.id) &&
        sensors.every(
          ({ sensor, spell }) =>
            !perceivedBy([sensor.id]).has(actor.id) ||
            spellWardOf(state, actor, spell, sensor.summon!.by, wardContent) !== null
        )
    )
    .map((actor) => actor.id);
}

const placed = (state: GameState, actorId: string) =>
  state.combat.tokens.some((token) => token.actorId === actorId && token.position !== null);
const inPlay = (actor: Actor) => actor.visibility === "public" && !actor.archived;

/** On a commander, while it sees through a creature it commands (a familiar's eyes, after a Bonus Action): the effect's
 *  source is that creature. */
export const SHARED_SIGHT_TAG = "shared-sight";

/** Whether a commanded creature's commander sees what it sees now: always (an Arcane Eye), or while the commander holds
 *  a shared sight of it (a familiar). */
function sharesSight(state: GameState, actor: Actor): boolean {
  if (actor.summon?.sight === "always") return true;
  if (actor.summon?.sight !== "bonus-action") return false;
  const commander = state.actors.find((candidate) => candidate.id === actor.control?.by);
  return (
    commander?.effects.some((effect) => effect.tags.includes(SHARED_SIGHT_TAG) && effect.sourceActorId === actor.id) ??
    false
  );
}

/** A player's own characters on the live map, and the creatures they command whose sight they share (an Arcane Eye,
 *  or a familiar while its commander looks through its eyes). */
export function playerViewerIds(state: GameState, sessionId: string): string[] {
  return state.actors
    .filter(
      (actor) =>
        inPlay(actor) &&
        placed(state, actor.id) &&
        (actor.ownerSessionId === sessionId ||
          (commandedBySession(state, actor, sessionId) && sharesSight(state, actor)))
    )
    .map((actor) => actor.id);
}

/** The creatures a player's characters command (`Actor.control`): theirs to act for, so never hidden from them. */
export function playerCommandedIds(state: GameState, sessionId: string): string[] {
  return state.actors
    .filter((actor) => inPlay(actor) && commandedBySession(state, actor, sessionId))
    .map((actor) => actor.id);
}

/** The party's characters on the live map, claimed or not: the table screen and a replay see through them. */
export function partyViewerIds(state: GameState): string[] {
  return state.actors
    .filter((actor) => actor.kind === "player-character" && inPlay(actor) && placed(state, actor.id))
    .map((actor) => actor.id);
}

const audienceCache = new WeakMap<GameState, Map<string, AudienceSight>>();

function cached<T>(cache: WeakMap<GameState, Map<string, T>>, state: GameState, key: string, compute: () => T): T {
  if (!Object.isFrozen(state)) return compute();
  let byKey = cache.get(state);
  if (!byKey) cache.set(state, (byKey = new Map()));
  const known = byKey.get(key);
  if (known !== undefined) return known;
  const value = compute();
  byKey.set(key, value);
  return value;
}

/** What an audience seeing through `viewerIds` may know of the creatures on the live and prepared scenes. `knownIds`
 *  are creatures it always knows of beside its viewers, as it does its own characters (those it commands). */
export function audienceSight(
  state: GameState,
  viewerIds: readonly string[],
  content: SightContent,
  knownIds: readonly string[] = []
): AudienceSight {
  const sight = sceneSight(state, content);
  const compute = () => {
    const hidden = stagedUnseen(state);
    const known = new Set(knownIds);
    // Its own characters are never lost to it under the fog.
    const fogged = fogCovered(state.combat);
    for (const viewerId of [...viewerIds, ...known]) fogged.delete(viewerId);
    const kinds = new Map(state.actors.map((actor) => [actor.id, actor.kind]));
    const unknown = (actorId: string) => kinds.get(actorId) !== "player-character" && !known.has(actorId);
    for (const actorId of fogged) if (unknown(actorId)) hidden.add(actorId);
    for (const actorId of unplacedUnderFog(state.combat)) if (unknown(actorId)) hidden.add(actorId);
    if (!sight.enabled)
      for (const actorId of etherealUnseen(state, viewerIds, content)) if (unknown(actorId)) hidden.add(actorId);
    for (const actorId of known) hidden.delete(actorId);
    if (!sight.enabled) return hidden.size === 0 && fogged.size === 0 ? OFF : { ...OFF, hidden, fogged, viewerIds };
    const perceived = new Set([...sight.perceivedBy(viewerIds), ...known]);
    for (const actorId of wardedFromSensors(state, viewerIds, sight.perceivedBy, content)) perceived.delete(actorId);
    const combatants = new Set([
      ...state.combat.initiative.map((entry) => entry.actorId),
      ...state.combat.tokens.map((token) => token.actorId)
    ]);
    for (const actorId of combatants) if (unknown(actorId) && !perceived.has(actorId)) hidden.add(actorId);
    return { enabled: true, hidden, perceived, fogged, viewerIds } satisfies AudienceSight;
  };
  // Cached only beside the sight it came from, so an answer built from partial content never outlives its caller.
  return sightIsCached(state, sight)
    ? cached(audienceCache, state, `${sight.enabled}|${viewerIds.join(",")}|${knownIds.join(",")}`, compute)
    : compute();
}

/** A player's audience: their own characters' eyes, and the creatures they command, which they always know of.
 *  Without a session (a spectator), the party's. */
export function playerSight(state: GameState, sessionId: string | undefined, content: SightContent): AudienceSight {
  if (sessionId === undefined) return audienceSight(state, partyViewerIds(state), content);
  return audienceSight(state, playerViewerIds(state, sessionId), content, playerCommandedIds(state, sessionId));
}

export function partySight(state: GameState, content: SightContent): AudienceSight {
  return audienceSight(state, partyViewerIds(state), content);
}

/**
 * The one test for "is this creature hidden from this audience as a GM-only one is" (ADR-0023): GM-only, or hidden
 * by sight or the fog. Without `sessionId` the audience is the table (the whole party's eyes), which every public
 * line and die follows, as does the table screen. With one it is that player's own characters', for a reply or prompt
 * only that player reads. Unknown ids count as hidden. The sight is built on the first question, so a caller that never asks
 * pays nothing.
 */
export function hiddenFrom(
  state: GameState,
  content: SightContent = {},
  sessionId?: string
): (actorId: string) => boolean {
  let hidden: ReadonlySet<string> | undefined;
  return (actorId) => {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor || actor.visibility !== "public") return true;
    if (actor.kind === "player-character") return false;
    hidden ??= playerSight(state, sessionId, content).hidden;
    return hidden.has(actorId);
  };
}

/** Makes GM-only the creatures in `actorIds` (none of them player characters) that a change took off the live scene
 *  while the table couldn't know of them. Sight and the fog hide only what is on a map, so a creature never seen would
 *  otherwise join every player's roster as it left. */
export function keepUnseenHidden(state: GameState, actorIds: Iterable<string>): void {
  const ids = new Set(actorIds);
  if (ids.size === 0) return;
  state.actors = state.actors.map((actor) =>
    ids.has(actor.id) && actor.kind !== "player-character" && actor.visibility === "public"
      ? { ...actor, visibility: "gm-only" as const }
      : actor
  );
}

/** The live scene's creatures that are hidden from the table now: initiative and tokens, by the shared check. */
export function hiddenCombatants(state: GameState, content: SightContent): Set<string> {
  const hidden = hiddenFrom(state, content);
  const ids = [...state.combat.initiative.map((entry) => entry.actorId), ...state.combat.tokens.map((t) => t.actorId)];
  return new Set(ids.filter((actorId) => state.actors.some((actor) => actor.id === actorId) && hidden(actorId)));
}

/** A public roll made in this command by a creature hidden from the table becomes GM-only, as a GM-only creature's
 *  is when recorded. Decided once, as it is made: judged later by who is seen now, a creature's rolls from while it hid
 *  would reach players the moment it stepped into view. The feed reads the same mark. */
export function hideRollsOfHidden(state: GameState, before: GameState, content: SightContent): void {
  const earlier = new Set(before.rolls.map((roll) => roll.id));
  const made = state.rolls.filter(
    (roll) => !earlier.has(roll.id) && roll.visibility === "public" && roll.actorId !== null
  );
  if (made.length === 0) return;
  const hidden = hiddenFrom(state, content);
  const hiddenIds = new Set(made.filter((roll) => hidden(roll.actorId!)).map((roll) => roll.id));
  if (hiddenIds.size === 0) return;
  state.rolls = state.rolls.map((roll) =>
    hiddenIds.has(roll.id) ? { ...roll, visibility: "gm-only" as const } : roll
  );
}

/** The party's remembered squares, decoded; null while nothing is remembered or the map's size changed under it. */
function explored(state: GameState): { grid: ExploredGrid; bytes: Uint8Array } | null {
  const vision = state.combat.vision;
  if (!vision.measure || !vision.explored) return null;
  const grid = exploredGridFor(vision.measure);
  const stored = vision.explored;
  if (stored.columns !== grid.columns || stored.rows !== grid.rows || Math.abs(stored.cellPx - grid.cellPx) > 1e-6)
    return null;
  return { grid, bytes: decodeBits(grid, stored.bits) };
}

/** What the party has seen on the live scene, as disjoint rects. */
export function exploredRectsOf(state: GameState): VisionRect[] {
  const memory = explored(state);
  return memory ? markedRects(memory.grid, memory.bytes) : [];
}

/** Points just either side of a wall along its length, to ask whether the squares beside it are in sight. */
function wallSamples(a: Point, b: Point, spacing: number): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return [a];
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const steps = Math.max(1, Math.ceil(length / spacing));
  const offset = spacing * 0.6;
  const samples: Point[] = [];
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    samples.push({ x: at.x + normal.x * offset, y: at.y + normal.y * offset });
    samples.push({ x: at.x - normal.x * offset, y: at.y - normal.y * offset });
  }
  return samples;
}

const visionCache = new WeakMap<GameState, Map<string, PlayerVision>>();

/** The vision block of one audience's projection: where it sees now, what the party has seen, and the walls in it. */
export function visionOf(state: GameState, viewerIds: readonly string[], content: SightContent): PlayerVision {
  const sight = sceneSight(state, content);
  const measure = state.combat.vision.measure;
  if (!sight.enabled || !measure) return { enabled: false };
  const compute = () => {
    // A light carried by a creature these eyes don't perceive would draw its carrier's position.
    const perceived = sight.perceivedBy(viewerIds);
    const area = sight.areaOf(viewerIds, (carrierId) => perceived.has(carrierId));
    const memory = explored(state);
    const grid = memory?.grid ?? exploredGridFor(measure);
    const now = emptyBits(grid);
    markPolygons(grid, now, area);
    const known = (point: Point) =>
      isMarked(grid, now, point) || (memory ? isMarked(grid, memory.bytes, point) : false);
    const walls: PlayerVisionWall[] = [];
    for (const wall of state.combat.vision.walls) {
      // A secret door is wall to players until the GM reveals it; a gap cut in a wall shows as the parts that stand.
      const secret = wall.kind === "door" && wall.door?.hidden === true;
      const pieces = wallPieces(wall);
      pieces.forEach((piece, index) => {
        const samples = wallSamples(piece.a, piece.b, grid.cellPx);
        if (!samples.some(known)) return;
        const door = wall.kind === "door" && !secret;
        const inSight = door && samples.some((point) => isMarked(grid, now, point));
        walls.push({
          id: index === 0 ? wall.id : derivedUuid(wall.id, `piece-${index}`),
          kind: secret ? "wall" : wall.kind,
          a: { ...piece.a },
          b: { ...piece.b },
          ...(inSight ? { open: wall.open === true } : {})
        });
      });
    }
    // Where in sight the light is bright, so the rest can be painted dim; none when the whole scene is bright.
    const bright = sight.brightOf(viewerIds, (carrierId) => perceived.has(carrierId));
    return {
      enabled: true as const,
      visible: area.map((polygon): VisionPolygon => flatPolygon(polygon)),
      ...(bright ? { bright: bright.map((polygon): VisionPolygon => flatPolygon(polygon)) } : {}),
      explored: exploredRectsOf(state),
      walls
    };
  };
  return sightIsCached(state, sight) ? cached(visionCache, state, viewerIds.join(","), compute) : compute();
}

/** Adds what the party sees now to what it has seen. Runs after every command, inside it; a no-op unless the live
 *  scene's vision is on. */
export function rememberExplored(state: GameState, content: SightContent): void {
  const vision = state.combat.vision;
  const sight = sceneSight(state, content);
  if (!sight.enabled || !vision.measure) return;
  const viewers = partyViewerIds(state);
  if (viewers.length === 0) return;
  // As for the projections: the party remembers no circle drawn by a light it can't place.
  const perceived = sight.perceivedBy(viewers);
  const area: Polygon[] = sight.areaOf(viewers, (carrierId) => perceived.has(carrierId));
  const memory = explored(state);
  const grid = memory?.grid ?? exploredGridFor(vision.measure);
  const bytes = memory?.bytes ?? emptyBits(grid);
  if (!markPolygons(grid, bytes, area) && memory) return;
  state.combat = {
    ...state.combat,
    vision: { ...vision, explored: { ...grid, bits: encodeBits(bytes) } }
  };
}
