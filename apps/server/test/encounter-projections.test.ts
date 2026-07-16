import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { projectPlayerCombat, projectPlayerView } from "../src/projections.js";
import { projectViewerInitiative } from "../src/viewer-encounter.js";

const PUBLIC = "40000000-0000-4000-8000-000000000001";
const HIDDEN = "40000000-0000-4000-8000-000000000002";
const MAP = "50000000-0000-5000-8000-000000000001";

function game(turnActorId: string) {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: PUBLIC, name: "Visible Hero", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } },
      { id: HIDDEN, name: "Secret Lurker", kind: "monster", visibility: "gm-only", hp: { current: 10, maximum: 10 }, notes: "surprise" }
    ],
    combat: { active: true, round: 3, turnActorId, mapAssetId: MAP, initiative: [{ actorId: HIDDEN, score: 22 }, { actorId: PUBLIC, score: 18 }] }
  });
}

describe("recipient-safe encounter projections", () => {
  it("omits hidden combatants and reports a safe hidden-turn indicator", () => {
    const state = game(HIDDEN);
    const combat = projectPlayerCombat(state);
    expect(combat).toEqual({ active: true, round: 3, turnActorId: null, mapAssetId: MAP, hiddenTurn: true, initiative: [{ actorId: PUBLIC, name: "Visible Hero", score: 18, active: false }] });
    const serialized = JSON.stringify(projectPlayerView(state, undefined, () => null));
    expect(serialized).not.toContain(HIDDEN);
    expect(serialized).not.toContain("Secret Lurker");
    expect(serialized).not.toContain("surprise");
  });

  it("marks a public current turn for players and the shared viewer", () => {
    const state = game(PUBLIC);
    expect(projectPlayerCombat(state)).toMatchObject({ turnActorId: PUBLIC, hiddenTurn: false, initiative: [{ actorId: PUBLIC, active: true }] });
    expect(projectViewerInitiative(state)).toEqual({ visible: true, round: 3, hiddenTurn: false, entries: [{ actorId: PUBLIC, name: "Visible Hero", initiative: 18, active: true }] });
  });

  it("hides the Initiative list after combat ends", () => {
    const state = game(PUBLIC); state.combat = { ...state.combat, active: false, turnActorId: null };
    expect(projectViewerInitiative(state)).toEqual({ visible: false, round: 0, hiddenTurn: false, entries: [] });
  });
});
