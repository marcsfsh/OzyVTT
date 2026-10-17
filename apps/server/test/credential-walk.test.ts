import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { createServer } from "../src/server.js";
import { openApiDocument } from "../src/openapi/document.js";

/**
 * The session lifecycle's one rule, walked over every HTTP route the server mounts and the socket handshake
 * (ADR-0026): 401 for no credential or a dead one (garbage, or a GM session that was revoked), 403 only for a valid
 * credential without the role. The answers for every route are pinned in `__snapshots__/credential-answers.txt`, so
 * a new route, or a changed answer, shows up in review.
 */

type Layer = Readonly<{
  route?: Readonly<{ path: string; methods: Record<string, boolean> }>;
  handle?: Readonly<{ stack?: readonly Layer[] }>;
}>;

/** Every `method path` under `/api/v1`, read from Express's own route table so nothing mounted can be missed. */
function mountedRoutes(stack: readonly Layer[]): Array<Readonly<{ method: string; path: string }>> {
  return stack.flatMap((layer) => {
    if (layer.route)
      return Object.keys(layer.route.methods)
        .filter((method) => method !== "_all")
        .map((method) => ({ method: method.toUpperCase(), path: layer.route!.path }));
    return layer.handle?.stack ? mountedRoutes(layer.handle.stack) : [];
  });
}

/** Routes anyone may call: they take no session, or check something other than a credential. */
const PUBLIC = new Set([
  "GET /api/v1/host/setup",
  // Setting the first password is gated on the host machine's own address, not on a credential.
  "POST /api/v1/host/setup",
  "POST /api/v1/host/gm/sign-in",
  "GET /api/v1/system/health",
  "GET /api/v1/system/version",
  "GET /api/v1/openapi.json",
  // The HTTP mirror of the socket's open join: anyone on the network may take a player seat.
  "POST /api/v1/sessions/player",
  // The pairing code is the credential; a table screen has nothing else.
  "POST /api/v1/viewer/pairings/exchange",
  "POST /api/v1/viewer/screen-pairings",
  "GET /api/v1/viewer/screen-pairings/current"
]);

/** A path parameter's value: ids in the shape each router checks before it looks anything up. */
function concrete(path: string) {
  const assetId = "00000000-0000-5000-8000-000000000001";
  return path.replace(/:(\w+)/g, (_match, name: string) => {
    if (/map-assets|token-assets|sound-assets/.test(path) && name === "id") return assetId;
    if (path.startsWith("/api/v1/encounters/")) return "1";
    return "00000000-0000-4000-8000-000000000001";
  });
}

let base = "";
let gm = "";
let revokedGm = "";
let player = "";
let cleanup: () => Promise<void> = async () => {};
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtt-credential-walk-"));
  server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    tokenAssetsPath: join(directory, "token-assets"),
    soundAssetsPath: join(directory, "sound-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1, actors: [] }),
    sessionSweepMs: 50
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  revokedGm = (await server.auth.login("a sufficiently long GM password"))!;
  await server.auth.logout(revokedGm);
  gm = (await server.auth.login("a sufficiently long GM password"))!;
  player = server.auth.issuePlayerSession();
  await new Promise<void>((done) => server.httpServer.listen(0, "127.0.0.1", done));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  base = `http://127.0.0.1:${address.port}`;
  cleanup = async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  };
});
afterAll(() => cleanup());

const CREDENTIALS = {
  none: () => undefined,
  garbage: () => "not-a-credential",
  "revoked GM": () => revokedGm,
  player: () => player
} as const;

async function answer(method: string, path: string, token: string | undefined) {
  const response = await fetch(base + concrete(path), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method === "GET" || method === "DELETE" ? {} : { "content-type": "application/json" })
    },
    body: method === "GET" || method === "DELETE" ? undefined : "{}"
  });
  await response.body?.cancel();
  return response.status;
}

