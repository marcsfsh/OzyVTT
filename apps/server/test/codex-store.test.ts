import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, MIGRATIONS, deadlineFired, downtimePayloadOf, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmConnections, projectPlayerConnections, projectGmPageConnections, projectPlayerPageConnections, projectRevealAudit, projectGmChronicleRecord, projectGmJournalEntry, projectGmMarker, projectGmQuest, projectGmSearchHit, projectGmSession, projectPlayerChronicleRecord, projectPlayerJournalEntry, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerSearchHit, projectPlayerSession } from "../src/codex-projections.js";

/** D6/R4's shipped default, spelled once so the settings tests below say what they are actually about. */
const AUTOSAVE_DEFAULT = { enabled: true, intervalSeconds: 1 } as const;

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
const playerSessionNumbers = (from: CodexStore = store) => ({ unrevealedSessionIds: from.unrevealedSessionIds() });

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
    expect(store.searchAll("gm", "Ravenloft").hits.some((hit) => hit.kind === "map" && hit.id === map.id)).toBe(true);
    expect(store.searchAll("player", "Ravenloft").hits.some((hit) => hit.id === map.id)).toBe(false);
  });

  it("does not return an unrevealed JOURNAL entry to a player", () => {
    const entry = store.createEntry({ playerText: "The vistani warned us" });
    expect(store.searchAll("gm", "vistani").hits.some((hit) => hit.kind === "journal" && hit.id === entry.id)).toBe(true);
    expect(store.searchAll("player", "vistani").hits.some((hit) => hit.id === entry.id)).toBe(false);
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
    expect(store.searchAll("gm", "ledger").hits.some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
    expect(store.searchAll("player", "ledger").hits.some((hit) => hit.id === quest.id)).toBe(false);

    // ...and revealing it makes it findable, so the miss above is the reveal gate and not a missing arm.
    store.setQuestRevealed(quest.id, true);
    expect(store.searchAll("player", "ledger").hits.some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
  });

  it("does not return a REVEALED marker sitting on a SECRET map to a player (CD-6, at the SQL layer)", () => {
    // The flagship case. The pin is shown; the map is not. Players never receive the map, so they must
    // not be able to find the pin either — and that must hold in the QUERY, not only in the projection.
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Hidden", kind: "regional" });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Crypt of Strahd" });
    store.setMarkerRevealed(marker.id, true);                    // pin shown...
    expect(store.getMap(map.id)!.revealedToPlayers).toBe(false);  // ...map still secret
    expect(store.searchAll("gm", "Crypt").hits.some((hit) => hit.kind === "marker" && hit.id === marker.id)).toBe(true);
    expect(store.searchAll("player", "Crypt").hits.some((hit) => hit.id === marker.id)).toBe(false);

    // ...and revealing the map makes it findable, so the miss above is the map gate and not a bad query.
    store.setMapRevealed(map.id, true);
    expect(store.searchAll("player", "Crypt").hits.some((hit) => hit.id === marker.id)).toBe(true);
  });
});

