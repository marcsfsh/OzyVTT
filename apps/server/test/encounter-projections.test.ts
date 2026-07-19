import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { projectPlayerCombat, projectPlayerView } from "../src/projections.js";
import { projectViewerEncounterScene, projectViewerInitiative } from "../src/viewer-encounter.js";

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
    combat: {
      active: true, round: 3, turnActorId, mapAssetId: MAP,
      initiative: [{ actorId: HIDDEN, score: 22 }, { actorId: PUBLIC, score: 18 }],
      tokens: [
        { actorId: HIDDEN, position: { x: 100, y: 100 }, sizePx: 40, gridSizePx: 50 },
        { actorId: PUBLIC, position: { x: 200, y: 200 }, sizePx: 40, gridSizePx: 50 }
      ]
    }
  });
}

describe("recipient-safe encounter projections", () => {
  it("omits hidden combatants and reports a safe hidden-turn indicator", () => {
    const state = game(HIDDEN);
    const combat = projectPlayerCombat(state);
    expect(combat).toEqual({ active: true, round: 3, turnActorId: null, mapAssetId: MAP, hiddenTurn: true, initiative: [{ actorId: PUBLIC, name: "Visible Hero", score: 18, active: false, health: "healthy" }], tokens: [{ actorId: PUBLIC, position: { x: 200, y: 200 }, sizePx: 40, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }], annotations: [], turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }, rulesMode: "strict", underwater: false, reactionsUsed: [], rewound: false, pendingSaves: [], pendingReactions: [] });
    const serialized = JSON.stringify(projectPlayerView(state, undefined, () => null));
    expect(serialized).not.toContain(HIDDEN);
    expect(serialized).not.toContain("Secret Lurker");
    expect(serialized).not.toContain("surprise");
  });

  it("marks a public current turn for players and the shared viewer", () => {
    const state = game(PUBLIC);
    expect(projectPlayerCombat(state)).toMatchObject({ turnActorId: PUBLIC, hiddenTurn: false, initiative: [{ actorId: PUBLIC, active: true }] });
    expect(projectViewerInitiative(state)).toEqual({ visible: true, round: 3, hiddenTurn: false, entries: [{ actorId: PUBLIC, name: "Visible Hero", initiative: 18, active: true, health: "healthy", conditions: [] }] });
    expect(projectViewerEncounterScene(state)).toEqual({ mapAssetId: MAP, tokens: [{ actorId: PUBLIC, name: "Visible Hero", kind: "player-character", position: { x: 200, y: 200 }, sizePx: 40, active: true, health: "healthy", conditions: [], conditionIds: [] }], annotations: [] });
  });

  it("sends condition ids parallel to the display labels so the viewer picks matching glyphs", () => {
    const state = game(PUBLIC);
    state.actors = state.actors.map((actor) => actor.id === PUBLIC ? { ...actor, conditions: [{ id: "poisoned" }, { id: "exhaustion", level: 3 }] } : actor);
    const token = projectViewerEncounterScene(state).tokens[0];
    expect(token.conditions).toEqual(["Poisoned", "Exhaustion 3"]);
    expect(token.conditionIds).toEqual(["poisoned", "exhaustion"]);
  });

  it("hides the Initiative list after combat ends", () => {
    const state = game(PUBLIC); state.combat = { ...state.combat, active: false, turnActorId: null };
    expect(projectViewerInitiative(state)).toEqual({ visible: false, round: 0, hiddenTurn: false, entries: [] });
    expect(projectViewerEncounterScene(state)).toEqual({ mapAssetId: null, tokens: [], annotations: [] });
  });
});

const PLAYER_A = "45000000-0000-4000-8000-000000000001";
const PLAYER_B = "45000000-0000-4000-8000-000000000002";

