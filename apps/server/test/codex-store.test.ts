import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, MIGRATIONS, deadlineFired, downtimePayloadOf, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmChronicleRecord, projectGmJournalEntry, projectGmLinkEdges, projectGmMarker, projectGmQuest, projectGmRelationships, projectGmSearchHit, projectGmSession, projectPlayerBacklinks, projectPlayerChronicleRecord, projectPlayerJournalEntry, projectPlayerLinkEdges, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerRelationships, projectPlayerSearchHit, projectPlayerSession } from "../src/codex-projections.js";

let directory: string;
let store: CodexStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vtt-codex-"));
  store = new CodexStore(join(directory, "vtt.sqlite"));
  await store.initialize();
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

/**
 * The session context `projectPlayerJournalEntry` / `projectPlayerChronicleRecord` take, resolved from the
 * store exactly as `codex-http.ts` resolves it per request. A CALL, not a constant: a session's reveal
 * state changes mid-test, and a context captured once would go stale and quietly make the gate look broken.
 */
const playerSessionNumbers = (from: CodexStore = store) => ({ unrevealedSessionNumbers: from.unrevealedSessionNumbers() });

describe("CodexStore search — the SQL visibility layer, on its own (CI-1)", () => {
  /**
   * Why these exist. Player visibility is gated TWICE on purpose: `PLAYER_VISIBLE_SQL` in the query, and
   * `projectPlayerSearchHit` at the HTTP boundary. That is good design, but it creates a blind spot —
   * an HTTP-boundary test cannot tell you the SQL layer works, only that the pipeline as a whole does.
   * Proven, not assumed: weakening the SQL marker arm to drop `codex_maps.revealed = 1` left **all 787
   * tests passing**, because the projection quietly caught it. These call `searchAll` directly, below the
   * projection, so each kind's primary gate is verified on its own.
   */
  it("does not return an unrevealed MAP to a player", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Castle Ravenloft", kind: "regional" });
    expect(store.searchAll("gm", "Ravenloft").some((hit) => hit.kind === "map" && hit.id === map.id)).toBe(true);
    expect(store.searchAll("player", "Ravenloft").some((hit) => hit.id === map.id)).toBe(false);
  });

  it("does not return an unrevealed JOURNAL entry to a player", () => {
    const entry = store.createEntry({ playerText: "The vistani warned us" });
    expect(store.searchAll("gm", "vistani").some((hit) => hit.kind === "journal" && hit.id === entry.id)).toBe(true);
    expect(store.searchAll("player", "vistani").some((hit) => hit.id === entry.id)).toBe(false);
  });

  /**
   * M10 SEARCH GATE 2 of 3 — `PLAYER_VISIBLE_SQL`'s `WHEN 'quest'` arm, on its own.
   *
   * This is the gate the M6 incident was about, which is why it is asserted HERE rather than over HTTP:
   * `projectPlayerSearchHit` re-applies the same predicate on the way out, so a weakened SQL arm leaves
   * the whole HTTP suite green. `searchAll` is below that projection, so nothing can catch the break for
   * it. Both directions are asserted, because the two ways to get this arm wrong fail differently:
   * weakening it (`THEN 1`) surfaces the secret quest, and DELETING it drops through to `ELSE 0` and
   * hides a quest that ought to be findable.
   */
  it("does not return an UNREVEALED quest to a player, and does return a revealed one (M10, at the SQL layer)", () => {
    const quest = store.createQuest({ title: "The Wyrmwood Contract", playerBody: "Recover the ledger." });
    expect(quest.revealedToPlayers).toBe(false);
    // The GM finds it, so the player's miss below is the visibility arm and not a quest that never indexed.
    expect(store.searchAll("gm", "ledger").some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
    expect(store.searchAll("player", "ledger").some((hit) => hit.id === quest.id)).toBe(false);

    // ...and revealing it makes it findable, so the miss above is the reveal gate and not a missing arm.
    store.setQuestRevealed(quest.id, true);
    expect(store.searchAll("player", "ledger").some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
  });

  it("does not return a REVEALED marker sitting on a SECRET map to a player (CD-6, at the SQL layer)", () => {
    // The flagship case. The pin is shown; the map is not. Players never receive the map, so they must
    // not be able to find the pin either — and that must hold in the QUERY, not only in the projection.
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Hidden", kind: "regional" });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Crypt of Strahd" });
    store.setMarkerRevealed(marker.id, true);                    // pin shown...
    expect(store.getMap(map.id)!.revealedToPlayers).toBe(false);  // ...map still secret
    expect(store.searchAll("gm", "Crypt").some((hit) => hit.kind === "marker" && hit.id === marker.id)).toBe(true);
    expect(store.searchAll("player", "Crypt").some((hit) => hit.id === marker.id)).toBe(false);

    // ...and revealing the map makes it findable, so the miss above is the map gate and not a bad query.
    store.setMapRevealed(map.id, true);
    expect(store.searchAll("player", "Crypt").some((hit) => hit.id === marker.id)).toBe(true);
  });
});

describe("CodexStore search matches tags on every kind (CI-1 + CI-2)", () => {
  it("finds a PAGE by its tag, the same way it finds a tagged map or marker", () => {
    // The asymmetry this pins: maps/markers/journal indexed their tags but pages did not, so one search
    // box answered a tag query differently depending on which record happened to carry the tag.
    const page = store.createPage({ title: "Strahd", tags: ["villain"] });
    store.setPageRevealed(page.id, true);
    const gmHits = store.searchAll("gm", "villain");
    expect(gmHits.some((hit) => hit.kind === "page" && hit.id === page.id)).toBe(true);
    // ...and a player can find it too, because a revealed page's tags are already player-visible.
    expect(store.searchAll("player", "villain").some((hit) => hit.kind === "page" && hit.id === page.id)).toBe(true);
  });

  it("does not surface an UNREVEALED page by its tag to a player", () => {
    const page = store.createPage({ title: "Secret", tags: ["villain"] });
    expect(store.searchAll("gm", "villain").some((hit) => hit.id === page.id)).toBe(true);
    expect(store.searchAll("player", "villain").some((hit) => hit.id === page.id)).toBe(false);
  });

  it("keeps a page's indexed tags in step when they change", () => {
    const page = store.createPage({ title: "Rictavio", tags: ["ally"] });
    store.updatePage(page.id, { tags: ["villain"] }, undefined, "gm");
    expect(store.searchAll("gm", "ally").some((hit) => hit.id === page.id)).toBe(false);
    expect(store.searchAll("gm", "villain").some((hit) => hit.id === page.id)).toBe(true);
  });
});

describe("CodexStore search ranks the record NAMED for the query first (CI-1)", () => {
  /**
   * The quick switcher's entire contract is "type the name, press Enter, arrive". It was broken: the
   * old `ORDER BY rank` weighted no columns, so `q=Strahd` returned the two QA pages that merely MENTION
   * Strahd ahead of the page actually CALLED Strahd, and Enter landed on the wrong record.
   *
   * These run against `searchAll` directly rather than through HTTP on purpose. The ordering has exactly
   * one home - the ORDER BY - and this file's own CI-1 lesson is that an end-to-end assertion can pass
   * because a different layer compensated. Ordering asserted here is ordering proven where it is decided.
   * `toEqual` on the whole array is deliberate: it pins RECALL (every record still returned) in the same
   * breath as the order, so a "fix" that won the ranking by dropping the losers cannot pass.
   */
  const seedNamedVersusMentions = () => {
    // Titles that share no word with the query, so only the body can match on the two decoys.
    const named = store.createPage({ title: "Strahd", playerBody: "A vampire lord.", revealedToPlayers: true });
    const mentionsA = store.createPage({ title: "QA Keep 645834", playerBody: "Strahd Strahd garrison notes about Strahd and the keep.", revealedToPlayers: true });
    const mentionsB = store.createPage({ title: "QA Keep 750639", playerBody: "Strahd rides at night. Strahd again.", revealedToPlayers: true });
    return { named: named.id, mentionsA: mentionsA.id, mentionsB: mentionsB.id };
  };

  it("puts the page NAMED Strahd first for a GM, keeping the pages that only mention it", () => {
    const { named, mentionsA, mentionsB } = seedNamedVersusMentions();
    const hits = store.searchAll("gm", "Strahd");
    expect(hits[0]).toEqual({ kind: "page", id: named });
    // Recall is unchanged - the mentions are still found, just below the record named for the query.
    expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
  });

  it("ranks identically for a PLAYER, so the two roles never disagree about where Enter lands", () => {
    // Both audiences have their own FTS table; weighting one and not the other would give the GM and the
    // player who type the same name different answers.
    const { named, mentionsA, mentionsB } = seedNamedVersusMentions();
    const hits = store.searchAll("player", "Strahd");
    expect(hits[0]).toEqual({ kind: "page", id: named });
    expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
  });

  it("keeps the exact-title record first even against a body that repeats the term 120 times", () => {
    // This is the case the unconditional exact-title tier exists for, and the reason it is worth a rule
    // of its own rather than a bigger title weight.
    //
    // Measured on this schema at title 10x / body 1x, with a page titled `Strahd` against one page whose
    // body is nothing but the word repeated N times: at N=40 the titled page wins, at N=80 it LOSES, and
    // the scores either side of that line differ by about 1%. bm25 is not deciding this on meaning - it
    // is decided by how long the GM's prose happens to be. A quick switcher promises "type the name,
    // press Enter, arrive", and a promise settled by a 1% margin that moves with the campaign's word
    // count is not a promise. Tier 1 makes it one.
    //
    // 120 is past the flip on both sides of it, so this fails if the tier is ever dropped in favour of
    // "just raise the weight" - which is exactly what it is here to catch.
    const named = store.createPage({ title: "Strahd", playerBody: "A vampire lord.", revealedToPlayers: true });
    const spam = store.createPage({ title: "QA Keep 111", playerBody: Array.from({ length: 120 }, () => "Strahd").join(" "), revealedToPlayers: true });
    for (const audience of ["gm", "player"] as const) {
      const hits = store.searchAll(audience, "Strahd");
      expect(hits[0]).toEqual({ kind: "page", id: named.id });
      expect(hits).toContainEqual({ kind: "page", id: spam.id });
    }
  });

  it("weights a title hit over a body hit even when NEITHER title is exact", () => {
    // Tier 2 on its own, with tier 1 deliberately unable to fire: no title equals "Ravenloft", so this
    // fails unless bm25 is genuinely weighting the title column. Without it the assertion cannot tell a
    // working weight from a silently mis-applied one (`bm25(t, 10.0, 1.0)` weights the two UNINDEXED
    // columns and leaves title/body at 1.0 - a no-op that does not error).
    const titled = store.createPage({ title: "Castle Ravenloft", playerBody: "the seat of the land", revealedToPlayers: true });
    const bodied = store.createPage({ title: "QA Keep 222", playerBody: "We rode to Ravenloft. Ravenloft loomed. Ravenloft again.", revealedToPlayers: true });
    for (const audience of ["gm", "player"] as const) {
      const hits = store.searchAll(audience, "Ravenloft");
      expect(hits[0]).toEqual({ kind: "page", id: titled.id });
      expect(hits).toContainEqual({ kind: "page", id: bodied.id });
    }
  });

  it("ranks across KINDS, not just within one - a map TITLED for the query beats a journal that mentions it", () => {
    // Suite-wide search shares one 50-result cap across kinds, so ordering has to hold BETWEEN kinds too.
    // A journal entry is indexed with an EMPTY title and can only ever match on body, so a title weight is
    // the only thing that can lift the map above a journal that says the word more often.
    //
    // The map's title is deliberately NOT exactly "Vallaki": tier 1 cannot fire, so this is tier 2 alone
    // being measured across kinds. And the journal repeats the word 8 times because at two mentions the
    // map wins under the OLD bare `rank` too - that fixture asserted a true thing that proved nothing.
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Vallaki Town Square", kind: "regional", revealedToPlayers: true });
    const entry = store.createEntry({ playerText: Array.from({ length: 8 }, () => "Vallaki").join(" ") });
    store.setEntryRevealed(entry.id, true);
    for (const audience of ["gm", "player"] as const) {
      const hits = store.searchAll(audience, "Vallaki");
      expect(hits[0]).toEqual({ kind: "map", id: map.id });
      expect(hits).toContainEqual({ kind: "journal", id: entry.id });
    }
  });

  it("still finds a record whose ONLY match is a tag or a body - re-ranking never filters", () => {
    // The recall guarantee, stated on its own. Re-ranking moved these DOWN; it must not move them OUT,
    // including behind the exact-title tier when some other record wins that tier outright.
    const named = store.createPage({ title: "Villain", playerBody: "the archetype", revealedToPlayers: true });
    const tagged = store.createPage({ title: "Rictavio", tags: ["villain"], revealedToPlayers: true });
    const bodied = store.createPage({ title: "Rumours", playerBody: "a villain walks abroad", revealedToPlayers: true });
    const hits = store.searchAll("player", "Villain");
    expect(hits[0]).toEqual({ kind: "page", id: named.id });
    expect(hits.map((hit) => hit.id).sort()).toEqual([named.id, tagged.id, bodied.id].sort());
  });
});

describe("CodexStore tags on every record type (CI-2)", () => {
  it("stores, updates and clears tags on maps, markers and journal entries", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Barovia", kind: "regional", tags: ["gothic", "act-one"] });
    expect(map.tags).toEqual(["gothic", "act-one"]);
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", tags: ["dungeon"] });
    expect(marker.tags).toEqual(["dungeon"]);
    const entry = store.createEntry({ playerText: "The party arrived.", tags: ["session-1"] });
    expect(entry.tags).toEqual(["session-1"]);

    // Updating replaces the whole set; an empty array genuinely clears rather than being ignored as absent.
    expect(store.updateMap(map.id, { tags: ["act-two"] }).tags).toEqual(["act-two"]);
    expect(store.updateMarker(marker.id, { tags: [] }).tags).toEqual([]);
    expect(store.updateEntry(entry.id, { tags: ["session-2"] }).tags).toEqual(["session-2"]);

    // Omitting `tags` must LEAVE them alone, not wipe them — the partial-update contract pages already use.
    expect(store.updateMap(map.id, { name: "Barovia II" }).tags).toEqual(["act-two"]);
  });

  it("applies the same slug rule and 24-tag cap pages use", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "M", kind: "world" });
    expect(() => store.updateMap(map.id, { tags: ["Not A Slug"] })).toThrow();
    expect(() => store.updateMap(map.id, { tags: Array.from({ length: 25 }, (_, i) => `t${i}`) })).toThrow();
  });

  it("backfills existing rows to an empty tag list rather than null (migration v10)", () => {
    // Rows written before v10 have no tags_json value of their own; the column default must make them
    // read as [] so nothing downstream has to cope with a null.
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Legacy", kind: "world" });
    expect(map.tags).toEqual([]);
    expect(store.getMap(map.id)!.tags).toEqual([]);
    expect(MIGRATIONS.some((migration) => migration.version === 10)).toBe(true);
  });
});

describe("CodexStore suite-wide search (CI-1)", () => {
  /**
   * The plan's K7 risk: v11 replaces the pages-only FTS tables with ONE unified index, on a database
   * that already has rows. Fresh-database tests can never catch a bad backfill (every table is empty),
   * so this builds a genuine v10 database out of the shipped migration SQL, fills it, and then opens a
   * CodexStore on it - which is exactly the upgrade a GM's existing vtt.sqlite performs.
   */
  it("migration v11 backfills existing pages, maps, markers and journal entries, keeping the two layers apart", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v10-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter((entry) => entry.version <= 10)) {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
      }
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();
      const pageId = crypto.randomUUID(), mapId = crypto.randomUUID(), markerId = crypto.randomUUID(), entryId = crypto.randomUUID();
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, 'Ravenloft', 'location', '{}', '{}', NULL, '[]', 'a gothic castle', 'the crypt of Strahd', 1, NULL, 1, '', '')").run(pageId);
      // The pages-only index rows exactly as v2..v10 wrote them - what the backfill has to carry forward.
      database.prepare("INSERT INTO codex_fts_player (page_id, title, body) VALUES (?, 'Ravenloft', 'a gothic castle\n')").run(pageId);
      database.prepare("INSERT INTO codex_fts_gm (page_id, title, body) VALUES (?, 'Ravenloft', 'a gothic castle\nthe crypt of Strahd\n\n')").run(pageId);
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, 'Barovia', 'regional', NULL, 1, 1, '[\"gloomy\"]', '', '')").run(mapId, crypto.randomUUID());
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, tags_json, created_at, updated_at) VALUES (?, ?, 0.5, 0.5, 'pin', '#FF2E9A', 'Svalich Road', 1, '[\"waypoint\"]', '', '')").run(markerId, mapId);
      database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, sort_key, tags_json, created_at, updated_at) VALUES (?, 'The mists parted.', 'Strahd was watching.', 1, 'note', 1, '[\"arrival\"]', '', '')").run(entryId);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();

      // Every pre-existing record is now findable, by every kind, in the ONE index.
      expect(upgraded.searchAll("gm", "Ravenloft")).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "Barovia")).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "Svalich")).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "mists")).toEqual([{ kind: "journal", id: entryId }]);
      // ...including the tags v10 added to those three kinds.
      expect(upgraded.searchAll("player", "gloomy")).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "waypoint")).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "arrival")).toEqual([{ kind: "journal", id: entryId }]);

      // The backfill kept the layers apart: GM-only text landed in the GM index ONLY.
      expect(upgraded.searchAll("player", "crypt")).toEqual([]);
      expect(upgraded.searchAll("gm", "crypt")).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "watching")).toEqual([]);
      expect(upgraded.searchAll("gm", "watching")).toEqual([{ kind: "journal", id: entryId }]);

      // ...and the superseded pages-only tables are gone, so there is one index and one sync path.
      const reopened = new DatabaseSync(path);
      const tables = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      reopened.close();
      expect(tables).not.toContain("codex_fts_player");
      expect(tables).not.toContain("codex_fts_gm");
      expect(tables).toContain("codex_search_player");
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the index in step with writes, including markers swept away by a map delete", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Vallaki", kind: "regional", revealedToPlayers: true });
    const marker = store.createMarker(map.id, { x: 0.1, y: 0.1, iconId: "pin", iconColor: "#FF2E9A", label: "Blinsky toys", revealedToPlayers: true });
    expect(store.searchAll("player", "Blinsky")).toEqual([{ kind: "marker", id: marker.id }]);

    // Renaming reindexes: the old text stops matching, the new text starts.
    store.updateMarker(marker.id, { label: "Burgomaster mansion" });
    expect(store.searchAll("gm", "Blinsky")).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster")).toEqual([{ kind: "marker", id: marker.id }]);

    // A reveal toggle needs no reindex - visibility is resolved against the live row at read time.
    store.setMarkerRevealed(marker.id, false);
    expect(store.searchAll("player", "Burgomaster")).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster")).toEqual([{ kind: "marker", id: marker.id }]);

    // Deleting the MAP cascades its markers away in SQL; their index rows must go with them, or they
    // would keep matching forever with no live row left to gate them.
    store.deleteMap(map.id);
    expect(store.searchAll("gm", "Burgomaster")).toEqual([]);
    expect(store.searchAll("gm", "Vallaki")).toEqual([]);
  });
});

describe("CodexStore pages", () => {
  it("moveFolder re-paths a folder and its descendants, dissolves to top level, and guards self-moves", () => {
    const a = store.createPage({ title: "A", folder: "NPCs" });
    const b = store.createPage({ title: "B", folder: "NPCs/Villains" });
    const c = store.createPage({ title: "C", folder: "Places" });
    expect(store.moveFolder("NPCs", "Cast")).toBe(2);                       // rename NPCs -> Cast
    expect(store.getPage(a.id)!.folder).toBe("Cast");
    expect(store.getPage(b.id)!.folder).toBe("Cast/Villains");              // descendant re-pathed
    expect(store.getPage(c.id)!.folder).toBe("Places");                     // an unrelated folder is untouched
    expect(store.moveFolder("Cast", "")).toBe(2);                           // dissolve Cast to the top level
    expect(store.getPage(a.id)!.folder).toBeNull();
    expect(store.getPage(b.id)!.folder).toBe("Villains");
    expect(() => store.moveFolder("Places", "Places/Sub")).toThrow(/itself/i); // can't nest a folder inside itself
  });

  it("folder records persist an empty folder: creating, moving the last note out, renaming, and deleting", () => {
    store.createFolder("NPCs/Villains");
    expect(store.listFolders()).toContain("NPCs/Villains");
    const page = store.createPage({ title: "Strahd", folder: "NPCs/Villains" });
    // Move the only note out to the top level - the folder RECORD keeps the folder alive (the old bug erased it).
    store.updatePage(page.id, { folder: null }, page.rev, "gm");
    expect(store.getPage(page.id)!.folder).toBeNull();
    expect(store.listFolders()).toContain("NPCs/Villains");                 // still there with no pages in it
    // Rename carries the record along.
    store.moveFolder("NPCs/Villains", "NPCs/Rogues");
    expect(store.listFolders()).toContain("NPCs/Rogues");
    expect(store.listFolders()).not.toContain("NPCs/Villains");
    // Delete drops the folder + subfolders and re-homes any pages to the top level (never deletes a page).
    store.createFolder("NPCs/Rogues/Deep");
    const inside = store.createPage({ title: "Thug", folder: "NPCs/Rogues/Deep" });
    store.deleteFolder("NPCs/Rogues");
    expect(store.listFolders().filter((f) => f.startsWith("NPCs/Rogues"))).toEqual([]);
    expect(store.getPage(inside.id)!.folder).toBeNull();                    // its note survives at the top level
  });

  it("creates, updates with rev bump, reveals, and persists through restart", async () => {
    const page = store.createPage({ title: "Bree", playerBody: "A crossroads town.", gmBody: "The innkeeper is a spy.", tags: ["Town", "town"] });
    expect(page).toMatchObject({ title: "Bree", playerBody: "A crossroads town.", revealedToPlayers: false, rev: 1, tags: ["town"] });

    const updated = store.updatePage(page.id, { playerBody: "A busy crossroads town." }, page.rev, "gm");
    expect(updated.rev).toBe(2);
    expect(updated.playerBody).toBe("A busy crossroads town.");

    // Stale expectedRev is rejected.
    expect(() => store.updatePage(page.id, { title: "Bree Town" }, 1, "gm")).toThrow(CodexRevisionConflictError);

    const revealed = store.setPageRevealed(page.id, true);
    expect(revealed.revealedToPlayers).toBe(true);

    const revisionCount = store.listRevisions(page.id).length;
    expect(revisionCount).toBe(2); // create + one update (reveal does not snapshot)

    store.close();
    store = new CodexStore(join(directory, "vtt.sqlite"));
    await store.initialize();
    expect(store.getPage(page.id)).toMatchObject({ title: "Bree", rev: 2, revealedToPlayers: true });
    expect(store.listPages()).toHaveLength(1);
  });

  it("dates an auto-logged battle at the campaign's current in-world date", () => {
    // The combat-history bridge had no test at all, and hardcoded every battle undated - so each one
    // sank below every dated entry forever. It now takes the calendar's "now".
    const calendar = store.setCalendar({
      yearName: "DR", weekdays: ["Sul"],
      months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }],
      currentDate: { year: 1492, month: 1, day: 15 }
    });
    expect(calendar.currentDate).toEqual({ year: 1492, month: 1, day: 15 });

    const entry = store.appendCombatEntry({ sourceEncounterId: 7, playerText: "A battle was fought here." });
    expect(entry.kind).toBe("combat");
    expect(entry.sourceEncounterId).toBe(7);
    expect(entry.inWorldDate).toEqual({ year: 1492, month: 1, day: 15 });
    expect(entry.calendarInstant).not.toBeNull();
    expect(entry.inWorldLabel).toContain("1492");
    // It must therefore sort WITH the dated entries, not into the undated bucket.
    const dated = store.listTimeline().filter((row) => row.calendarInstant !== null);
    expect(dated.map((row) => row.id)).toContain(entry.id);
  });

  it("leaves an auto-logged battle undated when the world has no current date", () => {
    // Regression guard: no calendar "now" means there is nothing to date it by, and the previous
    // undated behaviour must be preserved rather than inventing a date.
    const entry = store.appendCombatEntry({ sourceEncounterId: 9, playerText: "A battle was fought here." });
    expect(entry.calendarInstant).toBeNull();
    expect(entry.inWorldDate).toBeNull();
    expect(entry.inWorldLabel).toBeNull();
  });

  it("stores nested folder paths, normalizes them, and caps depth", () => {
    const page = store.createPage({ title: "Strahd", folder: " NPCs / Villains " });
    expect(page.folder).toBe("NPCs/Villains"); // segments trimmed
    expect(store.updatePage(page.id, { folder: "//Cults///Vecna//" }, page.rev, "gm").folder).toBe("Cults/Vecna"); // empty segments dropped
    expect(store.updatePage(page.id, { folder: "   " }, undefined, "gm").folder).toBeNull(); // blank → unfiled
    expect(() => store.createPage({ title: "Too deep", folder: "a/b/c/d/e/f/g" })).toThrow(/6 levels/);
  });

  it("restores a past revision as a forward write", () => {
    const page = store.createPage({ title: "Keep", playerBody: "v1" });
    store.updatePage(page.id, { playerBody: "v2" }, page.rev, "gm");
    const revisions = store.listRevisions(page.id);
    const first = revisions.find((r) => r.rev === 1)!;
    const restored = store.restoreRevision(page.id, first.id, "gm");
    expect(restored.playerBody).toBe("v1");
    expect(restored.rev).toBe(3); // history is never rewritten - a new forward revision
  });

  it("deletes a page and nulls markers that referenced it (no dangling)", () => {
    const page = store.createPage({ title: "Doomed" });
    store.deletePage(page.id);
    expect(store.getPage(page.id)).toBeNull();
    expect(store.listRevisions(page.id)).toHaveLength(0);
  });
});

