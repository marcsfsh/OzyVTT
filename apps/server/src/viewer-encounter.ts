import type { GameState } from "@vtt/domain";
import { projectPublicInitiative } from "./projections.js";
import type { ViewerEncounterScene, ViewerInitiative } from "./viewer-presentation.js";

export function projectViewerInitiative(state: GameState): ViewerInitiative {
  if (!state.combat.active) return { visible: false, round: 0, hiddenTurn: false, entries: [] };
  const publicEntries = projectPublicInitiative(state);
  const hasPublicActiveEntry = publicEntries.some((entry) => entry.active);
  return {
    visible: true,
    round: state.combat.round,
    hiddenTurn: state.combat.turnActorId !== null && !hasPublicActiveEntry,
    entries: publicEntries.map((entry) => ({ actorId: entry.actorId, name: entry.name, initiative: entry.score, active: entry.active }))
  };
}

export function projectViewerEncounterScene(state: GameState, now = Date.now()): ViewerEncounterScene {
  if (!state.combat.active || !state.combat.mapAssetId) return { mapAssetId: null, tokens: [], annotations: [] };
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  return {
    mapAssetId: state.combat.mapAssetId,
    tokens: state.combat.tokens.flatMap((token) => {
      const actor = publicActors.get(token.actorId);
      return actor && token.position ? [{
        actorId: actor.id,
        name: actor.name,
        kind: actor.kind,
        position: token.position,
        sizePx: token.sizePx,
        active: state.combat.turnActorId === actor.id
      }] : [];
    }),
    // The shared screen is a public display, so only `public` annotations reach it; expired
    // measurements drop out here (the server re-syncs the viewer at each annotation expiry).
    annotations: state.combat.annotations.flatMap((annotation) =>
      annotation.visibility === "public" && (annotation.expiresAt === null || annotation.expiresAt > now)
        ? [{ id: annotation.id, kind: annotation.kind, shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }]
        : [])
  };
}

export function projectViewerEncounter(state: GameState, now = Date.now()) {
  return { initiative: projectViewerInitiative(state), encounter: projectViewerEncounterScene(state, now) };
}
