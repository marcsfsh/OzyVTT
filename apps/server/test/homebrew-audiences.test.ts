import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_PATHS, GAME_PATHS, HOMEBREW_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { ContentLibrary } from "../src/content-library.js";
import { migrate } from "../src/database.js";
import { HOMEBREW_MIGRATIONS, HomebrewStore } from "../src/homebrew-store.js";
import { createServer } from "../src/server.js";

// Who receives which homebrew, end to end through the real server: three players hold Lyra, Mirena and Borin, and
// read every route a player has (the content catalogs the builder and the gear picker use, the spell catalog, the
// Compendium, the builder's offers, a direct read) over HTTP and the socket. A record shown to Lyra reaches Lyra's
// player alone: the others' answers stay byte for byte, and their devices get no ping.

const LYRA = "0b6f6a3e-8f3c-4b1e-9d2a-1c2b3a4d5e6f";
const MIRENA = "1c7a7b4f-9a4d-4c2f-8e3b-2d3c4b5e6f70";
const BORIN = "2d8b8c5a-0b5e-4d3a-9f4c-3e4d5c6f7a81";
/** In the party, and no player holds Cass. */
const CASS = "3e9c9d6b-1c6f-4e4b-8a5d-4f5e6d7a8b92";
/** Not in the party. */
const STRANGER = "4fad0e7c-2d70-4f5c-9b6e-5a6f7e8b9ca3";
const PASSWORD = "a sufficiently long GM password";

const cleanups: Array<() => Promise<void> | void> = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const pc = (id: string, name: string) => ({
  id,
  name,
  kind: "player-character",
  visibility: "public",
  hp: { current: 9, maximum: 9 }
});