describe("CodexStore links + search", () => {
  it("parses wiki-links across both layers with entity prefixes", () => {
    const links = parseWikiLinks("See [[Bree]] and [[actor:Gandalf]] and [[Keep#Cellar]]", "gm");
    expect(links).toEqual([
      { sourcePageId: "", layer: "gm", targetKind: "page", targetRef: "bree", section: null },
      { sourcePageId: "", layer: "gm", targetKind: "actor", targetRef: "Gandalf", section: null },
      { sourcePageId: "", layer: "gm", targetKind: "page", targetRef: "keep", section: "Cellar" }
    ]);
  });

  it("builds backlinks keyed by title and tags the source layer", () => {
    const bree = store.createPage({ title: "Bree" });
    store.createPage({ title: "Road", playerBody: "leads to [[Bree]]", revealedToPlayers: true });
    store.createPage({ title: "Cult", gmBody: "meets near [[Bree]]" }); // gm-layer, unrevealed
    const backlinks = store.backlinksToPage(bree.id);
    expect(backlinks).toHaveLength(2);
    expect(backlinks.find((b) => b.sourceTitle === "Road")).toMatchObject({ layer: "player", sourceRevealed: true });
    expect(backlinks.find((b) => b.sourceTitle === "Cult")).toMatchObject({ layer: "gm", sourceRevealed: false });
    expect(pageLinkKey("  Bree  ")).toBe("bree");
  });

  it("full-text search hits titles and bodies", () => {
    store.createPage({ title: "Bree", playerBody: "a crossroads town", gmBody: "" });
    expect(store.searchPages("gm", "crossroads")).toHaveLength(1);
    expect(store.searchPages("gm", "bree")).toHaveLength(1);
    expect(store.searchPages("gm", "nonexistent")).toHaveLength(0);
  });
});

describe("CodexStore viewer safety (the leak matrix)", () => {
  it("player projection omits gmBody and hides unrevealed pages", () => {
    const secret = store.createPage({ title: "Bree", playerBody: "A town.", gmBody: "SECRET CULT" });
    // Unrevealed → player sees nothing.
    expect(projectPlayerPage(secret)).toBeNull();
    expect(projectPlayerPageSummary(secret)).toBeNull();

    const revealed = store.setPageRevealed(secret.id, true);
    const projected = projectPlayerPage(revealed)!;
    expect(projected.body).toBe("A town.");
    expect(Object.keys(projected)).not.toContain("gmBody");
    expect(JSON.stringify(projected)).not.toContain("SECRET CULT");
  });

  it("player full-text search can never surface gmBody text", () => {
    store.createPage({ title: "Bree", playerBody: "A crossroads town.", gmBody: "The cult of the black hand meets here.", revealedToPlayers: true });
    // "cult" lives only in gmBody → player index must not match it.
    expect(store.searchPages("player", "cult")).toHaveLength(0);
    expect(store.searchPages("gm", "cult")).toHaveLength(1);
    // Player-facing text is searchable.
    expect(store.searchPages("player", "crossroads")).toHaveLength(1);
  });

  it("player search excludes unrevealed pages even when their player body matches", () => {
    store.createPage({ title: "Hidden cove", playerBody: "a secret smugglers cove", revealedToPlayers: false });
    expect(store.searchPages("player", "smugglers")).toHaveLength(0); // unrevealed → never in a player's results
    expect(store.searchPages("gm", "smugglers")).toHaveLength(1);     // the GM still finds it
  });

  it("player backlinks exclude gm-layer references and unrevealed sources", () => {
    const bree = store.createPage({ title: "Bree" });
    store.createPage({ title: "Road", playerBody: "to [[Bree]]", revealedToPlayers: true });   // visible
    store.createPage({ title: "Cult", gmBody: "near [[Bree]]" });                                // gm-layer secret
    store.createPage({ title: "Draft", playerBody: "mentions [[Bree]]", revealedToPlayers: false }); // player-layer but unrevealed
    const playerBacklinks = projectPlayerBacklinks(store.backlinksToPage(bree.id));
    expect(playerBacklinks.map((b) => b.sourceTitle)).toEqual(["Road"]);
  });
});

const ASSET = "11111111-1111-4111-8111-111111111111";

describe("CodexStore maps + markers", () => {
  it("builds a map tree and rejects self-parenting and cycles", () => {
    const world = store.createMap({ assetId: ASSET, name: "Faerûn", kind: "world" });
    const region = store.createMap({ assetId: ASSET, name: "Sword Coast", kind: "regional", parentMapId: world.id });
    expect(region.parentMapId).toBe(world.id);
    expect(() => store.setMapParent(world.id, world.id)).toThrow(/own parent/);
    expect(() => store.setMapParent(world.id, region.id)).toThrow(/loop/);
    expect(store.listMaps()).toHaveLength(2);
  });

  it("deletes a map: cascades its markers, orphans children, and nulls drill-down links", () => {
    const world = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const city = store.createMap({ assetId: ASSET, name: "City", kind: "regional", parentMapId: world.id });
    const drill = store.createMarker(world.id, { x: 10, y: 20, iconId: "castle", iconColor: "#ff2e9a", subMapId: city.id });
    store.createMarker(city.id, { x: 5, y: 5, iconId: "town", iconColor: "#2de2ff" });
    store.deleteMap(city.id);
    expect(store.getMap(city.id)).toBeNull();
    expect(store.getMap(world.id)).not.toBeNull();               // parent survives
    expect(store.getMarker(drill.id)?.subMapId).toBeNull();       // drill-down link nulled, marker survives
    expect(store.listMarkers(city.id)).toHaveLength(0);           // city's own markers cascade-deleted
  });

  it("creates, updates, moves, reveals, and deletes markers, rejecting malformed input", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const marker = store.createMarker(map.id, { x: 100, y: 200, iconId: "town", iconColor: "#a45cff", label: "Bree" });
    expect(marker).toMatchObject({ x: 100, y: 200, iconId: "town", label: "Bree", revealedToPlayers: false });
    expect(store.moveMarker(marker.id, 150, 250)).toMatchObject({ x: 150, y: 250 });
    expect(store.updateMarker(marker.id, { label: "Bree-under-Hill", iconColor: "#2de2ff" })).toMatchObject({ label: "Bree-under-Hill", iconColor: "#2de2ff" });
    expect(store.setMarkerRevealed(marker.id, true).revealedToPlayers).toBe(true);
    store.deleteMarker(marker.id);
    expect(store.getMarker(marker.id)).toBeNull();
    expect(() => store.createMarker(map.id, { x: -5, y: 0, iconId: "town", iconColor: "#a45cff" })).toThrow(/within the map/);
    expect(() => store.createMarker(map.id, { x: 0, y: 0, iconId: "Bad Icon", iconColor: "#a45cff" })).toThrow(/slug/);
    expect(() => store.createMarker(map.id, { x: 0, y: 0, iconId: "town", iconColor: "red" })).toThrow(/hex/);
  });

  it("markers link to MANY pages and scenes; markerForScene matches any; deletePage drops the page from every marker", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const keep = store.createPage({ title: "Keep" });
    const cellar = store.createPage({ title: "Cellar" });
    const scene1 = "11111111-1111-4111-8111-111111111111";
    const scene2 = "22222222-2222-4222-8222-222222222222";
    const marker = store.createMarker(map.id, { x: 10, y: 10, iconId: "castle", iconColor: "#ff2e9a", pageIds: [keep.id, cellar.id], sceneIds: [scene1, scene2] });
    expect(marker.pageIds).toEqual([keep.id, cellar.id]);
    expect(marker.sceneIds).toEqual([scene1, scene2]);
    expect(store.markerForScene(scene2)?.id).toBe(marker.id);                 // found by any linked scene
    expect(store.updateMarker(marker.id, { pageIds: [cellar.id] }).pageIds).toEqual([cellar.id]); // remove one
    store.deletePage(cellar.id);
    expect(store.getMarker(marker.id)?.pageIds).toEqual([]);                  // deleted page dropped, no dangling
  });
});

describe("CodexStore map/marker viewer safety", () => {
  it("player map projection hides unrevealed maps", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    expect(projectPlayerMap(map, { parentRevealed: false })).toBeNull();
    expect(projectPlayerMap(store.setMapRevealed(map.id, true), { parentRevealed: false })).toMatchObject({ name: "World" });
  });

  it("a player marker shows ONLY the linked pages that are themselves revealed, and never a scene id", () => {
    const shown = store.createPage({ title: "Shown" });
    const secret = store.createPage({ title: "Secret" });
    store.setPageRevealed(shown.id, true);
    const map = store.createMap({ assetId: ASSET, name: "M", kind: "world" });
    const marker = store.createMarker(map.id, { x: 5, y: 5, iconId: "pin", iconColor: "#2de2ff", revealedToPlayers: true,
      pageIds: [shown.id, secret.id], sceneIds: ["33333333-3333-4333-8333-333333333333"] });
    const revealedPageIds = new Set(marker.pageIds.filter((id) => store.getPage(id)?.revealedToPlayers));
    const projected = projectPlayerMarker(marker, { revealedPageIds, subMapRevealed: false });
    expect(projected?.pageIds).toEqual([shown.id]);                        // only the revealed page survives
    expect(JSON.stringify(projected)).not.toContain(secret.id);            // the secret page id never leaks
    expect(JSON.stringify(projected)).not.toContain("3333");               // scene links are GM-only
  });

  it("a revealed child map never leaks the id of an unrevealed parent", () => {
    const world = store.createMap({ assetId: ASSET, name: "World", kind: "world" }); // secret by default
    const region = store.setMapRevealed(store.createMap({ assetId: ASSET, name: "Region", kind: "regional", parentMapId: world.id }).id, true);
    // The parent (world) is not revealed → its id must be stripped from the child's player projection.
    expect(projectPlayerMap(region, { parentRevealed: false })!.parentMapId).toBeNull();
    // Once the parent is revealed too, the link may survive.
    expect(projectPlayerMap(region, { parentRevealed: true })!.parentMapId).toBe(world.id);
  });

  it("player marker projection strips scene/actor links and hides links to unrevealed pages", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const secret = store.createPage({ title: "Secret lair" });
    const marker = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff", pageIds: [secret.id], sceneIds: [ASSET], actorId: ASSET, revealedToPlayers: true });
    expect(projectGmMarker(marker)).toMatchObject({ sceneIds: [ASSET], actorId: ASSET, pageIds: [secret.id] });
    const stripped = projectPlayerMarker(marker, { revealedPageIds: new Set<string>(), subMapRevealed: false })!;
    expect(stripped).not.toHaveProperty("sceneIds");
    expect(stripped).not.toHaveProperty("actorId");
    expect(stripped.pageIds).toEqual([]);                          // secret page not revealed → link hidden
    expect(projectPlayerMarker(marker, { revealedPageIds: new Set([secret.id]), subMapRevealed: false })!.pageIds).toEqual([secret.id]);
  });

  it("an unrevealed marker is null for players regardless of link state", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const marker = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff" });
    expect(projectPlayerMarker(marker, { revealedPageIds: new Set<string>(), subMapRevealed: true })).toBeNull();
  });

  it("a scene may sit on several markers; markerForScene resolves to one of them (none is cleared on relink)", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const scene = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff", sceneIds: [scene] });
    const second = store.createMarker(map.id, { x: 2, y: 2, iconId: "cave", iconColor: "#2de2ff" });
    store.updateMarker(second.id, { sceneIds: [scene] });
    expect(store.getMarker(first.id)!.sceneIds).toContain(scene);   // first keeps the link (no clearing)
    expect(store.getMarker(second.id)!.sceneIds).toContain(scene);
    expect([first.id, second.id]).toContain(store.markerForScene(scene)?.id);
  });
});

describe("CodexStore entities + relationships", () => {
  it("stores an entity type and structured fields, dropping empties, rejecting bad types", () => {
    const page = store.createPage({ title: "Strahd", entityType: "character", fields: { race: "Vampire", age: "400", title: "" } });
    expect(page.entityType).toBe("character");
    expect(page.fields).toEqual({ race: "Vampire", age: "400" }); // the empty "title" is dropped
    expect(store.updatePage(page.id, { fields: { race: "Dhampir" } }, page.rev, "gm").fields).toEqual({ race: "Dhampir" });
    expect(() => store.createPage({ title: "Bad", entityType: "dragon" as never })).toThrow(/entity type/i);
    // A default page is a plain "note" with no fields, and history round-trips the type.
    const plain = store.createPage({ title: "Note" });
    expect(plain.entityType).toBe("note");
    const rev1 = store.listRevisions(page.id).find((r) => r.rev === 1)!;
    expect(store.restoreRevision(page.id, rev1.id, "gm").entityType).toBe("character");
  });

  it("seals secret-keyed fields into gmFields (write, restore) and preserves them through export", () => {
    // A write that puts the secret `goals` key in the PUBLIC fields map is sealed server-side.
    const page = store.createPage({ title: "Vex", entityType: "character", fields: { race: "Human", goals: "poison the king" } });
    expect(page.fields).toEqual({ race: "Human" });          // goals moved out of the player-facing map
    expect(page.gmFields).toEqual({ goals: "poison the king" });
    // Export carries gmFields (the SELECT includes the column - regression guard for the backup bug).
    const exported = store.exportBundle().pages.find((candidate) => candidate.id === page.id)!;
    expect(exported.gmFields).toEqual({ goals: "poison the king" });
    // Restoring a revision re-seals too (the revision's fields never re-leak goals).
    const rev = store.listRevisions(page.id).find((entry) => entry.rev === 1)!;
    expect(store.restoreRevision(page.id, rev.id, "gm").fields.goals).toBeUndefined();
  });

  /**
   * M9. The export bundle is a GM's only copy of their prep, and `prepBody` is the one thing in the codex
   * that exists nowhere else — not on a page, not in the journal, not recoverable from a revision. A
   * record type that ships without joining the backup loses data silently, which is exactly the class of
   * bug the gmFields case above is a regression guard for. Found by adversarial review, not by a test.
   */
  it("carries sessions and the active pointer into the backup bundle", () => {
    const played = store.createSession({ sessionNumber: 1, prepBody: "Ambush at the bridge.", recapBody: "They crossed." });
    const next = store.createSession({ sessionNumber: 2, prepBody: "The vault opens for a sacrifice." });
    store.setActiveSession(next.id);

    const bundle = store.exportBundle();
    expect(bundle.sessions.map((session) => session.sessionNumber)).toEqual([1, 2]);
    expect(bundle.activeSessionId).toBe(next.id);
    // The GM layer specifically — an export that carried the recap but dropped the prep would look
    // healthy in a directory listing and be worthless on restore.
    expect(bundle.sessions.find((session) => session.id === played.id)!.prepBody).toBe("Ambush at the bridge.");
    expect(bundle.sessions.find((session) => session.id === next.id)!.prepBody).toBe("The vault opens for a sacrifice.");
  });

  it("migration v8 backfills a legacy marker's single page/scene id into one-element arrays", () => {
    // A DB written before markers linked to MANY pages/scenes: single page_id/scene_id columns. The M1
    // review flagged that v8 had never been run against legacy rows.
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE codex_markers (id TEXT PRIMARY KEY, page_id TEXT, scene_id TEXT)");
    const insert = database.prepare("INSERT INTO codex_markers (id, page_id, scene_id) VALUES (?, ?, ?)");
    insert.run("both", "page-1", "scene-1");
    insert.run("page-only", "page-2", null);
    insert.run("neither", null, null);
    const v8 = MIGRATIONS.find((migration) => migration.version === 8);
    expect(v8).toBeDefined();
    database.exec(v8!.sql);
    const rowOf = (id: string) => database.prepare("SELECT page_ids_json, scene_ids_json FROM codex_markers WHERE id = ?").get(id) as { page_ids_json: string; scene_ids_json: string };
    expect(JSON.parse(rowOf("both").page_ids_json)).toEqual(["page-1"]);
    expect(JSON.parse(rowOf("both").scene_ids_json)).toEqual(["scene-1"]);
    expect(JSON.parse(rowOf("page-only").page_ids_json)).toEqual(["page-2"]);
    // A null must become an empty array, never [null] - the projection filters by membership.
    expect(JSON.parse(rowOf("page-only").scene_ids_json)).toEqual([]);
    expect(JSON.parse(rowOf("neither").page_ids_json)).toEqual([]);
    expect(JSON.parse(rowOf("neither").scene_ids_json)).toEqual([]);
    database.close();
  });

  it("migration v9 promotes the folder paths implied by existing pages into folder records", () => {
    // Before v9 a folder existed only while a page referenced it. The backfill must capture every
    // distinct real path exactly once, and must not invent a record for null/empty.
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE codex_pages (id TEXT PRIMARY KEY, folder TEXT)");
    const insert = database.prepare("INSERT INTO codex_pages (id, folder) VALUES (?, ?)");
    insert.run("a", "NPCs");
    insert.run("b", "NPCs");            // duplicate path -> one record
    insert.run("c", "NPCs/Villains");
    insert.run("d", null);              // no folder -> no record
    insert.run("e", "");                // empty string -> no record
    const v9 = MIGRATIONS.find((migration) => migration.version === 9);
    expect(v9).toBeDefined();
    database.exec(v9!.sql);
    const paths = (database.prepare("SELECT path FROM codex_folders ORDER BY path").all() as Array<{ path: string }>).map((row) => row.path);
    expect(paths).toEqual(["NPCs", "NPCs/Villains"]);
    database.close();
  });

  it("migration v7 backfills pre-existing secret fields out of the public map (the pillar-1 legacy fix)", () => {
    // Simulate a DB written before the seal existed: `goals` sitting in the public fields_json.
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE codex_pages (id TEXT PRIMARY KEY, fields_json TEXT, gm_fields_json TEXT DEFAULT '{}')");
    database.prepare("INSERT INTO codex_pages (id, fields_json, gm_fields_json) VALUES (?, ?, ?)").run("leaky", JSON.stringify({ race: "Vampire", goals: "usurp the throne" }), "{}");
    database.prepare("INSERT INTO codex_pages (id, fields_json, gm_fields_json) VALUES (?, ?, ?)").run("clean", JSON.stringify({ race: "Human" }), "{}");
    const v7 = MIGRATIONS.find((migration) => migration.version === 7);
    expect(v7).toBeDefined();
    database.exec(v7!.sql);
    const leaky = database.prepare("SELECT fields_json, gm_fields_json FROM codex_pages WHERE id = 'leaky'").get() as { fields_json: string; gm_fields_json: string };
    expect(JSON.parse(leaky.fields_json)).toEqual({ race: "Vampire" });               // goals removed from the player-facing map
    expect(JSON.parse(leaky.gm_fields_json)).toEqual({ goals: "usurp the throne" });   // moved into the GM-only map
    const clean = database.prepare("SELECT fields_json FROM codex_pages WHERE id = 'clean'").get() as { fields_json: string };
    expect(JSON.parse(clean.fields_json)).toEqual({ race: "Human" });                  // rows without goals untouched
    database.close();
  });

  it("creates typed relationships, resolves both directions, dedupes, and cascades on page delete", () => {
    const strahd = store.createPage({ title: "Strahd", entityType: "character" });
    const barovia = store.createPage({ title: "Barovia", entityType: "location", revealedToPlayers: true });
    const rel = store.createRelationship(strahd.id, barovia.id, "Rules");
    expect(rel).toMatchObject({ fromPageId: strahd.id, toPageId: barovia.id, type: "rules" }); // slugged
    expect(store.createRelationship(strahd.id, barovia.id, "rules").id).toBe(rel.id); // idempotent
    expect(() => store.createRelationship(strahd.id, strahd.id, "rules")).toThrow(/itself/);

    const fromStrahd = store.listRelationshipsFor(strahd.id);
    expect(fromStrahd).toEqual([{ id: rel.id, type: "rules", direction: "out", otherPageId: barovia.id, otherTitle: "Barovia", otherType: "location", otherRevealed: true }]);
    expect(store.listRelationshipsFor(barovia.id)[0]).toMatchObject({ direction: "in", otherPageId: strahd.id, otherTitle: "Strahd", otherRevealed: false });

    store.deletePage(strahd.id); // cascades the edge
    expect(store.listRelationshipsFor(barovia.id)).toHaveLength(0);
  });

  it("player relationship projection hides edges to unrevealed entities", () => {
    const town = store.createPage({ title: "Town", revealedToPlayers: true });
    const secret = store.createPage({ title: "Secret cult" });
    const temple = store.createPage({ title: "Temple", revealedToPlayers: true });
    store.createRelationship(town.id, secret.id, "near");
    store.createRelationship(town.id, temple.id, "near");
    const views = store.listRelationshipsFor(town.id);
    expect(projectGmRelationships(views)).toHaveLength(2);
    const playerViews = projectPlayerRelationships(views);
    expect(playerViews).toHaveLength(1);
    expect(playerViews[0].otherTitle).toBe("Temple");
  });
});

