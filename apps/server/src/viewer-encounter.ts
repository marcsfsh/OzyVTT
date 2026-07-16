import type { GameState } from "@vtt/domain";
import { projectPublicInitiative } from "./projections.js";
import type { ViewerInitiative } from "./viewer-presentation.js";

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