type Json = Record<string, any>;
type Answer = Readonly<{ status: number; etag: string | null; body: string }>;

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-audiences-"));
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
      actors: [pc(LYRA, "Lyra"), pc(MIRENA, "Mirena"), pc(BORIN, "Borin"), pc(CASS, "Cass")]
    })
  });
  await server.initialize();
  await server.auth.bootstrap(PASSWORD);
  const gm = (await server.auth.login(PASSWORD))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.close();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}`;

  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const read = async (path: string, token: string): Promise<Answer> => {
    const response = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, etag: response.headers.get("etag"), body: await response.text() };
  };

  /** A player device: a session that claims one character, with the homebrew pings it gets. */
  const player = async (characterId: string | null) => {
    const token = server.auth.issuePlayerSession();
    const socket = ioClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(socket);
    await new Promise((done) => socket.emit("session:join", { token }, done));
    const pings: number[] = [];
    socket.on("homebrew:changed", (event: { revision: number }) => pings.push(event.revision));
    if (characterId) {
      const claimed = await new Promise<{ ok: boolean }>((done) =>
        socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId: characterId }, done)
      );
      expect(claimed.ok).toBe(true);
    }
    /** Answered after every event the server sent this socket before it, so a ping for an earlier write is in. */
    const settled = async () => {
      // The players' check runs on the next turn of the event loop after a write; let it.
      await new Promise((done) => setTimeout(done, 20));
      await new Promise((done) => socket.emit("content:monster-benchmarks", {}, done));
    };
    const socketRead = (event: string, payload: unknown = {}) =>
      new Promise<Json>((done) => socket.emit(event, payload, done));
    return { token, socket, pings, settled, socketRead };
  };

  /** A record made the way the GM makes one: a named copy of an SRD record, then published. */
  const publishedCopy = async (srdId: string, name: string) => {
    const copied = await call("POST", HOMEBREW_PATHS.contentDuplicate.replace("{id}", srdId), gm, { name });
    expect(copied.status).toBe(201);
    const id = copied.json.data.record.id as string;
    const published = await call("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", id), gm, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    return id;
  };
  const share = (id: string, audience: string, characterIds?: string[]) =>
    call("PUT", HOMEBREW_PATHS.contentAudience.replace("{id}", id), gm, {
      audience,
      ...(characterIds ? { characterIds } : {})
    });

  return { server, url, gm, call, read, player, publishedCopy, share };
}

/** Every read a player has of content, as paths. The gear picker is the equipment catalog, and a level 5 Wizard's
 *  builder offers hold its level 3 spells. */
const COMPENDIUM_KINDS = ["class", "subclass", "species", "background", "feat", "spell", "equipment"];
const BUILDER = `${GAME_PATHS.builderOffers}?draft=${encodeURIComponent(JSON.stringify({ classId: "wizard", level: 5 }))}`;
const PLAYER_PATHS = [
  CONTENT_PATHS.spells,
  CONTENT_PATHS.equipment,
  CONTENT_PATHS.classes,
  CONTENT_PATHS.subclasses,
  CONTENT_PATHS.species,
  CONTENT_PATHS.backgrounds,
  CONTENT_PATHS.feats,
  ...COMPENDIUM_KINDS.map((kind) => `${CONTENT_PATHS.compendium}?kind=${kind}`),
  BUILDER
];

async function answersOf(read: (path: string, token: string) => Promise<Answer>, token: string) {
  const answers: Record<string, Answer> = {};
  for (const path of PLAYER_PATHS) answers[path] = await read(path, token);
  return answers;
}

describe("homebrew per reader", () => {
  it("gives a record shown to Lyra to Lyra's player alone: no answer, count, ETag or ping moves for the others", async () => {
    const { gm, call, read, player, publishedCopy, share } = await boot();
    const lyra = await player(LYRA);
    const mirena = await player(MIRENA);
    const borin = await player(BORIN);

    const brine = await publishedCopy("fireball", "Brine Burst");
    const saltborn = await publishedCopy("dwarf", "Saltborn");
    // Published and Hidden: nobody's catalog changed, so no player device is pinged.
    for (const device of [lyra, mirena, borin]) await device.settled();
    expect([lyra.pings, mirena.pings, borin.pings]).toEqual([[], [], []]);

    const before = { mirena: await answersOf(read, mirena.token), borin: await answersOf(read, borin.token) };
    for (const answer of Object.values(before.mirena)) expect(answer.status).toBe(200);
    expect((await share(brine, "characters", [LYRA])).status).toBe(200);
    expect((await share(saltborn, "characters", [LYRA])).status).toBe(200);

    await expect.poll(() => lyra.pings.length).toBeGreaterThan(0);
    await mirena.settled();
    await borin.settled();
    expect(mirena.pings).toEqual([]);
    expect(borin.pings).toEqual([]);
    // Byte for byte, ETag included: nothing a count or a hash could show.
    expect(await answersOf(read, mirena.token)).toEqual(before.mirena);
    expect(await answersOf(read, borin.token)).toEqual(before.borin);

    // Lyra's player gets it everywhere, marked as homebrew.
    const lyraSpells = JSON.parse((await read(CONTENT_PATHS.spells, lyra.token)).body).data.spells as Json[];
    expect(lyraSpells.find((spell) => spell.id === brine)).toMatchObject({ name: "Brine Burst", source: "homebrew" });
    expect(lyraSpells.find((spell) => spell.id === "fireball")).toMatchObject({ source: "srd" });
    const lyraCompendium = JSON.parse((await read(`${CONTENT_PATHS.compendium}?kind=spell`, lyra.token)).body).data;
    expect(lyraCompendium.rows.some((row: Json) => row.id === brine)).toBe(true);
    expect((await read(BUILDER, lyra.token)).body).toContain(brine);
    expect((await read(`${CONTENT_PATHS.compendium}?kind=species`, lyra.token)).body).toContain("Saltborn");

    // Over the socket too, and every direct read of the record is the GM's.
    expect(JSON.stringify(await mirena.socketRead("content:spells"))).not.toContain(brine);
    expect(JSON.stringify(await mirena.socketRead("content:compendium", { kind: "spell" }))).not.toContain(
      "Brine Burst"
    );
    expect(JSON.stringify(await lyra.socketRead("content:compendium", { kind: "spell" }))).toContain("Brine Burst");
    for (const path of [
      HOMEBREW_PATHS.contentById.replace("{id}", brine),
      `${HOMEBREW_PATHS.seeAsContent.replace("{id}", brine)}?as=${LYRA}`,
      `${HOMEBREW_PATHS.table}?kind=spell`,
      `${HOMEBREW_PATHS.search}?q=brine`
    ])
      expect((await read(path, mirena.token)).status, path).toBe(403);

    // The GM's record says who it reached and when.
    const record = (await call("GET", HOMEBREW_PATHS.contentById.replace("{id}", brine), gm)).json.data.record;
    expect(record).toMatchObject({ audience: "characters", characterIds: [LYRA], inCatalogs: true });
    expect(record.reveals.map((reveal: Json) => reveal.to)).toEqual([LYRA]);
  });

  it("keeps a spell shown to Lyra off a list shared with everyone, for everyone else", async () => {
    const { gm, call, read, player, publishedCopy, share } = await boot();
    const lyra = await player(LYRA);
    const mirena = await player(MIRENA);
    const brine = await publishedCopy("fireball", "Brine Burst");
    expect((await share(brine, "characters", [LYRA])).status).toBe(200);
    const created = await call("POST", HOMEBREW_PATHS.content, gm, {
      record: { type: "spell-list", name: "Tidecaller Spells", add: [brine, "fireball"] }
    });
    const list = created.json.data.record.id as string;
    expect((await call("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", list), gm, {})).status).toBe(200);
    expect((await share(list, "everyone")).status).toBe(200);
    // Everyone's spells changed (Fireball joined the list), so both are pinged.
    await expect.poll(() => mirena.pings.length).toBeGreaterThan(0);

    for (const path of [CONTENT_PATHS.spells, `${CONTENT_PATHS.compendium}?kind=spell`]) {
      const body = (await read(path, mirena.token)).body;
      expect(body, path).not.toContain(brine);
      expect(body, path).not.toContain("Brine Burst");
    }
    const mirenaSpells = JSON.parse((await read(CONTENT_PATHS.spells, mirena.token)).body).data.spells as Json[];
    expect(mirenaSpells.find((spell) => spell.id === "fireball")!.classes).toContain(list);
    const lyraSpells = JSON.parse((await read(CONTENT_PATHS.spells, lyra.token)).body).data.spells as Json[];
    expect(lyraSpells.find((spell) => spell.id === brine)!.classes).toContain(list);
  });

  it("takes a record that was shown out of every player's catalog when it is unpublished", async () => {
    const { gm, call, read, player, publishedCopy, share } = await boot();
    const lyra = await player(LYRA);
    const mirena = await player(MIRENA);
    const brine = await publishedCopy("fireball", "Brine Burst");
    expect((await share(brine, "everyone")).status).toBe(200);
    await expect.poll(() => mirena.pings.length).toBe(1);
    expect((await read(CONTENT_PATHS.spells, mirena.token)).body).toContain(brine);

    const unpublished = await call("POST", HOMEBREW_PATHS.contentUnpublish.replace("{id}", brine), gm, {});
    expect(unpublished.json.data.record).toMatchObject({ state: "draft", audience: "hidden" });
    await expect.poll(() => mirena.pings.length).toBe(2);
    await expect.poll(() => lyra.pings.length).toBe(2);
    for (const token of [lyra.token, mirena.token])
      for (const [path, answer] of Object.entries(await answersOf(read, token)))
        expect(answer.body, path).not.toContain(brine);
    // Publishing again starts Hidden: the GM shares it again on purpose.
    await call("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", brine), gm, {});
    expect((await read(CONTENT_PATHS.spells, mirena.token)).body).not.toContain(brine);
  });

  it("never lets a draft or a Hidden record reach a player, by any route", async () => {
    const { gm, call, read, player, publishedCopy } = await boot();
    const lyra = await player(LYRA);
    const hidden = [
      await publishedCopy("fireball", "Hushed Fire"),
      await publishedCopy("wand-of-fireballs", "Wand of Saltfire"),
      await publishedCopy("dwarf", "Hollow Kin"),
      await publishedCopy("goblin-warrior", "Drowned Abbess")
    ];
    const drafts = [];
    for (const [srdId, name] of [
      ["fireball", "Draft Flame"],
      ["dwarf", "Draft Kin"],
      ["goblin-warrior", "Draft Horror"]
    ]) {
      const copied = await call("POST", HOMEBREW_PATHS.contentDuplicate.replace("{id}", srdId!), gm, { name });
      drafts.push(copied.json.data.record.id as string);
    }
    const secrets = [
      ...hidden,
      ...drafts,
      "Hushed Fire",
      "Wand of Saltfire",
      "Hollow Kin",
      "Drowned Abbess",
      "Draft Flame",
      "Draft Kin",
      "Draft Horror"
    ];
    // Hidden from everyone, so not even a preview as Lyra or See as everyone gets it.
    const preview = (await call("POST", "/api/v1/codex/preview-session", gm, { characterId: LYRA })).json.data.token;
    for (const token of [lyra.token, preview]) {
      for (const [path, answer] of Object.entries(await answersOf(read, token)))
        for (const secret of secrets) expect(answer.body.includes(secret), `${path} names ${secret}`).toBe(false);
      for (const id of [...hidden, ...drafts]) {
        expect((await read(HOMEBREW_PATHS.contentById.replace("{id}", id), token)).status).toBe(403);
        expect((await read(CONTENT_PATHS.monsterById.replace("{definitionId}", id), token)).status).toBe(403);
      }
      expect((await read(CONTENT_PATHS.monsters, token)).status).toBe(403);
    }
    for (const event of ["content:spells", "content:equipment", "content:species"]) {
      const answer = JSON.stringify(await lyra.socketRead(event));
      for (const secret of secrets) expect(answer.includes(secret), `${event} names ${secret}`).toBe(false);
    }
    for (const kind of COMPENDIUM_KINDS) {
      const answer = await call("GET", `${HOMEBREW_PATHS.seeAsCompendium}?as=everyone&kind=${kind}`, gm);
      for (const secret of secrets) expect(JSON.stringify(answer.json).includes(secret)).toBe(false);
    }
  });

  it("shows the GM what a character's player receives, whether or not anyone holds the character", async () => {
    const { gm, call, read, player, publishedCopy, share } = await boot();
    const lyra = await player(LYRA);
    const tide = await publishedCopy("fireball", "Tide Call");
    expect((await share(tide, "characters", [CASS])).status).toBe(200);
    const seeAs = (as: string, kind = "spell") =>
      call("GET", `${HOMEBREW_PATHS.seeAsCompendium}?as=${as}&kind=${kind}`, gm);

    expect(JSON.stringify((await seeAs(CASS)).json.data)).toContain("Tide Call");
    expect(JSON.stringify((await seeAs("everyone")).json.data)).not.toContain("Tide Call");
    expect(JSON.stringify((await seeAs(LYRA)).json.data)).not.toContain("Tide Call");
    // See as Lyra is what Lyra's player reads.
    for (const kind of COMPENDIUM_KINDS)
      expect((await seeAs(LYRA, kind)).json.data).toEqual(
        JSON.parse((await read(`${CONTENT_PATHS.compendium}?kind=${kind}`, lyra.token)).body).data
      );

    const asCass = await call("GET", `${HOMEBREW_PATHS.seeAsContent.replace("{id}", tide)}?as=${CASS}`, gm);
    expect(asCass.json.data).toMatchObject({ as: CASS, kind: "spell", received: true });
    expect(asCass.json.data.entry.rows.map((row: Json) => row.id)).toEqual([tide]);
    const asLyra = await call("GET", `${HOMEBREW_PATHS.seeAsContent.replace("{id}", tide)}?as=${LYRA}`, gm);
    expect(asLyra.json.data).toEqual({ as: LYRA, kind: "spell", received: false, entry: null });
    const srd = await call("GET", `${HOMEBREW_PATHS.seeAsContent.replace("{id}", "fireball")}?as=${LYRA}`, gm);
    expect(srd.json.data.received).toBe(true);
    const offers = await call("POST", HOMEBREW_PATHS.seeAsBuilderOffers, gm, {
      as: CASS,
      draft: { classId: "wizard", level: 5 }
    });
    expect(offers.status).toBe(200);
    expect(JSON.stringify(offers.json.data)).toContain(tide);
    expect((await call("GET", `${HOMEBREW_PATHS.seeAsCompendium}?as=${STRANGER}&kind=spell`, gm)).status).toBe(400);
    // Sharing names party characters only.
    expect((await share(tide, "characters", [STRANGER])).status).toBe(400);
  });

  it("keeps what a character carries from a pack that is switched off, and takes it out of every catalog", async () => {
    const { gm, call, read, player } = await boot();
    const lyra = await player(LYRA);
    const potion = (await call("GET", HOMEBREW_PATHS.srdRecord.replace("{id}", "potion-of-healing"), gm)).json.data
      .record;
    const { id: _id, ...body } = potion;
    const imported = await call("POST", HOMEBREW_PATHS.packsImport, gm, {
      pack: {
        schemaId: "vtt.homebrew-pack",
        schemaVersion: 1,
        name: "Sundered Coast extras",
        attribution: "Ren's table",
        exportedAt: "2026-10-17T21:50:00.000Z",
        records: [{ ...body, name: "Tidewater Draught", source: "homebrew" }]
      },
      decisions: [{ index: 0, decision: "new" }]
    });
    expect(imported.status).toBe(200);
    const pack = imported.json.data.pack;
    expect(pack).toMatchObject({
      kind: "imported",
      name: "Sundered Coast extras",
      credit: "Ren's table",
      enabled: true
    });
    const item = imported.json.data.records[0].id as string;
    expect((await call("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", item), gm, {})).status).toBe(200);
    expect(
      (await call("PUT", HOMEBREW_PATHS.contentAudience.replace("{id}", item), gm, { audience: "everyone" })).status
    ).toBe(200);
    const given = await call("POST", GAME_PATHS.characterSetInventory.replace("{actorId}", LYRA), gm, {
      item: { id: item, name: "Tidewater Draught", quantity: 2 }
    });
    expect(given.status, JSON.stringify(given.json)).toBe(200);
    const actionsPath = GAME_PATHS.actorAvailableActions.replace("{actorId}", LYRA);
    const actionsBefore = (await read(actionsPath, lyra.token)).body;
    expect(actionsBefore).toContain("Drink Potion of Healing");
    expect((await read(CONTENT_PATHS.equipment, lyra.token)).body).toContain(item);
    const pingsBefore = lyra.pings.length;

    const off = await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", pack.id), gm, { enabled: false });
    expect(off.json.data.pack).toMatchObject({ enabled: false, counts: { published: 1, shared: 1 } });
    await expect.poll(() => lyra.pings.length).toBe(pingsBefore + 1);
    // Out of every catalog: the player's gear picker, the GM's, and the GM's table marks it.
    expect((await read(CONTENT_PATHS.equipment, lyra.token)).body).not.toContain(item);
    expect((await read(CONTENT_PATHS.equipment, gm)).body).not.toContain(item);
    const summary = (await call("GET", `${HOMEBREW_PATHS.content}?packId=${pack.id}`, gm)).json.data.records[0];
    expect(summary).toMatchObject({ state: "published", audience: "everyone", inCatalogs: false });
    // The character keeps it: the same actions, from the same row.
    expect((await read(actionsPath, lyra.token)).body).toBe(actionsBefore);
    // And a player can't add it again while the pack is off.
    const again = await new Promise<Json>((done) =>
      lyra.socket.emit(
        "character:set-inventory",
        {
          commandId: crypto.randomUUID(),
          actorId: LYRA,
          item: { id: `${item}-2`, recordId: item, name: "Draught", quantity: 1 }
        },
        done
      )
    );
    expect(again.ok).toBe(false);

    await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", pack.id), gm, { enabled: true });
    expect((await read(CONTENT_PATHS.equipment, lyra.token)).body).toContain(item);
  });

  it("warns the gate about a record that needs one in a pack that is off", async () => {
    const { gm, call } = await boot();
    const imported = await call("POST", HOMEBREW_PATHS.packsImport, gm, {
      pack: {
        schemaId: "vtt.homebrew-pack",
        schemaVersion: 1,
        name: "Sundered Coast extras",
        attribution: null,
        exportedAt: "2026-10-17T21:50:00.000Z",
        records: [
          {
            type: "feat",
            name: "Harbor Rat",
            category: "origin",
            feature: { id: "harbor-rat", name: "Harbor Rat", description: "You know the docks." }
          }
        ]
      }
    });
    const feat = imported.json.data.records[0].id as string;
    const pack = imported.json.data.pack.id as string;
    await call("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", feat), gm, {});
    await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", pack), gm, { enabled: false });
    const background = await call("POST", HOMEBREW_PATHS.contentDuplicate.replace("{id}", "sage"), gm, {
      name: "Dockhand"
    });
    const body = { ...background.json.data.record.record, originFeatId: feat };
    const updated = await call(
      "PATCH",
      HOMEBREW_PATHS.contentById.replace("{id}", background.json.data.record.id),
      gm,
      {
        record: body
      }
    );
    const validity = updated.json.data.record.validity;
    expect(validity.valid).toBe(true);
    expect(validity.warnings).toContainEqual({
      path: ["originFeatId"],
      message:
        "Needs Harbor Rat from Sundered Coast extras, which is switched off. Turn that pack on in Sources to use it.",
      recordId: null
    });
  });
});

describe("the migration of visible_to_players, and an old pack", () => {
  it("turns a shown record into Everyone, keeps a hidden one and a draft Hidden, and reads old history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-migrate-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "vtt.sqlite");
    // The file as the previous server left it: migrations 1 and 2, with the one player flag.
    const old = new DatabaseSync(path);
    migrate(
      old,
      "homebrew",
      HOMEBREW_MIGRATIONS.filter((migration) => migration.version <= 2),
      { path }
    );
    const insert = old.prepare(
      "INSERT INTO homebrew_records (id, type, name, state, visible_to_players, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, 'feat', ?, ?, ?, NULL, ?, 2, '2026-01-01T00:00:00.000Z', ?)"
    );
    const feat = (id: string, name: string) =>
      JSON.stringify({
        id,
        name,
        source: "homebrew",
        category: "general",
        feature: { id: "f", name, description: "It works." }
      });
    insert.run(
      "hb-shown-a1b2c3",
      "Shown",
      "published",
      1,
      feat("hb-shown-a1b2c3", "Shown"),
      "2026-02-02T00:00:00.000Z"
    );
    insert.run("hb-gm-a1b2c3", "Secret", "published", 0, feat("hb-gm-a1b2c3", "Secret"), "2026-02-03T00:00:00.000Z");
    // Only the API could leave a draft flagged; a draft is always Hidden now.
    insert.run("hb-draft-a1b2c3", "Draft", "draft", 1, feat("hb-draft-a1b2c3", "Draft"), "2026-02-04T00:00:00.000Z");
    old
      .prepare(
        "INSERT INTO homebrew_record_revisions (record_id, rev, name, state, visible_to_players, body_json, authored_at, author_tag) VALUES ('hb-shown-a1b2c3', 1, 'Shown', 'draft', 0, ?, '2026-01-01T00:00:00.000Z', 'homebrew:create'), ('hb-shown-a1b2c3', 2, 'Shown', 'published', 1, ?, '2026-01-02T00:00:00.000Z', 'gm:pending')"
      )
      .run(feat("hb-shown-a1b2c3", "Shown"), feat("hb-shown-a1b2c3", "Shown"));
    old.close();

    const store = new HomebrewStore(path);
    await store.initialize();
    cleanups.push(() => store.close());
    expect(store.get("hb-shown-a1b2c3")).toMatchObject({
      audience: "everyone",
      characterIds: [],
      visibleToPlayers: true,
      packId: "table",
      basedOn: null,
      reveals: [{ to: "everyone", at: "2026-02-02T00:00:00.000Z" }]
    });
    expect(store.get("hb-gm-a1b2c3")).toMatchObject({ audience: "hidden", reveals: [] });
    expect(store.get("hb-draft-a1b2c3")).toMatchObject({ state: "draft", audience: "hidden" });
    expect(store.listPacks()).toEqual([
      { id: "table", kind: "table", name: null, credit: null, importedAt: null, enabled: true }
    ]);
    expect(store.listRevisions("hb-shown-a1b2c3").map((row) => [row.event, row.pending, row.audience])).toEqual([
      ["edit", true, "everyone"],
      ["create", false, "hidden"]
    ]);
    const everyone = new ContentLibrary(store).forAudience({ characterIds: [] });
    expect(everyone.featRecord("hb-shown-a1b2c3")?.name).toBe("Shown");
    expect(everyone.featRecord("hb-gm-a1b2c3")).toBeUndefined();
    expect(everyone.featRecord("hb-draft-a1b2c3")).toBeUndefined();
  });

  it("imports a pack file from before packs were kept, as hidden drafts in a pack of its own", async () => {
    const { gm, call } = await boot();
    // Today's export shape, unchanged: schema version 1, ids this table did not mint, no decisions.
    const oldPack = {
      schemaId: "vtt.homebrew-pack",
      schemaVersion: 1,
      name: "Homebrew",
      attribution: null,
      exportedAt: "2026-07-27T12:00:00.000Z",
      records: [
        {
          type: "feat",
          id: "hb-old-feat-a1b2c3",
          name: "Old Feat",
          category: "general",
          feature: { id: "f", name: "Old Feat", description: "It works." }
        },
        { type: "spell-list", id: "hb-old-list-d4e5f6", name: "Old List", add: ["fireball"] }
      ]
    };
    const dry = await call("POST", HOMEBREW_PATHS.packsImport, gm, { pack: oldPack, dryRun: true });
    expect(dry.json.data).toMatchObject({ dryRun: true, pack: null });
    expect(dry.json.data.records.map((row: Json) => [row.name, row.decision, row.clash])).toEqual([
      ["Old Feat", "new", null],
      ["Old List", "new", null]
    ]);
    const applied = await call("POST", HOMEBREW_PATHS.packsImport, gm, { pack: oldPack });
    expect(applied.status).toBe(200);
    expect(applied.json.data.pack).toMatchObject({
      kind: "imported",
      name: "Homebrew",
      counts: { records: 2, drafts: 2 }
    });
    const rows = (await call("GET", `${HOMEBREW_PATHS.content}?packId=${applied.json.data.pack.id}`, gm)).json.data
      .records as Json[];
    expect(rows.map((row) => [row.name, row.state, row.audience, row.id])).toEqual([
      ["Old Feat", "draft", "hidden", "hb-old-feat-a1b2c3"],
      ["Old List", "draft", "hidden", "hb-old-list-d4e5f6"]
    ]);
  });
});
