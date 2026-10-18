import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATE_ID } from "../src/codex/prep.js";
import { codexHttp, PLAYER, type Json } from "./codex-http-fixture.js";

// The GM's session tools over HTTP: prep templates, session prep, the live board and party position. A player gets
// 403 from every one of them, and a session's prep never reaches a player.

const fixture = codexHttp();

describe("a player never receives templates, prep or the live board", () => {
  it("refuses a player every prep surface with 403, and never sends a session's prep", async () => {
    const { store, get, post, patch, del } = await fixture();
    const template = store.createPrepTemplate({ name: "Heist", sections: [{ title: "Clues", type: "checklist" }] });
    const session = store.createSession({
      sessionNumber: 4,
      recapBody: "We reached the vault.",
      prep: [
        { type: "text", title: "Prep notes", text: "The ledger is forged." },
        { type: "checklist", title: "Clues", items: [{ text: "The guard drinks." }] },
        { type: "scenes", title: "Scenes", scenes: [{ title: "The vault" }] }
      ]
    });
    store.setSessionRevealed(session.id, true);
    store.setActiveSession(session.id);
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Barovia", kind: "regional" });
    const item = session.prep[1]!.type === "checklist" ? session.prep[1]!.items[0]!.id : "";

    const refused = [
      await get("/prep-templates", PLAYER),
      await get("/board", PLAYER),
      await get(`/sessions/${session.id}/happened`, PLAYER),
      await post("/prep-templates", { name: "Mine" }, PLAYER),
      await patch(`/prep-templates/${template.id}`, { name: "Mine" }, PLAYER),
      await del(`/prep-templates/${template.id}`, PLAYER),
      await post(`/prep-templates/${template.id}/duplicate`, {}, PLAYER),
      await post(`/prep-templates/${template.id}/default`, {}, PLAYER),
      await post(`/sessions/${session.id}/apply-template`, { templateId: template.id }, PLAYER),
      await post(`/sessions/${session.id}/log`, { text: "Mine" }, PLAYER),
      await post(`/sessions/${session.id}/tick`, { itemId: item, done: true }, PLAYER),
      await post(`/sessions/${session.id}/current-scene`, { sceneId: null }, PLAYER),
      await post("/party", { mapId: map.id, x: 1, y: 1 }, PLAYER)
    ];
    for (const answer of refused) expect(answer.status).toBe(403);
    expect(store.listPrepTemplates().templates).toHaveLength(2);
    expect(store.partyMarker()).toBeNull();

    const read = await get(`/sessions/${session.id}`, PLAYER);
    expect(Object.keys(read.body.data!.session as Json).sort()).toEqual([
      "id",
      "realDate",
      "recap",
      "sessionNumber",
      "tags"
    ]);
    const everything = JSON.stringify([read.body, (await get("/sessions", PLAYER)).body]);
    for (const secret of ["ledger is forged", "guard drinks", "The vault", template.id, "prepTemplateId"])
      expect(everything).not.toContain(secret);
  });
});

