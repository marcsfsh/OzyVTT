import type { Actor, GameState } from "@vtt/domain";
import { healthBandOf } from "./hit-points.js";
import { projectPublicInitiative } from "./projections.js";
import type { ViewerEncounterScene, ViewerInitiative } from "./viewer-presentation.js";

/** Display labels for the shared screen (which has no rules-reference lookup): "Prone", "Exhaustion 3". */
function conditionLabels(actor: Actor): readonly string[] {
  return actor.conditions.map((condition) => `${condition.id.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")}${condition.level !== undefined ? ` ${condition.level}` : ""}`);
}

export function projectViewerInitiative(state: GameState): ViewerInitiative {
  if (!state.combat.active) return { visible: false, round: 0, hiddenTurn: false, entries: [] };
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  const publicEntries = projectPublicInitiative(state);
  const hasPublicActiveEntry = publicEntries.some((entry) => entry.active);
  return {
    visible: true,
    round: state.combat.round,
    hiddenTurn: state.combat.turnActorId !== null && !hasPublicActiveEntry,
    entries: publicEntries.map((entry) => {
      const actor = publicActors.get(entry.actorId);
      return { actorId: entry.actorId, name: entry.name, initiative: entry.score, active: entry.active, health: entry.health, conditions: actor ? conditionLabels(actor) : [] };
    })
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
        active: state.combat.turnActorId === actor.id,
        health: healthBandOf(actor.hp),
        conditions: conditionLabels(actor)
      }] : [];
    }),
    // The shared screen is a public display, so only `public` annotations reach it; expired
    // measurements drop out here (the server re-syncs the viewer at each annotation expiry).
    annotations: state.combat.annotations.flatMap((annotation) =>
      annotation.visibility === "public" && (annotation.expiresAt === null || annotation.expiresAt > now)
        ? [{ id: annotation.id, kind: annotation.kind, shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet, color: annotation.color, label: annotation.label }]
        : [])
  };
}

export function projectViewerEncounter(state: GameState, now = Date.now()) {
  return { initiative: projectViewerInitiative(state), encounter: projectViewerEncounterScene(state, now) };
}