describe("CodexStore journal", () => {
  it("creates, updates, reveals, and orders a timeline; combat entries auto-tag their kind", () => {
    const page = store.createPage({ title: "Bree" });
    const first = store.createEntry({ playerText: "We arrived in Bree.", gmText: "The spy watched them.", sessionNumber: 1, attachPageId: page.id });
    expect(first).toMatchObject({ kind: "note", revealedToPlayers: false, sessionNumber: 1 });
    store.createEntry({ playerText: "We left at dawn.", sessionNumber: 2 });
    const combat = store.appendCombatEntry({ sourceEncounterId: 7, playerText: "A brawl broke out.", attachPageId: page.id });
    expect(combat.kind).toBe("combat");

    const timeline = store.listTimeline();
    expect(timeline).toHaveLength(3);
    expect(timeline[0].sessionNumber).toBe(1); // session order

    expect(store.listEntriesFor({ pageId: page.id })).toHaveLength(2); // the arrival note + the brawl

    const updated = store.updateEntry(first.id, { playerText: "We rode into Bree at dusk." });
    expect(updated.playerText).toBe("We rode into Bree at dusk.");
    // M9's create/update ASYMMETRY, pinned. `createEntry` auto-files an entry under the active session;
    // `updateEntry` must not - an omitted field means unchanged, so editing a typo cannot re-file the
    // entry under whatever session happens to be running now. Unpinned, a one-word change here silently
    // rewrote every edited entry's session on save and all 887 tests still passed.
    expect(updated.sessionNumber).toBe(1);
    expect(store.setEntryRevealed(first.id, true).revealedToPlayers).toBe(true);
    store.deleteEntry(combat.id);
    expect(store.listTimeline()).toHaveLength(2);
  });

  it("player journal projection hides unrevealed entries and strips gmText", () => {
    const secret = store.createEntry({ playerText: "The gate stood open.", gmText: "It was a trap set by the cult." });
    expect(projectPlayerJournalEntry(secret, playerSessionNumbers())).toBeNull();
    const shown = store.setEntryRevealed(secret.id, true);
    const projected = projectPlayerJournalEntry(shown, playerSessionNumbers())!;
    expect(projected.text).toBe("The gate stood open.");
    expect(Object.keys(projected)).not.toContain("gmText");
    expect(JSON.stringify(projected)).not.toContain("cult");
  });

  it("deleting a page, marker, or map releases journal pins instead of leaving them dangling", () => {
    const page = store.createPage({ title: "Bree" });
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const marker = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff" });
    const pinnedToPage = store.createEntry({ playerText: "at Bree", attachPageId: page.id });
    const pinnedToMarker = store.createEntry({ playerText: "at the pin", attachMarkerId: marker.id });
    store.deletePage(page.id);
    expect(store.getEntry(pinnedToPage.id)!.attachPageId).toBeNull();
    store.deleteMap(map.id); // cascades the marker; its journal pin must be released first
    expect(store.getEntry(pinnedToMarker.id)!.attachMarkerId).toBeNull();
  });
});

describe("CodexStore calendar + timeline", () => {
  it("dates entries by the world calendar and orders the timeline chronologically", () => {
    expect(store.getCalendar().months).toHaveLength(12); // default: 12 x 30 = 360 days/year
    const later = store.createEntry({ playerText: "The siege ends.", inWorldDate: { year: 1492, month: 5, day: 10 } });
    const earlier = store.createEntry({ playerText: "The siege begins.", inWorldDate: { year: 1491, month: 0, day: 1 } });
    expect(earlier.calendarInstant!).toBeLessThan(later.calendarInstant!);
    expect(later.inWorldLabel).toContain("1492");
    const dated = store.listTimeline().filter((entry) => entry.calendarInstant !== null);
    expect(dated.map((entry) => entry.playerText)).toEqual(["The siege begins.", "The siege ends."]); // earlier first, though created second
  });

  it("a custom calendar changes days-per-year and the formatted label", () => {
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    const entry = store.createEntry({ playerText: "A new era.", inWorldDate: { year: 1, month: 1, day: 5 } });
    expect(entry.inWorldLabel).toBe("Fall 5, 1 AE");
    expect(entry.calendarInstant).toBe(1 * 200 + 100 + 4); // year*perYear + month offset + (day-1)
    expect(store.dateForInstant(entry.calendarInstant!)).toEqual({ year: 1, month: 1, day: 5 }); // round-trips
    expect(() => store.setCalendar({ yearName: "", months: [], weekdays: [] })).toThrow(/1 to 24 months/);
  });

  it("dates an `event` page through the SAME contract a journal entry uses (CT-11)", () => {
    const page = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1492, month: 1, day: 15 } });
    expect(page.inWorldDate).toEqual({ year: 1492, month: 1, day: 15 }); // the RAW date is stored verbatim
    expect(page.inWorldLabel).toContain("1492");                          // ...and the label is derived from it
    // The instant is the SAME function's answer, not a parallel one: an entry on the same day agrees exactly.
    const entry = store.createEntry({ playerText: "the sky tore open", inWorldDate: { year: 1492, month: 1, day: 15 } });
    expect(page.calendarInstant).toBe(entry.calendarInstant);
    expect(page.inWorldLabel).toBe(entry.inWorldLabel);
  });

  it("puts a dated event page on the chronicle in the right in-world year, interleaved with entries (CT-11)", () => {
    const early = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1400, month: 0, day: 1 } });
    const event = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1450, month: 0, day: 1 } });
    const late = store.createEntry({ playerText: "The war.", inWorldDate: { year: 1500, month: 0, day: 1 } });
    // Created in chronological order here on purpose: the assertion below is about DATES placing records,
    // so it also checks a later-created record cannot simply ride its insertion order into the middle.
    const undated = store.createEntry({ playerText: "Someday." });

    expect(store.listChronicle().map((record) => (record.kind === "entry" ? record.entry.id : record.page.id)))
      .toEqual([early.id, event.id, late.id, undated.id]);
    expect(store.dateForInstant(event.calendarInstant!)).toEqual({ year: 1450, month: 0, day: 1 });
  });

  it("keeps an UNDATED event page and a dated non-event page off the chronicle (CT-11)", () => {
    store.createPage({ title: "A vague legend", entityType: "event" });
    const note = store.createPage({ title: "Barovia", entityType: "location", inWorldDate: { year: 1492, month: 0, day: 1 } });
    expect(store.listChronicle()).toHaveLength(0);
    // The date is not DISCARDED, only unlisted: promoting the page to an event later brings it back with
    // its date intact, which is what makes a type switch lossless.
    expect(store.getPage(note.id)!.inWorldDate).toEqual({ year: 1492, month: 0, day: 1 });
    store.updatePage(note.id, { entityType: "event" }, undefined, "test");
    expect(store.listChronicle().map((record) => record.kind)).toEqual(["event"]);
  });

  it("leaves a page's date alone when a write does not mention it, and clears it on an explicit null", () => {
    // The page editor PATCHes the whole draft on every autosave. If an omitted date meant "clear", editing
    // an event's body from any surface that does not know about dates would silently un-date it.
    const page = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1492, month: 1, day: 15 } });
    const bodyEdited = store.updatePage(page.id, { playerBody: "The sky tore open." }, undefined, "test");
    expect(bodyEdited.inWorldDate).toEqual({ year: 1492, month: 1, day: 15 });
    const cleared = store.updatePage(page.id, { inWorldDate: null }, undefined, "test");
    expect(cleared.inWorldDate).toBeNull();
    expect(cleared.calendarInstant).toBeNull();
    expect(cleared.inWorldLabel).toBeNull();
    expect(store.listChronicle()).toHaveLength(0);
  });

  it("reflows already-dated entries when the calendar changes, without corrupting them", () => {
    const early = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1, month: 0, day: 1 } });
    const late = store.createEntry({ playerText: "The war.", inWorldDate: { year: 2, month: 0, day: 1 } });
    expect(late.calendarInstant! - early.calendarInstant!).toBe(360); // default 12x30: one year apart
    // Swap in a shorter year: 2 x 100 = 200 days.
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    const reflowed = store.listTimeline().filter((entry) => entry.calendarInstant !== null);
    const earlyNow = reflowed.find((entry) => entry.id === early.id)!;
    const lateNow = reflowed.find((entry) => entry.id === late.id)!;
    expect(lateNow.calendarInstant! - earlyNow.calendarInstant!).toBe(200); // re-placed on the new year length
    expect(earlyNow.inWorldLabel).toBe("Rise 1, 1 AE");                     // label recomputed from the RAW date
    expect(earlyNow.inWorldDate).toEqual({ year: 1, month: 0, day: 1 });    // raw date preserved verbatim
    expect(reflowed[0].id).toBe(early.id);                                  // chronological order intact
  });

  /**
   * K3, the risk M8 is named against: `setCalendar` transactionally recomputes EVERY dated record, and
   * events joined that set. Three separate properties, because passing one of them proves little:
   *   1. Events reflow AT ALL (a reflow that skipped `codex_pages` leaves an event on the old year length).
   *   2. Events and entries reflow TOGETHER, against the same calendar — checked by their interleaved
   *      chronicle order surviving, which is the thing a half-reflow actually breaks.
   *   3. Nothing is LOST: every raw date is byte-identical afterwards, because the reflow only ever reads
   *      the raw date and writes the two derived columns.
   */
  it("reflows events and entries TOGETHER when the calendar changes, losing no raw date (K3)", () => {
    const entryEarly = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1, month: 0, day: 1 } });
    const eventMid = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1, month: 1, day: 10 } });
    const entryLate = store.createEntry({ playerText: "The war.", inWorldDate: { year: 2, month: 0, day: 1 } });
    const eventLast = store.createPage({ title: "The Peace", entityType: "event", inWorldDate: { year: 3, month: 0, day: 5 } });
    const orderBefore = store.listChronicle().map((record) => (record.kind === "entry" ? record.entry.id : record.page.id));
    expect(orderBefore).toEqual([entryEarly.id, eventMid.id, entryLate.id, eventLast.id]);

    // A calendar with a different month COUNT and different month LENGTHS: every instant must move, and
    // the month index 1 now means a month of a different length, so a stale label is visible too.
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });

    // 1 + 2: still interleaved in the same order, and every instant now agrees with the NEW calendar.
    const after = store.listChronicle();
    expect(after.map((record) => (record.kind === "entry" ? record.entry.id : record.page.id))).toEqual(orderBefore);
    const eventNow = store.getPage(eventMid.id)!;
    const entryOnTheSameDay = store.createEntry({ playerText: "same day", inWorldDate: { year: 1, month: 1, day: 10 } });
    expect(eventNow.calendarInstant).toBe(entryOnTheSameDay.calendarInstant); // reflowed page == freshly dated entry
    expect(eventNow.inWorldLabel).toBe("Fall 10, 1 AE");                      // label recomputed, not stale
    // Both instants stated from the new calendar's own arithmetic (year*200 + month offset + day-1),
    // so this fails if either record kept a value computed against the old 12x30 year.
    expect(eventNow.calendarInstant).toBe(1 * 200 + 100 + 9);
    expect(store.getPage(eventLast.id)!.calendarInstant).toBe(3 * 200 + 0 + 4);

    // 3: every raw date survives verbatim - the reflow reads them and never writes them.
    expect(store.getPage(eventMid.id)!.inWorldDate).toEqual({ year: 1, month: 1, day: 10 });
    expect(store.getPage(eventLast.id)!.inWorldDate).toEqual({ year: 3, month: 0, day: 5 });
    expect(store.getEntry(entryEarly.id)!.inWorldDate).toEqual({ year: 1, month: 0, day: 1 });
    expect(store.getEntry(entryLate.id)!.inWorldDate).toEqual({ year: 2, month: 0, day: 1 });

    // ...and the reflow is idempotent: re-applying the SAME calendar changes nothing at all.
    const snapshot = store.listChronicle().map((record) => JSON.stringify(record));
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    expect(store.listChronicle().map((record) => JSON.stringify(record))).toEqual(snapshot);
  });
});

/**
 * The chronicle's store layer, ON ITS OWN — below any projection.
 *
 * Why these exist, in the same spirit as the search tests at the top of this file. `listChronicle()` is
 * deliberately UNGATED and `projectPlayerChronicleRecord` is the only gate (K1). That is the right design,
 * but only while it stays true: the moment a filter creeps into the store, an HTTP test can pass because
 * the store quietly caught what a broken projection let through. These assert the ungatedness directly,
 * so a later "hardening" of the store fails here instead of silently blinding the tests that matter.
 */
describe("CodexStore chronicle — deliberately ungated (CT-11)", () => {
  it("returns UNREVEALED entries and UNREVEALED event pages to the store's caller", () => {
    const entry = store.createEntry({ playerText: "secret", inWorldDate: { year: 1, month: 0, day: 1 } });
    const page = store.createPage({ title: "Secret event", entityType: "event", gmBody: "only the GM knows", inWorldDate: { year: 1, month: 0, day: 2 } });
    expect(entry.revealedToPlayers).toBe(false);
    expect(page.revealedToPlayers).toBe(false);
    const ids = store.listChronicle().map((record) => (record.kind === "entry" ? record.entry.id : record.page.id));
    expect(ids).toEqual([entry.id, page.id]);
  });

  it("returns the GM half of both record types raw — the projection, not the store, is what strips it", () => {
    store.createEntry({ playerText: "seen", gmText: "unseen", inWorldDate: { year: 1, month: 0, day: 1 } });
    store.createPage({ title: "Event", entityType: "event", playerBody: "seen", gmBody: "unseen", inWorldDate: { year: 1, month: 0, day: 2 } });
    const raw = store.listChronicle();
    expect(raw[0].kind === "entry" && raw[0].entry.gmText).toBe("unseen");
    expect(raw[1].kind === "event" && raw[1].page.gmBody).toBe("unseen");
  });
});

/**
 * The chronicle's PROJECTION layer, on its own — the single gate, exercised directly rather than through
 * the router. An HTTP test proves the pipeline works; it never proves which layer did the work. Since the
 * store above is deliberately ungated, this is the layer that has to be right, so it is tested here at
 * point-blank range, one property per test.
 */
describe("Codex chronicle — the projection layer, on its own (CT-11, A-8)", () => {
  const playerChronicle = () => store.listChronicle().map((record) => projectPlayerChronicleRecord(record, playerSessionNumbers())).filter((record) => record !== null);

  it("refuses an UNREVEALED event page", () => {
    const page = store.createPage({ title: "The Sundering", entityType: "event", playerBody: "The sky tore open.", inWorldDate: { year: 1492, month: 0, day: 1 } });
    expect(store.getPage(page.id)!.revealedToPlayers).toBe(false);
    expect(projectPlayerChronicleRecord({ kind: "event", page: store.getPage(page.id)! }, playerSessionNumbers())).toBeNull();
    // Revealing it lets it through, so the null above is the reveal gate and not a broken projection.
    store.setPageRevealed(page.id, true);
    expect(projectPlayerChronicleRecord({ kind: "event", page: store.getPage(page.id)! }, playerSessionNumbers())).not.toBeNull();
  });

  it("refuses an UNREVEALED journal entry", () => {
    const entry = store.createEntry({ playerText: "The vistani warned us", inWorldDate: { year: 1492, month: 0, day: 1 } });
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }, playerSessionNumbers())).toBeNull();
    store.setEntryRevealed(entry.id, true);
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }, playerSessionNumbers())).not.toBeNull();
  });

  it("strips GM-only content from a REVEALED event page, and emits exactly the allow-listed keys", () => {
    const page = store.createPage({
      title: "The Sundering", entityType: "event", revealedToPlayers: true,
      playerBody: "The sky tore open.", gmBody: "Strahd engineered it.",
      fields: { where: "Barovia" }, gmFields: { goals: "conceal the cause" },
      tags: ["cataclysm"], inWorldDate: { year: 1492, month: 0, day: 1 }
    });
    const projected = projectPlayerChronicleRecord({ kind: "event", page: store.getPage(page.id)! }, playerSessionNumbers())!;
    // The EXACT key set, not a search of the payload for a secret string: this fails if any new field is
    // ever added to the player projection, not merely if this one leaks.
    //
    // M11 added exactly two, both required by the contract's §3.3: `fired` (a revealed deadline the party
    // has already reached must READ as passed) and `payload` (a downtime's who/activity/days, and NEVER
    // `applied`, which is GM workflow state). This list is the gate on that pair staying a pair - the next
    // key to appear here has to be argued for, not merely compiled.
    expect(Object.keys(projected).sort()).toEqual(["createdAt", "fired", "id", "inWorldLabel", "kind", "payload", "realDate", "sessionNumber", "tags", "text", "title"]);
    expect(projected.text).toBe("The sky tore open.");
    expect(JSON.stringify(projected)).not.toContain("Strahd engineered it.");
    expect(JSON.stringify(projected)).not.toContain("conceal the cause");
    // The GM's own row carries both halves - so the assertions above are the projection working, not an
    // event page that happened to have no GM content to leak.
    const gmRow = projectGmChronicleRecord({ kind: "event", page: store.getPage(page.id)! });
    expect(gmRow.gmText).toContain("Strahd engineered it.");
    expect(gmRow.revealedToPlayers).toBe(true);
  });

  it("never hands a player the replay linkage of a revealed combat entry (K2)", () => {
    const entry = store.appendCombatEntry({ sourceEncounterId: 42, playerText: "A battle was fought here." });
    store.setEntryRevealed(entry.id, true);
    const projected = projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }, playerSessionNumbers())!;
    expect(projected.kind).toBe("combat");
    expect(projected).not.toHaveProperty("sourceEncounterId");
  });

  it("filters a mixed chronicle to exactly the revealed half of BOTH kinds", () => {
    const shownEntry = store.createEntry({ playerText: "seen", revealedToPlayers: true, inWorldDate: { year: 1, month: 0, day: 1 } });
    store.createEntry({ playerText: "hidden", inWorldDate: { year: 1, month: 0, day: 2 } });
    const shownEvent = store.createPage({ title: "Shown", entityType: "event", revealedToPlayers: true, inWorldDate: { year: 1, month: 0, day: 3 } });
    store.createPage({ title: "Hidden", entityType: "event", inWorldDate: { year: 1, month: 0, day: 4 } });
    expect(store.listChronicle()).toHaveLength(4);                       // the store hands over all four...
    expect(playerChronicle().map((record) => record.id)).toEqual([shownEntry.id, shownEvent.id]); // ...the gate keeps two
  });
});

describe("CodexStore media visibility (page images)", () => {
  const banner = "22222222-2222-4222-8222-222222222222";
  const inline = "33333333-3333-4333-8333-333333333333";
  const gmOnly = "44444444-4444-4444-8444-444444444444";
  it("exposes page media to players only when the page is revealed and the reference is player-facing", () => {
    const page = store.createPage({ title: "Bree", bannerAssetId: banner, playerBody: `See ![m](codex-asset:${inline})`, gmBody: `secret ![s](codex-asset:${gmOnly})` });
    expect(store.isPageAssetVisibleToPlayers(banner)).toBe(false); // page not revealed yet
    store.setPageRevealed(page.id, true);
    expect(store.isPageAssetVisibleToPlayers(banner)).toBe(true);   // banner of a revealed page
    expect(store.isPageAssetVisibleToPlayers(inline)).toBe(true);   // inline in the revealed player body
    expect(store.isPageAssetVisibleToPlayers(gmOnly)).toBe(false);  // referenced only in gmBody → stays hidden
  });
});

/**
 * CI-4. `GET /codex/pages/:id/markers` gates a player TWICE: the router refuses an unrevealed page, and
 * `projectPlayerPageMarker` refuses individual pins. An HTTP test proves the pipeline is safe; it cannot
 * prove WHICH layer did the work — exactly the blind spot the CI-1 SQL tests above exist for (weakening
 * one layer there left all 787 tests green because the other quietly caught it). These call the store and
 * the projection directly, underneath the router, so the pin gate is verified on its own.
 */
describe("Codex page→marker reverse lookup — the store and projection layers, on their own (CI-4)", () => {
  const context = (marker: ReturnType<CodexStore["getMarker"]>, mapRevealed: boolean, revealedPageIds: string[] = []) =>
    ({ marker: marker!, mapRevealed, revealedPageIds: new Set(revealedPageIds), subMapRevealed: false });

  it("the store's reverse lookup is deliberately UNGATED — one gate, in the projection, or the layers can mask each other", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Amberhold", kind: "regional" }); // secret
    const page = store.createPage({ title: "The Amber Temple" });                                        // secret
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Vaults", pageIds: [page.id] });
    // Raw GM-grade rows, hidden pin on a hidden map included. If this ever starts filtering, the HTTP
    // tests would still pass while the audited projection silently stopped being the thing that decides.
    expect(store.markersForPage(page.id).map((row) => row.id)).toEqual([marker.id]);
    expect(store.markersForPage(page.id)[0].revealedToPlayers).toBe(false);
  });

  it("refuses a REVEALED pin standing on a SECRET map (CD-6), at the projection", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Amberhold", kind: "regional" });
    const page = store.createPage({ title: "The Amber Temple", revealedToPlayers: true });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Vaults", pageIds: [page.id], revealedToPlayers: true });
    expect(store.getMarker(marker.id)!.revealedToPlayers).toBe(true);  // the pin is shown...
    expect(store.getMap(map.id)!.revealedToPlayers).toBe(false);       // ...its map is not
    expect(projectPlayerPageMarker(context(store.getMarker(marker.id), false, [page.id]))).toBeNull();
    // Revealing the map lets it through, so the null above is the map gate and not a broken projection.
    expect(projectPlayerPageMarker(context(store.getMarker(marker.id), true, [page.id]))).not.toBeNull();
  });

  it("refuses a hidden pin even on a revealed map, at the projection", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Vallaki", kind: "regional", revealedToPlayers: true });
    const page = store.createPage({ title: "Ireena", revealedToPlayers: true });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Vistani camp", pageIds: [page.id] });
    expect(projectPlayerPageMarker(context(store.getMarker(marker.id), true, [page.id]))).toBeNull();
  });

  it("passes a visible pin, and hands back exactly what the forward marker projection hands back", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Vallaki", kind: "regional", revealedToPlayers: true });
    const shown = store.createPage({ title: "Ireena", revealedToPlayers: true });
    const secret = store.createPage({ title: "The Heart of Sorrow" });
    const marker = store.createMarker(map.id, {
      x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Burgomaster's house",
      pageIds: [shown.id, secret.id], sceneIds: [crypto.randomUUID()], actorId: crypto.randomUUID(), revealedToPlayers: true
    });
    const row = store.getMarker(marker.id)!;
    const projected = projectPlayerPageMarker(context(row, true, [shown.id]))!;
    // Reached by page id or by map id, a player must receive the identical pin - it projects THROUGH
    // `projectPlayerMarker` rather than reimplementing it, so the two reads cannot drift apart.
    expect(projected).toEqual(projectPlayerMarker(row, { revealedPageIds: new Set([shown.id]), subMapRevealed: false }));
    expect(projected.pageIds).toEqual([shown.id]);   // the still-secret page link is filtered out
    expect(projected).not.toHaveProperty("sceneIds");
    expect(projected).not.toHaveProperty("actorId");
  });
});