describe("every route answers a credential the same way", () => {
  it("answers 401 to a missing or dead credential and 403 only to a valid one without the role", async () => {
    const routes = mountedRoutes((server.app as unknown as { router: { stack: Layer[] } }).router.stack).filter(
      (route) => route.path.startsWith("/api/v1/")
    );
    // The walk must see the whole surface, or it proves nothing.
    expect(routes.length).toBeGreaterThan(200);
    const lines: string[] = [];
    const undeclared: string[] = [];
    for (const { method, path } of routes) {
      const key = `${method} ${path}`;
      const answers: Record<string, number> = {};
      for (const [name, token] of Object.entries(CREDENTIALS)) answers[name] = await answer(method, path, token());
      const summary = Object.entries(answers)
        .map(([name, status]) => `${name} ${status}`)
        .join(" · ");
      lines.push(`${key}  ${PUBLIC.has(key) ? "public" : ""}${PUBLIC.has(key) ? " · " : ""}${summary}`);
      if (PUBLIC.has(key)) {
        // A public route never asks anyone to sign in or tells them they may not.
        for (const [name, status] of Object.entries(answers))
          expect([401, 403], `${key} with ${name}`).not.toContain(status);
        continue;
      }
      expect(answers.none, `${key} with no credential`).toBe(401);
      expect(answers.garbage, `${key} with a garbage token`).toBe(401);
      expect(answers["revoked GM"], `${key} with a revoked GM session`).toBe(401);
      expect(answers.player, `${key} with a player session`).not.toBe(401);
      // The refusals a route gives are the ones its OpenAPI operation declares.
      const documented = (openApiDocument.paths as Record<string, Record<string, { responses?: object }>>)[
        path.replace(/:(\w+)/g, "{$1}")
      ]?.[method.toLowerCase()];
      if (documented) {
        const declared = Object.keys(documented.responses ?? {});
        for (const status of new Set(Object.values(answers).filter((status) => status === 401 || status === 403)))
          if (!declared.includes(String(status))) undeclared.push(`${key} answers ${status}`);
      }
    }
    expect(undeclared, "refusals missing from the OpenAPI document").toEqual([]);
    await expect(lines.sort().join("\n") + "\n").toMatchFileSnapshot("__snapshots__/credential-answers.txt");
  }, 120_000);
});

describe("the socket handshake", () => {
  const sockets: Socket[] = [];
  afterAll(() => sockets.forEach((socket) => socket.close()));
  async function join(token: string | undefined) {
    const socket = connect(base, { transports: ["websocket"], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((done) => socket.once("connect", () => done()));
    const result = await new Promise<{ ok: boolean; role?: string; code?: string; token?: string }>((done) =>
      socket.emit("session:join", { token }, done)
    );
    return { socket, result };
  }

  it("seats a newcomer, resumes a live session and refuses a dead one without handing out a new seat", async () => {
    const fresh = await join(undefined);
    expect(fresh.result).toMatchObject({ ok: true, role: "player" });
    expect(typeof fresh.result.token).toBe("string");
    expect((await join(player)).result).toMatchObject({ ok: true, role: "player", token: player });
    expect((await join(gm)).result).toMatchObject({ ok: true, role: "gm" });
    for (const dead of ["not-a-credential", revokedGm]) {
      const refused = await join(dead);
      expect(refused.result).toMatchObject({ ok: false, code: "unauthenticated" });
      expect(refused.result.token).toBeUndefined();
    }
  });

  it("tells a GM socket its session ended when it is revoked or runs out, and drops it", async () => {
    const token = (await server.auth.login("a sufficiently long GM password"))!;
    const { socket } = await join(token);
    const ended = new Promise<void>((done) => socket.once("session:ended", () => done()));
    const dropped = new Promise<void>((done) => socket.once("disconnect", () => done()));
    // Revoked without any broadcast: the sweep finds it, as it finds a session that ran out.
    await server.auth.revokeAllGmSessions();
    await ended;
    await dropped;
    expect(socket.connected).toBe(false);
  });
});