describe("CodexStore search matches tags on every kind (CI-1 + CI-2)", () => {
  it("finds a PAGE by its tag, the same way it finds a tagged map or marker", () => {
    // The asymmetry this pins: maps/markers/journal indexed their tags but pages did not, so one search
    // box answered a tag query differently depending on which record happened to carry the tag.
    const page = store.createPage({ title: "Strahd", tags: ["villain"] });
    store.setPageRevealed(page.id, true);
    const gmHits = store.searchAll("gm", "villain").hits;
    expect(gmHits.some((hit) => hit.kind === "page" && hit.id === page.id)).toBe(true);
    // ...and a player can find it too, because a revealed page's tags are already player-visible.
    expect(store.searchAll("player", "villain").hits.some((hit) => hit.kind === "page" && hit.id === page.id)).toBe(true);
  });

  it("does not surface an UNREVEALED page by its tag to a player", () => {
    const page = store.createPage({ title: "Secret", tags: ["villain"] });
    expect(store.searchAll("gm", "villain").hits.some((hit) => hit.id === page.id)).toBe(true);
    expect(store.searchAll("player", "villain").hits.some((hit) => hit.id === page.id)).toBe(false);
  });

  it("keeps a page's indexed tags in step when they change", () => {
    const page = store.createPage({ title: "Rictavio", tags: ["ally"] });
    store.updatePage(page.id, { tags: ["villain"] }, undefined, "gm");
    expect(store.searchAll("gm", "ally").hits.some((hit) => hit.id === page.id)).toBe(false);
    expect(store.searchAll("gm", "villain").hits.some((hit) => hit.id === page.id)).toBe(true);
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
    const hits = store.searchAll("gm", "Strahd").hits;
    expect(hits[0]).toEqual({ kind: "page", id: named });
    // Recall is unchanged - the mentions are still found, just below the record named for the query.
    expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
  });

  it("ranks identically for a PLAYER, so the two roles never disagree about where Enter lands", () => {
    // Both audiences have their own FTS table; weighting one and not the other would give the GM and the
    // player who type the same name different answers.
    const { named, mentionsA, mentionsB } = seedNamedVersusMentions();
    const hits = store.searchAll("player", "Strahd").hits;
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
      const hits = store.searchAll(audience, "Strahd").hits;
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
      const hits = store.searchAll(audience, "Ravenloft").hits;
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
      const hits = store.searchAll(audience, "Vallaki").hits;
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
    const hits = store.searchAll("player", "Villain").hits;
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
      expect(upgraded.searchAll("gm", "Ravenloft").hits).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "Barovia").hits).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "Svalich").hits).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "mists").hits).toEqual([{ kind: "journal", id: entryId }]);
      // ...including the tags v10 added to those three kinds.
      expect(upgraded.searchAll("player", "gloomy").hits).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "waypoint").hits).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "arrival").hits).toEqual([{ kind: "journal", id: entryId }]);

      // The backfill kept the layers apart: GM-only text landed in the GM index ONLY.
      expect(upgraded.searchAll("player", "crypt").hits).toEqual([]);
      expect(upgraded.searchAll("gm", "crypt").hits).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "watching").hits).toEqual([]);
      expect(upgraded.searchAll("gm", "watching").hits).toEqual([{ kind: "journal", id: entryId }]);

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
    expect(store.searchAll("player", "Blinsky").hits).toEqual([{ kind: "marker", id: marker.id }]);

    // Renaming reindexes: the old text stops matching, the new text starts.
    store.updateMarker(marker.id, { label: "Burgomaster mansion" });
    expect(store.searchAll("gm", "Blinsky").hits).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster").hits).toEqual([{ kind: "marker", id: marker.id }]);

    // A reveal toggle needs no reindex - visibility is resolved against the live row at read time.
    store.setMarkerRevealed(marker.id, false);
    expect(store.searchAll("player", "Burgomaster").hits).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster").hits).toEqual([{ kind: "marker", id: marker.id }]);

    // Deleting the MAP cascades its markers away in SQL; their index rows must go with them, or they
    // would keep matching forever with no live row left to gate them.
    store.deleteMap(map.id);
    expect(store.searchAll("gm", "Burgomaster").hits).toEqual([]);
    expect(store.searchAll("gm", "Vallaki").hits).toEqual([]);
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

    /**
     * ONE checkpoint, from the creation, and that single number now proves two separate things (owner
     * decision, 2026-07-30):
     *  - the update was COALESCED into it. Under the 90-minute default a save this soon after the page's
     *    last checkpoint writes no new revision, which is the whole point of the throttle.
     *  - the reveal still snapshots NOTHING. It never did, and if it started to, this would read 2 - the
     *    assertion the line originally existed for, unchanged in force.
     */
    const revisionCount = store.listRevisions(page.id).length;
    expect(revisionCount).toBe(1);

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
      { sourceKind: "page", sourceId: "", layer: "gm", targetKind: "page", targetRef: "bree", section: null },
      { sourceKind: "page", sourceId: "", layer: "gm", targetKind: "actor", targetRef: "Gandalf", section: null },
      { sourceKind: "page", sourceId: "", layer: "gm", targetKind: "page", targetRef: "keep", section: "Cellar" }
    ]);
  });

  it("builds incoming MENTION connections keyed by title, tagged with the source layer", () => {
    const bree = store.createPage({ title: "Bree" });
    store.createPage({ title: "Road", playerBody: "leads to [[Bree]]", revealedToPlayers: true });
    store.createPage({ title: "Cult", gmBody: "meets near [[Bree]]" }); // gm-layer, unrevealed
    const incoming = store.connectionsForPage(bree.id).filter((row) => row.direction === "in");
    expect(incoming).toHaveLength(2);
    // D8: a mention is a connection with `origin: "mention"` and no id - not a second kind of thing.
    expect(incoming.find((row) => row.otherTitle === "Road")).toMatchObject({ layer: "player", otherRevealed: true, origin: "mention", id: null, otherKind: "page" });
    expect(incoming.find((row) => row.otherTitle === "Cult")).toMatchObject({ layer: "gm", otherRevealed: false, origin: "mention", id: null });
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

  it("player connections exclude gm-layer mentions and unrevealed sources", () => {
    const bree = store.createPage({ title: "Bree" });
    store.createPage({ title: "Road", playerBody: "to [[Bree]]", revealedToPlayers: true });   // visible
    store.createPage({ title: "Cult", gmBody: "near [[Bree]]" });                                // gm-layer secret
    store.createPage({ title: "Draft", playerBody: "mentions [[Bree]]", revealedToPlayers: false }); // player-layer but unrevealed
    const player = projectPlayerPageConnections(store.connectionsForPage(bree.id));
    expect(player.map((row) => row.otherTitle)).toEqual(["Road"]);
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

  it("declares connections, resolves both directions, dedupes, and cascades on page delete", () => {
    const strahd = store.createPage({ title: "Strahd", entityType: "character" });
    const barovia = store.createPage({ title: "Barovia", entityType: "location", revealedToPlayers: true });
    const rel = store.createConnection(strahd.id, { toPageId: barovia.id, label: "  rules  " });
    // D8: the stored value IS the label - trimmed, but neither slugged nor lowercased, because after v22's
    // relabel there is no display mapping left to translate it back through.
    expect(rel).toMatchObject({ fromPageId: strahd.id, toPageId: barovia.id, label: "rules", layer: "player" });
    expect(store.createConnection(strahd.id, { toPageId: barovia.id, label: "rules" }).id, "idempotent on (from, to, label)").toBe(rel.id);
    // ...and re-declaring with a different LAYER is still the same edge - layer is not in the dedupe key,
    // because "declare it again, but GM-only" must not silently create a second parallel edge.
    expect(store.createConnection(strahd.id, { toPageId: barovia.id, label: "rules", layer: "gm" }).id).toBe(rel.id);
    expect(() => store.createConnection(strahd.id, { toPageId: strahd.id, label: "rules" })).toThrow(/itself/);

    const fromStrahd = store.connectionsForPage(strahd.id).filter((row) => row.origin === "declared");
    expect(fromStrahd).toEqual([{ id: rel.id, label: "rules", direction: "out", otherKind: "page", otherId: barovia.id, otherTitle: "Barovia", otherEntityType: "location", otherRevealed: true, origin: "declared", layer: "player", section: null }]);
    expect(store.connectionsForPage(barovia.id)[0]).toMatchObject({ direction: "in", otherId: strahd.id, otherTitle: "Strahd", otherRevealed: false });

    store.deletePage(strahd.id); // cascades the edge
    expect(store.connectionsForPage(barovia.id)).toHaveLength(0);
  });

  it("treats a SYMMETRIC label as one edge in either direction, and a free-text one as directional", () => {
    const a = store.createPage({ title: "The Harpers", entityType: "faction" });
    const b = store.createPage({ title: "The Zhentarim", entityType: "faction" });
    // v22 relabelled `ally` -> `ally of`, and `SYMMETRIC_RELATIONSHIPS` is re-keyed to match. If it were
    // not, this would silently create two rows and nothing would fail loudly.
    const first = store.createConnection(a.id, { toPageId: b.id, label: "ally of" });
    expect(store.createConnection(b.id, { toPageId: a.id, label: "ally of" }).id).toBe(first.id);
    expect(store.listAllConnections().filter((edge) => edge.origin === "declared")).toHaveLength(1);
    // A free-text label is DIRECTIONAL: "guards" one way is not "guards" the other.
    store.createConnection(a.id, { toPageId: b.id, label: "guards" });
    store.createConnection(b.id, { toPageId: a.id, label: "guards" });
    expect(store.listAllConnections().filter((edge) => edge.origin === "declared")).toHaveLength(3);
  });

  it("relabels and re-layers a declared connection, and refuses a label that is too long", () => {
    const a = store.createPage({ title: "Strahd", entityType: "character" });
    const b = store.createPage({ title: "Barovia", entityType: "location" });
    const edge = store.createConnection(a.id, { toPageId: b.id });
    expect(edge.label, "an UNLABELLED connection stores '' and reads back null").toBeNull();

    expect(store.updateConnection(edge.id, { label: "rules" }).label).toBe("rules");
    expect(store.updateConnection(edge.id, { layer: "gm" })).toMatchObject({ label: "rules", layer: "gm" });   // omitted = unchanged
    expect(store.updateConnection(edge.id, { label: null }).label, "clearing the label is legal").toBeNull();
    expect(() => store.updateConnection(edge.id, { label: "x".repeat(41) })).toThrow(/40 printable/);
    expect(() => store.updateConnection(crypto.randomUUID(), { label: "x" })).toThrow(/no longer exists/i);

    store.deleteConnection(edge.id);
    expect(store.connectionsForPage(a.id)).toHaveLength(0);
    store.deleteConnection(edge.id);  // idempotent
  });

  it("folds an unlabelled declared edge and a mention over the same pair into ONE row, declared winning", () => {
    const bree = store.createPage({ title: "Bree" });
    const road = store.createPage({ title: "Road", playerBody: "leads to [[Bree]]" });
    const declared = store.createConnection(road.id, { toPageId: bree.id });

    const outgoing = store.connectionsForPage(road.id).filter((row) => row.direction === "out");
    expect(outgoing, "one connection stated twice is one row, not two").toHaveLength(1);
    expect(outgoing[0]).toMatchObject({ id: declared.id, origin: "declared" });   // the deletable one wins

    // A LABELLED declared edge is never folded against a mention: "ally of" and "mentions" are different
    // statements about the same pair, and a panel that hid one would be lying about the other.
    store.updateConnection(declared.id, { label: "leads to" });
    const both = store.connectionsForPage(road.id).filter((row) => row.direction === "out");
    expect(both).toHaveLength(2);
    expect(both.map((row) => row.origin).sort()).toEqual(["declared", "mention"]);
  });

  it("gates a player's page connections on the layer AND the other end's reveal, for BOTH origins", () => {
    const hub = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const shown = store.createPage({ title: "The Blue Water Inn", revealedToPlayers: true });
    const secret = store.createPage({ title: "The Cult", revealedToPlayers: false });
    const gmLayer = store.createConnection(hub.id, { toPageId: shown.id, label: "hides", layer: "gm" });
    store.createConnection(hub.id, { toPageId: shown.id, label: "contains" });
    store.createConnection(hub.id, { toPageId: secret.id, label: "watched by" });

    const player = projectPlayerPageConnections(store.connectionsForPage(hub.id));
    expect(player.map((row) => row.label)).toEqual(["contains"]);
    // The GM's own panel carries all three, so the filtering above is the gate and not an empty fixture.
    expect(projectGmPageConnections(store.connectionsForPage(hub.id))).toHaveLength(3);
    // A GM-LAYER DECLARED edge between two REVEALED pages never travels - the rule that is genuinely new
    // in D8, and the one a "both endpoints revealed" gate alone would miss.
    expect(player.some((row) => row.otherId === shown.id && row.label === "hides")).toBe(false);
    store.updateConnection(gmLayer.id, { layer: "player" });
    expect(projectPlayerPageConnections(store.connectionsForPage(hub.id)).map((row) => row.label).sort()).toEqual(["contains", "hides"]);

    // The player row's EXACT key set: no `id`, no `layer`, no `otherRevealed`.
    expect(Object.keys(projectPlayerPageConnections(store.connectionsForPage(hub.id))[0]!).sort())
      .toEqual(["direction", "label", "origin", "otherEntityType", "otherId", "otherKind", "otherTitle", "section"]);
  });
});

describe("CodexStore journal", () => {
  it("creates, updates, reveals, and orders a timeline; combat entries auto-tag their kind", () => {
    const page = store.createPage({ title: "Bree" });
    const one = store.createSession({ sessionNumber: 1 });
    const two = store.createSession({ sessionNumber: 2 });
    const first = store.createEntry({ playerText: "We arrived in Bree.", gmText: "The spy watched them.", sessionId: one.id, attachPageId: page.id });
    expect(first).toMatchObject({ kind: "note", revealedToPlayers: false, sessionId: one.id, sessionNumber: 1 });
    store.createEntry({ playerText: "We left at dawn.", sessionId: two.id });
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
    expect(Object.keys(projected).sort()).toEqual(["calendarInstant", "createdAt", "fired", "id", "inWorldDate", "inWorldLabel", "kind", "payload", "realDate", "sessionId", "sessionNumber", "tags", "text", "title"]);
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
/**
 * D8: the WHOLE-GRAPH feed, at the store and projection layers. This describe used to be about wiki-link
 * edges alone (CI-8); after D8 there is one feed and one edge kind, so it is about connections - and the
 * mention arm's three rules are unchanged, because D8 folded the concepts rather than loosening a gate.
 */
describe("Codex whole-graph connections — the store and projection layers, on their own (D8)", () => {
  const context = () => ({
    revealedPageIds: new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id)),
    revealedSourceIds: new Set<string>()
  });
  const mentions = () => store.listAllConnections().filter((edge) => edge.origin === "mention");
  const pair = (edge: { fromId: string; toPageId: string }) => ({ fromPageId: edge.fromId, toPageId: edge.toPageId });

  it("the store's feed is deliberately UNGATED — both layers, every reveal state, both origins", () => {
    const target = store.createPage({ title: "Vallaki" });                                    // secret
    const source = store.createPage({ title: "Barovia", gmBody: "Answers to [[Vallaki]]." }); // secret, GM-layer link
    expect(mentions()).toEqual([{ id: null, fromKind: "page", fromId: source.id, toPageId: target.id, label: null, origin: "mention", layer: "gm", createdAt: null }]);
  });

  it("refuses a GM-BODY mention even when both endpoints are revealed", () => {
    const target = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const source = store.createPage({ title: "Barovia", gmBody: "Its burgomaster answers to [[Vallaki]].", revealedToPlayers: true });
    expect(projectGmConnections(store.listAllConnections())).toHaveLength(1);
    expect(projectPlayerConnections(store.listAllConnections(), context())).toEqual([]);
    // Moving the very same link into the player body lets it through — so the miss is the LAYER rule.
    store.updatePage(source.id, { gmBody: "", playerBody: "Ruled from [[Vallaki]]." }, undefined, "test");
    expect(projectPlayerConnections(store.listAllConnections(), context()).map(pair)).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });

  it("refuses a player-body mention when EITHER endpoint is unrevealed, so no dangling edge names a secret page", () => {
    const secret = store.createPage({ title: "The Whispered Name" });
    const source = store.createPage({ title: "Barovia", playerBody: "Watched by [[The Whispered Name]].", revealedToPlayers: true });
    expect(projectPlayerConnections(store.listAllConnections(), context())).toEqual([]);   // hidden TARGET
    store.setPageRevealed(secret.id, true);
    store.setPageRevealed(source.id, false);
    expect(projectPlayerConnections(store.listAllConnections(), context())).toEqual([]);   // hidden SOURCE
    store.setPageRevealed(source.id, true);
    expect(projectPlayerConnections(store.listAllConnections(), context()).map(pair)).toEqual([{ fromPageId: source.id, toPageId: secret.id }]);
  });

  it("resolves targets by title key, and drops self-links and links to titles no page carries", () => {
    const page = store.createPage({ title: "Barovia", playerBody: "See [[  barovia  ]] and [[A Page Never Written]].", revealedToPlayers: true });
    expect(mentions()).toEqual([]);   // the self-link normalizes to this very page; the other has no node
    const other = store.createPage({ title: "Castle  Ravenloft", revealedToPlayers: true });
    store.updatePage(page.id, { playerBody: "Looms over it: [[castle ravenloft]]." }, undefined, "test");
    expect(mentions().map(pair)).toEqual([{ fromPageId: page.id, toPageId: other.id }]);
  });

  it("collapses a target linked from BOTH bodies into ONE player-layer edge", () => {
    const target = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const source = store.createPage({ title: "Barovia", playerBody: "Ruled from [[Vallaki#Rule]].", gmBody: "[[Vallaki]] hides the coffin.", revealedToPlayers: true });
    // The player body genuinely carries it, so the edge is player-visible - and the graph draws one line.
    expect(mentions()).toHaveLength(1);
    expect(mentions()[0]!.layer).toBe("player");
    expect(projectPlayerConnections(store.listAllConnections(), context()).map(pair)).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });

  /**
   * D13: session, quest and journal bodies join the graph, with the layer mapping their own two-layer
   * split already implies. Prep is a session's secret half, so a page named only in prep is a GM-only
   * connection - the exact leak shape the layer rule exists for, one record kind further out.
   */
  it("puts session, quest and journal bodies in the graph, on the layer their own split implies", () => {
    const shown = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const session = store.createSession({ recapBody: "We reached [[Vallaki]].", prepBody: "The ambush waits in [[Vallaki]]." });
    const quest = store.createQuest({ title: "Find the Sunsword", playerBody: "Look in [[Vallaki]]." });
    const entry = store.createEntry({ playerText: "Arrived at [[Vallaki]].", revealedToPlayers: true });
    const gmOnlyEntry = store.createEntry({ playerText: "Nothing happened.", gmText: "Strahd watches [[Vallaki]].", revealedToPlayers: true });

    const bySource = new Map(store.listAllConnections().filter((edge) => edge.origin === "mention").map((edge) => [edge.fromId, edge]));
    // The session names the page from BOTH bodies, so the collapse upgrades it to the player layer.
    expect(bySource.get(session.id)).toMatchObject({ fromKind: "session", toPageId: shown.id, layer: "player" });
    expect(bySource.get(quest.id)).toMatchObject({ fromKind: "quest", layer: "player" });
    expect(bySource.get(entry.id)).toMatchObject({ fromKind: "journal", layer: "player" });
    expect(bySource.get(gmOnlyEntry.id), "a page named only in gmText is a GM-layer edge").toMatchObject({ fromKind: "journal", layer: "gm" });

    // A prep-ONLY mention is GM-layer, which is the half a player must never receive.
    const prepOnly = store.createSession({ prepBody: "Secretly, [[Vallaki]]." });
    expect(store.listAllConnections().find((edge) => edge.fromId === prepOnly.id)).toMatchObject({ layer: "gm" });

    // THE PLAYER GATE, per source kind: the source record's own reveal flag decides, so a connection can
    // never be a way around a session/quest/entry's own gate. Nothing is revealed yet -> nothing travels.
    const ctx = { revealedPageIds: new Set([shown.id]), revealedSourceIds: new Set<string>() };
    expect(projectPlayerConnections(store.listAllConnections(), ctx).filter((edge) => edge.fromKind !== "page")).toEqual([]);
    // Reveal the session and the entry; the quest stays hidden, so its edge stays hidden with it.
    const revealed = { revealedPageIds: new Set([shown.id]), revealedSourceIds: new Set([session.id, entry.id]) };
    const travelling = projectPlayerConnections(store.listAllConnections(), revealed);
    expect(travelling.map((edge) => edge.fromId).sort()).toEqual([entry.id, session.id].sort());
    // The player edge's EXACT key set: no id, no layer, no createdAt.
    expect(Object.keys(travelling[0]!).sort()).toEqual(["fromId", "fromKind", "label", "origin", "toPageId"]);
  });

  it("scrubs a record's link rows when it is deleted — v22 dropped the foreign key, so nothing cascades", () => {
    const shown = store.createPage({ title: "Vallaki" });
    const session = store.createSession({ recapBody: "[[Vallaki]]" });
    const quest = store.createQuest({ title: "Q", playerBody: "[[Vallaki]]" });
    const entry = store.createEntry({ playerText: "[[Vallaki]]" });
    const page = store.createPage({ title: "Road", playerBody: "[[Vallaki]]" });
    expect(store.listAllConnections()).toHaveLength(4);

    store.deleteSession(session.id);
    store.deleteQuest(quest.id);
    store.deleteEntry(entry.id);
    store.deletePage(page.id);
    expect(store.listAllConnections(), "no orphan edge survives its source record").toEqual([]);
    expect(store.connectionsForPage(shown.id)).toEqual([]);
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

  it("DOES count adding a connection, on BOTH endpoints, without forcing either editor into a conflict", () => {
    const strahd = recency.createPage({ title: "Strahd", entityType: "character" });
    const barovia = recency.createPage({ title: "Barovia", entityType: "location" });
    const bornStrahd = updatedAt(strahd.id);
    const bornBarovia = updatedAt(barovia.id);
    tick();
    const edge = recency.createConnection(strahd.id, { toPageId: barovia.id, label: "rules" });
    expect(updatedAt(strahd.id) > bornStrahd).toBe(true);
    expect(updatedAt(barovia.id) > bornBarovia).toBe(true);   // the OTHER end gained a connection too
    expect(rev(strahd.id)).toBe(strahd.rev);                  // `rev` is the conflict token, not recency
    expect(rev(barovia.id)).toBe(barovia.rev);

    // An idempotent re-add changes nothing, so it is not an edit.
    const settled = updatedAt(strahd.id);
    tick();
    expect(recency.createConnection(strahd.id, { toPageId: barovia.id, label: "rules" }).id).toBe(edge.id);
    expect(updatedAt(strahd.id)).toBe(settled);
  });

  it("DOES count removing a connection, on both endpoints", () => {
    const strahd = recency.createPage({ title: "Strahd", entityType: "character" });
    const barovia = recency.createPage({ title: "Barovia", entityType: "location" });
    const edge = recency.createConnection(strahd.id, { toPageId: barovia.id, label: "rules" });
    const afterCreate = updatedAt(strahd.id);
    expect(updatedAt(barovia.id)).toBe(afterCreate);
    tick();
    recency.deleteConnection(edge.id);
    expect(recency.connectionsForPage(strahd.id)).toEqual([]);
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

  it("names exactly the session IDS still hidden from players, numbered or not", () => {
    // The resolution every player journal read gates the session link on. D9 keys it by ID, which is what
    // closes the gap the number version could not: an UNNUMBERED hidden session could never appear in a
    // set of numbers, so an entry filed under one had nothing to gate on.
    const hidden = sessions.createSession({ sessionNumber: 4 });
    const shown = sessions.createSession({ sessionNumber: 5 });
    sessions.setSessionRevealed(shown.id, true);
    const unnumbered = sessions.createSession({});
    expect([...sessions.unrevealedSessionIds()].sort()).toEqual([hidden.id, unnumbered.id].sort());

    // Revealing them empties the set, so the ids above are the reveal flag being read and not "every session".
    sessions.setSessionRevealed(hidden.id, true);
    sessions.setSessionRevealed(unnumbered.id, true);
    expect([...sessions.unrevealedSessionIds()]).toEqual([]);
    // ...and hiding 5 again puts a DIFFERENT id in, so this is a per-row read rather than a constant.
    sessions.setSessionRevealed(shown.id, false);
    expect([...sessions.unrevealedSessionIds()]).toEqual([shown.id]);
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
    const entry = sessions.createEntry({ playerText: "The session before the first.", sessionId: zero.id, revealedToPlayers: true });
    expect(entry.sessionNumber).toBe(0);

    // Unrevealed record -> gated to null, exactly as any other session.
    expect(projectPlayerJournalEntry(entry, { unrevealedSessionIds: sessions.unrevealedSessionIds() })!.sessionNumber).toBeNull();
    // Revealed -> the number survives, and 0 is not mistaken for "no session".
    sessions.setSessionRevealed(zero.id, true);
    expect(projectPlayerJournalEntry(entry, { unrevealedSessionIds: sessions.unrevealedSessionIds() })!.sessionNumber).toBe(0);
  });

  /**
   * The create/update asymmetry again, this time with a session actually ACTIVE — the state the store
   * test above cannot reach, because its fixture never activates anything. Editing an entry must not
   * re-file it under the running session.
   */
  it("editing an entry never re-files it under the ACTIVE session", () => {
    const older = sessions.createSession({ sessionNumber: 2 });
    const running = sessions.createSession({ sessionNumber: 9 });
    sessions.setActiveSession(running.id);

    const entry = sessions.createEntry({ playerText: "Filed under two.", sessionId: older.id });
    expect(entry.sessionNumber).toBe(2);
    const edited = sessions.updateEntry(entry.id, { playerText: "Filed under two, with a typo fixed." });
    expect(edited.sessionNumber).toBe(2);          // NOT 9
    expect(edited.sessionId).toBe(older.id);
    // ...and an EXPLICIT re-file still works, so the line above is the omitted-means-unchanged rule and
    // not a PATCH that cannot move an entry at all.
    expect(sessions.updateEntry(entry.id, { sessionId: running.id }).sessionNumber).toBe(9);
    expect(sessions.updateEntry(entry.id, { sessionId: null })).toMatchObject({ sessionId: null, sessionNumber: null });
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
    const other = sessions.createSession({ sessionNumber: 4 });
    expect(sessions.createEntry({ playerText: "A retcon.", sessionId: other.id }).sessionNumber).toBe(4);
    expect(sessions.createEntry({ playerText: "Timeless lore.", sessionId: null }).sessionNumber).toBeNull();
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

    // An active session that has NO NUMBER yet is where D9 is strictly BETTER than the number-stamping it
    // replaced: the entry joins the RECORD, so it is filed correctly and simply has no number to display
    // yet. Under M9 it could not link at all. Session 9 sitting right there must still not be borrowed.
    const draft = sessions.createSession({});
    sessions.setActiveSession(draft.id);
    const midDraft = sessions.createEntry({ playerText: "Mid-draft." });
    expect(midDraft).toMatchObject({ sessionId: draft.id, sessionNumber: null });
    expect(sessions.appendCombatEntry({ sourceEncounterId: 2, playerText: "A brawl." })).toMatchObject({ sessionId: draft.id, sessionNumber: null });

    // ...and numbering that same session gives every already-filed entry its label, retroactively - which
    // is the whole point of joining by identity.
    sessions.updateSession(draft.id, { sessionNumber: 1 }, draft.rev, "gm");
    expect(sessions.getEntry(midDraft.id)!.sessionNumber).toBe(1);
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
    expect(quests.searchAll("gm", "First").hits).toEqual([]);
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
    expect(store.searchAll("player", "forgery").hits).toEqual([]);              // ...and yet the phrase is unreachable
    expect(store.searchAll("player", GM_PHRASE).hits).toEqual([]);

    // The GM DOES find it, so the miss above is the two indexes being kept apart, not a quest that never
    // indexed at all.
    expect(store.searchAll("gm", "forgery").hits).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("still lets a player find that same quest by its player body and by an objective", () => {
    // This is what makes the assertions above meaningful: the quest IS in the player's index and IS
    // player-visible, so the GM phrase missing is about the TEXT written, not about the record.
    const quest = seedRevealed();
    expect(store.searchAll("player", "counting").hits).toEqual([{ kind: "quest", id: quest.id }]);
    // An objective's text is player-facing — it lives beside `playerBody`, not `gmBody`.
    expect(store.searchAll("player", "Search").hits).toEqual([{ kind: "quest", id: quest.id }]);
    // ...and the title, which is the same string in both indexes.
    expect(store.searchAll("player", "Wyrmwood").hits).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("keeps the index in step with an edit and re-splits the layers on the way", () => {
    const quest = seedRevealed();
    store.updateQuest(quest.id, {
      playerBody: "Escort Ireena to Vallaki.", gmBody: "Ireena is Strahd's true target.",
      objectives: [{ text: "Reach the gates", done: false }]
    }, undefined);
    // The old player text stops matching — body AND objective, since both feed the same index row.
    expect(store.searchAll("player", "counting").hits).toEqual([]);
    expect(store.searchAll("gm", "counting").hits).toEqual([]);
    expect(store.searchAll("player", "Vallaki").hits).toEqual([{ kind: "quest", id: quest.id }]);
    expect(store.searchAll("player", "gates").hits).toEqual([{ kind: "quest", id: quest.id }]);
    // ...and the NEW GM half is in the GM index only, so an update cannot be the way a secret phrase
    // sneaks into the player table.
    expect(store.searchAll("player", "target").hits).toEqual([]);
    expect(store.searchAll("gm", "target").hits).toEqual([{ kind: "quest", id: quest.id }]);
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
    expect(Object.keys(projected).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "tags", "title"]);
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
 * Migration v19 (D9), on a REAL legacy database rather than a fresh one - the K7 discipline v11/v12/v15
 * established, because a fresh-database test can never catch a bad upgrade: every table is empty and
 * every default is trivially satisfied.
 *
 * **This describe block used to be called "sessions arrive with NO backfill (M9)", and it asserted the
 * opposite of what it asserts now.** v13 deliberately refused to synthesize session records for the
 * numbers legacy journal rows carried, on the grounds that inventing prep, recap and attendance would
 * fabricate facts. The client's D9 consciously supersedes that decision (see `decision-log.md`), and the
 * objection is honoured rather than overridden: the synthesized rows carry EMPTY prep, recap and
 * attendees - nothing is invented - and are `played` + hidden, so they are invisible to players and
 * change nothing on any screen but the GM's session list, where a number that already existed now has a
 * record behind it. The alternative was orphaning those numbers, which is data loss.
 */
describe("CodexStore migration v19 — journal entries join their session by identity (D9)", () => {
  it("synthesizes a hidden played session per orphan number, joins every entry to it, and keeps the display numbers identical", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v18-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      // A genuine v18 database, built from the SHIPPED migration SQL, populated with the legacy row
      // shapes that actually matter: entries whose number matches an existing session record, entries
      // whose number matches nothing, an unnumbered entry, and both a numbered and an unnumbered session.
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter((entry) => entry.version <= 18)) {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
      }
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();

      const existingSession = crypto.randomUUID();
      const unnumberedSession = crypto.randomUUID();
      database.prepare("INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at) VALUES (?, 1, '2026-01-01', '[\"Ana\"]', 'Ambush at the bridge.', 'They crossed.', 1, 'played', 1, '', '')").run(existingSession);
      database.prepare("INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at) VALUES (?, NULL, NULL, '[]', 'Nothing yet.', '', 0, 'planned', 1, '', '')").run(unnumberedSession);

      // v22's fixtures: two pages with a wiki link between them, two relationship rows (one pinned slug,
      // one unknown), and prose in a session/quest/journal body for the startup reconcile to find.
      const linkedPage = crypto.randomUUID(), targetPage = crypto.randomUUID(), harpers = crypto.randomUUID(), zhents = crypto.randomUUID();
      const insertPage = database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, ?, ?, '{}', '{}', NULL, '[]', ?, '', 1, NULL, 1, '', '')");
      insertPage.run(targetPage, "Vallaki", "location", "A walled town.");
      insertPage.run(linkedPage, "Barovia", "location", "Ruled from [[Vallaki]].");
      insertPage.run(harpers, "The Harpers", "faction", "Meddlers.");
      insertPage.run(zhents, "The Zhentarim", "faction", "Rivals.");
      database.prepare("INSERT INTO codex_links (source_page_id, layer, target_kind, target_ref, section) VALUES (?, 'player', 'page', 'vallaki', NULL)").run(linkedPage);
      const insertRel = database.prepare("INSERT INTO codex_relationships (id, from_page_id, to_page_id, type, created_at) VALUES (?, ?, ?, ?, '')");
      insertRel.run(crypto.randomUUID(), harpers, zhents, "ally");
      insertRel.run(crypto.randomUUID(), zhents, harpers, "owes-a-debt-to");
      database.prepare("UPDATE codex_sessions SET prep_body = ? WHERE id = ?").run("The ambush at [[Vallaki]].", existingSession);
      database.prepare("INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at) VALUES (?, 'Find the Sunsword', 'active', 'Search [[Vallaki]].', '', '[]', '[]', 0, 1, '', '')").run(crypto.randomUUID());

      const matched = crypto.randomUUID(), orphanA = crypto.randomUUID(), orphanB = crypto.randomUUID(), loose = crypto.randomUUID();
      const insert = database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, session_number, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, NULL, ?, 'note', ?, ?, '[]', '', '')");
      insert.run(matched, "We arrived in [[Vallaki]].", 1, 1, 1);
      insert.run(orphanA, "The wolves came.", 1, 7, 2);      // number 7 names no session record
      insert.run(orphanB, "And came again.", 0, 7, 3);       // ...twice, so synthesis must not duplicate
      insert.run(loose, "Undated lore.", 1, null, 4);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();

      // ONE synthesized record for the one orphan number - not two, and not one per entry.
      const sessions = upgraded.listSessions();
      expect(sessions).toHaveLength(3);
      const synthesized = sessions.find((session) => session.sessionNumber === 7)!;
      expect(synthesized, "an orphan number gets a record rather than being dropped").toBeDefined();
      expect(synthesized.status, "the master plan's ruling: played").toBe("played");
      expect(synthesized.revealedToPlayers, "...and unrevealed, so nothing changes for players").toBe(false);
      // Nothing is INVENTED: v13's objection, honoured.
      expect(synthesized.prepBody).toBe("");
      expect(synthesized.recapBody).toBe("");
      expect(synthesized.attendees).toEqual([]);
      // The id passes the store's own id regex, so it round-trips through every route that validates one.
      expect(synthesized.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(upgraded.getSession(synthesized.id)).not.toBeNull();
      // The pre-existing record is untouched, not replaced by a synthesized twin.
      // (its prep was rewritten above to seed a v22 wiki link, so only the recap is compared verbatim)
      expect(upgraded.getSession(existingSession)).toMatchObject({ sessionNumber: 1, recapBody: "They crossed." });

      // Every previously-numbered entry now JOINS the right record, and reads back the SAME display
      // number it carried yesterday - which is the whole "nothing visibly changes" claim.
      expect(upgraded.getEntry(matched)).toMatchObject({ sessionId: existingSession, sessionNumber: 1 });
      expect(upgraded.getEntry(matched)!.playerText).toBe("We arrived in [[Vallaki]].");
      expect(upgraded.getEntry(orphanA)).toMatchObject({ sessionId: synthesized.id, sessionNumber: 7 });
      expect(upgraded.getEntry(orphanB)).toMatchObject({ sessionId: synthesized.id, sessionNumber: 7 });
      expect(upgraded.getEntry(loose)).toMatchObject({ sessionId: null, sessionNumber: null });

      // The post-migration invariant, probed in raw SQL below the store: NO row keeps a bare number.
      const raw = new DatabaseSync(path);
      const bare = raw.prepare("SELECT COUNT(*) AS n FROM codex_journal WHERE session_number IS NOT NULL").get() as { n: number };
      expect(bare.n, "the bare-number column is empty after v19 - it is now the LABEL store").toBe(0);
      // The rebuilt CHECK admits D11's seventh kind and still rejects an eighth.
      const probe = (kind: string) => raw.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, sort_key, tags_json, created_at, updated_at) VALUES (?, '', NULL, 0, ?, 99, '[]', '', '')").run(crypto.randomUUID(), kind);
      expect(() => probe("quest"), "v19 widened the CHECK for D11's quest history").not.toThrow();
      expect(() => probe("bogus"), "...and the CHECK still discriminates").toThrow();
      // Every index survived the rebuild, plus the new join index. DROP TABLE takes its indexes with it,
      // so a forgotten CREATE INDEX silently turns the timeline's ORDER BY into a full scan.
      const indexes = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_journal'").all() as Array<{ name: string }>).map((row) => row.name);
      for (const name of ["codex_journal_order", "codex_journal_marker", "codex_journal_page", "codex_journal_session"]) {
        expect(indexes, `index ${name}`).toContain(name);
      }
      // v20's tags default, on real legacy rows rather than fresh ones.
      const sessionTags = raw.prepare("SELECT tags_json FROM codex_sessions").all() as Array<{ tags_json: string }>;
      for (const row of sessionTags) expect(row.tags_json).toBe("[]");
      raw.close();
      expect(upgraded.listSessions().every((session) => session.tags.length === 0)).toBe(true);

      // v21's search backfill, with GATE 1 held at the migration layer: the GM finds a legacy session by
      // its PREP text, and a player never can - even for a session that is revealed.
      expect(upgraded.searchAll("gm", "ambush").hits.some((hit) => hit.kind === "session" && hit.id === existingSession)).toBe(true);
      expect(upgraded.searchAll("player", "ambush").hits.some((hit) => hit.id === existingSession)).toBe(false);
      expect(upgraded.searchAll("player", "crossed").hits.some((hit) => hit.kind === "session" && hit.id === existingSession), "a revealed session's RECAP is findable").toBe(true);
      expect(upgraded.searchAll("player", "crossed").hits.some((hit) => hit.id === synthesized.id), "...and a hidden one is not").toBe(false);

      // v22 (D8): the links rebuild carried every existing row over as a PAGE source, the relationships
      // table gained its layer, and the twelve legacy slugs became the labels a reader sees.
      const raw2 = new DatabaseSync(path);
      const linkRows = raw2.prepare("SELECT source_kind, source_id, layer, target_ref FROM codex_links WHERE target_kind = 'page' ORDER BY target_ref").all() as Array<{ source_kind: string; source_id: string; layer: string; target_ref: string }>;
      expect(linkRows.length, "the legacy page links survived the rebuild").toBeGreaterThanOrEqual(2);
      // The legacy row is still a PAGE source with its layer intact - that is what the rebuild carried.
      // (The non-page rows beside it are the startup reconcile's, asserted below.)
      expect(linkRows.find((row) => row.source_id === linkedPage)).toMatchObject({ source_kind: "page", target_ref: "vallaki", layer: "player" });
      const rels = raw2.prepare("SELECT type, layer FROM codex_relationships ORDER BY type").all() as Array<{ type: string; layer: string }>;
      // "ally" -> "ally of" from the pinned vocabulary; an unknown slug falls back to dashes-into-spaces.
      expect(rels.map((row) => row.type)).toEqual(["ally of", "owes a debt to"]);
      expect(rels.every((row) => row.layer === "player"), "every migrated edge is on the player layer - today's behaviour").toBe(true);
      raw2.close();

      // D13's STARTUP RECONCILE ran once on open and re-extracted the pre-existing session, quest and
      // journal bodies - work no SQL migration could do, because SQL cannot parse `[[...]]`.
      const reconciled = upgraded.listAllConnections().filter((edge) => edge.origin === "mention");
      expect(reconciled.find((edge) => edge.fromKind === "session"), "a legacy session's PREP link, on the GM layer").toMatchObject({ fromId: existingSession, layer: "gm" });
      expect(reconciled.find((edge) => edge.fromKind === "journal"), "a legacy entry's player-text link").toMatchObject({ fromId: matched, layer: "player" });
      // ...and the symmetric-dedupe re-key works against the MIGRATED spelling, which is the silent
      // failure v22's relabel would otherwise have caused.
      const allyA = upgraded.listPages().find((page) => page.title === "The Harpers")!;
      const allyB = upgraded.listPages().find((page) => page.title === "The Zhentarim")!;
      expect(upgraded.createConnection(allyB.id, { toPageId: allyA.id, label: "ally of" }).fromPageId, "the reverse direction is the SAME edge").toBe(allyA.id);

      // D9's payoff, on the upgraded database: renumbering the session moves every joined entry's
      // display number in one write, with no journal work at all.
      upgraded.updateSession(existingSession, { sessionNumber: 42 }, undefined, "gm");
      expect(upgraded.getEntry(matched)!.sessionNumber).toBe(42);

      // Auto-linking on a REAL upgraded database: nothing is active, so a new entry is filed under none.
      expect(upgraded.createEntry({ playerText: "Written after the upgrade." }).sessionId).toBeNull();
      expect(upgraded.appendCombatEntry({ sourceEncounterId: 9, playerText: "A brawl." }).sessionId).toBeNull();
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
    expect(Object.keys(projected).sort()).toEqual(["id", "realDate", "recap", "sessionNumber", "tags"]);
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
  /** An entry a player may read, filed under a session by ID - the shape D9 auto-linking produces. */
  const revealedEntry = (sessionId: string | null) => store.createEntry({ playerText: "We reached Vallaki.", sessionId, revealedToPlayers: true });

  it("blanks BOTH halves of the link for an UNREVEALED session, and hands them back the moment it is revealed", () => {
    const session = store.createSession({ sessionNumber: 4, recapBody: "The party crossed." });
    expect(session.revealedToPlayers).toBe(false);
    const entry = revealedEntry(session.id);
    expect(entry).toMatchObject({ sessionId: session.id, sessionNumber: 4 });        // the row really carries both...

    const gated = projectPlayerJournalEntry(entry, playerSessionNumbers())!;
    // BOTH, together. Either half alone announces that a session they have not been shown exists - the id
    // is the stronger leak, because it is a handle they could try to fetch.
    expect(gated.sessionNumber).toBeNull();
    expect(gated.sessionId).toBeNull();
    // ...and the GM's own row is untouched, so the nulls above are the gate and not a link that never arrived.
    expect(projectGmJournalEntry(entry)).toMatchObject({ sessionId: session.id, sessionNumber: 4 });

    // Revealing the SESSION - the entry row is not rewritten, only the context changes - hands both back,
    // so the nulls are provably the reveal gate rather than a projection that drops the fields.
    store.setSessionRevealed(session.id, true);
    expect(projectPlayerJournalEntry(entry, playerSessionNumbers())).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
  });

  it("lets a bare LABEL with no session through - director ruling R2's stamp-back, and nothing else reaches this arm", () => {
    // The only bare labels that exist after migration v19: `deleteSession` stamped a REVEALED session's
    // number onto its entries when the record went. The number was already player-visible, and there is no
    // record left whose existence it could name, so it travels.
    const revealed = store.createSession({ sessionNumber: 4 });
    store.setSessionRevealed(revealed.id, true);
    const entry = revealedEntry(revealed.id);
    store.deleteSession(revealed.id);

    const orphan = store.getEntry(entry.id)!;
    expect(orphan, "SET NULL on the join, number stamped back as a bare label").toMatchObject({ sessionId: null, sessionNumber: 4 });
    expect(projectPlayerJournalEntry(orphan, playerSessionNumbers())).toMatchObject({ sessionId: null, sessionNumber: 4 });

    // The mirror case is the one that matters: a HIDDEN session's delete stamps NOTHING, so a player can
    // never learn a hidden session existed by reading a label it left behind.
    const hidden = store.createSession({ sessionNumber: 5 });
    const secretEntry = revealedEntry(hidden.id);
    store.deleteSession(hidden.id);
    const scrubbed = store.getEntry(secretEntry.id)!;
    expect(scrubbed).toMatchObject({ sessionId: null, sessionNumber: null });
    expect(projectPlayerJournalEntry(scrubbed, playerSessionNumbers())).toMatchObject({ sessionId: null, sessionNumber: null });
  });

  it("gates ONLY the link — the rest of a revealed entry travels exactly as it did", () => {
    const session = store.createSession({ sessionNumber: 4 });
    const entry = store.createEntry({
      playerText: "We reached Vallaki.", gmText: "The burgomaster lied about the wolves.",
      sessionId: session.id, realDate: "2026-07-26", tags: ["travel"], revealedToPlayers: true
    });
    const projected = projectPlayerJournalEntry(entry, playerSessionNumbers())!;
    // The EXACT key set: the fields are NULLED, never dropped, so one response shape still serves both roles.
    expect(Object.keys(projected).sort()).toEqual(["createdAt", "id", "inWorldLabel", "kind", "realDate", "sessionId", "sessionNumber", "tags", "text"]);
    expect(projected.sessionNumber).toBeNull();
    expect(projected.sessionId).toBeNull();
    expect(projected.text).toBe("We reached Vallaki.");                             // the entry is still readable...
    expect(projected.realDate).toBe("2026-07-26");                                  // ...and its neighbours untouched
    expect(projected.tags).toEqual(["travel"]);
    expect(JSON.stringify(projected)).not.toContain("burgomaster");                 // gmText still gone, as ever
  });

  it("carries the same gate onto the chronicle by DELEGATION, not a second copy", () => {
    const session = store.createSession({ sessionNumber: 4 });
    const entry = store.createEntry({ playerText: "We reached Vallaki.", sessionId: session.id, revealedToPlayers: true, inWorldDate: { year: 1492, month: 0, day: 1 } });
    const playerRow = () => projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! }, playerSessionNumbers())!;
    expect(playerRow().sessionNumber).toBeNull();
    expect(playerRow().sessionId).toBeNull();
    // The GM's chronicle row still carries it, and revealing the session gives the player's row it back —
    // the same two controls the journal test above uses, at the surface that merely delegates.
    expect(projectGmChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! })).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
    store.setSessionRevealed(session.id, true);
    expect(playerRow()).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
  });

  /**
   * D9's payoff, and the reproduction of `known-bugs.md:111-122` INVERTED: renumbering a session used to
   * leave every one of its entries carrying the old number, because the number was copied onto the row.
   * The join makes the display number live, so one `updateSession` moves all of them and no journal row
   * is written at all.
   */
  it("renumbering a session updates every linked entry's display number, with no journal write", () => {
    const session = store.createSession({ sessionNumber: 4 });
    const first = store.createEntry({ playerText: "We arrived.", sessionId: session.id });
    const second = store.createEntry({ playerText: "We left.", sessionId: session.id });
    const untouchedStamp = store.getEntry(first.id)!.updatedAt;
    expect([first, second].map((entry) => entry.sessionNumber)).toEqual([4, 4]);

    store.updateSession(session.id, { sessionNumber: 9 }, undefined, "gm");

    expect(store.getEntry(first.id)!.sessionNumber).toBe(9);
    expect(store.getEntry(second.id)!.sessionNumber).toBe(9);
    // ...and the entries were not rewritten to do it, which is what makes this cost nothing.
    expect(store.getEntry(first.id)!.updatedAt).toBe(untouchedStamp);
    // Clearing the number leaves the JOIN intact - the entry is still filed under that session.
    store.updateSession(session.id, { sessionNumber: null }, undefined, "gm");
    expect(store.getEntry(first.id)).toMatchObject({ sessionId: session.id, sessionNumber: null });
  });

  /** The write-resolution rule, all four arms, in one place. */
  it("resolves a write's session by id: omitted auto-files, null unfiles, an unknown id is not-found", () => {
    const session = store.createSession({ sessionNumber: 1 });
    expect(store.createEntry({ playerText: "nothing active yet" }).sessionId, "no active session -> unfiled").toBeNull();

    store.setActiveSession(session.id);
    expect(store.createEntry({ playerText: "during play" }).sessionId, "omitted -> the active session").toBe(session.id);
    expect(store.createEntry({ playerText: "deliberately unfiled", sessionId: null }).sessionId, "explicit null -> none").toBeNull();

    const other = store.createSession({ sessionNumber: 2 });
    expect(store.createEntry({ playerText: "filed by hand", sessionId: other.id }).sessionId).toBe(other.id);
    expect(() => store.createEntry({ playerText: "nowhere", sessionId: crypto.randomUUID() })).toThrow(/no longer exists/i);

    // An UNNUMBERED active session auto-links too - strictly better than the number-stamping it replaces,
    // which could not link at all until the GM had numbered the session.
    const unnumbered = store.createSession({});
    store.setActiveSession(unnumbered.id);
    const filed = store.createEntry({ playerText: "before it was numbered" });
    expect(filed).toMatchObject({ sessionId: unnumbered.id, sessionNumber: null });
    store.updateSession(unnumbered.id, { sessionNumber: 12 }, undefined, "gm");
    expect(store.getEntry(filed.id)!.sessionNumber, "...and the number appears the moment the GM sets one").toBe(12);
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
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

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
    expect(downtime.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
    // A note still has none, so `payload` is not quietly universal.
    expect(store.createEntry({ playerText: "plain" }).payload).toBeNull();

    // O-2: hidden on create, revealed by the ORDINARY switch. No kind-specific reveal path exists.
    expect(deadline.revealedToPlayers).toBe(false);
    expect(downtime.revealedToPlayers).toBe(false);
    expect(store.setEntryRevealed(deadline.id, true).revealedToPlayers).toBe(true);

    // §3.1 says search indexing "should be free" and to VERIFY it rather than assume. It is: `indexEntry`
    // runs from `insertEntry`, so both kinds are findable on their own text on exactly a note's terms —
    // and the unrevealed downtime is hidden from the player index by the reveal gate, not by its kind.
    expect(store.searchAll("gm", "ultimatum").hits.some((hit) => hit.kind === "journal" && hit.id === deadline.id)).toBe(true);
    expect(store.searchAll("gm", "poison").hits.some((hit) => hit.kind === "journal" && hit.id === downtime.id)).toBe(true);
    expect(store.searchAll("player", "ultimatum").hits.some((hit) => hit.id === deadline.id)).toBe(true);   // revealed above
    expect(store.searchAll("player", "poison").hits.some((hit) => hit.id === downtime.id)).toBe(false);     // still hidden

    // The ordinary journal editor must not eat the payload: `updateEntry` names its columns and
    // `payload_json` is not among them, so an unrelated text edit leaves it intact.
    expect(store.updateEntry(downtime.id, { playerText: "Vex brews something worse." }).payload)
      .toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });

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
        const { payload_json: payload, session_id: sessionId, session_number: sessionNumber, ...carried } = after[index];
        // EVERY pre-existing column, value for value - except the two v15/v19 touched, checked below.
        const { session_number: originalNumber, ...originalCarried } = original as Record<string, unknown>;
        expect(carried).toEqual(originalCarried);
        expect(payload).toBeNull();                                 // v15's new column starts empty
        // v19 (D9): a numbered row's number moved into the JOIN and the bare column was emptied; an
        // unnumbered row is untouched on both.
        if (originalNumber === null) { expect(sessionId).toBeNull(); expect(sessionNumber).toBeNull(); }
        else { expect(sessionId, "a legacy number resolved to a session record").not.toBeNull(); expect(sessionNumber, "and the bare column is now the LABEL store, empty").toBeNull(); }
      }
      // The rebuilt table IS the old table plus v15's and v19's columns, in the same order with the same
      // types, NOT-NULLs and defaults — including `tags_json`'s DEFAULT '[]', which v10 added and a
      // reconstructed-from-memory DDL would silently drop.
      expect(afterColumns.slice(0, -2)).toEqual(beforeColumns);
      expect(afterColumns.at(-2)).toEqual(["payload_json", "TEXT", 0, null]);
      expect(afterColumns.at(-1)).toEqual(["session_id", "TEXT", 0, null]);

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
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

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
    expect(applied.entry.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true, characterPageId: null });
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
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

    // Fires on the calendar write specifically, so `bumpRevision` (also an UPDATE on codex_meta) is untouched.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.exec("CREATE TRIGGER codex_test_block_calendar AFTER UPDATE OF calendar_json ON codex_meta BEGIN SELECT RAISE(ABORT, 'no calendar writes'); END;");
    raw.close();

    expect(() => store.applyDowntime(downtime.id)).toThrow();

    // BOTH sides unchanged. Re-read from the store, not from the value captured above.
    expect(store.getEntry(downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
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
  /**
   * An INTEGER column can hold a value JavaScript cannot represent, and that must not take the backup down.
   *
   * v15's backfill guards the JSON's TYPE but not its magnitude, so a hand-edited `calendar_json` carrying a
   * huge year lands in `published_year` and the migration COMPLETES. `node:sqlite` then throws on reading it
   * — and that read is on the path of `exportBundle` (the GM's only backup), both calendar reads, publish,
   * the timeline and apply-downtime. A codex that opens fine and cannot be backed up is the worst shape,
   * because nothing surfaces until backup time. Found by the final QA data-integrity pass.
   *
   * 2^53 is used deliberately: 2^53-1 is the largest value that reads back, so this is the first that throws.
   */
  it("reads an unrepresentable published date as 'nothing published' rather than taking the export down", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });

    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.prepare("UPDATE codex_meta SET published_year = ? WHERE id = 1").run(9007199254740992n);
    raw.close();

    expect(store.getPublishedDate()).toBeNull();          // not a date, so: nothing published
    expect(() => store.exportBundle()).not.toThrow();     // the backup still works, which is the point
    expect(store.exportBundle().publishedDate).toBeNull();
    // The GM's OWN clock is untouched, so publishing again repairs it without losing anything.
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });
  });

  /**
   * Deleting a page must not leave a quest pointing at it.
   *
   * `deletePage` cleaned markers and journal pins ("label-only rather than dangling") and leaned on FK
   * cascade for links, revisions and standing — but M10's quests are a THIRD referrer stored as a JSON
   * array, which has no FK to cascade through, and were never joined to the cleanup. The GM saw a link they
   * could not follow. Found by the final QA data-integrity pass and reproduced before fixing.
   */
  it("removes a deleted page from every quest's linked entities (M10 x page deletion)", () => {
    const doomed = store.createPage({ title: "Volo", entityType: "character" });
    const kept = store.createPage({ title: "Elminster", entityType: "character" });
    const quest = store.createQuest({ title: "Find Volo", entityIds: [doomed.id, kept.id] });
    const untouched = store.createQuest({ title: "Unrelated", entityIds: [kept.id] });
    expect(store.getQuest(quest.id)!.entityIds).toEqual([doomed.id, kept.id]);

    store.deletePage(doomed.id);

    expect(store.getQuest(quest.id)!.entityIds).toEqual([kept.id]);       // the dangling id is gone...
    expect(store.getQuest(untouched.id)!.entityIds).toEqual([kept.id]);   // ...and nothing else moved
    // Scoped: the quest itself, its title and the surviving link are all intact, not collateral.
    expect(store.getQuest(quest.id)!.title).toBe("Find Volo");
  });

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
    const downtime = store.createDowntime({ playerText: "A week off.", downtime: { who: "Vex", activity: "Resting", days: 7, characterPageId: null } });
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
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 11, day: 1 } });

    const bundle = store.exportBundle();
    expect(bundle.publishedDate).toEqual({ year: 1492, month: 3, day: 8 });                        // NOT the GM's clock
    expect(bundle.journal.find((entry) => entry.id === downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
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
      expect(reopened.getEntry(downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true, characterPageId: null });
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
      insertEntry.run(downtime, "Vex brews poison.", null, 0, null, null, "downtime", null, null, null, null, null, null, null, null, 2, '[]', JSON.stringify({ who: "Vex", activity: "Brewing poison", days: 30, applied: true, characterPageId: null }), "2026-01-05T00:00:00.000Z", "2026-01-05T00:00:00.000Z");

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
      // v16 itself must not touch `codex_journal` (v15 already did the work). What DOES touch it on this
      // upgrade path is v19 (D9), so the comparison is "old columns and old values, except the two D9
      // owns" rather than byte-identity - and asserting that explicitly is what would catch v16 quietly
      // growing a journal write.
      expect(journalColumnsAfter.slice(0, -1)).toEqual(journalColumnsBefore);
      expect(journalColumnsAfter.at(-1)).toEqual(["session_id", "TEXT", 0, null]);
      expect(journalAfter).toHaveLength(journalBefore.length);
      for (const [index, original] of (journalBefore as Array<Record<string, unknown>>).entries()) {
        const { session_id: sessionId, session_number: sessionNumber, ...carried } = journalAfter[index] as Record<string, unknown>;
        const { session_number: originalNumber, ...originalCarried } = original;
        expect(carried).toEqual(originalCarried);
        if (originalNumber === null) { expect(sessionId).toBeNull(); expect(sessionNumber).toBeNull(); }
        else { expect(sessionId).not.toBeNull(); expect(sessionNumber).toBeNull(); }
      }

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
      expect(upgraded.getEntry(downtime)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true, characterPageId: null });
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
    expect(store.searchAll("gm", "crypt").hits.some((hit) => hit.kind === "journal" && hit.id === milestone.id)).toBe(true);
    expect(store.searchAll("player", "crypt").hits.some((hit) => hit.id === milestone.id)).toBe(true);     // revealed above
    // ...and PAYLOAD text is NOT indexed, for any kind. A milestone's `reason` and a standing's `reason`
    // are GM-authored prose with no reveal gate of their own; indexing them would put them in the PLAYER
    // index with only the entry's reveal flag between them and a reader. "ossuary" and "caravan" appear
    // only inside a reason and never in a `playerText`, so a hit on either would BE the leak.
    expect(store.searchAll("gm", "ossuary").hits.some((hit) => hit.id === milestone.id)).toBe(false);
    expect(store.searchAll("gm", "caravan").hits.some((hit) => hit.id === standing.id)).toBe(false);

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

/**
 * The three keys `exportBundle` was missing until 2026-07-30 (owner decision), each asserted for the
 * FACT THAT EXISTS NOWHERE ELSE - which is the whole reason each had to join the bundle:
 *
 *  - the calendar: without it a restore re-derives every `calendarInstant` against the default 12x30
 *    calendar, silently re-dating a campaign that uses any other one.
 *  - an EMPTY folder: a folder that still holds pages is re-derivable from `codex_pages.folder`; an
 *    emptied one is remembered by `codex_folders` alone, so a restore was deleting the GM's filing.
 *  - revision history: the codex's only undo. `codex_page_revisions` is written by every page save and
 *    read by nothing else, so a bundle without it restores a history one revision deep.
 *
 * These are store-level on purpose. `GET /codex/export` returns the bundle verbatim and its contract
 * component is `additionalProperties: true` (an opaque blob), so an HTTP test can only re-assert what is
 * checked here - the layer that decides what is IN the bundle is this one.
 */
describe("CodexStore export bundle — the calendar, empty folders and revision history (2026-07-30)", () => {
  it("carries the CALENDAR, and keeps the GM's clock distinct from the published one", () => {
    // A deliberately non-default calendar: two 10-day months. If the bundle omits it, a restore re-derives
    // every instant against 12x30 and every dated record lands somewhere else.
    store.setCalendar({ yearName: "AR", months: [{ name: "Frost", days: 10 }, { name: "Thaw", days: 10 }], weekdays: ["Firstday"], currentDate: { year: 1492, month: 1, day: 4 } });
    store.publishCampaignDate();
    // The GM's clock then runs AHEAD, unpublished - the state O-1 exists to keep private.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 9 } });

    const bundle = store.exportBundle();
    expect(bundle.calendar.yearName).toBe("AR");
    expect(bundle.calendar.months).toEqual([{ name: "Frost", days: 10 }, { name: "Thaw", days: 10 }]);
    // The two clocks are two separate facts, and the bundle carries both without conflating them: a
    // restore that read the party's date off `calendar.currentDate` would jump them a year forward.
    expect(bundle.calendar.currentDate).toEqual({ year: 1493, month: 0, day: 9 });
    expect(bundle.publishedDate).toEqual({ year: 1492, month: 1, day: 4 });
  });

  it("carries an EMPTY folder, the one part of the GM's filing nothing else remembers", () => {
    const page = store.createPage({ title: "Village of Barovia", folder: "Barovia/Villages" });
    store.createFolder("Barovia/Ruins");                          // never held a page at all
    store.updatePage(page.id, { folder: null }, undefined, "gm"); // and now this one is empty too

    const bundle = store.exportBundle();
    expect(bundle.pages.find((row) => row.id === page.id)!.folder).toBeNull();
    // Neither path is derivable from any page's `folder` any more - `codex_folders` is the only witness.
    expect(bundle.folders).toEqual(expect.arrayContaining(["Barovia", "Barovia/Ruins", "Barovia/Villages"]));
  });

  it("carries EVERY page's revision history, with the snapshot columns a restore needs", () => {
    /**
     * `windowMinutes: 0` = checkpoint every save, which is exactly the behaviour this test was written
     * against before the 2026-07-30 throttle existed. It is set explicitly because this test is about what
     * the BUNDLE carries and therefore needs a history deeper than one entry; the throttle's own behaviour is
     * tested in "CodexStore revision history" below, not here.
     */
    store.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT });
    const page = store.createPage({ title: "Strahd", entityType: "character", fields: { race: "Vampire" }, gmFields: { goals: "Reclaim Tatyana" }, playerBody: "A count.", gmBody: "The darklord." });
    store.updatePage(page.id, { title: "Strahd von Zarovich", playerBody: "A count of Barovia." }, undefined, "gm");
    store.updatePage(page.id, { title: "Strahd, Lord of Barovia" }, undefined, "gm");
    const other = store.createPage({ title: "Ireena" });

    const bundle = store.exportBundle();
    // Both pages' histories in ONE list, regroupable by `pageId` - the reason the export read is not per
    // page the way `listRevisions` is.
    expect(new Set(bundle.revisions.map((row) => row.pageId))).toEqual(new Set([page.id, other.id]));
    const history = bundle.revisions.filter((row) => row.pageId === page.id);
    /**
     * Ascending: a history, not a feed. **One row per `rev`, never two.** Prior-state snapshots would otherwise
     * duplicate rev 1 - the creation checkpoints the page it just made, and the first edit checkpoints the
     * state it overwrites, which is still rev 1 and byte-identical - so `revisionExistsAt` suppresses the
     * second. That does not weaken "windowMinutes 0 keeps every save": a duplicate of a state already captured
     * loses nothing, and the set of states the GM can return to is the same either way.
     */
    expect(history.map((row) => row.rev)).toEqual([1, 2]);
    expect(history[0]).toMatchObject({ title: "Strahd", playerBody: "A count.", gmBody: "The darklord." });
    expect(history[1].title).toBe("Strahd von Zarovich");
    /**
     * The three snapshot columns `GET /codex/pages/{id}/revisions` does not send. `restoreRevision` reads
     * exactly these plus the wire row, so a bundle without them holds a history that restores a page's
     * prose and silently drops its typed fields - the same bug the gmFields export guard above exists for.
     */
    expect(history[0].entityType).toBe("character");
    expect(history[0].fields).toEqual({ race: "Vampire" });
    expect(history[0].gmFields).toEqual({ goals: "Reclaim Tatyana" });
    // And the WIRE row is unchanged by that: `listRevisions` still serves exactly the contract's ten keys.
    expect(Object.keys(store.listRevisions(page.id)[0]).sort())
      .toEqual(["authorTag", "authoredAt", "bannerAssetId", "gmBody", "id", "pageId", "playerBody", "rev", "tags", "title"]);
  });

  /**
   * The function's own three-times-stated convention: a new key is APPENDED so no existing key moves. A
   * consumer reads this bundle by key, so this is not about JSON ordering for its own sake - it is the
   * guard that stops a future fifth-time addition being slipped into the middle of the record.
   */
  it("appends the three keys LAST, leaving the previous eleven in their established order", () => {
    expect(Object.keys(store.exportBundle())).toEqual([
      "pages", "maps", "markers", "journal", "relationships", "sessions", "activeSessionId", "quests",
      "publishedDate", "standing", "partyMarkerId",
      "calendar", "folders", "revisions"
    ]);
  });
});

/**
 * OWNER DECISION (2026-07-30): revision history is globally disable-able and its frequency configurable.
 *
 * "revision history should be globally disable-able for the GM; and the frequency of revision history should
 * be configurable. Default is: if a previous version exists and is less than 90 minutes old, it does not
 * commit a versioned history, this means that at most, 90 minutes of work could be lost."
 *
 * Every test here drives the store's INJECTED clock (`new CodexStore(path, () => now)`) rather than sleeping,
 * which is why the constructor takes one. A test that slept could only ever exercise `windowMinutes: 0`.
 *
 * The other half of the decision is what the change deliberately does NOT do: nothing here prunes, trims or
 * deletes a revision row, and the disabled case asserts that explicitly rather than implying it.
 */
describe("CodexStore revision history — the GM's two knobs (owner decision, 2026-07-30)", () => {
  const EPOCH = Date.parse("2026-07-30T09:00:00.000Z");
  let clockDirectory: string;
  let clock: CodexStore;
  let now = EPOCH;
  /** Move the injected clock to `minutes` after the fixture's epoch. */
  const at = (minutes: number) => { now = EPOCH + minutes * 60_000; };

  beforeEach(async () => {
    clockDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-revisions-"));
    now = EPOCH;
    clock = new CodexStore(join(clockDirectory, "vtt.sqlite"), () => now);
    await clock.initialize();
  });
  afterEach(async () => {
    clock.close();
    await rm(clockDirectory, { recursive: true, force: true });
  });

  it("starts every codex on the owner's defaults: history on, a 90-minute window, nothing stored yet", () => {
    expect(clock.getSettings()).toEqual({
      revisionHistory: { enabled: true, windowMinutes: 90, versionCount: 0, versionBytes: 0 },
      // D6 / director ruling R4: autosave ON at the 1-second floor, which is what the shipping editors'
      // 800 ms debounce already did expressed on the wire's scale - an upgraded codex saves as often as it did.
      autosave: { enabled: true, intervalSeconds: 1 }
    });
  });

  it("coalesces a save INSIDE the window and checkpoints one OUTSIDE it", () => {
    at(0);
    const page = clock.createPage({ title: "Barovia", playerBody: "v0" });
    expect(clock.listRevisions(page.id)).toHaveLength(1);   // the creation checkpoint, never throttled

    at(89);                                                 // 89 < 90: coalesced into the existing checkpoint
    clock.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toHaveLength(1);

    at(90);                                                 // exactly 90 is NOT "less than 90", so this commits
    clock.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    const revisions = clock.listRevisions(page.id);
    expect(revisions).toHaveLength(2);
    // ...and what it captured is the state this save OVERWROTE (v1, authored at t=89), not the v2 it wrote.
    expect(revisions[0]).toMatchObject({ playerBody: "v1", authoredAt: new Date(EPOCH + 89 * 60_000).toISOString() });
  });

  /**
   * The easy inversion to ship by accident is `0 => never`. It is exactly backwards: `0` is the pre-decision
   * behaviour ("keep every save") and `enabled: false` is the "never". The clock deliberately does NOT move
   * between these saves, so nothing here can pass by accident of elapsed time.
   */
  it("checkpoints EVERY save at windowMinutes 0 — the OLD behaviour, not 'never'", () => {
    clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT });
    at(0);
    const page = clock.createPage({ title: "Vallaki", playerBody: "v0" });
    clock.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    clock.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    clock.updatePage(page.id, { playerBody: "v3" }, undefined, "gm");
    // Four writes, THREE checkpoints, with the clock frozen the whole time — one per distinct state.
    const revisions = clock.listRevisions(page.id);
    expect(revisions).toHaveLength(3);
    // Newest first. `v0` appears ONCE: the creation checkpoint already captured rev 1, so the first edit's
    // prior-state snapshot would have been a byte-identical duplicate and is suppressed. `v3` is absent
    // because it is the CURRENT state, which is the whole point of checkpointing the prior one.
    expect(revisions.map((row) => row.playerBody)).toEqual(["v2", "v1", "v0"]);
  });

  it("writes NOTHING with history disabled, and still lists and restores what already exists", () => {
    at(0);
    const page = clock.createPage({ title: "Krezk", playerBody: "the good version" });
    at(200); clock.updatePage(page.id, { playerBody: "second" }, undefined, "gm");
    at(400); clock.updatePage(page.id, { playerBody: "third" }, undefined, "gm");
    const before = clock.listRevisions(page.id);
    expect(before.map((row) => row.playerBody)).toEqual(["second", "the good version"]);

    clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    at(1000); clock.updatePage(page.id, { playerBody: "fourth" }, undefined, "gm");
    at(2000); clock.updatePage(page.id, { playerBody: "fifth" }, undefined, "gm");
    // Not one new row - and, just as important, not one row DESTROYED. Disabling a feature must not delete the
    // GM's only undo, so this asserts the exact same row ids are still there rather than merely a count.
    expect(clock.listRevisions(page.id).map((row) => row.id)).toEqual(before.map((row) => row.id));

    // ...and the history is still RESTORABLE with the switch off, which is the half a "stop writing" change
    // most easily breaks by routing restore through the same gate.
    const oldest = before[before.length - 1];
    expect(clock.restoreRevision(page.id, oldest.id, "gm").playerBody).toBe("the good version");
    // The restore is itself a save, and it wrote no revision either - nothing crept in through that path.
    // This is the one that catches a `force`-style exception ordered ABOVE the enabled switch: a restore always
    // checkpoints the text it discards (see the test below), and that exception must bypass the WINDOW only.
    expect(clock.listRevisions(page.id).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  /**
   * **Off means off, on the create path too.** `enabled: false` writes no checkpoint at all, not even a page's
   * creation - the two gates are deliberately different: the WINDOW never throttles a creation (a page with no
   * history has nothing to fall back to), but the SWITCH does.
   *
   * It was the other way round first, on the reasoning that the whole throttle belongs to `updatePage`. That
   * reasoning holds while history is ON and fails once the GM has turned it off: they have said they do not
   * want fallbacks, and a codex with history disabled would still have accumulated one checkpoint per page -
   * roughly 2x the page table - while the client told them in as many words that nothing new was being written.
   * "Globally disable-able" was the owner's phrase, and a switch that leaves a per-page row behind is not that.
   */
  it("writes NO checkpoint at all with history disabled, not even a page's creation", () => {
    clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    at(0);
    const page = clock.createPage({ title: "Berez", playerBody: "as created" });
    expect(clock.listRevisions(page.id)).toEqual([]);
    // And no later save sneaks one in either, however far outside the window it falls.
    at(5000); clock.updatePage(page.id, { playerBody: "edited" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toEqual([]);
    // The page itself is untouched by any of this — only its history is.
    expect(clock.getPage(page.id)!.playerBody).toBe("edited");
  });

  /**
   * Restoring ALWAYS checkpoints the state it discards, whatever the window says — preserving the behaviour
   * every save had before the throttle existed, not adding a policy.
   *
   * A restore is the one save that deliberately throws the current text away, which makes it the one that most
   * needs that text kept. Without this, restoring twice inside the window would lose the version the GM
   * restored away from and "I picked the wrong one" would be unrecoverable.
   */
  it("checkpoints the state a RESTORE discards, even well inside the window", () => {
    clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    /**
     * THE TIMING IS THE TEST, and it is fiddly enough to spell out — a first attempt spaced these saves so far
     * apart that the ordinary window fired anyway, and the assertion passed with `force` doing nothing at all
     * (proved by mutation: throttling the restore changed no result).
     *
     * The subtlety is that a checkpoint's `authored_at` is when its CONTENT was authored, not when the row was
     * written, so it always lags. To reach a state where an ordinary save would be suppressed, the newest
     * checkpoint's own `authored_at` has to be inside the window:
     *
     *   t=0    create "the original"       -> checkpoint rev 1, authored_at t=0
     *   t=200  save "a draft"              -> prior state is rev 1, already checkpointed: suppressed
     *   t=250  save "the good draft"       -> prior state is rev 2 ("a draft", authored t=200); newest
     *                                         checkpoint is authored t=0, age 250 > 90, so this WRITES,
     *                                         and the newest authored_at becomes t=200
     *   t=260  restore                     -> age is now 260-200 = 60 < 90, so an ordinary save writes
     *                                         NOTHING here. Only `force` checkpoints.
     */
    at(0);
    const page = clock.createPage({ title: "Argynvostholt", playerBody: "the original" });
    at(200); clock.updatePage(page.id, { playerBody: "a draft" }, undefined, "gm");
    at(250); clock.updatePage(page.id, { playerBody: "the good draft" }, undefined, "gm");
    const original = clock.listRevisions(page.id).find((row) => row.playerBody === "the original")!;

    at(260);
    clock.restoreRevision(page.id, original.id, "gm");
    expect(clock.getPage(page.id)!.playerBody).toBe("the original");

    // The draft the restore discarded is recoverable, which is the whole point: without this, restoring the
    // wrong version inside the window would lose the text you restored away from with no way back.
    const draft = clock.listRevisions(page.id).find((row) => row.playerBody === "the good draft");
    expect(draft, "restoring must checkpoint the text it overwrites").toBeDefined();
    expect(clock.restoreRevision(page.id, draft!.id, "gm").playerBody).toBe("the good draft");
  });

  it("never throttles createPage — even with a window nothing could fall outside", () => {
    clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 10_080 }, autosave: AUTOSAVE_DEFAULT }); // a week
    at(0);
    const first = clock.createPage({ title: "One" });
    at(1);
    const second = clock.createPage({ title: "Two" });
    expect(clock.listRevisions(first.id)).toHaveLength(1);
    expect(clock.listRevisions(second.id)).toHaveLength(1);
    // ...and the week-long window really is suppressing UPDATES at this setting, so the two assertions above
    // are the create path being exempt rather than the window failing to apply at all.
    at(5_000); // well over three days, still inside a week
    clock.updatePage(first.id, { playerBody: "edited" }, undefined, "gm");
    expect(clock.listRevisions(first.id)).toHaveLength(1);
  });

  /**
   * THE OWNER'S GUARANTEE, and the test that proves the snapshot must capture the PRIOR state.
   *
   * With NEW-state snapshots the sequence below loses the work outright: the save at t=0 is checkpointed, the
   * save at t=80 is coalesced away, the GM stops for two days, and then a save that ruins the page at t=3000 is
   * outside the window and checkpoints the RUIN. The good t=80 work was never captured and the GM falls all the
   * way back to t=0. Every assertion below fails in that world, which is what makes this the 2a proof.
   */
  it("checkpoints the GOOD prior state across an idle gap, so the ruinous save recovers the work", () => {
    at(0);
    const page = clock.createPage({ title: "Ravenloft", playerBody: "opening" });
    at(80);
    clock.updatePage(page.id, { playerBody: "the good work" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toHaveLength(1);      // 80 < 90: coalesced, nothing new yet

    at(3000);                                                  // two days idle, then one save ruins the page
    clock.updatePage(page.id, { playerBody: "" }, undefined, "gm");

    const revisions = clock.listRevisions(page.id);
    expect(revisions).toHaveLength(2);
    // The checkpoint that save took is the state it was ABOUT TO OVERWRITE, not the ruin it wrote.
    expect(revisions[0].playerBody).toBe("the good work");
    expect(revisions.map((row) => row.playerBody)).not.toContain("");
    // ...so restoring it recovers the work, rather than dropping the GM back to the opening draft.
    expect(clock.restoreRevision(page.id, revisions[0].id, "gm").playerBody).toBe("the good work");
  });

  /**
   * The consequence the throttle creates on purpose: the newest checkpoint now normally sits BEHIND the page's
   * current state, where before this change it equalled it and restoring it only bumped `rev`. Restoring the
   * newest entry is therefore a real undo, and this is the assertion that says so.
   */
  it("makes restoring the NEWEST revision a real undo, where it used to be a no-op", () => {
    at(0);
    const page = clock.createPage({ title: "Tser Pool", playerBody: "keep this" });
    at(500);
    clock.updatePage(page.id, { playerBody: "regret this" }, undefined, "gm");
    const newest = clock.listRevisions(page.id)[0];
    expect(newest.playerBody).toBe("keep this");
    expect(clock.getPage(page.id)!.playerBody).toBe("regret this");   // the two really differ
    expect(clock.restoreRevision(page.id, newest.id, "gm").playerBody).toBe("keep this");
  });

  it("clamps and truncates the window on the way in, and answers with what was STORED", () => {
    expect(clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 999_999 }, autosave: AUTOSAVE_DEFAULT }).revisionHistory.windowMinutes).toBe(10_080);
    expect(clock.getSettings().revisionHistory.windowMinutes).toBe(10_080);
    expect(clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: -12 }, autosave: AUTOSAVE_DEFAULT }).revisionHistory.windowMinutes).toBe(0);
    expect(clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 45.7 }, autosave: AUTOSAVE_DEFAULT }).revisionHistory).toMatchObject({ enabled: false, windowMinutes: 45 });
    expect(clock.getSettings().revisionHistory).toMatchObject({ enabled: false, windowMinutes: 45 });
    // A non-finite window is an ERROR, not a clamp: `Math.trunc(NaN)` is NaN, and clamping that would write
    // NaN into a STRICT INTEGER column. `standingValue`'s rule, for the same reason.
    expect(() => clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: Number.NaN }, autosave: AUTOSAVE_DEFAULT })).toThrow(/minutes/i);
    // ...and `enabled` must be stated rather than coerced from a missing field, because the coercion would land
    // on `false` and silently switch the GM's undo history off.
    expect(() => clock.setSettings({ revisionHistory: { windowMinutes: 90 } } as never)).toThrow(/on or off/i);
    expect(clock.getSettings().revisionHistory).toMatchObject({ enabled: false, windowMinutes: 45 }); // neither throw wrote
  });

  /**
   * The READ guard, which exists for the reason `getPublishedDate`'s does: the write is not the only way into an
   * INTEGER column. A repair script or a hand-edited database reaches the same place, and a value JavaScript
   * cannot represent makes `node:sqlite` THROW on the read rather than return something odd - which, for
   * `getPublishedDate`, meant a codex that opened fine and could not be backed up.
   *
   * Edited with the store CLOSED and reopened, so this is genuinely a stored value arriving at a fresh read
   * rather than a value smuggled past the setter.
   */
  it("reads an out-of-range, unrepresentable or garbled stored setting as the default", async () => {
    const path = join(clockDirectory, "vtt.sqlite");
    const page = clock.createPage({ title: "Argynvostholt", playerBody: "v0" });
    clock.close();

    const write = (sql: string, ...values: Array<number | bigint>) => {
      const database = new DatabaseSync(path);
      database.prepare(sql).run(...values);
      database.close();
    };
    const reopen = async () => { const reopened = new CodexStore(path, () => now); await reopened.initialize(); return reopened; };

    // First the NON-VACUITY half: an in-range value really does survive the round trip, so the assertions
    // below are the guard firing rather than the getter ignoring the column.
    write("UPDATE codex_meta SET revision_window_minutes = ? WHERE id = 1", 45);
    let store45 = await reopen();
    expect(store45.getSettings().revisionHistory.windowMinutes).toBe(45);
    store45.close();

    for (const stored of [-5, 10_081, 2n ** 53n]) {
      write("UPDATE codex_meta SET revision_window_minutes = ? WHERE id = 1", stored);
      const reopened = await reopen();
      // Never throws (the 2^53 case is the one that would), and reads as the owner's default.
      expect(reopened.getSettings().revisionHistory.windowMinutes, `stored ${stored}`).toBe(90);
      // Behavioural, not just the getter: the throttle really runs at 90 minutes, so a save at t=200 commits.
      at(0); reopened.updatePage(page.id, { playerBody: "inside" }, undefined, "gm");
      expect(reopened.listRevisions(page.id), `stored ${stored}`).toHaveLength(1);
      at(200); reopened.updatePage(page.id, { playerBody: "outside" }, undefined, "gm");
      expect(reopened.listRevisions(page.id), `stored ${stored}`).toHaveLength(2);
      reopened.close();
      // Put the page back to a one-checkpoint state for the next iteration.
      write("DELETE FROM codex_page_revisions WHERE rev > 1 OR id NOT IN (SELECT MIN(id) FROM codex_page_revisions)");
    }

    // `enabled` accepts EXACTLY 0 or 1; anything else reads as ON. Fail-OPEN here, deliberately the opposite of
    // this file's reveal discipline: a garbled value must not silently stop recording the GM's undo history.
    write("UPDATE codex_meta SET revision_history_enabled = 7, revision_window_minutes = 90 WHERE id = 1");
    const garbled = await reopen();
    expect(garbled.getSettings().revisionHistory).toMatchObject({ enabled: true, windowMinutes: 90 });
    garbled.close();
    // ...and 0 is still honoured, so "reads as on" is the fallback and not the only answer it can give.
    write("UPDATE codex_meta SET revision_history_enabled = 0 WHERE id = 1");
    const off = await reopen();
    expect(off.getSettings().revisionHistory.enabled).toBe(false);
    off.close();

    // Reopened at the end so the fixture's `afterEach` has a live store to close.
    clock = await reopen();
  });

  /**
   * D6 / director ruling R4: the autosave knobs, held to `revisionHistory`'s standard because they are stored
   * in the same row by the same write and read back through the same fail-closed discipline.
   */
  it("clamps and truncates the autosave interval on the way in, and answers with what was STORED", () => {
    const set = (autosave: { enabled: boolean; intervalSeconds: number }) =>
      clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 }, autosave });
    // Overshoot in either direction lands on the end of the scale; a fractional second is a picker artefact.
    expect(set({ enabled: true, intervalSeconds: 5000 }).autosave.intervalSeconds).toBe(600);
    expect(set({ enabled: true, intervalSeconds: 0 }).autosave.intervalSeconds).toBe(1);
    expect(set({ enabled: true, intervalSeconds: -30 }).autosave.intervalSeconds).toBe(1);
    expect(set({ enabled: false, intervalSeconds: 10.9 }).autosave).toEqual({ enabled: false, intervalSeconds: 10 });
    expect(clock.getSettings().autosave).toEqual({ enabled: false, intervalSeconds: 10 });
    // A non-finite interval is an ERROR, not a clamp - `Math.trunc(NaN)` is NaN and a STRICT INTEGER column
    // would take it. `revisionWindowMinutes`' rule, one setting over.
    expect(() => set({ enabled: true, intervalSeconds: Number.NaN })).toThrow(/seconds/i);
    // ...and `enabled` must be STATED, because a coerced missing field lands on `false` and switches off the
    // one thing D6 promises: that the codex keeps your work.
    expect(() => clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 } } as never)).toThrow(/on or off/i);
    expect(clock.getSettings().autosave).toEqual({ enabled: false, intervalSeconds: 10 }); // neither throw wrote
  });

  /**
   * The autosave READ guard, `revisionSettings`' for the same measured reason: the write is not the only way
   * into an INTEGER column, and a stored value JavaScript cannot represent throws on the WHOLE row read.
   */
  it("reads a hand-edited autosave value as the default rather than propagating it", async () => {
    const path = join(clockDirectory, "vtt.sqlite");
    clock.close();
    const write = (sql: string, ...values: Array<number | bigint>) => {
      const database = new DatabaseSync(path);
      database.prepare(sql).run(...values);
      database.close();
    };
    const reopen = async () => { const reopened = new CodexStore(path, () => now); await reopened.initialize(); return reopened; };

    // Non-vacuity first: an in-range value really does survive, so the assertions below are the guard firing.
    write("UPDATE codex_meta SET autosave_interval_seconds = ? WHERE id = 1", 45);
    const inRange = await reopen();
    expect(inRange.getSettings().autosave.intervalSeconds).toBe(45);
    inRange.close();

    for (const stored of [0, -1, 601, 2n ** 53n]) {
      write("UPDATE codex_meta SET autosave_interval_seconds = ? WHERE id = 1", stored);
      const reopened = await reopen();
      expect(reopened.getSettings().autosave.intervalSeconds, `stored ${stored}`).toBe(1);
      reopened.close();
    }
    // `enabled` fails OPEN, like revision history and for the same reason: a garbled value must not silently
    // stop the editors saving. 0 is still honoured, so "reads as on" is a fallback and not the only answer.
    write("UPDATE codex_meta SET autosave_enabled = 7, autosave_interval_seconds = 30 WHERE id = 1");
    const garbled = await reopen();
    expect(garbled.getSettings().autosave).toEqual({ enabled: true, intervalSeconds: 30 });
    garbled.close();
    write("UPDATE codex_meta SET autosave_enabled = 0 WHERE id = 1");
    const off = await reopen();
    expect(off.getSettings().autosave.enabled).toBe(false);
    off.close();

    clock = await reopen();
  });

  /**
   * D7 / director ruling R7. A type-changing save PRUNES every field the new type does not declare, and the
   * client's confirm dialog promises the values are recoverable from History. Under the coalescing window
   * alone that promise held only by luck - a GM who types a page and then fixes its kind is inside the window
   * by construction - so a type change forces the checkpoint the way a restore does.
   *
   * The negative half is the load-bearing one: an ordinary save inside the window still coalesces, so this is
   * a rule about type changes and not the throttle quietly switched off.
   */
  it("forces a checkpoint when a page's TYPE changes, even well inside the coalescing window", () => {
    at(0);
    const page = clock.createPage({ title: "Strahd", entityType: "character", fields: { role: "the devil" } });
    expect(clock.listRevisions(page.id)).toHaveLength(1); // the creation checkpoint

    at(1); // one minute in: far inside the 90-minute window
    clock.updatePage(page.id, { playerBody: "an ordinary edit" }, undefined, "gm");
    expect(clock.listRevisions(page.id), "an ordinary save inside the window still coalesces").toHaveLength(1);

    at(2);
    const changed = clock.updatePage(page.id, { entityType: "faction" }, undefined, "gm");
    expect(changed.entityType).toBe("faction");
    expect(changed.fields.role, "the character-only field is pruned by the switch").toBeUndefined();
    const revisions = clock.listRevisions(page.id);
    expect(revisions, "the type change forced a checkpoint of the pre-change state").toHaveLength(2);

    // ...and the promise the confirm dialog makes is real: restoring brings the pruned field back.
    const restored = clock.restoreRevision(page.id, revisions[0]!.id, "gm");
    expect(restored.entityType).toBe("character");
    expect(restored.fields.role).toBe("the devil");
  });

  /**
   * The switch still wins. `enabled: false` writes NO new revisions at all, and a type change is not an
   * exception to it - `revisionDue` checks the switch before the force, and that ordering is the promise
   * "off means off" makes.
   */
  it("writes no forced checkpoint for a type change when history is switched off", () => {
    at(0);
    const page = clock.createPage({ title: "Ireena", entityType: "character" });
    clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    const before = clock.listRevisions(page.id).length;
    at(1);
    clock.updatePage(page.id, { entityType: "location" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toHaveLength(before);
  });

  /**
   * THE MIGRATION PATH, against a REAL v16 database rather than a fresh one - the discipline the v11 backfill
   * test established and the v14->v15 and v12->v16 paths were checked with. A fresh-database test can never
   * catch a bad upgrade, because every table is empty and every default is trivially satisfied.
   *
   * Built out of the SHIPPED migration SQL up to v16, filled with a page and two revision rows exactly as the
   * old code wrote them (new-state snapshots, `authored_at` from the page's `updated_at`), then opened with a
   * CodexStore - which is precisely the upgrade a GM's existing `vtt.sqlite` performs on next boot.
   */
  it("upgrades a REAL v16 database: the defaults land, and every existing revision survives", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v16-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      for (const migration of MIGRATIONS.filter((entry) => entry.version <= 16)) {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
      }
      database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 4)").run();
      const pageId = crypto.randomUUID();
      const legacyStamp = new Date(EPOCH - 30 * 60_000).toISOString(); // authored half an hour before "now"
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, 'Vistani camp', 'location', '{}', '{}', NULL, '[]', 'v2', 'the secret', 0, NULL, 2, ?, ?)")
        .run(pageId, legacyStamp, legacyStamp);
      const insertRevision = database.prepare("INSERT INTO codex_page_revisions (page_id, rev, title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, 'Vistani camp', 'location', '{}', '{}', ?, 'the secret', NULL, '[]', ?, 'gm')");
      insertRevision.run(pageId, 1, "v1", new Date(EPOCH - 120 * 60_000).toISOString());
      insertRevision.run(pageId, 2, "v2", legacyStamp);
      // No `revision_history_enabled` / `revision_window_minutes` yet - that is the point of the fixture.
      expect((database.prepare("PRAGMA table_info(codex_meta)").all() as Array<{ name: string }>).map((row) => row.name))
        .not.toContain("revision_window_minutes");
      database.close();

      at(0);
      upgraded = new CodexStore(path, () => now);
      await upgraded.initialize();

      // v17 applied, and the DEFAULTS landed on the pre-existing meta row - which is the whole upgrade story:
      // an existing codex keeps today's behaviour (history on) and gains the owner's 90-minute window.
      const applied = new DatabaseSync(path);
      expect((applied.prepare("SELECT version FROM codex_schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((row) => row.version))
        .toEqual(MIGRATIONS.map((migration) => migration.version));
      expect(applied.prepare("SELECT revision_history_enabled AS enabled, revision_window_minutes AS window FROM codex_meta WHERE id = 1").get())
        .toMatchObject({ enabled: 1, window: 90 });
      applied.close();
      expect(upgraded.getSettings().revisionHistory).toMatchObject({ enabled: true, windowMinutes: 90 });
      // ...and the usage figures see the LEGACY rows, so the settings screen reports a pre-existing history
      // rather than an empty one on the first boot after the upgrade.
      expect(upgraded.getSettings().revisionHistory.versionCount).toBe(2);
      expect(upgraded.getSettings().revisionHistory.versionBytes).toBeGreaterThan(0);

      // EVERY pre-existing revision survives, untouched, in order - nothing about this change prunes.
      expect(upgraded.listRevisions(pageId).map((row) => ({ rev: row.rev, playerBody: row.playerBody })))
        .toEqual([{ rev: 2, playerBody: "v2" }, { rev: 1, playerBody: "v1" }]);
      // ...and they are still restorable on the upgraded codex.
      const oldest = upgraded.listRevisions(pageId)[1];
      expect(upgraded.restoreRevision(pageId, oldest.id, "gm").playerBody).toBe("v1");

      // The new window applies IMMEDIATELY, measured against the legacy rows' own `authored_at`: the newest
      // legacy checkpoint was authored 30 minutes ago, so the restore above (a save) coalesced into it...
      expect(upgraded.listRevisions(pageId)).toHaveLength(2);
      // ...and a save two hours later commits.
      at(120);
      upgraded.updatePage(pageId, { playerBody: "v4" }, undefined, "gm");
      expect(upgraded.listRevisions(pageId)).toHaveLength(3);
      expect(upgraded.listRevisions(pageId)[0].playerBody).toBe("v1"); // the state the restore left behind
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });
});