/**
 * CI-8. Same reasoning: `GET /codex/links` decides visibility in `projectPlayerLinkEdges`, and the store
 * feeding it is ungated on purpose. These prove each rule at the projection, not only end to end.
 */
describe("Codex whole-graph wiki-link feed — the store and projection layers, on their own (CI-8)", () => {
  const revealedIds = () => new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));

  it("the store's link feed is deliberately UNGATED — both layers, every reveal state", () => {
    const target = store.createPage({ title: "Vallaki" });                                    // secret
    const source = store.createPage({ title: "Barovia", gmBody: "Answers to [[Vallaki]]." }); // secret, GM-layer link
    expect(store.listAllLinks()).toEqual([{ fromPageId: source.id, toPageId: target.id, layer: "gm" }]);
  });

  it("refuses a GM-BODY link even when both endpoints are revealed", () => {
    const target = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const source = store.createPage({ title: "Barovia", gmBody: "Its burgomaster answers to [[Vallaki]].", revealedToPlayers: true });
    const edges = store.listAllLinks();
    expect(projectGmLinkEdges(edges)).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
    expect(projectPlayerLinkEdges(edges, revealedIds())).toEqual([]);
    // Moving the very same link into the player body lets it through — so the miss is the LAYER rule.
    store.updatePage(source.id, { gmBody: "", playerBody: "Ruled from [[Vallaki]]." }, undefined, "test");
    expect(projectPlayerLinkEdges(store.listAllLinks(), revealedIds())).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });

  it("refuses a player-body link when EITHER endpoint is unrevealed, so no dangling edge names a secret page", () => {
    const secret = store.createPage({ title: "The Whispered Name" });
    const source = store.createPage({ title: "Barovia", playerBody: "Watched by [[The Whispered Name]].", revealedToPlayers: true });
    expect(projectPlayerLinkEdges(store.listAllLinks(), revealedIds())).toEqual([]);   // hidden TARGET
    store.setPageRevealed(secret.id, true);
    store.setPageRevealed(source.id, false);
    expect(projectPlayerLinkEdges(store.listAllLinks(), revealedIds())).toEqual([]);   // hidden SOURCE
    store.setPageRevealed(source.id, true);
    expect(projectPlayerLinkEdges(store.listAllLinks(), revealedIds())).toEqual([{ fromPageId: source.id, toPageId: secret.id }]);
  });

  it("resolves targets by title key, and drops self-links and links to titles no page carries", () => {
    const page = store.createPage({ title: "Barovia", playerBody: "See [[  barovia  ]] and [[A Page Never Written]].", revealedToPlayers: true });
    expect(store.listAllLinks()).toEqual([]);   // the self-link normalizes to this very page; the other has no node
    // A link that DOES resolve proves the title-key matching itself works (case/whitespace insensitive).
    const other = store.createPage({ title: "Castle  Ravenloft", revealedToPlayers: true });
    store.updatePage(page.id, { playerBody: "Looms over it: [[castle ravenloft]]." }, undefined, "test");
    expect(store.listAllLinks()).toEqual([{ fromPageId: page.id, toPageId: other.id, layer: "player" }]);
  });

  it("collapses a target linked from BOTH bodies into ONE player-layer edge", () => {
    const target = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const source = store.createPage({ title: "Barovia", playerBody: "Ruled from [[Vallaki#Rule]].", gmBody: "[[Vallaki]] hides the coffin.", revealedToPlayers: true });
    // The player body genuinely carries it, so the edge is player-visible - and the graph draws one line.
    expect(store.listAllLinks()).toEqual([{ fromPageId: source.id, toPageId: target.id, layer: "player" }]);
    expect(projectPlayerLinkEdges(store.listAllLinks(), revealedIds())).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });
});

/**
 * CI-9. "Recently updated" is supposed to answer "what have I been writing?". It answered "what did I
 * touch last?", so a pre-session reveal sweep or one folder tidy-up refilled the whole list with pages
 * nobody had edited, while adding a relationship - a real edit to the page's Connections - left it
 * unchanged. These pin the semantics per write path, with a clock that only moves when the test says so.
 */
describe("CodexStore recency semantics — what counts as an update (CI-9)", () => {
  let recencyDirectory: string;
  let clock: number;
  let recency: CodexStore;

  beforeEach(async () => {
    recencyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-recency-"));
    clock = Date.parse("2026-07-01T00:00:00.000Z");
    recency = new CodexStore(join(recencyDirectory, "vtt.sqlite"), () => clock);
    await recency.initialize();
  });
  afterEach(async () => { recency.close(); await rm(recencyDirectory, { recursive: true, force: true }); });

  /** Move the clock, so a write that DOES stamp `updated_at` is visibly distinguishable from one that does not. */
  const tick = () => { clock += 60_000; };
  const updatedAt = (pageId: string) => recency.getPage(pageId)!.updatedAt;
  const rev = (pageId: string) => recency.getPage(pageId)!.rev;

  it("counts a body edit and a tag edit as updates", () => {
    const page = recency.createPage({ title: "Barovia", playerBody: "A valley." });
    const born = updatedAt(page.id);
    tick();
    recency.updatePage(page.id, { playerBody: "A valley under mist." }, undefined, "test");
    const afterBody = updatedAt(page.id);
    expect(afterBody > born).toBe(true);
    tick();
    recency.updatePage(page.id, { tags: ["domain"] }, undefined, "test");
    expect(updatedAt(page.id) > afterBody).toBe(true);
  });

  it("does NOT count a reveal toggle — but still bumps the codex revision, so clients refetch", () => {
    const page = recency.createPage({ title: "The Amber Temple", playerBody: "Ice and secrets." });
    const born = updatedAt(page.id);
    const revisionBefore = recency.revision;
    tick();
    recency.setPageRevealed(page.id, true);
    expect(updatedAt(page.id)).toBe(born);          // housekeeping: recency untouched
    expect(rev(page.id)).toBe(page.rev);            // and the editor's conflict token is untouched too
    expect(recency.revision).toBeGreaterThan(revisionBefore); // ...but the reveal still propagates
    expect(recency.getPage(page.id)!.revealedToPlayers).toBe(true);
    tick();
    recency.setPageRevealed(page.id, false);
    expect(updatedAt(page.id)).toBe(born);
  });

  it("does NOT count a folder move — but still bumps `rev`, because an open editor's copy really is stale", () => {
    const page = recency.createPage({ title: "Ireena", folder: "NPCs" });
    const born = updatedAt(page.id);
    const bornRev = rev(page.id);
    tick();
    expect(recency.moveFolder("NPCs", "Villagers")).toBe(1);
    expect(recency.getPage(page.id)!.folder).toBe("Villagers"); // the move really happened...
    expect(updatedAt(page.id)).toBe(born);                      // ...without touching recency
    expect(rev(page.id)).toBe(bornRev + 1);                     // conflict detection is a separate concern
  });

  it("does NOT count a folder DELETE dropping pages to the top level — it is a folder move by another name", () => {
    const page = recency.createPage({ title: "Ireena", folder: "NPCs/Villagers" });
    const born = updatedAt(page.id);
    const bornRev = rev(page.id);
    tick();
    recency.deleteFolder("NPCs");
    expect(recency.getPage(page.id)!.folder).toBeNull();
    expect(updatedAt(page.id)).toBe(born);
    expect(rev(page.id)).toBe(bornRev + 1);
  });

  it("DOES count adding a relationship, on BOTH endpoints, without forcing either editor into a conflict", () => {
    const strahd = recency.createPage({ title: "Strahd", entityType: "character" });
    const barovia = recency.createPage({ title: "Barovia", entityType: "location" });
    const bornStrahd = updatedAt(strahd.id);
    const bornBarovia = updatedAt(barovia.id);
    tick();
    const edge = recency.createRelationship(strahd.id, barovia.id, "rules");
    expect(updatedAt(strahd.id) > bornStrahd).toBe(true);
    expect(updatedAt(barovia.id) > bornBarovia).toBe(true);   // the OTHER end gained a connection too
    expect(rev(strahd.id)).toBe(strahd.rev);                  // `rev` is the conflict token, not recency
    expect(rev(barovia.id)).toBe(barovia.rev);

    // An idempotent re-add changes nothing, so it is not an edit.
    const settled = updatedAt(strahd.id);
    tick();
    expect(recency.createRelationship(strahd.id, barovia.id, "rules").id).toBe(edge.id);
    expect(updatedAt(strahd.id)).toBe(settled);
  });

  it("DOES count removing a relationship, on both endpoints", () => {
    const strahd = recency.createPage({ title: "Strahd", entityType: "character" });
    const barovia = recency.createPage({ title: "Barovia", entityType: "location" });
    const edge = recency.createRelationship(strahd.id, barovia.id, "rules");
    const afterCreate = updatedAt(strahd.id);
    expect(updatedAt(barovia.id)).toBe(afterCreate);
    tick();
    recency.deleteRelationship(edge.id);
    expect(recency.listRelationshipsFor(strahd.id)).toEqual([]);
    expect(updatedAt(strahd.id) > afterCreate).toBe(true);
    expect(updatedAt(barovia.id) > afterCreate).toBe(true);
    expect(rev(strahd.id)).toBe(strahd.rev);
  });
});

describe("CodexStore sessions (M9)", () => {
  let sessionDirectory: string;
  let clock: number;
  let sessions: CodexStore;

  beforeEach(async () => {
    sessionDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-sessions-"));
    clock = Date.parse("2026-07-26T00:00:00.000Z");
    sessions = new CodexStore(join(sessionDirectory, "vtt.sqlite"), () => clock);
    await sessions.initialize();
  });
  afterEach(async () => { sessions.close(); await rm(sessionDirectory, { recursive: true, force: true }); });

  /**
   * An injected clock, exactly as the CI-9 recency describe uses one. Without it the "reveal does not move
   * recency" assertions are VACUOUS: two writes in the same millisecond produce the same ISO stamp, so a
   * `toBe(born)` would pass even against a `SET updated_at = ?` that really did fire.
   */
  const tick = () => { clock += 60_000; };

  it("creates, reads back, updates with a rev bump, and persists through a restart", async () => {
    const created = sessions.createSession({
      sessionNumber: 4, realDate: "2026-07-26", attendees: ["Ozy", "Mara", " Ozy "],
      prepBody: "Ambush at the bridge.", recapBody: "The party crossed.", status: "planned"
    });
    expect(created).toMatchObject({
      sessionNumber: 4, realDate: "2026-07-26", prepBody: "Ambush at the bridge.",
      recapBody: "The party crossed.", revealedToPlayers: false, status: "planned", rev: 1
    });
    expect(created.attendees).toEqual(["Ozy", "Mara"]);        // trimmed + deduped, NOT slugged
    expect(created.createdAt).toBe(created.updatedAt);          // born, so the two stamps agree

    tick();
    const updated = sessions.updateSession(created.id, { recapBody: "The party crossed, one short.", status: "played" }, created.rev, "gm");
    expect(updated.rev).toBe(2);
    expect(updated.recapBody).toBe("The party crossed, one short.");
    expect(updated.status).toBe("played");
    expect(updated.prepBody).toBe("Ambush at the bridge.");     // an omitted field is UNCHANGED, never cleared
    expect(updated.updatedAt > created.updatedAt).toBe(true);   // ...and an edit moves recency

    sessions.close();
    sessions = new CodexStore(join(sessionDirectory, "vtt.sqlite"), () => clock);
    await sessions.initialize();
    expect(sessions.getSession(created.id)).toMatchObject({ rev: 2, status: "played", sessionNumber: 4 });
    expect(sessions.listSessions()).toHaveLength(1);
  });

  it("rejects a stale expectedRev with a conflict, and accepts an omitted one", () => {
    const session = sessions.createSession({ sessionNumber: 1, prepBody: "v1" });
    sessions.updateSession(session.id, { prepBody: "v2" }, session.rev, "gm");
    expect(() => sessions.updateSession(session.id, { prepBody: "v3" }, 1, "gm")).toThrow(CodexRevisionConflictError);
    // An omitted expectedRev is the "I know I might be behind" path and must still write.
    expect(sessions.updateSession(session.id, { prepBody: "v3" }, undefined, "gm").prepBody).toBe("v3");
  });

  it("does NOT move recency or `rev` on a reveal — but still bumps the codex revision (CI-9)", () => {
    // The recap badge compares a session's `updatedAt` against a lastSeen stamp, so a reveal sweep that
    // re-stamped every session would light the badge for recaps whose text never changed.
    const session = sessions.createSession({ sessionNumber: 2, recapBody: "The wolves came at dusk." });
    const born = session.updatedAt;
    const revisionBefore = sessions.revision;
    tick();
    const revealed = sessions.setSessionRevealed(session.id, true);
    expect(revealed.revealedToPlayers).toBe(true);                     // the reveal really happened...
    expect(revealed.updatedAt).toBe(born);                             // ...without moving recency
    expect(revealed.rev).toBe(session.rev);                            // ...or the editor's conflict token
    expect(sessions.revision).toBeGreaterThan(revisionBefore);         // ...but clients still refetch
  });

  it("refuses a duplicate session number, allows any number of UNNUMBERED sessions, and frees a number on delete", () => {
    sessions.createSession({ sessionNumber: 7 });
    // The partial UNIQUE index is what makes "open session 7" resolve to one record. A duplicate must be a
    // clean rejection, not a crash — and the message must be something a GM can act on.
    expect(() => sessions.createSession({ sessionNumber: 7 })).toThrow(/Session 7 already exists/);
    // ...on the UPDATE path too, which is the easier one to forget.
    const other = sessions.createSession({ sessionNumber: 8 });
    expect(() => sessions.updateSession(other.id, { sessionNumber: 7 }, other.rev, "gm")).toThrow(/Session 7 already exists/);
    expect(sessions.getSession(other.id)!.sessionNumber).toBe(8);      // the rejected write rolled back whole

    // An unnumbered session is a legitimate state, so many may coexist. This pins the BEHAVIOUR, not the
    // index's `WHERE` clause — SQLite treats NULLs as distinct in any UNIQUE index, so removing that
    // predicate changes nothing observable and no test can catch it. What this does catch is a store that
    // starts inventing a number for an unnumbered session.
    const drafts = [sessions.createSession({}), sessions.createSession({}), sessions.createSession({})];
    expect(drafts.every((draft) => draft.sessionNumber === null)).toBe(true);
    expect(sessions.listSessions()).toHaveLength(5);

    // Deleting the holder frees the number for reuse, so a mistyped session is recoverable.
    const seven = sessions.listSessions().find((row) => row.sessionNumber === 7)!;
    sessions.deleteSession(seven.id);
    expect(sessions.createSession({ sessionNumber: 7 }).sessionNumber).toBe(7);
  });

  it("names exactly the session numbers whose RECORD is still hidden from players", () => {
    // The resolution the player journal reads gate `sessionNumber` on. It must be the UNREVEALED set, not
    // the complement of the revealed one: a number with no session record at all is in neither, which is
    // what keeps every pre-M9 entry's label working.
    const hidden = sessions.createSession({ sessionNumber: 4 });
    const shown = sessions.createSession({ sessionNumber: 5 });
    sessions.setSessionRevealed(shown.id, true);
    // Unrevealed, but it names no number — a set that let a null through would be a value every caller has
    // to remember not to look up, and this is what catches one arriving.
    sessions.createSession({});
    expect([...sessions.unrevealedSessionNumbers()]).toEqual([4]);

    // Revealing 4 empties the set, so the 4 above is the reveal flag being read and not "every session".
    sessions.setSessionRevealed(hidden.id, true);
    expect([...sessions.unrevealedSessionNumbers()]).toEqual([]);
    // ...and hiding 5 again puts a DIFFERENT number in, so this is a per-row read rather than a constant.
    sessions.setSessionRevealed(shown.id, false);
    expect([...sessions.unrevealedSessionNumbers()]).toEqual([5]);
  });

  it("orders numbered sessions by number, with the unnumbered ones below them", () => {
    // The same tier-separator idiom the chronicle uses for undated records: a session with no number yet
    // is not "session 0", it is outside the numbering, so it sorts below every numbered one.
    const second = sessions.createSession({ sessionNumber: 2 });
    const draft = sessions.createSession({});
    const first = sessions.createSession({ sessionNumber: 1 });
    expect(sessions.listSessions().map((row) => row.id)).toEqual([first.id, second.id, draft.id]);
  });

  it("deletes idempotently, ignores a malformed id, and clears the active pointer with the record", () => {
    const session = sessions.createSession({ sessionNumber: 3 });
    sessions.setActiveSession(session.id);
    expect(sessions.activeSessionId).toBe(session.id);
    sessions.deleteSession(session.id);
    expect(sessions.getSession(session.id)).toBeNull();
    // A dangling pointer would have `activeSessionId` name a record that no longer exists — which the
    // sessions list hands straight to the GM, and which auto-linking would then resolve against.
    expect(sessions.activeSessionId).toBeNull();
    expect(() => sessions.deleteSession(session.id)).not.toThrow();    // idempotent
    expect(() => sessions.deleteSession("not-a-uuid")).not.toThrow();  // malformed id: early return

    // ...and the clear is SCOPED to the session being deleted. Deleting a DIFFERENT record must leave
    // the pointer alone: a GM tidying up old sessions mid-campaign would otherwise silently un-file
    // every subsequent note and auto-logged battle, which is the whole feature. Unpinned, dropping the
    // WHERE clause left all 887 tests green.
    const running = sessions.createSession({ sessionNumber: 12 });
    const stale = sessions.createSession({ sessionNumber: 4 });
    sessions.setActiveSession(running.id);
    sessions.deleteSession(stale.id);
    expect(sessions.activeSessionId).toBe(running.id);
  });

  /**
   * Session number 0 is legal at every layer (`sessionNo` and the route schema both admit it), and it is
   * the one value a truthiness check silently eats. The player gate is written `=== null` for exactly
   * this reason; nothing pinned that until now, so `!sessionNumber` passed the suite while blanking a
   * revealed session 0 for every player.
   */
  it("treats session number 0 as a real number, not as absent", () => {
    const zero = sessions.createSession({ sessionNumber: 0 });
    expect(zero.sessionNumber).toBe(0);
    const entry = sessions.createEntry({ playerText: "The session before the first.", sessionNumber: 0, revealedToPlayers: true });
    expect(entry.sessionNumber).toBe(0);

    // Unrevealed record -> gated to null, exactly as any other number.
    expect(projectPlayerJournalEntry(entry, { unrevealedSessionNumbers: sessions.unrevealedSessionNumbers() })!.sessionNumber).toBeNull();
    // Revealed -> the number survives, and 0 is not mistaken for "no session".
    sessions.setSessionRevealed(zero.id, true);
    expect(projectPlayerJournalEntry(entry, { unrevealedSessionNumbers: sessions.unrevealedSessionNumbers() })!.sessionNumber).toBe(0);
  });

  /**
   * The create/update asymmetry again, this time with a session actually ACTIVE — the state the store
   * test above cannot reach, because its fixture never activates anything. Editing an entry must not
   * re-file it under the running session.
   */
  it("editing an entry never re-files it under the ACTIVE session", () => {
    const older = sessions.createSession({ sessionNumber: 2 });
    const running = sessions.createSession({ sessionNumber: 9 });
    void older;
    sessions.setActiveSession(running.id);

    const entry = sessions.createEntry({ playerText: "Filed under two.", sessionNumber: 2 });
    expect(entry.sessionNumber).toBe(2);
    const edited = sessions.updateEntry(entry.id, { playerText: "Filed under two, with a typo fixed." });
    expect(edited.sessionNumber).toBe(2);          // NOT 9
  });

  it("sets and clears the active session without touching the session record at all", () => {
    const session = sessions.createSession({ sessionNumber: 5, prepBody: "The crypt." });
    const born = sessions.getSession(session.id)!;
    expect(sessions.activeSessionId).toBeNull();                       // nothing is active on a fresh codex

    tick();
    expect(sessions.setActiveSession(session.id)).toBe(session.id);
    expect(sessions.activeSessionId).toBe(session.id);
    // Activating is a statement about the TABLE, not an edit of the record: no rev (an open console would
    // 409 on a click nobody typed) and no recency move (the badge would light for unchanged prose).
    expect(sessions.getSession(session.id)).toEqual(born);

    tick();
    expect(sessions.setActiveSession(null)).toBeNull();
    expect(sessions.activeSessionId).toBeNull();
    expect(sessions.getSession(session.id)).toEqual(born);
    expect(() => sessions.setActiveSession(crypto.randomUUID())).toThrow(/no longer exists/);
  });

  it("files new journal entries and auto-logged battles under the ACTIVE session", () => {
    const session = sessions.createSession({ sessionNumber: 12 });
    sessions.setActiveSession(session.id);

    // The GM types a note; nobody retypes the session number.
    expect(sessions.createEntry({ playerText: "We reached Vallaki." }).sessionNumber).toBe(12);
    // ...and a fight logged mid-session lands in the same group. This was the one record kind that never
    // could, however diligently the GM numbered everything else.
    expect(sessions.appendCombatEntry({ sourceEncounterId: 3, playerText: "A brawl." }).sessionNumber).toBe(12);

    // An EXPLICIT value always wins, including an explicit null — that is a caller saying "no session".
    expect(sessions.createEntry({ playerText: "A retcon.", sessionNumber: 4 }).sessionNumber).toBe(4);
    expect(sessions.createEntry({ playerText: "Timeless lore.", sessionNumber: null }).sessionNumber).toBeNull();
  });

  it("degrades to today's exact behaviour when there is no active session — and in every gap", () => {
    // A numbered session that is NOT active exists throughout. That is load-bearing: without it, "resolve
    // the ACTIVE session" and "guess at any session lying around" produce the same nulls, and this test
    // would pass against a lookup that files every entry under whatever session it can find.
    const bystander = sessions.createSession({ sessionNumber: 9 });
    expect(sessions.activeSessionId).toBeNull();

    // With nothing active, both call sites must behave precisely as they did before M9: no session.
    expect(sessions.createEntry({ playerText: "Between sessions." }).sessionNumber).toBeNull();
    expect(sessions.appendCombatEntry({ sourceEncounterId: 1, playerText: "A brawl." }).sessionNumber).toBeNull();

    // An active session that has NO NUMBER yet is the same gap — there is nothing to file under, and
    // session 9 sitting right there must not be borrowed.
    const draft = sessions.createSession({});
    sessions.setActiveSession(draft.id);
    expect(sessions.createEntry({ playerText: "Mid-draft." }).sessionNumber).toBeNull();
    expect(sessions.appendCombatEntry({ sourceEncounterId: 2, playerText: "A brawl." }).sessionNumber).toBeNull();

    // ...and numbering that same session starts the linking, so the nulls above are the gap and not a
    // broken lookup. It resolves to the ACTIVE session's number, not the bystander's.
    sessions.updateSession(draft.id, { sessionNumber: 1 }, draft.rev, "gm");
    expect(sessions.createEntry({ playerText: "Numbered now." }).sessionNumber).toBe(1);
    expect(bystander.sessionNumber).toBe(9);
  });
});

