import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { CodexStore } from "../src/codex-store.js";
import { createCodexRouter } from "../src/codex-http.js";
import { parseSearchQuery } from "../src/codex-requests.js";
import { EVERYONE } from "../src/codex-projections.js";
import { CODEX_MIGRATIONS } from "../src/codex/schema.js";
import { PlayerCodexChanges, PlayerCodexReads, readerKey, readerOf } from "../src/codex/player-reads.js";
import { migrate } from "../src/database.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createServer } from "../src/server.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

// Who receives what, now that a page or quest holds blocks and objectives with their own audiences. Each reader
// reads through the router as a player would: a player with no character, Lyra's player, Borin's player, and the
// GM's previews (real player sessions) as everyone and as Lyra.

const LYRA = "0b6f6a3e-8f3c-4b1e-9d2a-1c2b3a4d5e6f";
const BORIN = "1c7a7b4f-9a4d-4c2f-8e3b-2d3c4b5e6f70";
const CASS = "2d8b8c5a-0b5e-4d3a-9f4c-3e4d5c6f7a81";
/** Not in the party. */
const STRANGER = "3e9c9d6b-1c6f-4e4b-8a5d-4f5e6d7a8b92";
const GM = "gm-token";
const PLAYER = "player-token";
const LYRA_TOKEN = "lyra-player-token";
const BORIN_TOKEN = "borin-player-token";
const PREVIEW = "preview-player-token";
const PREVIEW_LYRA = "preview-lyra-token";
/** Readers who hold no character Lyra's audience names. */
const NOT_LYRA = [PLAYER, BORIN_TOKEN, PREVIEW];
const AS_LYRA = [LYRA_TOKEN, PREVIEW_LYRA];
const READERS = [EVERYONE, readerOf([LYRA]), readerOf([BORIN])];
const REQUEST_ID = "8d0f3c1e-7a42-4b6d-9e15-2c4a6f8b0d13";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-readers-"));
  // Moves on every read, so each write has its own time; `stopClock` holds it at one moment.
  let clock = Date.parse("2026-08-01T00:00:00.000Z");
  let stopped: number | null = null;
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => stopped ?? (clock += 1000));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize();
  await assets.initialize();
  const app = express();
  app.use(express.json());
  app.use(
    createCodexRouter({
      store,
      assets,
      verifiers: fixedVerifiers({
        gm: [GM],
        player: [PLAYER, LYRA_TOKEN, BORIN_TOKEN],
        previews: { [PREVIEW]: [], [PREVIEW_LYRA]: [LYRA] }
      }),
      notifyChanged: () => {},
      issuePreviewSession: (characterIds) => (characterIds[0] === LYRA ? PREVIEW_LYRA : PREVIEW),
      playerCharacters: (sessionId) =>
        sessionId === `player:${LYRA_TOKEN}` ? [LYRA] : sessionId === `player:${BORIN_TOKEN}` ? [BORIN] : [],
      partyCharacters: () => new Set([LYRA, BORIN, CASS])
    })
  );
  const server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const stopClock = (at: string) => {
    stopped = Date.parse(at);
  };
  return { base: `http://127.0.0.1:${port}/api/v1/codex`, store, stopClock };
}

type Answer = { path: string; status: number; etag: string | null; body: string };

async function call(base: string, method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": REQUEST_ID },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as { data: any; error?: any }) : null };
}

