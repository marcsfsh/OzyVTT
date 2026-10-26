import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { areEnemies } from "./creature-sides.js";
import type { EffectNarration } from "./effects.js";
import { applyDamageDetailed, type DamageDeps } from "./hit-points.js";
import { holdsFeature } from "./class-features.js";
import { cutWall, cuts } from "./spell-walls.js";

/**
 * How a creature's traits let it past walls and through other creatures' spaces (SRD 5.2.1 stat blocks): Amorphous,
 * Compression and the elementals' forms "move through a space as narrow as 1 inch without expending extra movement",
 * a swarm "through any opening large enough for a Tiny" creature, Earth Glide burrows through earth and stone and
 * Tunneler through solid rock at half its Burrow Speed, the Invisible Stalker's Air Form and Water Form stop only in an
 * enemy's space, and Fire Form burns a creature the first time the elemental enters its space on a turn.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/** A stat block's trait text by name, from the SRD 2024 extension. */
function traitText(definition: ActorDefinition | undefined, name: string): string | null {
  for (const bag of Object.values(definition?.extensions ?? {})) {
    const traits = bag !== null && typeof bag === "object" ? (bag as { traits?: unknown }).traits : undefined;
    if (!Array.isArray(traits)) continue;
    for (const trait of traits) {
      const record = trait as { name?: unknown; description?: unknown };
      if (record.name === name && typeof record.description === "string") return record.description;
    }
  }
  return null;
}

const traitTexts = (definition: ActorDefinition | undefined): string[] => {
  const texts: string[] = [];
  for (const bag of Object.values(definition?.extensions ?? {})) {
    const traits = bag !== null && typeof bag === "object" ? (bag as { traits?: unknown }).traits : undefined;
    if (!Array.isArray(traits)) continue;
    for (const trait of traits) {
      const description = (trait as { description?: unknown }).description;
      if (typeof description === "string") texts.push(description);
    }
  }
  return texts;
};

/** How narrow an opening the creature passes with no extra movement: any gap a point fits through ("as narrow as 1
 *  inch"), or one a Tiny creature fits through (a swarm); null when it squeezes as its size says. */
export function openingPassage(definition: ActorDefinition | undefined): "point" | "tiny" | null {
  const texts = traitTexts(definition);
  if (texts.some((text) => /\bspace as narrow as 1 inch\b/.test(text))) return "point";
  if (texts.some((text) => /\bany opening large enough for a Tiny\b/.test(text))) return "tiny";
  return null;
}

/** How the creature burrows through a wall: freely through earth and stone (Earth Glide), or through solid rock at half
 *  its Burrow Speed, each foot costing two (Tunneler). Null when a wall stops its burrowing. */
export function burrowsThroughWalls(definition: ActorDefinition | undefined): "free" | "half" | null {
  if (traitText(definition, "Earth Glide") !== null) return "free";
  if (traitText(definition, "Tunneler") !== null) return "half";
  return null;
}

/** What lets its wearer move through earth and rock as Difficult Terrain: a Ring of Elemental Command of Earth ("You can
 *  move through solid earth or rock as if those areas were Difficult Terrain"), attuned. The map's walls stand for both. */
const EARTH_PASSAGE_ITEMS: ReadonlySet<string> = new Set(["ring-of-elemental-command#earth"]);

export function passesEarth(actor: Actor): boolean {
  return actor.inventory.some(
    (row) => row.equipped && row.attuned && EARTH_PASSAGE_ITEMS.has(`${row.recordId ?? row.id}#${row.variantId ?? ""}`)
  );
}

/** Where a path's steps cross a wall, as points on the wall. */
function crossings(wall: Readonly<{ a: Point; b: Point }>, path: readonly Point[]): Point[] {
  const points: Point[] = [];
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const d1 = cross(wall.a, wall.b, from);
    const d2 = cross(wall.a, wall.b, to);
    const d3 = cross(from, to, wall.a);
    const d4 = cross(from, to, wall.b);
    if (d1 * d2 >= 0 || d3 * d4 >= 0) continue;
    const t = d1 / (d1 - d2);
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return points;
}

/** SRD Tunneler: the creature "leaves a 10-foot-diameter tunnel in its wake". A burrowing move through the map's walls
 *  cuts a lasting 10-foot gap where it crossed each one; a wall a spell raised stops it, so it is never crossed. */
export function tunnelBehind(
  state: GameState,
  mover: Actor,
  path: readonly Point[],
  pixelsPerFoot: number,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): EffectNarration[] {
  const definition = mover.definitionId ? resolveDefinition(mover.definitionId) : undefined;
  if (traitText(definition, "Tunneler") === null || path.length < 2) return [];
  let tunnels = 0;
  for (const wall of state.combat.vision.walls) {
    if (wall.kind !== "wall" || wall.source !== undefined) continue;
    for (const at of crossings(wall, path)) {
      cutWall(state, wall.id, at, 10, pixelsPerFoot, undefined);
      tunnels += 1;
    }
  }
  return tunnels > 0
    ? [{ kind: "effect", text: `${mover.name} leaves a tunnel through the rock behind it.`, actorId: mover.id }]
    : [];
}

/** SRD Incorporeal Movement: "It takes 5 (1d10) Force damage if it ends its turn inside an object." Walls are lines, so
 *  a creature whose space a wall, a closed door or a window crosses as its turn ends is inside it. */
