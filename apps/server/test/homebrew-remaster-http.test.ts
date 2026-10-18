import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOMEBREW_PATHS,
  HomebrewContentListResponseSchema,
  HomebrewContentResponseSchema,
  HomebrewOverviewResponseSchema,
  HomebrewPackImportResponseSchema,
  HomebrewPackListResponseSchema,
  HomebrewRevisionListResponseSchema,
  HomebrewRevisionReadResponseSchema,
  HomebrewSearchResponseSchema,
  HomebrewSharingResponseSchema,
  HomebrewSrdRecordResponseSchema,
  HomebrewTableResponseSchema,
  HomebrewConflictSchema
} from "@vtt/api-contract";
import { ContentLibrary } from "../src/content-library.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH } from "../src/homebrew-http.js";
import { findCatalogRecord } from "../src/homebrew-srd-copy.js";
import { HomebrewStore } from "../src/homebrew-store.js";
import { createHomebrewValidator, scenarioCatalogs } from "../src/homebrew-validate.js";
import { requestConventions } from "../src/http-kit.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

// The remastered GM surface: who sees it, history and conflicts, import decided per record, export of a selection,
// the tables with the SRD's rows, the overview, search, Based on and the names behind ids. Every answer is parsed with
// the contract's own schema, so the router cannot drift from what the client codes against.

