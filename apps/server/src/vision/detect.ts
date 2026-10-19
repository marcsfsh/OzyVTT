import type { GameState, PlayerSensedCreature } from "@vtt/domain";
import { isIncapacitated } from "../condition-rules.js";
import { spellWardOf, typeSenseWardOf } from "../resolution/spell-wards.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { clearLine, distance } from "./geometry.js";
import { definitionOf, type SightContent } from "./senses.js";
import { segmentOf } from "./sight.js";

/**
 * The creatures a player's characters sense without seeing them (Divine Sense: "you know the location of any creature
 * of those types within 60 feet of yourself, and you know its creature type"). Each comes from an effect's `detects`
 * on one of `viewerIds`, and reaches only that player: where the creature stands and its type, nothing else. Only
 * public creatures on the live map count, so a GM-only one stays the GM's secret, and only with dynamic vision on.
 */

type Token = GameState["combat"]["tokens"][number];

/** How far a token's space reaches past the middle of its nearest square, in pixels: none for a creature of one
 *  square, so the distance between two of them is from centre to centre, as the grid counts it. */
const reachOf = (token: Token) =>
  Math.max(
    0,
    (Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) - (token.gridSizePx ?? token.sizePx)) / 2
  );

export function sensedBy(
  state: GameState,
  viewerIds: readonly string[],
  content: SightContent,
  shown: (actorId: string) => boolean
): PlayerSensedCreature[] {
  const vision = state.combat.vision;
  const pixelsPerFoot = vision.measure?.pixelsPerFoot;
  if (!vision.enabled || !pixelsPerFoot) return [];
  const tokens = new Map(state.combat.tokens.flatMap((token) => (token.position ? [[token.actorId, token]] : [])));
  const senses = viewerIds.flatMap((viewerId) => {
    const viewer = state.actors.find((actor) => actor.id === viewerId);
    const token = tokens.get(viewerId);
    // "For the next 10 minutes or until you have the Incapacitated condition."
    if (!viewer || !token || isIncapacitated(viewer)) return [];
    return viewer.effects.flatMap((effect) => {
      if (!effect.detects) return [];
      // A spell's detection (Detect Evil and Good) passes over a creature warded against it (Nondetection).
      const spell = effect.spell ? content.catalog?.spellRecord?.(effect.spell.id) : undefined;
      return [{ token, detects: effect.detects, spell, viewerId }];
    });
  });
  if (senses.length === 0) return [];
  const walls = vision.walls.filter((wall) => wall.kind === "wall" || (wall.kind === "door" && wall.open !== true));
  const segments = walls.map(segmentOf);
  const sensed: PlayerSensedCreature[] = [];
  for (const actor of state.actors) {
    if (actor.visibility !== "public" || actor.archived || viewerIds.includes(actor.id) || shown(actor.id)) continue;
    const token = tokens.get(actor.id);
    if (!token?.position) continue;
    const type = creatureTypeOf(actor, definitionOf(state, actor, content));
    if (type === null) continue;
    const reached = senses.some(({ token: from, detects, spell, viewerId }) => {
      if (!detects.creatureTypes.includes(type)) return false;
      const wardContent = { resolveDefinition: content.definition, catalog: content.catalog };
      // Every such sense tells the creature's type, which a Ring of Mind Shielding keeps from any magic.
      const warded =
        (spell !== undefined && spellWardOf(state, actor, spell, viewerId, wardContent)) ||
        typeSenseWardOf(actor, wardContent);
      if (warded) return false;
      const feet = (distance(from.position!, token.position!) - reachOf(from) - reachOf(token)) / pixelsPerFoot;
      if (feet > detects.feet + 0.5) return false;
      return detects.blockedByWalls !== true || clearLine(from.position!, token.position!, segments);
    });
    if (reached) sensed.push({ x: token.position.x, y: token.position.y, creatureType: type });
  }
  return sensed;
}
