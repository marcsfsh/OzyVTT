import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { canPlayerTarget } from "../src/authorization.js";
import type { EncounterArchiveDocument } from "../src/encounter-archive.js";
import { projectPlayerView } from "../src/projections.js";
import { projectPlayerReplay } from "../src/replay-projection.js";
import { projectViewerEncounter } from "../src/viewer-encounter.js";
import { fogCovered, playerSight } from "../src/vision/audience.js";
import {
  cell,
  FRIEND,
  frozen,
  GOBLIN,
  GOBLIN_NAME,
  HERO,
  MAP,
  ORC,
  SESSION_A,
  SESSION_B,
  visionGame
} from "./vision-fixtures.js";

// Manual fog draws the same boundary as dynamic vision (ADR-0023): a creature whose whole space lies under the fog
// reaches a player, the table screen or a replay no more than a GM-only one does. A creature partly revealed is sent,
// and so are the audience's own characters wherever they stand.

const presence = () => null;
const asPlayer = (state: GameState, session: string) => projectPlayerView(state, session, presence, 1_000);
const mentionsGoblin = (payload: unknown) => {
  const json = JSON.stringify(payload);
  return json.includes(GOBLIN) || json.includes(GOBLIN_NAME);
};
/** The tokens on the map (a combatant not yet placed has one with no position). */
const tokenIds = (view: ReturnType<typeof asPlayer>) =>
  view.combat.tokens.flatMap((token) => (token.position ? [token.actorId] : [])).sort();

/** No dynamic vision; fog revealing the strip x 0 to 260, so the hero (cell 1,5) stands in it, the orc's space
 *  (cell 5,5: x 250 to 300) is 10 pixels into it and the goblin's (cell 8,5) wholly out of it. */
const strip = (extra: Parameters<typeof visionGame>[0] = {}) =>
  frozen(
    visionGame({
      enabled: false,
      positions: { [ORC]: cell(5, 5) },
      reveals: [{ x: 0, y: 0, width: 260, height: 600 }],
      ...extra
    })
  );