const LYRA = "0b6f6a3e-8f3c-4b1e-9d2a-1c2b3a4d5e6f";
const MIRENA = "1c7a7b4f-9a4d-4c2f-8e3b-2d3c4b5e6f70";
const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PHONE = { authorization: "Bearer gm-phone", "content-type": "application/json" };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Json = Record<string, any>;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-remaster-"));
  let clock = Date.parse("2026-10-17T19:00:00.000Z");
  const store = new HomebrewStore(join(directory, "vtt.sqlite"), () => (clock += 1000));
  await store.initialize();
  const contentLibrary = new ContentLibrary(store);
  const pings: number[] = [];
  const app = express();
  app.use(requestConventions);
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  app.use(express.json({ limit: "512kb" }));
  app.use(
    createHomebrewRouter({
      store,
      verifiers: fixedVerifiers({ gm: ["gm-token", "gm-phone"], player: ["player-token"] }),
      notifyChanged: () => pings.push(store.revision),
      validate: createHomebrewValidator({
        forAudience: (audience) => contentLibrary.forAudience(audience),
        forScenario: scenarioCatalogs(contentLibrary, store),
        publishedSpellLists: (audience = "play") => store.publishedFor(audience).spellLists,
        authoredIndex: () => store.authoredIndex(),
        offPackRecords: () => store.offPackRecords()
      }),
      catalogRecord: (id) => findCatalogRecord(contentLibrary.forAudience("play"), id),
      contentLibrary,
      partyCharacters: () => new Set([LYRA, MIRENA])
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
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = GM) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return {
      status: response.status,
      json: (text ? JSON.parse(text) : null) as Json,
      etag: response.headers.get("etag")
    };
  };
  const at = (path: string, id: string) => path.replace("{id}", id);
  const copy = async (srdId: string, name: string) => {
    const made = await call("POST", at(HOMEBREW_PATHS.contentDuplicate, srdId), { name });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    return made.json.data.record as Json;
  };
  const publish = async (id: string) => {
    const published = await call("POST", at(HOMEBREW_PATHS.contentPublish, id), {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    return published.json.data.record as Json;
  };
  return { base, store, call, at, copy, publish, pings };
}

describe("names before records, and Based on", () => {
  it("mints the copy's id from the name the GM typed, and keeps what it was copied from", async () => {
    const { call, at, copy } = await fixture();
    const wand = await copy("wand-of-fireballs", "Wand of Saltfire");
    expect(wand.id).toMatch(/^hb-wand-of-saltfire-[0-9a-f]{6}$/);
    expect(wand).toMatchObject({ state: "draft", audience: "hidden", packId: "table", packName: null });
    expect(wand.basedOn).toMatchObject({ source: "srd", id: "wand-of-fireballs", name: "Wand of Fireballs" });
    const second = await call("POST", at(HOMEBREW_PATHS.contentDuplicate, wand.id), { name: "Wand of Brine" });
    expect(second.json.data.record.basedOn).toMatchObject({
      source: "homebrew",
      id: wand.id,
      name: "Wand of Saltfire"
    });

    // The SRD source reads as an authorable body, for the Card tab and Compare.
    const source = await call("GET", at(HOMEBREW_PATHS.srdRecord, "wand-of-fireballs"));
    expect(HomebrewSrdRecordResponseSchema.safeParse(source.json).success).toBe(true);
    expect(source.json.data).toMatchObject({
      type: "equipment",
      record: { id: "wand-of-fireballs", name: "Wand of Fireballs" }
    });
    expect((await call("GET", at(HOMEBREW_PATHS.srdRecord, wand.id))).status).toBe(404);
  });

  it("names every record a body mentions, so an item's spell row shows the spell's name (#156)", async () => {
    const { call, at, copy } = await fixture();
    const spell = await copy("fireball", "Brine Burst");
    const wand = await copy("wand-of-fireballs", "Wand of Saltfire");
    const casts = (wand.record.casts as Json[]).map((cast) => ({ ...cast, spellId: spell.id }));
    const updated = await call("PATCH", at(HOMEBREW_PATHS.contentById, wand.id), {
      record: { ...wand.record, casts },
      expectedRev: wand.rev
    });
    expect(updated.json.data.record.references[spell.id]).toEqual({
      type: "spell",
      name: "Brine Burst",
      source: "homebrew"
    });
    expect(updated.json.data.record.references).not.toHaveProperty(wand.id);
  });
});

describe("who sees it", () => {
  it("sets one record's audience, refuses a draft, and checks the characters", async () => {
    const { call, at, copy, publish } = await fixture();
    const spell = await copy("fireball", "Brine Burst");
    const refused = await call("PUT", at(HOMEBREW_PATHS.contentAudience, spell.id), { audience: "everyone" });
    expect(refused.status).toBe(409);
    expect(refused.json.error.message).toBe("Publish Brine Burst before you share it.");
    const live = await publish(spell.id);
    expect(live.audience).toBe("hidden");

    for (const [body, message] of [
      [{ audience: "characters" }, "Pick at least one character to share this with."],
      [
        { audience: "everyone", characterIds: [LYRA] },
        "Characters can be picked only when the record is shared with characters."
      ],
      [
        { audience: "characters", characterIds: ["5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a"] },
        "That character is not in the party."
      ]
    ] as const) {
      const bad = await call("PUT", at(HOMEBREW_PATHS.contentAudience, spell.id), body);
      expect(bad.status).toBe(400);
      expect(bad.json.error.message).toBe(message);
    }
    const shown = await call("PUT", at(HOMEBREW_PATHS.contentAudience, spell.id), {
      audience: "characters",
      characterIds: [LYRA],
      expectedRev: live.rev
    });
    expect(HomebrewContentResponseSchema.safeParse(shown.json).success).toBe(true);
    expect(shown.json.data.record).toMatchObject({
      audience: "characters",
      characterIds: [LYRA],
      visibleToPlayers: true
    });
    expect(shown.json.data.record.reveals.map((reveal: Json) => reveal.to)).toEqual([LYRA]);
    // Everyone after Lyra adds a stamp for everyone; hiding keeps both.
    await call("PUT", at(HOMEBREW_PATHS.contentAudience, spell.id), { audience: "everyone" });
    const hidden = await call("PUT", at(HOMEBREW_PATHS.contentAudience, spell.id), { audience: "hidden" });
    expect(hidden.json.data.record.reveals.map((reveal: Json) => reveal.to)).toEqual([LYRA, "everyone"]);
  });

  it("shares many records in one write, all or none, with one history row each", async () => {
    const { call, at, copy, publish, pings } = await fixture();
    const one = await publish((await copy("fireball", "Brine Burst")).id);
    const two = await publish((await copy("dwarf", "Saltborn")).id);
    const draft = await copy("sage", "Dockhand");
    const before = pings.length;

    const refused = await call("POST", HOMEBREW_PATHS.sharing, {
      records: [{ id: one.id }, { id: draft.id }],
      audience: "everyone"
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error.message).toBe("Publish Dockhand before you share it.");
    expect((await call("GET", at(HOMEBREW_PATHS.contentById, one.id))).json.data.record.audience).toBe("hidden");
    expect(pings.length).toBe(before);

    const shared = await call("POST", HOMEBREW_PATHS.sharing, {
      records: [{ id: one.id, expectedRev: one.rev }, { id: two.id }],
      audience: "characters",
      characterIds: [MIRENA]
    });
    expect(HomebrewSharingResponseSchema.safeParse(shared.json).success).toBe(true);
    expect(shared.json.data.records.map((row: Json) => [row.name, row.audience, row.characterIds])).toEqual([
      ["Brine Burst", "characters", [MIRENA]],
      ["Saltborn", "characters", [MIRENA]]
    ]);
    const history = await call("GET", at(HOMEBREW_PATHS.contentRevisions, one.id));
    expect(history.json.data.revisions[0]).toMatchObject({ event: "share", audience: "characters" });
    expect(pings.length).toBe(before + 1);
  });
});

describe("history and conflicts", () => {
  it("lists every write with its device and changed fields, reads one, and restores it as changes not live", async () => {
    const { call, at, copy, publish } = await fixture();
    const made = await copy("dwarf", "Saltborn");
    const live = await publish(made.id);
    const edited = await call(
      "PATCH",
      at(HOMEBREW_PATHS.contentById, made.id),
      {
        record: { ...made.record, summary: "Children of the tide." },
        expectedRev: live.rev
      },
      PHONE
    );
    expect(edited.json.data.record.pendingChanges).toBe(true);

    const listed = await call("GET", at(HOMEBREW_PATHS.contentRevisions, made.id));
    expect(HomebrewRevisionListResponseSchema.safeParse(listed.json).success).toBe(true);
    const revisions = listed.json.data.revisions as Json[];
    expect(revisions.map((row) => [row.event, row.device, row.pending])).toEqual([
      ["edit", "other-device", true],
      ["publish", "this-device", false],
      ["duplicate", "this-device", false]
    ]);
    expect(revisions[0].changedFields).toEqual(["summary"]);
    expect(revisions[0].deviceKey).not.toBe(revisions[1].deviceKey);

    const first = revisions[2]!;
    const one = await call(
      "GET",
      HOMEBREW_PATHS.contentRevision.replace("{id}", made.id).replace("{revisionId}", String(first.id))
    );
    expect(HomebrewRevisionReadResponseSchema.safeParse(one.json).success).toBe(true);
    expect(one.json.data.revision.record).toMatchObject({ type: "species", name: "Saltborn" });

    const restored = await call(
      "POST",
      HOMEBREW_PATHS.contentRevisionRestore.replace("{id}", made.id).replace("{revisionId}", String(first.id)),
      { expectedRev: edited.json.data.record.rev }
    );
    // The old version is the editor's copy; the live body never moved, so nothing is pending any more.
    expect(restored.json.data.record).toMatchObject({ state: "published", pendingChanges: false });
    expect((await call("GET", at(HOMEBREW_PATHS.contentRevisions, made.id))).json.data.revisions[0].event).toBe(
      "revert"
    );
  });

  it("answers a stale save with the fields the server's copy changed since, and both values", async () => {
    const { call, at, copy } = await fixture();
    const made = await copy("dwarf", "Saltborn");
    const phone = await call(
      "PATCH",
      at(HOMEBREW_PATHS.contentById, made.id),
      {
        record: { ...made.record, description: "Their eyes shine green under water." },
        expectedRev: made.rev
      },
      PHONE
    );
    expect(phone.status).toBe(200);
    const stale = await call("PATCH", at(HOMEBREW_PATHS.contentById, made.id), {
      record: { ...made.record, summary: "Children of the sea." },
      expectedRev: made.rev
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.currentRevision).toBe(made.rev + 1);
    const conflict = HomebrewConflictSchema.parse(stale.json.error.details.conflict);
    expect(conflict).toEqual({
      baseRev: made.rev,
      currentRev: made.rev + 1,
      baseKnown: true,
      changes: [
        { field: "description", base: made.record.description, current: "Their eyes shine green under water." }
      ],
      rowChanges: []
    });
  });
});

describe("packs: import decided per record, and export of a selection", () => {
  const pack = (records: Json[]) => ({
    schemaId: "vtt.homebrew-pack",
    schemaVersion: 1,
    name: "Sundered Coast extras",
    attribution: "Ren's table",
    exportedAt: "2026-10-17T21:50:00.000Z",
    records
  });
  const feat = (name: string, extra: Json = {}) => ({
    type: "feat",
    name,
    category: "general",
    feature: { id: "f", name, description: "It works." },
    ...extra
  });

  it("reports each record's kind, clash and problems in names, then applies a decision per record", async () => {
    const { call, at, copy, publish } = await fixture();
    const ours = await publish((await copy("alert", "Harbor Rat")).id);
    await call("PUT", at(HOMEBREW_PATHS.contentAudience, ours.id), { audience: "everyone" });
    const draft = await copy("skilled", "Lantern Bearer");
    const incoming = pack([
      feat("Harbor Rat"),
      feat("Lantern Bearer"),
      { type: "spell", name: "Gale Lance" },
      feat("Brand New")
    ]);

    // An empty list of decisions asks for the default one per record.
    const dry = await call("POST", HOMEBREW_PATHS.packsImport, { pack: incoming, dryRun: true, decisions: [] });
    expect(HomebrewPackImportResponseSchema.safeParse(dry.json).success).toBe(true);
    const rows = dry.json.data.records as Json[];
    expect(rows.map((row) => [row.name, row.type, row.clash?.name ?? null, row.allowed, row.decision])).toEqual([
      ["Harbor Rat", "feat", "Harbor Rat", ["new", "skip", "rename"], "rename"],
      ["Lantern Bearer", "feat", "Lantern Bearer", ["new", "replace", "skip", "rename"], "rename"],
      ["Gale Lance", "spell", null, ["new", "skip", "rename"], "new"],
      ["Brand New", "feat", null, ["new", "skip", "rename"], "new"]
    ]);
    expect(rows[0]!.clash).toMatchObject({ source: "homebrew", state: "published", audience: "everyone" });
    // The spell with no level arrives with words for what it lacks.
    expect(rows[2]!.problems.map((issue: Json) => issue.message)).toContain("Fill in the level.");
    expect(dry.json.data.pack).toBeNull();

    // A published, shared record is never replaced.
    const refused = await call("POST", HOMEBREW_PATHS.packsImport, {
      pack: incoming,
      decisions: [{ index: 0, decision: "replace" }]
    });
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toBe(
      "Harbor Rat can't replace anything here: only your own draft of the same kind can be replaced."
    );

    const applied = await call("POST", HOMEBREW_PATHS.packsImport, {
      pack: incoming,
      decisions: [
        { index: 0, decision: "rename", name: "Harbor Rat (Ren)" },
        { index: 1, decision: "replace" },
        { index: 2, decision: "skip" }
      ]
    });
    expect(applied.status).toBe(200);
    const landed = applied.json.data.records as Json[];
    expect(landed.map((row) => row.decision)).toEqual(["rename", "replace", "skip", "new"]);
    expect(landed[1]!.id).toBe(draft.id);
    expect(landed[2]!.id).toBeNull();
    const imported = applied.json.data.pack as Json;
    expect(imported).toMatchObject({
      kind: "imported",
      name: "Sundered Coast extras",
      credit: "Ren's table",
      counts: { records: 3 }
    });
    const inPack = (await call("GET", `${HOMEBREW_PATHS.content}?packId=${imported.id}`)).json.data.records as Json[];
    expect(inPack.map((row) => [row.name, row.state, row.audience]).sort()).toEqual([
      ["Brand New", "draft", "hidden"],
      ["Harbor Rat (Ren)", "draft", "hidden"],
      ["Lantern Bearer", "draft", "hidden"]
    ]);
    // Ours is untouched.
    expect((await call("GET", at(HOMEBREW_PATHS.contentById, ours.id))).json.data.record).toMatchObject({
      state: "published",
      audience: "everyone",
      packId: "table"
    });
  });

  it("exports a chosen set under a pack name, and lists, renames and switches packs", async () => {
    const { call, copy, publish } = await fixture();
    const one = await publish((await copy("alert", "Harbor Rat")).id);
    await publish((await copy("dwarf", "Saltborn")).id);
    const exported = await call(
      "GET",
      `${HOMEBREW_PATHS.packsExport}?id=${one.id}&name=${encodeURIComponent("Saltmere")}&credit=${encodeURIComponent("Ozy's table")}`
    );
    expect(exported.json.data.pack).toMatchObject({ name: "Saltmere", attribution: "Ozy's table" });
    expect(exported.json.data.pack.records.map((record: Json) => record.name)).toEqual(["Harbor Rat"]);

    const imported = await call("POST", HOMEBREW_PATHS.packsImport, { pack: exported.json.data.pack });
    const packId = imported.json.data.pack.id as string;
    const listed = await call("GET", HOMEBREW_PATHS.packs);
    expect(HomebrewPackListResponseSchema.safeParse(listed.json).success).toBe(true);
    expect(listed.json.data.srd.records).toBeGreaterThan(1000);
    expect(listed.json.data.packs.map((row: Json) => [row.kind, row.name, row.counts.records])).toEqual([
      ["table", null, 2],
      ["imported", "Saltmere", 1]
    ]);
    const renamed = await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", packId), {
      name: "Saltmere arc",
      credit: null
    });
    expect(renamed.json.data.pack).toMatchObject({ name: "Saltmere arc", credit: null, enabled: true });
    const table = await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", "table"), { name: "Mine" });
    expect(table.status).toBe(409);
    expect((await call("PATCH", HOMEBREW_PATHS.packById.replace("{packId}", "table"), { enabled: false })).status).toBe(
      200
    );
    expect((await call("GET", `${HOMEBREW_PATHS.content}?packId=table`)).json.data.records[0].inCatalogs).toBe(false);
  });
});

describe("the GM's tables, overview and search", () => {
  it("holds the SRD's rows and the homebrew of a kind in one table, with the kind's own columns", async () => {
    const { base, call, copy, publish } = await fixture();
    const live = await publish((await copy("fireball", "Brine Burst")).id);
    await call("PATCH", HOMEBREW_PATHS.contentById.replace("{id}", live.id), {
      record: { ...live.record, level: 4 }
    });
    const table = await call("GET", `${HOMEBREW_PATHS.table}?kind=spell`);
    expect(HomebrewTableResponseSchema.safeParse(table.json).success).toBe(true);
    const rows = table.json.data.rows as Json[];
    expect(rows.find((row) => row.id === "fireball")).toMatchObject({
      source: "srd",
      packId: null,
      audience: "everyone",
      usageCount: null,
      columns: { level: 3, school: "evocation" }
    });
    expect(rows.find((row) => row.id === live.id)).toMatchObject({
      source: "homebrew",
      packId: "table",
      state: "published",
      pendingChanges: true,
      audience: "hidden",
      basedOn: { source: "srd", id: "fireball" },
      columns: { level: 4, school: "evocation" }
    });
    // A repeat read of the same table is a 304.
    expect(table.etag).toMatch(/^W\/"hb-/);
    const again = await fetch(`${base}${HOMEBREW_PATHS.table}?kind=spell`, {
      headers: { ...GM, "if-none-match": table.etag! }
    });
    expect(again.status).toBe(304);
    const monsters = (await call("GET", `${HOMEBREW_PATHS.table}?kind=monster`)).json.data.rows as Json[];
    expect(monsters.find((row) => row.id === "goblin-warrior")!.columns).toMatchObject({
      challengeRating: 0.25,
      size: "small",
      armorClass: 15
    });
    const items = (await call("GET", `${HOMEBREW_PATHS.table}?kind=equipment`)).json.data.rows as Json[];
    expect(items.find((row) => row.id === "wand-of-fireballs")!.columns).toMatchObject({
      itemKind: "wand",
      rarity: "rare",
      attunement: { required: true }
    });
    const classes = (await call("GET", `${HOMEBREW_PATHS.table}?kind=class`)).json.data.rows as Json[];
    expect(classes.find((row) => row.id === "wizard")!.columns).toMatchObject({ hitDie: "d6", casterType: "full" });
    expect(classes.find((row) => row.id === "fighter")!.columns).toMatchObject({ casterType: "none" });
  });

  it("summarises sources, kinds and what needs the GM, and finds homebrew by its text with the matched line", async () => {
    const { call, copy, publish } = await fixture();
    const live = await publish((await copy("dwarf", "Saltborn")).id);
    await call("PATCH", HOMEBREW_PATHS.contentById.replace("{id}", live.id), {
      record: { ...live.record, description: "Born of salt.\nThey breathe brine and air alike." }
    });
    await copy("alert", "Lantern Bearer");
    const overview = await call("GET", HOMEBREW_PATHS.overview);
    expect(HomebrewOverviewResponseSchema.safeParse(overview.json).success).toBe(true);
    expect(overview.json.data.byKind.find((row: Json) => row.kind === "species")).toMatchObject({
      homebrew: 1,
      drafts: 0
    });
    expect(overview.json.data.needsYou.map((row: Json) => [row.name, row.reason])).toEqual([
      ["Lantern Bearer", "draft"],
      ["Saltborn", "changes-not-live"]
    ]);

    const found = await call("GET", `${HOMEBREW_PATHS.search}?q=brine`);
    expect(HomebrewSearchResponseSchema.safeParse(found.json).success).toBe(true);
    expect(found.json.data.hits).toEqual([
      expect.objectContaining({
        name: "Saltborn",
        matches: [{ path: ["description"], line: "They breathe brine and air alike." }]
      })
    ]);
    expect((await call("GET", `${HOMEBREW_PATHS.search}?q=lantern`)).json.data.hits[0].matches[0]).toEqual({
      path: ["name"],
      line: "Lantern Bearer"
    });
    const list = await call("GET", HOMEBREW_PATHS.content);
    expect(HomebrewContentListResponseSchema.safeParse(list.json).success).toBe(true);
  });
});