/**
 * OWNER DECISION (2026-07-30), the second half: the GM asked for a way to DELETE existing version history, and
 * for the settings screen to report what that history costs.
 *
 * The usage figures and the delete are tested together because they are one loop in use - read the cost, decide,
 * trim, read it again - and a test that only ever read the figures could not tell a real count from a constant.
 */
describe("CodexStore revision history — usage figures and the delete (owner decision, 2026-07-30)", () => {
  const EPOCH = Date.parse("2026-07-30T09:00:00.000Z");
  let pruneDirectory: string;
  let pruner: CodexStore;
  let now = EPOCH;
  /** Move the injected clock `days` before/after the fixture's epoch. */
  const atDays = (days: number) => { now = EPOCH + days * 86_400_000; };

  beforeEach(async () => {
    pruneDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-prune-"));
    now = EPOCH;
    pruner = new CodexStore(join(pruneDirectory, "vtt.sqlite"), () => now);
    await pruner.initialize();
    // Every save checkpointed, so a test can build a history of a known depth without moving the clock for it.
    pruner.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT });
  });
  afterEach(async () => {
    pruner.close();
    await rm(pruneDirectory, { recursive: true, force: true });
  });

  it("counts the WHOLE table, not one page's rows, and moves with what is stored", () => {
    expect(pruner.getSettings().revisionHistory).toMatchObject({ versionCount: 0, versionBytes: 0 });

    const first = pruner.createPage({ title: "Barovia", playerBody: "abcde", gmBody: "fgh" });   // 1 revision
    const second = pruner.createPage({ title: "Vallaki", playerBody: "ij" });                    // 1 revision
    // The first EDIT adds nothing: its prior state is rev 1, which the creation already checkpointed, so
    // `revisionExistsAt` suppresses the byte-identical duplicate. A second edit is what adds a row.
    pruner.updatePage(first.id, { playerBody: "klmno" }, undefined, "gm");
    pruner.updatePage(first.id, { playerBody: "pqrst" }, undefined, "gm");                        // 1 more
    // Three rows across TWO pages: a per-page count would read 2 here, and a count of the page table would read 2.
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(3);
    expect(pruner.listRevisions(first.id)).toHaveLength(2);
    expect(pruner.listRevisions(second.id)).toHaveLength(1);

    /**
     * `versionBytes` sums the content columns a revision duplicates from its page: title + both bodies + both
     * field maps + tags. Computed here from the known inputs rather than asserted as a magic number, so the
     * assertion says WHICH columns are summed instead of merely pinning today's total.
     */
    const weight = (title: string, playerBody: string, gmBody: string) =>
      title.length + playerBody.length + gmBody.length + "{}".length * 2 + "[]".length;
    expect(pruner.getSettings().revisionHistory.versionBytes).toBe(
      weight("Barovia", "abcde", "fgh") + weight("Barovia", "abcde", "fgh") + weight("Vallaki", "ij", "")
    );
  });

  it("reports a smaller history after a delete — the read/trim/read loop the screen is for", () => {
    pruner.createPage({ title: "Krezk", playerBody: "a long-ish body" });
    pruner.createPage({ title: "Berez", playerBody: "another body" });
    const before = pruner.getSettings().revisionHistory;
    expect(before.versionCount).toBe(2);
    expect(before.versionBytes).toBeGreaterThan(0);

    expect(pruner.deleteRevisionsOlderThan(0)).toBe(2);
    const after = pruner.getSettings().revisionHistory;
    expect(after).toMatchObject({ versionCount: 0, versionBytes: 0 });
    // The knobs are untouched by a delete - trimming is not a settings change.
    expect(after).toMatchObject({ enabled: true, windowMinutes: 0 });
  });

  /**
   * `olderThanDays: 0` deletes everything, and it must be ARITHMETIC rather than a special case - nothing is
   * younger than zero days old. A test asserting only the 0 case could pass against a `if (days === 0) delete
   * everything` branch, so this asserts the boundary either side of it too.
   */
  it("deletes EVERY revision at olderThanDays 0, by ordinary arithmetic", () => {
    const page = pruner.createPage({ title: "Argynvostholt", playerBody: "v0" });
    // Three edits, not two: the first one's prior state duplicates the creation checkpoint and is suppressed.
    pruner.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    pruner.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    pruner.updatePage(page.id, { playerBody: "v3" }, undefined, "gm");
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(3);

    expect(pruner.deleteRevisionsOlderThan(0)).toBe(3);
    expect(pruner.listRevisions(page.id)).toEqual([]);
    // A second call finds nothing left and says 0 rather than repeating the first answer - idempotent, and
    // `deleted` is a real count rather than a restatement of the request.
    expect(pruner.deleteRevisionsOlderThan(0)).toBe(0);
  });

  it("leaves the NEWER rows alone, and reports the real number it removed", () => {
    // Four checkpoints authored on four different days: the page is saved once a day for four days.
    const page = pruner.createPage({ title: "Tser Pool", playerBody: "day-0" });
    // A second day-0 save, so day 0 genuinely holds TWO checkpoints: the creation, plus the state this edit
    // displaces. Without it the first dated edit would only duplicate rev 1 and be suppressed, and the
    // inclusive-boundary assertion below would have just one row to delete rather than two.
    pruner.updatePage(page.id, { playerBody: "day-0 again" }, undefined, "gm");
    for (const day of [1, 2, 3]) { atDays(day); pruner.updatePage(page.id, { playerBody: `day-${day}` }, undefined, "gm"); }
    atDays(3);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2", "day-1", "day-0 again", "day-0"]);

    /**
     * From t=day-3, "older than 3 days" is a cutoff of exactly day 0 - and the boundary is INCLUSIVE, the same
     * arithmetic that makes `olderThanDays: 0` delete everything. So the two day-0 checkpoints go and the
     * day-1 and day-2 ones stay.
     *
     * The SURVIVORS are asserted, not just the count: a delete that took the wrong two rows would satisfy a
     * count-only assertion exactly.
     */
    expect(pruner.deleteRevisionsOlderThan(3)).toBe(2);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2", "day-1"]);
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(2);

    // A second, narrower cut takes exactly one more row - so the age really is per-row rather than all-or-nothing.
    expect(pruner.deleteRevisionsOlderThan(2)).toBe(1);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2"]);

    // A window wide enough to cover nothing removes nothing, and says so.
    expect(pruner.deleteRevisionsOlderThan(365)).toBe(0);
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
  });

  /**
   * A page as it stands now is not a version of itself. This is the assertion that a delete-everything cannot
   * quietly become a data-loss bug: pages, both their bodies, their typed fields and their `rev` all survive.
   */
  it("never touches codex_pages — bodies, fields and rev all survive a delete-everything", () => {
    // A `character`, because that is the type `goals` is a (secret) field of - the pruning rule CD-2 applies on
    // the way in, so a `location` would arrive with `gmFields` already empty and prove nothing about the delete.
    const page = pruner.createPage({ title: "Madam Eva", entityType: "character", fields: { race: "Vistani" }, gmFields: { goals: "watch the road" }, playerBody: "wagons", gmBody: "they know Strahd" });
    pruner.updatePage(page.id, { playerBody: "wagons and horses" }, undefined, "gm");
    const beforePage = pruner.getPage(page.id)!;
    const beforeCount = pruner.listPages().length;

    // ONE revision: the creation checkpoint. The edit's prior state is rev 1, already captured.
    expect(pruner.deleteRevisionsOlderThan(0)).toBe(1);

    expect(pruner.getPage(page.id)).toEqual(beforePage);   // every column, including `rev` and `updatedAt`
    expect(pruner.getPage(page.id)!.playerBody).toBe("wagons and horses");
    expect(pruner.getPage(page.id)!.gmBody).toBe("they know Strahd");
    expect(pruner.getPage(page.id)!.gmFields).toEqual({ goals: "watch the road" });
    expect(pruner.getPage(page.id)!.rev).toBe(2);
    expect(pruner.listPages()).toHaveLength(beforeCount);
    // ...and the page is still editable afterwards, which a broken cascade would have taken away.
    expect(pruner.updatePage(page.id, { playerBody: "wagons, horses and a bear" }, undefined, "gm").rev).toBe(3);
  });

  it("deletes regardless of the enabled setting — the GM who turned history off is the one reclaiming space", () => {
    const page = pruner.createPage({ title: "Berez", playerBody: "v0" });
    pruner.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    pruner.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(2);

    pruner.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    expect(pruner.deleteRevisionsOlderThan(0)).toBe(2);
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(0);
  });

  /**
   * REJECTED, not clamped - the deliberate opposite of `windowMinutes`, because this is the one destructive
   * route in the Codex and a malformed destructive request must not be interpreted generously.
   */
  it("rejects a negative, fractional or absurd age rather than clamping it, and deletes nothing when it does", () => {
    const page = pruner.createPage({ title: "Yester Hill", playerBody: "v0" });
    for (const bad of [-1, 3.5, Number.NaN, Number.POSITIVE_INFINITY, 36_501]) {
      expect(() => pruner.deleteRevisionsOlderThan(bad), `olderThanDays ${bad}`).toThrow(/whole number of days/i);
    }
    // Not one row went while all five were refused.
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
    // The upper bound is a GUARD, not a policy: 36500 is accepted and simply matches nothing, where an
    // unbounded value would push the cutoff date out of range and throw `RangeError: Invalid time value`.
    expect(pruner.deleteRevisionsOlderThan(36_500)).toBe(0);
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
  });
});

