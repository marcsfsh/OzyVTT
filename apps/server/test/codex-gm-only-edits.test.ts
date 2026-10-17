import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

// A GM-only edit must leave every byte a player can read where it was: the bodies, the lists, the search hits
// and their order, and the ETags. Each test makes a change players cannot see and compares what a player
// (and the GM's preview session, which is a real player session) reads before and after it.

const PLAYER_TOKEN = "player-token";
const PREVIEW_TOKEN = "preview-player-token";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-gm-only-"));
  // A clock that moves on every read, so a write that stamps a time can always be told from one that does not.
  let clock = Date.parse("2026-08-01T00:00:00.000Z");
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => (clock += 1000));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize();
  await assets.initialize();
  const app = express();
  app.use(express.json());
  app.use(
    createCodexRouter({
      store,
      assets,
      verifiers: fixedVerifiers({ gm: ["gm-token"], player: [PLAYER_TOKEN, PREVIEW_TOKEN] }),
      notifyChanged: () => {},
      issuePreviewSession: () => PREVIEW_TOKEN
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
  return { base: `http://127.0.0.1:${port}/api/v1/codex`, store };
}

/** One read as a player receives it: the status and the exact bytes. */
async function read(base: string, path: string, token: string) {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { path, status: response.status, body: await response.text() };
}

/** The same reads for the player and for the preview session. */
async function readAll(base: string, paths: readonly string[]) {
  const reads = [];
  for (const token of [PLAYER_TOKEN, PREVIEW_TOKEN])
    for (const path of paths) reads.push(await read(base, path, token));
  return reads;
}

/** Runs `edit`, then checks that every read in `paths` answers exactly as it did before. */
async function expectUnmoved(base: string, paths: readonly string[], edit: () => unknown) {
  const before = await readAll(base, paths);
  for (const answer of before) expect(answer.status, answer.path).toBe(200);
  await edit();
  expect(await readAll(base, paths)).toEqual(before);
}

describe("Codex pages: the GM half and the GM's filing move nothing a player reads", () => {
  // The walkthrough's case: one line added to the Lantern Order's GM notes put it first on the players' Recently
  // updated card, because the card sorted by an edit time that every save moved.
  it("keeps a page's player reads, and the players' recent order, when the GM adds a line to its GM notes", async () => {
    const { base, store } = await fixture();
    const order = store.createPage({
      title: "Lantern Order",
      entityType: "faction",
      playerBody: "A guild of lamplighters.",
      gmBody: "Maelis leads it.",
      revealedToPlayers: true
    });
    const town = store.createPage({ title: "Vallaki", playerBody: "A walled town.", revealedToPlayers: true });
    const paths = ["/pages", `/pages/${order.id}`, `/pages/${town.id}`, "/search?q=lantern", "/timeline"];

    await expectUnmoved(base, paths, () =>
      store.updatePage(
        order.id,
        { gmBody: "Maelis leads it.\n\nShe has asked the capital for soldiers." },
        undefined,
        "gm"
      )
    );
    const pages = JSON.parse((await read(base, "/pages", PLAYER_TOKEN)).body).data.pages as Array<{
      title: string;
      playerUpdatedAt: string;
    }>;
    const recent = [...pages].sort((a, b) => b.playerUpdatedAt.localeCompare(a.playerUpdatedAt));
    expect(recent.map((page) => page.title)).toEqual(["Vallaki", "Lantern Order"]);

    // A change players can see still moves it, so the card still does its job.
    store.updatePage(order.id, { playerBody: "A guild of lamplighters, armed." }, undefined, "gm");
    const after = JSON.parse((await read(base, "/pages", PLAYER_TOKEN)).body).data.pages as typeof pages;
    expect([...after].sort((a, b) => b.playerUpdatedAt.localeCompare(a.playerUpdatedAt))[0].title).toBe(
      "Lantern Order"
    );
  });

  it("keeps a page's player reads when the GM files it, moves its folder or deletes the folder", async () => {
    const { base, store } = await fixture();
    const order = store.createPage({ title: "Lantern Order", folder: "Factions", revealedToPlayers: true });
    const paths = ["/pages", `/pages/${order.id}`, "/search?q=lantern"];

    await expectUnmoved(base, paths, () => store.updatePage(order.id, { folder: "Villains" }, undefined, "gm"));
    await expectUnmoved(base, paths, () => store.moveFolder("Villains", "Foes/Cults"));
    await expectUnmoved(base, paths, () => store.deleteFolder("Foes"));
  });

  it("keeps a page's player reads when the GM changes its GM fields or adds a GM-layer connection", async () => {
    const { base, store } = await fixture();
    const order = store.createPage({ title: "Lantern Order", entityType: "faction", revealedToPlayers: true });
    const town = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const paths = ["/pages", `/pages/${order.id}`, `/pages/${town.id}`, "/connections"];

    await expectUnmoved(base, paths, () =>
      store.updatePage(order.id, { gmFields: { goals: "Seize the capital" } }, undefined, "gm")
    );
    await expectUnmoved(base, paths, () =>
      store.createConnection(order.id, { toPageId: town.id, label: "watches", layer: "gm" })
    );
  });
});
