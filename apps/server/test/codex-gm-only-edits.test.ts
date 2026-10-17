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

/** One read as a player receives it: the status, the ETag and the exact bytes. */
async function read(base: string, path: string, token: string) {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { path, status: response.status, etag: response.headers.get("etag"), body: await response.text() };
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

describe("Codex search: a player's hits and their order come from what players can read", () => {
  it("keeps a player's order when the GM writes hidden pages full of one query word", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "First notes", playerBody: "amber amber amber vault", revealedToPlayers: true });
    store.createPage({ title: "Second notes", playerBody: "vault vault vault amber", revealedToPlayers: true });
    // Hidden prep: ten pages with neither word and two with "vault". A ranking that weighed a word by how many
    // rows hold it, hidden ones included, would put the "amber" page first...
    for (let index = 0; index < 10; index += 1) store.createPage({ title: `Prep ${index}`, playerBody: "rain" });
    store.createPage({ title: "Prep vault one", playerBody: "vault" });
    store.createPage({ title: "Prep vault two", playerBody: "vault" });

    // ...and six more hidden pages holding "amber" would flip it.
    await expectUnmoved(base, ["/search?q=amber%20vault"], () => {
      for (let index = 0; index < 6; index += 1)
        store.createPage({ title: `Prep amber ${index}`, playerBody: "amber" });
    });
  });

  it("measures the cap after the player gates, so a record players cannot see never takes a place under it", async () => {
    const { base, store } = await fixture();
    for (let index = 0; index < 50; index += 1)
      store.createPage({ title: `Barovia hamlet ${index}`, playerBody: "barovia", revealedToPlayers: true });
    const faction = store.createPage({ title: "The Order", entityType: "faction" });
    store.setStanding(faction.id, 10, "");

    await expectUnmoved(base, ["/search?q=barovia"], () => {
      // A standing record for a hidden faction, tagged so it matches: revealed, but gated by its faction.
      const record = store.listTimeline().find((entry) => entry.kind === "standing")!;
      store.updateEntry(record.id, { tags: ["barovia"] });
      store.setEntryRevealed(record.id, true);
    });
    const answer = JSON.parse((await read(base, "/search?q=barovia", PLAYER_TOKEN)).body);
    expect(answer.data.hits).toHaveLength(50);
    expect(answer.data.truncated, "fifty matches a player can see are not a cut-off").toBe(false);
  });
});

describe("Codex connections: a GM-only edit moves no player's connection", () => {
  it("keeps the order of a page's mentions when the GM saves the GM half of one that mentions it", async () => {
    const { base, store } = await fixture();
    const target = store.createPage({ title: "Lantern Order", revealedToPlayers: true });
    const first = store.createPage({ title: "Vallaki", playerBody: "[[Lantern Order]]", revealedToPlayers: true });
    store.createPage({ title: "Krezk", playerBody: "[[Lantern Order]]", revealedToPlayers: true });

    await expectUnmoved(base, [`/pages/${target.id}`, "/connections"], () =>
      store.updatePage(first.id, { gmBody: "The order is a front." }, undefined, "gm")
    );
  });

  it("keeps a revealed page's connections when the GM writes a hidden page with the same title", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Lantern Order", revealedToPlayers: true });
    const town = store.createPage({ title: "Vallaki", playerBody: "[[Lantern Order]]", revealedToPlayers: true });

    await expectUnmoved(base, [`/pages/${town.id}`, "/connections"], () =>
      store.createPage({ title: "Lantern Order", gmBody: "The real one." })
    );
  });

  it("keeps a player's mention when the GM adds a GM-layer connection between the same two pages", async () => {
    const { base, store } = await fixture();
    const bree = store.createPage({ title: "Bree", revealedToPlayers: true });
    const road = store.createPage({ title: "Road", playerBody: "leads to [[Bree]]", revealedToPlayers: true });

    await expectUnmoved(base, [`/pages/${road.id}`, `/pages/${bree.id}`, "/connections"], () =>
      store.createConnection(road.id, { toPageId: bree.id, layer: "gm" })
    );
  });
});

describe("Codex journal: a hidden session never places a player's entry", () => {
  /** Three revealed, undated entries: one filed under a revealed session, two unfiled. */
  const seed = (store: CodexStore) => {
    const shown = store.createSession({ sessionNumber: 1 });
    store.setSessionRevealed(shown.id, true);
    const hidden = store.createSession({ sessionNumber: 2 });
    const entries = ["We reached the town.", "We met the burgomaster.", "We left at dawn."].map((playerText) => {
      const entry = store.createEntry({ playerText, sessionId: null, revealedToPlayers: true });
      return entry.id;
    });
    store.updateEntry(entries[0], { sessionId: shown.id });
    return { hidden, entries };
  };

  it("keeps a player's order when the GM files an entry under a hidden session", async () => {
    const { base, store } = await fixture();
    const { hidden, entries } = seed(store);
    await expectUnmoved(base, ["/journal", "/timeline"], () => store.updateEntry(entries[2], { sessionId: hidden.id }));
  });

  it("keeps a player's order when the GM renumbers a hidden session that files an entry", async () => {
    const { base, store } = await fixture();
    const { hidden, entries } = seed(store);
    const later = store.createSession({ sessionNumber: 3 });
    store.setSessionRevealed(later.id, true);
    store.updateEntry(entries[1], { sessionId: later.id });
    store.updateEntry(entries[2], { sessionId: hidden.id });
    await expectUnmoved(base, ["/journal", "/timeline"], () =>
      store.updateSession(hidden.id, { sessionNumber: 9 }, undefined)
    );
  });
});