describe("CodexStore quests (M10)", () => {
  let questDirectory: string;
  let clock: number;
  let quests: CodexStore;

  beforeEach(async () => {
    questDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-quests-"));
    clock = Date.parse("2026-07-29T00:00:00.000Z");
    quests = new CodexStore(join(questDirectory, "vtt.sqlite"), () => clock);
    await quests.initialize();
  });
  afterEach(async () => { quests.close(); await rm(questDirectory, { recursive: true, force: true }); });

  /** The injected clock the sessions + CI-9 describes use: without it "reveal does not move recency" is vacuous. */
  const tick = () => { clock += 60_000; };

  it("creates, reads back, updates with a rev bump, and persists through a restart", async () => {
    const created = quests.createQuest({
      title: "The Wyrmwood Contract", status: "active",
      playerBody: "Recover the ledger from the counting house.",
      gmBody: "The ledger is a forgery; the real one burned.",
      objectives: [{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }]
    });
    expect(created).toMatchObject({
      title: "The Wyrmwood Contract", status: "active", revealedToPlayers: false, rev: 1,
      playerBody: "Recover the ledger from the counting house.", gmBody: "The ledger is a forgery; the real one burned."
    });
    expect(created.createdAt).toBe(created.updatedAt);          // born, so the two stamps agree
    expect(created.entityIds).toEqual([]);

    tick();
    const updated = quests.updateQuest(created.id, { status: "completed" }, created.rev);
    expect(updated.rev).toBe(2);
    expect(updated.status).toBe("completed");
    expect(updated.playerBody).toBe("Recover the ledger from the counting house."); // omitted = UNCHANGED
    expect(updated.objectives).toHaveLength(2);                                     // ...including the list
    expect(updated.updatedAt > created.updatedAt).toBe(true);                       // an edit moves recency

    quests.close();
    quests = new CodexStore(join(questDirectory, "vtt.sqlite"), () => clock);
    await quests.initialize();
    const reopened = quests.getQuest(created.id)!;
    expect(reopened).toMatchObject({ rev: 2, status: "completed" });
    expect(reopened.objectives).toEqual([{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }]);
    expect(quests.listQuests()).toHaveLength(1);
  });

  it("rejects a stale expectedRev with a conflict, and accepts an omitted one", () => {
    const quest = quests.createQuest({ title: "Q", gmBody: "v1" });
    quests.updateQuest(quest.id, { gmBody: "v2" }, quest.rev);
    expect(() => quests.updateQuest(quest.id, { gmBody: "v3" }, 1)).toThrow(CodexRevisionConflictError);
    // An omitted expectedRev is the "I know I might be behind" path and must still write.
    expect(quests.updateQuest(quest.id, { gmBody: "v3" }, undefined).gmBody).toBe("v3");
  });

  it("does NOT move recency or `rev` on a reveal — but still bumps the codex revision (CI-9)", () => {
    const quest = quests.createQuest({ title: "The Vault", playerBody: "Open it." });
    const born = quest.updatedAt;
    const revisionBefore = quests.revision;
    tick();
    const revealed = quests.setQuestRevealed(quest.id, true);
    expect(revealed.revealedToPlayers).toBe(true);                     // the reveal really happened...
    expect(revealed.updatedAt).toBe(born);                             // ...without moving recency
    expect(revealed.rev).toBe(quest.rev);                              // ...or the editor's conflict token
    expect(quests.revision).toBeGreaterThan(revisionBefore);           // ...but clients still refetch
  });

  /**
   * The M10 rule that has no precedent anywhere else in the Codex: objectives are the first ORDERED
   * MUTABLE list, and their order is CONTENT. "Find the key, then open the vault" is not the same quest
   * as its reverse, so nothing may sort, dedupe, or key identity off an index across a write.
   */
  it("keeps objective ORDER exactly as written, through a round-trip and through an edit", () => {
    // Deliberately adversarial input: reverse-alphabetical, with a genuine DUPLICATE in the middle. A sort
    // would reorder it, a dedupe would shorten it, and either would pass a test that only checked contents.
    const written = [
      { text: "Zero the ledger", done: false },
      { text: "Ask Blinsky", done: true },
      { text: "Ask Blinsky", done: false },
      { text: "Burn the counting house", done: false }
    ];
    const quest = quests.createQuest({ title: "Order matters", objectives: written });
    expect(quest.objectives).toEqual(written);
    expect(quests.getQuest(quest.id)!.objectives).toEqual(written);     // ...and it survives the DB round-trip

    // An EDIT replaces the list wholesale. Reordering, ticking and inserting arrive as one array, and the
    // stored order must be that array — not a merge against the previous one by position or by text.
    const edited = [
      { text: "Burn the counting house", done: false },
      { text: "A newly inserted step", done: false },
      { text: "Zero the ledger", done: true },
      { text: "Ask Blinsky", done: true },
      { text: "Ask Blinsky", done: false }
    ];
    const after = quests.updateQuest(quest.id, { objectives: edited }, quest.rev);
    expect(after.objectives).toEqual(edited);
    expect(quests.getQuest(quest.id)!.objectives).toEqual(edited);
    // An empty array genuinely CLEARS the list rather than reading as "absent" — the tags contract.
    expect(quests.updateQuest(quest.id, { objectives: [] }, after.rev).objectives).toEqual([]);
  });

  it("bounds objectives, coerces `done`, and allows a blank row without renumbering the list", () => {
    expect(() => quests.createQuest({ title: "Too many", objectives: Array.from({ length: 25 }, () => ({ text: "x", done: false })) })).toThrow(/at most 24 objectives/);
    expect(() => quests.createQuest({ title: "Too long", objectives: [{ text: "x".repeat(121), done: false }] })).toThrow(/up to 120 printable characters/);
    expect(quests.createQuest({ title: "At the cap", objectives: [{ text: "x".repeat(120), done: false }] }).objectives[0].text).toHaveLength(120);

    // A blank row is LEGAL and keeps its slot: the checklist's real flow is "add a row, then type", and
    // the editor autosaves the whole draft. Dropping it would renumber the list under the GM's cursor.
    const quest = quests.createQuest({ title: "Blank rows", objectives: [{ text: "First", done: false }, { text: "  ", done: false }, { text: "Third", done: false }] });
    expect(quest.objectives).toEqual([{ text: "First", done: false }, { text: "", done: false }, { text: "Third", done: false }]);

    // `done` is coerced, never trusted: anything that is not exactly `true` reads as false, so no malformed
    // value can mark an objective complete.
    const coerced = quests.createQuest({ title: "Coercion", objectives: [{ text: "a", done: "yes" as unknown as boolean }, { text: "b", done: true }] });
    expect(coerced.objectives.map((objective) => objective.done)).toEqual([false, true]);
  });

  it("stores linked entity ids as a deduped set, and rejects a malformed one", () => {
    const strahd = quests.createPage({ title: "Strahd" });
    const ireena = quests.createPage({ title: "Ireena" });
    // `idArray`'s contract, the marker-links one verbatim: order of first appearance, duplicates dropped.
    // Deduping is right for a LINK SET and wrong for objectives — two objectives may legitimately match.
    const quest = quests.createQuest({ title: "Escort", entityIds: [ireena.id, strahd.id, ireena.id] });
    expect(quest.entityIds).toEqual([ireena.id, strahd.id]);
    expect(() => quests.createQuest({ title: "Bad link", entityIds: ["not-a-uuid"] })).toThrow(/malformed/);
    // Omitting the field leaves the stored links alone; an empty array clears them.
    expect(quests.updateQuest(quest.id, { title: "Escort Ireena" }, quest.rev).entityIds).toEqual([ireena.id, strahd.id]);
    expect(quests.updateQuest(quest.id, { entityIds: [] }, undefined).entityIds).toEqual([]);
  });

  it("rejects an unknown status, lists oldest-first, and deletes idempotently", () => {
    expect(() => quests.createQuest({ title: "Bad", status: "abandoned" as never })).toThrow(/active, completed, or failed/);
    expect(() => quests.createQuest({ title: "" })).toThrow(/1 to 160 printable characters/);

    const first = quests.createQuest({ title: "First" });
    tick();
    const second = quests.createQuest({ title: "Second" });
    // A quest has no number and no in-world date, so the order it was STARTED in is the only intrinsic
    // one. Completing one must NOT move it in the list — that is a dashboard FILTER, not an ordering.
    quests.updateQuest(first.id, { status: "completed" }, first.rev);
    expect(quests.listQuests().map((quest) => quest.id)).toEqual([first.id, second.id]);

    quests.deleteQuest(first.id);
    expect(quests.getQuest(first.id)).toBeNull();
    expect(() => quests.deleteQuest(first.id)).not.toThrow();     // idempotent
    expect(() => quests.deleteQuest("not-a-uuid")).not.toThrow(); // malformed id: early return
    // The index row goes with the record: an orphan would keep matching forever with no live row for
    // `PLAYER_VISIBLE_SQL` to gate it on.
    expect(quests.searchAll("gm", "First")).toEqual([]);
  });

  /**
   * M9 shipped without this and had to be corrected for it ("a backup that dropped every session"). A
   * quest's `gmBody` and its objective list exist nowhere else either, so the same hole would be silent.
   */
  it("carries quests into the backup bundle, GM layer and objectives included", () => {
    const quest = quests.createQuest({
      title: "The Wyrmwood Contract", gmBody: "The ledger is a forgery.",
      objectives: [{ text: "Find it", done: true }, { text: "Burn it", done: false }]
    });
    const bundle = quests.exportBundle();
    expect(bundle.quests.map((row) => row.id)).toEqual([quest.id]);
    expect(bundle.quests[0].gmBody).toBe("The ledger is a forgery.");
    expect(bundle.quests[0].objectives).toEqual([{ text: "Find it", done: true }, { text: "Burn it", done: false }]);
  });
});

/**
 * M10 SEARCH GATE 1 of 3 — the text written INTO `codex_search_player`.
 *
 * The gate `codex-store.ts` did not name until M10, and the only one of the three with no second line of
 * defence. Gates 2 and 3 both PASS a revealed quest, correctly, so if `gmBody` reached the player index a
 * player typing a GM-only phrase would get a HIT on a quest they are entitled to see. The body is never
 * returned — the hit's EXISTENCE is the leak, because it confirms the phrase appears somewhere secret.
 *
 * The quest here is REVEALED on purpose. An unrevealed one would be masked by gate 2, and the test would
 * pass for the wrong reason.
 */
describe("CodexStore quest search index text — gate 1, with no second line of defence (M10)", () => {
  const GM_PHRASE = "the ledger is a forgery";
  const seedRevealed = () => {
    const quest = store.createQuest({
      title: "The Wyrmwood Contract",
      playerBody: "Recover the ledger from the counting house.",
      gmBody: `Nobody can find it: ${GM_PHRASE} and the real one burned.`,
      objectives: [{ text: "Search the counting house", done: false }]
    });
    return store.setQuestRevealed(quest.id, true);
  };

  it("gives a player ZERO hits on a phrase that exists only in `gmBody`", () => {
    const quest = seedRevealed();
    expect(quest.revealedToPlayers).toBe(true);                            // gate 2 would pass this quest
    expect(store.searchAll("player", "forgery")).toEqual([]);              // ...and yet the phrase is unreachable
    expect(store.searchAll("player", GM_PHRASE)).toEqual([]);

    // The GM DOES find it, so the miss above is the two indexes being kept apart, not a quest that never
    // indexed at all.
    expect(store.searchAll("gm", "forgery")).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("still lets a player find that same quest by its player body and by an objective", () => {
    // This is what makes the assertions above meaningful: the quest IS in the player's index and IS
    // player-visible, so the GM phrase missing is about the TEXT written, not about the record.
    const quest = seedRevealed();
    expect(store.searchAll("player", "counting")).toEqual([{ kind: "quest", id: quest.id }]);
    // An objective's text is player-facing — it lives beside `playerBody`, not `gmBody`.
    expect(store.searchAll("player", "Search")).toEqual([{ kind: "quest", id: quest.id }]);
    // ...and the title, which is the same string in both indexes.
    expect(store.searchAll("player", "Wyrmwood")).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("keeps the index in step with an edit and re-splits the layers on the way", () => {
    const quest = seedRevealed();
    store.updateQuest(quest.id, {
      playerBody: "Escort Ireena to Vallaki.", gmBody: "Ireena is Strahd's true target.",
      objectives: [{ text: "Reach the gates", done: false }]
    }, undefined);
    // The old player text stops matching — body AND objective, since both feed the same index row.
    expect(store.searchAll("player", "counting")).toEqual([]);
    expect(store.searchAll("gm", "counting")).toEqual([]);
    expect(store.searchAll("player", "Vallaki")).toEqual([{ kind: "quest", id: quest.id }]);
    expect(store.searchAll("player", "gates")).toEqual([{ kind: "quest", id: quest.id }]);
    // ...and the NEW GM half is in the GM index only, so an update cannot be the way a secret phrase
    // sneaks into the player table.
    expect(store.searchAll("player", "target")).toEqual([]);
    expect(store.searchAll("gm", "target")).toEqual([{ kind: "quest", id: quest.id }]);
  });
});

/**
 * M10 SEARCH GATE 3 of 3, plus the record projection — both called POINT-BLANK.
 *
 * `codex-http.test.ts` proves the pipeline; only this proves the layer. That is not pedantry: this file's
 * own CI-1 lesson is that a weakened SQL gate left all 787 tests passing because a projection quietly
 * caught it, and the blind spot exists in reverse — an HTTP test cannot tell a working projection from a
 * SQL predicate that happened to compensate for a broken one.
 */
describe("Codex quest — the projection layer, on its own (M10, A-8)", () => {
  const GM_PHRASE = "The ledger is a forgery; the real one burned.";
  const seed = () => store.createQuest({
    title: "The Wyrmwood Contract", status: "active",
    playerBody: "Recover the ledger from the counting house.",
    gmBody: GM_PHRASE,
    objectives: [{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }]
  });
  const noEntities = { revealedEntityIds: new Set<string>() };

  it("refuses an UNREVEALED quest outright", () => {
    const quest = seed();
    expect(quest.revealedToPlayers).toBe(false);
    expect(projectPlayerQuest(quest, noEntities)).toBeNull();
    // Revealing it lets it through, so the null above is the reveal gate and not a broken projection.
    expect(projectPlayerQuest(store.setQuestRevealed(quest.id, true), noEntities)).not.toBeNull();
  });

  it("emits exactly the allow-listed keys of a REVEALED quest, and never the GM body", () => {
    const revealed = store.setQuestRevealed(seed().id, true);
    const projected = projectPlayerQuest(revealed, noEntities)!;
    // The EXACT key set, not a search of the payload for a secret string: this fails if any new field is
    // ever added to the player projection, not merely if this one leaks. `gmBody` and `rev` are absent;
    // `status` is deliberately PRESENT, unlike a session's, because "what is still open" is the feature.
    expect(Object.keys(projected).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "title"]);
    expect(projected.body).toBe("Recover the ledger from the counting house.");
    expect(projected.status).toBe("active");
    // Objective order and tick state are the player's copy of the checklist, unchanged.
    expect(projected.objectives).toEqual([{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }]);
    expect(JSON.stringify(projected)).not.toContain("forgery");

    // The GM's own row carries all of it — so the assertions above are the projection working, not a quest
    // that happened to have nothing to leak.
    const gmRow = projectGmQuest(revealed);
    expect(gmRow.gmBody).toBe(GM_PHRASE);
    expect(gmRow.rev).toBe(1);
    expect(gmRow.revealedToPlayers).toBe(true);
  });

  it("filters `entityIds` to the revealed subset, the rule `projectPlayerMarker` applies to pageIds", () => {
    const shown = store.createPage({ title: "Vallaki" });
    const secret = store.createPage({ title: "The Amber Temple" });
    store.setPageRevealed(shown.id, true);
    const quest = store.setQuestRevealed(store.createQuest({ title: "Escort", entityIds: [shown.id, secret.id] }).id, true);
    expect(quest.entityIds).toEqual([shown.id, secret.id]);   // the GM's row links both

    const projected = projectPlayerQuest(quest, { revealedEntityIds: new Set([shown.id]) })!;
    // A revealed quest must not advertise the id of a still-secret page: "this quest concerns something
    // you cannot see" is the same leak a dangling graph edge is.
    expect(projected.entityIds).toEqual([shown.id]);
    expect(JSON.stringify(projected)).not.toContain(secret.id);
  });

  it("refuses an UNREVEALED quest at the SEARCH projection too — gate 3, on its own", () => {
    const quest = seed();
    // Called directly, with no SQL in front of it. `PLAYER_VISIBLE_SQL` would already have dropped this
    // row over HTTP, which is exactly why breaking this arm is invisible from there.
    expect(projectPlayerSearchHit({ kind: "quest", quest })).toBeNull();
    // The GM's hit exists for the same record, so the null is the reveal gate and not a missing arm.
    expect(projectGmSearchHit({ kind: "quest", quest })).toMatchObject({ kind: "quest", id: quest.id, title: "The Wyrmwood Contract" });
  });

  it("emits a REVEALED quest as a uniform hit row: no body, no reveal flag, and `tags: []`", () => {
    const revealed = store.setQuestRevealed(seed().id, true);
    const hit = projectPlayerSearchHit({ kind: "quest", quest: revealed })!;
    // The same key set every other kind emits — a row renderer must never branch on which kind it got.
    expect(Object.keys(hit).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    // Quests carry no tags at all (not in the spec's column list), so this is `[]` rather than a missing
    // key or a null. `status`/`objectives` are read on the RECORD: a result row exists to navigate.
    expect(hit.tags).toEqual([]);
    expect(hit.entityType).toBeNull();
    expect(hit.mapId).toBeNull();
    expect(JSON.stringify(hit)).not.toContain("forgery");
    expect(JSON.stringify(hit)).not.toContain("counting house");
  });
});

/**
 * The K7 discipline v11/v12 follow: a fresh-database test can never catch a bad upgrade, because every
 * table is empty. This builds a genuine v12 database out of the shipped migration SQL, fills it with the
 * legacy rows that actually matter here (journal entries that already carry a `session_number`), and then
 * opens a `CodexStore` on it — which is exactly the upgrade a GM's existing vtt.sqlite performs.
 */
describe("CodexStore migration v13 — sessions arrive with NO backfill (M9)", () => {
  it("fabricates no session records for existing numbered entries, and leaves those entries untouched", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v12-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter((entry) => entry.version <= 12)) {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
      }
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();
      const one = crypto.randomUUID(), two = crypto.randomUUID(), loose = crypto.randomUUID();
      const insert = database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, session_number, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, NULL, 1, 'note', ?, ?, '[]', '', '')");
      insert.run(one, "We arrived in Barovia.", 1, 1);
      insert.run(two, "The wolves came.", 2, 2);
      insert.run(loose, "Undated lore.", null, 3);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();

      // THE point of "no backfill": three legacy entries carrying numbers 1 and 2 produce ZERO session
      // records. Inventing one per distinct number would fabricate prep, recap and attendance nobody
      // wrote, and would guess which numbers were ever real sessions.
      expect(upgraded.listSessions()).toEqual([]);
      expect(upgraded.activeSessionId).toBeNull();

      // ...and the legacy entries read exactly as they did before the upgrade, so the by-session lens
      // renders those groups today the way it rendered them yesterday.
      expect(upgraded.listTimeline().map((entry) => entry.sessionNumber)).toEqual([1, 2, null]);
      expect(upgraded.getEntry(one)!.playerText).toBe("We arrived in Barovia.");

      // Auto-linking on a REAL upgraded database with real rows: nothing is active, so a new entry is
      // filed exactly as it was pre-M9 — the legacy numbers do not leak into it.
      expect(upgraded.createEntry({ playerText: "Written after the upgrade." }).sessionNumber).toBeNull();
      expect(upgraded.appendCombatEntry({ sourceEncounterId: 9, playerText: "A brawl." }).sessionNumber).toBeNull();

      // Making a session record for a number the legacy entries ALREADY use is allowed (the constraint is
      // over SESSIONS, not entries). Number 1 on purpose: the entries above carry 1 and 2, so this is the
      // stated case rather than an adjacent one — the comment used to claim this while creating 3, which
      // no legacy row used. It matters more since the player gate landed: an UNREVEALED record for a
      // number legacy entries carry is exactly what blanks those long-correct labels for players.
      const legacyNumbered = upgraded.createSession({ sessionNumber: 1 });
      expect(upgraded.unrevealedSessionNumbers().has(1)).toBe(true);
      expect(projectPlayerJournalEntry(upgraded.setEntryRevealed(one, true), { unrevealedSessionNumbers: upgraded.unrevealedSessionNumbers() })!.sessionNumber).toBeNull();
      upgraded.setSessionRevealed(legacyNumbered.id, true);
      expect(projectPlayerJournalEntry(upgraded.getEntry(one)!, { unrevealedSessionNumbers: upgraded.unrevealedSessionNumbers() })!.sessionNumber).toBe(1);

      const third = upgraded.createSession({ sessionNumber: 3 });
      upgraded.setActiveSession(third.id);
      expect(upgraded.createEntry({ playerText: "Session three." }).sessionNumber).toBe(3);
      expect(upgraded.getEntry(one)!.sessionNumber).toBe(1);   // the legacy row is still untouched
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  /**
   * `sessionStatus()` gates the status in TS, so nothing reachable through the store can write a third
   * value — which is exactly why the CHECK is worth asserting at the SQL layer instead. A TS-only gate
   * protects this process, not the file: a repair script or a manual `sqlite3` session would otherwise be
   * free to write `status = 'cancelled'`, and `toSession` coerces anything unrecognised to "planned", so
   * the bad row would read back as a plausible one rather than failing loudly. Same discipline as the
   * two ungatedness tests above — assert the layer, not the pipeline.
   */
  it("the status CHECK rejects a value the TS gate would never produce", () => {
    const database = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS) database.exec(migration.sql);
    const insert = (status: string) => database
      .prepare("INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at) VALUES (?, NULL, NULL, '[]', '', '', 0, ?, 1, '', '')")
      .run(`id-${status}`, status);

    expect(() => insert("cancelled")).toThrow();
    // Both legal values still insert, so the throw above is the CHECK discriminating rather than the
    // statement being broken for every input.
    expect(() => insert("planned")).not.toThrow();
    expect(() => insert("played")).not.toThrow();
    database.close();
  });
});

/**
 * Migration v14 (M10). There is nothing to back-fill — a quest has never existed in this database in any
 * form — so the only claims worth asserting are the ones a fresh-database test CAN make: the table and its
 * status index really ship, and the CHECK that keeps the column honest really discriminates.
 */
describe("CodexStore migration v14 — quests arrive with nothing to back-fill (M10)", () => {
  it("creates the quest table and its status index, and back-fills nothing", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v13-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      // A genuine v13 database, built from the shipped SQL and given a page and a numbered session — the
      // rows most plausibly mistaken for "quests waiting to be promoted".
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter((entry) => entry.version <= 13)) {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
      }
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, 'Ireena', 'character', '{}', '{}', NULL, '[]', 'Escort her to Vallaki.', '', 1, NULL, 1, '', '')").run(crypto.randomUUID());
      database.prepare("INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at) VALUES (?, 1, NULL, '[]', 'Find the ledger.', '', 0, 'planned', 1, '', '')").run(crypto.randomUUID());
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();

      expect(upgraded.listQuests()).toEqual([]);              // nothing was promoted into a quest
      expect(upgraded.listSessions()).toHaveLength(1);        // ...and the v13 rows are untouched
      expect(upgraded.listPages()).toHaveLength(1);

      // The status INDEX is what makes the dashboard's open-quest count a query rather than a scan, so it
      // is asserted rather than assumed present.
      const reopened = new DatabaseSync(path);
      const indexes = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_quests'").all() as Array<{ name: string }>).map((row) => row.name);
      reopened.close();
      expect(indexes).toContain("codex_quests_status");

      // ...and the upgraded database really accepts a quest, so the empty list above is "nothing to
      // back-fill" and not a table that failed to arrive.
      expect(upgraded.createQuest({ title: "The Wyrmwood Contract" }).status).toBe("active");
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  /**
   * `questStatus()` gates the status in TS, so nothing reachable through the store can write a fourth
   * value — which is exactly why the CHECK is worth asserting at the SQL layer instead. A TS-only gate
   * protects this process, not the file: a repair script or a manual `sqlite3` session would otherwise be
   * free to write `status = 'abandoned'`, and `toQuest` coerces anything unrecognised to "active", so the
   * bad row would read back as a plausible one rather than failing loudly.
   */
  it("the status CHECK rejects a value the TS gate would never produce", () => {
    const database = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS) database.exec(migration.sql);
    const insert = (status: string) => database
      .prepare("INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at) VALUES (?, 'Q', ?, '', '', '[]', '[]', 0, 1, '', '')")
      .run(`id-${status}`, status);

    expect(() => insert("abandoned")).toThrow();
    // All three legal values still insert, so the throw above is the CHECK discriminating rather than the
    // statement being broken for every input.
    expect(() => insert("active")).not.toThrow();
    expect(() => insert("completed")).not.toThrow();
    expect(() => insert("failed")).not.toThrow();
    database.close();
  });
});

