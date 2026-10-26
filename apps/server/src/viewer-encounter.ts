import type { GameState } from "@vtt/domain";
import { healthBandOf } from "./hit-points.js";
import { conditionLabels, projectPublicInitiative } from "./projections.js";
import { visibleTerrain } from "./terrain.js";
import { visibleTraps } from "./traps.js";
import {
  exploredRectsOf,
  partySight,
  partyViewerIds,
  tokenShown,
  visionOf,
  type AudienceSight
} from "./vision/audience.js";
import type { SightContent } from "./vision/senses.js";
import type { ViewerEncounterScene, ViewerInitiative } from "./viewer-presentation.js";

/** The shared screen is in a room that may hold anyone, so it sees through the whole party: a creature no character
 *  perceives (dynamic vision) or that stands wholly under the fog is hidden from it as a GM-only one is. */
export function projectViewerInitiative(
  state: GameState,
  content: SightContent = {},
  sight: AudienceSight = partySight(state, content)
): ViewerInitiative {
  if (!state.combat.active) return { visible: false, round: 0, hiddenTurn: false, entries: [] };
  const publicEntries = projectPublicInitiative(state, sight.hidden);
  const hasPublicActiveEntry = publicEntries.some((entry) => entry.active);
  return {
    visible: true,
    round: state.combat.round,
    hiddenTurn: state.combat.turnActorId !== null && !hasPublicActiveEntry,
    // Entries carry public-only conditions (ids + labels), so the viewer renders the same dots as players.
    entries: publicEntries.map((entry) => ({
      actorId: entry.actorId,
      name: entry.name,
      initiative: entry.score,
      active: entry.active,
      health: entry.health,
      conditions: entry.conditions,
      conditionIds: entry.conditionIds
    }))
  };
}

export function projectViewerEncounterScene(
  state: GameState,
  now = Date.now(),
  content: SightContent = {},
  sight: AudienceSight = partySight(state, content)
): ViewerEncounterScene {
  if (!state.combat.mapAssetId) return { mapAssetId: null, tokens: [], annotations: [] };
  const fog = { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) };
  // As for players: only the terrain the fog reveals, and with dynamic vision only what the party has seen.
  const terrain = visibleTerrain(state.combat, sight.enabled ? exploredRectsOf(state) : undefined);
  const visionBlock = visionOf(state, partyViewerIds(state), content);
  const vision = visionBlock.enabled
    ? {
        vision: {
          visible: visionBlock.visible,
          ...(visionBlock.bright ? { bright: visionBlock.bright } : {}),
          explored: visionBlock.explored
        }
      }
    : {};
  // A live scene shows what players see on their own screens: its map, fog and terrain, the public tokens the GM
  // has placed that the party may see, and public drawings. Before the fight only placed tokens show.
  const publicActors = new Map(
    state.actors
      .filter(
        (actor) =>
          actor.visibility === "public" && !actor.archived && !sight.hidden.has(actor.id) && tokenShown(sight, actor.id)
      )
      .map((actor) => [actor.id, actor])
  );
  return {
    mapAssetId: state.combat.mapAssetId,
    tokens: state.combat.tokens.flatMap((token) => {
      const actor = publicActors.get(token.actorId);
      if (!actor || !token.position) return [];
      // The richer style reaches the shared screen only when aimed at everyone; the fill derives from the
      // band, so exact HP never reaches it.
      const effective = actor.healthDisplay ?? state.combat.healthDisplay;
      const displayStyle = effective.audience === "all" && effective.style !== "band" ? effective.style : null;
      return [
        {
          actorId: actor.id,
          name: actor.name,
          kind: actor.kind,
          position: token.position,
          sizePx: token.sizePx,
          active: state.combat.turnActorId === actor.id,
          health: healthBandOf(actor.hp),
          conditions: conditionLabels(actor),
          // Ids parallel the labels so the shared screen picks the same glyphs as the table; public actors only.
          conditionIds: actor.conditions.map((condition) => condition.id),
          ...(actor.tokenAssetId ? { tokenAssetId: actor.tokenAssetId } : {}),
          ...(displayStyle ? { healthDisplay: { style: displayStyle } } : {}),
          // Height is where the token is, as public as its position.
          ...(token.altitudeFeet ? { altitudeFeet: token.altitudeFeet } : {})
        }
      ];
    }),
    // Public display: only `public` annotations, minus expired ones.
    annotations: state.combat.annotations.flatMap((annotation) =>
      annotation.visibility === "public" && (annotation.expiresAt === null || annotation.expiresAt > now)
        ? [
            {
              id: annotation.id,
              kind: annotation.kind,
              shape: annotation.shape,
              origin: annotation.geometry.origin,
              target: annotation.geometry.target,
              sizeFeet: annotation.geometry.sizeFeet,
              color: annotation.color,
              label: annotation.label
            }
          ]
        : []
    ),
    fog,
    terrain,
    // The traps the party has found, as players see them.
    ...(visibleTraps(state.combat.traps).length > 0 ? { traps: visibleTraps(state.combat.traps) } : {}),
    ...vision
  };
}

export function projectViewerEncounter(state: GameState, now = Date.now(), content: SightContent = {}) {
  const sight = partySight(state, content);
  return {
    initiative: projectViewerInitiative(state, content, sight),
    encounter: projectViewerEncounterScene(state, now, content, sight)
  };
}
