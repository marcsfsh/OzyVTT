import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type MutationResult } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECRET_ID = "10000000-0000-4000-8000-000000000002";
const START_COMMAND_ID = "30000000-0000-4000-8000-000000000001";
const NEXT_COMMAND_ID = "30000000-0000-4000-8000-000000000002";

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: HERO_ID, name: "Public Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, initiative: 3, notes: "Player-safe actor" },
    { id: SECRET_ID, name: "Unrevealed Tyrant", kind: "monster", visibility: "gm-only", hp: { current: 99, maximum: 99 }, initiative: 8, notes: "Secret lair and tactics" }
  ] });
}

type ClientSocket = Socket;

function waitForState(socket: ClientSocket, predicate: (state: any) => boolean) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off("state:updated", listener); reject(new Error("Timed out waiting for converged state.")); }, 3_000);
    const listener = (state: any) => {
      if (!predicate(state)) return;
      clearTimeout(timeout); socket.off("state:updated", listener); resolve(state);
    };
    socket.on("state:updated", listener);
  });
}

function emitCommand(socket: ClientSocket, event: string, payload: unknown) {
  return new Promise<MutationResult>((resolve) => (socket.emit as (...args: any[]) => void)(event, payload, resolve));
}

async function joinSocket(base: string, token: string) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out.")), 3_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
  const joined = await new Promise<any>((resolve) => socket.emit("session:join", { token }, resolve));
  if (!joined.ok) throw new Error(joined.message ?? "Session join failed.");
  return socket;
}

