import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { createServer } from "../src/server.js";
import type { GameState, RollRecord } from "@vtt/domain";
import { applyViewerCommand, createViewerPresentationState } from "../src/viewer-presentation.js";
import { projectViewerRoll, ROLL_CARD_MS } from "../src/viewer-roll.js";
import { cell, frozen, GOBLIN, HERO, ORC, visionGame } from "./vision-fixtures.js";

// ADR-0040: the table screen's latest-roll card is built from an allow-list, for the room's audience, from rolls made
// since the screen last changed what it shows.

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** No dynamic vision; fog reveals x 0 to 260, so the hero and the orc are seen and the goblin is wholly under it. */
const table = () =>
  frozen(
    visionGame({
      enabled: false,
      positions: { [ORC]: cell(5, 5) },
      reveals: [{ x: 0, y: 0, width: 260, height: 600 }]
    })
  );

let next = 0;
function roll(overrides: Partial<RollRecord> = {}): RollRecord {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    commandId: `00000000-0000-4000-9000-${String(next).padStart(12, "0")}`,
    initiatorSessionId: "30000000-0000-4000-8000-00000000000a",
    initiatorRole: "player",
    initiatorLabel: "Borin",
    actorId: HERO,
    purpose: "attack",
    label: "Fire Bolt",
    visibility: "public",
    formula: "1d20+7",
    normalizedFormula: "1d20+7",
    dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }],
    modifiers: [{ value: 7, sign: 1 }],
    total: 19,
    createdAt: at(1_000),
    ...overrides
  };
}
const withRolls = (state: GameState, rolls: RollRecord[]): GameState => ({ ...state, rolls });

describe("the table screen's latest roll", () => {
  it("shows who, what, the total and the dice of a public roll, and nothing else", () => {
    const made = roll();
    const card = projectViewerRoll(withRolls(table(), [made]), undefined, NOW);
    expect(card).toEqual({
      id: expect.any(String),
      who: "Borin",
      what: "Fire Bolt",
      total: 19,
      dice: [{ sides: 20, face: 12, kept: true }],
      modifier: 7,
      at: made.createdAt
    });
    const json = JSON.stringify(card);
    for (const secret of [made.id, made.commandId, made.initiatorSessionId, "visibility", "formula"])
      expect(json).not.toContain(secret);
  });

  it("leaves out private, blind, GM-only and builder rolls, falling back to the newest one that may show", () => {
    const shown = roll({ label: "Shown" });
    const rolls = [
      shown,
      roll({ visibility: "gm-only" }),
      roll({ visibility: "blind" }),
      roll({ visibility: "self-only" }),
      roll({ purpose: "builder", label: undefined })
    ];
    expect(projectViewerRoll(withRolls(table(), rolls), undefined, NOW)?.what).toBe("Shown");
    expect(projectViewerRoll(withRolls(table(), rolls.slice(1)), undefined, NOW)).toBeNull();
  });

  it("leaves out a roll by a creature the table can't see: under the fog, or GM-only", () => {
    const fogged = withRolls(table(), [roll({ actorId: GOBLIN, initiatorRole: "gm", initiatorLabel: "GM" })]);
    expect(projectViewerRoll(fogged, undefined, NOW)).toBeNull();
    // The orc stands partly revealed, so its roll shows, under its name.
    const seen = withRolls(table(), [roll({ actorId: ORC, initiatorRole: "gm", initiatorLabel: "GM" })]);
    expect(projectViewerRoll(seen, undefined, NOW)?.who).toBe(seen.actors.find((actor) => actor.id === ORC)?.name);
    const state = table();
    const hidden: GameState = {
      ...state,
      actors: state.actors.map((actor) => (actor.id === ORC ? { ...actor, visibility: "gm-only" } : actor)),
      rolls: [roll({ actorId: ORC })]
    };
    expect(projectViewerRoll(hidden, undefined, NOW)).toBeNull();
  });

  it("names the GM for a public roll with no creature, and a purpose when there is no label", () => {
    const card = projectViewerRoll(
      withRolls(table(), [
        roll({ actorId: null, initiatorRole: "gm", initiatorLabel: "GM", label: undefined, purpose: "damage" })
      ]),
      undefined,
      NOW
    );
    expect(card).toMatchObject({ who: "GM", what: "Damage" });
  });

  it("shows nothing older than the screen's last change, the live encounter going live, or ten minutes", () => {
    const state = withRolls(table(), [roll({ createdAt: at(5_000) })]);
    expect(projectViewerRoll(state, NOW - 10_000, NOW)).not.toBeNull();
    expect(projectViewerRoll(state, NOW - 1_000, NOW)).toBeNull();
    expect(
      projectViewerRoll(withRolls(table(), [roll({ createdAt: at(ROLL_CARD_MS + 1) })]), undefined, NOW)
    ).toBeNull();
    const live: GameState = {
      ...state,
      combat: {
        ...state.combat,
        activeEncounterId: "40000000-0000-4000-8000-00000000000a",
        encounters: [
          {
            id: "40000000-0000-4000-8000-00000000000a",
            name: "Warren",
            mapAssetId: state.combat.mapAssetId ?? "20000000-0000-5000-8000-000000000001",
            combat: state.combat.encounters[0]?.combat ?? ({} as never),
            liveAt: NOW - 2_000
          }
        ]
      }
    };
    expect(projectViewerRoll(live, undefined, NOW)).toBeNull();
  });
});

