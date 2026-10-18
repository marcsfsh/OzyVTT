import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { createCodexRouter } from "../src/codex-http.js";
import { MapAssetStore } from "../src/map-assets.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

/** A Codex router over a fresh store, one GM token and one player token, with small JSON helpers. */

export type Json = Record<string, unknown> & { data?: Json };
export const GM = { authorization: "Bearer gm-token" };
export const PLAYER = { authorization: "Bearer player-token" };

/** Call once at the top of a test file: it registers the cleanup and answers the fixture each test builds. */
export function codexHttp() {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });
  return async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-http-"));
    // Each stamp a minute after the last, so every write can be told apart by time.
    let clock = Date.parse("2026-10-17T18:00:00.000Z");
    const store = new CodexStore(join(directory, "vtt.sqlite"), () => (clock += 60_000));
    const assets = new MapAssetStore(join(directory, "codex-assets"));
    await store.initialize();
    await assets.initialize();
    const app = express();
    app.use(express.json());
    app.use(
      createCodexRouter({
        store,
        assets,
        verifiers: fixedVerifiers({ gm: ["gm-token"], player: ["player-token"] }),
        notifyChanged: () => {},
        issuePreviewSession: () => "player-token"
      })
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}/api/v1/codex`;
    const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: (await response.json()) as Json };
    };
    return {
      store,
      get: (path: string, headers = GM) => call("GET", path, headers),
      post: (path: string, body: unknown, headers = GM) => call("POST", path, headers, body),
      patch: (path: string, body: unknown, headers = GM) => call("PATCH", path, headers, body),
      del: (path: string, headers = GM) => call("DELETE", path, headers)
    };
  };
}
