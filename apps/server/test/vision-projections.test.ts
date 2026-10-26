import { describe, expect, it } from "vitest";
import type { GameState, RollRecord } from "@vtt/domain";
import { projectPlayerView } from "../src/projections.js";
import { projectPlayerReplay } from "../src/replay-projection.js";
import { projectViewerEncounter } from "../src/viewer-encounter.js";
import { exploredRectsOf, rememberExplored } from "../src/vision/audience.js";
import type { EncounterArchiveDocument } from "../src/encounter-archive.js";
import {
  cell,
  DIVIDER,
  FRIEND,
  frozen,
  GOBLIN,
  GOBLIN_NAME,
  HERO,
  SESSION_A,
  SESSION_B,
  visionGame,
  wall
} from "./vision-fixtures.js";

// The boundary dynamic vision draws (ADR-0023): a creature none of a player's characters perceive reaches that player
// no more than a GM-only one does. These read the whole payload, as a leak hunter would.

const presence = () => null;
const asPlayer = (state: GameState, session: string) => projectPlayerView(state, session, presence, 1_000);
const mentionsGoblin = (payload: unknown) => {
  const json = JSON.stringify(payload);
  return json.includes(GOBLIN) || json.includes(GOBLIN_NAME);
};

function goblinRoll(): RollRecord {
  return {
    id: "40000000-0000-4000-8000-0000000000e1",
    commandId: "40000000-0000-4000-8000-0000000000e2",
    initiatorSessionId: "40000000-0000-4000-8000-0000000000e3",
    initiatorRole: "gm",
    initiatorLabel: GOBLIN_NAME,
    label: "Scimitar",
    actorId: GOBLIN,
    purpose: "attack",
    visibility: "public",
    formula: "1d20+4",
    normalizedFormula: "1d20+4",
    dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }],
    modifiers: [{ value: 4, sign: 1 }],
    total: 16,
    createdAt: "2026-10-17T10:00:00.000Z"
  };
}

/** Hero alone on the near side of the divider, the goblin on the far side, mid-fight on the goblin's turn, with a
 *  roll of the goblin's in the history and the goblin's grapple on the hero. */
function hiddenGoblin(extra: Parameters<typeof visionGame>[0] = {}): GameState {
  const state = visionGame({
    walls: [DIVIDER()],
    actors: {
      [HERO]: {
        conditions: [{ id: "grappled" }],
        effects: [
          {
            id: "grip",
            name: `Grappled by ${GOBLIN_NAME}`,
            tags: ["grapple"],
            sourceActorId: GOBLIN,
            sourceName: GOBLIN_NAME,
            startedRound: 1,
            duration: { type: "manual" },
            linkedConditionIds: ["grappled"]
          }
        ]
      }
    },
    ...extra
  });
  state.combat.turnActorId = GOBLIN;
  state.rolls = [goblinRoll()];
  return state;
}

describe("dynamic vision in the player projection", () => {
  it("never hands a player a creature their characters can't perceive, anywhere in the payload", () => {
    const view = asPlayer(frozen(hiddenGoblin()), SESSION_A);
    expect(mentionsGoblin(view)).toBe(false);
    expect(view.combat.tokens.map((token) => token.actorId)).toEqual([HERO]);
    expect(view.combat.hiddenTurn).toBe(true);
    expect(view.combat.turnActorId).toBeNull();
    // The grapple stays on the hero's sheet with its source masked.
    expect(view.actors.find((actor) => actor.id === HERO)?.effects[0]?.sourceName).toBe("A hidden threat");
  });

  it("gives the same creature to the player whose character does see it", () => {
    const state = frozen(hiddenGoblin({ positions: { [FRIEND]: cell(12, 5) } }));
    const friendView = asPlayer(state, SESSION_B);
    expect(friendView.combat.tokens.map((token) => token.actorId).sort()).toEqual([FRIEND, GOBLIN].sort());
    expect(friendView.rolls.map((roll) => roll.actorId)).toEqual([GOBLIN]);
    // The hero's player still can't: what one character sees isn't shared out by the server.
    const heroView = asPlayer(state, SESSION_A);
    expect(mentionsGoblin(heroView)).toBe(false);
    // Mirena stays on the hero's party list, and the wall keeps Mirena's token off the map.
    expect(heroView.actors.some((actor) => actor.id === FRIEND)).toBe(true);
    expect(heroView.combat.tokens.some((token) => token.actorId === FRIEND)).toBe(false);
  });

  it("behaves as before with the scene's vision off", () => {
    const view = asPlayer(frozen(hiddenGoblin({ enabled: false })), SESSION_A);
    expect(view.combat.tokens.map((token) => token.actorId)).toContain(GOBLIN);
    expect(view.combat.vision).toEqual({ enabled: false });
  });

  it("sends the area the player's characters see, and the walls and doors in it", () => {
    const door = wall({ x: 150, y: 0 }, { x: 150, y: 100 }, "door");
    const hiddenDoor = wall({ x: 600, y: 0 }, { x: 600, y: 100 }, "door", true);
    const state = visionGame({ walls: [DIVIDER(), door, hiddenDoor] });
    rememberExplored(state, {});
    const view = asPlayer(frozen(state), SESSION_A);
    if (!view.combat.vision.enabled) throw new Error("Vision should be on.");
    expect(view.combat.vision.visible.length).toBeGreaterThan(0);
    const ids = view.combat.vision.walls.map((entry) => entry.id);
    expect(ids).toContain(door.id);
    expect(ids).not.toContain(hiddenDoor.id);
    expect(view.combat.vision.walls.find((entry) => entry.id === door.id)?.open).toBe(false);
    // What the party has seen: the near side, up to the divider.
    const explored = view.combat.vision.explored;
    expect(explored.length).toBeGreaterThan(0);
    expect(Math.max(...explored.map((rect) => rect.x + rect.width))).toBeLessThanOrEqual(250);
  });

  it("keeps what the party has seen after it looks away, without the creatures there", () => {
    const state = visionGame({
      positions: { [HERO]: cell(6, 5) },
      walls: [wall({ x: 400, y: 0 }, { x: 400, y: 600 }, "door", true)]
    });
    rememberExplored(state, {});
    // The door shuts: the far side is remembered but no longer seen.
    state.combat.vision = {
      ...state.combat.vision,
      walls: state.combat.vision.walls.map((entry) => ({ ...entry, open: false }))
    };
    rememberExplored(state, {});
    const view = asPlayer(frozen(state), SESSION_A);
    if (!view.combat.vision.enabled) throw new Error("Vision should be on.");
    expect(Math.max(...view.combat.vision.explored.map((rect) => rect.x + rect.width))).toBeGreaterThan(400);
    expect(view.combat.tokens.some((token) => token.actorId === GOBLIN)).toBe(false);
  });

  it("shows players only the difficult terrain the party has seen", () => {
    const state = visionGame({ walls: [DIVIDER()] });
    state.combat.terrain = {
      difficult: [
        { x: 100, y: 100, width: 50, height: 50 },
        { x: 600, y: 100, width: 50, height: 50 }
      ],
      water: [],
      runningWater: [],
      ice: []
    };
    rememberExplored(state, {});
    expect(asPlayer(frozen(state), SESSION_A).combat.terrain.difficult).toEqual([
      { x: 100, y: 100, width: 50, height: 50 }
    ]);
  });
});

