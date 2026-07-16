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
      expect(playerHiddenView.combat.initiative).toEqual([{ actorId: HERO_ID, name: "Public Hero", score: 18, active: false }]);
      const playerJson = JSON.stringify(playerHiddenView);
      expect(playerJson).not.toContain(SECRET_ID);
      expect(playerJson).not.toContain("Unrevealed Tyrant");
      expect(playerJson).not.toContain("Secret lair and tactics");
      expect(running.viewerPresentation.snapshot.initiative).toEqual({
        visible: true,
        round: 1,
        hiddenTurn: true,
        entries: [{ actorId: HERO_ID, name: "Public Hero", initiative: 18, active: false }]
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
});
