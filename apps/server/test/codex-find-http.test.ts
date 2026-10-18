import { describe, expect, it } from "vitest";
import { codexHttp, PLAYER, type Json } from "./codex-http-fixture.js";

// Search filters and sorting, and the home, over HTTP. A player's search and home are built from what that player
// reads; the GM's home counts, recent changes and reveal check never reach a player.

const fixture = codexHttp();

describe("a player never receives hidden counts or the reveal check", () => {
  it("answers a player's home with only what is new to them", async () => {
    const { store, get } = await fixture();
    store.createPage({ title: "Hidden lair", fields: { ruler: "???" } });
    store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const home = await get("/home", PLAYER);
    expect(home.status).toBe(200);
    expect(Object.keys(home.body.data!.home as Json).sort()).toEqual(["newSince", "truncated"]);
    const payload = JSON.stringify(home.body);
    for (const gmOnly of ["collections", "revealCheck", "recent", "hidden", "Hidden lair"])
      expect(payload).not.toContain(gmOnly);
  });
});

describe("search filters and sorting", () => {
  async function seeded() {
    const context = await fixture();
    const { store } = context;
    const lyra = store.createPage({
      title: "Lyra Emberwise",
      entityType: "character",
      fields: { role: "Bard", location: "Emberfall" },
      gmFields: { goals: "Find the ledger" },
      playerBody: "A bard with a lute.",
      gmBody: "She owes the Tidebound.\nThe ledger names her.",
      revealedToPlayers: true
    });
    const borin = store.createPage({
      title: "Borin Ash",
      entityType: "character",
      fields: { role: "Smith", location: "Vallaki" },
      playerBody: "He keeps the ledger of debts.",
      revealedToPlayers: true
    });
    const tower = store.createPage({
      title: "Harbourmaster's Tower",
      entityType: "location",
      fields: { region: "Emberfall" },
      playerBody: "The ledger hides here."
    });
    const quest = store.createQuest({ title: "Recover the ledger", status: "active", revealedToPlayers: true });
    return { ...context, lyra, borin, tower, quest };
  }
  type Hit = Json & { id: string; title: string; columns: Record<string, string>; match: Json | null };
  const hitsOf = (answer: { body: Json }) => answer.body.data!.hits as Hit[];

  it("filters by type and visibility, and says which line matched and whether it is hidden", async () => {
    const { get, lyra, borin, tower, quest } = await seeded();
    const all = hitsOf(await get("/search?q=ledger"));
    expect(all.map((hit) => hit.id).sort()).toEqual([lyra.id, borin.id, tower.id, quest.id].sort());
    const lyraHit = all.find((hit) => hit.id === lyra.id)!;
    expect(lyraHit.match).toEqual({ line: "The ledger names her.", hidden: true });
    expect(lyraHit.columns).toEqual({ role: "Bard", location: "Emberfall", goals: "Find the ledger" });
    expect(all.find((hit) => hit.id === borin.id)!.match).toEqual({
      line: "He keeps the ledger of debts.",
      hidden: false
    });
    // A title match quotes no line.
    expect(all.find((hit) => hit.id === quest.id)!.match).toBeNull();

    const characters = hitsOf(await get("/search?q=ledger&types=character"));
    expect(characters.map((hit) => hit.id).sort()).toEqual([lyra.id, borin.id].sort());
    expect(hitsOf(await get("/search?types=page&visibility=hidden")).map((hit) => hit.id)).toEqual([tower.id]);
    expect(hitsOf(await get("/search?visibility=revealed&types=quest")).map((hit) => hit.id)).toEqual([quest.id]);
    expect((await get("/search?types=dragons")).status).toBe(400);
    expect((await get("/search?visibility=secret")).status).toBe(400);
    expect((await get("/search?sort=name:sideways")).status).toBe(400);
  });

  it("cuts a long matching line around its first match", async () => {
    const { store, get } = await fixture();
    const filler = "The harbour smells of tar and salt. ".repeat(6);
    store.createPage({ title: "Docks", playerBody: `${filler}A smuggler hides the ledger under the pier. ${filler}` });
    const [hit] = hitsOf(await get("/search?q=ledger"));
    const line = (hit!.match as { line: string }).line;
    expect(line.startsWith("…") && line.endsWith("…")).toBe(true);
    expect(line).toContain("hides the ledger under the pier");
    expect(line.length).toBeLessThanOrEqual(160);
  });

  it("sorts by several columns in order, blanks last either way", async () => {
    const { store, get, lyra, borin } = await seeded();
    const nobody = store.createPage({ title: "Ash Nobody", entityType: "character" });
    store.createPage({ title: "Notes", entityType: "note" });
    const byLocation = hitsOf(await get("/search?types=character&sort=location:desc,name"));
    expect(byLocation.map((hit) => hit.id)).toEqual([borin.id, lyra.id, nobody.id]);
    const byLocationUp = hitsOf(await get("/search?types=character&sort=location:asc"));
    expect(byLocationUp.map((hit) => hit.id)).toEqual([lyra.id, borin.id, nobody.id]);
    // Types run in their fixed order (a note before a character), then names run backwards within each.
    const byType = hitsOf(await get("/search?sort=type,name:desc&limit=4"));
    expect(byType.map((hit) => hit.title)).toEqual(["Notes", "Lyra Emberwise", "Borin Ash", "Ash Nobody"]);
    // Five pages and the quest, plus the hidden history record the quest wrote when it was made.
    const capped = await get("/search?sort=type&limit=2");
    expect(capped.body.data).toMatchObject({ truncated: true, total: 7 });
  });

  it("filters by modified date, the GM's by `updatedAt` and a player's by `playerUpdatedAt`", async () => {
    const { store, get, lyra, borin } = await seeded();
    // A GM-only edit moves the page's `updatedAt` for the GM and nothing for players.
    store.updatePage(lyra.id, { gmBody: "Changed later." }, undefined, "gm");
    const edited = store.getPage(lyra.id)!;
    const since = `/search?types=character&modifiedFrom=${encodeURIComponent(edited.updatedAt)}`;
    expect(hitsOf(await get(since)).map((hit) => hit.id)).toEqual([lyra.id]);
    expect(hitsOf(await get(since, PLAYER))).toEqual([]);
    const player = hitsOf(await get("/search?types=character", PLAYER));
    expect(player.find((hit) => hit.id === lyra.id)!.modifiedAt).toBe(edited.playerUpdatedAt);
    expect(player.find((hit) => hit.id === borin.id)!.modifiedAt).toBe(store.getPage(borin.id)!.playerUpdatedAt);
    expect(hitsOf(await get("/search?modifiedTo=2000-01-01"))).toEqual([]);
    expect((await get("/search?modifiedFrom=yesterday")).status).toBe(400);
  });

  it("gives a player only what they read: no hidden lines, fields or records, and no visibility filter", async () => {
    const { get, borin, quest } = await seeded();
    const hits = hitsOf(await get("/search?q=ledger", PLAYER));
    // Lyra's "ledger" is only in her hidden text, and the tower is hidden.
    expect(hits.map((hit) => hit.id).sort()).toEqual([borin.id, quest.id].sort());
    expect(hits.find((hit) => hit.id === borin.id)!.match).toEqual({ line: "He keeps the ledger of debts." });
    expect(JSON.stringify(hits)).not.toContain("hidden");
    const lyraHit = hitsOf(await get("/search?q=lyra", PLAYER))[0]!;
    expect(lyraHit.columns).toEqual({ role: "Bard", location: "Emberfall" });
    expect(lyraHit).not.toHaveProperty("revealedToPlayers");
    expect(JSON.stringify(lyraHit)).not.toContain("Tidebound");
    // A player's visibility filter is ignored; the answer is the same bytes.
    const plain = await get("/search?q=ledger", PLAYER);
    expect((await get("/search?q=ledger&visibility=hidden", PLAYER)).body.data).toEqual(plain.body.data);
  });
});