describe("prep templates and session prep over HTTP", () => {
  it("lists, creates, edits, duplicates, defaults and deletes templates, and refuses the built-in's edits", async () => {
    const { get, post, patch, del } = await fixture();
    const listed = await get("/prep-templates");
    expect(listed.body.data!.defaultTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
    const created = await post("/prep-templates", { name: "Heist", sections: [{ title: "The mark", type: "pages" }] });
    expect(created.status).toBe(201);
    const template = created.body.data!.template as Json & { id: string; rev: number };
    const edited = await patch(`/prep-templates/${template.id}`, { name: "Heist night", expectedRev: template.rev });
    expect((edited.body.data!.template as Json).name).toBe("Heist night");
    const stale = await patch(`/prep-templates/${template.id}`, { name: "Stale", expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect((stale.body.error as Json).currentRevision).toBe(2);
    expect((await patch(`/prep-templates/${BUILT_IN_TEMPLATE_ID}`, { name: "Mine" })).status).toBe(400);
    expect((await del(`/prep-templates/${BUILT_IN_TEMPLATE_ID}`)).status).toBe(400);
    const copy = await post(`/prep-templates/${BUILT_IN_TEMPLATE_ID}/duplicate`, {});
    expect(copy.status).toBe(201);
    expect((copy.body.data!.template as Json).name).toBe("Starting template copy");
    const defaulted = await post(`/prep-templates/${template.id}/default`, {});
    expect(defaulted.body.data!.defaultTemplateId).toBe(template.id);

    // A new session copies the default; another names a template; the client's prep round-trips whole.
    const session = (await post("/sessions", { sessionNumber: 1 })).body.data!.session as Json & {
      id: string;
      rev: number;
      prep: Json[];
    };
    expect(session.prep.map((section) => section.title)).toEqual(["The mark"]);
    const roundTrip = await patch(`/sessions/${session.id}`, { prep: session.prep, expectedRev: session.rev });
    expect(roundTrip.status).toBe(200);
    const both = await post("/sessions", { templateId: template.id, prep: [] });
    expect(both.status).toBe(400);
    const reapplied = await post(`/sessions/${session.id}/apply-template`, { templateId: BUILT_IN_TEMPLATE_ID });
    expect((reapplied.body.data!.session as Json & { prep: Json[] }).prep).toHaveLength(8);
    expect((await del(`/prep-templates/${template.id}`)).status).toBe(200);
    expect((await get("/prep-templates")).body.data!.defaultTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
  });

  it("runs the board: log a line, tick a clue with its link, set the scene, then read what happened", async () => {
    const { store, get, post } = await fixture();
    const ysolde = store.createPage({ title: "Ysolde Varn", entityType: "character" });
    const session = store.createSession({
      sessionNumber: 7,
      prep: [
        { type: "scenes", title: "Scenes", scenes: [{ title: "The tower" }] },
        {
          type: "checklist",
          title: "Secrets and clues",
          items: [{ text: "A second ledger.", link: { recordKind: "page", recordId: ysolde.id, blockId: null } }]
        }
      ]
    });
    expect((await get("/board")).body.data!.board).toBeNull();
    await post(`/sessions/${session.id}/activate`, {});

    const logged = await post(`/sessions/${session.id}/log`, { text: "Lyra bribed the dockmaster." });
    expect(logged.status).toBe(201);
    expect(logged.body.data!.entry).toMatchObject({ kind: "note", sessionId: session.id, revealedToPlayers: false });
    expect((await post(`/sessions/${session.id}/log`, { text: "" })).status).toBe(400);

    const [scenes, clues] = session.prep;
    const itemId = clues!.type === "checklist" ? clues!.items[0]!.id : "";
    const ticked = await post(`/sessions/${session.id}/tick`, { itemId, done: true });
    expect(ticked.body.data!.clue).toMatchObject({
      id: itemId,
      done: true,
      link: { recordKind: "page", recordId: ysolde.id, blockId: null },
      linkTitle: "Ysolde Varn",
      linkRevealed: false
    });
    expect((await post(`/sessions/${session.id}/tick`, { itemId: crypto.randomUUID(), done: true })).status).toBe(404);
    const sceneId = scenes!.type === "scenes" ? scenes!.scenes[0]!.id : "";
    const current = await post(`/sessions/${session.id}/current-scene`, { sceneId });
    expect((current.body.data!.session as Json).currentSceneId).toBe(sceneId);

    const board = (await get("/board")).body.data!.board as Json & { scenes: Json[]; logged: Json[] };
    expect(board.scenes[0]).toMatchObject({ id: sceneId, current: true });
    expect(board.logged.map((line) => line.text)).toEqual(["Lyra bribed the dockmaster."]);
    const happened = (await get(`/sessions/${session.id}/happened`)).body.data!.happened as Json & {
      entries: Json[];
      cluesTicked: Json[];
    };
    expect(happened.entries).toHaveLength(1);
    expect(happened.cluesTicked.map((clue) => clue.id)).toEqual([itemId]);
    expect(happened.reveals).toEqual([]);
    expect((await get(`/sessions/${crypto.randomUUID()}/happened`)).status).toBe(404);
  });

  it("places the party: makes the pin, moves it across maps, and 404s a missing map", async () => {
    const { store, get, post } = await fixture();
    const world = store.createMap({
      assetId: crypto.randomUUID(),
      name: "World",
      kind: "world",
      revealedToPlayers: true
    });
    const city = store.createMap({ assetId: crypto.randomUUID(), name: "Vallaki", kind: "regional" });
    const made = await post("/party", { mapId: world.id, x: 10, y: 20 });
    expect(made.body.data).toMatchObject({ created: true, marker: { mapId: world.id, isParty: true } });
    const markerId = (made.body.data!.marker as Json).id;
    // Players see the party on the revealed map.
    expect(((await get("/party", PLAYER)).body.data!.party as Json).mapName).toBe("World");
    const moved = await post("/party", { mapId: city.id, x: 30, y: 40 });
    expect(moved.body.data).toMatchObject({ created: false, marker: { id: markerId, mapId: city.id, x: 30, y: 40 } });
    // The pin is revealed, its new map is not, so players see no party at all.
    expect((await get("/party", PLAYER)).body.data!.party).toBeNull();
    expect((await post("/party", { mapId: crypto.randomUUID(), x: 1, y: 1 })).status).toBe(404);
    expect((await post("/party", { mapId: city.id, x: -5, y: 1 })).status).toBe(400);
  });
});
