import type { GameState } from "@vtt/domain";
import { healthBandOf } from "./hit-points.js";
import { conditionLabels, projectPublicInitiative } from "./projections.js";
import type { ViewerEncounterScene, ViewerInitiative } from "./viewer-presentation.js";

export function projectViewerInitiative(state: GameState): ViewerInitiative {
  if (!state.combat.active) return { visible: false, round: 0, hiddenTurn: false, entries: [] };
  const publicEntries = projectPublicInitiative(state);
  const hasPublicActiveEntry = publicEntries.some((entry) => entry.active);
  return {
    visible: true,
    round: state.combat.round,
    hiddenTurn: state.combat.turnActorId !== null && !hasPublicActiveEntry,
    // The shared entry already carries public-only conditions (ids + labels); the viewer renders the
    // same dots as the player from that single source (score is surfaced as `initiative` here).
    entries: publicEntries.map((entry) => ({ actorId: entry.actorId, name: entry.name, initiative: entry.score, active: entry.active, health: entry.health, conditions: entry.conditions, conditionIds: entry.conditionIds }))
  };
}

export function projectViewerEncounterScene(state: GameState, now = Date.now()): ViewerEncounterScene {
  if (!state.combat.mapAssetId) return { mapAssetId: null, tokens: [], annotations: [] };
  const fog = { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) };
  // A live scene shows its map (and any prepared fog) on the shared screen the moment it goes live, so
  // "go live" is one action. Combatant tokens and drawings only appear once the fight is running - before
  // that the map is just the scene backdrop and no combatant data reaches the public screen.
  if (!state.combat.active) return { mapAssetId: state.combat.mapAssetId, tokens: [], annotations: [], fog };
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  return {
    mapAssetId: state.combat.mapAssetId,
    tokens: state.combat.tokens.flatMap((token) => {
      const actor = publicActors.get(token.actorId);
      if (!actor || !token.position) return [];
      // Effective per-token health display (override or table default). The shared screen only ever
      // learns the bar/ring style when the GM aimed it at everyone (audience "all"); it derives the
      // fill from the band below, so exact HP never reaches it. Band stays the coarse badge.
      const effective = actor.healthDisplay ?? state.combat.healthDisplay;
      const displayStyle = effective.audience === "all" && effective.style !== "band" ? effective.style : null;
      return [{
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
        ...(displayStyle ? { healthDisplay: { style: displayStyle } } : {})
      }];
    }),
    // The shared screen is a public display, so only `public` annotations reach it; expired
    // measurements drop out here (the server re-syncs the viewer at each annotation expiry).
    annotations: state.combat.annotations.flatMap((annotation) =>
      annotation.visibility === "public" && (annotation.expiresAt === null || annotation.expiresAt > now)
        ? [{ id: annotation.id, kind: annotation.kind, shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet, color: annotation.color, label: annotation.label }]
        : []),
    fog
  };
}

export function projectViewerEncounter(state: GameState, now = Date.now()) {
  return { initiative: projectViewerInitiative(state), encounter: projectViewerEncounterScene(state, now) };
}