describe("live authoritative encounter workflow", () => {
  it("converges GM, player, map authorization, viewer Initiative, idempotency, privacy, and restart recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-encounter-live-"));
    const options = {
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: initialState()
    };
    let running = createServer(options);
    let gmSocket: ClientSocket | undefined;
    let playerSocket: ClientSocket | undefined;
    try {
      await running.initialize();
      await running.auth.bootstrap("a sufficiently long GM password");
      const gmToken = (await running.auth.login("a sufficiently long GM password"))!;
      const playerToken = running.auth.issuePlayerSession();
      const image = png(900, 600);
      const imported = await running.mapAssets.import(image, "arena.png");
      running.mapCatalog.register(imported.metadata.id, "Encounter Arena", "battlemap");
      const regional = await running.mapAssets.import(png(901, 600), "region.png");
      running.mapCatalog.register(regional.metadata.id, "Regional Overview", "regional");
      await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
      const address = running.httpServer.address(); if (!address || typeof address === "string") throw new Error("Live server did not bind.");
      let base = `http://127.0.0.1:${address.port}`;

      gmSocket = await joinSocket(base, gmToken);
      playerSocket = await joinSocket(base, playerToken);
      const denied = await emitCommand(playerSocket, "encounter:start", { commandId: "30000000-0000-4000-8000-000000000099", mapAssetId: imported.metadata.id, entries: [{ actorId: HERO_ID, score: 10 }] });
      expect(denied).toMatchObject({ ok: false });
      expect(denied.message).toContain("Only the GM");
      const wrongMapKind = await emitCommand(gmSocket, "encounter:start", { commandId: "30000000-0000-4000-8000-000000000098", mapAssetId: regional.metadata.id, entries: [{ actorId: HERO_ID, score: 10 }] });
      expect(wrongMapKind).toMatchObject({ ok: false });
      expect(wrongMapKind.message).toContain("battlemap");

      const hiddenTurnState = waitForState(playerSocket, (state) => state.combat?.active && state.combat.hiddenTurn);
      const started = await emitCommand(gmSocket, "encounter:start", {
        commandId: START_COMMAND_ID,
        mapAssetId: imported.metadata.id,
        expectedRevision: 0,
        entries: [{ actorId: SECRET_ID, score: 22 }, { actorId: HERO_ID, score: 18 }]
      });
      expect(started).toMatchObject({ ok: true, revision: 1, duplicate: false });
      const playerHiddenView = await hiddenTurnState;
      expect(playerHiddenView.combat).toMatchObject({ active: true, round: 1, turnActorId: null, mapAssetId: imported.metadata.id, hiddenTurn: true });
      expect(playerHiddenView.combat.initiative).toEqual([{ actorId: HERO_ID, name: "Public Hero", score: 18, active: false, health: "healthy" }]);
      const playerJson = JSON.stringify(playerHiddenView);
      expect(playerJson).not.toContain(SECRET_ID);
      expect(playerJson).not.toContain("Unrevealed Tyrant");
      expect(playerJson).not.toContain("Secret lair and tactics");
      expect(running.viewerPresentation.snapshot.initiative).toEqual({
        visible: true,
        round: 1,
        hiddenTurn: true,
        entries: [{ actorId: HERO_ID, name: "Public Hero", initiative: 18, active: false, health: "healthy", conditions: [] }]
      });
      const activeMap = await fetch(`${base}/api/v1/map-assets/${imported.metadata.id}/content`, { headers: { authorization: `Bearer ${playerToken}` } });
      expect(activeMap.status).toBe(200);
      expect(Buffer.from(await activeMap.arrayBuffer())).toEqual(image);

      const publicTurnState = waitForState(playerSocket, (state) => state.revision === 2 && state.combat?.initiative?.[0]?.active);
      const advanced = await emitCommand(gmSocket, "initiative:next", { commandId: NEXT_COMMAND_ID, expectedRevision: 1 });
      expect(advanced).toMatchObject({ ok: true, revision: 2, duplicate: false });
      const playerPublicView = await publicTurnState;
      expect(playerPublicView.combat).toMatchObject({ hiddenTurn: false, turnActorId: HERO_ID });
      expect(playerPublicView.combat.initiative[0]).toMatchObject({ actorId: HERO_ID, active: true });
      expect(running.viewerPresentation.snapshot.initiative).toMatchObject({ hiddenTurn: false, entries: [{ actorId: HERO_ID, active: true }] });

      const duplicate = await emitCommand(gmSocket, "initiative:next", { commandId: NEXT_COMMAND_ID, expectedRevision: 1 });
      expect(duplicate).toMatchObject({ ok: true, revision: 2, duplicate: true });
      const stale = await emitCommand(gmSocket, "initiative:previous", { commandId: "30000000-0000-4000-8000-000000000003", expectedRevision: 0 });
      expect(stale).toMatchObject({ ok: false });
      expect(stale.message).toContain("outdated");
      const safeHttpState = await (await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${playerToken}` } })).json();
      expect(safeHttpState).toMatchObject({ revision: 2, combat: { active: true, turnActorId: HERO_ID, hiddenTurn: false } });
      expect(JSON.stringify(safeHttpState)).not.toContain("Unrevealed Tyrant");

      gmSocket.disconnect(); playerSocket.disconnect(); gmSocket = undefined; playerSocket = undefined;
      running.close();
      running = createServer(options);
      await running.initialize();
      expect(running.store.snapshot.combat).toMatchObject({ active: true, round: 1, turnActorId: HERO_ID, mapAssetId: imported.metadata.id });
      expect(running.viewerPresentation.snapshot.initiative).toMatchObject({ visible: true, hiddenTurn: false, entries: [{ actorId: HERO_ID, active: true }] });
      await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
      const restartedAddress = running.httpServer.address(); if (!restartedAddress || typeof restartedAddress === "string") throw new Error("Restarted server did not bind.");
      base = `http://127.0.0.1:${restartedAddress.port}`;
      expect((await fetch(`${base}/api/v1/map-assets/${imported.metadata.id}/content`, { headers: { authorization: `Bearer ${playerToken}` } })).status).toBe(200);
    } finally {
      gmSocket?.disconnect(); playerSocket?.disconnect(); running.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("broadcasts action and bonus-action usage as table toasts, like reactions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-turnuse-live-"));
    const options = {
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: initialState()
    };
    const running = createServer(options);
    let gmSocket: ClientSocket | undefined;
    let playerSocket: ClientSocket | undefined;
    try {
      await running.initialize();
      await running.auth.bootstrap("a sufficiently long GM password");
      const gmToken = (await running.auth.login("a sufficiently long GM password"))!;
      const playerToken = running.auth.issuePlayerSession();
      const imported = await running.mapAssets.import(png(900, 600), "arena.png");
      running.mapCatalog.register(imported.metadata.id, "Toast Arena", "battlemap");
      await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
      const address = running.httpServer.address(); if (!address || typeof address === "string") throw new Error("Server did not bind.");
      const base = `http://127.0.0.1:${address.port}`;
      gmSocket = await joinSocket(base, gmToken);
      playerSocket = await joinSocket(base, playerToken);

      const events: Array<{ kind: string; text: string }> = [];
      playerSocket.on("table:event", (event: { kind: string; text: string }) => events.push(event));

      await emitCommand(gmSocket, "encounter:start", { commandId: START_COMMAND_ID, mapAssetId: imported.metadata.id, entries: [{ actorId: HERO_ID, score: 18 }] });
      await emitCommand(gmSocket, "turn:use", { commandId: "30000000-0000-4000-8000-000000000060", slot: "bonus-action", used: true });
      await emitCommand(gmSocket, "turn:use", { commandId: "30000000-0000-4000-8000-000000000061", slot: "action", used: true });
      // Un-marking is a correction, not an event — it must stay silent.
      await emitCommand(gmSocket, "turn:use", { commandId: "30000000-0000-4000-8000-000000000062", slot: "action", used: false });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(events.map((event) => event.text)).toContain("Public Hero used a bonus action.");
      expect(events.map((event) => event.text)).toContain("Public Hero used an action.");
      expect(events.filter((event) => event.text.includes("used an action."))).toHaveLength(1);
    } finally {
      gmSocket?.disconnect(); playerSocket?.disconnect(); running.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("auto-archives an ended encounter and serves the machine-readable record over the GM-only API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-archive-live-"));
    const options = {
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: initialState()
    };
    const running = createServer(options);
    let gmSocket: ClientSocket | undefined;
    try {
      await running.initialize();
      await running.auth.bootstrap("a sufficiently long GM password");
      const gmToken = (await running.auth.login("a sufficiently long GM password"))!;
      const imported = await running.mapAssets.import(png(900, 600), "arena.png");
      running.mapCatalog.register(imported.metadata.id, "Archive Arena", "battlemap");
      await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
      const address = running.httpServer.address(); if (!address || typeof address === "string") throw new Error("Archive server did not bind.");
      const base = `http://127.0.0.1:${address.port}`;
      const gmHeaders = { authorization: `Bearer ${gmToken}` };

      // Empty to begin with, and GM-gated.
      expect((await fetch(`${base}/api/gm/encounters`)).status).toBe(401);
      expect(await (await fetch(`${base}/api/gm/encounters`, { headers: gmHeaders })).json()).toEqual({ encounters: [] });

      gmSocket = await joinSocket(base, gmToken);
      const started = await emitCommand(gmSocket, "encounter:start", { commandId: START_COMMAND_ID, mapAssetId: imported.metadata.id, entries: [{ actorId: HERO_ID, score: 12 }], expectedRevision: 0 });
      expect(started).toMatchObject({ ok: true, revision: 1 });
      const advanced = await emitCommand(gmSocket, "initiative:next", { commandId: NEXT_COMMAND_ID, expectedRevision: 1 });
      expect(advanced).toMatchObject({ ok: true, revision: 2 });
      const ended = await emitCommand(gmSocket, "encounter:end", { commandId: "30000000-0000-4000-8000-000000000050", expectedRevision: 2 });
      expect(ended).toMatchObject({ ok: true, revision: 3 });

      // The fight is archived permanently even though the live buffer was wiped.
      const list = await (await fetch(`${base}/api/gm/encounters`, { headers: gmHeaders })).json();
      expect(list.encounters).toHaveLength(1);
      expect(list.encounters[0].turnCount).toBeGreaterThan(0);
      expect(typeof list.encounters[0].endedAt).toBe("string");

      const document = await (await fetch(`${base}/api/gm/encounters/${list.encounters[0].id}`, { headers: gmHeaders })).json();
      expect(document.archiveSchemaVersion).toBe(2);
      expect(document.turns.length).toBe(list.encounters[0].turnCount);
      expect(document.turns[0].state.actors.some((actor: { id: string }) => actor.id === HERO_ID)).toBe(true); // full machine-readable state per turn
      expect(Array.isArray(document.log)).toBe(true);
      expect(document.log.length).toBeGreaterThan(0); // timestamped commentary bundled in
      // v2: the complete per-command journal (start → next → end), the final live state, and the dice record.
      expect(document.journal.map((entry: { type: string }) => entry.type)).toEqual(["encounter.start", "initiative.next", "encounter.end"]);
      expect(document.journal[0].principal).toMatch(/^gm:/);
      expect(document.journal[0].payload.mapAssetId).toBe(imported.metadata.id);
      expect(document.finalState.combat.active).toBe(true);
      expect(Array.isArray(document.rolls)).toBe(true);
      expect(Array.isArray(document.definitions)).toBe(true);

      // 404 for an unknown id; delete removes it.
      expect((await fetch(`${base}/api/gm/encounters/99999`, { headers: gmHeaders })).status).toBe(404);
      expect((await fetch(`${base}/api/gm/encounters/${list.encounters[0].id}`, { method: "DELETE" })).status).toBe(401);
      await fetch(`${base}/api/gm/encounters/${list.encounters[0].id}`, { method: "DELETE", headers: gmHeaders });
      expect(await (await fetch(`${base}/api/gm/encounters`, { headers: gmHeaders })).json()).toEqual({ encounters: [] });
    } finally {
      gmSocket?.disconnect(); running.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("authorizes owned-token movement, snaps on the server, hides secret tokens, converges the viewer, and recovers after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-token-live-"));
    const options = {
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: initialState()
    };
    let running = createServer(options);
    let gmSocket: ClientSocket | undefined;
    let ownerSocket: ClientSocket | undefined;
    let otherSocket: ClientSocket | undefined;
    try {
      await running.initialize();
      await running.auth.bootstrap("a sufficiently long GM password");
      const gmToken = (await running.auth.login("a sufficiently long GM password"))!;
      const ownerToken = running.auth.issuePlayerSession();
      const otherToken = running.auth.issuePlayerSession();
      const imported = await running.mapAssets.import(png(500, 400), "grid-arena.png");
      running.mapCatalog.register(imported.metadata.id, "Grid Arena", "battlemap");
      running.mapCatalog.saveCalibration(imported.metadata.id, {
        calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
        verifiedAt: "2026-07-16T04:00:00.000Z", verificationPoint: { x: 250, y: 250 }, verificationErrorPx: 0
      });
      await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
      const address = running.httpServer.address(); if (!address || typeof address === "string") throw new Error("Token test server did not bind.");
      const base = `http://127.0.0.1:${address.port}`;
      gmSocket = await joinSocket(base, gmToken);
      ownerSocket = await joinSocket(base, ownerToken);
      otherSocket = await joinSocket(base, otherToken);

      expect(await emitCommand(ownerSocket, "character:claim", { commandId: "61000000-0000-4000-8000-000000000001", actorId: HERO_ID, expectedRevision: 0 })).toMatchObject({ ok: true, revision: 1 });
      expect(await emitCommand(gmSocket, "encounter:start", {
        commandId: "61000000-0000-4000-8000-000000000002", mapAssetId: imported.metadata.id, expectedRevision: 1,
        entries: [{ actorId: SECRET_ID, score: 20 }, { actorId: HERO_ID, score: 15 }]
      })).toMatchObject({ ok: true, revision: 2 });
      expect(running.store.snapshot.combat.tokens).toEqual([
        expect.objectContaining({ actorId: SECRET_ID, position: null, sizePx: 41, gridSizePx: 50 }),
        expect.objectContaining({ actorId: HERO_ID, position: null, sizePx: 41, gridSizePx: 50 })
      ]);

      const denied = await emitCommand(otherSocket, "token:move", { commandId: "61000000-0000-4000-8000-000000000003", actorId: HERO_ID, position: { x: 75, y: 75 }, expectedRevision: 2 });
      expect(denied).toMatchObject({ ok: false }); expect(denied.message).toContain("claimed character");

      const ownerConvergence = waitForState(ownerSocket, (state) => state.revision === 3 && state.combat.tokens[0]?.position?.x === 75);
      const moved = await emitCommand(ownerSocket, "token:move", { commandId: "61000000-0000-4000-8000-000000000004", actorId: HERO_ID, position: { x: 78, y: 74 }, expectedRevision: 2 });
      expect(moved).toMatchObject({ ok: true, revision: 3, duplicate: false });
      const ownerView = await ownerConvergence;
      expect(ownerView.combat.tokens).toEqual([{ actorId: HERO_ID, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: 0, sizeCells: 1 }]);
      expect(running.viewerPresentation.snapshot.encounter).toEqual({ mapAssetId: imported.metadata.id, tokens: [{ actorId: HERO_ID, name: "Public Hero", kind: "player-character", position: { x: 75, y: 75 }, sizePx: 41, active: false, health: "healthy", conditions: [] }], annotations: [] });

      const hiddenMoveId = "61000000-0000-4000-8000-000000000005";
      expect(await emitCommand(gmSocket, "token:move", { commandId: hiddenMoveId, actorId: SECRET_ID, position: { x: 127, y: 127 }, expectedRevision: 3 })).toMatchObject({ ok: true, revision: 4, duplicate: false });
      expect(running.store.snapshot.combat.tokens[0].position).toEqual({ x: 125, y: 125 });
      expect(await emitCommand(gmSocket, "token:move", { commandId: hiddenMoveId, actorId: SECRET_ID, position: { x: 400, y: 300 }, expectedRevision: 3 })).toMatchObject({ ok: true, revision: 4, duplicate: true });
      const safeState = await (await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${ownerToken}` } })).json();
      expect(JSON.stringify(safeState)).not.toContain(SECRET_ID);
      expect(running.viewerPresentation.snapshot.encounter.tokens).toHaveLength(1);

      const stale = await emitCommand(ownerSocket, "token:move", { commandId: "61000000-0000-4000-8000-000000000006", actorId: HERO_ID, position: { x: 175, y: 175 }, expectedRevision: 2 });
      expect(stale).toMatchObject({ ok: false }); expect(stale.message).toContain("outdated");
      expect(await emitCommand(ownerSocket, "token:move", { commandId: "61000000-0000-4000-8000-000000000007", actorId: HERO_ID, position: null, expectedRevision: 4 })).toMatchObject({ ok: true, revision: 5 });
      expect(running.viewerPresentation.snapshot.encounter.tokens).toEqual([]);
      expect(await emitCommand(ownerSocket, "token:move", { commandId: "61000000-0000-4000-8000-000000000008", actorId: HERO_ID, position: { x: 224, y: 176 }, expectedRevision: 5 })).toMatchObject({ ok: true, revision: 6 });
      expect(running.store.snapshot.combat.tokens.find((token) => token.actorId === HERO_ID)?.position).toEqual({ x: 225, y: 175 });

      gmSocket.disconnect(); ownerSocket.disconnect(); otherSocket.disconnect(); gmSocket = undefined; ownerSocket = undefined; otherSocket = undefined;
      running.close(); running = createServer(options); await running.initialize();
      expect(running.store.snapshot.combat.tokens.find((token) => token.actorId === HERO_ID)?.position).toEqual({ x: 225, y: 175 });
      expect(running.viewerPresentation.snapshot.encounter.tokens).toEqual([expect.objectContaining({ actorId: HERO_ID, position: { x: 225, y: 175 } })]);
    } finally {
      gmSocket?.disconnect(); ownerSocket?.disconnect(); otherSocket?.disconnect(); running.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