/**
 * THE ETAG'S LOAD-BEARING INVARIANT, pinned at the layer that owns it.
 *
 * `readEnvelope` serves `W/"codex-r{store.revision}-{grade}"` and answers 304 to a matching
 * `If-None-Match`. That is only correct while EVERY public write bumps the coarse revision inside its own
 * transaction - reveals and clock moves included, since those change what a reader sees without moving any
 * record's `rev`. A single write that forgets `bumpRevision()` does not fail visibly: it serves a stale 304
 * to every conditional caller, forever, and no existing test would notice.
 *
 * So this walks the write surface rather than sampling it, and asserts STRICT increase per call. A new write
 * method added without a bump does not fail here automatically - nothing can enumerate the class - which is
 * exactly why the list below is the checklist: a new public write belongs in it.
 */
describe("every codex write bumps the coarse revision (the ETag's invariant)", () => {
  it("strictly increases `revision` across every public write", () => {
    const seen: string[] = [];
    let previous = store.revision;
    const bumps = (what: string, work: () => void) => {
      work();
      const now = store.revision;
      expect(now, `${what} must bump the codex revision - the ETag depends on it`).toBeGreaterThan(previous);
      previous = now;
      seen.push(what);
    };

    // Pages, folders, revisions
    const faction = store.createPage({ title: "The Keepers of the Feather", entityType: "faction" });
    let page = store.createPage({ title: "Barovia" });
    bumps("createPage", () => { page = store.createPage({ title: "Vallaki" }); });
    bumps("updatePage", () => { store.updatePage(page.id, { playerBody: "a walled town" }, undefined, "gm"); });
    bumps("setPageRevealed", () => { store.setPageRevealed(page.id, true); });
    bumps("createFolder", () => { store.createFolder("Places"); });
    bumps("moveFolder", () => { store.moveFolder("Places", "Locations"); });
    bumps("deleteFolder", () => { store.deleteFolder("Locations"); });
    const revisionId = store.listRevisions(page.id)[0]!.id;
    bumps("restoreRevision", () => { store.restoreRevision(page.id, revisionId, "gm"); });
    bumps("deleteRevisionsOlderThan", () => { store.deleteRevisionsOlderThan(0); });
    bumps("setSettings", () => { store.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT }); });

    // Connections
    const other = store.createPage({ title: "Strahd", entityType: "character" });
    let relationshipId = "";
    bumps("createConnection", () => { relationshipId = store.createConnection(other.id, { toPageId: page.id, label: "rules" }).id; });
    bumps("updateConnection", () => { store.updateConnection(relationshipId, { label: "rules over" }); });
    bumps("deleteConnection", () => { store.deleteConnection(relationshipId); });

    // Maps + markers
    let map = store.createMap({ assetId: crypto.randomUUID(), name: "Barovia", kind: "regional" });
    let marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff0000" });
    bumps("createMap", () => { map = store.createMap({ assetId: crypto.randomUUID(), name: "Castle Ravenloft", kind: "battlemap" }); });
    bumps("updateMap", () => { store.updateMap(map.id, { name: "Ravenloft" }); });
    bumps("setMapParent", () => { store.setMapParent(map.id, null); });
    bumps("setMapRevealed", () => { store.setMapRevealed(map.id, true); });
    bumps("createMarker", () => { marker = store.createMarker(map.id, { x: 0.1, y: 0.1, iconId: "pin", iconColor: "#00ff00" }); });
    bumps("updateMarker", () => { store.updateMarker(marker.id, { label: "the gate" }); });
    bumps("moveMarker", () => { store.moveMarker(marker.id, 0.2, 0.2); });
    bumps("setMarkerRevealed", () => { store.setMarkerRevealed(marker.id, true); });
    bumps("setPartyMarker", () => { store.setPartyMarker(marker.id); });
    bumps("deleteMarker", () => { store.deleteMarker(marker.id); });
    bumps("deleteMap", () => { store.deleteMap(map.id); });

    // Calendar + the two clocks
    bumps("setCalendar", () => { store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 12 } }); });
    bumps("publishCampaignDate", () => { store.publishCampaignDate(); });

    // Journal, in every flavour it is written
    let entry = store.createEntry({ playerText: "we arrived" });
    bumps("createEntry", () => { entry = store.createEntry({ playerText: "we left" }); });
    bumps("updateEntry", () => { store.updateEntry(entry.id, { playerText: "we left at dawn" }); });
    bumps("setEntryRevealed", () => { store.setEntryRevealed(entry.id, true); });
    bumps("appendCombatEntry", () => { store.appendCombatEntry({ sourceEncounterId: 1, playerText: "a battle" }); });
    bumps("createDeadline", () => { store.createDeadline({ playerText: "the ritual", inWorldDate: { year: 1492, month: 3, day: 1 } }); });
    let downtime = store.createDowntime({ playerText: "smithing", downtime: { who: "Ireena", activity: "smithing", days: 3, characterPageId: null } });
    bumps("createDowntime", () => { downtime = store.createDowntime({ playerText: "training", downtime: { who: "Ismark", activity: "training", days: 2, characterPageId: null } }); });
    bumps("applyDowntime", () => { store.applyDowntime(downtime.id); });
    bumps("createMilestone", () => { store.createMilestone({ playerText: "level 5", milestone: { level: 5, reason: "cleared the crypt" } }); });
    bumps("deleteEntry", () => { store.deleteEntry(entry.id); });

    // Sessions
    let session = store.createSession({ sessionNumber: 1 });
    bumps("createSession", () => { session = store.createSession({ sessionNumber: 2 }); });
    bumps("updateSession", () => { store.updateSession(session.id, { recapBody: "we survived" }, undefined, "gm"); });
    bumps("setSessionRevealed", () => { store.setSessionRevealed(session.id, true); });
    bumps("setActiveSession", () => { store.setActiveSession(session.id); });
    bumps("deleteSession", () => { store.deleteSession(session.id); });

    // Quests
    let quest = store.createQuest({ title: "Find the Sunsword" });
    bumps("createQuest", () => { quest = store.createQuest({ title: "Free Ireena" }); });
    bumps("updateQuest", () => { store.updateQuest(quest.id, { status: "completed" }, undefined); });
    bumps("setQuestRevealed", () => { store.setQuestRevealed(quest.id, true); });
    bumps("deleteQuest", () => { store.deleteQuest(quest.id); });

    // Standing (against the faction page created at the top)
    bumps("setStanding", () => { store.setStanding(faction.id, 30, "kind words"); });
    bumps("setStandingRevealed", () => { store.setStandingRevealed(faction.id, true); });

    bumps("deletePage", () => { store.deletePage(other.id); });

    // Non-vacuity: the walk really covered the surface rather than short-circuiting after two calls.
    expect(seen.length).toBeGreaterThanOrEqual(40);
  });
});