/**
 * The session projection, called POINT-BLANK. `codex-http.test.ts` proves the pipeline; only this proves
 * the layer. That distinction is not pedantry here — this file's own CI-1 lesson is that a weakened SQL
 * gate left all 787 tests passing because a projection quietly caught it, and the same blind spot exists
 * in reverse: an HTTP test cannot tell a working projection from a router that happened to compensate.
 */
describe("Codex session — the projection layer, on its own (M9, A-8)", () => {
  const seed = () => store.createSession({
    sessionNumber: 6, realDate: "2026-07-26", attendees: ["Ozy", "Mara"],
    prepBody: "The ambush is at the bridge; Ireena is the real target.",
    recapBody: "The party crossed the bridge.", status: "planned"
  });

  it("refuses an UNREVEALED session outright", () => {
    const session = seed();
    expect(session.revealedToPlayers).toBe(false);
    expect(projectPlayerSession(session)).toBeNull();
    // Revealing it lets it through, so the null above is the reveal gate and not a broken projection.
    expect(projectPlayerSession(store.setSessionRevealed(session.id, true))).not.toBeNull();
  });

  it("emits exactly the allow-listed keys of a REVEALED session, and never the prep", () => {
    const revealed = store.setSessionRevealed(seed().id, true);
    const projected = projectPlayerSession(revealed)!;
    // The EXACT key set, not a search of the payload for a secret string: this fails if any new field is
    // ever added to the player projection, not merely if this one leaks. `attendees` and `status` are
    // deliberately absent (P2, secret by default) as well as `prepBody` and `rev`.
    expect(Object.keys(projected).sort()).toEqual(["id", "realDate", "recap", "sessionNumber"]);
    expect(projected.recap).toBe("The party crossed the bridge.");
    const payload = JSON.stringify(projected);
    expect(payload).not.toContain("Ireena is the real target");   // the GM's prep
    expect(payload).not.toContain("Ozy");                          // attendance
    expect(payload).not.toContain("planned");                      // scheduling state

    // The GM's own row carries all of it — so the assertions above are the projection working, not a
    // session that happened to have nothing to leak.
    const gmRow = projectGmSession(revealed);
    expect(gmRow.prepBody).toContain("Ireena is the real target");
    expect(gmRow.attendees).toEqual(["Ozy", "Mara"]);
    expect(gmRow.status).toBe("planned");
    expect(gmRow.rev).toBe(1);
  });
});

/**
 * The journal projection's SESSION-NUMBER gate, called POINT-BLANK. `codex-http.test.ts` proves the
 * pipeline; only this proves the layer, for the reason the describe above states.
 *
 * What it is for. A session's very EXISTENCE is GM information — an unrevealed session 404s a player rather
 * than 403ing, the list omits it, and `activeSessionId` is nulled for players, all on that ground. But M9's
 * auto-linking stamps the ACTIVE session's number onto every entry written during play, so a single
 * revealed entry was announcing "Session 4" for a session all of that goes to trouble to hide.
 *
 * The rule has three cases and the edge cases ARE the point, so each gets its own test: an unrevealed
 * record's number is blanked, a revealed record's number is not, and a number with NO record is not —
 * the last being every entry from before M9, which shipped with no backfill.
 */
describe("Codex journal — the unrevealed-session number gate, on its own (M9 follow-up, A-8)", () => {
  /** An entry a player may read, carrying a number the GM never has to retype — the shape M9 auto-linking produces. */
  const revealedEntry = (sessionNumber: number) => store.createEntry({ playerText: "We reached Vallaki.", sessionNumber, revealedToPlayers: true });

  it("blanks the number of an UNREVEALED session, and hands it back the moment that session is revealed", () => {
    const session = store.createSession({ sessionNumber: 4, recapBody: "The party crossed." });
    expect(session.revealedToPlayers).toBe(false);
    const entry = revealedEntry(4);
    expect(entry.sessionNumber).toBe(4);                                            // the row really carries it...

    expect(projectPlayerJournalEntry(entry, playerSessionNumbers())!.sessionNumber).toBeNull();
    // ...and the GM's own row is untouched, so the null above is the gate and not a number that never arrived.
    expect(projectGmJournalEntry(entry).sessionNumber).toBe(4);

    // Revealing the SESSION — the entry row is not rewritten, only the context changes — hands the number
    // straight back, so the null is provably the reveal gate rather than a projection that drops the field.
    store.setSessionRevealed(session.id, true);
    expect(projectPlayerJournalEntry(entry, playerSessionNumbers())!.sessionNumber).toBe(4);
  });

  it("leaves a number with NO session record alone — every entry written before M9, which shipped no backfill", () => {
    // The case most likely to regress: asking "is 4 revealed?" instead of "is 4 hidden?" would blank this
    // one too, and nothing about it can leak — there is no record whose existence the number names.
    const legacy = revealedEntry(4);
    expect(store.listSessions()).toEqual([]);
    expect(projectPlayerJournalEntry(legacy, playerSessionNumbers())!.sessionNumber).toBe(4);

    // ...and the gate is live in the same breath: an unrevealed session 5 blanks 5 and still not 4, so the
    // 4 above is this rule holding rather than the gate being switched off in this fixture.
    store.createSession({ sessionNumber: 5 });
    expect(projectPlayerJournalEntry(revealedEntry(5), playerSessionNumbers())!.sessionNumber).toBeNull();
    expect(projectPlayerJournalEntry(legacy, playerSessionNumbers())!.sessionNumber).toBe(4);
  });

  it("gates ONLY the number — the rest of a revealed entry travels exactly as it did", () => {
    store.createSession({ sessionNumber: 4 });
    const entry = store.createEntry({
      playerText: "We reached Vallaki.", gmText: "The burgomaster lied about the wolves.",
      sessionNumber: 4, realDate: "2026-07-26", tags: ["travel"], revealedToPlayers: true
    });
    const projected = projectPlayerJournalEntry(entry, playerSessionNumbers())!;
    // The EXACT key set: the field is NULLED, never dropped, so one response shape still serves both roles.
    expect(Object.keys(projected).sort()).toEqual(["createdAt", "id", "inWorldLabel", "kind", "realDate", "sessionNumber", "tags", "text"]);
    expect(projected.sessionNumber).toBeNull();
    expect(projected.text).toBe("We reached Vallaki.");                             // the entry is still readable...
    expect(projected.realDate).toBe("2026-07-26");                                  // ...and its neighbours untouched
    expect(projected.tags).toEqual(["travel"]);
    expect(JSON.stringify(projected)).not.toContain("burgomaster");                 // gmText still gone, as ever
  });

  it("carries the same gate onto the chronicle by DELEGATION, not a second copy", () => {
    const session = store.createSession({ sessionNumber: 4 });
    const entry = store.createEntry({ playerText: "We reached Vallaki.", sessionNumber: 4, revealedToPlayers: true, inWorldDate: { year: 1492, month: 0, day: 1 } });
    const playerRow = () => projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }, playerSessionNumbers())!;
    expect(playerRow().sessionNumber).toBeNull();
    // The GM's chronicle row still carries it, and revealing the session gives the player's row it back —
    // the same two controls the journal test above uses, at the surface that merely delegates.
    expect(projectGmChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }).sessionNumber).toBe(4);
    store.setSessionRevealed(session.id, true);
    expect(playerRow().sessionNumber).toBe(4);
  });
});

/**
 * M11 (CT-5 deadlines, CT-10 downtime) — the STORE layer, below any projection.
 *
 * The spine of this milestone is a migration that REBUILDS `codex_journal` (v15). `codex_journal.kind` has
 * carried `CHECK (kind IN ('note', 'combat'))` since v1 and SQLite cannot widen a CHECK in place, so there
 * was no additive route: the table is recreated, copied, dropped, renamed and re-indexed. That is the most
 * destructive operation in this file's history, and a fresh-database test can never catch a bad one —
 * every table is empty. `preserves every pre-existing row` below therefore builds a genuine v14 database
 * out of the shipped migration SQL and upgrades it, exactly as a GM's existing `vtt.sqlite` will.
 */