export function insideAnObject(
  state: GameState,
  actorId: string,
  deps: DamageDeps & Readonly<{ rollDie: (sides: number) => number }>
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const definition = actor?.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot;
  if (!actor || !token || !pixelsPerFoot || !holdsFeature(definition, "incorporeal-movement", "Incorporeal Movement"))
    return [];
  const inside = state.combat.vision.walls.some(
    (wall) => (wall.kind !== "door" || wall.open !== true) && cuts(token, wall, 5 * pixelsPerFoot)
  );
  if (!inside) return [];
  const amount = deps.rollDie(10);
  const outcome = applyDamageDetailed(
    state,
    actor.id,
    { amount, parts: [{ amount, type: "force" }], sourceName: "Incorporeal Movement" },
    { role: "gm" },
    deps
  );
  return [
    {
      kind: "damage",
      text: `${actor.name} ends its turn inside an object and takes ${outcome.application.totalApplied} Force damage.`,
      actorId: actor.id
    },
    ...outcome.events
  ];
}

/** SRD Ring of Elemental Command (Earth): "If you end your turn there, you are shunted out to the nearest unoccupied
 *  space you last occupied." Walls are lines, so a wearer whose space a wall crosses as its turn ends is in the rock: it
 *  moves to the nearest square on the map that no wall crosses and no other creature stands in. */
export function shuntOutOfEarth(state: GameState, actorId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot;
  if (!actor || !token?.position || !pixelsPerFoot || !passesEarth(actor)) return [];
  const square = 5 * pixelsPerFoot;
  const inRock = (position: Point) =>
    state.combat.vision.walls.some(
      (wall) => (wall.kind !== "door" || wall.open !== true) && cuts({ ...token, position }, wall, square)
    );
  const taken = (position: Point) =>
    state.combat.tokens.some(
      (other) =>
        other.actorId !== actorId &&
        other.position !== null &&
        Math.abs(other.position.x - position.x) < square &&
        Math.abs(other.position.y - position.y) < square
    );
  const from = token.position;
  if (!inRock(from)) return [];
  for (let ring = 1; ring <= 6; ring++) {
    const spots: Point[] = [];
    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring)
          spots.push({ x: from.x + dx * square, y: from.y + dy * square });
    spots.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    const out = spots.find((spot) => spot.x >= 0 && spot.y >= 0 && !inRock(spot) && !taken(spot));
    if (!out) continue;
    token.position = out;
    return [{ kind: "effect", text: `${actor.name} ends its turn in the rock and is shunted out.`, actorId }];
  }
  return [];
}

/** Air Form and Water Form as some stat blocks print them: "can enter an enemy's space and stop there". */
export function stopsOnlyInEnemySpace(definition: ActorDefinition | undefined): boolean {
  return ["Air Form", "Water Form"].some((name) => /\ban enemy's space\b/.test(traitText(definition, name) ?? ""));
}

/** The turn's mark that this mover has burned this creature with Fire Form. */
const burnKey = (moverId: string, targetId: string) => `${moverId}:fire-form:${targetId}`;

/**
 * SRD Fire Form: "The first time it enters a creature's space on a turn, that creature takes 5 (1d10) Fire damage." The
 * creatures whose spaces the mover's path entered, each burned once a turn, the damage rolled by the server.
 */
export function fireFormBurns(
  state: GameState,
  mover: Actor,
  path: readonly Point[],
  deps: DamageDeps & Readonly<{ rollDie: (sides: number) => number; squarePx: number }>
): EffectNarration[] {
  const definition = mover.definitionId ? deps.resolveDefinition(mover.definitionId) : undefined;
  if (traitText(definition, "Fire Form") === null || path.length < 2) return [];
  const events: EffectNarration[] = [];
  for (const token of state.combat.tokens) {
    if (token.actorId === mover.id || !token.position) continue;
    const half = (deps.squarePx * token.sizeCells) / 2;
    const at = token.position;
    // Entered: a step after the start lies in its space.
    const entered = path
      .slice(1)
      .some((point) => Math.abs(point.x - at.x) < half - 0.5 && Math.abs(point.y - at.y) < half - 0.5);
    if (!entered) continue;
    const key = burnKey(mover.id, token.actorId);
    if ((state.combat.turn.turnUses[key] ?? 0) > 0) continue;
    const target = state.actors.find((actor) => actor.id === token.actorId);
    if (!target || target.hp.current <= 0) continue;
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
    };
    const amount = deps.rollDie(10);
    const outcome = applyDamageDetailed(
      state,
      target.id,
      { amount, parts: [{ amount, type: "fire" }], sourceActorId: mover.id, sourceName: mover.name },
      { role: "gm" },
      deps
    );
    events.push({
      kind: "damage",
      text: `${target.name} takes ${outcome.application.totalApplied} Fire damage from ${mover.name}'s Fire Form.`,
      actorId: target.id,
      source: { actorId: mover.id, name: mover.name }
    });
    events.push(...outcome.events);
  }
  return events;
}

/** Whether a creature with Air Form or Water Form printed for enemies may stop where it ends: in no creature's space but
 *  an enemy's. */
export function endsInFriendlySpace(
  state: GameState,
  mover: Actor,
  occupantIds: readonly string[],
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): boolean {
  return occupantIds.some((id) => {
    const occupant = state.actors.find((actor) => actor.id === id);
    return occupant !== undefined && !areEnemies(mover, occupant, resolveDefinition);
  });
}