/**
 * D10: sessions join the ONE suite-wide search index. A new kind in that index is a THREE-gate
 * viewer-safety change (`CodexRecordKind`'s comment enumerates them), and gate 1 is the one with no
 * second line of defence - so each gate is asserted at ITS OWN layer here, the CI-1 discipline this file
 * established after a weakened SQL predicate left every test passing because a projection caught it.
 */
describe("CodexStore search — sessions join the one index (D10, three gates)", () => {
  const seed = () => store.createSession({
    sessionNumber: 4, realDate: "2026-07-30", tags: ["ravenloft"],
    prepBody: "The ambush is at the bridge; Ireena is the real target.",
    recapBody: "The party crossed the bridge.",
    attendees: ["Ozy", "Mara"]
  });

  it("GATE 1 — prep and attendees never enter the PLAYER index, even for a revealed session", () => {
    const session = store.setSessionRevealed(seed().id, true);
    // The GM can find it by its prep and by who was there.
    expect(store.searchAll("gm", "ambush").hits.some((hit) => hit.id === session.id)).toBe(true);
    expect(store.searchAll("gm", "Mara").hits.some((hit) => hit.id === session.id)).toBe(true);
    // The player cannot, and the session is REVEALED - so gates 2 and 3 both pass it. The hit's very
    // existence would be the leak, even though no body is ever returned.
    expect(store.searchAll("player", "ambush").hits).toEqual([]);
    expect(store.searchAll("player", "Mara").hits).toEqual([]);
    // Non-vacuity: the player index really does hold this session, by its recap, date and tags.
    for (const query of ["crossed", "2026-07-30", "ravenloft"]) {
      expect(store.searchAll("player", query).hits.some((hit) => hit.kind === "session" && hit.id === session.id), query).toBe(true);
    }
  });

  it("GATE 2 — the SQL predicate hides an UNREVEALED session from a player, below any projection", () => {
    const session = seed();
    // Called directly, with no projection in front of it: this is the layer an HTTP test cannot see.
    expect(store.searchAll("player", "crossed").hits).toEqual([]);
    expect(store.searchAll("gm", "crossed").hits.some((hit) => hit.id === session.id)).toBe(true);
    store.setSessionRevealed(session.id, true);
    // Revealing needs NO reindex - reveal is resolved at read time, the `setQuestRevealed` rule.
    expect(store.searchAll("player", "crossed").hits.some((hit) => hit.id === session.id)).toBe(true);
  });

  it("GATE 3 — the projection arm refuses an unrevealed session even when the SQL layer passes it", () => {
    const session = seed();
    // Constructed by hand, exactly as the SQL layer would have handed it over if gate 2 were weakened.
    expect(projectPlayerSearchHit({ kind: "session", session }, playerSessionNumbers())).toBeNull();
    // The GM's hit exists for the same record, so the null is the reveal gate and not a missing arm.
    expect(projectGmSearchHit({ kind: "session", session })).toMatchObject({ kind: "session", id: session.id, title: "Session 4" });
    const revealed = store.setSessionRevealed(session.id, true);
    const hit = projectPlayerSearchHit({ kind: "session", session: revealed }, playerSessionNumbers())!;
    // The same uniform key set every other kind emits - a row renderer must never branch on which kind it got.
    expect(Object.keys(hit).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(hit.tags).toEqual(["ravenloft"]);
    // Nothing from the GM layer rides along on the hit, whatever the title rule does.
    expect(JSON.stringify(hit)).not.toContain("Ireena");
    expect(JSON.stringify(hit)).not.toContain("Mara");
  });

  it("never emits a blank session title: number, else recap excerpt, else \"Untitled session\"", () => {
    const numbered = store.setSessionRevealed(store.createSession({ sessionNumber: 4 }).id, true);
    const recapOnly = store.setSessionRevealed(store.createSession({ recapBody: "The party crossed the bridge." }).id, true);
    const empty = store.setSessionRevealed(store.createSession({}).id, true);
    const title = (session: typeof numbered) => projectPlayerSearchHit({ kind: "session", session }, playerSessionNumbers())!.title;
    expect(title(numbered)).toBe("Session 4");
    expect(title(recapOnly)).toBe("The party crossed the bridge.");
    // `known-bugs.md:65-68`: this used to be "" on the reveal audit, which renders an unclickable blank row.
    expect(title(empty)).toBe("Untitled session");
    // The audit says the same words about the same records - one concept, one name, on both surfaces.
    const auditTitles = projectRevealAudit([numbered, recapOnly, empty].map((session) => ({ kind: "session" as const, session })))
      .sections.find((section) => section.kind === "session")!.rows.map((row) => row.title);
    expect(auditTitles.sort()).toEqual(["Session 4", "The party crossed the bridge.", "Untitled session"]);
  });

  it("round-trips tags on sessions and quests, and finds both by tag in both audiences", () => {
    const session = store.setSessionRevealed(store.createSession({ sessionNumber: 1, recapBody: "We began.", tags: ["Ravenloft", " ravenloft ", "arc-one"] }).id, true);
    // `tags()` slugs, trims and dedupes on the way in, exactly as it does for every other record.
    expect(session.tags).toEqual(["ravenloft", "arc-one"]);
    const quest = store.setQuestRevealed(store.createQuest({ title: "Find the Sunsword", tags: ["arc-one"] }).id, true);
    expect(quest.tags).toEqual(["arc-one"]);

    for (const audience of ["gm", "player"] as const) {
      const ids = store.searchAll(audience, "arc-one").hits.map((hit) => hit.id);
      expect(ids, audience).toContain(session.id);
      expect(ids, audience).toContain(quest.id);
    }
    // Editing the tags keeps the index in step - the reindex rides in the same transaction as the write.
    store.updateSession(session.id, { tags: ["arc-two"] }, undefined, "gm");
    expect(store.searchAll("gm", "arc-one").hits.map((hit) => hit.id)).not.toContain(session.id);
    expect(store.searchAll("gm", "arc-two").hits.map((hit) => hit.id)).toContain(session.id);
    // ...and deleting a session takes its index row with it, or the row matches forever with nothing to gate on.
    store.deleteSession(session.id);
    expect(store.searchAll("gm", "arc-two").hits.map((hit) => hit.id)).not.toContain(session.id);
  });

  /** D19: the cap is SIGNALLED. 51 matches means 50 hits and `truncated: true`; 50 means no flag. */
  it("reports truncation rather than silently clipping the result list", () => {
    for (let index = 0; index < 50; index += 1) store.createPage({ title: `Barovia hamlet ${index}`, playerBody: "barovia" });
    const exact = store.searchAll("gm", "barovia");
    expect(exact.hits).toHaveLength(50);
    expect(exact.truncated, "exactly at the cap is NOT truncated - the probe row is what distinguishes them").toBe(false);
    store.createPage({ title: "Barovia hamlet 50", playerBody: "barovia" });
    const over = store.searchAll("gm", "barovia");
    expect(over.hits).toHaveLength(50);
    expect(over.truncated).toBe(true);
  });
});

/**
 * D17 / director ruling R3: a player chronicle row carries BOTH `inWorldDate` and `calendarInstant`.
 *
 * The instant is a pure function of the raw date and the calendar the player already holds, so it adds no
 * information - but shipping the SERVER's value is what stops the client re-deriving it. The two
 * derivations disagreed on a day that overflows its month (`known-bugs.md:457-466`), which is the case
 * seeded below deliberately.
 */
describe("Codex chronicle — a player's machine-readable dates (D17, R3)", () => {
  it("carries both date forms on a revealed dated row, and the instant is the server's own clamped one", () => {
    // A 30-day month, and a date on day 31 of it - the measured day-clamp divergence.
    store.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["First", "Second"], currentDate: { year: 1492, month: 1, day: 1 } });
    const entry = store.createEntry({ playerText: "The siege begins.", revealedToPlayers: true, inWorldDate: { year: 1492, month: 0, day: 31 } });
    const record = { kind: "entry" as const, entry: store.getEntry(entry.id)! };

    const player = projectPlayerChronicleRecord(record, playerSessionNumbers())!;
    const gm = projectGmChronicleRecord(record);
    expect(player.inWorldDate, "the RAW date the GM typed, unclamped - it is the source of truth (K3)").toEqual({ year: 1492, month: 0, day: 31 });
    // The instant is the SERVER's, identical to the GM's, so the two audiences place the row on the same
    // day - which is the whole reason the field travels rather than being recomputed client-side.
    expect(player.calendarInstant).toBe(gm.calendarInstant);
    expect(typeof player.calendarInstant).toBe("number");
    // ...and it is information-equivalent to the label the player already had.
    expect(player.inWorldLabel).toBe(gm.inWorldLabel);

    // Undated rows carry null for both, never an absent key - no reader branches on presence.
    const undated = store.createEntry({ playerText: "Timeless.", revealedToPlayers: true });
    const undatedRow = projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(undated.id)! }, playerSessionNumbers())!;
    expect(undatedRow.inWorldDate).toBeNull();
    expect(undatedRow.calendarInstant).toBeNull();

    // The GM's CLOCK is still not on the player row by any path: the fields describe the RECORD's date,
    // and `fired` is still measured against the published date. Nothing here names `currentDate`.
    expect(Object.keys(undatedRow)).not.toContain("proposedDate");
    expect(Object.keys(undatedRow)).not.toContain("campaignInstant");
  });
});