describe("manual fog in the projections", () => {
  it("leaves a creature wholly under the fog out of a player's payload, and sends one partly revealed", () => {
    const view = asPlayer(strip(), SESSION_A);
    expect(tokenIds(view)).toEqual([HERO, ORC].sort());
    expect(view.actors.map((actor) => actor.id)).toContain(ORC);
    expect(view.combat.initiative.map((entry) => entry.actorId)).not.toContain(GOBLIN);
    // The shapes still go out, for the client to paint.
    expect(view.combat.fog.enabled).toBe(true);
    expect(mentionsGoblin(view)).toBe(false);
  });

  it("counts a space that only touches the reveal's edge as under the fog", () => {
    const state = strip({ reveals: [{ x: 0, y: 0, width: 250, height: 600 }] });
    expect(fogCovered(state.combat)).toEqual(new Set([GOBLIN, ORC]));
    expect(tokenIds(asPlayer(state, SESSION_A))).toEqual([HERO]);
  });

  it("covers again where a hide stroke follows a reveal", () => {
    const state = strip({
      reveals: [
        { x: 0, y: 0, width: 1000, height: 600 },
        { x: 380, y: 230, width: 100, height: 100, op: "hide" }
      ]
    });
    expect(fogCovered(state.combat)).toEqual(new Set([GOBLIN]));
    expect(mentionsGoblin(asPlayer(state, SESSION_A))).toBe(false);
  });

  it("covers nothing while the fog is off", () => {
    const state = frozen(visionGame({ enabled: false }));
    expect(fogCovered(state.combat).size).toBe(0);
    expect(tokenIds(asPlayer(state, SESSION_A))).toContain(GOBLIN);
  });

  it("always sends a player their own characters, and keeps another's character known with its token left out", () => {
    // Fog on with nothing revealed: everyone is under it.
    const state = strip({ reveals: [], positions: { [FRIEND]: cell(15, 1), [ORC]: cell(5, 5) } });
    const a = asPlayer(state, SESSION_A);
    expect(tokenIds(a)).toEqual([HERO]);
    expect(a.actors.map((actor) => actor.id)).toContain(FRIEND);
    expect(a.combat.initiative.map((entry) => entry.actorId)).toContain(FRIEND);
    expect(tokenIds(asPlayer(state, SESSION_B))).toEqual([FRIEND]);
    // The table screen sees through the whole party: the two characters only.
    const viewer = projectViewerEncounter(state, 1_000);
    expect(viewer.encounter.tokens.map((token) => token.actorId).sort()).toEqual([HERO, FRIEND].sort());
    expect(mentionsGoblin(viewer)).toBe(false);
  });

  it("hides a creature under the fog even when dynamic vision would show it", () => {
    const state = strip({ enabled: true });
    const view = asPlayer(state, SESSION_A);
    expect(tokenIds(view)).toEqual([HERO, ORC].sort());
    expect(mentionsGoblin(view)).toBe(false);
  });

  it("won't let a player aim at a creature under the fog", () => {
    const state = strip();
    const unseen = playerSight(state, SESSION_A, {}).hidden;
    expect(canPlayerTarget(state, GOBLIN, unseen)).toBe(false);
    expect(canPlayerTarget(state, ORC, unseen)).toBe(true);
  });

  it("keeps creatures staged under a prepared scene's fog a secret until it goes live", () => {
    const hp = { current: 10, maximum: 10 };
    const state = frozen(
      GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          { id: HERO, name: "Borin", kind: "player-character", ownerSessionId: SESSION_A, visibility: "public", hp },
          { id: GOBLIN, name: GOBLIN_NAME, kind: "monster", visibility: "public", hp },
          { id: ORC, name: "Orc", kind: "monster", visibility: "public", hp }
        ],
        combat: {
          scenes: [
            {
              id: "60000000-0000-4000-8000-000000000009",
              name: "Ambush",
              mapAssetId: MAP,
              combat: {
                initiative: [
                  { actorId: GOBLIN, score: 0 },
                  { actorId: ORC, score: 0 }
                ],
                tokens: [
                  { actorId: GOBLIN, position: cell(8, 5), sizePx: 41, gridSizePx: 50 },
                  { actorId: ORC, position: cell(5, 5), sizePx: 41, gridSizePx: 50 }
                ],
                fog: {
                  enabled: true,
                  shapes: [
                    {
                      kind: "rect",
                      id: "70000000-0000-4000-8000-000000000001",
                      op: "reveal",
                      x: 0,
                      y: 0,
                      width: 260,
                      height: 600
                    }
                  ]
                }
              }
            }
          ]
        }
      })
    );
    const view = asPlayer(state, SESSION_A);
    expect(view.actors.map((actor) => actor.id)).toContain(ORC);
    expect(mentionsGoblin(view)).toBe(false);
  });

  it("replays each turn with what the fog covered then", () => {
    const covered = strip();
    const lifted = strip({ reveals: [{ x: 0, y: 0, width: 1000, height: 600 }] });
    const document = {
      archiveSchemaVersion: 3,
      startedAt: "2026-10-17T09:00:00.000Z",
      endedAt: "2026-10-17T11:00:00.000Z",
      turnCount: 2,
      turns: [
        {
          index: 0,
          kind: "turn",
          label: `Round 1 - ${GOBLIN_NAME}`,
          revision: 1,
          at: "2026-10-17T09:00:00.000Z",
          state: covered
        },
        { index: 1, kind: "turn", label: "Round 1 - Borin", revision: 5, at: "2026-10-17T10:30:00.000Z", state: lifted }
      ],
      log: [],
      journal: [],
      finalState: lifted,
      postEncounterState: lifted,
      rolls: [],
      definitions: [],
      attribution: null
    } as unknown as EncounterArchiveDocument;
    const [first, second] = projectPlayerReplay(7, document, 1_000).turns;
    expect(mentionsGoblin(first)).toBe(false);
    expect(second!.combat.tokens.map((token) => token.actorId)).toContain(GOBLIN);
  });
});
