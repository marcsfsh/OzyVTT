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
    expect(combat).toEqual({ active: true, round: 3, turnActorId: null, mapAssetId: MAP, hiddenTurn: true, initiative: [{ actorId: PUBLIC, name: "Visible Hero", score: 18, active: false, health: "healthy" }], tokens: [{ actorId: PUBLIC, position: { x: 200, y: 200 }, sizePx: 40, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }], annotations: [], turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }, rulesMode: "strict", rollMode: "auto", underwater: false, reactionsUsed: [], fog: { enabled: false, shapes: [] }, rewound: false, pendingSaves: [], pendingReactions: [] });
    const serialized = JSON.stringify(projectPlayerView(state, undefined, () => null));
    expect(serialized).not.toContain(HIDDEN);
    expect(serialized).not.toContain("Secret Lurker");
    expect(serialized).not.toContain("surprise");
  });

  it("marks a public current turn for players and the shared viewer", () => {
    const state = game(PUBLIC);
    expect(projectPlayerCombat(state)).toMatchObject({ turnActorId: PUBLIC, hiddenTurn: false, initiative: [{ actorId: PUBLIC, active: true }] });
    expect(projectViewerInitiative(state)).toEqual({ visible: true, round: 3, hiddenTurn: false, entries: [{ actorId: PUBLIC, name: "Visible Hero", initiative: 18, active: true, health: "healthy", conditions: [] }] });
    expect(projectViewerEncounterScene(state)).toEqual({ mapAssetId: MAP, tokens: [{ actorId: PUBLIC, name: "Visible Hero", kind: "player-character", position: { x: 200, y: 200 }, sizePx: 40, active: true, health: "healthy", conditions: [], conditionIds: [] }], annotations: [], fog: { enabled: false, shapes: [] } });
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

const GOBLIN = "40000000-0000-4000-8000-000000000003";

/** A public owned PC (7/10), a public non-owned monster (3/12 -> bloodied), and a gm-only monster. */
function healthGame(combatHealthDisplay?: { style: string; audience: string }, goblinOverride?: { style: string; audience: string }) {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: PUBLIC, name: "Visible Hero", kind: "player-character", visibility: "public", hp: { current: 7, maximum: 10 }, ownerSessionId: PLAYER_A },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 3, maximum: 12 }, ...(goblinOverride ? { healthDisplay: goblinOverride } : {}) },
      { id: HIDDEN, name: "Secret Lurker", kind: "monster", visibility: "gm-only", hp: { current: 10, maximum: 10 } }
    ],
    combat: {
      active: true, round: 1, turnActorId: PUBLIC, mapAssetId: MAP,
      initiative: [{ actorId: PUBLIC, score: 18 }, { actorId: GOBLIN, score: 12 }, { actorId: HIDDEN, score: 22 }],
      tokens: [
        { actorId: PUBLIC, position: { x: 10, y: 10 }, sizePx: 40, gridSizePx: 50 },
        { actorId: GOBLIN, position: { x: 20, y: 20 }, sizePx: 40, gridSizePx: 50 },
        { actorId: HIDDEN, position: { x: 30, y: 30 }, sizePx: 40, gridSizePx: 50 }
      ],
      ...(combatHealthDisplay ? { healthDisplay: combatHealthDisplay } : {})
    }
  });
}

describe("token health-display projection (audience gate, viewer safety)", () => {
  it("defaults healthDisplay for a save written before the field existed (additive parse)", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1, actors: [{ id: PUBLIC, name: "Hero", kind: "player-character", hp: { current: 5, maximum: 5 } }], combat: { active: false } });
    expect(state.combat.healthDisplay).toEqual({ style: "band", audience: "gm" });
    expect(state.actors[0].healthDisplay).toBeUndefined();
  });

  it("keeps the default band silent - no healthDisplay reaches players or the viewer", () => {
    const state = healthGame();
    expect(projectPlayerView(state, PLAYER_A, () => null).actors.every((actor) => !("healthDisplay" in actor))).toBe(true);
    expect(projectViewerEncounterScene(state).tokens.every((token) => !("healthDisplay" in token))).toBe(true);
  });

  it("with audience gm, a bar/ring stays GM-only and exact HP never reaches others", () => {
    const state = healthGame({ style: "ring", audience: "gm" });
    const view = projectPlayerView(state, PLAYER_A, () => null);
    expect(view.actors.every((actor) => !("healthDisplay" in actor))).toBe(true);
    // The non-owned monster is still a coarse band for players - never exact HP.
    expect(view.actors.find((actor) => actor.id === GOBLIN)!.hp).toEqual({ kind: "band", band: "bloodied" });
    expect(projectViewerEncounterScene(state).tokens.every((token) => !("healthDisplay" in token))).toBe(true);
  });

  it("with audience all, the resolved style (only) reaches players + viewer; owner exact, others band, hidden omitted", () => {
    const state = healthGame({ style: "bar", audience: "all" });
    const viewerTokens = projectViewerEncounterScene(state).tokens;
    expect(viewerTokens.map((token) => token.actorId).sort()).toEqual([PUBLIC, GOBLIN].sort());
    expect(viewerTokens.every((token) => token.healthDisplay?.style === "bar")).toBe(true);
    // Structural safety: a viewer token has no hit-point field at all, only the coarse band + a style.
    expect(viewerTokens.every((token) => !("hp" in token) && !("current" in token) && !("maximum" in token))).toBe(true);

    const view = projectPlayerView(state, PLAYER_A, () => null);
    const hero = view.actors.find((actor) => actor.id === PUBLIC)!;
    const goblin = view.actors.find((actor) => actor.id === GOBLIN)!;
    expect(hero.healthDisplay).toEqual({ style: "bar" });
    expect(hero.hp).toEqual({ kind: "exact", current: 7, maximum: 10, temporary: 0 }); // own claimed PC: exact
    expect(goblin.healthDisplay).toEqual({ style: "bar" });
    expect(goblin.hp).toEqual({ kind: "band", band: "bloodied" }); // someone else's token: band-fraction only
    expect(view.actors.some((actor) => actor.id === HIDDEN)).toBe(false);
    expect(JSON.stringify(view)).not.toContain(HIDDEN);
  });

  it("resolves a per-token override against the table default in both directions", () => {
    // Table default band/gm, but the goblin alone is promoted to bar-for-everyone.
    const promoted = healthGame(undefined, { style: "bar", audience: "all" });
    const promotedTokens = projectViewerEncounterScene(promoted).tokens;
    expect(promotedTokens.find((token) => token.actorId === GOBLIN)!.healthDisplay).toEqual({ style: "bar" });
    expect("healthDisplay" in promotedTokens.find((token) => token.actorId === PUBLIC)!).toBe(false);
    expect(projectPlayerView(promoted, PLAYER_A, () => null).actors.find((actor) => actor.id === GOBLIN)!.healthDisplay).toEqual({ style: "bar" });

    // Table default bar/all, but the goblin alone is demoted back to GM-only.
    const demoted = healthGame({ style: "bar", audience: "all" }, { style: "ring", audience: "gm" });
    const demotedTokens = projectViewerEncounterScene(demoted).tokens;
    expect(demotedTokens.find((token) => token.actorId === GOBLIN)!.healthDisplay).toBeUndefined();
    expect(demotedTokens.find((token) => token.actorId === PUBLIC)!.healthDisplay).toEqual({ style: "bar" });
  });
});