describe("CodexStore deadlines + downtime (M11)", () => {
  /** A genuine v1..v14 database on disk, seeded by the caller, ready for a CodexStore to upgrade. */
  const legacyDatabase = (path: string): DatabaseSync => {
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 14)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
    }
    return database;
  };

  /**
   * T-1. The CHECK now admits the two new kinds, AND they survive the read path as themselves.
   *
   * Both halves matter and they fail differently. Without the migration the INSERT is rejected by the FILE
   * ("CHECK constraint failed"), which is loud. With the migration but without a real `kind` parse, the
   * INSERT succeeds and `toEntry`'s old `row.kind === "combat" ? "combat" : "note"` silently reads a
   * deadline back as an ordinary note — no throw, no compile error anywhere, and a GM's deadline simply
   * does not exist as one. That second failure is the one this test is really for.
   */
  it("stores a deadline and a downtime as THEMSELVES — the widened CHECK, and a kind that is parsed rather than collapsed", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const deadline = store.createDeadline({ playerText: "The duke's ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30 } });

    expect(deadline.kind).toBe("deadline");
    expect(downtime.kind).toBe("downtime");
    // ...and again through a SECOND read, so this is the stored row talking and not the create call's return.
    expect(store.getEntry(deadline.id)!.kind).toBe("deadline");
    expect(store.getEntry(downtime.id)!.kind).toBe("downtime");
    expect(store.listTimeline().find((entry) => entry.id === deadline.id)!.kind).toBe("deadline");

    // D11-C: a deadline carries NO payload. Its text is the "what", its own date is the "when".
    expect(deadline.payload).toBeNull();
    expect(deadline.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    // D11-D: downtime carries exactly one, and `applied` starts false (O-3).
    expect(downtime.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false });
    // A note still has none, so `payload` is not quietly universal.
    expect(store.createEntry({ playerText: "plain" }).payload).toBeNull();

    // O-2: hidden on create, revealed by the ORDINARY switch. No kind-specific reveal path exists.
    expect(deadline.revealedToPlayers).toBe(false);
    expect(downtime.revealedToPlayers).toBe(false);
    expect(store.setEntryRevealed(deadline.id, true).revealedToPlayers).toBe(true);

    // §3.1 says search indexing "should be free" and to VERIFY it rather than assume. It is: `indexEntry`
    // runs from `insertEntry`, so both kinds are findable on their own text on exactly a note's terms —
    // and the unrevealed downtime is hidden from the player index by the reveal gate, not by its kind.
    expect(store.searchAll("gm", "ultimatum").some((hit) => hit.kind === "journal" && hit.id === deadline.id)).toBe(true);
    expect(store.searchAll("gm", "poison").some((hit) => hit.kind === "journal" && hit.id === downtime.id)).toBe(true);
    expect(store.searchAll("player", "ultimatum").some((hit) => hit.id === deadline.id)).toBe(true);   // revealed above
    expect(store.searchAll("player", "poison").some((hit) => hit.id === downtime.id)).toBe(false);     // still hidden

    // The ordinary journal editor must not eat the payload: `updateEntry` names its columns and
    // `payload_json` is not among them, so an unrelated text edit leaves it intact.
    expect(store.updateEntry(downtime.id, { playerText: "Vex brews something worse." }).payload)
      .toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false });

    // A deadline with no structured date is rejected: prose cannot be compared to a clock.
    expect(() => store.createDeadline({ playerText: "Someday, probably" })).toThrow(/in-world date/);
    expect(() => store.createDeadline({ playerText: "Soon", inWorldLabel: "next spring" })).toThrow(/in-world date/);
  });

  /**
   * T-2. K7, and the whole risk of this milestone in one test. Seeds a v14 database with the four row
   * shapes that have something to lose — a marker attachment, a page attachment, a dated row, a tagged row
   * — plus a combat row with an encounter id, then upgrades it and compares EVERY column of EVERY row.
   *
   * The assertion is on raw SQL, not on `toEntry`, because a projection that drops a column reads as null
   * on both sides and the comparison would pass. `SELECT *` here is correct for the same reason it is wrong
   * in the migration: the test wants whatever columns actually exist, not the ones it remembers.
   */
  it("migration v15 preserves every column of every pre-existing journal row (K7)", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v14-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = legacyDatabase(path);
      database.prepare("INSERT INTO codex_meta (id, codex_revision, calendar_json) VALUES (1, 3, ?)")
        .run(JSON.stringify({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["First"], currentDate: { year: 1492, month: 1, day: 17 } }));
      const mapId = crypto.randomUUID(), markerId = crypto.randomUUID(), pageId = crypto.randomUUID();
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, 'Barovia', 'regional', NULL, 1, 1, '[]', '', '')").run(mapId, crypto.randomUUID());
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, tags_json, page_ids_json, scene_ids_json, created_at, updated_at) VALUES (?, ?, 0.5, 0.5, 'pin', '#FF2E9A', 'Svalich Road', 1, '[]', '[]', '[]', '', '')").run(markerId, mapId);
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, 'Ravenloft', 'location', '{}', '{}', NULL, '[]', 'a castle', 'the crypt', 0, NULL, 1, '', '')").run(pageId);

      const insert = database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const pinnedToMarker = crypto.randomUUID(), pinnedToPage = crypto.randomUUID(), dated = crypto.randomUUID(), tagged = crypto.randomUUID(), fight = crypto.randomUUID();
      insert.run(pinnedToMarker, "The mists parted.", "Strahd watched.", 1, markerId, null, "note", null, 2, "2026-01-04", null, null, null, null, null, 1, '[]', "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z");
      insert.run(pinnedToPage, "We entered the castle.", null, 0, null, pageId, "note", null, null, null, null, null, null, null, null, 2, '[]', "2026-01-05T00:00:00.000Z", "2026-01-05T00:00:00.000Z");
      insert.run(dated, "The siege begins.", null, 1, null, null, "note", null, 3, null, "First, Alturiak 17, 1492 DR", 537_376, 1492, 1, 17, 3, '[]', "2026-01-06T00:00:00.000Z", "2026-01-06T00:00:00.000Z");
      insert.run(tagged, "The wolves circled.", "They are Strahd's.", 0, null, null, "note", null, null, null, null, null, null, null, null, 4, '["travel","wolves"]', "2026-01-07T00:00:00.000Z", "2026-01-07T00:00:00.000Z");
      insert.run(fight, "The battle at the gate.", null, 1, markerId, pageId, "combat", 41, 3, null, null, null, null, null, null, 5, '["combat"]', "2026-01-08T00:00:00.000Z", "2026-01-08T00:00:00.000Z");

      const before = database.prepare("SELECT * FROM codex_journal ORDER BY id").all();
      const beforeColumns = (database.prepare("PRAGMA table_info(codex_journal)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      expect(before).toHaveLength(5);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();                                  // <- v15 runs here

      const reopened = new DatabaseSync(path);
      const after = reopened.prepare("SELECT * FROM codex_journal ORDER BY id").all() as Array<Record<string, unknown>>;
      const afterColumns = (reopened.prepare("PRAGMA table_info(codex_journal)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      reopened.close();

      expect(after).toHaveLength(before.length);                    // nothing dropped, nothing duplicated
      for (const [index, original] of before.entries()) {
        const { payload_json: payload, ...carried } = after[index];
        expect(carried).toEqual(original);                          // EVERY pre-existing column, value for value
        expect(payload).toBeNull();                                 // ...and the new one starts empty
      }
      // The rebuilt table IS the old table plus one column, in the same order with the same types,
      // NOT-NULLs and defaults — including `tags_json`'s DEFAULT '[]', which v10 added and a
      // reconstructed-from-memory DDL would silently drop.
      expect(afterColumns.slice(0, -1)).toEqual(beforeColumns);
      expect(afterColumns.at(-1)).toEqual(["payload_json", "TEXT", 0, null]);

      // The rows are not merely present, they still READ correctly through the store's own path.
      expect(upgraded.getEntry(fight)!.kind).toBe("combat");
      expect(upgraded.getEntry(fight)!.sourceEncounterId).toBe(41);
      expect(upgraded.getEntry(tagged)!.tags).toEqual(["travel", "wolves"]);
      expect(upgraded.getEntry(pinnedToMarker)!.attachMarkerId).toBe(markerId);
      expect(upgraded.getEntry(pinnedToPage)!.attachPageId).toBe(pageId);
      expect(upgraded.getEntry(dated)!.inWorldDate).toEqual({ year: 1492, month: 1, day: 17 });
      expect(upgraded.listEntriesFor({ markerId }).map((entry) => entry.id).sort()).toEqual([pinnedToMarker, fight].sort());

      // K7 / D11-G: the published date is BACKFILLED from the calendar's `currentDate`, so an existing
      // codex sees no change on day one — the two clocks start in agreement.
      expect(upgraded.getPublishedDate()).toEqual({ year: 1492, month: 1, day: 17 });
      expect(upgraded.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 17 });
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  /**
   * T-2b. The backfill's guards, which the happy path above cannot reach. `json_extract` THROWS on
   * malformed JSON (probed directly against this build) and SQLite's `AND` does NOT short-circuit, so a
   * single hand-edited `calendar_json` would abort the whole migration and leave the GM's codex unopenable.
   * Each of these opens a real store, which is the assertion: the migration ran.
   */
  it("migration v15 backfills NULL rather than dying when the stored calendar has no usable currentDate", async () => {
    for (const calendarJson of [null, "not json at all", '{"months":[]}', '{"currentDate":null}', '{"currentDate":{"year":"1492","month":0,"day":1}}']) {
      const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v14-odd-"));
      const path = join(legacyDirectory, "vtt.sqlite");
      let upgraded: CodexStore | undefined;
      try {
        const database = legacyDatabase(path);
        database.prepare("INSERT INTO codex_meta (id, codex_revision, calendar_json) VALUES (1, 0, ?)").run(calendarJson);
        database.close();
        upgraded = new CodexStore(path);
        await upgraded.initialize();
        expect(upgraded.getPublishedDate()).toBeNull();
      } finally {
        upgraded?.close();
        await rm(legacyDirectory, { recursive: true, force: true });
      }
    }
    // A FRACTIONAL part truncates rather than killing the migration. `codex_meta` is STRICT, and SQLite
    // rejects a REAL in an INTEGER column unless it is exactly integral — `1492.0` slides in on its own,
    // `9.7` does not — so the CAST is what stands between a hand-edited calendar and an unopenable codex.
    // Truncation (not rounding) is deliberate: `normalizeCalendar` uses `Math.trunc`, so the SQL backfill
    // and the TypeScript reader agree on what `9.7` means.
    const floatDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v14-float-"));
    const floatPath = join(floatDirectory, "vtt.sqlite");
    let floats: CodexStore | undefined;
    try {
      const database = legacyDatabase(floatPath);
      database.prepare("INSERT INTO codex_meta (id, codex_revision, calendar_json) VALUES (1, 0, ?)").run('{"currentDate":{"year":1492.0,"month":0.0,"day":9.7}}');
      database.close();
      floats = new CodexStore(floatPath);
      await floats.initialize();
      expect(floats.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 9 });
    } finally {
      floats?.close();
      await rm(floatDirectory, { recursive: true, force: true });
    }
  });

  /**
   * T-3. `DROP TABLE` takes its indexes with it. Forgetting one is SILENT — every query still returns the
   * right answers, the timeline's ORDER BY just becomes a full scan — so nothing but this catches it.
   * Asserted on the index DEFINITIONS as well as the names: an index recreated over the wrong columns is
   * as useless as a missing one and looks identical in a name list.
   */
  it("recreates all three codex_journal indexes, over the same columns, after the rebuild", () => {
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    const indexes = new Map((raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_journal'").all() as Array<{ name: string; sql: string | null }>).map((row) => [row.name, row.sql]));
    raw.close();
    expect(indexes.get("codex_journal_order")).toBe("CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at)");
    expect(indexes.get("codex_journal_marker")).toBe("CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id)");
    expect(indexes.get("codex_journal_page")).toBe("CREATE INDEX codex_journal_page ON codex_journal (attach_page_id)");
  });

  /**
   * T-4. O-3, the owner's decision, stated as three separate properties because passing one proves little:
   * creating downtime does NOT move the clock, `applyDowntime` DOES, and applying twice is REJECTED and
   * moves nothing. The third is the one a double-click finds.
   */
  it("creating downtime does not move the clock, applying it does, and applying it twice is rejected (O-3)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30 } });

    // 1. Creating proposes; it does not decide. The clock has not moved.
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(downtimePayloadOf(downtime)!.applied).toBe(false);
    // ...and the record is dated where the downtime HAPPENED (the GM's clock), not where it will end.
    expect(downtime.inWorldDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(store.proposedDateFor(downtime)).toEqual({ year: 1492, month: 1, day: 10 });

    // 2. The explicit confirmation moves it, and marks the record.
    const applied = store.applyDowntime(downtime.id);
    expect(applied.calendar.currentDate).toEqual({ year: 1492, month: 1, day: 10 });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 10 });
    expect(applied.entry.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true });
    expect(downtimePayloadOf(store.getEntry(downtime.id)!)!.applied).toBe(true);   // re-read, so it is the stored row
    expect(applied.entry.inWorldDate).toEqual({ year: 1492, month: 0, day: 10 });  // the record did not re-date itself
    expect(store.proposedDateFor(applied.entry)).toBeNull();            // nothing left to propose

    // 3. Applying again is a stale page or a double-submit. It throws — a silent no-op would tell the GM
    //    their click worked — and above all it does not move the clock a second time.
    expect(() => store.applyDowntime(downtime.id)).toThrow(CodexRevisionConflictError);
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 10 });

    // Neighbouring rejections, so "throws" above is the applied guard and not a blanket refusal.
    const note = store.createEntry({ playerText: "not downtime" });
    expect(() => store.applyDowntime(note.id)).toThrow(/downtime/);
    expect(store.proposedDateFor(note)).toBeNull();
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 10 });

    // D11-H: none of this published anything. The party's clock is still the FIRST date this codex was
    // given (which publishes itself — see the O-1 test below); every move after that one is private, and
    // this test's setCalendar and applyDowntime are all moves after it.
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });
  });

  /**
   * T-5. D11-F / F-2. `applyDowntime` writes the entry AND the calendar, and half of it is worse than
   * neither: an applied flag with an unmoved clock swallows the days, a moved clock with an unapplied flag
   * lets the next confirmation move them again.
   *
   * The failure is forced in SQLite, not in JavaScript, by a trigger that aborts the calendar write — so
   * this exercises the real `BEGIN IMMEDIATE` / `ROLLBACK` path rather than a stubbed method. The entry
   * write happens FIRST in `applyDowntime`, so if the two writes were in separate transactions the entry
   * would already be committed by the time the calendar write dies. That is exactly the mutation this
   * catches.
   */
  it("applyDowntime is one transaction: a failed calendar write rolls the entry write back too (D11-F)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30 } });

    // Fires on the calendar write specifically, so `bumpRevision` (also an UPDATE on codex_meta) is untouched.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.exec("CREATE TRIGGER codex_test_block_calendar AFTER UPDATE OF calendar_json ON codex_meta BEGIN SELECT RAISE(ABORT, 'no calendar writes'); END;");
    raw.close();

    expect(() => store.applyDowntime(downtime.id)).toThrow();

    // BOTH sides unchanged. Re-read from the store, not from the value captured above.
    expect(store.getEntry(downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });

    // ...and with the obstruction gone it still works, so the assertions above are the rollback and not a
    // store that had quietly stopped writing anything at all.
    const unblock = new DatabaseSync(join(directory, "vtt.sqlite"));
    unblock.exec("DROP TRIGGER codex_test_block_calendar");
    unblock.close();
    expect(store.applyDowntime(downtime.id).calendar.currentDate).toEqual({ year: 1492, month: 1, day: 10 });
    expect(downtimePayloadOf(store.getEntry(downtime.id)!)!.applied).toBe(true);
  });

  /**
   * T-6. F-3, proven rather than asserted. The spec called K3 "sharpest here" on the grounds that M11 moves
   * `currentDate` and `setCalendar` reflows every dated record on every call. It is not: `calendarInstantOf`
   * reads only `months`, and `formatInWorldDate` reads `months`, `yearName` and `weekdays`. NEITHER reads
   * `currentDate`, so moving the clock rewrites every dated row with byte-identical values — wasted work,
   * not corruption.
   *
   * The reflow risk belongs to calendar-SHAPE edits, which M11 does not perform. This is the test that keeps
   * that true: wire the clock into either derivation and every dated record in the codex silently re-dates
   * itself the next time a GM advances the campaign by a day.
   */
  it("a currentDate-only calendar write leaves every dated record byte-identical (F-3)", () => {
    const calendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 28 }, { name: "Ches", days: 31 }], weekdays: ["First", "Second", "Third"] };
    store.setCalendar({ ...calendar, currentDate: { year: 1492, month: 0, day: 1 } });
    store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1400, month: 0, day: 1 } });
    store.createEntry({ playerText: "The siege.", inWorldDate: { year: 1492, month: 1, day: 17 } });
    store.createEntry({ playerText: "The war.", inWorldDate: { year: 1493, month: 2, day: 31 } });
    store.createEntry({ playerText: "Someday." });                                                  // undated
    store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1450, month: 1, day: 9 } });
    store.createPage({ title: "The Peace", entityType: "event", inWorldDate: { year: 1500, month: 2, day: 2 } });
    store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });

    const derived = () => {
      const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
      const rows = ["codex_journal", "codex_pages"].flatMap((table) =>
        raw.prepare(`SELECT id, calendar_instant, in_world_label, in_world_year, in_world_month, in_world_day FROM ${table} ORDER BY id`).all());
      raw.close();
      return rows;
    };
    const before = derived();
    expect(before.filter((row) => (row as { calendar_instant: number | null }).calendar_instant !== null)).toHaveLength(6);

    // The clock moves a long way — a different year, month and day — with the calendar's SHAPE untouched.
    store.setCalendar({ ...calendar, currentDate: { year: 1600, month: 2, day: 30 } });

    expect(derived()).toEqual(before);                              // every instant and every label, unchanged
    expect(store.getCalendar().currentDate).toEqual({ year: 1600, month: 2, day: 30 });  // ...and the clock did move
  });

  /**
   * T-7. F-4 / F-7. Passing time is `dateForInstant(instant + days)` and nothing else — the month-walking
   * arithmetic that already round-trips a dated entry, reused rather than reimplemented. The trap it avoids
   * is `normalizeCalendar`, which clamps `currentDate.day` only to `>= 1` and NOT to the month's length: a
   * naive `day + days` would store day 40 of a 30-day month, which then computes instants as day 30. That
   * is the one lossy date in the system, and it is the one this milestone mutates.
   */
  it("passing time rolls over the month and the year instead of clamping (F-4, F-7)", () => {
    const advance = (from: { year: number; month: number; day: number }, days: number) => {
      store.setCalendar({ ...store.getCalendar(), currentDate: from });
      const downtime = store.createDowntime({ playerText: "waiting", downtime: { who: "The party", activity: "Waiting", days } });
      const proposed = store.proposedDateFor(downtime);
      // The proposal and the applied result must AGREE — the GM confirms a date, so the date they were
      // shown has to be the date they get.
      expect(store.applyDowntime(downtime.id).calendar.currentDate).toEqual(proposed);
      return proposed;
    };
    // Default calendar: 12 months x 30 days.
    expect(advance({ year: 1492, month: 0, day: 25 }, 10)).toEqual({ year: 1492, month: 1, day: 5 });    // month rollover
    expect(advance({ year: 1492, month: 11, day: 25 }, 10)).toEqual({ year: 1493, month: 0, day: 5 });   // year rollover
    expect(advance({ year: 1492, month: 0, day: 1 }, 95)).toEqual({ year: 1492, month: 3, day: 6 });     // several months at once
    expect(advance({ year: 1492, month: 0, day: 1 }, 720)).toEqual({ year: 1494, month: 0, day: 1 });    // two whole years
    expect(advance({ year: 1492, month: 5, day: 12 }, 0)).toEqual({ year: 1492, month: 5, day: 12 });    // zero days is a legal no-op

    // Uneven months, so this is a real walk and not "every month is 30 days" getting lucky.
    store.setCalendar({ yearName: "AE", months: [{ name: "Short", days: 5 }, { name: "Long", days: 40 }, { name: "Mid", days: 20 }], weekdays: [] });
    expect(advance({ year: 3, month: 0, day: 4 }, 3)).toEqual({ year: 3, month: 1, day: 2 });            // 5-day month
    expect(advance({ year: 3, month: 1, day: 39 }, 5)).toEqual({ year: 3, month: 2, day: 4 });           // 40-day month
    expect(advance({ year: 3, month: 2, day: 19 }, 3)).toEqual({ year: 4, month: 0, day: 2 });           // 20-day month -> new year
  });

  /**
   * T-8. D11-C: `fired` is DERIVED on every read and stored nowhere. K3 makes raw dates the source of truth
   * and instants derived; a stored `fired` would be a SECOND derived cache that `setCalendar`'s reflow would
   * have to maintain, and a reflow that missed it would leave a deadline permanently fired on a day that no
   * longer exists.
   *
   * The rewind is the assertion that can only pass if it is genuinely derived: nothing un-sets a stored
   * flag, so a cached `fired` survives the clock going backwards and the deadline stays fired forever.
   */
  /**
   * A deadline may not have its date EDITED away (D11-C / CT-5).
   *
   * `createDeadline` has always enforced "a deadline IS its date"; `updateEntry` did not, and it is the
   * door a GM uses more often. Clearing the date left `kind = 'deadline'` on a row with no instant to
   * compare — so it read "Deadline · Approaching" on the GM journal, the dashboard card and every
   * player's timeline, and could never fire however far the clock ran. Found by adversarial review,
   * reproduced through the real HTTP route before this was written.
   */
  it("refuses to edit a deadline's date away, and leaves the record untouched when it refuses (D11-C)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });

    expect(() => store.updateEntry(deadline.id, { inWorldDate: null })).toThrow(/needs an in-world date/);

    // The refusal is total: the date it already had is still there, so a rejected edit cannot half-apply.
    const after = store.getEntry(deadline.id)!;
    expect(after.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    expect(after.calendarInstant).toBe(deadline.calendarInstant);
    expect(after.kind).toBe("deadline");
    // ...and it still fires when the clock reaches it, which is the property the bug destroyed.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant())).toBe(true);

    // Moving a deadline's date is still ordinary editing — only REMOVING it is refused.
    const moved = store.updateEntry(deadline.id, { inWorldDate: { year: 1492, month: 3, day: 1 } });
    expect(moved.inWorldDate).toEqual({ year: 1492, month: 3, day: 1 });
    // And every other kind may still be undated, which is how a note works.
    const note = store.createEntry({ playerText: "a note", inWorldDate: { year: 1492, month: 0, day: 5 } });
    expect(store.updateEntry(note.id, { inWorldDate: null }).inWorldDate).toBeNull();
  });

  /**
   * The FIRST campaign date a codex is ever given reaches players without a separate publish (O-1).
   *
   * v15 backfills the published date for an EXISTING campaign, so upgrading changes nothing. A campaign
   * created after M11 has nothing to backfill, and without this the GM sets "the world's now" and every
   * player's date stays blank — a silent regression against what every pre-M11 campaign did, with the
   * only explanation on a different screen. Publishing here leaks nothing: the prep clock exists to run
   * AHEAD of the party, and there is no ahead of a date they have never been given.
   */
  it("publishes the first campaign date automatically, and keeps every later move private (O-1)", () => {
    expect(store.getPublishedDate()).toBeNull();

    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });   // the party has a date

    // From here the prep clock is private again — this is the whole of O-1 and the automatic publish
    // must not have weakened it.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 5, day: 2 } });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 5, day: 2 });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });

    // Applying downtime is a clock move like any other, so it must not publish either.
    const downtime = store.createDowntime({ playerText: "A week off.", downtime: { who: "Vex", activity: "Resting", days: 7 } });
    store.applyDowntime(downtime.id);
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });

    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual(store.getCalendar().currentDate);
  });

  it("a deadline's fired state is derived from the clock, in both directions (D11-C)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });
    // Reads exactly as a GM-facing caller does: `deadlineFired` against the GM's own clock.
    const fired = () => deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant());

    expect(fired()).toBe(false);                                                        // the day has not come
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 13 } });
    expect(fired()).toBe(false);                                                        // ...nor the day before
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    expect(fired()).toBe(true);                                                         // "passes it" includes the day itself
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 1 } });
    expect(fired()).toBe(true);
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    expect(fired()).toBe(false);                                                        // rewound — nothing cached it

    // Nothing about `fired` is written down: `payload_json` stays null for a deadline, in the FILE.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    const stored = raw.prepare("SELECT payload_json FROM codex_journal WHERE id = ?").get(deadline.id) as { payload_json: string | null };
    raw.close();
    expect(stored.payload_json).toBeNull();

    // Only a deadline fires, and an undated record never can.
    const note = store.createEntry({ playerText: "a note", inWorldDate: { year: 1000, month: 0, day: 1 } });
    expect(deadlineFired(note, store.campaignInstant())).toBe(false);
    expect(deadlineFired({ kind: "deadline", calendarInstant: null }, 999_999)).toBe(false);
    expect(deadlineFired({ kind: "deadline", calendarInstant: 0 }, null)).toBe(false);   // no clock, nothing to pass

    // D11-G / prohibition 3: the two clocks answer this question separately. With the GM's clock past the
    // deadline and the published clock BEHIND it, the player-facing derivation must still read "not fired"
    // — otherwise one boolean tells the party the GM has run their private prep clock ahead.
    //
    // The published clock is behind rather than absent because the first date a codex is given publishes
    // itself (there is no "ahead of the party" before the party has any date at all); it is every LATER
    // move that is private, and that is the one under test here.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 1 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant())).toBe(true);
    expect(deadlineFired(store.getEntry(deadline.id)!, store.publishedInstant())).toBe(false);
    // ...and publishing is what lets the party in on it.
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1493, month: 0, day: 1 });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.publishedInstant())).toBe(true);
  });

  /**
   * O-1's prep clock, on its own. The GM's clock and the players' are two values, and only an explicit
   * publish copies one to the other (D11-H). Advancing — by hand or via downtime — must never do it.
   */
  it("keeps the GM's clock and the published clock apart until the GM publishes (O-1, D11-H)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    // The GM runs ahead while prepping. Players stay where they were.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 6, day: 20 } });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 6, day: 20 });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    // Downtime does not publish either — it moves the GM's clock only.
    const downtime = store.createDowntime({ playerText: "prep", downtime: { who: "GM", activity: "Prepping", days: 10 } });
    store.applyDowntime(downtime.id);
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 6, day: 30 });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    // Only this does.
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual(store.getCalendar().currentDate);

    // Publishing with no GM clock CLEARS the published date rather than leaving a stale one behind.
    store.setCalendar({ ...store.getCalendar(), currentDate: null });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toBeNull();
  });

  /**
   * T-14. A GM's backup is their only copy. `publishedDate` lives in three columns on `codex_meta` and
   * nowhere else, so a bundle without it restores a codex where the two clocks silently agree — the party
   * jumped forward to wherever the GM's prep had reached.
   *
   * There is no `importBundle` in this store (see the report): the round-trip that DOES exist is the one a
   * GM actually performs — close the service, reopen it on the same file — so it is asserted here as well,
   * over a store that re-runs every migration on the way in.
   */
  it("carries a downtime payload and the published date through export and a reopen (T-14)", async () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 3, day: 8 } });
    store.publishCampaignDate();
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 9, day: 2 } });   // GM runs ahead
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30 } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 11, day: 1 } });

    const bundle = store.exportBundle();
    expect(bundle.publishedDate).toEqual({ year: 1492, month: 3, day: 8 });                        // NOT the GM's clock
    expect(bundle.journal.find((entry) => entry.id === downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false });
    expect(bundle.journal.find((entry) => entry.id === downtime.id)!.kind).toBe("downtime");
    expect(bundle.journal.find((entry) => entry.id === deadline.id)!.kind).toBe("deadline");
    expect(bundle.journal.find((entry) => entry.id === deadline.id)!.payload).toBeNull();

    // ...and `applied` rides along, or a restored codex would offer to pass the same 30 days again.
    store.applyDowntime(downtime.id);
    expect(downtimePayloadOf(store.exportBundle().journal.find((entry) => entry.id === downtime.id)!)!.applied).toBe(true);

    // The real round-trip: shut the service down and bring it back up on the same file.
    const path = join(directory, "vtt.sqlite");
    store.close();
    const reopened = new CodexStore(path);
    await reopened.initialize();
    try {
      expect(reopened.getPublishedDate()).toEqual({ year: 1492, month: 3, day: 8 });
      expect(reopened.getEntry(downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true });
      expect(reopened.getEntry(deadline.id)!.kind).toBe("deadline");
      expect(reopened.exportBundle().publishedDate).toEqual({ year: 1492, month: 3, day: 8 });
    } finally {
      reopened.close();
    }
    // `afterEach` closes `store`; a second close is a no-op, so reopening it here keeps that honest.
    store = new CodexStore(path);
    await store.initialize();
  });
});

/**
 * M12 (CT-6 standing, CT-7 party marker, CT-8 milestones) — the STORE layer, below any projection.
 *
 * Migration v16 is ADDITIVE, which makes it far less dangerous than v15's rebuild and creates a different
 * risk: an additive migration looks obviously safe, so nobody checks it. `migration v16 …` below therefore
 * seeds a genuine v15 database and upgrades it, exactly as a GM's existing `vtt.sqlite` will.
 *
 * The other thing this block exists to catch is silence. Two of M12's failure modes produce no error and no
 * compile error anywhere: a `milestone` row that reads back as `note` because `JOURNAL_KINDS` was not
 * widened, and a second party marker because `setPartyMarker` forgot to clear the first.
 */
