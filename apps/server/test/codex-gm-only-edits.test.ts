import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";
import { PlayerCodexChanges, readerOf } from "../src/codex/player-reads.js";
import { EVERYONE } from "../src/codex-projections.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

// A GM-only edit must leave every byte a player can read where it was: the bodies, the lists, the search hits
// and their order, and the ETags. Each test makes a change players cannot see and compares what each reader reads
// before and after it: a player with no character, Lyra's and Borin's players, and the GM's previews (real player
// sessions) as everyone and as Lyra.

const LYRA = "0b6f6a3e-8f3c-4b1e-9d2a-1c2b3a4d5e6f";
const BORIN = "1c7a7b4f-9a4d-4c2f-8e3b-2d3c4b5e6f70";
/** A party character no reader here holds, so showing a block to Cass alone is invisible to all of them. */
const CASS = "2d8b8c5a-0b5e-4d3a-9f4c-3e4d5c6f7a81";
const PLAYER_TOKEN = "player-token";
const LYRA_TOKEN = "lyra-player-token";
const BORIN_TOKEN = "borin-player-token";
const PREVIEW_TOKEN = "preview-player-token";
const PREVIEW_LYRA_TOKEN = "preview-lyra-token";
const READER_TOKENS = [PLAYER_TOKEN, LYRA_TOKEN, BORIN_TOKEN, PREVIEW_TOKEN, PREVIEW_LYRA_TOKEN];
/** Every audience a reader above holds. */
const READERS = [EVERYONE, readerOf([LYRA]), readerOf([BORIN])];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-gm-only-"));
  // A clock that moves on every read, so a write that stamps a time can always be told from one that does not.
  // `stopClock` holds it at one moment, so a test can say exactly when a write happened.
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
        gm: ["gm-token"],
        player: [PLAYER_TOKEN, LYRA_TOKEN, BORIN_TOKEN],
        previews: { [PREVIEW_TOKEN]: [], [PREVIEW_LYRA_TOKEN]: [LYRA] }
      }),
      notifyChanged: () => {},
      issuePreviewSession: () => PREVIEW_TOKEN,
      playerCharacters: (sessionId) =>
        sessionId === `player:${LYRA_TOKEN}` ? [LYRA] : sessionId === `player:${BORIN_TOKEN}` ? [BORIN] : [],
      partyCharacters: () => new Set([LYRA, BORIN, CASS])
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
  const stopClock = (at: string) => {
    stopped = Date.parse(at);
  };
  return { base: `http://127.0.0.1:${port}/api/v1/codex`, store, stopClock };
}

/** A fixed request id, so a 404's body is the same bytes on every read. */
const REQUEST_ID = "8d0f3c1e-7a42-4b6d-9e15-2c4a6f8b0d13";

