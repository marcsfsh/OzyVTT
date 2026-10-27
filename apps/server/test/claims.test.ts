import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type ClaimReleasedEvent } from "@vtt/domain";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { claimCharacter, forceReleaseCharacter } from "../src/character-claims.js";
import { CommandRejectedError } from "../src/game-store.js";
import { createServer } from "../src/server.js";

const HERO = "10000000-0000-4000-8000-0000000000b1";
const OTHER = "10000000-0000-4000-8000-0000000000b2";
const SESSION = "10000000-0000-4000-8000-0000000000f1";

const table = () =>
  GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 9, maximum: 9 } },
      { id: OTHER, name: "Other", kind: "player-character", visibility: "public", hp: { current: 9, maximum: 9 } }
    ]
  });

describe("claims", () => {
  it("remembers when a character was first claimed, and keeps the first time", () => {
    const state = table();
    claimCharacter(state, HERO, SESSION, 1_000);
    forceReleaseCharacter(state, HERO);
    claimCharacter(state, HERO, SESSION, 2_000);
    expect(state.actors[0]!.firstClaimedAt).toBe(1_000);
    expect(state.actors[1]!.firstClaimedAt).toBeUndefined();
  });

  it("asks the GM twice before releasing a character who is in the running encounter", () => {
    const state = table();
    claimCharacter(state, HERO, SESSION);
    state.combat = { ...state.combat, active: true, initiative: [{ actorId: HERO, score: 12, tieBreaker: 0 }] };
    let refusal: unknown;
    try {
      forceReleaseCharacter(state, HERO);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(CommandRejectedError);
    expect((refusal as CommandRejectedError).code).toBe("in_encounter");
    expect((refusal as Error).message).toBe(
      "Hero is in the encounter. Releasing Hero takes the player's turn controls away until someone claims Hero again."
    );
    expect(state.actors[0]!.ownerSessionId).toBe(SESSION);
    expect(forceReleaseCharacter(state, HERO, { inFight: true })).toEqual({ sessionId: SESSION, name: "Hero" });
    expect(state.actors[0]!.ownerSessionId).toBeNull();
  });
});

const sockets: Socket[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("a released player is told", () => {
  it("on their own devices alone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-claims-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      webDist: directory,
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: table()
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    await new Promise<void>((done) => server.httpServer.listen(0, "127.0.0.1", done));
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    const url = `http://127.0.0.1:${address.port}`;
    const connect = async (token: string) => {
      const socket = ioClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(socket);
      await new Promise((done) => socket.emit("session:join", { token }, done));
      return socket;
    };
    const gm = await connect((await server.auth.login("a sufficiently long GM password"))!);
    const playerToken = server.auth.issuePlayerSession();
    const phone = await connect(playerToken);
    const laptop = await connect(playerToken);
    const someoneElse = await connect(server.auth.issuePlayerSession());
    const heard: Record<string, ClaimReleasedEvent[]> = { phone: [], laptop: [], someoneElse: [], gm: [] };
    for (const [name, socket] of Object.entries({ phone, laptop, someoneElse, gm }))
      socket.on("claim:released", (event: ClaimReleasedEvent) => heard[name]!.push(event));

    const claimed = await new Promise<{ ok: boolean }>((done) =>
      phone.emit("character:claim", { commandId: crypto.randomUUID(), actorId: HERO }, done)
    );
    expect(claimed.ok).toBe(true);
    const released = await new Promise<{ ok: boolean }>((done) =>
      gm.emit("character:force-release", { commandId: crypto.randomUUID(), actorId: HERO }, done)
    );
    expect(released.ok).toBe(true);
    await expect.poll(() => heard.phone!.length).toBe(1);
    await expect.poll(() => heard.laptop!.length).toBe(1);
    expect(heard.phone).toEqual([{ actorId: HERO, name: "Hero" }]);
    expect(heard.someoneElse).toEqual([]);
    expect(heard.gm).toEqual([]);
  });
});