describe("the home", () => {
  it("gives the GM counts per type, the latest changes with who sees each, and the reveal check", async () => {
    const { store, get } = await fixture();
    const shown = store.createPage({
      title: "Emberfall",
      entityType: "location",
      fields: { ruler: "???" },
      playerBody: "Home of [[Old Tam]].",
      revealedToPlayers: true
    });
    const tam = store.createPage({ title: "Old Tam", entityType: "character" });
    const map = store.createMap({
      assetId: crypto.randomUUID(),
      name: "Coast",
      kind: "regional",
      revealedToPlayers: true
    });
    const hiddenPin = store.createMarker(map.id, {
      x: 1,
      y: 1,
      iconId: "pin",
      iconColor: "#FF2E9A",
      label: "Smugglers"
    });
    const shownPin = store.createMarker(map.id, {
      x: 2,
      y: 2,
      iconId: "pin",
      iconColor: "#FF2E9A",
      label: "Docks",
      pageIds: [tam.id],
      revealedToPlayers: true
    });
    store.updatePage(shown.id, { gmBody: "A GM-only line." }, undefined, "gm");

    const home = (await get("/home")).body.data!.home as Json & {
      collections: Json[];
      recent: Json[];
      revealCheck: { rows: Json[]; total: number };
    };
    expect(home.collections.find((row) => row.type === "location")).toEqual({
      type: "location",
      revealed: 1,
      hidden: 0
    });
    expect(home.collections.find((row) => row.type === "character")).toEqual({
      type: "character",
      revealed: 0,
      hidden: 1
    });
    expect(home.collections.find((row) => row.type === "marker")).toEqual({ type: "marker", revealed: 1, hidden: 1 });
    expect(home.collections).toHaveLength(13);
    // The newest change is the GM-only line, which players did not see.
    expect(home.recent[0]).toMatchObject({ id: shown.id, change: "edited", audience: "hidden", characterIds: [] });
    expect(home.recent.find((row) => row.id === shownPin.id)).toMatchObject({
      change: "created",
      audience: "everyone"
    });
    // A page's reveal is its own kind of change, and players see it.
    store.setPageRevealed(tam.id, true);
    const revealed = ((await get("/home")).body.data!.home as Json & { recent: Json[] }).recent[0];
    expect(revealed).toMatchObject({ id: tam.id, change: "revealed", audience: "everyone" });
    expect(home.revealCheck.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "link",
          kind: "page",
          id: shown.id,
          targetId: tam.id,
          targetTitle: "Old Tam"
        }),
        expect.objectContaining({ reason: "link", kind: "marker", id: shownPin.id, mapId: map.id, targetId: tam.id }),
        expect.objectContaining({ reason: "placeholder", kind: "page", id: shown.id, fieldKey: "ruler" }),
        expect.objectContaining({ reason: "hidden-pin", kind: "map", id: map.id, targetId: hiddenPin.id })
      ])
    );
    expect(home.revealCheck.total).toBe(4);
  });

  it("gives a player what is new or changed since their last visit, from their own dates", async () => {
    const { store, get } = await fixture();
    const old = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const visit = new Date(Date.parse(store.getPage(old.id)!.firstShownAt!) + 1).toISOString();
    const fresh = store.createPage({ title: "Krezk", revealedToPlayers: true });
    store.updatePage(old.id, { playerBody: "Walls and lamps." }, undefined, "gm");
    store.createPage({ title: "Hidden lair" });
    const entry = store.createEntry({ playerText: "We met the abbot.", sessionId: null, revealedToPlayers: true });

    const answer = await get(`/home?since=${encodeURIComponent(visit)}`, PLAYER);
    const items = (answer.body.data!.home as Json & { newSince: Json[] }).newSince;
    expect(items.map((item) => [item.id, item.change])).toEqual([
      [entry.id, "new"],
      [old.id, "updated"],
      [fresh.id, "new"]
    ]);
    expect(JSON.stringify(items)).not.toContain("Hidden lair");
    expect((await get("/home?since=soon", PLAYER)).status).toBe(400);
  });
});