/** One read as a player receives it: the status, the ETag and the exact bytes. */
async function read(base: string, path: string, token: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}`, "x-request-id": REQUEST_ID }
  });
  return { path, status: response.status, etag: response.headers.get("etag"), body: await response.text() };
}

/** The same reads for every reader. */
async function readAll(base: string, paths: readonly string[]) {
  const reads = [];
  for (const token of READER_TOKENS) for (const path of paths) reads.push(await read(base, path, token));
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
      blocks: [{ text: "Maelis leads it." }],
      revealedToPlayers: true
    });
    const town = store.createPage({ title: "Vallaki", playerBody: "A walled town.", revealedToPlayers: true });
    const paths = ["/pages", `/pages/${order.id}`, `/pages/${town.id}`, "/search?q=lantern", "/timeline"];

    await expectUnmoved(base, paths, () =>
      store.editPageBlock(order.id, order.blocks[0]!.id, {
        text: "Maelis leads it.\n\nShe has asked the capital for soldiers."
      })
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
      store.updatePage(order.id, { fields: { goals: "Seize the capital" } }, undefined, "gm")
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
      store.addPageBlock(first.id, { anchor: 0, text: "The [[Lantern Order]] is a front." })
    );
  });

  it("keeps a revealed page's connections when the GM writes a hidden page with the same title", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Lantern Order", revealedToPlayers: true });
    const town = store.createPage({ title: "Vallaki", playerBody: "[[Lantern Order]]", revealedToPlayers: true });

    await expectUnmoved(base, [`/pages/${town.id}`, "/connections"], () =>
      store.createPage({ title: "Lantern Order", blocks: [{ text: "The real one." }] })
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

/** A Codex with something of every kind shown to players and something of every kind kept back. */
function seedCampaign(store: CodexStore) {
  store.setCalendar({
    yearName: "DR",
    months: [
      { name: "Hammer", days: 30 },
      { name: "Alturiak", days: 30 }
    ],
    weekdays: ["First", "Second"],
    currentDate: { year: 1492, month: 0, day: 10 }
  });
  store.publishCampaignDate();
  const order = store.createPage({
    title: "Lantern Order",
    entityType: "faction",
    fields: { leader: "Maelis", goals: "Seize the capital" },
    playerBody: "A guild of lamplighters in [[Vallaki]].\n\nThey light the lamps at dusk.",
    blocks: [{ text: "A front for the cult." }, { title: "Allies", text: "[[The Cult]] pays them.", anchor: 1 }],
    folder: "Villains",
    tags: ["lantern"],
    revealedToPlayers: true
  });
  const town = store.createPage({
    title: "Vallaki",
    entityType: "location",
    playerBody: "A walled town. The [[Lantern Order]] keeps its lamps.",
    revealedToPlayers: true
  });
  const night = store.createPage({
    title: "Night of Lanterns",
    entityType: "event",
    playerBody: "The lamps went out.",
    inWorldDate: { year: 1492, month: 0, day: 5 },
    revealedToPlayers: true
  });
  const cult = store.createPage({ title: "The Cult", entityType: "faction", playerBody: "Lantern bearers." });
  store.createConnection(town.id, { toPageId: order.id, label: "hosts" });

  const map = store.createMap({
    assetId: crypto.randomUUID(),
    name: "Barovia",
    kind: "regional",
    revealedToPlayers: true
  });
  const secretMap = store.createMap({ assetId: crypto.randomUUID(), name: "Under Vallaki", kind: "battlemap" });
  const pin = store.createMarker(map.id, {
    x: 0.5,
    y: 0.5,
    iconId: "pin",
    iconColor: "#ff8800",
    label: "Lantern hall",
    pageIds: [order.id, cult.id],
    revealedToPlayers: true
  });
  store.setPartyMarker(pin.id);
  const hiddenPin = store.createMarker(map.id, { x: 0.2, y: 0.2, iconId: "pin", iconColor: "#ff8800", label: "Lair" });

  const shownSession = store.createSession({ sessionNumber: 1, recapBody: "We met the Lantern Order." });
  store.setSessionRevealed(shownSession.id, true);
  const hiddenSession = store.createSession({ sessionNumber: 2, prepBody: "The ambush." });
  const note = store.createEntry({
    playerText: "The lamps of the Lantern Order burn blue.",
    gmText: "Blue means the cult is near.",
    attachMarkerId: pin.id,
    attachPageId: order.id,
    sessionId: shownSession.id,
    revealedToPlayers: true
  });
  store.createDeadline({
    playerText: "The festival.",
    inWorldDate: { year: 1492, month: 1, day: 1 },
    sessionId: null,
    revealedToPlayers: true
  });
  const downtime = store.createDowntime({
    playerText: "A tenday at the lamp works.",
    sessionId: null,
    downtime: { who: "Ireena", activity: "Crafting", days: 10, characterPageId: town.id },
    revealedToPlayers: true
  });
  store.createMilestone({
    playerText: "Level 3.",
    sessionId: null,
    milestone: { level: 3, reason: "The hall" },
    revealedToPlayers: true
  });
  const quest = store.createQuest({
    title: "Light the lanterns",
    playerBody: "Find the lamp oil.",
    blocks: [{ text: "The oil is poisoned." }],
    objectives: [
      { text: "Find oil", done: false },
      { text: "Taste the oil", done: false, audience: "hidden" },
      { text: "Ask Lyra's aunt", done: false, audience: "characters", characterIds: [LYRA] }
    ],
    entityIds: [order.id, cult.id],
    revealedToPlayers: true
  });
  const hiddenQuest = store.createQuest({ title: "Unmask the cult", blocks: [{ text: "Act two." }] });
  // One block of each kind on the order: hidden, and shown to Lyra alone.
  store.setPageBlockAudience(order.id, order.blocks[1]!.id, "characters", [LYRA]);
  store.setStanding(order.id, 20, "Helped the guild");
  store.setStandingRevealed(order.id, true);

  const paths = [
    "/pages",
    ...[order, town, night, cult].flatMap((page) => [`/pages/${page.id}`, `/pages/${page.id}/markers`]),
    "/connections",
    "/maps",
    `/maps/${map.id}/markers`,
    `/maps/${secretMap.id}/markers`,
    `/markers/${pin.id}`,
    `/markers/${hiddenPin.id}`,
    "/party",
    "/journal",
    `/journal?pageId=${order.id}`,
    `/journal?markerId=${pin.id}`,
    "/timeline",
    "/sessions",
    `/sessions/${shownSession.id}`,
    `/sessions/${hiddenSession.id}`,
    "/quests",
    `/quests/${quest.id}`,
    `/quests/${hiddenQuest.id}`,
    "/standing",
    "/calendar",
    "/search?q=lantern",
    "/search?q=vallaki",
    "/search?q=session"
  ];
  return {
    order,
    town,
    cult,
    map,
    secretMap,
    pin,
    hiddenPin,
    shownSession,
    hiddenSession,
    note,
    downtime,
    quest,
    hiddenQuest,
    paths
  };
}

describe("Codex: a GM-only edit to any record kind leaves every player read as it was", () => {
  it("keeps every player read, ETag and the players' change count through a run of GM-only edits", async () => {
    const { base, store } = await fixture();
    const seeded = seedCampaign(store);
    const { order, town, cult, map, secretMap, pin, hiddenPin, shownSession, hiddenSession, note, downtime } = seeded;
    const { quest, hiddenQuest } = seeded;
    const changes = new PlayerCodexChanges(store);

    const edits: ReadonlyArray<readonly [string, () => unknown]> = [
      [
        "hidden block text",
        () => store.editPageBlock(order.id, order.blocks[0]!.id, { text: "Maelis has asked for [[Vallaki]]." })
      ],
      ["hidden block title", () => store.editPageBlock(order.id, order.blocks[0]!.id, { title: "Soldiers" })],
      ["hidden block added", () => store.addPageBlock(order.id, { anchor: 1, slot: 0, text: "Between the two." })],
      ["hidden block moved", () => store.movePageBlock(order.id, order.blocks[0]!.id, { anchor: 2 })],
      [
        "hidden block shown to a character no reader holds",
        () => store.setPageBlockAudience(order.id, order.blocks[0]!.id, "characters", [CASS])
      ],
      ["hidden again", () => store.setPageBlockAudience(order.id, order.blocks[0]!.id, "hidden")],
      [
        "hidden block deleted",
        () =>
          store.deletePageBlock(order.id, store.getPage(order.id)!.blocks.find((b) => b.text.startsWith("Between"))!.id)
      ],
      [
        "player text saved with the blocks where they were",
        () =>
          store.updatePage(
            order.id,
            {
              playerBody: store.getPage(order.id)!.playerBody,
              layout: store.getPage(order.id)!.blocks.map((block) => ({ id: block.id, anchor: block.anchor }))
            },
            undefined,
            "gm"
          )
      ],
      [
        "page Hidden field",
        () => store.updatePage(order.id, { fields: { leader: "Maelis", goals: "The throne" } }, undefined, "gm")
      ],
      ["an empty field hidden", () => store.setPageFieldAudience(order.id, "size", "hidden")],
      ["page folder", () => store.updatePage(order.id, { folder: "Villains/Cults" }, undefined, "gm")],
      ["folder move", () => store.moveFolder("Villains", "Foes")],
      ["folder create", () => store.createFolder("Foes/Later")],
      ["folder delete", () => store.deleteFolder("Foes")],
      ["page revision restore", () => store.restoreRevision(order.id, store.listRevisions(order.id)[0]!.id, "gm")],
      ["hidden page text", () => store.updatePage(cult.id, { playerBody: "Lantern bearers, all." }, undefined, "gm")],
      ["hidden page, same title", () => store.createPage({ title: "Vallaki", playerBody: "lantern lantern" })],
      ["GM-layer connection", () => store.createConnection(order.id, { toPageId: town.id, layer: "gm" })],
      ["hidden map", () => store.updateMap(secretMap.id, { name: "Under Vallaki, lantern vault", tags: ["lantern"] })],
      ["hidden map parent", () => store.setMapParent(secretMap.id, map.id)],
      [
        "pin scenes",
        () => store.updateMarker(pin.id, { sceneIds: [crypto.randomUUID()], actorId: crypto.randomUUID() })
      ],
      ["hidden pin", () => store.updateMarker(hiddenPin.id, { label: "Lantern lair", pageIds: [order.id] })],
      ["hidden pin move", () => store.moveMarker(hiddenPin.id, 0.3, 0.3)],
      [
        "pin on a hidden map",
        () =>
          store.createMarker(secretMap.id, {
            x: 0.1,
            y: 0.1,
            iconId: "pin",
            iconColor: "#ff8800",
            label: "Lantern",
            revealedToPlayers: true
          })
      ],
      ["entry GM text", () => store.updateEntry(note.id, { gmText: "Blue means the cult is here." })],
      [
        "hidden entry",
        () => store.createEntry({ playerText: "Lantern prep.", attachMarkerId: pin.id, attachPageId: order.id })
      ],
      [
        "hidden combat",
        () => store.appendCombatEntry({ sourceEncounterId: 7, attachMarkerId: pin.id, playerText: "A fight." })
      ],
      ["downtime applied", () => store.applyDowntime(downtime.id)],
      [
        "session prep",
        () =>
          store.updateSession(
            shownSession.id,
            { prepBody: "Next: the ambush.", attendees: ["Sam"], status: "played", sceneIds: [crypto.randomUUID()] },
            undefined
          )
      ],
      [
        "hidden session",
        () => store.updateSession(hiddenSession.id, { sessionNumber: 5, recapBody: "Lantern recap." }, undefined)
      ],
      ["active session", () => store.setActiveSession(hiddenSession.id)],
      ["quest hidden block", () => store.editQuestBlock(quest.id, quest.blocks[0]!.id, { text: "The oil is cursed." })],
      [
        "quest hidden objective",
        () =>
          store.updateQuest(
            quest.id,
            {
              objectives: store.getQuest(quest.id)!.objectives.map(({ id, text, done }) => ({
                id,
                text: text === "Taste the oil" ? "Smell the oil" : text,
                done
              }))
            },
            undefined
          )
      ],
      [
        "quest objective shown to a character no reader holds",
        () => store.setObjectiveAudience(quest.id, store.getQuest(quest.id)!.objectives[1]!.id, "characters", [CASS])
      ],
      [
        "hidden quest",
        () => store.updateQuest(hiddenQuest.id, { status: "active", playerBody: "Lantern." }, undefined)
      ],
      ["hidden standing", () => store.setStanding(cult.id, -40, "Burned a shrine")],
      ["GM clock", () => store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 1, day: 20 } })],
      [
        "settings",
        () =>
          store.setSettings({
            revisionHistory: { enabled: true, windowMinutes: 5 },
            autosave: { enabled: true, intervalSeconds: 10 }
          })
      ],
      ["history prune", () => store.deleteRevisionsOlderThan(0)]
    ];

    const before = await readAll(base, seeded.paths);
    for (const [name, edit] of edits) {
      edit();
      expect(await readAll(base, seeded.paths), name).toEqual(before);
      expect([...changes.next(READERS)], `${name} would ping players`).toEqual([]);
    }

    // And a change players can read still reaches them.
    store.updatePage(order.id, { playerBody: "A guild of lamplighters, armed." }, undefined, "gm");
    expect([...changes.next(READERS).values()]).toEqual([1, 1, 1]);
    expect(await readAll(base, seeded.paths)).not.toEqual(before);
    // Some five thousand reads: every path, as each reader, after every edit.
  }, 90_000);

  it("counts a change for each kind of record a player can read", async () => {
    const { store } = await fixture();
    const seeded = seedCampaign(store);
    const changes = new PlayerCodexChanges(store);
    const visible: ReadonlyArray<readonly [string, () => unknown]> = [
      ["page title", () => store.updatePage(seeded.town.id, { title: "Vallaki town" }, undefined, "gm")],
      ["page reveal", () => store.setPageRevealed(seeded.cult.id, true)],
      ["map name", () => store.updateMap(seeded.map.id, { name: "Barovia valley" })],
      ["pin label", () => store.updateMarker(seeded.pin.id, { label: "The lantern hall" })],
      ["pin attachment", () => store.updateEntry(seeded.note.id, { attachMarkerId: null })],
      ["entry text", () => store.updateEntry(seeded.note.id, { playerText: "The lamps burn green." })],
      ["recap", () => store.updateSession(seeded.shownSession.id, { recapBody: "We met them." }, undefined)],
      [
        "quest objective",
        () => store.updateQuest(seeded.quest.id, { objectives: [{ text: "Find oil", done: true }] }, undefined)
      ],
      ["standing", () => store.setStanding(seeded.order.id, 30, "Saved a lamplighter")],
      [
        "published date",
        () => {
          store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 12 } });
          store.publishCampaignDate();
        }
      ]
    ];
    visible.forEach(([name, edit], index) => {
      edit();
      expect(changes.next().get(""), name).toBe(index + 1);
    });
  });
});

// A record's creation time would tell players when the GM prepared it. Players get the moment they could first
// read it, which a hide and a re-reveal never move.
describe("Codex first-shown dates: players learn when a record was shown to them", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (start: string, days: number) => new Date(Date.parse(start) + days * DAY).toISOString();
  type Shown = { id: string; firstShownAt?: string; createdAt?: string };
  const shownIn = async (base: string, path: string, key: "entries" | "records", token = PLAYER_TOKEN) => {
    const answer = await read(base, path, token);
    expect(answer.status, path).toBe(200);
    return { rows: JSON.parse(answer.body).data[key] as Shown[], body: answer.body };
  };

  it("dates an entry and an event page prepared hidden and edited for days at their reveal", async () => {
    const { base, store, stopClock } = await fixture();
    const start = "2026-08-01T09:00:00.000Z";
    stopClock(start);
    const entry = store.createEntry({ playerText: "The order meets at midnight.", sessionId: null });
    const event = store.createPage({
      title: "Night of Lanterns",
      entityType: "event",
      playerBody: "The lamps went out.",
      inWorldDate: { year: 1, month: 0, day: 3 }
    });
    for (let day = 1; day <= 5; day += 1) {
      stopClock(at(start, day));
      store.updateEntry(entry.id, { playerText: `The order meets at midnight. Draft ${day}.` });
      store.updatePage(event.id, { playerBody: `The lamps went out. Draft ${day}.` }, undefined, "gm");
    }
    const reveal = at(start, 6);
    stopClock(reveal);
    store.setEntryRevealed(entry.id, true);
    store.setPageRevealed(event.id, true);

    for (const token of [PLAYER_TOKEN, PREVIEW_TOKEN]) {
      const journal = await shownIn(base, "/journal", "entries", token);
      const timeline = await shownIn(base, "/timeline", "records", token);
      expect(journal.rows.find((row) => row.id === entry.id)?.firstShownAt).toBe(reveal);
      expect(timeline.rows.find((row) => row.id === entry.id)?.firstShownAt).toBe(reveal);
      expect(timeline.rows.find((row) => row.id === event.id)?.firstShownAt).toBe(reveal);
      // Nothing a player reads says when the GM started, or worked on, either record.
      for (const { body } of [journal, timeline]) {
        expect(body).not.toContain('"createdAt"');
        for (let day = 0; day <= 5; day += 1) expect(body).not.toContain(at(start, day));
      }
    }

    // A hide and a re-reveal days later keep the first date.
    stopClock(at(start, 7));
    store.setEntryRevealed(entry.id, false);
    store.setPageRevealed(event.id, false);
    stopClock(at(start, 9));
    store.setEntryRevealed(entry.id, true);
    store.setPageRevealed(event.id, true);
    const again = await shownIn(base, "/timeline", "records");
    expect(again.rows.find((row) => row.id === entry.id)?.firstShownAt).toBe(reveal);
    expect(again.rows.find((row) => row.id === event.id)?.firstShownAt).toBe(reveal);
  });

  it("dates a standing record by its faction's reveal when the faction is shown later", async () => {
    const { base, store, stopClock } = await fixture();
    const start = "2026-08-01T09:00:00.000Z";
    stopClock(start);
    const faction = store.createPage({ title: "Lantern Order", entityType: "faction" });
    store.setStanding(faction.id, 20, "Helped the guild");
    const record = store.listTimeline().find((row) => row.kind === "standing")!;
    // Revealed, but still gated by its hidden faction, so no player can read it yet.
    stopClock(at(start, 2));
    store.setEntryRevealed(record.id, true);
    expect((await shownIn(base, "/journal", "entries")).rows).toEqual([]);

    const factionShown = at(start, 4);
    stopClock(factionShown);
    store.setPageRevealed(faction.id, true);
    const journal = await shownIn(base, "/journal", "entries");
    expect(journal.rows.find((row) => row.id === record.id)?.firstShownAt).toBe(factionShown);
  });
});