async function read(base: string, path: string, token: string): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}`, "x-request-id": REQUEST_ID }
  });
  return { path, status: response.status, etag: response.headers.get("etag"), body: await response.text() };
}

async function readAs(base: string, paths: readonly string[], tokens: readonly string[]) {
  const answers: Answer[] = [];
  for (const token of tokens) for (const path of paths) answers.push(await read(base, path, token));
  return answers;
}

const data = (answer: Answer) => (JSON.parse(answer.body) as { data: any }).data;

describe("Codex readers: hidden blocks in a page a player reads", () => {
  it("joins the player text around a hidden block between two shown ones, and leaves no trace of it", async () => {
    const { base, store } = await fixture();
    const page = store.createPage({
      title: "Vallaki",
      playerBody: "First.\n\nSecond.\n\nThird.",
      blocks: [
        { anchor: 1, text: "Shown one." },
        { anchor: 2, title: "Ossuary", text: "The bones lie under the church." },
        { anchor: 3, title: "Later", text: "Shown two." }
      ],
      revealedToPlayers: true
    });
    const [first, hidden, last] = page.blocks;
    store.setPageBlockAudience(page.id, first!.id, "everyone");
    store.setPageBlockAudience(page.id, last!.id, "everyone");

    for (const token of [...NOT_LYRA, ...AS_LYRA]) {
      const answer = await read(base, `/pages/${page.id}`, token);
      const shown = data(answer).page;
      expect(shown.body).toBe("First.\n\nShown one.\n\nSecond.\n\nThird.\n\n## Later\n\nShown two.");
      expect(
        shown.blocks.map((block: { start: number; end: number }) => shown.body.slice(block.start, block.end))
      ).toEqual(["Shown one.", "## Later\n\nShown two."]);
      expect(answer.body).not.toMatch(/Ossuary|bones|church/);
      expect(answer.body).not.toContain(hidden!.id);
    }

    // No trace: every read is the bytes it would be with the block deleted.
    const paths = ["/pages", `/pages/${page.id}`, "/search?q=bones", "/search?q=vallaki", "/connections"];
    const before = await readAs(base, paths, [...NOT_LYRA, ...AS_LYRA]);
    expect(data(before[2]!).hits).toEqual([]);
    store.deletePageBlock(page.id, hidden!.id);
    expect(await readAs(base, paths, [...NOT_LYRA, ...AS_LYRA])).toEqual(before);
  });

  it("keeps a link in a hidden block off every player read until the block reaches that reader", async () => {
    const { base, store } = await fixture();
    const order = store.createPage({ title: "Lantern Order", entityType: "faction", revealedToPlayers: true });
    const town = store.createPage({
      title: "Vallaki",
      playerBody: "A walled town.",
      blocks: [{ text: "The [[Lantern Order]] pays the burgomaster." }],
      revealedToPlayers: true
    });
    const block = town.blocks[0]!;
    /** The mention as a reader finds it: in the graph, as a backlink on the order, and on the town's own panel. */
    const mention = async (token: string) => ({
      graph: data(await read(base, "/connections", token)).connections.filter(
        (edge: { fromId: string; toPageId: string }) => edge.fromId === town.id && edge.toPageId === order.id
      ).length,
      backlink: data(await read(base, `/pages/${order.id}`, token)).connections.filter(
        (row: { otherId: string }) => row.otherId === town.id
      ).length,
      outgoing: data(await read(base, `/pages/${town.id}`, token)).connections.filter(
        (row: { otherId: string }) => row.otherId === order.id
      ).length
    });
    const NONE = { graph: 0, backlink: 0, outgoing: 0 };
    const FOUND = { graph: 1, backlink: 1, outgoing: 1 };

    // The GM has it, on the GM layer.
    const gmEdges = data(await read(base, "/connections", GM)).connections.filter(
      (edge: { fromId: string }) => edge.fromId === town.id
    );
    expect(gmEdges).toEqual([expect.objectContaining({ origin: "mention", layer: "gm", characterIds: [] })]);
    for (const token of [...NOT_LYRA, ...AS_LYRA]) expect(await mention(token), token).toEqual(NONE);

    store.setPageBlockAudience(town.id, block.id, "characters", [LYRA]);
    for (const token of NOT_LYRA) expect(await mention(token), token).toEqual(NONE);
    for (const token of AS_LYRA) expect(await mention(token), token).toEqual(FOUND);

    store.setPageBlockAudience(town.id, block.id, "everyone");
    for (const token of [...NOT_LYRA, ...AS_LYRA]) expect(await mention(token), token).toEqual(FOUND);
  });

  it("prints a link in a shown block to a page the reader cannot open as its plain text", async () => {
    const { base, store } = await fixture();
    const cult = store.createPage({ title: "The Cult", entityType: "faction", playerBody: "Lantern bearers." });
    const town = store.createPage({
      title: "Vallaki",
      playerBody: "A walled town.",
      blocks: [{ title: "Ask [[The Cult]]", text: "Ask [[page:The Cult]] about [[The Cult#Rites]]." }],
      revealedToPlayers: true
    });
    store.setPageBlockAudience(town.id, town.blocks[0]!.id, "everyone");

    for (const token of [...NOT_LYRA, ...AS_LYRA]) {
      const answer = await read(base, `/pages/${town.id}`, token);
      const shown = data(answer).page;
      expect(shown.body).toBe("A walled town.\n\n## Ask The Cult\n\nAsk The Cult about The Cult › Rites.");
      expect(shown.blocks[0].title).toBe("Ask The Cult");
      expect(data(answer).connections).toEqual([]);
      expect(answer.body).not.toContain(cult.id);
    }

    // Once players can open the page, the links are links again.
    store.setPageRevealed(cult.id, true);
    const shown = data(await read(base, `/pages/${town.id}`, PLAYER)).page;
    expect(shown.body).toBe("A walled town.\n\n## Ask [[The Cult]]\n\nAsk [[page:The Cult]] about [[The Cult#Rites]].");
  });

  it("gives a block shown to Lyra to Lyra's player alone, and moves nothing Borin's player reads", async () => {
    const { base, store, stopClock } = await fixture();
    const changes = new PlayerCodexChanges(store);
    const page = store.createPage({
      title: "Vallaki",
      playerBody: "A walled town.",
      blocks: [{ title: "Your aunt", text: "She left you the key to the ossuary." }],
      revealedToPlayers: true
    });
    changes.next(READERS);
    const paths = ["/pages", `/pages/${page.id}`, "/search?q=ossuary", "/connections", "/timeline"];
    const others = await readAs(base, paths, NOT_LYRA);
    const lyraBefore = await readAs(base, paths, [LYRA_TOKEN]);

    stopClock("2026-08-02T10:00:00.000Z");
    store.setPageBlockAudience(page.id, page.blocks[0]!.id, "characters", [LYRA]);

    // Borin's player reads the same bytes and ETags, and is not pinged; Lyra's player is.
    expect(await readAs(base, paths, NOT_LYRA)).toEqual(others);
    expect([...changes.next(READERS)]).toEqual([[readerKey(readerOf([LYRA])), 1]]);
    const lyraAfter = await readAs(base, paths, [LYRA_TOKEN]);
    const lyraPage = data(lyraAfter[1]!).page;
    expect(lyraPage.body).toBe("A walled town.\n\n## Your aunt\n\nShe left you the key to the ossuary.");
    expect(lyraPage.blocks).toEqual([
      {
        title: "Your aunt",
        start: 16,
        end: 16 + "## Your aunt\n\nShe left you the key to the ossuary.".length,
        characterIds: [LYRA],
        revealed: { at: "2026-08-02T10:00:00.000Z", sessionNumber: null, inWorldDate: null, inWorldLabel: null }
      }
    ]);
    expect(lyraAfter[1]!.etag).not.toBe(lyraBefore[1]!.etag);
    // Lyra's list moves the page up; Borin's keeps the time the page was last changed for everyone.
    const updatedAt = (answer: Answer) => data(answer).pages[0].playerUpdatedAt as string;
    expect(updatedAt(lyraAfter[0]!)).toBe("2026-08-02T10:00:00.000Z");
    expect(updatedAt(others[1 * paths.length]!)).toBe(page.playerUpdatedAt);
    expect(data(lyraAfter[2]!).hits.map((hit: { id: string }) => hit.id)).toEqual([page.id]);
    expect(await readAs(base, paths, [PREVIEW_LYRA])).toEqual(lyraAfter);

    // Shown to Cass too: Lyra's player does not learn who else has it, and reads the same bytes.
    store.setPageBlockAudience(page.id, page.blocks[0]!.id, "characters", [LYRA, CASS]);
    expect(await readAs(base, paths, [LYRA_TOKEN])).toEqual(lyraAfter);
    expect(await readAs(base, paths, NOT_LYRA)).toEqual(others);
    expect([...changes.next(READERS)]).toEqual([]);

    // Hidden again: it leaves Lyra's read, and Borin's still does not move.
    store.setPageBlockAudience(page.id, page.blocks[0]!.id, "hidden");
    expect(data(await read(base, `/pages/${page.id}`, LYRA_TOKEN)).page.body).toBe("A walled town.");
    expect(await readAs(base, paths, NOT_LYRA)).toEqual(others);
    expect([...changes.next(READERS)]).toEqual([[readerKey(readerOf([LYRA])), 2]]);
  });

  it("lets each reader load an image only from a block that reader may see", async () => {
    const { store } = await fixture();
    const asset = crypto.randomUUID();
    const page = store.createPage({
      title: "Vallaki",
      blocks: [{ text: `![The key](/api/v1/codex/assets/${asset})` }],
      revealedToPlayers: true
    });
    const visible = () => READERS.map((reader) => store.isMediaVisibleToPlayers(asset, reader));
    expect(visible()).toEqual([false, false, false]);
    store.setPageBlockAudience(page.id, page.blocks[0]!.id, "characters", [LYRA]);
    expect(visible()).toEqual([false, true, false]);
    store.setPageBlockAudience(page.id, page.blocks[0]!.id, "everyone");
    expect(visible()).toEqual([true, true, true]);
  });
});

describe("Codex readers: a link to a page the reader cannot open, in every kind of record text", () => {
  const LINK = "[[The Cult]]";
  type Ids = Readonly<Record<string, string>>;
  type Case = Readonly<{
    kind: string;
    /** Writes revealed records with `LINK` in their text, beside a revealed town and faction; answers their ids. */
    seed: (store: CodexStore, around: Ids) => Ids;
    /** Every piece of those records' text a player reads, in a fixed order. */
    texts: (base: string, token: string, ids: Ids) => Promise<unknown[]>;
    /** The same pieces as the GM wrote them. */
    written: readonly string[];
  }>;
  const get = async (base: string, path: string, token: string) => data(await read(base, path, token));
  const pin = (store: CodexStore, mapId: string, label: string, pageIds: string[] = []) =>
    store.createMarker(mapId, {
      x: 0.5,
      y: 0.5,
      iconId: "pin",
      iconColor: "#ff8800",
      label,
      pageIds,
      revealedToPlayers: true
    });

  const CASES: readonly Case[] = [
    {
      kind: "a session's recap and date",
      seed: (store) => {
        const session = store.createSession({
          sessionNumber: 1,
          realDate: `${LINK} night`,
          recapBody: `We fled ${LINK}.`
        });
        store.setSessionRevealed(session.id, true);
        return { session: session.id };
      },
      texts: async (base, token, ids) => {
        const listed = (await get(base, "/sessions", token)).sessions[0];
        const one = (await get(base, `/sessions/${ids.session}`, token)).session;
        return [listed.recap, listed.realDate, one.recap];
      },
      written: [`We fled ${LINK}.`, `${LINK} night`, `We fled ${LINK}.`]
    },
    {
      kind: "a journal entry, in the journal, a page's journal and the chronicle",
      seed: (store, around) => {
        store.createEntry({
          playerText: `The lamps of ${LINK} burn blue.`,
          realDate: `${LINK} eve`,
          attachPageId: around.town!,
          sessionId: null,
          revealedToPlayers: true
        });
        return {};
      },
      texts: async (base, token, around) => {
        const entry = (await get(base, "/journal", token)).entries[0];
        const attached = (await get(base, `/journal?pageId=${around.town}`, token)).entries[0];
        const record = (await get(base, "/timeline", token)).records[0];
        return [entry.text, entry.realDate, attached.text, record.text, record.realDate];
      },
      written: [
        `The lamps of ${LINK} burn blue.`,
        `${LINK} eve`,
        `The lamps of ${LINK} burn blue.`,
        `The lamps of ${LINK} burn blue.`,
        `${LINK} eve`
      ]
    },
    {
      kind: "a milestone's, a downtime's and a standing change's details",
      seed: (store, around) => {
        store.createMilestone({
          playerText: "Level 3.",
          sessionId: null,
          milestone: { level: 3, reason: `Beat ${LINK}` },
          revealedToPlayers: true
        });
        store.createDowntime({
          playerText: "A tenday.",
          sessionId: null,
          downtime: { who: `${LINK} spy`, activity: `Watching ${LINK}`, days: 3 },
          revealedToPlayers: true
        });
        store.setStanding(around.faction!, 10, `Burned a ${LINK} shrine`);
        store.setStandingRevealed(around.faction!, true);
        store.setEntryRevealed(store.listTimeline().find((entry) => entry.kind === "standing")!.id, true);
        return {};
      },
      texts: async (base, token) => {
        const records = (await get(base, "/timeline", token)).records as Array<{ kind: string; payload: any }>;
        const payload = (kind: string) => records.find((record) => record.kind === kind)!.payload;
        return [
          payload("milestone").reason,
          payload("downtime").who,
          payload("downtime").activity,
          payload("standing").reason
        ];
      },
      written: [`Beat ${LINK}`, `${LINK} spy`, `Watching ${LINK}`, `Burned a ${LINK} shrine`]
    },
    {
      kind: "a quest's title and objectives",
      seed: (store) => ({
        quest: store.createQuest({
          title: `Unmask ${LINK}`,
          objectives: [{ text: `Find ${LINK}`, done: false }],
          revealedToPlayers: true
        }).id
      }),
      texts: async (base, token, ids) => {
        const listed = (await get(base, "/quests", token)).quests[0];
        const one = (await get(base, `/quests/${ids.quest}`, token)).quest;
        return [listed.title, listed.objectives[0].text, one.title, one.objectives[0].text];
      },
      written: [`Unmask ${LINK}`, `Find ${LINK}`, `Unmask ${LINK}`, `Find ${LINK}`]
    },
    {
      kind: "a map's name, a pin's label and the party's place",
      seed: (store, around) => {
        const map = store.createMap({
          assetId: crypto.randomUUID(),
          name: `${LINK} lands`,
          kind: "regional",
          revealedToPlayers: true
        });
        const hall = pin(store, map.id, `${LINK} hall`, [around.town!]);
        store.setPartyMarker(hall.id);
        return { map: map.id, pin: hall.id };
      },
      texts: async (base, token, ids) => {
        const party = (await get(base, "/party", token)).party;
        return [
          (await get(base, "/maps", token)).maps[0].name,
          (await get(base, `/maps/${ids.map}/markers`, token)).markers[0].label,
          (await get(base, `/markers/${ids.pin}`, token)).marker.label,
          (await get(base, `/pages/${ids.town}/markers`, token)).markers[0].label,
          party.marker.label,
          party.mapName
        ];
      },
      written: [`${LINK} lands`, `${LINK} hall`, `${LINK} hall`, `${LINK} hall`, `${LINK} hall`, `${LINK} lands`]
    },
    {
      kind: "a page's title and fields",
      seed: (store) => ({
        page: store.createPage({
          title: `Shrine of ${LINK}`,
          entityType: "location",
          fields: { ruler: `${LINK} elders` },
          revealedToPlayers: true
        }).id
      }),
      texts: async (base, token, ids) => {
        const listed = (await get(base, "/pages", token)).pages.find((page: { id: string }) => page.id === ids.page);
        const one = (await get(base, `/pages/${ids.page}`, token)).page;
        return [listed.title, one.title, one.fields.ruler];
      },
      written: [`Shrine of ${LINK}`, `Shrine of ${LINK}`, `${LINK} elders`]
    },
    {
      kind: "a connection's label and a page panel's rows",
      seed: (store, around) => {
        store.createEntry({ playerText: `[[Vallaki]] fears ${LINK}.`, sessionId: null, revealedToPlayers: true });
        store.createConnection(around.town!, { toPageId: around.faction!, label: `fears ${LINK}` });
        return {};
      },
      texts: async (base, token, ids) => {
        const edge = (await get(base, "/connections", token)).connections.find(
          (row: { origin: string }) => row.origin === "declared"
        );
        const panel = (await get(base, `/pages/${ids.town}`, token)).connections as Array<Record<string, string>>;
        return [
          edge.label,
          panel.find((row) => row.origin === "declared")!.label,
          panel.find((row) => row.otherKind === "journal")!.otherTitle
        ];
      },
      written: [`fears ${LINK}`, `fears ${LINK}`, `[[Vallaki]] fears ${LINK}.`]
    },
    {
      kind: "search hits",
      seed: (store) => {
        const map = store.createMap({
          assetId: crypto.randomUUID(),
          name: `${LINK} lanterns`,
          kind: "regional",
          revealedToPlayers: true
        });
        pin(store, map.id, `${LINK} lanterns`);
        store.createEntry({ playerText: `${LINK} lanterns`, sessionId: null, revealedToPlayers: true });
        store.createPage({ title: `${LINK} lanterns`, revealedToPlayers: true });
        store.createQuest({ title: `${LINK} lanterns`, revealedToPlayers: true });
        store.setSessionRevealed(store.createSession({ recapBody: `${LINK} lanterns` }).id, true);
        return {};
      },
      texts: async (base, token) =>
        ((await get(base, "/search?q=lanterns", token)).hits as Array<{ kind: string; title: string }>)
          .map((hit) => `${hit.kind}: ${hit.title}`)
          .sort(),
      written: ["journal", "map", "marker", "page", "quest", "session"].map((kind) => `${kind}: ${LINK} lanterns`)
    }
  ];

  it.each(CASES)("prints it as plain text in $kind, per reader, until the page is revealed", async (each) => {
    const { base, store } = await fixture();
    const cult = store.createPage({ title: "The Cult", entityType: "faction", playerBody: "Lantern bearers." });
    const town = store.createPage({ title: "Vallaki", entityType: "location", revealedToPlayers: true });
    const faction = store.createPage({ title: "Lantern Order", entityType: "faction", revealedToPlayers: true });
    const around = { town: town.id, faction: faction.id };
    const ids = { ...around, ...each.seed(store, around) };
    const plain = each.written.map((text) => text.replaceAll(LINK, "The Cult"));

    for (const token of [PLAYER, LYRA_TOKEN, PREVIEW_LYRA])
      expect(await each.texts(base, token, ids), token).toEqual(plain);

    // Once players can open the page, the link is a link again.
    store.setPageRevealed(cult.id, true);
    for (const token of [PLAYER, LYRA_TOKEN]) expect(await each.texts(base, token, ids), token).toEqual(each.written);
  });
});

describe("Codex readers: quest objectives", () => {
  it("lists only the objectives a reader may see, so a count of them counts only those", async () => {
    const { base, store } = await fixture();
    const quest = store.createQuest({
      title: "Light the lanterns",
      playerBody: "Find the oil.",
      objectives: [
        { text: "Find oil", done: true },
        { text: "Taste the oil", done: false, audience: "hidden" },
        { text: "Ask Lyra's aunt", done: true, audience: "characters", characterIds: [LYRA] }
      ],
      revealedToPlayers: true
    });
    const objectives = async (token: string) => {
      const one = await read(base, `/quests/${quest.id}`, token);
      const listed = data(await read(base, "/quests", token)).quests[0].objectives;
      expect(listed).toEqual(data(one).quest.objectives);
      return { listed, bytes: one.body };
    };
    for (const token of NOT_LYRA) {
      const { listed, bytes } = await objectives(token);
      expect(listed, token).toEqual([{ text: "Find oil", done: true }]);
      expect(bytes).not.toMatch(/Taste|aunt/);
    }
    for (const token of AS_LYRA) {
      const { listed, bytes } = await objectives(token);
      expect(listed, token).toEqual([
        { text: "Find oil", done: true },
        { text: "Ask Lyra's aunt", done: true }
      ]);
      expect(bytes).not.toContain("Taste");
    }

    // Shown to everyone by its own write; the GM's list keeps every objective and its audience.
    const hidden = store.getQuest(quest.id)!.objectives[1]!;
    expect(hidden).toMatchObject({ text: "Taste the oil", audience: "hidden", characterIds: [] });
    const shown = await call(base, "PUT", `/quests/${quest.id}/objectives/${hidden.id}/audience`, GM, {
      audience: "everyone"
    });
    expect(shown.status).toBe(200);
    expect((await objectives(BORIN_TOKEN)).listed).toEqual([
      { text: "Find oil", done: true },
      { text: "Taste the oil", done: false }
    ]);
    expect((await objectives(LYRA_TOKEN)).listed).toHaveLength(3);
  });
});

describe("Codex readers: who may set an audience", () => {
  it("takes an audience from the GM alone, and only one that names party characters", async () => {
    const { base, store } = await fixture();
    const page = store.createPage({ title: "Vallaki", blocks: [{ text: "A secret." }], revealedToPlayers: true });
    const quest = store.createQuest({
      title: "Q",
      objectives: [{ text: "One", done: false }],
      revealedToPlayers: true
    });
    const blockPath = `/pages/${page.id}/blocks/${page.blocks[0]!.id}/audience`;
    const objectivePath = `/quests/${quest.id}/objectives/${quest.objectives[0]!.id}/audience`;
    const fieldPath = `/pages/${page.id}/fields/kind/audience`;

    for (const token of [PLAYER, LYRA_TOKEN, PREVIEW, PREVIEW_LYRA]) {
      expect((await call(base, "PUT", blockPath, token, { audience: "everyone" })).status, token).toBe(403);
      expect((await call(base, "PUT", objectivePath, token, { audience: "hidden" })).status, token).toBe(403);
      expect((await call(base, "PUT", fieldPath, token, { audience: "hidden" })).status, token).toBe(403);
    }
    const stranger = await call(base, "PUT", blockPath, GM, { audience: "characters", characterIds: [STRANGER] });
    expect(stranger.status).toBe(400);
    expect(stranger.json!.error.message).toBe("That character is not in the party.");
    expect(
      (await call(base, "PUT", objectivePath, GM, { audience: "characters", characterIds: [STRANGER] })).status
    ).toBe(400);
    expect((await call(base, "PUT", blockPath, GM, { audience: "characters", characterIds: [] })).status).toBe(400);
    expect((await call(base, "POST", "/preview-session", GM, { characterId: STRANGER })).status).toBe(400);
    // Nothing above changed who sees anything.
    expect(store.getPage(page.id)!.blocks[0]).toMatchObject({ audience: "hidden", reveals: [] });
    expect(store.getQuest(quest.id)!.objectives[0]).toMatchObject({ audience: "everyone" });

    const lyra = await call(base, "PUT", blockPath, GM, { audience: "characters", characterIds: [LYRA] });
    expect(lyra.status).toBe(200);
    expect(lyra.json!.data.page.blocks[0]).toMatchObject({ audience: "characters", characterIds: [LYRA] });
  });

  it("previews as one character exactly what that character's player reads", async () => {
    const { base, store } = await fixture();
    const town = store.createPage({
      title: "Vallaki",
      playerBody: "A walled town.",
      blocks: [{ text: "For Lyra: [[Lantern Order]]." }, { text: "For all." }],
      revealedToPlayers: true
    });
    const order = store.createPage({ title: "Lantern Order", revealedToPlayers: true });
    store.setPageBlockAudience(town.id, town.blocks[0]!.id, "characters", [LYRA]);
    store.setPageBlockAudience(town.id, town.blocks[1]!.id, "everyone");
    const quest = store.createQuest({
      title: "Light the lanterns",
      objectives: [{ text: "Ask Lyra's aunt", done: false, audience: "characters", characterIds: [LYRA] }],
      revealedToPlayers: true
    });

    const minted = await call(base, "POST", "/preview-session", GM, { characterId: LYRA });
    expect(minted.status).toBe(201);
    const asLyra = minted.json!.data.token as string;
    const asEveryone = (await call(base, "POST", "/preview-session", GM, {})).json!.data.token as string;
    const paths = [
      "/pages",
      `/pages/${town.id}`,
      `/pages/${order.id}`,
      "/connections",
      "/quests",
      `/quests/${quest.id}`,
      "/search?q=lyra",
      "/timeline"
    ];
    expect(await readAs(base, paths, [asLyra])).toEqual(await readAs(base, paths, [LYRA_TOKEN]));
    expect(await readAs(base, paths, [asEveryone])).toEqual(await readAs(base, paths, [PLAYER]));
    expect(await readAs(base, paths, [asLyra])).not.toEqual(await readAs(base, paths, [asEveryone]));
  });
});

describe("Codex readers: dates players read", () => {
  it("dates a connection's start as the GM sets it, and stamps when the party learned it", async () => {
    const { base, store, stopClock } = await fixture();
    store.setCalendar({
      yearName: "DR",
      months: [
        { name: "Hammer", days: 30 },
        { name: "Alturiak", days: 28 }
      ],
      weekdays: ["Sul", "Mol"],
      currentDate: { year: 1491, month: 1, day: 4 }
    });
    store.publishCampaignDate();
    const session = store.createSession({ sessionNumber: 3, recapBody: "We met the burgomaster." });
    store.setSessionRevealed(session.id, true);
    store.setActiveSession(session.id);
    // The GM's own clock runs ahead; the stamp takes the date the players were told.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1491, month: 1, day: 20 } });

    const town = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const strahd = store.createPage({ title: "Strahd", entityType: "character" });
    const rules = store.createConnection(strahd.id, {
      toPageId: town.id,
      label: "rules",
      began: { inWorldDate: { year: 1480, month: 0, day: 1 }, beforeCampaign: false }
    });
    store.createConnection(town.id, {
      toPageId: strahd.id,
      label: "fears",
      began: { inWorldDate: null, beforeCampaign: true }
    });
    expect(store.listAllDeclaredConnections().find((row) => row.id === rules.id)!.learned).toBeNull();

    stopClock("2026-08-03T20:00:00.000Z");
    store.setPageRevealed(strahd.id, true);
    const edges = data(await read(base, "/connections", PLAYER)).connections as Array<Record<string, any>>;
    const learned = {
      at: "2026-08-03T20:00:00.000Z",
      sessionNumber: 3,
      inWorldDate: { year: 1491, month: 1, day: 4 },
      inWorldLabel: expect.stringContaining("1491")
    };
    expect(edges.find((edge) => edge.label === "rules")).toMatchObject({
      began: {
        inWorldDate: { year: 1480, month: 0, day: 1 },
        beforeCampaign: false,
        inWorldLabel: expect.stringContaining("1480"),
        calendarInstant: expect.any(Number)
      },
      learned
    });
    expect(edges.find((edge) => edge.label === "fears")).toMatchObject({
      began: { inWorldDate: null, beforeCampaign: true, inWorldLabel: null, calendarInstant: null },
      learned
    });

    // Learned while a hidden session runs: the GM sees its number, players do not.
    const secret = store.createSession({ sessionNumber: 4 });
    store.setActiveSession(secret.id);
    const hall = store.createPage({ title: "Lantern hall" });
    store.createConnection(hall.id, { toPageId: town.id, label: "stands in" });
    store.setPageRevealed(hall.id, true);
    const hallEdge = (token: string) =>
      read(base, "/connections", token).then(
        (answer) => data(answer).connections.find((edge: { label: string }) => edge.label === "stands in").learned
      );
    expect(await hallEdge(GM)).toMatchObject({ sessionId: secret.id, sessionNumber: 4 });
    expect(await hallEdge(PLAYER)).toMatchObject({ sessionNumber: null });
    expect(await hallEdge(PLAYER)).not.toHaveProperty("sessionId");
  });

  it("lists pins, quests, standing, unnumbered sessions and maps in the order players could first read them", async () => {
    const { base, store } = await fixture();
    // Each kind: the first made is shown last.
    const olderMap = store.createMap({ assetId: crypto.randomUUID(), name: "Older map", kind: "regional" });
    const newerMap = store.createMap({
      assetId: crypto.randomUUID(),
      name: "Newer map",
      kind: "regional",
      revealedToPlayers: true
    });
    const pin = (label: string, revealedToPlayers: boolean) =>
      store.createMarker(newerMap.id, {
        x: 0.5,
        y: 0.5,
        iconId: "pin",
        iconColor: "#ff8800",
        label,
        revealedToPlayers
      });
    const olderPin = pin("Older pin", false);
    pin("Newer pin", true);
    const olderQuest = store.createQuest({ title: "Older quest" });
    store.createQuest({ title: "Newer quest", revealedToPlayers: true });
    const olderFaction = store.createPage({ title: "Older faction", entityType: "faction", revealedToPlayers: true });
    const newerFaction = store.createPage({ title: "Newer faction", entityType: "faction", revealedToPlayers: true });
    store.setStanding(olderFaction.id, 10, "");
    store.setStanding(newerFaction.id, 20, "");
    const olderSession = store.createSession({ recapBody: "Older." });
    const newerSession = store.createSession({ recapBody: "Newer." });

    store.setStandingRevealed(newerFaction.id, true);
    store.setSessionRevealed(newerSession.id, true);
    store.setMapRevealed(olderMap.id, true);
    store.setMarkerRevealed(olderPin.id, true);
    store.setQuestRevealed(olderQuest.id, true);
    store.setStandingRevealed(olderFaction.id, true);
    store.setSessionRevealed(olderSession.id, true);

    const listed = async (path: string, key: string, name: string) =>
      (data(await read(base, path, PLAYER))[key] as Array<Record<string, unknown>>).map((row) => row[name]);
    expect(await listed("/maps", "maps", "name")).toEqual(["Newer map", "Older map"]);
    expect(await listed(`/maps/${newerMap.id}/markers`, "markers", "label")).toEqual(["Newer pin", "Older pin"]);
    expect(await listed("/quests", "quests", "title")).toEqual(["Newer quest", "Older quest"]);
    expect(await listed("/standing", "standing", "factionPageId")).toEqual([newerFaction.id, olderFaction.id]);
    expect(await listed("/sessions", "sessions", "recap")).toEqual(["Newer.", "Older."]);
    // The GM's lists keep the order the GM made them in.
    expect(store.listQuests().map((quest) => quest.title)).toEqual(["Older quest", "Newer quest"]);
  });
});

describe("Codex migration 4 and older backups", () => {
  const STRAHD = "4a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
  const BAROVIA = "5b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
  const TATYANA = "6c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
  const AMBER = "7d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";
  const QUEST = "8e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
  const TIE = "9f6a7b8c-9d0e-4f1a-9b2c-3d4e5f6a7b8c";
  const SESSION = "0a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
  const SESSION_PREP = "The ambush waits at [[The Amber Temple]].";
  const AT = "2026-05-01T00:00:00.000Z";
  const STRAHD_PLAYER = "A pale lord.\n\nHe rules [[Barovia]].";
  // Text before the first heading, two headings, and one section twice.
  const STRAHD_GM =
    "He is a vampire.\n\n## Motives\n\nHe wants [[Tatyana]] back.\n\n## The truth\n\nHe fears [[The Amber Temple]].\n\n## Motives\n\nHe wants [[Tatyana]] back.\n";
  const STRAHD_FIELDS = { race: "Human", age: "Ageless" };
  const STRAHD_GM_FIELDS = { race: "Vampire", goals: "Marry Tatyana", status: "Undead" };
  const REVISION_GM = "## Motives\n\nHe wants [[Tatyana]] back.";
  const QUEST_GM = "## Twist\n\nThe temple is a trap.";
  const OBJECTIVES = [
    { text: "Cross the pass", done: true },
    { text: "Open the vault", done: false }
  ];
  type Page = {
    id: string;
    title: string;
    type: string;
    fields: object;
    gmFields: object;
    player: string;
    gm: string;
    revealed: boolean;
  };
  const PAGES: Page[] = [
    {
      id: STRAHD,
      title: "Strahd",
      type: "character",
      fields: STRAHD_FIELDS,
      gmFields: STRAHD_GM_FIELDS,
      player: STRAHD_PLAYER,
      gm: STRAHD_GM,
      revealed: true
    },
    {
      id: BAROVIA,
      title: "Barovia",
      type: "location",
      fields: {},
      gmFields: {},
      player: "A misty valley.",
      gm: "",
      revealed: true
    },
    {
      id: TATYANA,
      title: "Tatyana",
      type: "character",
      fields: {},
      gmFields: {},
      player: "A village girl.",
      gm: "",
      revealed: true
    },
    {
      id: AMBER,
      title: "The Amber Temple",
      type: "location",
      fields: {},
      gmFields: {},
      player: "",
      gm: "Vestiges.",
      revealed: false
    }
  ];

  /** A Codex file as the release before migration 4 left it. */
  function writeVersion3(path: string) {
    const raw = new DatabaseSync(path);
    migrate(
      raw,
      "codex",
      CODEX_MIGRATIONS.filter((migration) => migration.version < 4),
      { path }
    );
    const page = raw.prepare(
      `INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body,
         revealed, banner_asset_id, in_world_year, in_world_month, in_world_day, in_world_label, calendar_instant, rev,
         created_at, updated_at, player_updated_at, first_shown_at)
       VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 3, ?, ?, ?, ?)`
    );
    for (const row of PAGES)
      page.run(
        row.id,
        row.title,
        row.type,
        JSON.stringify(row.fields),
        JSON.stringify(row.gmFields),
        row.player,
        row.gm,
        row.revealed ? 1 : 0,
        AT,
        AT,
        AT,
        row.revealed ? AT : null
      );
    raw
      .prepare(
        `INSERT INTO codex_page_revisions (page_id, rev, title, entity_type, fields_json, gm_fields_json, player_body, gm_body,
           banner_asset_id, tags_json, authored_at, author_tag)
         VALUES (?, 2, 'Strahd', 'character', ?, ?, ?, ?, NULL, '[]', ?, 'gm')`
      )
      .run(
        STRAHD,
        JSON.stringify({ race: "Human" }),
        JSON.stringify({ goals: "Marry Tatyana" }),
        STRAHD_PLAYER,
        REVISION_GM,
        AT
      );
    raw
      .prepare(
        `INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, tags_json,
           rev, created_at, updated_at)
         VALUES (?, 'The Amber Temple', 'active', 'Find the temple.', ?, ?, '[]', 1, '[]', 1, ?, ?)`
      )
      .run(QUEST, QUEST_GM, JSON.stringify(OBJECTIVES), AT, AT);
    raw
      .prepare(
        "INSERT INTO codex_relationships (id, from_page_id, to_page_id, label, layer, created_at) VALUES (?, ?, ?, 'rules', 'player', ?)"
      )
      .run(TIE, STRAHD, BAROVIA, AT);
    // A revealed session whose free-text prep migration 5 turns into a section.
    raw
      .prepare(
        `INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status,
           tags_json, scene_ids_json, rev, created_at, updated_at)
         VALUES (?, 1, NULL, '[]', ?, 'We met Strahd.', 1, 'played', '[]', '[]', 1, ?, ?)`
      )
      .run(SESSION, SESSION_PREP, AT, AT);
    raw.close();
  }

  /** The same records as a version 1 backup carried them. */
  const VERSION_1_BACKUP = {
    pages: PAGES.map((row) => ({
      id: row.id,
      title: row.title,
      entityType: row.type,
      fields: row.fields,
      gmFields: row.gmFields,
      folder: null,
      tags: [],
      playerBody: row.player,
      gmBody: row.gm,
      revealedToPlayers: row.revealed,
      bannerAssetId: null,
      inWorldDate: null,
      rev: 3,
      createdAt: AT,
      updatedAt: AT,
      playerUpdatedAt: AT
    })),
    quests: [
      {
        id: QUEST,
        title: "The Amber Temple",
        status: "active",
        playerBody: "Find the temple.",
        gmBody: QUEST_GM,
        objectives: OBJECTIVES,
        entityIds: [],
        revealedToPlayers: true,
        tags: [],
        rev: 1,
        createdAt: AT,
        updatedAt: AT
      }
    ],
    relationships: [{ id: TIE, fromPageId: STRAHD, toPageId: BAROVIA, label: "rules", layer: "player", createdAt: AT }],
    revisions: [
      {
        id: 1,
        pageId: STRAHD,
        rev: 2,
        title: "Strahd",
        entityType: "character",
        fields: { race: "Human" },
        gmFields: { goals: "Marry Tatyana" },
        playerBody: STRAHD_PLAYER,
        gmBody: REVISION_GM,
        bannerAssetId: null,
        tags: [],
        authoredAt: AT,
        authorTag: "gm"
      }
    ],
    maps: [],
    markers: [],
    journal: [],
    sessions: [
      {
        id: SESSION,
        sessionNumber: 1,
        realDate: null,
        attendees: [],
        prepBody: SESSION_PREP,
        recapBody: "We met Strahd.",
        revealedToPlayers: true,
        status: "played",
        tags: [],
        encounterIds: [],
        rev: 1,
        createdAt: AT,
        updatedAt: AT
      }
    ],
    standing: [],
    folders: []
  };

  async function openStore(directory: string) {
    const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-08-01T00:00:00.000Z"));
    await store.initialize();
    cleanups.push(() => store.close());
    return store;
  }

  /** What every reader can read, and what the GM keeps, of the records above. */
  function readsOf(store: CodexStore) {
    const reads = new PlayerCodexReads(store, EVERYONE);
    return {
      strahd: reads.page(STRAHD),
      quest: reads.quest(QUEST),
      connections: reads.connections(),
      search: ["vampire", "trap", "pale"].map((q) => reads.search(parseSearchQuery({ q }))),
      gmPage: store.getPage(STRAHD),
      gmQuest: store.getQuest(QUEST),
      revisions: store.listRevisions(STRAHD),
      session: reads.session(SESSION),
      gmSession: store.getSession(SESSION),
      ambush: reads.search(parseSearchQuery({ q: "ambush" }))
    };
  }

  function expectUpgraded(reads: ReturnType<typeof readsOf>) {
    const { strahd, quest, gmPage, gmQuest } = reads;
    // Players read what they read before: the player text and fields, and the mention in it alone.
    expect(strahd!.page.body).toBe(STRAHD_PLAYER);
    expect(strahd!.page.blocks).toEqual([]);
    expect(strahd!.page.fields).toEqual(STRAHD_FIELDS);
    expect(strahd!.page.playerUpdatedAt).toBe(AT);
    expect(strahd!.page.firstShownAt).toBe(AT);
    expect(strahd!.connections.map((row) => [row.otherId, row.origin])).toEqual(
      expect.arrayContaining([
        [BAROVIA, "mention"],
        [BAROVIA, "declared"]
      ])
    );
    expect(strahd!.connections.map((row) => row.otherId)).not.toContain(TATYANA);
    expect(reads.connections.connections.filter((edge) => edge.fromId === STRAHD).map((edge) => edge.toPageId)).toEqual(
      [BAROVIA, BAROVIA]
    );
    expect(reads.search[0]!.hits).toEqual([]);
    expect(reads.search[1]!.hits).toEqual([]);
    expect(reads.search[2]!.hits.map((hit) => hit.id)).toEqual([STRAHD]);
    expect(quest!.quest).toMatchObject({ body: "Find the temple.", blocks: [], objectives: OBJECTIVES });
    // A connection players read before stamps existed has no learned date to show.
    expect(reads.connections.connections.find((edge) => edge.origin === "declared")!.learned).toBeNull();

    // The GM keeps every word: one hidden block per section after the player text, and every field value.
    expect(
      gmPage!.blocks.map(({ title, text, anchor, audience, characterIds, reveals }) => ({
        title,
        text,
        anchor,
        audience,
        characterIds,
        reveals
      }))
    ).toEqual(
      [
        { title: null, text: "He is a vampire." },
        { title: "Motives", text: "He wants [[Tatyana]] back." },
        { title: "The truth", text: "He fears [[The Amber Temple]]." },
        { title: "Motives", text: "He wants [[Tatyana]] back." },
        { title: "GM field values", text: "race: Vampire" }
      ].map((block) => ({ ...block, anchor: 2, audience: "hidden", characterIds: [], reveals: [] }))
    );
    expect(new Set(gmPage!.blocks.map((block) => block.id)).size).toBe(5);
    expect(gmPage!.fields).toEqual({ race: "Human", age: "Ageless", goals: "Marry Tatyana", status: "Undead" });
    expect([...gmPage!.hiddenFields].sort()).toEqual(["goals", "status"]);
    // A revision's section has its page's id, so restoring it keeps that block's audience.
    expect(reads.revisions[0]!.blocks).toEqual([
      { id: gmPage!.blocks[1]!.id, anchor: 2, title: "Motives", text: "He wants [[Tatyana]] back." }
    ]);
    expect(gmQuest!.blocks).toEqual([
      expect.objectContaining({ title: "Twist", text: "The temple is a trap.", audience: "hidden", reveals: [] })
    ]);
    expect(gmQuest!.objectives).toEqual(
      OBJECTIVES.map((objective) => ({ ...objective, id: expect.any(String), audience: "everyone", characterIds: [] }))
    );
    // Migration 5's half: the prep is one Text section the GM keeps, and players read the recap alone.
    expect(reads.gmSession!.prep).toEqual([
      expect.objectContaining({ type: "text", title: "Prep notes", text: SESSION_PREP })
    ]);
    expect(reads.gmSession!.firstShownAt).toBe(AT);
    expect(reads.session!.session).toEqual({
      id: SESSION,
      sessionNumber: 1,
      realDate: null,
      recap: "We met Strahd.",
      tags: []
    });
    expect(reads.ambush.hits).toEqual([]);
  }

  it("turns a page's GM body into hidden blocks, one per heading, and players read what they read before", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-migration-4-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    writeVersion3(join(directory, "vtt.sqlite"));
    const store = await openStore(directory);
    expectUpgraded(readsOf(store));

    // The GM's mentions stay, on the GM layer; the old columns are gone.
    const gmEdges = store.listAllConnections().filter((edge) => edge.fromId === STRAHD && edge.origin === "mention");
    expect(gmEdges.map((edge) => [edge.toPageId, edge.layer])).toEqual(
      expect.arrayContaining([
        [BAROVIA, "player"],
        [TATYANA, "gm"],
        [AMBER, "gm"]
      ])
    );
    expect(store.searchAll("gm", "vampire").hits.map((hit) => hit.id)).toEqual([STRAHD]);
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    const columns = (table: string) =>
      (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns("codex_pages")).not.toContain("gm_body");
    expect(columns("codex_pages")).not.toContain("gm_fields_json");
    expect(columns("codex_quests")).not.toContain("gm_body");
    raw.close();
  });

  it("runs migration 4 on a file that took migration 5 first, as a file from the features branch has", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-migration-5-then-4-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "vtt.sqlite");
    writeVersion3(path);
    const raw = new DatabaseSync(path);
    migrate(
      raw,
      "codex",
      CODEX_MIGRATIONS.filter((migration) => migration.version !== 4),
      { path }
    );
    raw.close();
    const store = await openStore(directory);
    expectUpgraded(readsOf(store));
    const applied = new DatabaseSync(path);
    expect(
      (
        applied.prepare("SELECT version FROM migrations WHERE store = 'codex' ORDER BY version").all() as Array<{
          version: number;
        }>
      ).map((row) => row.version)
    ).toEqual([1, 2, 3, 4, 5, 6]);
    applied.close();
  });

  it("restores a backup from either branch: GM bodies with prep sections, and blocks with free-text prep", async () => {
    const migratedDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-migration-4-"));
    const restoredDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-backups-"));
    cleanups.push(() => rm(migratedDirectory, { recursive: true, force: true }));
    cleanups.push(() => rm(restoredDirectory, { recursive: true, force: true }));
    writeVersion3(join(migratedDirectory, "vtt.sqlite"));
    const upgraded = readsOf(await openStore(migratedDirectory));
    const restored = await openStore(restoredDirectory);

    // The features branch's version 1: old GM bodies beside prep sections and a template library.
    const prep = [{ type: "checklist", title: "Clues", items: [{ text: "The ledger is forged." }] }];
    restored.importBundle({
      ...VERSION_1_BACKUP,
      sessions: VERSION_1_BACKUP.sessions.map(({ prepBody: _prepBody, ...session }) => ({ ...session, prep })),
      prepTemplates: [],
      defaultPrepTemplateId: null
    });
    expect(readsOf(restored).gmPage!.blocks).toEqual(upgraded.gmPage!.blocks);
    expect(restored.getSession(SESSION)!.prep).toEqual([
      expect.objectContaining({
        type: "checklist",
        title: "Clues",
        items: [expect.objectContaining({ text: "The ledger is forged." })]
      })
    ]);

    // This branch's version 2 before prep sections: blocks as written, and free-text prep as one Text section.
    const exported = JSON.parse(JSON.stringify(restored.exportBundle())) as Record<string, unknown> & {
      sessions: Array<Record<string, unknown>>;
    };
    const { prepTemplates: _templates, defaultPrepTemplateId: _default, ...modelOnly } = exported;
    restored.importBundle({
      ...modelOnly,
      sessions: exported.sessions.map(({ prep: _prep, prepTemplateId: _id, currentSceneId: _scene, ...session }) => ({
        ...session,
        prepBody: SESSION_PREP
      }))
    });
    const reads = readsOf(restored);
    expectUpgraded(reads);
    expect(reads.gmPage!.blocks).toEqual(upgraded.gmPage!.blocks);
  });

  it("restores a version 1 backup the way the migration upgrades a file, with the same block ids", async () => {
    const migratedDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-migration-4-"));
    const restoredDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-backup-1-"));
    cleanups.push(() => rm(migratedDirectory, { recursive: true, force: true }));
    cleanups.push(() => rm(restoredDirectory, { recursive: true, force: true }));
    writeVersion3(join(migratedDirectory, "vtt.sqlite"));
    const migrated = await openStore(migratedDirectory);
    const restored = await openStore(restoredDirectory);
    restored.importBundle(VERSION_1_BACKUP);

    const reads = readsOf(restored);
    expectUpgraded(reads);
    const upgraded = readsOf(migrated);
    expect(reads.strahd).toEqual(upgraded.strahd);
    expect(reads.quest).toEqual(upgraded.quest);
    expect(reads.connections).toEqual(upgraded.connections);
    expect(reads.gmPage!.blocks).toEqual(upgraded.gmPage!.blocks);
    expect(reads.gmQuest!.objectives).toEqual(upgraded.gmQuest!.objectives);

    // Restoring the same backup again gives the same ids, so a block's audience set since is lost only with its text.
    restored.importBundle(VERSION_1_BACKUP);
    expect(restored.getPage(STRAHD)!.blocks.map((block) => block.id)).toEqual(
      upgraded.gmPage!.blocks.map((block) => block.id)
    );
  });
});

describe("Codex readers over the socket and the signed preview", () => {
  const PASSWORD = "a sufficiently long GM password";
  const sockets: Socket[] = [];
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  async function boot() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-readers-live-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          { id: LYRA, name: "Lyra", kind: "player-character", visibility: "public", hp: { current: 9, maximum: 9 } },
          { id: BORIN, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 9, maximum: 9 } }
        ]
      })
    });
    await server.initialize();
    await server.auth.bootstrap(PASSWORD);
    const gmToken = (await server.auth.login(PASSWORD))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.close();
      await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}`;
    const connect = async (token: string) => {
      const socket = ioClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(socket);
      await new Promise((done) => socket.emit("session:join", { token }, done));
      const pings: number[] = [];
      socket.on("codex:changed", (event: { codexRevision: number }) => pings.push(event.codexRevision));
      return { socket, pings };
    };
    return { server, url, gmToken, connect };
  }

  it("pings only Lyra's player for a block shown to Lyra, and the preview reads as Lyra's player does", async () => {
    const { server, url, gmToken, connect } = await boot();
    const codex = `${url}/api/v1/codex`;
    const lyraToken = server.auth.issuePlayerSession();
    const borinToken = server.auth.issuePlayerSession();
    const lyra = await connect(lyraToken);
    const borin = await connect(borinToken);
    /** Answered after every event the server sent this socket before it; the read is refused, which is enough. */
    const settled = (socket: Socket) => new Promise((done) => socket.emit("content:monster-benchmarks", {}, done));
    const claim = (socket: Socket, actorId: string) =>
      new Promise<{ ok: boolean }>((done) =>
        socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId }, done)
      );
    expect((await claim(lyra.socket, LYRA)).ok).toBe(true);
    expect((await claim(borin.socket, BORIN)).ok).toBe(true);
    // A claim changes what a socket can read, so it is pinged with its new audience's count.
    await expect.poll(() => lyra.pings).toEqual([0]);
    await expect.poll(() => borin.pings).toEqual([0]);

    const created = await call(codex, "POST", "/pages", gmToken, {
      title: "Vallaki",
      playerBody: "A walled town.",
      blocks: [{ text: "Your aunt left you the key." }],
      revealedToPlayers: true
    });
    const page = created.json!.data.page as { id: string; blocks: Array<{ id: string }> };
    await expect.poll(() => lyra.pings).toEqual([0, 1]);
    await expect.poll(() => borin.pings).toEqual([0, 1]);
    const borinBefore = await read(codex, `/pages/${page.id}`, borinToken);

    const shown = await call(codex, "PUT", `/pages/${page.id}/blocks/${page.blocks[0]!.id}/audience`, gmToken, {
      audience: "characters",
      characterIds: [LYRA]
    });
    expect(shown.status).toBe(200);
    await expect.poll(() => lyra.pings).toEqual([0, 1, 2]);
    // The players' pings for one write go out together, and a socket's events arrive in order, so once Borin's
    // next answer is in, any ping for this write would be too.
    await settled(borin.socket);
    expect(borin.pings).toEqual([0, 1]);
    expect(await read(codex, `/pages/${page.id}`, borinToken)).toEqual(borinBefore);
    expect(data(await read(codex, `/pages/${page.id}`, lyraToken)).page.body).toBe(
      "A walled town.\n\nYour aunt left you the key."
    );

    // A change everyone can read reaches both, each with its own audience's count.
    await call(codex, "PATCH", `/pages/${page.id}`, gmToken, { title: "Vallaki town" });
    await expect.poll(() => lyra.pings).toEqual([0, 1, 2, 3]);
    await settled(borin.socket);
    expect(borin.pings).toEqual([0, 1, 2]);

    // The GM's preview as Lyra is a signed player session that reads exactly what Lyra's player reads.
    const minted = await call(codex, "POST", "/preview-session", gmToken, { characterId: LYRA });
    const preview = minted.json!.data.token as string;
    const paths = ["/pages", `/pages/${page.id}`, "/connections", "/search?q=aunt"];
    expect(await readAs(codex, paths, [preview])).toEqual(await readAs(codex, paths, [lyraToken]));

    // And it only reads: no game command, no claim over the socket, no token upload.
    const command = await fetch(`${url}${GAME_PATHS.claims}`, {
      method: "POST",
      headers: { authorization: `Bearer ${preview}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), actorId: BORIN })
    });
    expect(command.status).toBe(403);
    const previewSocket = await connect(preview);
    expect((await claim(previewSocket.socket, BORIN)).ok).toBe(false);
    const upload = await fetch(`${url}/api/v1/token-assets`, {
      method: "POST",
      headers: { authorization: `Bearer ${preview}`, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71])
    });
    expect(upload.status).toBe(403);
    expect(server.store.snapshot.actors.find((actor) => actor.id === BORIN)!.ownerSessionId).toBe(
      server.auth.verifyPlayer(borinToken)!.sessionId
    );
  });
});
