import type { GameState, PlayerSensedCreature } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition, type Detects } from "@vtt/schemas";
import { isIncapacitated } from "../condition-rules.js";
import { areEnemies } from "../creature-sides.js";
import { rowRecord } from "../item-records.js";
import { spellWardOf, typeSenseWardOf } from "../resolution/spell-wards.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { clearLine, distance } from "./geometry.js";
import { definitionOf, type SightContent } from "./senses.js";
import { segmentOf } from "./sight.js";

/**
 * What a player's characters sense beside what they see (SRD 5.2.1), each from an effect's `detects` on one of
 * `viewerIds`, reaching only that player:
 * - creature types (Divine Sense, Detect Evil and Good): where each creature of them stands, unseen or not, and its type;
 * - `magic` (Detect Magic): the creatures in sight that bear magic, a magic item or a spell's effect, with the schools of
 *   those spells, once the bearer has taken the Magic action to see the auras;
 * - `poison` (Detect Poison and Disease): "the location of poisons, poison- or venom-bearing creatures, and magical
 *   contagions ... You sense the kind of poison, creature, or contagion";
 * - `minds` (Detect Thoughts): the creatures with an Intelligence of 4 or more;
 * - `nearestHostile` (a Wand of Enemy Detection): "the direction of the nearest creature Hostile to you ... but not its
 *   distance", drawn one square from the bearer toward it.
 * Only public creatures on the live map count, so a GM-only one stays the GM's secret, and only with dynamic vision on.
 */

type Actor = GameState["actors"][number];
type Token = GameState["combat"]["tokens"][number];

/** How far a token's space reaches past the middle of its nearest square, in pixels: none for a creature of one
 *  square, so the distance between two of them is from centre to centre, as the grid counts it. */
const reachOf = (token: Token) =>
  Math.max(
    0,
    (Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) - (token.gridSizePx ?? token.sizePx)) / 2
  );

/** The poisons a creature can carry (Basic Poison, a Potion of Poison). */
const POISON_ITEMS: ReadonlySet<string> = new Set(["basic-poison", "potion-of-poison"]);

/** Whether a stat block's actions deal Poison damage or impose the Poisoned condition: a poisonous or venomous creature. */
function poisonous(definition: ActorDefinition | undefined): boolean {
  return (definition?.actions ?? []).some(
    (action) =>
      action.damage.some((part) => part.type === "poison") ||
      (action.save?.failureConditions ?? []).includes("poisoned") ||
      (action.onHit ?? []).some((rider) => (rider.conditions ?? []).some((condition) => condition.id === "poisoned"))
  );
}

/** What a sense finds on a creature, as its player reads it, or null when it finds nothing. */
function found(state: GameState, actor: Actor, detects: Detects, content: SightContent, seen: boolean): string | null {
  const definition = definitionOf(state, actor, content);
  const catalog = content.catalog;
  const kinds = detects.kinds ?? [];
  if (kinds.includes("magic") && seen && (detects.afterAction !== true || detects.revealed === true)) {
    const items = actor.inventory.some((row) => row.quantity > 0 && rowRecord(catalog, row)?.isMagic === true);
    const schools = [
      ...new Set(
        actor.effects.flatMap((effect) => {
          const school = effect.spell ? catalog?.spellRecord?.(effect.spell.id)?.school : undefined;
          return school ? [school] : [];
        })
      )
    ];
    if (items || schools.length > 0) return schools.length > 0 ? `magic: ${schools.join(", ")}` : "magic";
  }
  if (kinds.includes("poison")) {
    if (actor.effects.some((effect) => effect.spell?.id === "contagion")) return "a magical contagion";
    if (poisonous(definition)) return `a venomous ${definition?.name ?? "creature"}`;
    const poison = actor.inventory.find((row) => row.quantity > 0 && POISON_ITEMS.has(catalogIdOf(row)));
    if (poison) return `poison: ${poison.name}`;
  }
  if (kinds.includes("minds") && (definition?.abilityScores.int ?? 0) >= 4) return "a mind";
  return null;
}

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
      return [{ token, detects: effect.detects, spell, viewer }];
    });
  });
  if (senses.length === 0) return [];
  const walls = vision.walls.filter((wall) => wall.kind === "wall" || (wall.kind === "door" && wall.open !== true));
  const segments = walls.map(segmentOf);
  const wardContent = { resolveDefinition: content.definition, catalog: content.catalog };
  const sensed: PlayerSensedCreature[] = [];
  const reaches = (from: Token, to: Token, detects: Detects) => {
    const feet = (distance(from.position!, to.position!) - reachOf(from) - reachOf(to)) / pixelsPerFoot;
    if (feet > detects.feet + 0.5) return false;
    return detects.blockedByWalls !== true || clearLine(from.position!, to.position!, segments);
  };
  for (const actor of state.actors) {
    if (actor.visibility !== "public" || actor.archived || viewerIds.includes(actor.id)) continue;
    const token = tokens.get(actor.id);
    if (!token?.position) continue;
    const seen = shown(actor.id);
    for (const { token: from, detects, spell, viewer } of senses) {
      if (!reaches(from, token, detects)) continue;
      if (spell !== undefined && spellWardOf(state, actor, spell, viewer.id, wardContent)) continue;
      const type = creatureTypeOf(actor, definitionOf(state, actor, content));
      // Every sense of a type tells it, which a Ring of Mind Shielding keeps from any magic.
      if (!seen && type !== null && detects.creatureTypes?.includes(type) && !typeSenseWardOf(actor, wardContent)) {
        sensed.push({ x: token.position.x, y: token.position.y, creatureType: type });
        break;
      }
      const what = found(state, actor, detects, content, seen);
      if (what !== null) {
        sensed.push({ x: token.position.x, y: token.position.y, creatureType: type ?? "creature", sense: what });
        break;
      }
    }
  }
  // The nearest Hostile creature's direction, one square from the bearer toward it.
  for (const { token: from, detects, viewer } of senses) {
    if (!detects.nearestHostile) continue;
    let nearest: { token: Token; apart: number } | null = null;
    for (const actor of state.actors) {
      const token = tokens.get(actor.id);
      if (actor.visibility !== "public" || actor.archived || !token || !reaches(from, token, detects)) continue;
      if (!areEnemies(viewer, actor, content.definition)) continue;
      const apart = distance(from.position!, token.position!);
      if (apart > 0 && (nearest === null || apart < nearest.apart)) nearest = { token, apart };
    }
    if (!nearest) continue;
    const step = (from.gridSizePx ?? from.sizePx) / nearest.apart;
    sensed.push({
      x: from.position!.x + (nearest.token.position!.x - from.position!.x) * step,
      y: from.position!.y + (nearest.token.position!.y - from.position!.y) * step,
      creatureType: "creature",
      sense: "the nearest Hostile creature, this way"
    });
  }
  return sensed;
}