/**
 * D12: linking downtime to a character PAGE, so the tracker totals a person rather than a spelling of
 * their name. One payload field, and everything interesting about it is what happens at the edges.
 */
describe("CodexStore downtime — the character link (D12)", () => {
  it("round-trips the link, keeps it through applyDowntime, and refuses an id that names no page", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const entry = store.createDowntime({ playerText: "A month at the forge.", downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    expect(downtimePayloadOf(entry)).toEqual({ who: "Ireena", activity: "Forging", days: 30, applied: false, characterPageId: character.id });

    // `applyDowntime` rewrites the payload to flip `applied`; the link must ride through untouched.
    const applied = store.applyDowntime(entry.id).entry;
    expect(downtimePayloadOf(applied)).toEqual({ who: "Ireena", activity: "Forging", days: 30, applied: true, characterPageId: character.id });

    // An id naming no page is a not-found, not a dangling link the tracker cannot follow.
    expect(() => store.createDowntime({ playerText: "Nobody.", downtime: { who: "?", activity: "?", days: 1, characterPageId: crypto.randomUUID() } })).toThrow(/no longer exists/i);
    // The free-text fallback still works with no link at all - nothing is required to have a page.
    expect(downtimePayloadOf(store.createDowntime({ playerText: "A hireling.", downtime: { who: "Gustav", activity: "Watching the cart", days: 2 } }))!.characterPageId).toBeNull();
    // ...and a NON-character page is accepted deliberately: a GM may track downtime for an NPC.
    const npc = store.createPage({ title: "The Burgomaster", entityType: "note" });
    expect(downtimePayloadOf(store.createDowntime({ playerText: "Politics.", downtime: { who: "Ismark", activity: "Talking", days: 3, characterPageId: npc.id } }))!.characterPageId).toBe(npc.id);
  });

  it("reads a payload written before the field existed as `characterPageId: null` — the parser IS the migration", () => {
    const entry = store.createDowntime({ playerText: "Old row.", downtime: { who: "Vex", activity: "Brewing", days: 5 } });
    // Rewrite the blob to the pre-D12 shape, exactly as an upgraded database holds it.
    const database = new DatabaseSync(join(directory, "vtt.sqlite"));
    database.prepare("UPDATE codex_journal SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({ who: "Vex", activity: "Brewing", days: 5, applied: false }), entry.id);
    database.close();

    // The wire promises the key is ALWAYS present; the defensive reader supplies it, so no `json_set`
    // sweep over old payloads was needed.
    expect(downtimePayloadOf(store.getEntry(entry.id)!)).toEqual({ who: "Vex", activity: "Brewing", days: 5, applied: false, characterPageId: null });
  });

  it("nulls the link when the page is deleted, and keeps the record and its free-text `who`", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    const entry = store.createDowntime({ playerText: "A month at the forge.", downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    const untouched = store.createDowntime({ playerText: "Someone else.", downtime: { who: "Ismark", activity: "Drilling", days: 4 } });

    store.deletePage(character.id);

    // The record SURVIVES its page - "Ireena spent a month forging" stays true - and the link is nulled
    // rather than left dangling, so the tracker never renders a link nobody can follow.
    const after = downtimePayloadOf(store.getEntry(entry.id)!)!;
    expect(after.characterPageId).toBeNull();
    expect(after.who, "the free-text fallback is what the row shows now").toBe("Ireena");
    expect(after.days).toBe(30);
    // ...and the scrub is targeted: an unrelated downtime row is untouched.
    expect(downtimePayloadOf(store.getEntry(untouched.id)!)).toEqual({ who: "Ismark", activity: "Drilling", days: 4, applied: false, characterPageId: null });
  });

  it("carries the link to a player only when that page is revealed, and never hides the row for it", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    const entry = store.createDowntime({ playerText: "A month at the forge.", revealedToPlayers: true, downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    const record = { kind: "entry" as const, entry: store.getEntry(entry.id)! };
    const context = (revealed: readonly string[]) => ({ unrevealedSessionIds: new Set<string>(), revealedPageIds: new Set(revealed) });

    // Page hidden: the link is nulled, and the ROW still travels with everything else on it. That is the
    // difference from a `standing` record, which is hidden whole - a standing has no prose to stand on.
    const gated = projectPlayerChronicleRecord(record, context([]))!;
    expect(gated.payload).toEqual({ who: "Ireena", activity: "Forging", days: 30, characterPageId: null });
    expect(gated.text).toBe("A month at the forge.");

    // Page revealed: the link travels, because the player can already open that page by id.
    const shown = projectPlayerChronicleRecord(record, context([character.id]))!;
    expect((shown.payload as { characterPageId: string | null }).characterPageId).toBe(character.id);
    // Absent context fails CLOSED - a caller that forgets to resolve the set loses a link, never leaks one.
    expect((projectPlayerChronicleRecord(record, { unrevealedSessionIds: new Set<string>() })!.payload as { characterPageId: string | null }).characterPageId).toBeNull();
    // `applied` is still never on a player row, whatever this field does.
    expect(Object.keys(shown.payload!).sort()).toEqual(["activity", "characterPageId", "days", "who"]);
  });
});
