import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { HOST_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { AuthService } from "../src/auth.js";
import { createHostRouter } from "../src/host-http.js";
import { LoginRateLimiter } from "../src/login-rate-limit.js";
import { createServer } from "../src/server.js";

const PASSWORD = "a sufficiently long GM password";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot(initialGameState = GameStateSchema.parse({ schemaVersion: 1, actors: [] })) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-host-account-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState,
    viewerBaseUrls: ["http://localhost:3001", "http://192.168.1.50:3001", "http://10.0.0.7:3001/"],
    passwordChangeGraceMs: 0
  });
  await server.initialize();
  await new Promise<void>((done) => server.httpServer.listen(0, "127.0.0.1", done));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, init: { token?: string; body?: unknown; method?: string } = {}) =>
    fetch(base + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  return { server, call };
}

describe("the GM's own account", () => {
  it("tells a GM on another device where to set the password", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-host-remote-"));
    const auth = new AuthService(join(directory, "auth.json"));
    await auth.initialize();
    const app = express();
    app.use(express.json());
    app.use(
      createHostRouter({
        auth,
        verifiers: { gm: (token) => auth.verify(token), player: (token) => auth.verifyPlayer(token) },
        loginLimiter: new LoginRateLimiter(),
        // Every request reads as coming from another device on the network.
        isLoopback: () => false,
        broadcast: () => {},
        viewerBaseUrls: ["http://localhost:3001", "http://192.168.1.50:3001"]
      })
    );
    const listening = app.listen(0, "127.0.0.1");
    await once(listening, "listening");
    cleanups.push(async () => {
      listening.close();
      await rm(directory, { recursive: true, force: true });
    });
    const response = await fetch(`http://127.0.0.1:${(listening.address() as AddressInfo).port}${HOST_PATHS.setup}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD })
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(
      "Set the GM password on the computer that runs OzyVTT. Open http://localhost:3001 there."
    );
    expect(auth.isBootstrapped).toBe(false);
  });

  it("changes the GM password, keeps the device that changed it signed in and ends every other GM session", async () => {
    const { server, call } = await boot();
    await server.auth.bootstrap(PASSWORD);
    const here = (await server.auth.login(PASSWORD))!;
    const elsewhere = (await server.auth.login(PASSWORD))!;

    const wrong = await call(HOST_PATHS.gmPassword, {
      token: here,
      body: { currentPassword: "not the password at all", newPassword: "a brand new GM password" }
    });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.message).toBe("That is not the current password. Check it and try again.");
    const short = await call(HOST_PATHS.gmPassword, {
      token: here,
      body: { currentPassword: PASSWORD, newPassword: "short" }
    });
    expect(short.status).toBe(400);
    // A player's valid session is refused with 403, a missing one with 401.
    const player = server.auth.issuePlayerSession();
    const body = { currentPassword: PASSWORD, newPassword: "a brand new GM password" };
    expect((await call(HOST_PATHS.gmPassword, { token: player, body })).status).toBe(403);
    expect((await call(HOST_PATHS.gmPassword, { body })).status).toBe(401);

    const changed = await call(HOST_PATHS.gmPassword, { token: here, body });
    expect(changed.status).toBe(200);
    const { token } = (await changed.json()).data as { token: string };
    expect(server.auth.verify(token)?.role).toBe("gm");
    expect(server.auth.verify(here)).toBeNull();
    expect(server.auth.verify(elsewhere)).toBeNull();
    expect(await server.auth.login(PASSWORD)).toBeNull();
    expect(await server.auth.login("a brand new GM password")).not.toBeNull();
    // Players keep their seats.
    expect(server.auth.verifyPlayer(player)).not.toBeNull();
  });

  it("lists the addresses players join at for the GM alone, without the localhost one", async () => {
    const { server, call } = await boot();
    await server.auth.bootstrap(PASSWORD);
    const gm = (await server.auth.login(PASSWORD))!;
    const response = await call(HOST_PATHS.joinUrls, { token: gm });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      joinUrls: ["http://192.168.1.50:3001", "http://10.0.0.7:3001"],
      hostUrl: "http://localhost:3001"
    });
    expect((await call(HOST_PATHS.joinUrls, { token: server.auth.issuePlayerSession() })).status).toBe(403);
    expect((await call(HOST_PATHS.joinUrls)).status).toBe(401);
  });

  it("answers a wrong GM password with what to do next", async () => {
    const { server, call } = await boot();
    await server.auth.bootstrap(PASSWORD);
    const response = await call(HOST_PATHS.gmSignIn, { body: { password: "not the GM password" } });
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("That is not the GM password. Check it and try again.");
  });

  it("lets go of every claim when the password is set again after a reset", async () => {
    const hero = "10000000-0000-4000-8000-0000000000a1";
    const { server, call } = await boot(
      GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          {
            id: hero,
            name: "Hero",
            kind: "player-character",
            visibility: "public",
            hp: { current: 10, maximum: 10 },
            // Claimed by a seat from before the reset, whose token can never verify again.
            ownerSessionId: "10000000-0000-4000-8000-0000000000ff"
          }
        ]
      })
    );
    expect((await call(HOST_PATHS.setup, { body: { password: PASSWORD } })).status).toBe(201);
    expect(server.store.snapshot.actors.find((actor) => actor.id === hero)?.ownerSessionId).toBeNull();
  });
});