describe("the screen's marker for what it shows", () => {
  const gm = (id: string, payload: Parameters<typeof applyViewerCommand>[1]["payload"]) => ({
    id,
    role: "gm" as const,
    payload
  });
  const camera = { center: { x: 1, y: 1 }, zoom: 1 };
  const encounter = { mapAssetId: null, tokens: [], annotations: [] };
  const idle = { visible: false, round: 0, hiddenTurn: false, entries: [] };

  it("moves when a map is presented or changed, and when an encounter starts or ends, and not otherwise", () => {
    let state = createViewerPresentationState();
    state = applyViewerCommand(
      state,
      gm("a", { type: "viewer.presentation.begin", assetId: "map", altText: "Map", camera }),
      100
    ).state;
    expect(state.rollsSince).toBe(100);
    state = applyViewerCommand(state, gm("b", { type: "viewer.camera.set", camera }), 200).state;
    expect(state.rollsSince).toBe(100);
    state = applyViewerCommand(
      state,
      gm("c", { type: "viewer.encounter.set", initiative: idle, encounter }),
      300
    ).state;
    expect(state.rollsSince).toBe(100);
    state = applyViewerCommand(
      state,
      gm("d", {
        type: "viewer.encounter.set",
        initiative: { visible: true, round: 1, hiddenTurn: false, entries: [] },
        encounter
      }),
      400
    ).state;
    expect(state.rollsSince).toBe(400);
    state = applyViewerCommand(
      state,
      gm("e", { type: "viewer.map.set", assetId: "map-2", altText: "Map 2", camera }),
      500
    ).state;
    expect(state.rollsSince).toBe(500);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the screen's feed", () => {
  it("carries a public roll's card to the screen and the GM's preview alike, keeps it past a private roll, and sends none while paused", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-roll-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: GameStateSchema.parse({ schemaVersion: 1 })
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const headers = { authorization: `Bearer ${gmToken}`, "content-type": "application/json" };
    const present = async (payload: unknown) => {
      const { data } = await (await fetch(`${base}/viewer/presentation`, { headers })).json();
      const answer = await fetch(`${base}/viewer/presentation/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: randomUUID(), expectedRevision: data.presentation.revision, payload })
      });
      expect(answer.status).toBe(200);
    };
    const rollDice = async (visibility: string) =>
      expect(
        (
          await fetch(`${base}/game/rolls`, {
            method: "POST",
            headers,
            body: JSON.stringify({ formula: "1d20+5", purpose: "manual", visibility })
          })
        ).status
      ).toBe(200);
    const preview: unknown[] = [];
    server.viewerCoordinator.connectGm(gmToken, (projection) => preview.push(projection));

    await present({
      type: "viewer.presentation.begin",
      assetId: "map",
      altText: "Map",
      camera: { center: { x: 1, y: 1 }, zoom: 1 }
    });
    expect(server.viewerCoordinator.project().latestRoll).toBeNull();
    await rollDice("public");
    const card = server.viewerCoordinator.project().latestRoll;
    expect(card).toMatchObject({ who: "GM", what: "Roll", modifier: 5 });
    // The preview was sent the same card the screen reads.
    expect((preview.at(-1) as { latestRoll: unknown }).latestRoll).toEqual(card);
    await rollDice("gm-only");
    expect(server.viewerCoordinator.project().latestRoll).toEqual(card);

    await present({ type: "viewer.enabled.set", enabled: false });
    expect(server.viewerCoordinator.project().latestRoll).toBeNull();
  });
});
