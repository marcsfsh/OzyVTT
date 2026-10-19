import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import type { GameState } from "@vtt/domain";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// A running server on a calibrated 50px grid (5 feet a cell) for the movement tests that go through the commands.

export const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

export async function bootMovementServer(initialGameState: GameState, cleanups: Array<() => Promise<void>>) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-movement-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState
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
  const base = `http://127.0.0.1:${address.port}`;
  const imported = await server.mapAssets.import(png(1000, 1000), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  server.mapCatalog.saveCalibration(imported.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  const post = (path: string, token: string, body: Record<string, unknown> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: randomUUID(), ...body })
    });
  /** Starts the fight on the grid with these combatants in this order, and places their tokens. */
  const startFight = async (order: readonly string[], at: Readonly<Record<string, { x: number; y: number }>>) => {
    await post(GAME_PATHS.encounterStart, gmToken, {
      mapAssetId: imported.metadata.id,
      entries: order.map((actorId, index) => ({ actorId, score: 30 - index }))
    });
    for (const [actorId, position] of Object.entries(at))
      await post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, { position });
  };
  const move = (actorId: string, token: string, body: Record<string, unknown>) =>
    post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), token, body);
  return { base, server, gmToken, post, move, startFight, mapAssetId: imported.metadata.id };
}