function gameWithAnnotations() {
  const geometry = { origin: { x: 0, y: 0 }, target: { x: 100, y: 0 }, sizeFeet: 20 };
  return GameStateSchema.parse({
    schemaVersion: 1,
    combat: {
      active: true, round: 1, mapAssetId: MAP, turnActorId: PUBLIC,
      initiative: [{ actorId: PUBLIC, score: 10 }],
      annotations: [
        { id: "90000000-0000-4000-8000-000000000001", kind: "measurement", geometry, ownerSessionId: PLAYER_A, createdByRole: "player", visibility: "public", createdAt: 0, expiresAt: 5000 },
        { id: "90000000-0000-4000-8000-000000000002", kind: "shape", shape: "circle", geometry, ownerSessionId: PLAYER_A, createdByRole: "player", visibility: "gm-only", createdAt: 0, expiresAt: null },
        { id: "90000000-0000-4000-8000-000000000003", kind: "shape", shape: "square", geometry, ownerSessionId: PLAYER_A, createdByRole: "player", visibility: "owner-only", createdAt: 0, expiresAt: null },
        { id: "90000000-0000-4000-8000-000000000004", kind: "shape", shape: "square", geometry, ownerSessionId: PLAYER_B, createdByRole: "player", visibility: "owner-only", createdAt: 0, expiresAt: null }
      ]
    }
  });
}

describe("recipient-safe annotation projections", () => {
  it("shows a player public annotations and their own private ones, marks ownership, and hides session IDs", () => {
    const view = projectPlayerCombat(gameWithAnnotations(), PLAYER_A, 1000);
    expect(view.annotations.map((annotation) => annotation.id)).toEqual([
      "90000000-0000-4000-8000-000000000001",
      "90000000-0000-4000-8000-000000000003"
    ]);
    expect(view.annotations.every((annotation) => !("ownerSessionId" in annotation))).toBe(true);
    expect(view.annotations.map((annotation) => annotation.mine)).toEqual([true, true]);
  });

  it("hides another player's owner-only annotations and every player's gm-only annotations", () => {
    const view = projectPlayerCombat(gameWithAnnotations(), PLAYER_B, 1000);
    expect(view.annotations.map((annotation) => annotation.id)).toEqual([
      "90000000-0000-4000-8000-000000000001",
      "90000000-0000-4000-8000-000000000004"
    ]);
  });

  it("drops an expired measurement once its time has passed", () => {
    const view = projectPlayerCombat(gameWithAnnotations(), PLAYER_A, 6000);
    expect(view.annotations.some((annotation) => annotation.id === "90000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("returns no annotations once combat is inactive", () => {
    const state = gameWithAnnotations();
    state.combat = { ...state.combat, active: false };
    expect(projectPlayerCombat(state, PLAYER_A, 1000).annotations).toEqual([]);
  });

  it("reveals a gm-actor annotation only to the player who owns the target actor", () => {
    const geometry = { origin: { x: 0, y: 0 }, target: { x: 50, y: 0 }, sizeFeet: 10 };
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: PUBLIC, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 }, ownerSessionId: PLAYER_A }],
      combat: {
        active: true, round: 1, mapAssetId: MAP, turnActorId: PUBLIC, initiative: [{ actorId: PUBLIC, score: 10 }],
        annotations: [{ id: "91000000-0000-4000-8000-000000000001", kind: "shape", shape: "circle", geometry, ownerSessionId: "45000000-0000-4000-8000-0000000000ff", createdByRole: "gm", visibility: "gm-actor", visibleToActorId: PUBLIC, createdAt: 0, expiresAt: null }]
      }
    });
    expect(projectPlayerCombat(state, PLAYER_A, 1000).annotations.map((a) => a.id)).toEqual(["91000000-0000-4000-8000-000000000001"]);
    expect(projectPlayerCombat(state, PLAYER_B, 1000).annotations).toEqual([]);
  });

  it("projects only public, non-expired annotations onto the shared screen", () => {
    const scene = projectViewerEncounterScene(gameWithAnnotations(), 1000);
    expect(scene.annotations.map((a) => a.id)).toEqual(["90000000-0000-4000-8000-000000000001"]);
    expect(scene.annotations[0]).toMatchObject({ kind: "measurement", sizeFeet: 20 });
    expect(projectViewerEncounterScene(gameWithAnnotations(), 6000).annotations).toEqual([]);
  });
});