describe("dynamic vision on the shared screen and in replays", () => {
  it("shows the table screen only what the party perceives", () => {
    const hidden = projectViewerEncounter(frozen(hiddenGoblin()), 1_000);
    expect(mentionsGoblin(hidden)).toBe(false);
    expect(hidden.initiative.hiddenTurn).toBe(true);
    expect(hidden.encounter.vision?.visible.length).toBeGreaterThan(0);
    const seen = projectViewerEncounter(frozen(hiddenGoblin({ positions: { [FRIEND]: cell(12, 5) } })), 1_000);
    expect(seen.encounter.tokens.map((token) => token.actorId)).toContain(GOBLIN);
  });

  it("replays each turn through the party's eyes, the unseen creature's rolls included", () => {
    const unseen = hiddenGoblin();
    const seen = hiddenGoblin({ walls: [] });
    const document = {
      archiveSchemaVersion: 3,
      startedAt: "2026-10-17T09:00:00.000Z",
      endedAt: "2026-10-17T11:00:00.000Z",
      turnCount: 2,
      turns: [
        {
          index: 0,
          kind: "turn",
          label: `Round 1 · ${GOBLIN_NAME}`,
          revision: 1,
          at: "2026-10-17T09:00:00.000Z",
          state: unseen
        },
        { index: 1, kind: "turn", label: "Round 1 · Borin", revision: 5, at: "2026-10-17T10:30:00.000Z", state: seen }
      ],
      log: [],
      journal: [],
      finalState: seen,
      postEncounterState: seen,
      rolls: [goblinRoll()],
      definitions: [],
      attribution: null
    } as unknown as EncounterArchiveDocument;
    const replay = projectPlayerReplay(7, document, 1_000);
    const [first, second] = replay.turns;
    expect(mentionsGoblin(first)).toBe(false);
    expect(first!.label).toBe("A hidden combatant's turn");
    // The roll fell in the first turn, when no one saw the goblin.
    expect(mentionsGoblin(replay.rolls)).toBe(false);
    expect(second!.combat.tokens.map((token) => token.actorId)).toContain(GOBLIN);
  });

  it("draws no circle round a hidden creature's carried light, for the player, the table screen or the party's memory", () => {
    // The goblin carries a torch behind a short wall; its light still reaches ground Borin can see.
    const at = { x: 375, y: 75 };
    const state = visionGame({
      ambient: "dark",
      walls: [wall({ x: 300, y: 0 }, { x: 300, y: 150 })],
      lights: [
        { id: "60000000-0000-4000-8000-000000000009", position: null, actorId: GOBLIN, brightFeet: 20, dimFeet: 20 }
      ],
      positions: { [GOBLIN]: at }
    });
    const onTheCircle = (polygons: readonly (readonly number[])[]) =>
      polygons.flatMap((flat) =>
        flat.flatMap((_, index) =>
          index % 2 === 0 && Math.abs(Math.hypot(flat[index]! - at.x, flat[index + 1]! - at.y) - 400) < 0.5
            ? [index]
            : []
        )
      ).length;
    const view = asPlayer(frozen(structuredClone(state)), SESSION_A);
    expect(mentionsGoblin(view)).toBe(false);
    expect(view.combat.vision.enabled && onTheCircle(view.combat.vision.visible)).toBe(0);
    const screen = projectViewerEncounter(frozen(structuredClone(state)), 1_000).encounter;
    expect(onTheCircle(screen.vision?.visible ?? [])).toBe(0);
    // Nothing the light alone showed is remembered either.
    const remembered = structuredClone(state);
    rememberExplored(remembered, {});
    expect(exploredRectsOf(remembered)).toEqual([]);
  });
});
