import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameState } from "@vtt/domain";
import { createServer } from "../src/server.js";

/** A real server on a free port with a signed-in GM, for tests that go over HTTP. `close` tears it down. */
export async function bootServer(initialGameState: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-boot-"));
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
  await new Promise<void>((done) => server.httpServer.listen(0, "127.0.0.1", done));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, token: string, body: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  const close = async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  };
  return { base, server, gmToken, post, close };
}