describe("CodexStore standing, party marker + milestones (M12)", () => {
  /** A genuine v1..v15 database on disk, seeded by the caller, ready for a CodexStore to upgrade to v16. */
  const legacyV15Database = (path: string): DatabaseSync => {
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 15)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
    }
    return database;
  };
  const faction = (title: string) => store.createPage({ title, entityType: "faction" });

  /**
   * T-1 (K7). Every pre-existing marker and journal row survives v16 untouched, and `is_party` arrives as 0
   * on all of them.
   *
   * Asserted on raw SQL, not through `toMarker`, for the reason M11's equivalent gives: a projection that
   * dropped a column would read null on both sides and the comparison would pass. The JOURNAL half is here
   * even though v16 does not name that table — that is precisely the assertion. v15 already widened its
   * CHECK to admit `milestone` and `standing`, so M12's temptation is a second rebuild "to be safe", and a
   * second rebuild is the one operation that could lose these rows. If this test ever starts failing on the
   * journal columns, someone has rebuilt a table that did not need rebuilding.
   */
  it("migration v16 adds is_party and codex_standing without disturbing a single existing row (K7, T-1)", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v15-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = legacyV15Database(path);
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 7)").run();
      const mapId = crypto.randomUUID(), pageId = crypto.randomUUID();
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, 'Barovia', 'regional', NULL, 1, 1, '[]', '', '')").run(mapId, crypto.randomUUID());
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, 'The Harpers', 'faction', '{}', '{}', NULL, '[]', 'a network', 'they are compromised', 0, NULL, 1, '', '')").run(pageId);

      // Three markers with everything a marker can carry, so a rebuilt-instead-of-altered table would show.
      const insertMarker = database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const plain = crypto.randomUUID(), linked = crypto.randomUUID(), hidden = crypto.randomUUID();
      insertMarker.run(plain, mapId, 0.5, 0.5, "pin", "#FF2E9A", "Svalich Road", 1, "[]", null, "[]", null, '[]', "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      insertMarker.run(linked, mapId, 12, 34, "castle", "#2DE2FF", "Castle Ravenloft", 1, JSON.stringify([pageId]), null, JSON.stringify([crypto.randomUUID()]), crypto.randomUUID(), '["landmark"]', "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
      insertMarker.run(hidden, mapId, 1, 2, "town", "#A45CFF", null, 0, "[]", null, "[]", null, '[]', "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z");

      const insertEntry = database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, sort_key, tags_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const note = crypto.randomUUID(), downtime = crypto.randomUUID();
      insertEntry.run(note, "The mists parted.", "Strahd watched.", 1, plain, pageId, "note", null, 2, "2026-01-04", null, null, null, null, null, 1, '["travel"]', null, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z");
      insertEntry.run(downtime, "Vex brews poison.", null, 0, null, null, "downtime", null, null, null, null, null, null, null, null, 2, '[]', JSON.stringify({ who: "Vex", activity: "Brewing poison", days: 30, applied: true }), "2026-01-05T00:00:00.000Z", "2026-01-05T00:00:00.000Z");

      const markersBefore = database.prepare("SELECT * FROM codex_markers ORDER BY id").all();
      const journalBefore = database.prepare("SELECT * FROM codex_journal ORDER BY id").all();
      const journalColumnsBefore = (database.prepare("PRAGMA table_info(codex_journal)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      expect(markersBefore).toHaveLength(3);
      expect(journalBefore).toHaveLength(2);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();                                  // <- v16 runs here

      const reopened = new DatabaseSync(path);
      const markersAfter = reopened.prepare("SELECT * FROM codex_markers ORDER BY id").all() as Array<Record<string, unknown>>;
      const journalAfter = reopened.prepare("SELECT * FROM codex_journal ORDER BY id").all();
      const journalColumnsAfter = (reopened.prepare("PRAGMA table_info(codex_journal)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      const markerColumns = (reopened.prepare("PRAGMA table_info(codex_markers)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      const standingColumns = (reopened.prepare("PRAGMA table_info(codex_standing)").all() as Array<Record<string, unknown>>).map((column) => column.name);
      reopened.close();

      expect(markersAfter).toHaveLength(markersBefore.length);      // nothing dropped, nothing duplicated
      for (const [index, original] of markersBefore.entries()) {
        const { is_party: isParty, ...carried } = markersAfter[index];
        expect(carried).toEqual(original);                          // EVERY pre-existing column, value for value
        expect(isParty).toBe(0);                                    // ...and the new one defaults to "not the party"
      }
      // `codex_journal` is byte-identical, rows AND schema: v16 must not touch it (v15 already did the work).
      expect(journalAfter).toEqual(journalBefore);
      expect(journalColumnsAfter).toEqual(journalColumnsBefore);

      // The new column is the LAST one and carries the declared type/NOT NULL/DEFAULT, so an existing
      // codex needs no backfill pass to be correct.
      expect(markerColumns.at(-1)).toEqual(["is_party", "INTEGER", 1, "0"]);
      expect(standingColumns).toEqual(["id", "faction_page_id", "value", "revealed", "created_at", "updated_at"]);

      // The rows still READ correctly through the store's own path, and nothing is the party yet.
      expect(upgraded.getMarker(linked)!.pageIds).toEqual([pageId]);
      expect(upgraded.getMarker(linked)!.tags).toEqual(["landmark"]);
      expect(upgraded.getMarker(hidden)!.revealedToPlayers).toBe(false);
      expect(upgraded.listMarkers(mapId).every((marker) => marker.isParty === false)).toBe(true);
      expect(upgraded.partyMarker()).toBeNull();
      expect(upgraded.getEntry(downtime)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true });
      expect(upgraded.getEntry(note)!.tags).toEqual(["travel"]);
      // An empty standing table on every existing codex is the correct and complete upgrade — there has
      // never been a standing to back-fill from (v14's reasoning for quests, verbatim).
      expect(upgraded.listStanding()).toEqual([]);
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  /**
   * T-2 (M12-C). Exactly one party marker exists atlas-wide, and flagging a second CLEARS the first in one
   * step rather than erroring.
   *
   * Both halves of the invariant are asserted, because they fail differently and either alone is a trap:
   *   - the PROCESS half (`setPartyMarker` clears before it sets) — drop the clear and the second flag
   *     raises a UNIQUE constraint the GM never asked about;
   *   - the FILE half (v16's partial unique index) — drop it and the store still behaves, right up until a
   *     repair script or a manual sqlite3 session leaves two party pins that no screen can reconcile.
   * The second is checked by writing raw SQL AROUND the store, which is the only way to see it at all.
   *
   * Crucially the pins are on DIFFERENT MAPS: M12-C is one party marker for the whole ATLAS, not one per
   * map, so a per-map rule would pass every assertion here except this one.
   */
  it("only one marker can be the party at a time, atlas-wide (M12-C, T-2)", () => {
    const barovia = store.createMap({ assetId: ASSET, name: "Barovia", kind: "regional" });
    const faerun = store.createMap({ assetId: ASSET, name: "Faerûn", kind: "world" });
    const village = store.createMarker(barovia.id, { x: 10, y: 10, iconId: "town", iconColor: "#ff2e9a", label: "Village" });
    const castle = store.createMarker(barovia.id, { x: 20, y: 20, iconId: "castle", iconColor: "#2de2ff", label: "Castle" });
    const waterdeep = store.createMarker(faerun.id, { x: 30, y: 30, iconId: "town", iconColor: "#a45cff", label: "Waterdeep" });

    expect(store.partyMarker()).toBeNull();                          // nothing is the party until the GM says so
    expect(store.setPartyMarker(village.id)!.isParty).toBe(true);
    expect(store.partyMarker()!.id).toBe(village.id);

    // Flagging a second pin on the SAME map moves the party rather than erroring.
    store.setPartyMarker(castle.id);
    expect(store.partyMarker()!.id).toBe(castle.id);
    expect(store.getMarker(village.id)!.isParty).toBe(false);

    // ...and so does flagging one on a DIFFERENT map. This is the assertion a per-map design fails.
    store.setPartyMarker(waterdeep.id);
    expect(store.partyMarker()!.id).toBe(waterdeep.id);
    expect(store.listMarkers(barovia.id).filter((marker) => marker.isParty)).toHaveLength(0);
    expect(store.listMarkers(faerun.id).filter((marker) => marker.isParty).map((marker) => marker.id)).toEqual([waterdeep.id]);

    // The FILE's half: a write that goes around the store cannot produce a second party pin.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    try {
      expect(() => raw.exec(`UPDATE codex_markers SET is_party = 1 WHERE id = '${village.id}'`)).toThrow(/UNIQUE/);
      // ...while any number of NON-party pins coexist, which is what makes the index's WHERE clause
      // load-bearing rather than decorative (v13's `codex_sessions_number` predicate is only intent).
      expect((raw.prepare("SELECT COUNT(*) AS c FROM codex_markers WHERE is_party = 0").get() as { c: number }).c).toBe(2);
    } finally { raw.close(); }

    // `null` clears it entirely, and a party pin is otherwise an ORDINARY marker: it moves by the ordinary
    // move path, reveals by the ordinary switch, and deletes by the ordinary delete.
    store.setPartyMarker(waterdeep.id);
    expect(store.moveMarker(waterdeep.id, 44, 55).isParty).toBe(true);
    expect(store.updateMarker(waterdeep.id, { label: "Waterdeep, City of Splendours" }).isParty).toBe(true);
    expect(store.setMarkerRevealed(waterdeep.id, true).isParty).toBe(true);
    expect(store.setPartyMarker(null)).toBeNull();
    expect(store.partyMarker()).toBeNull();
    expect(store.getMarker(waterdeep.id)!.isParty).toBe(false);

    // Deleting the party pin simply leaves the atlas with no party pin — the state a fresh codex is in.
    store.setPartyMarker(castle.id);
    store.deleteMarker(castle.id);
    expect(store.partyMarker()).toBeNull();
    // ...and so does deleting the MAP it sat on, via the existing marker cascade.
    store.setPartyMarker(village.id);
    store.deleteMap(barovia.id);
    expect(store.partyMarker()).toBeNull();

    expect(() => store.setPartyMarker(crypto.randomUUID())).toThrow(/no longer exists/);
  });

  /**
   * T-3 (F-7). `setStanding` writes the standing table AND appends its chronicle record, and half of it is
   * worse than neither: a moved bar with no record loses the history the spec puts on the timeline (it
   * exists nowhere else), and a record with no moved bar leaves the campaign's history disagreeing with the
   * campaign's state.
   *
   * The failure is forced in SQLITE, not in JavaScript, by a trigger that aborts the journal write — so
   * this exercises the real `BEGIN IMMEDIATE` / `ROLLBACK` path rather than a stubbed method. The standing
   * write happens FIRST, so if the two were separate transactions (a nested `this.transaction`, which
   * cannot nest, or two sequential ones) the standing row would already be committed when the record dies.
   * That is exactly the mutation this catches.
   */
  it("setStanding is one transaction: a failed chronicle write rolls the value back too (F-7, T-3)", () => {
    const harpers = faction("The Harpers");
    store.setStanding(harpers.id, 40, "Saved the caravan.");
    expect(store.getStanding(harpers.id)!.value).toBe(40);

    // Fires on the chronicle record specifically, so the standing UPDATE itself is untouched.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.exec("CREATE TRIGGER codex_test_block_standing_record AFTER INSERT ON codex_journal WHEN NEW.kind = 'standing' BEGIN SELECT RAISE(ABORT, 'no standing records'); END;");
    raw.close();

    expect(() => store.setStanding(harpers.id, -80, "Betrayed them.")).toThrow();

    // BOTH sides unchanged. Re-read from the store, not from the value captured above.
    expect(store.getStanding(harpers.id)!.value).toBe(40);
    expect(store.listChronicle().filter((record) => record.kind === "entry" && record.entry.kind === "standing")).toHaveLength(1);

    // ...and with the obstruction gone it still works, so the assertions above are the rollback and not a
    // store that had quietly stopped writing anything at all.
    const unblock = new DatabaseSync(join(directory, "vtt.sqlite"));
    unblock.exec("DROP TRIGGER codex_test_block_standing_record");
    unblock.close();
    expect(store.setStanding(harpers.id, -80, "Betrayed them.").value).toBe(-80);
    expect(store.listChronicle().filter((record) => record.kind === "entry" && record.entry.kind === "standing")).toHaveLength(2);

    // The reverse direction of the same invariant: a rejected FIRST-ever set leaves NO row behind, so an
    // aborted create cannot leave a faction sitting at a value with no history explaining it.
    const zhents = faction("The Zhentarim");
    const block = new DatabaseSync(join(directory, "vtt.sqlite"));
    block.exec("CREATE TRIGGER codex_test_block_standing_record AFTER INSERT ON codex_journal WHEN NEW.kind = 'standing' BEGIN SELECT RAISE(ABORT, 'no standing records'); END;");
    block.close();
    expect(() => store.setStanding(zhents.id, 25, "An uneasy truce.")).toThrow();
    expect(store.getStanding(zhents.id)).toBeNull();
    expect(store.listStanding().map((row) => row.factionPageId)).toEqual([harpers.id]);
  });

  /**
   * T-4 (M12-B). The scale is SIGNED and bounded, and the chronicle record says what CHANGED, not where
   * things ended up.
   *
   * The delta half is the one worth stating: the table holds the position and the timeline holds the
   * movements, so a record carrying the new VALUE would be a second copy of the table's fact — the copy
   * that goes stale the moment a record is deleted. `+40 then -60` must read as `+40, -60` and leave the
   * bar at -20; a value-carrying record would read `40, -20` and no reader could tell what happened.
   */
  it("standing clamps to -100..100 and its record carries the delta, not the new value (M12-B, T-4)", () => {
    const harpers = faction("The Harpers");
    const standingDeltas = () => store.listChronicle()
      .flatMap((record) => record.kind === "entry" && record.entry.kind === "standing" ? [record.entry.payload as { factionPageId: string; delta: number; reason: string }] : []);
    // Addressed by REASON, never by list position. `listChronicle` breaks a `created_at` tie on the record
    // id, which is a random UUID, so two records written inside the same millisecond come back in an
    // arbitrary (if stable) order — asserting on `.at(-1)` would be a coin flip, not a test.
    const deltaFor = (reason: string) => standingDeltas().find((payload) => payload.reason === reason)!;

    // A first-ever set moves from 0 (Neutral): the delta IS the value, and only this once.
    expect(store.setStanding(harpers.id, 40, "Saved the caravan.").value).toBe(40);
    expect(deltaFor("Saved the caravan.")).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });

    // A later set is a MOVEMENT from where things stood. 40 -> -20 is -60, not -20.
    expect(store.setStanding(harpers.id, -20, "Sold them out.").value).toBe(-20);
    expect(deltaFor("Sold them out.")).toEqual({ factionPageId: harpers.id, delta: -60, reason: "Sold them out." });

    // Clamped, not rejected: the ends of the scale are meaningful answers, and the DELTA is computed from
    // the clamped value so the history still adds up to the table (-20 -> 100 is +120, not +1020).
    expect(store.setStanding(harpers.id, 1000, "Saved the High Harper.").value).toBe(100);
    expect(deltaFor("Saved the High Harper.").delta).toBe(120);
    expect(store.setStanding(harpers.id, -9999, "Burned their safehouse.").value).toBe(-100);
    expect(deltaFor("Burned their safehouse.").delta).toBe(-200);
    // Fractions truncate rather than writing a REAL into a STRICT INTEGER column.
    expect(store.setStanding(harpers.id, 12.9, "Made partial amends.").value).toBe(12);
    // NaN/Infinity are an error, not a clamp — clamping either would write it straight into the column.
    expect(() => store.setStanding(harpers.id, Number.NaN, "?")).toThrow(/number/);
    expect(() => store.setStanding(harpers.id, Number.POSITIVE_INFINITY, "?")).toThrow(/number/);

    // The deltas sum to exactly where the bar stands, which is the whole point of storing the change.
    expect(standingDeltas().reduce((sum, payload) => sum + payload.delta, 0)).toBe(store.getStanding(harpers.id)!.value);

    // A set that changes nothing still records the GM's reason: suppressing it would be a hidden rule.
    store.setStanding(harpers.id, 12, "We held the line.");
    expect(deltaFor("We held the line.")).toEqual({ factionPageId: harpers.id, delta: 0, reason: "We held the line." });

    // Adjusting a number is not a disclosure decision: reveal state survives every set, both ways.
    expect(store.getStanding(harpers.id)!.revealedToPlayers).toBe(false);      // O-2: starts hidden
    store.setStandingRevealed(harpers.id, true);
    expect(store.setStanding(harpers.id, 5, "Slipped a little.").revealedToPlayers).toBe(true);
    store.setStandingRevealed(harpers.id, false);
    expect(store.setStanding(harpers.id, 50, "Recovered.").revealedToPlayers).toBe(false);

    // Spec §2.1: standing is tracked against a FACTION. SQLite cannot express that in a foreign key, so
    // this is the only place it can be said, and it is said with a message a GM can read.
    const strahd = store.createPage({ title: "Strahd", entityType: "character" });
    expect(() => store.setStanding(strahd.id, 10, "?")).toThrow(/faction/);
    expect(() => store.setStanding(crypto.randomUUID(), 10, "?")).toThrow(/no longer exists/);
    expect(() => store.setStandingRevealed(crypto.randomUUID(), true)).toThrow(/no standing/);
  });

  /**
   * T-5 (F-3). A `milestone` and a `standing` row round-trip as THEMSELVES rather than collapsing to
   * `"note"`.
   *
   * This is the M12 failure with no symptom. `toEntry` parses `kind` fail-closed, so a `JOURNAL_KINDS` set
   * that was never widened produces no throw, no compile error and no bad data — just a GM's milestone
   * rendering as an ordinary note on every screen forever. Read back through a SECOND read, so it is the
   * stored row talking and not the create call's return value.
   */
  it("a milestone and a standing record round-trip as themselves, not as notes (F-3, T-5)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    const harpers = faction("The Harpers");
    const milestone = store.createMilestone({ playerText: "The party cleared the crypt.", milestone: { level: 5, reason: "Sealed the ossuary" } });
    store.setStanding(harpers.id, 40, "Saved the caravan.");
    // Asserted BEFORE anything is looked up by kind, so the collapse-to-`note` failure reports itself as
    // "expected 'note' to be 'milestone'" rather than as an undefined further down the test.
    expect(milestone.kind).toBe("milestone");
    const standingEntries = store.listTimeline().filter((entry) => entry.kind === "standing");
    expect(standingEntries).toHaveLength(1);
    const standing = standingEntries[0];

    for (const [id, kind] of [[milestone.id, "milestone"], [standing.id, "standing"]] as const) {
      expect(store.getEntry(id)!.kind).toBe(kind);
      expect(store.listTimeline().find((entry) => entry.id === id)!.kind).toBe(kind);
      const record = store.listChronicle().find((candidate) => candidate.kind === "entry" && candidate.entry.id === id)!;
      expect(record.kind === "entry" && record.entry.kind).toBe(kind);
    }

    // Each carries ITS OWN payload shape, and only for its own kind — a stray payload cannot cross kinds.
    expect(store.getEntry(milestone.id)!.payload).toEqual({ level: 5, reason: "Sealed the ossuary" });
    expect(store.getEntry(standing.id)!.payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });
    expect(store.createEntry({ playerText: "plain" }).payload).toBeNull();

    // Dated at the GM's clock when no date is given (`appendCombatEntry` / `createDowntime`'s rule), so
    // both land where they happened instead of sinking below every dated record forever.
    expect(store.getEntry(milestone.id)!.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    expect(store.getEntry(standing.id)!.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });

    // O-2 / P2: hidden on create, revealed by the ORDINARY switch. No kind-specific reveal path exists.
    expect(store.getEntry(milestone.id)!.revealedToPlayers).toBe(false);
    expect(store.getEntry(standing.id)!.revealedToPlayers).toBe(false);
    expect(store.setEntryRevealed(milestone.id, true).revealedToPlayers).toBe(true);

    // Indexed for search exactly as a note is — VERIFIED, not assumed (`writeEntry` calls `indexEntry`).
    expect(store.searchAll("gm", "crypt").some((hit) => hit.kind === "journal" && hit.id === milestone.id)).toBe(true);
    expect(store.searchAll("player", "crypt").some((hit) => hit.id === milestone.id)).toBe(true);     // revealed above
    // ...and PAYLOAD text is NOT indexed, for any kind. A milestone's `reason` and a standing's `reason`
    // are GM-authored prose with no reveal gate of their own; indexing them would put them in the PLAYER
    // index with only the entry's reveal flag between them and a reader. "ossuary" and "caravan" appear
    // only inside a reason and never in a `playerText`, so a hit on either would BE the leak.
    expect(store.searchAll("gm", "ossuary").some((hit) => hit.id === milestone.id)).toBe(false);
    expect(store.searchAll("gm", "caravan").some((hit) => hit.id === standing.id)).toBe(false);

    // A standing record's prose lives in its payload and NOWHERE else — one sentence, one home, one gate.
    expect(store.getEntry(standing.id)!.playerText).toBe("");
    expect(store.getEntry(standing.id)!.gmText).toBeNull();

    // The ordinary journal editor must not eat either payload: `updateEntry` names its columns and
    // `payload_json` is not among them.
    expect(store.updateEntry(milestone.id, { playerText: "The party cleared the crypt at last." }).payload).toEqual({ level: 5, reason: "Sealed the ossuary" });
    expect(store.updateEntry(standing.id, { tags: ["harpers"] }).payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });

    // A level is a stated fact, so it is REJECTED rather than clamped (the deliberate opposite of standing).
    expect(() => store.createMilestone({ milestone: { level: 0, reason: "?" } })).toThrow(/1 to 20/);
    expect(() => store.createMilestone({ milestone: { level: 21, reason: "?" } })).toThrow(/1 to 20/);
    expect(() => store.createMilestone({ milestone: { level: 4.5, reason: "?" } })).toThrow(/1 to 20/);

    // Deleting the faction PAGE cascades its standing row away (there is no "them" to stand with any more)
    // but must leave its HISTORY standing — the timeline is the campaign's record and a page delete must
    // not rewrite it. Both halves of v16's ON DELETE CASCADE decision, asserted rather than assumed.
    store.deletePage(harpers.id);
    expect(store.getStanding(harpers.id)).toBeNull();
    expect(store.listStanding()).toEqual([]);
    expect(store.getEntry(standing.id)).not.toBeNull();          // the history is still THERE...
    expect(store.getEntry(standing.id)!.kind).toBe("standing");  // ...and still a standing record
    expect(store.getEntry(standing.id)!.payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });
  });

  /**
   * T-12. A GM's backup is their only copy. `codex_standing` is a table of its own and exists nowhere else,
   * so a bundle without it restores a codex where every faction is silently back at Neutral — while the
   * `kind='standing'` records still on the timeline describe movements from a position the restored file no
   * longer holds.
   *
   * There is no `importBundle` in this store, so the round-trip that DOES exist is the one a GM actually
   * performs — close the service, reopen it on the same file — and it is asserted here too, over a store
   * that re-runs every migration on the way in (M11's T-14 pattern).
   */
  it("carries standing and the party marker through export and a reopen (T-12)", async () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    const harpers = faction("The Harpers");
    const zhents = faction("The Zhentarim");
    const map = store.createMap({ assetId: ASSET, name: "Barovia", kind: "regional" });
    const village = store.createMarker(map.id, { x: 10, y: 10, iconId: "town", iconColor: "#ff2e9a", label: "Village" });
    store.createMarker(map.id, { x: 20, y: 20, iconId: "castle", iconColor: "#2de2ff", label: "Castle" });
    store.setStanding(harpers.id, 40, "Saved the caravan.");
    store.setStanding(zhents.id, -70, "Burned their safehouse.");
    store.setStandingRevealed(harpers.id, true);
    const milestone = store.createMilestone({ playerText: "Level 5.", milestone: { level: 5, reason: "Cleared the crypt" } });
    store.setPartyMarker(village.id);

    const bundle = store.exportBundle();
    // Keyed by faction rather than compared positionally: `listStanding` breaks a `created_at` tie on the
    // row id, which is a random UUID, so the ORDER of two standings written in the same millisecond is
    // arbitrary. What the bundle must carry is every faction's signed value AND its own reveal state.
    expect(Object.fromEntries(bundle.standing.map((row) => [row.factionPageId, [row.value, row.revealedToPlayers]])))
      .toEqual({ [harpers.id]: [40, true], [zhents.id]: [-70, false] });
    expect(bundle.partyMarkerId).toBe(village.id);
    expect(bundle.markers.filter((marker) => marker.isParty).map((marker) => marker.id)).toEqual([village.id]);
    expect(bundle.journal.find((entry) => entry.id === milestone.id)!.payload).toEqual({ level: 5, reason: "Cleared the crypt" });
    const exportedStandingRecords = bundle.journal.filter((entry) => entry.kind === "standing")
      .map((entry) => entry.payload as { factionPageId: string; delta: number; reason: string });
    expect(exportedStandingRecords).toHaveLength(2);
    expect(Object.fromEntries(exportedStandingRecords.map((payload) => [payload.factionPageId, payload])))
      .toEqual({
        [harpers.id]: { factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." },
        [zhents.id]: { factionPageId: zhents.id, delta: -70, reason: "Burned their safehouse." }
      });

    // The real round-trip: shut the service down and bring it back up on the same file.
    const path = join(directory, "vtt.sqlite");
    store.close();
    const reopened = new CodexStore(path);
    await reopened.initialize();
    try {
      expect(reopened.getStanding(harpers.id)).toMatchObject({ value: 40, revealedToPlayers: true });
      expect(reopened.getStanding(zhents.id)).toMatchObject({ value: -70, revealedToPlayers: false });
      expect(reopened.partyMarker()!.id).toBe(village.id);
      expect(reopened.getEntry(milestone.id)!.kind).toBe("milestone");
      expect(reopened.exportBundle().partyMarkerId).toBe(village.id);
      expect(reopened.exportBundle().standing).toHaveLength(2);
    } finally {
      reopened.close();
    }
    // `afterEach` closes `store`; a second close is a no-op, so reopening it here keeps that honest.
    store = new CodexStore(path);
    await store.initialize();
  });
});
