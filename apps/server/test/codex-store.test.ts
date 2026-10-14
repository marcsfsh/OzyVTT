import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, MIGRATIONS, deadlineFired, downtimePayloadOf, questEventPayloadOf, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmConnections, projectPlayerConnections, projectGmPageConnections, projectPlayerPageConnections, projectRevealAudit, projectGmChronicleRecord, projectGmJournalEntry, projectGmMarker, projectGmQuest, projectGmSearchHit, projectGmSession, projectPlayerChronicleRecord, projectPlayerJournalEntry, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerSearchHit, projectPlayerSession } from "../src/codex-projections.js";

/** The default autosave setting, spelled once. */
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

// The session context the player journal/chronicle projections take, resolved as `codex-http.ts` does per
// request. A function, not a constant: reveal state changes mid-test and a captured context would go stale.
const playerSessionNumbers = (from: CodexStore = store) => ({ unrevealedSessionIds: from.unrevealedSessionIds() });

// The `PlayerConnectionContext` `codex-http.ts` resolves per request. Fixtures here have page sources only,
// so `revealedSourceIds` is empty. A function because reveal state changes mid-test.
const playerConnectionContext = (from: CodexStore = store) => ({
  revealedPageIds: new Set(from.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id)),
  revealedSourceIds: new Set<string>()
});

describe("CodexStore search — the SQL visibility layer, on its own (CI-1)", () => {
  // Player search is gated in SQL (`PLAYER_VISIBLE_SQL`) and again by `projectPlayerSearchHit`; these call
  // `searchAll` directly so each kind's SQL gate is verified on its own.
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

  // The quest arm of `PLAYER_VISIBLE_SQL`, both directions: weakening it (`THEN 1`) surfaces the secret
  // quest, and deleting it (falling to `ELSE 0`) hides a findable one.
  it("does not return an UNREVEALED quest to a player, and does return a revealed one (M10, at the SQL layer)", () => {
    const quest = store.createQuest({ title: "The Wyrmwood Contract", playerBody: "Recover the ledger." });
    expect(quest.revealedToPlayers).toBe(false);
    // The GM finds it, so the player's miss below is the visibility arm and not a quest that never indexed.
    expect(store.searchAll("gm", "ledger").hits.some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
    expect(store.searchAll("player", "ledger").hits.some((hit) => hit.id === quest.id)).toBe(false);

    store.setQuestRevealed(quest.id, true);
    expect(store.searchAll("player", "ledger").hits.some((hit) => hit.kind === "quest" && hit.id === quest.id)).toBe(true);
  });

  it("does not return a REVEALED marker sitting on a SECRET map to a player (CD-6, at the SQL layer)", () => {
    // The pin is shown; the map is not. Players never receive the map, so they must not find the pin
    // either, and that must hold in the query, not only in the projection.
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Hidden", kind: "regional" });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Crypt of Strahd" });
    store.setMarkerRevealed(marker.id, true);                    // pin shown...
    expect(store.getMap(map.id)!.revealedToPlayers).toBe(false);  // ...map still secret
    expect(store.searchAll("gm", "Crypt").hits.some((hit) => hit.kind === "marker" && hit.id === marker.id)).toBe(true);
    expect(store.searchAll("player", "Crypt").hits.some((hit) => hit.id === marker.id)).toBe(false);

    store.setMapRevealed(map.id, true);
    expect(store.searchAll("player", "Crypt").hits.some((hit) => hit.id === marker.id)).toBe(true);
  });
});

describe("CodexStore search matches tags on every kind (CI-1 + CI-2)", () => {
  it("finds a PAGE by its tag, the same way it finds a tagged map or marker", () => {
    // Pages index their tags like maps, markers and journal entries do, so a tag query answers the same
    // whichever record carries the tag.
    const page = store.createPage({ title: "Strahd", tags: ["villain"] });
    store.setPageRevealed(page.id, true);
    const gmHits = store.searchAll("gm", "villain").hits;
    expect(gmHits.some((hit) => hit.kind === "page" && hit.id === page.id)).toBe(true);
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
  // A page titled with the query ranks above pages that merely mention it. `toEqual` on the whole array also
  // pins recall, so winning the ranking by dropping results cannot pass.
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
    // Recall is unchanged: the mentions are still found, just below the record named for the query.
    expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
  });

  it("ranks identically for a PLAYER, so the two roles never disagree about where Enter lands", () => {
    // Both audiences have their own FTS table; weighting only one would give the GM and the player
    // different answers for the same name.
    const { named, mentionsA, mentionsB } = seedNamedVersusMentions();
    const hits = store.searchAll("player", "Strahd").hits;
    expect(hits[0]).toEqual({ kind: "page", id: named });
    expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
  });

  it("keeps the exact-title record first even against a body that repeats the term 120 times", () => {
    // The exact-title tier: under bm25 alone (title 10x / body 1x) a body repeating the word ~80 times outranks
    // the titled page, so prose length would decide. 120 repetitions is past that flip.
    const named = store.createPage({ title: "Strahd", playerBody: "A vampire lord.", revealedToPlayers: true });
    const spam = store.createPage({ title: "QA Keep 111", playerBody: Array.from({ length: 120 }, () => "Strahd").join(" "), revealedToPlayers: true });
    for (const audience of ["gm", "player"] as const) {
      const hits = store.searchAll(audience, "Strahd").hits;
      expect(hits[0]).toEqual({ kind: "page", id: named.id });
      expect(hits).toContainEqual({ kind: "page", id: spam.id });
    }
  });

  it("weights a title hit over a body hit even when NEITHER title is exact", () => {
    // Tier 2 alone: no title equals "Ravenloft", so tier 1 cannot fire, and this fails unless bm25 really
    // weights the title column. (`bm25(t, 10.0, 1.0)` on the wrong columns is a silent no-op.)
    const titled = store.createPage({ title: "Castle Ravenloft", playerBody: "the seat of the land", revealedToPlayers: true });
    const bodied = store.createPage({ title: "QA Keep 222", playerBody: "We rode to Ravenloft. Ravenloft loomed. Ravenloft again.", revealedToPlayers: true });
    for (const audience of ["gm", "player"] as const) {
      const hits = store.searchAll(audience, "Ravenloft").hits;
      expect(hits[0]).toEqual({ kind: "page", id: titled.id });
      expect(hits).toContainEqual({ kind: "page", id: bodied.id });
    }
  });

  it("ranks across KINDS, not just within one - a map TITLED for the query beats a journal that mentions it", () => {
    // Ordering must hold between kinds under the shared 50-result cap. A journal entry has an empty title, so
    // only the title weight lifts the map (not titled exactly "Vallaki", so tier 2 alone) above it.
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
    // Re-ranking may move results down but never out, including behind the exact-title tier when another
    // record wins it.
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

    expect(store.updateMap(map.id, { name: "Barovia II" }).tags).toEqual(["act-two"]);
  });

  it("applies the same slug rule and 24-tag cap pages use", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "M", kind: "world" });
    expect(() => store.updateMap(map.id, { tags: ["Not A Slug"] })).toThrow();
    expect(() => store.updateMap(map.id, { tags: Array.from({ length: 25 }, (_, i) => `t${i}`) })).toThrow();
  });

  it("backfills existing rows to an empty tag list rather than null (migration v10)", () => {
    // Rows written before the tags column have no value of their own; the column default must read as [].
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Legacy", kind: "world" });
    expect(map.tags).toEqual([]);
    expect(store.getMap(map.id)!.tags).toEqual([]);
    expect(MIGRATIONS.some((migration) => migration.version === 10)).toBe(true);
  });
});

describe("CodexStore suite-wide search (CI-1)", () => {
  // The unified search index migration on a populated pre-migration database built from the shipped SQL;
  // a fresh database cannot catch a bad backfill.
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
      // The pages-only index rows as earlier versions wrote them, which the backfill must carry forward.
      database.prepare("INSERT INTO codex_fts_player (page_id, title, body) VALUES (?, 'Ravenloft', 'a gothic castle\n')").run(pageId);
      database.prepare("INSERT INTO codex_fts_gm (page_id, title, body) VALUES (?, 'Ravenloft', 'a gothic castle\nthe crypt of Strahd\n\n')").run(pageId);
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, 'Barovia', 'regional', NULL, 1, 1, '[\"gloomy\"]', '', '')").run(mapId, crypto.randomUUID());
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, tags_json, created_at, updated_at) VALUES (?, ?, 0.5, 0.5, 'pin', '#FF2E9A', 'Svalich Road', 1, '[\"waypoint\"]', '', '')").run(markerId, mapId);
      database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, sort_key, tags_json, created_at, updated_at) VALUES (?, 'The mists parted.', 'Strahd was watching.', 1, 'note', 1, '[\"arrival\"]', '', '')").run(entryId);
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();

      expect(upgraded.searchAll("gm", "Ravenloft").hits).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "Barovia").hits).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "Svalich").hits).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "mists").hits).toEqual([{ kind: "journal", id: entryId }]);
      expect(upgraded.searchAll("player", "gloomy").hits).toEqual([{ kind: "map", id: mapId }]);
      expect(upgraded.searchAll("player", "waypoint").hits).toEqual([{ kind: "marker", id: markerId }]);
      expect(upgraded.searchAll("player", "arrival").hits).toEqual([{ kind: "journal", id: entryId }]);

      // The backfill kept the layers apart: GM-only text landed only in the GM index.
      expect(upgraded.searchAll("player", "crypt").hits).toEqual([]);
      expect(upgraded.searchAll("gm", "crypt").hits).toEqual([{ kind: "page", id: pageId }]);
      expect(upgraded.searchAll("player", "watching").hits).toEqual([]);
      expect(upgraded.searchAll("gm", "watching").hits).toEqual([{ kind: "journal", id: entryId }]);

      // ...and the pages-only tables are gone, so there is one index and one sync path.
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

    store.updateMarker(marker.id, { label: "Burgomaster mansion" });
    expect(store.searchAll("gm", "Blinsky").hits).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster").hits).toEqual([{ kind: "marker", id: marker.id }]);

    // A reveal toggle needs no reindex: visibility is resolved against the live row at read time.
    store.setMarkerRevealed(marker.id, false);
    expect(store.searchAll("player", "Burgomaster").hits).toEqual([]);
    expect(store.searchAll("gm", "Burgomaster").hits).toEqual([{ kind: "marker", id: marker.id }]);

    // Deleting the map cascades its markers in SQL; their index rows must go too, or they would keep
    // matching with no live row to gate them.
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
    // Move the only note to the top level: the folder record keeps the folder alive.
    store.updatePage(page.id, { folder: null }, page.rev, "gm");
    expect(store.getPage(page.id)!.folder).toBeNull();
    expect(store.listFolders()).toContain("NPCs/Villains");                 // still there with no pages in it
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

    expect(() => store.updatePage(page.id, { title: "Bree Town" }, 1, "gm")).toThrow(CodexRevisionConflictError);

    const revealed = store.setPageRevealed(page.id, true);
    expect(revealed.revealedToPlayers).toBe(true);

    // One checkpoint, from the creation: the update was coalesced into it (within the 90-minute window), and
    // the reveal snapshots nothing.
    const revisionCount = store.listRevisions(page.id).length;
    expect(revisionCount).toBe(1);

    store.close();
    store = new CodexStore(join(directory, "vtt.sqlite"));
    await store.initialize();
    expect(store.getPage(page.id)).toMatchObject({ title: "Bree", rev: 2, revealedToPlayers: true });
    expect(store.listPages()).toHaveLength(1);
  });

  it("dates an auto-logged battle at the campaign's current in-world date", () => {
    // The combat-history bridge dates each battle with the calendar's "now", so it sorts among dated entries.
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
    const dated = store.listTimeline().filter((row) => row.calendarInstant !== null);
    expect(dated.map((row) => row.id)).toContain(entry.id);
  });

  it("leaves an auto-logged battle undated when the world has no current date", () => {
    // With no calendar "now" there is nothing to date it by, so it stays undated rather than inventing a date.
    const entry = store.appendCombatEntry({ sourceEncounterId: 9, playerText: "A battle was fought here." });
    expect(entry.calendarInstant).toBeNull();
    expect(entry.inWorldDate).toBeNull();
    expect(entry.inWorldLabel).toBeNull();
  });

  it("stores nested folder paths, normalizes them, and caps depth", () => {
    const page = store.createPage({ title: "Strahd", folder: " NPCs / Villains " });
    expect(page.folder).toBe("NPCs/Villains"); // segments trimmed
    expect(store.updatePage(page.id, { folder: "//Cults///Vecna//" }, page.rev, "gm").folder).toBe("Cults/Vecna"); // empty segments dropped
    expect(store.updatePage(page.id, { folder: "   " }, undefined, "gm").folder).toBeNull(); // blank means unfiled
    expect(() => store.createPage({ title: "Too deep", folder: "a/b/c/d/e/f/g" })).toThrow(/6 levels/);
  });

  it("restores a past revision as a forward write", () => {
    const page = store.createPage({ title: "Keep", playerBody: "v1" });
    store.updatePage(page.id, { playerBody: "v2" }, page.rev, "gm");
    const revisions = store.listRevisions(page.id);
    const first = revisions.find((r) => r.rev === 1)!;
    const restored = store.restoreRevision(page.id, first.id, "gm");
    expect(restored.playerBody).toBe("v1");
    expect(restored.rev).toBe(3); // history is never rewritten: a new forward revision
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
    // A mention is a connection with `origin: "mention"` and no id, not a separate kind of thing.
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
    // "cult" lives only in gmBody, so the player index must not match it.
    expect(store.searchPages("player", "cult")).toHaveLength(0);
    expect(store.searchPages("gm", "cult")).toHaveLength(1);
    expect(store.searchPages("player", "crossroads")).toHaveLength(1);
  });

  it("player search excludes unrevealed pages even when their player body matches", () => {
    store.createPage({ title: "Hidden cove", playerBody: "a secret smugglers cove", revealedToPlayers: false });
    expect(store.searchPages("player", "smugglers")).toHaveLength(0); // unrevealed, so never in a player's results
    expect(store.searchPages("gm", "smugglers")).toHaveLength(1);     // the GM still finds it
  });

  it("player connections exclude gm-layer mentions and unrevealed sources", () => {
    const bree = store.createPage({ title: "Bree" });
    store.createPage({ title: "Road", playerBody: "to [[Bree]]", revealedToPlayers: true });   // visible
    store.createPage({ title: "Cult", gmBody: "near [[Bree]]" });                                // gm-layer secret
    store.createPage({ title: "Draft", playerBody: "mentions [[Bree]]", revealedToPlayers: false }); // player-layer but unrevealed
    const player = projectPlayerPageConnections(store.connectionsForPage(bree.id), playerConnectionContext());
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
    expect(store.getMarker(marker.id)?.pageIds).toEqual([]);                  // deleted page dropped, no dangling id
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
    // The parent (world) is not revealed, so its id is stripped from the child's player projection.
    expect(projectPlayerMap(region, { parentRevealed: false })!.parentMapId).toBeNull();
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
    expect(stripped.pageIds).toEqual([]);                          // secret page not revealed, so link hidden
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
    // A write that puts the secret `goals` key in the public fields map is sealed server-side.
    const page = store.createPage({ title: "Vex", entityType: "character", fields: { race: "Human", goals: "poison the king" } });
    expect(page.fields).toEqual({ race: "Human" });          // goals moved out of the player-facing map
    expect(page.gmFields).toEqual({ goals: "poison the king" });
    // Export carries gmFields (the SELECT includes the column).
    const exported = store.exportBundle().pages.find((candidate) => candidate.id === page.id)!;
    expect(exported.gmFields).toEqual({ goals: "poison the king" });
    // Restoring a revision re-seals too, so the revision's fields never re-expose goals.
    const rev = store.listRevisions(page.id).find((entry) => entry.rev === 1)!;
    expect(store.restoreRevision(page.id, rev.id, "gm").fields.goals).toBeUndefined();
  });

  // The export bundle is a GM's only copy of their prep, and `prepBody` exists nowhere else in the codex.
  // A record type missing from the backup loses data silently.
  it("carries sessions and the active pointer into the backup bundle", () => {
    const played = store.createSession({ sessionNumber: 1, prepBody: "Ambush at the bridge.", recapBody: "They crossed." });
    const next = store.createSession({ sessionNumber: 2, prepBody: "The vault opens for a sacrifice." });
    store.setActiveSession(next.id);

    const bundle = store.exportBundle();
    expect(bundle.sessions.map((session) => session.sessionNumber)).toEqual([1, 2]);
    expect(bundle.activeSessionId).toBe(next.id);
    // The GM layer specifically: an export that kept the recap but dropped the prep would look healthy and
    // be worthless on restore.
    expect(bundle.sessions.find((session) => session.id === played.id)!.prepBody).toBe("Ambush at the bridge.");
    expect(bundle.sessions.find((session) => session.id === next.id)!.prepBody).toBe("The vault opens for a sacrifice.");
  });

  it("migration v8 backfills a legacy marker's single page/scene id into one-element arrays", () => {
    // A database from before markers linked many pages/scenes: single page_id/scene_id columns.
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
    // Before the folders table, a folder existed only while a page referenced it. The backfill must capture
    // every distinct real path once and invent no record for null/empty.
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
    // Simulate a database from before the seal: `goals` sitting in the public fields_json.
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
    // The stored value is the label: trimmed, but neither slugged nor lowercased, since there is no display
    // mapping to translate it back.
    expect(rel).toMatchObject({ fromPageId: strahd.id, toPageId: barovia.id, label: "rules", layer: "player" });
    expect(store.createConnection(strahd.id, { toPageId: barovia.id, label: "rules" }).id, "idempotent on (from, to, label)").toBe(rel.id);
    // ...and re-declaring with a different layer is the same edge: layer is not in the dedupe key, so
    // "declare it again, but GM-only" does not create a parallel edge.
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
    // `SYMMETRIC_RELATIONSHIPS` is keyed on the current labels (`ally of`); otherwise this would silently
    // create two rows.
    const first = store.createConnection(a.id, { toPageId: b.id, label: "ally of" });
    expect(store.createConnection(b.id, { toPageId: a.id, label: "ally of" }).id).toBe(first.id);
    expect(store.listAllConnections().filter((edge) => edge.origin === "declared")).toHaveLength(1);
    // A free-text label is directional: "guards" one way is not "guards" the other.
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

    // A labelled declared edge is never folded against a mention: "ally of" and "mentions" are different
    // statements about the same pair.
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

    const player = projectPlayerPageConnections(store.connectionsForPage(hub.id), playerConnectionContext());
    expect(player.map((row) => row.label)).toEqual(["contains"]);
    expect(projectGmPageConnections(store.connectionsForPage(hub.id))).toHaveLength(3);
    // A GM-layer declared edge between two revealed pages never travels; a "both endpoints revealed" gate
    // alone would miss this.
    expect(player.some((row) => row.otherId === shown.id && row.label === "hides")).toBe(false);
    store.updateConnection(gmLayer.id, { layer: "player" });
    expect(projectPlayerPageConnections(store.connectionsForPage(hub.id), playerConnectionContext()).map((row) => row.label).sort()).toEqual(["contains", "hides"]);

    // The player row's exact key set: no `id`, no `layer`, no `otherRevealed`.
    expect(Object.keys(projectPlayerPageConnections(store.connectionsForPage(hub.id), playerConnectionContext())[0]!).sort())
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
    // `createEntry` auto-files an entry under the active session, but `updateEntry` must not: an omitted
    // field means unchanged, so editing a typo cannot re-file the entry under the current session.
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
    expect(page.inWorldDate).toEqual({ year: 1492, month: 1, day: 15 }); // the raw date is stored verbatim
    expect(page.inWorldLabel).toContain("1492");                          // ...and the label is derived from it
    // The instant comes from the same function: an entry on the same day agrees exactly.
    const entry = store.createEntry({ playerText: "the sky tore open", inWorldDate: { year: 1492, month: 1, day: 15 } });
    expect(page.calendarInstant).toBe(entry.calendarInstant);
    expect(page.inWorldLabel).toBe(entry.inWorldLabel);
  });

  it("puts a dated event page on the chronicle in the right in-world year, interleaved with entries (CT-11)", () => {
    const early = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1400, month: 0, day: 1 } });
    const event = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1450, month: 0, day: 1 } });
    const late = store.createEntry({ playerText: "The war.", inWorldDate: { year: 1500, month: 0, day: 1 } });
    // Created in chronological order here, so the assertion checks dates place records rather than a
    // later-created record riding its insertion order.
    const undated = store.createEntry({ playerText: "Someday." });

    expect(store.listChronicle().map((record) => (record.kind === "entry" ? record.entry.id : record.page.id)))
      .toEqual([early.id, event.id, late.id, undated.id]);
    expect(store.dateForInstant(event.calendarInstant!)).toEqual({ year: 1450, month: 0, day: 1 });
  });

  it("keeps an UNDATED event page and a dated non-event page off the chronicle (CT-11)", () => {
    store.createPage({ title: "A vague legend", entityType: "event" });
    const note = store.createPage({ title: "Barovia", entityType: "location", inWorldDate: { year: 1492, month: 0, day: 1 } });
    expect(store.listChronicle()).toHaveLength(0);
    // The date is not discarded, only unlisted: promoting the page to an event brings it back intact, so a
    // type switch is lossless.
    expect(store.getPage(note.id)!.inWorldDate).toEqual({ year: 1492, month: 0, day: 1 });
    store.updatePage(note.id, { entityType: "event" }, undefined, "test");
    expect(store.listChronicle().map((record) => record.kind)).toEqual(["event"]);
  });

  it("leaves a page's date alone when a write does not mention it, and clears it on an explicit null", () => {
    // The page editor PATCHes the whole draft on every autosave; if an omitted date meant "clear", editing
    // an event from any surface unaware of dates would un-date it.
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
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    const reflowed = store.listTimeline().filter((entry) => entry.calendarInstant !== null);
    const earlyNow = reflowed.find((entry) => entry.id === early.id)!;
    const lateNow = reflowed.find((entry) => entry.id === late.id)!;
    expect(lateNow.calendarInstant! - earlyNow.calendarInstant!).toBe(200); // re-placed on the new year length
    expect(earlyNow.inWorldLabel).toBe("Rise 1, 1 AE");                     // label recomputed from the raw date
    expect(earlyNow.inWorldDate).toEqual({ year: 1, month: 0, day: 1 });    // raw date preserved verbatim
    expect(reflowed[0].id).toBe(early.id);                                  // chronological order intact
  });

  // `setCalendar` recomputes every dated record, events included: events reflow (1), together with entries
  // so their interleaved order survives (2), and every raw date is unchanged (3).
  it("reflows events and entries TOGETHER when the calendar changes, losing no raw date (K3)", () => {
    const entryEarly = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1, month: 0, day: 1 } });
    const eventMid = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1, month: 1, day: 10 } });
    const entryLate = store.createEntry({ playerText: "The war.", inWorldDate: { year: 2, month: 0, day: 1 } });
    const eventLast = store.createPage({ title: "The Peace", entityType: "event", inWorldDate: { year: 3, month: 0, day: 5 } });
    const orderBefore = store.listChronicle().map((record) => (record.kind === "entry" ? record.entry.id : record.page.id));
    expect(orderBefore).toEqual([entryEarly.id, eventMid.id, entryLate.id, eventLast.id]);

    // A calendar with a different month count and lengths: every instant must move, and month index 1 now
    // has a different length, so a stale label shows too.
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });

    // 1 + 2: still interleaved in the same order, and every instant agrees with the new calendar.
    const after = store.listChronicle();
    expect(after.map((record) => (record.kind === "entry" ? record.entry.id : record.page.id))).toEqual(orderBefore);
    const eventNow = store.getPage(eventMid.id)!;
    const entryOnTheSameDay = store.createEntry({ playerText: "same day", inWorldDate: { year: 1, month: 1, day: 10 } });
    expect(eventNow.calendarInstant).toBe(entryOnTheSameDay.calendarInstant); // reflowed page == freshly dated entry
    expect(eventNow.inWorldLabel).toBe("Fall 10, 1 AE");                      // label recomputed, not stale
    // Both instants stated from the new calendar's arithmetic (year*200 + month offset + day-1), so this
    // fails if either kept a value from the old 12x30 year.
    expect(eventNow.calendarInstant).toBe(1 * 200 + 100 + 9);
    expect(store.getPage(eventLast.id)!.calendarInstant).toBe(3 * 200 + 0 + 4);

    // 3: every raw date survives verbatim.
    expect(store.getPage(eventMid.id)!.inWorldDate).toEqual({ year: 1, month: 1, day: 10 });
    expect(store.getPage(eventLast.id)!.inWorldDate).toEqual({ year: 3, month: 0, day: 5 });
    expect(store.getEntry(entryEarly.id)!.inWorldDate).toEqual({ year: 1, month: 0, day: 1 });
    expect(store.getEntry(entryLate.id)!.inWorldDate).toEqual({ year: 2, month: 0, day: 1 });

    // ...and the reflow is idempotent: re-applying the same calendar changes nothing.
    const snapshot = store.listChronicle().map((record) => JSON.stringify(record));
    store.setCalendar({ yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    expect(store.listChronicle().map((record) => JSON.stringify(record))).toEqual(snapshot);
  });
});

// `listChronicle()` is ungated and `projectPlayerChronicleRecord` is the only gate; a store-level filter
// could mask a broken projection in HTTP tests, so these assert the store stays ungated.
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

// The chronicle's projection layer on its own: the single gate, exercised directly, one property per test.
describe("Codex chronicle — the projection layer, on its own (CT-11, A-8)", () => {
  const playerChronicle = () => store.listChronicle().map((record) => projectPlayerChronicleRecord(record, playerSessionNumbers())).filter((record) => record !== null);

  it("refuses an UNREVEALED event page", () => {
    const page = store.createPage({ title: "The Sundering", entityType: "event", playerBody: "The sky tore open.", inWorldDate: { year: 1492, month: 0, day: 1 } });
    expect(store.getPage(page.id)!.revealedToPlayers).toBe(false);
    expect(projectPlayerChronicleRecord({ kind: "event", page: store.getPage(page.id)! }, playerSessionNumbers())).toBeNull();
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
    // The exact key set, so any new field fails here. `fired` lets a passed deadline read as passed;
    // `payload` is a downtime's who/activity/days, never GM-only `applied`.
    expect(Object.keys(projected).sort()).toEqual(["calendarInstant", "createdAt", "fired", "id", "inWorldDate", "inWorldLabel", "kind", "payload", "realDate", "sessionId", "sessionNumber", "tags", "text", "title"]);
    expect(projected.text).toBe("The sky tore open.");
    expect(JSON.stringify(projected)).not.toContain("Strahd engineered it.");
    expect(JSON.stringify(projected)).not.toContain("conceal the cause");
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
    expect(store.isPageAssetVisibleToPlayers(gmOnly)).toBe(false);  // referenced only in gmBody, so stays hidden
  });
});

// The page -> marker lookup is gated by the router (unrevealed page) and by `projectPlayerPageMarker` (each
// pin); these call the store and projection directly.
describe("Codex page→marker reverse lookup — the store and projection layers, on their own (CI-4)", () => {
  const context = (marker: ReturnType<CodexStore["getMarker"]>, mapRevealed: boolean, revealedPageIds: string[] = []) =>
    ({ marker: marker!, mapRevealed, revealedPageIds: new Set(revealedPageIds), subMapRevealed: false });

  it("the store's reverse lookup is deliberately UNGATED — one gate, in the projection, or the layers can mask each other", () => {
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Amberhold", kind: "regional" }); // secret
    const page = store.createPage({ title: "The Amber Temple" });                                        // secret
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Vaults", pageIds: [page.id] });
    // Raw GM-grade rows, hidden pin on a hidden map included. If the store started filtering, the HTTP tests
    // would still pass while the projection stopped being what decides.
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
    // Reached by page id or map id, a player receives the identical pin: it projects through
    // `projectPlayerMarker`, so the two reads cannot drift apart.
    expect(projected).toEqual(projectPlayerMarker(row, { revealedPageIds: new Set([shown.id]), subMapRevealed: false }));
    expect(projected.pageIds).toEqual([shown.id]);   // the still-secret page link is filtered out
    expect(projected).not.toHaveProperty("sceneIds");
    expect(projected).not.toHaveProperty("actorId");
  });
});

// The whole-graph connections feed at the store and projection layers. `projectPlayerConnections` decides
// visibility and the store feeding it is ungated, so each rule is proven at the projection.
describe("Codex whole-graph connections — the store and projection layers, on their own (D8)", () => {
  const context = () => playerConnectionContext();
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
    // Moving the same link into the player body lets it through, so the miss is the layer rule.
    store.updatePage(source.id, { gmBody: "", playerBody: "Ruled from [[Vallaki]]." }, undefined, "test");
    expect(projectPlayerConnections(store.listAllConnections(), context()).map(pair)).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });

  it("refuses a player-body mention when EITHER endpoint is unrevealed, so no dangling edge names a secret page", () => {
    const secret = store.createPage({ title: "The Whispered Name" });
    const source = store.createPage({ title: "Barovia", playerBody: "Watched by [[The Whispered Name]].", revealedToPlayers: true });
    expect(projectPlayerConnections(store.listAllConnections(), context())).toEqual([]);   // hidden target
    store.setPageRevealed(secret.id, true);
    store.setPageRevealed(source.id, false);
    expect(projectPlayerConnections(store.listAllConnections(), context())).toEqual([]);   // hidden source
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
    expect(mentions()).toHaveLength(1);
    expect(mentions()[0]!.layer).toBe("player");
    expect(projectPlayerConnections(store.listAllConnections(), context()).map(pair)).toEqual([{ fromPageId: source.id, toPageId: target.id }]);
  });

  // Session, quest and journal bodies join the graph on the layer their own split implies. Prep is a
  // session's secret half, so a page named only in prep is a GM-only connection.
  it("puts session, quest and journal bodies in the graph, on the layer their own split implies", () => {
    const shown = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const session = store.createSession({ recapBody: "We reached [[Vallaki]].", prepBody: "The ambush waits in [[Vallaki]]." });
    const quest = store.createQuest({ title: "Find the Sunsword", playerBody: "Look in [[Vallaki]]." });
    const entry = store.createEntry({ playerText: "Arrived at [[Vallaki]].", revealedToPlayers: true });
    const gmOnlyEntry = store.createEntry({ playerText: "Nothing happened.", gmText: "Strahd watches [[Vallaki]].", revealedToPlayers: true });

    const bySource = new Map(store.listAllConnections().filter((edge) => edge.origin === "mention").map((edge) => [edge.fromId, edge]));
    // The session names the page from both bodies, so the collapse upgrades it to the player layer.
    expect(bySource.get(session.id)).toMatchObject({ fromKind: "session", toPageId: shown.id, layer: "player" });
    expect(bySource.get(quest.id)).toMatchObject({ fromKind: "quest", layer: "player" });
    expect(bySource.get(entry.id)).toMatchObject({ fromKind: "journal", layer: "player" });
    expect(bySource.get(gmOnlyEntry.id), "a page named only in gmText is a GM-layer edge").toMatchObject({ fromKind: "journal", layer: "gm" });

    // A prep-only mention is GM-layer, which a player must never receive.
    const prepOnly = store.createSession({ prepBody: "Secretly, [[Vallaki]]." });
    expect(store.listAllConnections().find((edge) => edge.fromId === prepOnly.id)).toMatchObject({ layer: "gm" });

    // The player gate per source kind: the source record's own reveal flag decides, so a connection is never
    // a way around a session/quest/entry's gate. Nothing is revealed yet, so nothing travels.
    const ctx = { revealedPageIds: new Set([shown.id]), revealedSourceIds: new Set<string>() };
    expect(projectPlayerConnections(store.listAllConnections(), ctx).filter((edge) => edge.fromKind !== "page")).toEqual([]);
    // Reveal the session and the entry; the quest stays hidden, so its edge stays hidden with it.
    const revealed = { revealedPageIds: new Set([shown.id]), revealedSourceIds: new Set([session.id, entry.id]) };
    const travelling = projectPlayerConnections(store.listAllConnections(), revealed);
    expect(travelling.map((edge) => edge.fromId).sort()).toEqual([entry.id, session.id].sort());
    // The player edge's exact key set: no id, no layer, no createdAt.
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

// Recency means "what have I been writing?": reveals and folder moves do not touch it, adding a
// relationship does. The clock only moves when the test says so.
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

  /** Move the clock, so a write that stamps `updated_at` is distinguishable from one that does not. */
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
    expect(updatedAt(barovia.id) > bornBarovia).toBe(true);   // the other end gained a connection too
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

  // An injected clock, as the recency describe uses. Without it the "reveal does not move recency"
  // assertions are vacuous: two writes in the same millisecond produce the same ISO stamp.
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
    expect(created.attendees).toEqual(["Ozy", "Mara"]);        // trimmed and deduped, not slugged
    expect(created.createdAt).toBe(created.updatedAt);          // born, so the two stamps agree

    tick();
    const updated = sessions.updateSession(created.id, { recapBody: "The party crossed, one short.", status: "played" }, created.rev, "gm");
    expect(updated.rev).toBe(2);
    expect(updated.recapBody).toBe("The party crossed, one short.");
    expect(updated.status).toBe("played");
    expect(updated.prepBody).toBe("Ambush at the bridge.");     // an omitted field is unchanged, never cleared
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
    // re-stamped every session would light the badge for unchanged recaps.
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
    // The partial UNIQUE index makes "open session 7" resolve to one record. A duplicate must be a clean
    // rejection with a message a GM can act on.
    expect(() => sessions.createSession({ sessionNumber: 7 })).toThrow(/Session 7 already exists/);
    const other = sessions.createSession({ sessionNumber: 8 });
    expect(() => sessions.updateSession(other.id, { sessionNumber: 7 }, other.rev, "gm")).toThrow(/Session 7 already exists/);
    expect(sessions.getSession(other.id)!.sessionNumber).toBe(8);      // the rejected write rolled back whole

    // An unnumbered session is a legitimate state, so many may coexist. SQLite treats NULLs as distinct in
    // any UNIQUE index, so this pins the behaviour: the store must not invent a number.
    const drafts = [sessions.createSession({}), sessions.createSession({}), sessions.createSession({})];
    expect(drafts.every((draft) => draft.sessionNumber === null)).toBe(true);
    expect(sessions.listSessions()).toHaveLength(5);

    // Deleting the holder frees the number for reuse, so a mistyped session is recoverable.
    const seven = sessions.listSessions().find((row) => row.sessionNumber === 7)!;
    sessions.deleteSession(seven.id);
    expect(sessions.createSession({ sessionNumber: 7 }).sessionNumber).toBe(7);
  });

  it("names exactly the session IDS still hidden from players, numbered or not", () => {
    // The resolution every player journal read gates the session link on, keyed by id so an unnumbered
    // hidden session can still be gated.
    const hidden = sessions.createSession({ sessionNumber: 4 });
    const shown = sessions.createSession({ sessionNumber: 5 });
    sessions.setSessionRevealed(shown.id, true);
    const unnumbered = sessions.createSession({});
    expect([...sessions.unrevealedSessionIds()].sort()).toEqual([hidden.id, unnumbered.id].sort());

    // Revealing them empties the set, so the ids above are the reveal flag being read.
    sessions.setSessionRevealed(hidden.id, true);
    sessions.setSessionRevealed(unnumbered.id, true);
    expect([...sessions.unrevealedSessionIds()]).toEqual([]);
    // ...and hiding 5 again puts a different id in, so this is a per-row read rather than a constant.
    sessions.setSessionRevealed(shown.id, false);
    expect([...sessions.unrevealedSessionIds()]).toEqual([shown.id]);
  });

  it("orders numbered sessions by number, with the unnumbered ones below them", () => {
    // As with undated chronicle records, a session with no number is outside the numbering (not "session 0")
    // and sorts below every numbered one.
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
    // A dangling pointer would have `activeSessionId` name a deleted record, which the sessions list and
    // auto-linking would then use.
    expect(sessions.activeSessionId).toBeNull();
    expect(() => sessions.deleteSession(session.id)).not.toThrow();    // idempotent
    expect(() => sessions.deleteSession("not-a-uuid")).not.toThrow();  // malformed id: early return

    // ...and the clear is scoped to the session being deleted. Deleting a different record must leave the
    // pointer alone, or tidying old sessions would un-file every later note and logged battle.
    const running = sessions.createSession({ sessionNumber: 12 });
    const stale = sessions.createSession({ sessionNumber: 4 });
    sessions.setActiveSession(running.id);
    sessions.deleteSession(stale.id);
    expect(sessions.activeSessionId).toBe(running.id);
  });

  // Session number 0 is legal at every layer and is the value a truthiness check silently eats. The
  // player gate is written `=== null` for this reason.
  it("treats session number 0 as a real number, not as absent", () => {
    const zero = sessions.createSession({ sessionNumber: 0 });
    expect(zero.sessionNumber).toBe(0);
    const entry = sessions.createEntry({ playerText: "The session before the first.", sessionId: zero.id, revealedToPlayers: true });
    expect(entry.sessionNumber).toBe(0);

    expect(projectPlayerJournalEntry(entry, { unrevealedSessionIds: sessions.unrevealedSessionIds() })!.sessionNumber).toBeNull();
    // Revealed: the number survives, and 0 is not mistaken for "no session".
    sessions.setSessionRevealed(zero.id, true);
    expect(projectPlayerJournalEntry(entry, { unrevealedSessionIds: sessions.unrevealedSessionIds() })!.sessionNumber).toBe(0);
  });

  /** With a session active, editing an entry must not re-file it under the running session. */
  it("editing an entry never re-files it under the ACTIVE session", () => {
    const older = sessions.createSession({ sessionNumber: 2 });
    const running = sessions.createSession({ sessionNumber: 9 });
    sessions.setActiveSession(running.id);

    const entry = sessions.createEntry({ playerText: "Filed under two.", sessionId: older.id });
    expect(entry.sessionNumber).toBe(2);
    const edited = sessions.updateEntry(entry.id, { playerText: "Filed under two, with a typo fixed." });
    expect(edited.sessionNumber).toBe(2);          // not 9
    expect(edited.sessionId).toBe(older.id);
    // ...and an explicit re-file still works, so the line above is the omitted-means-unchanged rule.
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
    // Activating is a statement about the table, not an edit of the record: no rev bump (an open console
    // would 409) and no recency move (the badge would light for unchanged prose).
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

    expect(sessions.createEntry({ playerText: "We reached Vallaki." }).sessionNumber).toBe(12);
    expect(sessions.appendCombatEntry({ sourceEncounterId: 3, playerText: "A brawl." }).sessionNumber).toBe(12);

    // An explicit value always wins, including an explicit null: "no session".
    const other = sessions.createSession({ sessionNumber: 4 });
    expect(sessions.createEntry({ playerText: "A retcon.", sessionId: other.id }).sessionNumber).toBe(4);
    expect(sessions.createEntry({ playerText: "Timeless lore.", sessionId: null }).sessionNumber).toBeNull();
  });

  it("degrades to today's exact behaviour when there is no active session — and in every gap", () => {
    // A numbered session that is not active exists throughout; without it, "resolve the active session" and
    // "use any session lying around" produce the same nulls.
    const bystander = sessions.createSession({ sessionNumber: 9 });
    expect(sessions.activeSessionId).toBeNull();

    // With nothing active, both call sites file no session.
    expect(sessions.createEntry({ playerText: "Between sessions." }).sessionNumber).toBeNull();
    expect(sessions.appendCombatEntry({ sourceEncounterId: 1, playerText: "A brawl." }).sessionNumber).toBeNull();

    // An active session with no number yet: the entry joins the record and simply has no number to display.
    // Session 9 must still not be borrowed.
    const draft = sessions.createSession({});
    sessions.setActiveSession(draft.id);
    const midDraft = sessions.createEntry({ playerText: "Mid-draft." });
    expect(midDraft).toMatchObject({ sessionId: draft.id, sessionNumber: null });
    expect(sessions.appendCombatEntry({ sourceEncounterId: 2, playerText: "A brawl." })).toMatchObject({ sessionId: draft.id, sessionNumber: null });

    // ...and numbering that session gives every already-filed entry its label, retroactively.
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

  /** The injected clock; without it "reveal does not move recency" is vacuous. */
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
    expect(updated.playerBody).toBe("Recover the ledger from the counting house."); // omitted means unchanged
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

  // Objectives are an ordered mutable list and their order is content ("find the key, then open the vault"
  // is not its reverse), so nothing may sort, dedupe, or key identity off an index across a write.
  it("keeps objective ORDER exactly as written, through a round-trip and through an edit", () => {
    // Reverse-alphabetical with a duplicate in the middle: a sort would reorder it and a dedupe would
    // shorten it.
    const written = [
      { text: "Zero the ledger", done: false },
      { text: "Ask Blinsky", done: true },
      { text: "Ask Blinsky", done: false },
      { text: "Burn the counting house", done: false }
    ];
    const quest = quests.createQuest({ title: "Order matters", objectives: written });
    expect(quest.objectives).toEqual(written);
    expect(quests.getQuest(quest.id)!.objectives).toEqual(written);     // ...and it survives the database round trip

    // An edit replaces the list wholesale: the stored order is the new array, not a merge by position or text.
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
    expect(quests.updateQuest(quest.id, { objectives: [] }, after.rev).objectives).toEqual([]);
  });

  it("bounds objectives, coerces `done`, and allows a blank row without renumbering the list", () => {
    expect(() => quests.createQuest({ title: "Too many", objectives: Array.from({ length: 25 }, () => ({ text: "x", done: false })) })).toThrow(/at most 24 objectives/);
    expect(() => quests.createQuest({ title: "Too long", objectives: [{ text: "x".repeat(121), done: false }] })).toThrow(/up to 120 printable characters/);
    expect(quests.createQuest({ title: "At the cap", objectives: [{ text: "x".repeat(120), done: false }] }).objectives[0].text).toHaveLength(120);

    // A blank row is legal and keeps its slot: the checklist's flow is "add a row, then type" with autosave,
    // so dropping it would renumber the list under the GM's cursor.
    const quest = quests.createQuest({ title: "Blank rows", objectives: [{ text: "First", done: false }, { text: "  ", done: false }, { text: "Third", done: false }] });
    expect(quest.objectives).toEqual([{ text: "First", done: false }, { text: "", done: false }, { text: "Third", done: false }]);

    // `done` is coerced: anything not exactly `true` reads as false.
    const coerced = quests.createQuest({ title: "Coercion", objectives: [{ text: "a", done: "yes" as unknown as boolean }, { text: "b", done: true }] });
    expect(coerced.objectives.map((objective) => objective.done)).toEqual([false, true]);
  });

  it("stores linked entity ids as a deduped set, and rejects a malformed one", () => {
    const strahd = quests.createPage({ title: "Strahd" });
    const ireena = quests.createPage({ title: "Ireena" });
    // `idArray`'s contract: order of first appearance, duplicates dropped. Right for a link set, wrong for
    // objectives, which may legitimately repeat.
    const quest = quests.createQuest({ title: "Escort", entityIds: [ireena.id, strahd.id, ireena.id] });
    expect(quest.entityIds).toEqual([ireena.id, strahd.id]);
    expect(() => quests.createQuest({ title: "Bad link", entityIds: ["not-a-uuid"] })).toThrow(/malformed/);
    // Omitting the field leaves the stored links alone; an empty array clears them.
    expect(quests.updateQuest(quest.id, { title: "Escort Ireena" }, quest.rev).entityIds).toEqual([ireena.id, strahd.id]);
    expect(quests.updateQuest(quest.id, { entityIds: [] }, undefined).entityIds).toEqual([]);
  });

  it("rejects an unknown status, lists oldest-first, and deletes idempotently", () => {
    expect(() => quests.createQuest({ title: "Bad", status: "abandoned" as never })).toThrow(/not started, active, completed, failed, or canceled/);
    expect(() => quests.createQuest({ title: "" })).toThrow(/1 to 160 printable characters/);

    const first = quests.createQuest({ title: "First" });
    tick();
    const second = quests.createQuest({ title: "Second" });
    // A quest has no number or in-world date, so the order it was started in is the only intrinsic one.
    // Completing one must not move it; that is a filter, not an ordering.
    quests.updateQuest(first.id, { status: "completed" }, first.rev);
    expect(quests.listQuests().map((quest) => quest.id)).toEqual([first.id, second.id]);

    quests.deleteQuest(first.id);
    expect(quests.getQuest(first.id)).toBeNull();
    expect(() => quests.deleteQuest(first.id)).not.toThrow();     // idempotent
    expect(() => quests.deleteQuest("not-a-uuid")).not.toThrow(); // malformed id: early return
    // The index row goes with the record, or it would keep matching with no live row to gate.
    expect(quests.searchAll("gm", "First").hits).toEqual([]);
  });

  // All five statuses survive a re-read, and the default is `not-started`. `coerceQuestStatus` fails closed to
  // `active`, so a status missing from the read path would read back as active.
  it("stores all five statuses as THEMSELVES, and defaults a new quest to not-started", () => {
    for (const status of ["not-started", "active", "completed", "failed", "canceled"] as const) {
      const created = quests.createQuest({ title: `Quest ${status}`, status });
      expect(created.status, status).toBe(status);
      expect(quests.getQuest(created.id)!.status, `${status} re-read`).toBe(status);
    }
    // A quest created with no status is not started: a lead written down mid-session is not one the party has
    // taken up. `openQuests` counts it as open either way.
    expect(quests.createQuest({ title: "A rumour in Vallaki" }).status).toBe("not-started");
    const quest = quests.createQuest({ title: "The Bell of Vallaki" });
    expect(quests.updateQuest(quest.id, { status: "active" }, undefined).status).toBe("active");
    expect(quests.updateQuest(quest.id, { status: "canceled" }, undefined).status).toBe("canceled");
    expect(quests.getQuest(quest.id)!.status).toBe("canceled");
  });

  /** A quest's `gmBody` and objectives exist nowhere else, so the backup bundle must carry them. */
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

// The player search index text: a revealed quest passes the SQL and projection gates, so if `gmBody` reached
// the player index a GM-only phrase would produce a hit. The quest is revealed so nothing else masks it.
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
    expect(quest.revealedToPlayers).toBe(true);                            // the SQL gate would pass this quest
    expect(store.searchAll("player", "forgery").hits).toEqual([]);              // ...and yet the phrase is unreachable
    expect(store.searchAll("player", GM_PHRASE).hits).toEqual([]);

    // The GM finds it, so the miss above is the two indexes being kept apart.
    expect(store.searchAll("gm", "forgery").hits).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("still lets a player find that same quest by its player body and by an objective", () => {
    // The quest is in the player's index and player-visible, so the GM phrase missing is about the text written.
    const quest = seedRevealed();
    expect(store.searchAll("player", "counting").hits).toEqual([{ kind: "quest", id: quest.id }]);
    // An objective's text is player-facing, like `playerBody`.
    expect(store.searchAll("player", "Search").hits).toEqual([{ kind: "quest", id: quest.id }]);
    expect(store.searchAll("player", "Wyrmwood").hits).toEqual([{ kind: "quest", id: quest.id }]);
  });

  it("keeps the index in step with an edit and re-splits the layers on the way", () => {
    const quest = seedRevealed();
    store.updateQuest(quest.id, {
      playerBody: "Escort Ireena to Vallaki.", gmBody: "Ireena is Strahd's true target.",
      objectives: [{ text: "Reach the gates", done: false }]
    }, undefined);
    // The old player text stops matching, body and objective, since both feed the same index row.
    expect(store.searchAll("player", "counting").hits).toEqual([]);
    expect(store.searchAll("gm", "counting").hits).toEqual([]);
    expect(store.searchAll("player", "Vallaki").hits).toEqual([{ kind: "quest", id: quest.id }]);
    expect(store.searchAll("player", "gates").hits).toEqual([{ kind: "quest", id: quest.id }]);
    expect(store.searchAll("player", "target").hits).toEqual([]);
    expect(store.searchAll("gm", "target").hits).toEqual([{ kind: "quest", id: quest.id }]);
  });
});

// The quest search projection and record projection, called directly. An HTTP test cannot tell a working
// projection from a SQL predicate that happened to compensate for a broken one.
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
    expect(projectPlayerQuest(store.setQuestRevealed(quest.id, true), noEntities)).not.toBeNull();
  });

  it("emits exactly the allow-listed keys of a REVEALED quest, and never the GM body", () => {
    const revealed = store.setQuestRevealed(seed().id, true);
    const projected = projectPlayerQuest(revealed, noEntities)!;
    // The exact key set, so any new field in the player projection fails here. `gmBody` and `rev` are absent;
    // `status` is present, unlike a session's, because "what is still open" is the feature.
    expect(Object.keys(projected).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "tags", "title"]);
    expect(projected.body).toBe("Recover the ledger from the counting house.");
    expect(projected.status).toBe("active");
    expect(projected.objectives).toEqual([{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }]);
    expect(JSON.stringify(projected)).not.toContain("forgery");

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
    // A revealed quest must not advertise the id of a still-secret page.
    expect(projected.entityIds).toEqual([shown.id]);
    expect(JSON.stringify(projected)).not.toContain(secret.id);
  });

  it("refuses an UNREVEALED quest at the SEARCH projection too — gate 3, on its own", () => {
    const quest = seed();
    // Called directly with no SQL in front; over HTTP `PLAYER_VISIBLE_SQL` would already have dropped this row.
    expect(projectPlayerSearchHit({ kind: "quest", quest }, playerSessionNumbers())).toBeNull();
    expect(projectGmSearchHit({ kind: "quest", quest })).toMatchObject({ kind: "quest", id: quest.id, title: "The Wyrmwood Contract" });
  });

  it("emits a REVEALED quest as a uniform hit row: no body, no reveal flag, and `tags: []`", () => {
    const revealed = store.setQuestRevealed(seed().id, true);
    const hit = projectPlayerSearchHit({ kind: "quest", quest: revealed }, playerSessionNumbers())!;
    // The same key set every other kind emits, so a row renderer never branches on kind.
    expect(Object.keys(hit).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    // Quests carry no tags, so this is `[]` rather than a missing key or null. `status`/`objectives` live on
    // the record; a result row exists to navigate.
    expect(hit.tags).toEqual([]);
    expect(hit.entityType).toBeNull();
    expect(hit.mapId).toBeNull();
    expect(JSON.stringify(hit)).not.toContain("forgery");
    expect(JSON.stringify(hit)).not.toContain("counting house");
  });
});

// Joining journal entries to sessions by id, on a real legacy database. Numbers with no session record get a
// synthesized hidden session with empty prep, recap and attendees, so nothing is invented or orphaned.
describe("CodexStore migration v19 — journal entries join their session by identity (D9)", () => {
  it("synthesizes a hidden played session per orphan number, joins every entry to it, and keeps the display numbers identical", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v18-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      // A pre-migration database: entries whose number matches a session, entries whose number matches nothing,
      // an unnumbered entry, and both a numbered and an unnumbered session.
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

      // Fixtures for the connections migration: two pages with a wiki link, two relationship rows (one known
      // slug, one unknown), and prose in a session/quest/journal body for the startup reconcile to find.
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

      // One synthesized record for the one orphan number.
      const sessions = upgraded.listSessions();
      expect(sessions).toHaveLength(3);
      const synthesized = sessions.find((session) => session.sessionNumber === 7)!;
      expect(synthesized, "an orphan number gets a record rather than being dropped").toBeDefined();
      expect(synthesized.status, "the master plan's ruling: played").toBe("played");
      expect(synthesized.revealedToPlayers, "...and unrevealed, so nothing changes for players").toBe(false);
      // Nothing is invented.
      expect(synthesized.prepBody).toBe("");
      expect(synthesized.recapBody).toBe("");
      expect(synthesized.attendees).toEqual([]);
      // The id passes the store's own id regex, so it round-trips through every route that validates one.
      expect(synthesized.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(upgraded.getSession(synthesized.id)).not.toBeNull();
      // The pre-existing record is untouched, not replaced. (Its prep was rewritten above to seed a wiki link,
      // so only the recap is compared.)
      expect(upgraded.getSession(existingSession)).toMatchObject({ sessionNumber: 1, recapBody: "They crossed." });

      expect(upgraded.getEntry(matched)).toMatchObject({ sessionId: existingSession, sessionNumber: 1 });
      expect(upgraded.getEntry(matched)!.playerText).toBe("We arrived in [[Vallaki]].");
      expect(upgraded.getEntry(orphanA)).toMatchObject({ sessionId: synthesized.id, sessionNumber: 7 });
      expect(upgraded.getEntry(orphanB)).toMatchObject({ sessionId: synthesized.id, sessionNumber: 7 });
      expect(upgraded.getEntry(loose)).toMatchObject({ sessionId: null, sessionNumber: null });

      // The post-migration invariant, in raw SQL below the store: no row keeps a bare number.
      const raw = new DatabaseSync(path);
      const bare = raw.prepare("SELECT COUNT(*) AS n FROM codex_journal WHERE session_number IS NOT NULL").get() as { n: number };
      expect(bare.n, "the bare-number column is empty after v19 - it is now the LABEL store").toBe(0);
      // The rebuilt CHECK admits the seventh kind and still rejects an eighth.
      const probe = (kind: string) => raw.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, kind, sort_key, tags_json, created_at, updated_at) VALUES (?, '', NULL, 0, ?, 99, '[]', '', '')").run(crypto.randomUUID(), kind);
      expect(() => probe("quest"), "v19 widened the CHECK for D11's quest history").not.toThrow();
      expect(() => probe("bogus"), "...and the CHECK still discriminates").toThrow();
      // Every index survived the rebuild, plus the new join index. DROP TABLE takes its indexes with it, so a
      // forgotten CREATE INDEX silently turns the timeline's ORDER BY into a full scan.
      const indexes = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_journal'").all() as Array<{ name: string }>).map((row) => row.name);
      for (const name of ["codex_journal_order", "codex_journal_marker", "codex_journal_page", "codex_journal_session"]) {
        expect(indexes, `index ${name}`).toContain(name);
      }
      const sessionTags = raw.prepare("SELECT tags_json FROM codex_sessions").all() as Array<{ tags_json: string }>;
      for (const row of sessionTags) expect(row.tags_json).toBe("[]");
      raw.close();
      expect(upgraded.listSessions().every((session) => session.tags.length === 0)).toBe(true);

      // The session search backfill keeps the layers apart: the GM finds a legacy session by its prep text, and
      // a player never can, even for a revealed session.
      expect(upgraded.searchAll("gm", "ambush").hits.some((hit) => hit.kind === "session" && hit.id === existingSession)).toBe(true);
      expect(upgraded.searchAll("player", "ambush").hits.some((hit) => hit.id === existingSession)).toBe(false);
      expect(upgraded.searchAll("player", "crossed").hits.some((hit) => hit.kind === "session" && hit.id === existingSession), "a revealed session's RECAP is findable").toBe(true);
      expect(upgraded.searchAll("player", "crossed").hits.some((hit) => hit.id === synthesized.id), "...and a hidden one is not").toBe(false);

      // The links rebuild carried every existing row over as a page source, the relationships table gained its
      // layer, and the legacy slugs became the labels a reader sees.
      const raw2 = new DatabaseSync(path);
      const linkRows = raw2.prepare("SELECT source_kind, source_id, layer, target_ref FROM codex_links WHERE target_kind = 'page' ORDER BY target_ref").all() as Array<{ source_kind: string; source_id: string; layer: string; target_ref: string }>;
      expect(linkRows.length, "the legacy page links survived the rebuild").toBeGreaterThanOrEqual(2);
      // The legacy row is still a page source with its layer intact. (The non-page rows beside it come from
      // the startup reconcile, asserted below.)
      expect(linkRows.find((row) => row.source_id === linkedPage)).toMatchObject({ source_kind: "page", target_ref: "vallaki", layer: "player" });
      const rels = raw2.prepare("SELECT type, layer FROM codex_relationships ORDER BY type").all() as Array<{ type: string; layer: string }>;
      // "ally" -> "ally of" from the known vocabulary; an unknown slug falls back to dashes-into-spaces.
      expect(rels.map((row) => row.type)).toEqual(["ally of", "owes a debt to"]);
      expect(rels.every((row) => row.layer === "player"), "every migrated edge is on the player layer - today's behaviour").toBe(true);
      raw2.close();

      // The startup reconcile ran once on open and re-extracted session, quest and journal bodies, which no SQL
      // migration could do since SQL cannot parse `[[...]]`.
      const reconciled = upgraded.listAllConnections().filter((edge) => edge.origin === "mention");
      expect(reconciled.find((edge) => edge.fromKind === "session"), "a legacy session's PREP link, on the GM layer").toMatchObject({ fromId: existingSession, layer: "gm" });
      expect(reconciled.find((edge) => edge.fromKind === "journal"), "a legacy entry's player-text link").toMatchObject({ fromId: matched, layer: "player" });
      const allyA = upgraded.listPages().find((page) => page.title === "The Harpers")!;
      const allyB = upgraded.listPages().find((page) => page.title === "The Zhentarim")!;
      expect(upgraded.createConnection(allyB.id, { toPageId: allyA.id, label: "ally of" }).fromPageId, "the reverse direction is the SAME edge").toBe(allyA.id);

      // Renumbering the session moves every joined entry's display number in one write, with no journal work.
      upgraded.updateSession(existingSession, { sessionNumber: 42 }, undefined, "gm");
      expect(upgraded.getEntry(matched)!.sessionNumber).toBe(42);

      expect(upgraded.createEntry({ playerText: "Written after the upgrade." }).sessionId).toBeNull();
      expect(upgraded.appendCombatEntry({ sourceEncounterId: 9, playerText: "A brawl." }).sessionId).toBeNull();
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  // The CHECK is asserted in SQL because a repair script could bypass `sessionStatus()`, and `toSession` would
  // coerce the bad value to "planned" rather than failing.
  it("the status CHECK rejects a value the TS gate would never produce", () => {
    const database = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS) database.exec(migration.sql);
    const insert = (status: string) => database
      .prepare("INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at) VALUES (?, NULL, NULL, '[]', '', '', 0, ?, 1, '', '')")
      .run(`id-${status}`, status);

    expect(() => insert("cancelled")).toThrow();
    // Both legal values still insert, so the throw above is the CHECK discriminating.
    expect(() => insert("planned")).not.toThrow();
    expect(() => insert("played")).not.toThrow();
    database.close();
  });
});

// The quests table migration has nothing to backfill, so the claims are that the table and its status
// index ship and that the CHECK discriminates.
describe("CodexStore migration v14 — quests arrive with nothing to back-fill (M10)", () => {
  it("creates the quest table and its status index, and back-fills nothing", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v13-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      // A pre-quests database built from the shipped SQL, with a page and a numbered session: the rows most
      // plausibly mistaken for quests to promote.
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
      expect(upgraded.listSessions()).toHaveLength(1);        // ...and the existing rows are untouched
      expect(upgraded.listPages()).toHaveLength(1);

      // The status index makes the dashboard's open-quest count a query rather than a scan.
      const reopened = new DatabaseSync(path);
      const indexes = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_quests'").all() as Array<{ name: string }>).map((row) => row.name);
      reopened.close();
      expect(indexes).toContain("codex_quests_status");

      expect(upgraded.createQuest({ title: "The Wyrmwood Contract" }).status).toBe("not-started");
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  // The CHECK is asserted in SQL because a repair script could bypass `questStatus()`, and `toQuest` would
  // coerce the bad value to "active" rather than failing.
  it("the status CHECK rejects a value the TS gate would never produce", () => {
    const database = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS) database.exec(migration.sql);
    const insert = (status: string) => database
      .prepare("INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at) VALUES (?, 'Q', ?, '', '', '[]', '[]', 0, 1, '', '')")
      .run(`id-${status}`, status);

    expect(() => insert("abandoned")).toThrow();
    // All five legal values insert, so the throw above is the CHECK discriminating, and `not-started` and
    // `canceled` prove the rebuilt CHECK ran.
    for (const status of ["not-started", "active", "completed", "failed", "canceled"]) expect(() => insert(status), status).not.toThrow();
    expect(() => insert("cancelled")).toThrow();
    database.close();
  });
});

// Adding two quest statuses rebuilds `codex_quests` (SQLite cannot widen a CHECK). This upgrades a seeded
// pre-migration database and compares every column of every row.
describe("CodexStore migration v26 — two more quest statuses, no quest touched (5d)", () => {
  /** A pre-migration database on disk, ready for a CodexStore to upgrade. */
  const v25Database = (path: string): DatabaseSync => {
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 25)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
    }
    return database;
  };

  it("v26 is the next version, and the file really is at 25 before it", () => {
    // The migration count this was written against; a second migration 26 would collide and fail here first.
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
  });

  it("preserves every column of every pre-existing quest — status, id and both bodies byte-identical", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-v25-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let upgraded: CodexStore | undefined;
    try {
      const database = v25Database(path);
      database.prepare("INSERT INTO codex_meta (id, codex_revision, links_backfilled) VALUES (1, 7, 1)").run();
      // One quest per pre-existing status, plus the shapes with something to lose: a GM body, an ordered
      // objective list, linked page ids, tags, and a revealed row.
      const insert = database.prepare("INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const live = crypto.randomUUID(), done = crypto.randomUUID(), lost = crypto.randomUUID();
      const linked = crypto.randomUUID();
      insert.run(live, "The Wyrmwood Contract", "active", "Deliver the ledger to Vallaki.", "The ledger is a forgery.",
        JSON.stringify([{ text: "Find the ledger", done: true }, { text: "Reach Vallaki", done: false }]), JSON.stringify([linked]), 1, 4, "2026-01-04T00:00:00.000Z", "2026-01-09T00:00:00.000Z", '["travel","barovia"]');
      insert.run(done, "Free Ireena", "completed", "She is safe.", "Strahd is not finished.", JSON.stringify([{ text: "Escort her", done: true }]), "[]", 0, 2, "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z", "[]");
      insert.run(lost, "The Missing Caravan", "failed", "", "Nobody survived the pass.", "[]", "[]", 0, 1, "2026-01-06T00:00:00.000Z", "2026-01-06T00:00:00.000Z", '["caravan"]');

      // Raw SQL, not `toQuest`: a projection that drops a column reads as null on both sides. `SELECT *` is
      // right here because the test wants whatever columns actually exist.
      const before = database.prepare("SELECT * FROM codex_quests ORDER BY id").all();
      const beforeColumns = (database.prepare("PRAGMA table_info(codex_quests)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      expect(before).toHaveLength(3);
      // The old file refuses the new statuses, so the widening below is a real change.
      expect(() => database.prepare("INSERT INTO codex_quests (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at) VALUES (?, 'Probe', 'not-started', '', '', '[]', '[]', 0, 1, '', '')").run(crypto.randomUUID())).toThrow();
      database.close();

      upgraded = new CodexStore(path);
      await upgraded.initialize();                                  // migration 26 runs here

      const reopened = new DatabaseSync(path);
      const after = reopened.prepare("SELECT * FROM codex_quests ORDER BY id").all() as Array<Record<string, unknown>>;
      const afterColumns = (reopened.prepare("PRAGMA table_info(codex_quests)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      const indexes = (reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_quests'").all() as Array<{ name: string }>).map((row) => row.name);
      reopened.close();

      expect(after).toHaveLength(before.length);                    // nothing dropped, nothing duplicated
      // Every column of every row, value for value. The migration adds no column, so nothing is excused,
      // including the status strings the rebuild's copying SELECT could have mangled.
      expect(after).toEqual(before);
      expect([...after.map((row) => row.status)].sort()).toEqual(["active", "completed", "failed"]);
      // The rebuilt table matches the old one: columns, order, types, NOT-NULLs and defaults, including
      // `tags_json`'s DEFAULT '[]', which a DDL reconstructed from memory would drop.
      expect(afterColumns).toEqual(beforeColumns);
      // A rebuild drops the table's indexes; `codex_quests_status` keeps the dashboard's open-quest filter cheap.
      expect(indexes).toContain("codex_quests_status");

      const carried = upgraded.getQuest(live)!;
      expect(carried.status).toBe("active");
      expect(carried.title).toBe("The Wyrmwood Contract");
      expect(carried.playerBody).toBe("Deliver the ledger to Vallaki.");
      expect(carried.gmBody).toBe("The ledger is a forgery.");
      expect(carried.objectives).toEqual([{ text: "Find the ledger", done: true }, { text: "Reach Vallaki", done: false }]);
      expect(carried.entityIds).toEqual([linked]);
      expect(carried.tags).toEqual(["travel", "barovia"]);
      expect(carried.revealedToPlayers).toBe(true);
      expect(carried.rev).toBe(4);
      expect(upgraded.getQuest(done)!.status).toBe("completed");
      expect(upgraded.getQuest(lost)!.status).toBe("failed");
      expect(upgraded.listQuests().map((quest) => quest.id)).toEqual([live, done, lost]);   // oldest-first, unchanged

      expect(upgraded.updateQuest(lost, { status: "canceled" }, undefined).status).toBe("canceled");
      expect(upgraded.getQuest(lost)!.status).toBe("canceled");
      expect(upgraded.createQuest({ title: "A rumour in Vallaki" }).status).toBe("not-started");
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });
});

// Eras need no migration: a date's era is derived from its year, and `normalizeCalendar` reads
// `input.eras ?? []`. The fixture deletes `eras` from the stored blob, as older campaigns have it on disk.
describe("CodexStore eras — additive inside calendar_json, no stored date touched (5f)", () => {
  /** Every dated row's derived and raw columns, read as raw SQL so a projection cannot hide a loss. */
  const datedRows = (path: string) => {
    const database = new DatabaseSync(path);
    const read = (table: string) => database.prepare(`SELECT id, in_world_year, in_world_month, in_world_day, calendar_instant, in_world_label FROM ${table} WHERE in_world_year IS NOT NULL ORDER BY id`).all();
    const out = { journal: read("codex_journal"), pages: read("codex_pages"), meta: database.prepare("SELECT published_year, published_month, published_day, calendar_json FROM codex_meta WHERE id = 1").get() };
    database.close();
    return out;
  };
  /** A campaign of the shape a real one has: a custom calendar, a published clock, dated entries and events. */
  const seedCampaign = (target: CodexStore) => {
    target.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 28 }], weekdays: ["Sul", "Mol"], currentDate: { year: 1491, month: 0, day: 4 } });
    target.publishCampaignDate();
    target.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 28 }], weekdays: ["Sul", "Mol"], currentDate: { year: 1492, month: 1, day: 9 } });
    return {
      entry: target.createEntry({ playerText: "The party met in Daggerford.", inWorldDate: { year: 1491, month: 0, day: 4 } }),
      deadline: target.createDeadline({ playerText: "The tax falls due.", inWorldDate: { year: 1492, month: 1, day: 20 } }),
      event: target.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1200, month: 1, day: 3 } })
    };
  };
  /** Strip `eras` from the stored blob: the pre-eras shape, byte for byte. */
  const downgradeCalendarJson = (path: string) => {
    const database = new DatabaseSync(path);
    const row = database.prepare("SELECT calendar_json FROM codex_meta WHERE id = 1").get() as { calendar_json: string };
    const parsed = JSON.parse(row.calendar_json) as Record<string, unknown>;
    expect(parsed).toHaveProperty("eras");                                   // the fixture is a real downgrade
    delete parsed.eras;
    database.prepare("UPDATE codex_meta SET calendar_json = ? WHERE id = 1").run(JSON.stringify(parsed));
    database.close();
  };

  // Reopening a pre-eras file (which runs `migrate()`) leaves every dated row and both clocks byte-identical.
  it("upgrades a pre-eras file by reading it: every dated row and both clocks byte-identical", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-eras-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    let first: CodexStore | undefined;
    let reopened: CodexStore | undefined;
    try {
      first = new CodexStore(path);
      await first.initialize();
      const seeded = seedCampaign(first);
      const clocksBefore = { published: first.getPublishedDate(), current: first.getCalendar().currentDate };
      first.close(); first = undefined;

      downgradeCalendarJson(path);
      const before = datedRows(path);
      expect(before.journal).toHaveLength(2);
      expect(before.pages).toHaveLength(1);
      expect(JSON.parse(String(before.meta!.calendar_json))).not.toHaveProperty("eras");

      reopened = new CodexStore(path);
      await reopened.initialize();                                            // migrate() runs here
      const after = datedRows(path);

      // 1. Raw dates, sort instants and display labels: whole-row equality, nothing excused.
      expect(after.journal).toEqual(before.journal);
      expect(after.pages).toEqual(before.pages);
      // 2. Both clocks, through the store's own reads and through the raw columns beneath them.
      expect(reopened.getPublishedDate()).toEqual(clocksBefore.published);
      expect(reopened.getCalendar().currentDate).toEqual(clocksBefore.current);
      expect([after.meta!.published_year, after.meta!.published_month, after.meta!.published_day]).toEqual([1491, 0, 4]);
      // ...and the blob on disk is still the pre-eras one: reading does not rewrite it, so an older version
      // can still open the file unchanged.
      expect(after.meta!.calendar_json).toBe(before.meta!.calendar_json);
      expect(reopened.getCalendar().eras).toEqual([]);
      expect(reopened.getEntry(seeded.entry.id)!.inWorldLabel).toBe(String(before.journal.find((row) => (row as { id: string }).id === seeded.entry.id)!["in_world_label"]));
      expect(reopened.getEntry(seeded.entry.id)!.inWorldLabel).toBe("Mol, Hammer 4, 1491 DR");
      expect(reopened.getPage(seeded.event.id)!.inWorldLabel).toBe("Sul, Alturiak 3, 1200 DR");
    } finally {
      first?.close(); reopened?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  // Export/import round-trips with and without `eras`, and a pre-eras bundle imports to `[]` rather than
  // undefined or a crash.
  it("round-trips eras through export/import, and imports a pre-eras bundle to an empty list", () => {
    const eras = [{ name: "Third Age", startYear: 1400 }, { name: "Age of Ruin", startYear: 1000 }];
    seedCampaign(store);
    store.setCalendar({ ...store.getCalendar(), eras });
    const withEras = store.exportBundle();
    // Sorted on the way in, so the bundle carries the invariant rather than typing order.
    expect(withEras.calendar.eras).toEqual([{ name: "Age of Ruin", startYear: 1000 }, { name: "Third Age", startYear: 1400 }]);

    store.importBundle(JSON.parse(JSON.stringify(withEras)));
    expect(store.getCalendar().eras).toEqual([{ name: "Age of Ruin", startYear: 1000 }, { name: "Third Age", startYear: 1400 }]);
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 9 });
    expect(store.getPublishedDate()).toEqual({ year: 1491, month: 0, day: 4 });
    expect(store.listTimeline().map((entry) => entry.inWorldLabel)).toEqual(["Mol, Hammer 4, Third Age 1491 DR", "Mol, Alturiak 20, Third Age 1492 DR"]);

    // A pre-eras bundle: the key is absent, not empty.
    const legacy = JSON.parse(JSON.stringify(withEras)) as { calendar: Record<string, unknown> };
    delete legacy.calendar.eras;
    expect(legacy.calendar).not.toHaveProperty("eras");
    store.importBundle(legacy);
    expect(store.getCalendar().eras).toEqual([]);
    expect(store.listTimeline().map((entry) => entry.inWorldLabel)).toEqual(["Mol, Hammer 4, 1491 DR", "Mol, Alturiak 20, 1492 DR"]);
  });

  // Changing eras reflows every dated row in `codex_journal` and `codex_pages`: labels change, raw dates and
  // instants do not.
  it("re-labels every dated row when eras change, and moves not one of them", () => {
    const seeded = seedCampaign(store);
    const instantsBefore = { entry: store.getEntry(seeded.entry.id)!.calendarInstant, deadline: store.getEntry(seeded.deadline.id)!.calendarInstant, event: store.getPage(seeded.event.id)!.calendarInstant };
    expect(store.getEntry(seeded.entry.id)!.inWorldLabel).toBe("Mol, Hammer 4, 1491 DR");

    store.setCalendar({ ...store.getCalendar(), eras: [{ name: "Age of Ruin", startYear: 1000 }, { name: "Third Age", startYear: 1400 }] });

    // Journal and pages, both relabelled by the era their own year falls in; the event at 1200 must not pick
    // up the era starting at 1400.
    expect(store.getEntry(seeded.entry.id)!.inWorldLabel).toBe("Mol, Hammer 4, Third Age 1491 DR");
    expect(store.getEntry(seeded.deadline.id)!.inWorldLabel).toBe("Mol, Alturiak 20, Third Age 1492 DR");
    expect(store.getPage(seeded.event.id)!.inWorldLabel).toBe("Sul, Alturiak 3, Age of Ruin 1200 DR");
    // Nothing moved: raw dates verbatim, instants identical, chronicle order unchanged.
    expect(store.getEntry(seeded.entry.id)!.inWorldDate).toEqual({ year: 1491, month: 0, day: 4 });
    expect(store.getPage(seeded.event.id)!.inWorldDate).toEqual({ year: 1200, month: 1, day: 3 });
    expect({ entry: store.getEntry(seeded.entry.id)!.calendarInstant, deadline: store.getEntry(seeded.deadline.id)!.calendarInstant, event: store.getPage(seeded.event.id)!.calendarInstant }).toEqual(instantsBefore);
    store.setCalendar({ ...store.getCalendar(), eras: [{ name: "Third Age", startYear: 1400 }] });
    expect(store.getPage(seeded.event.id)!.inWorldLabel).toBe("Sul, Alturiak 3, 1200 DR");
    store.setCalendar({ ...store.getCalendar(), eras: [] });
    expect(store.getEntry(seeded.entry.id)!.inWorldLabel).toBe("Mol, Hammer 4, 1491 DR");
    expect(store.getPage(seeded.event.id)!.inWorldLabel).toBe("Sul, Alturiak 3, 1200 DR");
  });
});

// The session projection, called directly. An HTTP test cannot tell a working projection from a router
// that happened to compensate.
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
    expect(projectPlayerSession(store.setSessionRevealed(session.id, true))).not.toBeNull();
  });

  it("emits exactly the allow-listed keys of a REVEALED session, and never the prep", () => {
    const revealed = store.setSessionRevealed(seed().id, true);
    const projected = projectPlayerSession(revealed)!;
    // The exact key set, so any new field in the player projection fails here. `attendees`, `status`,
    // `prepBody` and `rev` are absent.
    expect(Object.keys(projected).sort()).toEqual(["id", "realDate", "recap", "sessionNumber", "tags"]);
    expect(projected.recap).toBe("The party crossed the bridge.");
    const payload = JSON.stringify(projected);
    expect(payload).not.toContain("Ireena is the real target");   // the GM's prep
    expect(payload).not.toContain("Ozy");                          // attendance
    expect(payload).not.toContain("planned");                      // scheduling state

    const gmRow = projectGmSession(revealed);
    expect(gmRow.prepBody).toContain("Ireena is the real target");
    expect(gmRow.attendees).toEqual(["Ozy", "Mara"]);
    expect(gmRow.status).toBe("planned");
    expect(gmRow.rev).toBe(1);
  });
});

// A session's existence is GM information, but auto-linking stamps the active session onto entries. An
// unrevealed record's number is blanked; a revealed record's, or a number with no record, is not.
describe("Codex journal — the unrevealed-session number gate, on its own (M9 follow-up, A-8)", () => {
  /** An entry a player may read, filed under a session by id, as auto-linking produces. */
  const revealedEntry = (sessionId: string | null) => store.createEntry({ playerText: "We reached Vallaki.", sessionId, revealedToPlayers: true });

  it("blanks BOTH halves of the link for an UNREVEALED session, and hands them back the moment it is revealed", () => {
    const session = store.createSession({ sessionNumber: 4, recapBody: "The party crossed." });
    expect(session.revealedToPlayers).toBe(false);
    const entry = revealedEntry(session.id);
    expect(entry).toMatchObject({ sessionId: session.id, sessionNumber: 4 });        // the row carries both...

    const gated = projectPlayerJournalEntry(entry, playerSessionNumbers())!;
    // Both, together. Either half alone reveals that an unshown session exists; the id is the stronger leak
    // because it is a handle a player could try to fetch.
    expect(gated.sessionNumber).toBeNull();
    expect(gated.sessionId).toBeNull();
    expect(projectGmJournalEntry(entry)).toMatchObject({ sessionId: session.id, sessionNumber: 4 });

    // Revealing the session (the entry row is not rewritten, only the context changes) hands both back.
    store.setSessionRevealed(session.id, true);
    expect(projectPlayerJournalEntry(entry, playerSessionNumbers())).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
  });

  it("lets a bare LABEL with no session through - director ruling R2's stamp-back, and nothing else reaches this arm", () => {
    // The only bare labels left after migration: `deleteSession` stamps a revealed session's number onto its
    // entries. That number was already player-visible and names no remaining record, so it travels.
    const revealed = store.createSession({ sessionNumber: 4 });
    store.setSessionRevealed(revealed.id, true);
    const entry = revealedEntry(revealed.id);
    store.deleteSession(revealed.id);

    const orphan = store.getEntry(entry.id)!;
    expect(orphan, "SET NULL on the join, number stamped back as a bare label").toMatchObject({ sessionId: null, sessionNumber: 4 });
    expect(projectPlayerJournalEntry(orphan, playerSessionNumbers())).toMatchObject({ sessionId: null, sessionNumber: 4 });

    // The mirror case: a hidden session's delete stamps nothing, so no leftover label reveals it existed.
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
    // The exact key set: the fields are nulled, never dropped, so one response shape serves both roles.
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
    // The GM's chronicle row still carries it, and revealing the session gives the player's row it back.
    expect(projectGmChronicleRecord({ kind: "entry", entry: store.getEntry(entry.id)! })).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
    store.setSessionRevealed(session.id, true);
    expect(playerRow()).toMatchObject({ sessionId: session.id, sessionNumber: 4 });
  });

  // The display number comes from the join, so renumbering a session moves every linked entry's number in
  // one `updateSession`, with no journal row written.
  it("renumbering a session updates every linked entry's display number, with no journal write", () => {
    const session = store.createSession({ sessionNumber: 4 });
    const first = store.createEntry({ playerText: "We arrived.", sessionId: session.id });
    const second = store.createEntry({ playerText: "We left.", sessionId: session.id });
    const untouchedStamp = store.getEntry(first.id)!.updatedAt;
    expect([first, second].map((entry) => entry.sessionNumber)).toEqual([4, 4]);

    store.updateSession(session.id, { sessionNumber: 9 }, undefined, "gm");

    expect(store.getEntry(first.id)!.sessionNumber).toBe(9);
    expect(store.getEntry(second.id)!.sessionNumber).toBe(9);
    expect(store.getEntry(first.id)!.updatedAt).toBe(untouchedStamp);
    // Clearing the number leaves the join intact: the entry is still filed under that session.
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

    const unnumbered = store.createSession({});
    store.setActiveSession(unnumbered.id);
    const filed = store.createEntry({ playerText: "before it was numbered" });
    expect(filed).toMatchObject({ sessionId: unnumbered.id, sessionNumber: null });
    store.updateSession(unnumbered.id, { sessionNumber: 12 }, undefined, "gm");
    expect(store.getEntry(filed.id)!.sessionNumber, "...and the number appears the moment the GM sets one").toBe(12);
  });
});

// Deadlines and downtime required rebuilding `codex_journal` (SQLite cannot widen a CHECK); the rebuild is
// tested on a pre-migration database built from the shipped SQL.
describe("CodexStore deadlines + downtime (M11)", () => {
  /** A pre-migration database on disk, seeded by the caller, ready for a CodexStore to upgrade. */
  const legacyDatabase = (path: string): DatabaseSync => {
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    database.exec("CREATE TABLE codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 14)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, '')").run(migration.version);
    }
    return database;
  };

  // The new kinds insert and read back as themselves; without a real `kind` parse a deadline would silently
  // read back as a note.
  it("stores a deadline and a downtime as THEMSELVES — the widened CHECK, and a kind that is parsed rather than collapsed", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const deadline = store.createDeadline({ playerText: "The duke's ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

    expect(deadline.kind).toBe("deadline");
    expect(downtime.kind).toBe("downtime");
    expect(store.getEntry(deadline.id)!.kind).toBe("deadline");
    expect(store.getEntry(downtime.id)!.kind).toBe("downtime");
    expect(store.listTimeline().find((entry) => entry.id === deadline.id)!.kind).toBe("deadline");

    // A deadline carries no payload: its text is the "what" and its date the "when".
    expect(deadline.payload).toBeNull();
    expect(deadline.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    // Downtime carries exactly one payload, and `applied` starts false.
    expect(downtime.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
    expect(store.createEntry({ playerText: "plain" }).payload).toBeNull();

    expect(deadline.revealedToPlayers).toBe(false);
    expect(downtime.revealedToPlayers).toBe(false);
    expect(store.setEntryRevealed(deadline.id, true).revealedToPlayers).toBe(true);

    // `indexEntry` runs from `insertEntry`, so both kinds are findable on their own text exactly as a note
    // is, and the unrevealed downtime is hidden from players by the reveal gate, not its kind.
    expect(store.searchAll("gm", "ultimatum").hits.some((hit) => hit.kind === "journal" && hit.id === deadline.id)).toBe(true);
    expect(store.searchAll("gm", "poison").hits.some((hit) => hit.kind === "journal" && hit.id === downtime.id)).toBe(true);
    expect(store.searchAll("player", "ultimatum").hits.some((hit) => hit.id === deadline.id)).toBe(true);   // revealed above
    expect(store.searchAll("player", "poison").hits.some((hit) => hit.id === downtime.id)).toBe(false);     // still hidden

    // The ordinary journal editor must not lose the payload: `updateEntry` names its columns and
    // `payload_json` is not among them.
    expect(store.updateEntry(downtime.id, { playerText: "Vex brews something worse." }).payload)
      .toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });

    // A deadline with no structured date is rejected: prose cannot be compared to a clock.
    expect(() => store.createDeadline({ playerText: "Someday, probably" })).toThrow(/in-world date/);
    expect(() => store.createDeadline({ playerText: "Soon", inWorldLabel: "next spring" })).toThrow(/in-world date/);
  });

  // Seeds a pre-migration database with every row shape that has something to lose, upgrades it, and compares
  // every column in raw SQL (`SELECT *`), since a dropped column would read null on both sides via `toEntry`.
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
      await upgraded.initialize();                                  // the rebuild runs here

      const reopened = new DatabaseSync(path);
      const after = reopened.prepare("SELECT * FROM codex_journal ORDER BY id").all() as Array<Record<string, unknown>>;
      const afterColumns = (reopened.prepare("PRAGMA table_info(codex_journal)").all() as Array<Record<string, unknown>>).map((column) => [column.name, column.type, column.notnull, column.dflt_value]);
      reopened.close();

      expect(after).toHaveLength(before.length);                    // nothing dropped, nothing duplicated
      for (const [index, original] of before.entries()) {
        const { payload_json: payload, session_id: sessionId, session_number: sessionNumber, ...carried } = after[index];
        // Every pre-existing column, value for value, except the two later migrations touched (checked below).
        const { session_number: originalNumber, ...originalCarried } = original as Record<string, unknown>;
        expect(carried).toEqual(originalCarried);
        expect(payload).toBeNull();                                 // the new column starts empty
        // A numbered row's number moved into the join and the bare column was emptied; an unnumbered row is
        // untouched on both.
        if (originalNumber === null) { expect(sessionId).toBeNull(); expect(sessionNumber).toBeNull(); }
        else { expect(sessionId, "a legacy number resolved to a session record").not.toBeNull(); expect(sessionNumber, "and the bare column is now the LABEL store, empty").toBeNull(); }
      }
      // The rebuilt table is the old table plus the two new columns, in the same order with the same types,
      // NOT-NULLs and defaults, including `tags_json`'s DEFAULT '[]'.
      expect(afterColumns.slice(0, -2)).toEqual(beforeColumns);
      expect(afterColumns.at(-2)).toEqual(["payload_json", "TEXT", 0, null]);
      expect(afterColumns.at(-1)).toEqual(["session_id", "TEXT", 0, null]);

      expect(upgraded.getEntry(fight)!.kind).toBe("combat");
      expect(upgraded.getEntry(fight)!.sourceEncounterId).toBe(41);
      expect(upgraded.getEntry(tagged)!.tags).toEqual(["travel", "wolves"]);
      expect(upgraded.getEntry(pinnedToMarker)!.attachMarkerId).toBe(markerId);
      expect(upgraded.getEntry(pinnedToPage)!.attachPageId).toBe(pageId);
      expect(upgraded.getEntry(dated)!.inWorldDate).toEqual({ year: 1492, month: 1, day: 17 });
      expect(upgraded.listEntriesFor({ markerId }).map((entry) => entry.id).sort()).toEqual([pinnedToMarker, fight].sort());

      // The published date is backfilled from the calendar's `currentDate`, so the two clocks start in agreement.
      expect(upgraded.getPublishedDate()).toEqual({ year: 1492, month: 1, day: 17 });
      expect(upgraded.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 17 });
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  // `json_extract` throws on malformed JSON and SQLite's `AND` does not short-circuit, so the backfill must
  // survive a hand-edited `calendar_json`. Each case opening a real store is the assertion.
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
    // A fractional part truncates: `codex_meta` is STRICT and rejects a non-integral REAL, and truncation
    // matches `normalizeCalendar`'s `Math.trunc`.
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

  // `DROP TABLE` drops its indexes and a missing one fails silently, so the definitions are asserted, not
  // just the names.
  it("recreates all three codex_journal indexes, over the same columns, after the rebuild", () => {
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    const indexes = new Map((raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codex_journal'").all() as Array<{ name: string; sql: string | null }>).map((row) => [row.name, row.sql]));
    raw.close();
    expect(indexes.get("codex_journal_order")).toBe("CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at)");
    expect(indexes.get("codex_journal_marker")).toBe("CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id)");
    expect(indexes.get("codex_journal_page")).toBe("CREATE INDEX codex_journal_page ON codex_journal (attach_page_id)");
  });

  // Creating downtime does not move the clock, `applyDowntime` does, and applying twice is rejected and
  // moves nothing (the double-click case).
  it("creating downtime does not move the clock, applying it does, and applying it twice is rejected (O-3)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

    // 1. Creating proposes; the clock has not moved.
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(downtimePayloadOf(downtime)!.applied).toBe(false);
    // ...and the record is dated where the downtime happened (the GM's clock), not where it will end.
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

    // 3. Applying again (a stale page or double-submit) throws rather than silently succeeding, and does
    //    not move the clock a second time.
    expect(() => store.applyDowntime(downtime.id)).toThrow(CodexRevisionConflictError);
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 10 });

    // Neighbouring rejections, so "throws" above is the applied guard and not a blanket refusal.
    const note = store.createEntry({ playerText: "not downtime" });
    expect(() => store.applyDowntime(note.id)).toThrow(/downtime/);
    expect(store.proposedDateFor(note)).toBeNull();
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 1, day: 10 });

    // None of this published anything. The party's clock is still the first date this codex was given
    // (which publishes itself); every later move, including these, is private.
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });
  });

  // `applyDowntime` writes the entry and the calendar in one transaction. A SQLite trigger aborts the
  // calendar write (the second write), so separate transactions would leave the entry committed.
  it("applyDowntime is one transaction: a failed calendar write rolls the entry write back too (D11-F)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });

    // Fires on the calendar write specifically, so `bumpRevision` (also an UPDATE on codex_meta) is untouched.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.exec("CREATE TRIGGER codex_test_block_calendar AFTER UPDATE OF calendar_json ON codex_meta BEGIN SELECT RAISE(ABORT, 'no calendar writes'); END;");
    raw.close();

    expect(() => store.applyDowntime(downtime.id)).toThrow();

    expect(store.getEntry(downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });

    // ...and with the obstruction gone it still works, so the assertions above are the rollback.
    const unblock = new DatabaseSync(join(directory, "vtt.sqlite"));
    unblock.exec("DROP TRIGGER codex_test_block_calendar");
    unblock.close();
    expect(store.applyDowntime(downtime.id).calendar.currentDate).toEqual({ year: 1492, month: 1, day: 10 });
    expect(downtimePayloadOf(store.getEntry(downtime.id)!)!.applied).toBe(true);
  });

  // Moving only `currentDate` leaves dated records byte-identical: instants and labels never read the clock.
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

    store.setCalendar({ ...calendar, currentDate: { year: 1600, month: 2, day: 30 } });

    expect(derived()).toEqual(before);                              // every instant and every label, unchanged
    expect(store.getCalendar().currentDate).toEqual({ year: 1600, month: 2, day: 30 });  // ...and the clock did move
  });

  // Passing time walks months via `dateForInstant(instant + days)`; `normalizeCalendar` does not clamp
  // `currentDate.day` to the month length, so `day + days` would store day 40 of a 30-day month.
  it("passing time rolls over the month and the year instead of clamping (F-4, F-7)", () => {
    const advance = (from: { year: number; month: number; day: number }, days: number) => {
      store.setCalendar({ ...store.getCalendar(), currentDate: from });
      const downtime = store.createDowntime({ playerText: "waiting", downtime: { who: "The party", activity: "Waiting", days } });
      const proposed = store.proposedDateFor(downtime);
      // The proposal and the applied result must agree: the GM confirms the date they were shown.
      expect(store.applyDowntime(downtime.id).calendar.currentDate).toEqual(proposed);
      return proposed;
    };
    expect(advance({ year: 1492, month: 0, day: 25 }, 10)).toEqual({ year: 1492, month: 1, day: 5 });    // month rollover
    expect(advance({ year: 1492, month: 11, day: 25 }, 10)).toEqual({ year: 1493, month: 0, day: 5 });   // year rollover
    expect(advance({ year: 1492, month: 0, day: 1 }, 95)).toEqual({ year: 1492, month: 3, day: 6 });     // several months at once
    expect(advance({ year: 1492, month: 0, day: 1 }, 720)).toEqual({ year: 1494, month: 0, day: 1 });    // two whole years
    expect(advance({ year: 1492, month: 5, day: 12 }, 0)).toEqual({ year: 1492, month: 5, day: 12 });    // zero days is a legal no-op

    store.setCalendar({ yearName: "AE", months: [{ name: "Short", days: 5 }, { name: "Long", days: 40 }, { name: "Mid", days: 20 }], weekdays: [] });
    expect(advance({ year: 3, month: 0, day: 4 }, 3)).toEqual({ year: 3, month: 1, day: 2 });            // 5-day month
    expect(advance({ year: 3, month: 1, day: 39 }, 5)).toEqual({ year: 3, month: 2, day: 4 });           // 40-day month
    expect(advance({ year: 3, month: 2, day: 19 }, 3)).toEqual({ year: 4, month: 0, day: 2 });           // 20-day month -> new year
  });

  // A deadline's date cannot be edited away. `createDeadline` requires a date, and so must `updateEntry`:
  // a dateless deadline would read "Approaching" everywhere and never fire.
  it("refuses to edit a deadline's date away, and leaves the record untouched when it refuses (D11-C)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 2, day: 14 } });

    expect(() => store.updateEntry(deadline.id, { inWorldDate: null })).toThrow(/needs an in-world date/);

    // The refusal is total: the date it had is still there.
    const after = store.getEntry(deadline.id)!;
    expect(after.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    expect(after.calendarInstant).toBe(deadline.calendarInstant);
    expect(after.kind).toBe("deadline");
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant())).toBe(true);

    // Moving a deadline's date is ordinary editing; only removing it is refused.
    const moved = store.updateEntry(deadline.id, { inWorldDate: { year: 1492, month: 3, day: 1 } });
    expect(moved.inWorldDate).toEqual({ year: 1492, month: 3, day: 1 });
    const note = store.createEntry({ playerText: "a note", inWorldDate: { year: 1492, month: 0, day: 5 } });
    expect(store.updateEntry(note.id, { inWorldDate: null }).inWorldDate).toBeNull();
  });

  // A huge year in a hand-edited `calendar_json` can exceed what JavaScript represents, and `node:sqlite`
  // throws on reading it; that read is on the export path. 2^53 is the first value that throws.
  it("reads an unrepresentable published date as 'nothing published' rather than taking the export down", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });

    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.prepare("UPDATE codex_meta SET published_year = ? WHERE id = 1").run(9007199254740992n);
    raw.close();

    expect(store.getPublishedDate()).toBeNull();          // not a date, so: nothing published
    expect(() => store.exportBundle()).not.toThrow();     // the backup still works
    expect(store.exportBundle().publishedDate).toBeNull();
    // The GM's own clock is untouched, so publishing again repairs it.
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });
  });

  // Deleting a page removes it from every quest's linked entities. Quests store links as a JSON array with
  // no foreign key, so `deletePage` must clean them explicitly.
  it("removes a deleted page from every quest's linked entities (M10 x page deletion)", () => {
    const doomed = store.createPage({ title: "Volo", entityType: "character" });
    const kept = store.createPage({ title: "Elminster", entityType: "character" });
    const quest = store.createQuest({ title: "Find Volo", entityIds: [doomed.id, kept.id] });
    const untouched = store.createQuest({ title: "Unrelated", entityIds: [kept.id] });
    expect(store.getQuest(quest.id)!.entityIds).toEqual([doomed.id, kept.id]);

    store.deletePage(doomed.id);

    expect(store.getQuest(quest.id)!.entityIds).toEqual([kept.id]);       // the dangling id is gone...
    expect(store.getQuest(untouched.id)!.entityIds).toEqual([kept.id]);   // ...and nothing else moved
    expect(store.getQuest(quest.id)!.title).toBe("Find Volo");
  });

  it("publishes the first campaign date automatically, and keeps every later move private (O-1)", () => {
    expect(store.getPublishedDate()).toBeNull();

    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 10 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 10 });   // the party has a date

    // Only the first date publishes automatically (an existing campaign gets it by backfill instead, and there
    // is no prep clock ahead of a party with no date). From here the prep clock is private again.
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
    // `fired` is derived on every read and stored nowhere, so rewinding the clock un-fires it. Read as a
    // GM-facing caller does: `deadlineFired` against the GM's own clock.
    const fired = () => deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant());

    expect(fired()).toBe(false);                                                        // the day has not come
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 13 } });
    expect(fired()).toBe(false);                                                        // ...nor the day before
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    expect(fired()).toBe(true);                                                         // "passes it" includes the day itself
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 1 } });
    expect(fired()).toBe(true);
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    expect(fired()).toBe(false);                                                        // rewound: nothing cached it

    // `fired` is not written down: `payload_json` stays null for a deadline, in the file.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    const stored = raw.prepare("SELECT payload_json FROM codex_journal WHERE id = ?").get(deadline.id) as { payload_json: string | null };
    raw.close();
    expect(stored.payload_json).toBeNull();

    const note = store.createEntry({ playerText: "a note", inWorldDate: { year: 1000, month: 0, day: 1 } });
    expect(deadlineFired(note, store.campaignInstant())).toBe(false);
    expect(deadlineFired({ kind: "deadline", calendarInstant: null }, 999_999)).toBe(false);
    expect(deadlineFired({ kind: "deadline", calendarInstant: 0 }, null)).toBe(false);   // no clock, nothing to pass

    // With the GM's clock past the deadline and the published clock behind it, the player derivation must read
    // "not fired", or one boolean would reveal the GM's prep clock.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 1 } });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.campaignInstant())).toBe(true);
    expect(deadlineFired(store.getEntry(deadline.id)!, store.publishedInstant())).toBe(false);
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1493, month: 0, day: 1 });
    expect(deadlineFired(store.getEntry(deadline.id)!, store.publishedInstant())).toBe(true);
  });

  /** The GM's clock and the published clock stay apart until the GM publishes; advancing by hand or via downtime never copies one to the other. */
  it("keeps the GM's clock and the published clock apart until the GM publishes (O-1, D11-H)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 6, day: 20 } });
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 6, day: 20 });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    // Downtime does not publish either; it moves the GM's clock only.
    const downtime = store.createDowntime({ playerText: "prep", downtime: { who: "GM", activity: "Prepping", days: 10 } });
    store.applyDowntime(downtime.id);
    expect(store.getCalendar().currentDate).toEqual({ year: 1492, month: 6, day: 30 });
    expect(store.getPublishedDate()).toEqual({ year: 1492, month: 0, day: 1 });

    store.publishCampaignDate();
    expect(store.getPublishedDate()).toEqual(store.getCalendar().currentDate);

    // Publishing with no GM clock clears the published date rather than leaving a stale one.
    store.setCalendar({ ...store.getCalendar(), currentDate: null });
    store.publishCampaignDate();
    expect(store.getPublishedDate()).toBeNull();
  });

  // The published date lives only in `codex_meta`, so the bundle must carry it. Also checked across a reopen.
  it("carries a downtime payload and the published date through export and a reopen (T-14)", async () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 3, day: 8 } });
    store.publishCampaignDate();
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 9, day: 2 } });   // GM runs ahead
    const downtime = store.createDowntime({ playerText: "Vex brews poison.", downtime: { who: "Vex", activity: "Brewing poison", days: 30, characterPageId: null } });
    const deadline = store.createDeadline({ playerText: "The ultimatum expires.", inWorldDate: { year: 1492, month: 11, day: 1 } });

    const bundle = store.exportBundle();
    expect(bundle.publishedDate).toEqual({ year: 1492, month: 3, day: 8 });                        // not the GM's clock
    expect(bundle.journal.find((entry) => entry.id === downtime.id)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: false, characterPageId: null });
    expect(bundle.journal.find((entry) => entry.id === downtime.id)!.kind).toBe("downtime");
    expect(bundle.journal.find((entry) => entry.id === deadline.id)!.kind).toBe("deadline");
    expect(bundle.journal.find((entry) => entry.id === deadline.id)!.payload).toBeNull();

    // ...and `applied` rides along, or a restored codex would offer to pass the same 30 days again.
    store.applyDowntime(downtime.id);
    expect(downtimePayloadOf(store.exportBundle().journal.find((entry) => entry.id === downtime.id)!)!.applied).toBe(true);

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
    store = new CodexStore(path);
    await store.initialize();
  });
});

// Standing, party marker and milestones at the store layer, including the additive migration on a real
// pre-migration database.
describe("CodexStore standing, party marker + milestones (M12)", () => {
  /** A pre-migration database on disk, seeded by the caller, ready for a CodexStore to upgrade. */
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

  // Every existing marker and journal row survives untouched and `is_party` arrives as 0. The journal half
  // guards against an unnecessary `codex_journal` rebuild.
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
      await upgraded.initialize();                                  // the migration runs here

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
        expect(carried).toEqual(original);                          // every pre-existing column, value for value
        expect(isParty).toBe(0);                                    // ...and the new one defaults to "not the party"
      }
      // This migration must not touch `codex_journal`. A later migration on this upgrade path does (the
      // session join), so the comparison excludes the columns it owns.
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

      // The new column is last with the declared type/NOT NULL/DEFAULT, so an existing codex needs no backfill.
      expect(markerColumns.at(-1)).toEqual(["is_party", "INTEGER", 1, "0"]);
      expect(standingColumns).toEqual(["id", "faction_page_id", "value", "revealed", "created_at", "updated_at"]);

      expect(upgraded.getMarker(linked)!.pageIds).toEqual([pageId]);
      expect(upgraded.getMarker(linked)!.tags).toEqual(["landmark"]);
      expect(upgraded.getMarker(hidden)!.revealedToPlayers).toBe(false);
      expect(upgraded.listMarkers(mapId).every((marker) => marker.isParty === false)).toBe(true);
      expect(upgraded.partyMarker()).toBeNull();
      expect(upgraded.getEntry(downtime)!.payload).toEqual({ who: "Vex", activity: "Brewing poison", days: 30, applied: true, characterPageId: null });
      expect(upgraded.getEntry(note)!.tags).toEqual(["travel"]);
      // An empty standing table is the complete upgrade: there was never a standing to backfill from.
      expect(upgraded.listStanding()).toEqual([]);
    } finally {
      upgraded?.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  // One party marker atlas-wide (pins on different maps): `setPartyMarker` clears before it sets, and the
  // partial unique index holds even for raw SQL writes around the store.
  it("only one marker can be the party at a time, atlas-wide (M12-C, T-2)", () => {
    const barovia = store.createMap({ assetId: ASSET, name: "Barovia", kind: "regional" });
    const faerun = store.createMap({ assetId: ASSET, name: "Faerûn", kind: "world" });
    const village = store.createMarker(barovia.id, { x: 10, y: 10, iconId: "town", iconColor: "#ff2e9a", label: "Village" });
    const castle = store.createMarker(barovia.id, { x: 20, y: 20, iconId: "castle", iconColor: "#2de2ff", label: "Castle" });
    const waterdeep = store.createMarker(faerun.id, { x: 30, y: 30, iconId: "town", iconColor: "#a45cff", label: "Waterdeep" });

    expect(store.partyMarker()).toBeNull();                          // nothing is the party until the GM says so
    expect(store.setPartyMarker(village.id)!.isParty).toBe(true);
    expect(store.partyMarker()!.id).toBe(village.id);

    // Flagging a second pin on the same map moves the party rather than erroring.
    store.setPartyMarker(castle.id);
    expect(store.partyMarker()!.id).toBe(castle.id);
    expect(store.getMarker(village.id)!.isParty).toBe(false);

    // ...and so does flagging one on a different map, which a per-map design would fail.
    store.setPartyMarker(waterdeep.id);
    expect(store.partyMarker()!.id).toBe(waterdeep.id);
    expect(store.listMarkers(barovia.id).filter((marker) => marker.isParty)).toHaveLength(0);
    expect(store.listMarkers(faerun.id).filter((marker) => marker.isParty).map((marker) => marker.id)).toEqual([waterdeep.id]);

    // The file's half: a write that goes around the store cannot produce a second party pin.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    try {
      expect(() => raw.exec(`UPDATE codex_markers SET is_party = 1 WHERE id = '${village.id}'`)).toThrow(/UNIQUE/);
      // ...while any number of non-party pins coexist, so the index's WHERE clause matters.
      expect((raw.prepare("SELECT COUNT(*) AS c FROM codex_markers WHERE is_party = 0").get() as { c: number }).c).toBe(2);
    } finally { raw.close(); }

    // `null` clears it, and a party pin is otherwise an ordinary marker: ordinary move, reveal and delete.
    store.setPartyMarker(waterdeep.id);
    expect(store.moveMarker(waterdeep.id, 44, 55).isParty).toBe(true);
    expect(store.updateMarker(waterdeep.id, { label: "Waterdeep, City of Splendours" }).isParty).toBe(true);
    expect(store.setMarkerRevealed(waterdeep.id, true).isParty).toBe(true);
    expect(store.setPartyMarker(null)).toBeNull();
    expect(store.partyMarker()).toBeNull();
    expect(store.getMarker(waterdeep.id)!.isParty).toBe(false);

    store.setPartyMarker(castle.id);
    store.deleteMarker(castle.id);
    expect(store.partyMarker()).toBeNull();
    store.setPartyMarker(village.id);
    store.deleteMap(barovia.id);
    expect(store.partyMarker()).toBeNull();

    expect(() => store.setPartyMarker(crypto.randomUUID())).toThrow(/no longer exists/);
  });

  // `setStanding` writes the value and its chronicle record in one transaction. A SQLite trigger aborts the
  // journal write (the second write), so separate transactions would leave the value committed.
  it("setStanding is one transaction: a failed chronicle write rolls the value back too (F-7, T-3)", () => {
    const harpers = faction("The Harpers");
    store.setStanding(harpers.id, 40, "Saved the caravan.");
    expect(store.getStanding(harpers.id)!.value).toBe(40);

    // Fires on the chronicle record specifically, so the standing UPDATE itself is untouched.
    const raw = new DatabaseSync(join(directory, "vtt.sqlite"));
    raw.exec("CREATE TRIGGER codex_test_block_standing_record AFTER INSERT ON codex_journal WHEN NEW.kind = 'standing' BEGIN SELECT RAISE(ABORT, 'no standing records'); END;");
    raw.close();

    expect(() => store.setStanding(harpers.id, -80, "Betrayed them.")).toThrow();

    expect(store.getStanding(harpers.id)!.value).toBe(40);
    expect(store.listChronicle().filter((record) => record.kind === "entry" && record.entry.kind === "standing")).toHaveLength(1);

    const unblock = new DatabaseSync(join(directory, "vtt.sqlite"));
    unblock.exec("DROP TRIGGER codex_test_block_standing_record");
    unblock.close();
    expect(store.setStanding(harpers.id, -80, "Betrayed them.").value).toBe(-80);
    expect(store.listChronicle().filter((record) => record.kind === "entry" && record.entry.kind === "standing")).toHaveLength(2);

    // A rejected first-ever set leaves no row behind, so no faction sits at a value with no history.
    const zhents = faction("The Zhentarim");
    const block = new DatabaseSync(join(directory, "vtt.sqlite"));
    block.exec("CREATE TRIGGER codex_test_block_standing_record AFTER INSERT ON codex_journal WHEN NEW.kind = 'standing' BEGIN SELECT RAISE(ABORT, 'no standing records'); END;");
    block.close();
    expect(() => store.setStanding(zhents.id, 25, "An uneasy truce.")).toThrow();
    expect(store.getStanding(zhents.id)).toBeNull();
    expect(store.listStanding().map((row) => row.factionPageId)).toEqual([harpers.id]);
  });

  // Standing is signed and bounded, and its record carries the delta: `+40 then -60` reads as `+40, -60` and
  // leaves the bar at -20.
  it("standing clamps to -100..100 and its record carries the delta, not the new value (M12-B, T-4)", () => {
    const harpers = faction("The Harpers");
    const standingDeltas = () => store.listChronicle()
      .flatMap((record) => record.kind === "entry" && record.entry.kind === "standing" ? [record.entry.payload as { factionPageId: string; delta: number; reason: string }] : []);
    // Addressed by reason, never by list position: `listChronicle` breaks a `created_at` tie on a random
    // uuid, so `.at(-1)` would be arbitrary.
    const deltaFor = (reason: string) => standingDeltas().find((payload) => payload.reason === reason)!;

    // A first-ever set moves from 0 (Neutral), so the delta is the value, only this once.
    expect(store.setStanding(harpers.id, 40, "Saved the caravan.").value).toBe(40);
    expect(deltaFor("Saved the caravan.")).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });

    // A later set is a movement: 40 -> -20 is -60.
    expect(store.setStanding(harpers.id, -20, "Sold them out.").value).toBe(-20);
    expect(deltaFor("Sold them out.")).toEqual({ factionPageId: harpers.id, delta: -60, reason: "Sold them out." });

    // Clamped, not rejected: the ends of the scale are meaningful. The delta uses the clamped value so the
    // history adds up to the table (-20 -> 100 is +120, not +1020).
    expect(store.setStanding(harpers.id, 1000, "Saved the High Harper.").value).toBe(100);
    expect(deltaFor("Saved the High Harper.").delta).toBe(120);
    expect(store.setStanding(harpers.id, -9999, "Burned their safehouse.").value).toBe(-100);
    expect(deltaFor("Burned their safehouse.").delta).toBe(-200);
    // Fractions truncate rather than writing a REAL into a STRICT INTEGER column.
    expect(store.setStanding(harpers.id, 12.9, "Made partial amends.").value).toBe(12);
    // NaN/Infinity are an error, not a clamp.
    expect(() => store.setStanding(harpers.id, Number.NaN, "?")).toThrow(/number/);
    expect(() => store.setStanding(harpers.id, Number.POSITIVE_INFINITY, "?")).toThrow(/number/);

    // The deltas sum to exactly where the bar stands.
    expect(standingDeltas().reduce((sum, payload) => sum + payload.delta, 0)).toBe(store.getStanding(harpers.id)!.value);

    // A set that changes nothing still records the GM's reason.
    store.setStanding(harpers.id, 12, "We held the line.");
    expect(deltaFor("We held the line.")).toEqual({ factionPageId: harpers.id, delta: 0, reason: "We held the line." });

    // Adjusting a number is not a disclosure decision: reveal state survives every set, both ways.
    expect(store.getStanding(harpers.id)!.revealedToPlayers).toBe(false);      // starts hidden
    store.setStandingRevealed(harpers.id, true);
    expect(store.setStanding(harpers.id, 5, "Slipped a little.").revealedToPlayers).toBe(true);
    store.setStandingRevealed(harpers.id, false);
    expect(store.setStanding(harpers.id, 50, "Recovered.").revealedToPlayers).toBe(false);

    // Standing is tracked against a faction. SQLite cannot express that in a foreign key, so the store
    // enforces it with a message a GM can read.
    const strahd = store.createPage({ title: "Strahd", entityType: "character" });
    expect(() => store.setStanding(strahd.id, 10, "?")).toThrow(/faction/);
    expect(() => store.setStanding(crypto.randomUUID(), 10, "?")).toThrow(/no longer exists/);
    expect(() => store.setStandingRevealed(crypto.randomUUID(), true)).toThrow(/no standing/);
  });

  // A `milestone` and a `standing` row read back as themselves on a second read; an un-widened
  // `JOURNAL_KINDS` would silently show them as notes.
  it("a milestone and a standing record round-trip as themselves, not as notes (F-3, T-5)", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 2, day: 14 } });
    const harpers = faction("The Harpers");
    const milestone = store.createMilestone({ playerText: "The party cleared the crypt.", milestone: { level: 5, reason: "Sealed the ossuary" } });
    store.setStanding(harpers.id, 40, "Saved the caravan.");
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

    expect(store.getEntry(milestone.id)!.payload).toEqual({ level: 5, reason: "Sealed the ossuary" });
    expect(store.getEntry(standing.id)!.payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });
    expect(store.createEntry({ playerText: "plain" }).payload).toBeNull();

    // Dated at the GM's clock when no date is given, as combat entries and downtime are.
    expect(store.getEntry(milestone.id)!.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });
    expect(store.getEntry(standing.id)!.inWorldDate).toEqual({ year: 1492, month: 2, day: 14 });

    expect(store.getEntry(milestone.id)!.revealedToPlayers).toBe(false);
    expect(store.getEntry(standing.id)!.revealedToPlayers).toBe(false);
    expect(store.setEntryRevealed(milestone.id, true).revealedToPlayers).toBe(true);

    expect(store.searchAll("gm", "crypt").hits.some((hit) => hit.kind === "journal" && hit.id === milestone.id)).toBe(true);
    expect(store.searchAll("player", "crypt").hits.some((hit) => hit.id === milestone.id)).toBe(true);     // revealed above
    // ...and payload text is never indexed: a `reason` is GM prose with no reveal gate of its own. "ossuary" and
    // "caravan" appear only inside reasons, so a hit would be the leak.
    expect(store.searchAll("gm", "ossuary").hits.some((hit) => hit.id === milestone.id)).toBe(false);
    expect(store.searchAll("gm", "caravan").hits.some((hit) => hit.id === standing.id)).toBe(false);

    // A standing record's prose lives in its payload and nowhere else.
    expect(store.getEntry(standing.id)!.playerText).toBe("");
    expect(store.getEntry(standing.id)!.gmText).toBeNull();

    // The ordinary journal editor must not lose either payload: `updateEntry` names its columns and
    // `payload_json` is not among them.
    expect(store.updateEntry(milestone.id, { playerText: "The party cleared the crypt at last." }).payload).toEqual({ level: 5, reason: "Sealed the ossuary" });
    expect(store.updateEntry(standing.id, { tags: ["harpers"] }).payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });

    // A level is a stated fact, so it is rejected rather than clamped (unlike standing).
    expect(() => store.createMilestone({ milestone: { level: 0, reason: "?" } })).toThrow(/1 to 20/);
    expect(() => store.createMilestone({ milestone: { level: 21, reason: "?" } })).toThrow(/1 to 20/);
    expect(() => store.createMilestone({ milestone: { level: 4.5, reason: "?" } })).toThrow(/1 to 20/);

    // Deleting the faction page cascades its standing row away but leaves its history: the timeline is the
    // campaign's record.
    store.deletePage(harpers.id);
    expect(store.getStanding(harpers.id)).toBeNull();
    expect(store.listStanding()).toEqual([]);
    expect(store.getEntry(standing.id)).not.toBeNull();          // the history is still there...
    expect(store.getEntry(standing.id)!.kind).toBe("standing");  // ...and still a standing record
    expect(store.getEntry(standing.id)!.payload).toEqual({ factionPageId: harpers.id, delta: 40, reason: "Saved the caravan." });
  });

  // `codex_standing` exists nowhere else, so the bundle must carry it. Also checked across a reopen.
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
    // Keyed by faction rather than position: `listStanding` breaks a `created_at` tie on a random uuid. The
    // bundle must carry every faction's signed value and its own reveal state.
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
    store = new CodexStore(path);
    await store.initialize();
  });
});

// Bundle keys whose facts exist nowhere else: the calendar (instants depend on it), empty folders (only in
// `codex_folders`), and revision history. Store-level because `GET /codex/export` returns it verbatim.
describe("CodexStore export bundle — the calendar, empty folders and revision history (2026-07-30)", () => {
  it("carries the CALENDAR, and keeps the GM's clock distinct from the published one", () => {
    // A non-default calendar (two 10-day months), so omitting it would move every dated record.
    store.setCalendar({ yearName: "AR", months: [{ name: "Frost", days: 10 }, { name: "Thaw", days: 10 }], weekdays: ["Firstday"], currentDate: { year: 1492, month: 1, day: 4 } });
    store.publishCampaignDate();
    // The GM's clock then runs ahead, unpublished.
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1493, month: 0, day: 9 } });

    const bundle = store.exportBundle();
    expect(bundle.calendar.yearName).toBe("AR");
    expect(bundle.calendar.months).toEqual([{ name: "Frost", days: 10 }, { name: "Thaw", days: 10 }]);
    // The two clocks are separate facts and the bundle carries both: a restore that read the party's date
    // off `calendar.currentDate` would jump them a year forward.
    expect(bundle.calendar.currentDate).toEqual({ year: 1493, month: 0, day: 9 });
    expect(bundle.publishedDate).toEqual({ year: 1492, month: 1, day: 4 });
  });

  it("carries an EMPTY folder, the one part of the GM's filing nothing else remembers", () => {
    const page = store.createPage({ title: "Village of Barovia", folder: "Barovia/Villages" });
    store.createFolder("Barovia/Ruins");                          // never held a page at all
    store.updatePage(page.id, { folder: null }, undefined, "gm"); // and now this one is empty too

    const bundle = store.exportBundle();
    expect(bundle.pages.find((row) => row.id === page.id)!.folder).toBeNull();
    // Neither path is derivable from any page's `folder` any more; `codex_folders` is the only record.
    expect(bundle.folders).toEqual(expect.arrayContaining(["Barovia", "Barovia/Ruins", "Barovia/Villages"]));
  });

  it("carries EVERY page's revision history, with the snapshot columns a restore needs", () => {
    // `windowMinutes: 0` checkpoints every save, so the bundle has a history deeper than one entry. The
    // throttle itself is tested in "CodexStore revision history" below.
    store.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT });
    const page = store.createPage({ title: "Strahd", entityType: "character", fields: { race: "Vampire" }, gmFields: { goals: "Reclaim Tatyana" }, playerBody: "A count.", gmBody: "The darklord." });
    store.updatePage(page.id, { title: "Strahd von Zarovich", playerBody: "A count of Barovia." }, undefined, "gm");
    store.updatePage(page.id, { title: "Strahd, Lord of Barovia" }, undefined, "gm");
    const other = store.createPage({ title: "Ireena" });

    const bundle = store.exportBundle();
    // Both pages' histories in one list, regroupable by `pageId`, unlike the per-page `listRevisions`.
    expect(new Set(bundle.revisions.map((row) => row.pageId))).toEqual(new Set([page.id, other.id]));
    const history = bundle.revisions.filter((row) => row.pageId === page.id);
    // Ascending: a history, not a feed. One row per `rev`: the creation checkpoints the page and the first
    // edit's prior state is the same rev 1, so `revisionExistsAt` suppresses the byte-identical duplicate.
    expect(history.map((row) => row.rev)).toEqual([1, 2]);
    expect(history[0]).toMatchObject({ title: "Strahd", playerBody: "A count.", gmBody: "The darklord." });
    expect(history[1].title).toBe("Strahd von Zarovich");
    // The three snapshot columns `GET /codex/pages/{id}/revisions` does not send. `restoreRevision` reads these
    // plus the wire row, so a bundle without them would restore prose and drop typed fields.
    expect(history[0].entityType).toBe("character");
    expect(history[0].fields).toEqual({ race: "Vampire" });
    expect(history[0].gmFields).toEqual({ goals: "Reclaim Tatyana" });
    // The wire row is unchanged: `listRevisions` still serves exactly the contract's ten keys.
    expect(Object.keys(store.listRevisions(page.id)[0]).sort())
      .toEqual(["authorTag", "authoredAt", "bannerAssetId", "gmBody", "id", "pageId", "playerBody", "rev", "tags", "title"]);
  });

  /** New bundle keys are appended so no existing key moves; consumers read the bundle by key. */
  it("appends each new key LAST, leaving every previous one in its established order", () => {
    expect(Object.keys(store.exportBundle())).toEqual([
      "pages", "maps", "markers", "journal", "relationships", "sessions", "activeSessionId", "quests",
      "publishedDate", "standing", "partyMarkerId",
      "calendar", "folders", "revisions",
      // The settings exist nowhere else, so a bundle without them would silently revert preferences. Appended last.
      "settings"
    ]);
  });
});

// Revision history settings. By default a save within 90 minutes of the last checkpoint writes no revision.
// Tests drive the injected clock (`new CodexStore(path, () => now)`); nothing here prunes revisions.
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

    at(90);                                                 // exactly 90 is not "less than 90", so this commits
    clock.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    const revisions = clock.listRevisions(page.id);
    expect(revisions).toHaveLength(2);
    // ...and it captured the state this save overwrote (v1, authored at t=89), not the v2 it wrote.
    expect(revisions[0]).toMatchObject({ playerBody: "v1", authoredAt: new Date(EPOCH + 89 * 60_000).toISOString() });
  });

  // `windowMinutes: 0` means "keep every save"; `enabled: false` is "never". The clock does not move between
  // these saves, so nothing can pass by elapsed time.
  it("checkpoints EVERY save at windowMinutes 0 — the OLD behaviour, not 'never'", () => {
    clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT });
    at(0);
    const page = clock.createPage({ title: "Vallaki", playerBody: "v0" });
    clock.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    clock.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    clock.updatePage(page.id, { playerBody: "v3" }, undefined, "gm");
    // Four writes, three checkpoints, clock frozen: one per distinct state.
    const revisions = clock.listRevisions(page.id);
    expect(revisions).toHaveLength(3);
    // Newest first. `v0` appears once: the first edit's prior-state snapshot would duplicate the creation
    // checkpoint and is suppressed. `v3` is absent because it is the current state.
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
    // No new row, and no row destroyed: disabling must not delete the GM's only undo, so the same ids are
    // asserted, not just a count.
    expect(clock.listRevisions(page.id).map((row) => row.id)).toEqual(before.map((row) => row.id));

    // ...and the history is still restorable with the switch off.
    const oldest = before[before.length - 1];
    expect(clock.restoreRevision(page.id, oldest.id, "gm").playerBody).toBe("the good version");
    // The restore is itself a save and wrote no revision. A restore always checkpoints the text it discards
    // (see below), but that exception bypasses only the window, never the switch.
    expect(clock.listRevisions(page.id).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  // With history disabled no checkpoint is written, not even on creation; the window never throttles a
  // creation, but the switch does.
  it("writes NO checkpoint at all with history disabled, not even a page's creation", () => {
    clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    at(0);
    const page = clock.createPage({ title: "Berez", playerBody: "as created" });
    expect(clock.listRevisions(page.id)).toEqual([]);
    at(5000); clock.updatePage(page.id, { playerBody: "edited" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toEqual([]);
    expect(clock.getPage(page.id)!.playerBody).toBe("edited");
  });

  // A restore always checkpoints the state it discards, whatever the window, so restoring twice cannot lose
  // the version restored away from.
  it("checkpoints the state a RESTORE discards, even well inside the window", () => {
    clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    // The timing matters: a checkpoint's `authored_at` is when its content was authored, so it lags. To reach
    // a state where an ordinary save would be suppressed, the newest checkpoint's `authored_at` must be inside
    // the window:
    //   t=0    create "the original"       -> checkpoint rev 1, authored_at t=0
    //   t=200  save "a draft"              -> prior state is rev 1, already checkpointed: suppressed
    //   t=250  save "the good draft"       -> prior state is rev 2 ("a draft", authored t=200); newest
    //                                         checkpoint is authored t=0, age 250 > 90, so this writes,
    //                                         and the newest authored_at becomes t=200
    //   t=260  restore                     -> age is now 260-200 = 60 < 90, so an ordinary save writes
    //                                         nothing here. Only `force` checkpoints.
    at(0);
    const page = clock.createPage({ title: "Argynvostholt", playerBody: "the original" });
    at(200); clock.updatePage(page.id, { playerBody: "a draft" }, undefined, "gm");
    at(250); clock.updatePage(page.id, { playerBody: "the good draft" }, undefined, "gm");
    const original = clock.listRevisions(page.id).find((row) => row.playerBody === "the original")!;

    at(260);
    clock.restoreRevision(page.id, original.id, "gm");
    expect(clock.getPage(page.id)!.playerBody).toBe("the original");

    // The draft the restore discarded is recoverable.
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
    // ...and the week-long window really suppresses updates at this setting, so the assertions above show the
    // create path is exempt.
    at(5_000); // well over three days, still inside a week
    clock.updatePage(first.id, { playerBody: "edited" }, undefined, "gm");
    expect(clock.listRevisions(first.id)).toHaveLength(1);
  });

  // The snapshot must capture the prior state. With new-state snapshots, the save at t=80 would be coalesced
  // away and a ruinous save after a two-day gap would checkpoint the ruin, dropping the GM back to t=0.
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
    // The checkpoint that save took is the state it was about to overwrite, not the ruin it wrote.
    expect(revisions[0].playerBody).toBe("the good work");
    expect(revisions.map((row) => row.playerBody)).not.toContain("");
    expect(clock.restoreRevision(page.id, revisions[0].id, "gm").playerBody).toBe("the good work");
  });

  // The newest checkpoint normally sits behind the page's current state, so restoring it is a real undo.
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
    // A non-finite window is an error, not a clamp: `Math.trunc(NaN)` is NaN, which a STRICT INTEGER column
    // would reject. Same rule as `standingValue`.
    expect(() => clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: Number.NaN }, autosave: AUTOSAVE_DEFAULT })).toThrow(/minutes/i);
    // ...and `enabled` must be stated: coercing a missing field would land on `false` and switch history off.
    expect(() => clock.setSettings({ revisionHistory: { windowMinutes: 90 } } as never)).toThrow(/on or off/i);
    expect(clock.getSettings().revisionHistory).toMatchObject({ enabled: false, windowMinutes: 45 }); // neither throw wrote
  });

  // A hand-edited database can hold an unrepresentable INTEGER, which `node:sqlite` throws on reading. The
  // store is closed, edited and reopened, so this is a stored value arriving at a fresh read.
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

    // Non-vacuity: an in-range value survives the round trip, so the assertions below are the guard firing.
    write("UPDATE codex_meta SET revision_window_minutes = ? WHERE id = 1", 45);
    let store45 = await reopen();
    expect(store45.getSettings().revisionHistory.windowMinutes).toBe(45);
    store45.close();

    for (const stored of [-5, 10_081, 2n ** 53n]) {
      write("UPDATE codex_meta SET revision_window_minutes = ? WHERE id = 1", stored);
      const reopened = await reopen();
      // Never throws (2^53 would), and reads as the default.
      expect(reopened.getSettings().revisionHistory.windowMinutes, `stored ${stored}`).toBe(90);
      // Behavioural: the throttle really runs at 90 minutes, so a save at t=200 commits.
      at(0); reopened.updatePage(page.id, { playerBody: "inside" }, undefined, "gm");
      expect(reopened.listRevisions(page.id), `stored ${stored}`).toHaveLength(1);
      at(200); reopened.updatePage(page.id, { playerBody: "outside" }, undefined, "gm");
      expect(reopened.listRevisions(page.id), `stored ${stored}`).toHaveLength(2);
      reopened.close();
      // Put the page back to a one-checkpoint state for the next iteration.
      write("DELETE FROM codex_page_revisions WHERE rev > 1 OR id NOT IN (SELECT MIN(id) FROM codex_page_revisions)");
    }

    // `enabled` accepts exactly 0 or 1; anything else reads as on. This fails open, unlike the reveal flags: a
    // garbled value must not silently stop recording undo history.
    write("UPDATE codex_meta SET revision_history_enabled = 7, revision_window_minutes = 90 WHERE id = 1");
    const garbled = await reopen();
    expect(garbled.getSettings().revisionHistory).toMatchObject({ enabled: true, windowMinutes: 90 });
    garbled.close();
    write("UPDATE codex_meta SET revision_history_enabled = 0 WHERE id = 1");
    const off = await reopen();
    expect(off.getSettings().revisionHistory.enabled).toBe(false);
    off.close();

    // Reopened at the end so the fixture's `afterEach` has a live store to close.
    clock = await reopen();
  });

  /** The autosave settings, held to the same standard as `revisionHistory`: same row, same write, same read guard. */
  it("clamps and truncates the autosave interval on the way in, and answers with what was STORED", () => {
    const set = (autosave: { enabled: boolean; intervalSeconds: number }) =>
      clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 }, autosave });
    // Overshoot lands on the end of the scale; a fractional second is a picker artefact.
    expect(set({ enabled: true, intervalSeconds: 5000 }).autosave.intervalSeconds).toBe(600);
    expect(set({ enabled: true, intervalSeconds: 0 }).autosave.intervalSeconds).toBe(1);
    expect(set({ enabled: true, intervalSeconds: -30 }).autosave.intervalSeconds).toBe(1);
    expect(set({ enabled: false, intervalSeconds: 10.9 }).autosave).toEqual({ enabled: false, intervalSeconds: 10 });
    expect(clock.getSettings().autosave).toEqual({ enabled: false, intervalSeconds: 10 });
    // A non-finite interval is an error, not a clamp, as with `revisionWindowMinutes`.
    expect(() => set({ enabled: true, intervalSeconds: Number.NaN })).toThrow(/seconds/i);
    // ...and `enabled` must be stated, since a coerced missing field would land on `false` and stop autosave.
    expect(() => clock.setSettings({ revisionHistory: { enabled: true, windowMinutes: 90 } } as never)).toThrow(/on or off/i);
    expect(clock.getSettings().autosave).toEqual({ enabled: false, intervalSeconds: 10 }); // neither throw wrote
  });

  /** The autosave read guard: a stored value JavaScript cannot represent throws on the whole row read. */
  it("reads a hand-edited autosave value as the default rather than propagating it", async () => {
    const path = join(clockDirectory, "vtt.sqlite");
    clock.close();
    const write = (sql: string, ...values: Array<number | bigint>) => {
      const database = new DatabaseSync(path);
      database.prepare(sql).run(...values);
      database.close();
    };
    const reopen = async () => { const reopened = new CodexStore(path, () => now); await reopened.initialize(); return reopened; };

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
    // `enabled` fails open, like revision history: a garbled value must not stop the editors saving. 0 is
    // still honoured.
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

  // A type change prunes undeclared fields, and the confirm dialog promises History can restore them, so a
  // type change forces a checkpoint even inside the window. Ordinary saves still coalesce.
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

    // ...and restoring brings the pruned field back, as the confirm dialog promises.
    const restored = clock.restoreRevision(page.id, revisions[0]!.id, "gm");
    expect(restored.entityType).toBe("character");
    expect(restored.fields.role).toBe("the devil");
  });

  // The switch still wins: with history disabled, a type change writes no revision. `revisionDue` checks the
  // switch before the force.
  it("writes no forced checkpoint for a type change when history is switched off", () => {
    at(0);
    const page = clock.createPage({ title: "Ireena", entityType: "character" });
    clock.setSettings({ revisionHistory: { enabled: false, windowMinutes: 90 }, autosave: AUTOSAVE_DEFAULT });
    const before = clock.listRevisions(page.id).length;
    at(1);
    clock.updatePage(page.id, { entityType: "location" }, undefined, "gm");
    expect(clock.listRevisions(page.id)).toHaveLength(before);
  });

  // The settings migration on a real pre-migration database holding a page and two revision rows as the old
  // code wrote them (new-state snapshots, `authored_at` from `updated_at`).
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
      expect((database.prepare("PRAGMA table_info(codex_meta)").all() as Array<{ name: string }>).map((row) => row.name))
        .not.toContain("revision_window_minutes");
      database.close();

      at(0);
      upgraded = new CodexStore(path, () => now);
      await upgraded.initialize();

      // The migration applied and its defaults landed on the existing meta row: history stays on and gains the
      // 90-minute window.
      const applied = new DatabaseSync(path);
      expect((applied.prepare("SELECT version FROM codex_schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((row) => row.version))
        .toEqual(MIGRATIONS.map((migration) => migration.version));
      expect(applied.prepare("SELECT revision_history_enabled AS enabled, revision_window_minutes AS window FROM codex_meta WHERE id = 1").get())
        .toMatchObject({ enabled: 1, window: 90 });
      applied.close();
      expect(upgraded.getSettings().revisionHistory).toMatchObject({ enabled: true, windowMinutes: 90 });
      expect(upgraded.getSettings().revisionHistory.versionCount).toBe(2);
      expect(upgraded.getSettings().revisionHistory.versionBytes).toBeGreaterThan(0);

      // Every pre-existing revision survives untouched, in order.
      expect(upgraded.listRevisions(pageId).map((row) => ({ rev: row.rev, playerBody: row.playerBody })))
        .toEqual([{ rev: 2, playerBody: "v2" }, { rev: 1, playerBody: "v1" }]);
      const oldest = upgraded.listRevisions(pageId)[1];
      expect(upgraded.restoreRevision(pageId, oldest.id, "gm").playerBody).toBe("v1");

      // The window applies immediately against the legacy rows' `authored_at`: the newest was authored 30
      // minutes ago, so the restore above (a save) coalesced into it...
      expect(upgraded.listRevisions(pageId)).toHaveLength(2);
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

// The revision usage figures and the delete, tested together because they are one loop in use (read the
// cost, trim, read again), and only reading the figures could not tell a real count from a constant.
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
    // Every save checkpointed, so a test can build a history of known depth without moving the clock.
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
    // The first edit adds nothing: its prior state is rev 1, already checkpointed, so `revisionExistsAt`
    // suppresses the duplicate. A second edit adds a row.
    pruner.updatePage(first.id, { playerBody: "klmno" }, undefined, "gm");
    pruner.updatePage(first.id, { playerBody: "pqrst" }, undefined, "gm");                        // 1 more
    // Three rows across two pages: a per-page count or a page-table count would read 2.
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(3);
    expect(pruner.listRevisions(first.id)).toHaveLength(2);
    expect(pruner.listRevisions(second.id)).toHaveLength(1);

    // `versionBytes` sums the content columns a revision duplicates: title, both bodies, both field maps and
    // tags. Computed from the inputs so the assertion names the summed columns.
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
    expect(after).toMatchObject({ enabled: true, windowMinutes: 0 });
  });

  // `olderThanDays: 0` deletes everything by ordinary arithmetic (nothing is younger than zero days), not a
  // special case, so the boundary is asserted on both sides.
  it("deletes EVERY revision at olderThanDays 0, by ordinary arithmetic", () => {
    const page = pruner.createPage({ title: "Argynvostholt", playerBody: "v0" });
    // Three edits: the first one's prior state duplicates the creation checkpoint and is suppressed.
    pruner.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    pruner.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    pruner.updatePage(page.id, { playerBody: "v3" }, undefined, "gm");
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(3);

    expect(pruner.deleteRevisionsOlderThan(0)).toBe(3);
    expect(pruner.listRevisions(page.id)).toEqual([]);
    // A second call finds nothing and returns 0: idempotent, and `deleted` is a real count.
    expect(pruner.deleteRevisionsOlderThan(0)).toBe(0);
  });

  it("leaves the NEWER rows alone, and reports the real number it removed", () => {
    // Four checkpoints authored on four different days: the page is saved once a day for four days.
    const page = pruner.createPage({ title: "Tser Pool", playerBody: "day-0" });
    // A second day-0 save, so day 0 holds two checkpoints (the creation plus the state this edit displaces)
    // and the inclusive boundary below has two rows to delete.
    pruner.updatePage(page.id, { playerBody: "day-0 again" }, undefined, "gm");
    for (const day of [1, 2, 3]) { atDays(day); pruner.updatePage(page.id, { playerBody: `day-${day}` }, undefined, "gm"); }
    atDays(3);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2", "day-1", "day-0 again", "day-0"]);

    // From day 3, "older than 3 days" cuts at day 0 inclusive: both day-0 checkpoints go and the survivors are
    // asserted, not just the count.
    expect(pruner.deleteRevisionsOlderThan(3)).toBe(2);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2", "day-1"]);
    expect(pruner.getSettings().revisionHistory.versionCount).toBe(2);

    // A narrower cut takes exactly one more row, so age is per row.
    expect(pruner.deleteRevisionsOlderThan(2)).toBe(1);
    expect(pruner.listRevisions(page.id).map((row) => row.playerBody)).toEqual(["day-2"]);

    expect(pruner.deleteRevisionsOlderThan(365)).toBe(0);
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
  });

  /** Deleting revisions never touches `codex_pages`: bodies, typed fields and `rev` all survive. */
  it("never touches codex_pages — bodies, fields and rev all survive a delete-everything", () => {
    // A `character`, because `goals` is one of its secret fields; a `location` would arrive with `gmFields`
    // already empty and prove nothing.
    const page = pruner.createPage({ title: "Madam Eva", entityType: "character", fields: { race: "Vistani" }, gmFields: { goals: "watch the road" }, playerBody: "wagons", gmBody: "they know Strahd" });
    pruner.updatePage(page.id, { playerBody: "wagons and horses" }, undefined, "gm");
    const beforePage = pruner.getPage(page.id)!;
    const beforeCount = pruner.listPages().length;

    // One revision: the creation checkpoint. The edit's prior state is rev 1, already captured.
    expect(pruner.deleteRevisionsOlderThan(0)).toBe(1);

    expect(pruner.getPage(page.id)).toEqual(beforePage);   // every column, including `rev` and `updatedAt`
    expect(pruner.getPage(page.id)!.playerBody).toBe("wagons and horses");
    expect(pruner.getPage(page.id)!.gmBody).toBe("they know Strahd");
    expect(pruner.getPage(page.id)!.gmFields).toEqual({ goals: "watch the road" });
    expect(pruner.getPage(page.id)!.rev).toBe(2);
    expect(pruner.listPages()).toHaveLength(beforeCount);
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

  // Rejected, not clamped, unlike `windowMinutes`: this is the one destructive route in the codex, and a
  // malformed destructive request must not be interpreted generously.
  it("rejects a negative, fractional or absurd age rather than clamping it, and deletes nothing when it does", () => {
    const page = pruner.createPage({ title: "Yester Hill", playerBody: "v0" });
    for (const bad of [-1, 3.5, Number.NaN, Number.POSITIVE_INFINITY, 36_501]) {
      expect(() => pruner.deleteRevisionsOlderThan(bad), `olderThanDays ${bad}`).toThrow(/whole number of days/i);
    }
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
    // The upper bound is a guard: 36500 is accepted and matches nothing, whereas an unbounded value would push
    // the cutoff out of range and throw `RangeError: Invalid time value`.
    expect(pruner.deleteRevisionsOlderThan(36_500)).toBe(0);
    expect(pruner.listRevisions(page.id)).toHaveLength(1);
  });
});

// ETags (`W/"codex-r{revision}-{grade}"`) are correct only while every public write bumps the revision. This
// walks the write surface and asserts strict increase per call; a new public write belongs in this list.
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

    // Non-vacuity: the walk covered the surface.
    expect(seen.length).toBeGreaterThanOrEqual(40);
  });
});

// Sessions join the suite-wide search index, a three-gate viewer-safety change (see `CodexRecordKind`).
// The index-text gate has no second line of defence, so each gate is asserted at its own layer.
describe("CodexStore search — sessions join the one index (D10, three gates)", () => {
  const seed = () => store.createSession({
    sessionNumber: 4, realDate: "2026-07-30", tags: ["ravenloft"],
    prepBody: "The ambush is at the bridge; Ireena is the real target.",
    recapBody: "The party crossed the bridge.",
    attendees: ["Ozy", "Mara"]
  });

  it("GATE 1 — prep and attendees never enter the PLAYER index, even for a revealed session", () => {
    const session = store.setSessionRevealed(seed().id, true);
    expect(store.searchAll("gm", "ambush").hits.some((hit) => hit.id === session.id)).toBe(true);
    expect(store.searchAll("gm", "Mara").hits.some((hit) => hit.id === session.id)).toBe(true);
    // The player cannot, and the session is revealed, so the SQL and projection gates both pass it. The hit's
    // existence alone would be the leak.
    expect(store.searchAll("player", "ambush").hits).toEqual([]);
    expect(store.searchAll("player", "Mara").hits).toEqual([]);
    // Non-vacuity: the player index holds this session by its recap, date and tags.
    for (const query of ["crossed", "2026-07-30", "ravenloft"]) {
      expect(store.searchAll("player", query).hits.some((hit) => hit.kind === "session" && hit.id === session.id), query).toBe(true);
    }
  });

  it("GATE 2 — the SQL predicate hides an UNREVEALED session from a player, below any projection", () => {
    const session = seed();
    // Called directly with no projection in front: the layer an HTTP test cannot see.
    expect(store.searchAll("player", "crossed").hits).toEqual([]);
    expect(store.searchAll("gm", "crossed").hits.some((hit) => hit.id === session.id)).toBe(true);
    store.setSessionRevealed(session.id, true);
    // Revealing needs no reindex: reveal is resolved at read time.
    expect(store.searchAll("player", "crossed").hits.some((hit) => hit.id === session.id)).toBe(true);
  });

  it("GATE 3 — the projection arm refuses an unrevealed session even when the SQL layer passes it", () => {
    const session = seed();
    // Constructed by hand, as the SQL layer would hand it over if its gate were weakened.
    expect(projectPlayerSearchHit({ kind: "session", session }, playerSessionNumbers())).toBeNull();
    expect(projectGmSearchHit({ kind: "session", session })).toMatchObject({ kind: "session", id: session.id, title: "Session 4" });
    const revealed = store.setSessionRevealed(session.id, true);
    const hit = projectPlayerSearchHit({ kind: "session", session: revealed }, playerSessionNumbers())!;
    expect(Object.keys(hit).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(hit.tags).toEqual(["ravenloft"]);
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
    // An empty title would render as an unclickable blank row on the reveal audit.
    expect(title(empty)).toBe("Untitled session");
    const auditTitles = projectRevealAudit([numbered, recapOnly, empty].map((session) => ({ kind: "session" as const, session })))
      .sections.find((section) => section.kind === "session")!.rows.map((row) => row.title);
    expect(auditTitles.sort()).toEqual(["Session 4", "The party crossed the bridge.", "Untitled session"]);
  });

  it("round-trips tags on sessions and quests, and finds both by tag in both audiences", () => {
    const session = store.setSessionRevealed(store.createSession({ sessionNumber: 1, recapBody: "We began.", tags: ["Ravenloft", " ravenloft ", "arc-one"] }).id, true);
    expect(session.tags).toEqual(["ravenloft", "arc-one"]);
    const quest = store.setQuestRevealed(store.createQuest({ title: "Find the Sunsword", tags: ["arc-one"] }).id, true);
    expect(quest.tags).toEqual(["arc-one"]);

    for (const audience of ["gm", "player"] as const) {
      const ids = store.searchAll(audience, "arc-one").hits.map((hit) => hit.id);
      expect(ids, audience).toContain(session.id);
      expect(ids, audience).toContain(quest.id);
    }
    // Editing the tags keeps the index in step; the reindex is in the same transaction as the write.
    store.updateSession(session.id, { tags: ["arc-two"] }, undefined, "gm");
    expect(store.searchAll("gm", "arc-one").hits.map((hit) => hit.id)).not.toContain(session.id);
    expect(store.searchAll("gm", "arc-two").hits.map((hit) => hit.id)).toContain(session.id);
    store.deleteSession(session.id);
    expect(store.searchAll("gm", "arc-two").hits.map((hit) => hit.id)).not.toContain(session.id);
  });

  /** The result cap is signalled: 51 matches give 50 hits and `truncated: true`; 50 give no flag. */
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

// A player chronicle row carries the server's `calendarInstant` alongside `inWorldDate`, so the client never
// re-derives it (and diverges on a day that overflows its month).
describe("Codex chronicle — a player's machine-readable dates (D17, R3)", () => {
  it("carries both date forms on a revealed dated row, and the instant is the server's own clamped one", () => {
    // A 30-day month and a date on day 31 of it.
    store.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["First", "Second"], currentDate: { year: 1492, month: 1, day: 1 } });
    const entry = store.createEntry({ playerText: "The siege begins.", revealedToPlayers: true, inWorldDate: { year: 1492, month: 0, day: 31 } });
    const record = { kind: "entry" as const, entry: store.getEntry(entry.id)! };

    const player = projectPlayerChronicleRecord(record, playerSessionNumbers())!;
    const gm = projectGmChronicleRecord(record);
    expect(player.inWorldDate, "the RAW date the GM typed, unclamped - it is the source of truth (K3)").toEqual({ year: 1492, month: 0, day: 31 });
    // The instant is the server's, identical to the GM's, so both audiences place the row on the same day.
    expect(player.calendarInstant).toBe(gm.calendarInstant);
    expect(typeof player.calendarInstant).toBe("number");
    expect(player.inWorldLabel).toBe(gm.inWorldLabel);

    // Undated rows carry null for both, never an absent key.
    const undated = store.createEntry({ playerText: "Timeless.", revealedToPlayers: true });
    const undatedRow = projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(undated.id)! }, playerSessionNumbers())!;
    expect(undatedRow.inWorldDate).toBeNull();
    expect(undatedRow.calendarInstant).toBeNull();

    // The GM's clock is still not on the player row: the fields describe the record's date, and `fired` is
    // measured against the published date.
    expect(Object.keys(undatedRow)).not.toContain("proposedDate");
    expect(Object.keys(undatedRow)).not.toContain("campaignInstant");
  });
});

/** Downtime linked to a character page, so the tracker totals a person rather than a spelling of a name. */
describe("CodexStore downtime — the character link (D12)", () => {
  it("round-trips the link, keeps it through applyDowntime, and refuses an id that names no page", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 0, day: 1 } });
    const entry = store.createDowntime({ playerText: "A month at the forge.", downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    expect(downtimePayloadOf(entry)).toEqual({ who: "Ireena", activity: "Forging", days: 30, applied: false, characterPageId: character.id });

    // `applyDowntime` rewrites the payload to flip `applied`; the link must survive.
    const applied = store.applyDowntime(entry.id).entry;
    expect(downtimePayloadOf(applied)).toEqual({ who: "Ireena", activity: "Forging", days: 30, applied: true, characterPageId: character.id });

    // An id naming no page is not-found, not a dangling link.
    expect(() => store.createDowntime({ playerText: "Nobody.", downtime: { who: "?", activity: "?", days: 1, characterPageId: crypto.randomUUID() } })).toThrow(/no longer exists/i);
    expect(downtimePayloadOf(store.createDowntime({ playerText: "A hireling.", downtime: { who: "Gustav", activity: "Watching the cart", days: 2 } }))!.characterPageId).toBeNull();
    // ...and a non-character page is accepted: a GM may track downtime for an NPC.
    const npc = store.createPage({ title: "The Burgomaster", entityType: "note" });
    expect(downtimePayloadOf(store.createDowntime({ playerText: "Politics.", downtime: { who: "Ismark", activity: "Talking", days: 3, characterPageId: npc.id } }))!.characterPageId).toBe(npc.id);
  });

  it("reads a payload written before the field existed as `characterPageId: null` — the parser IS the migration", () => {
    const entry = store.createDowntime({ playerText: "Old row.", downtime: { who: "Vex", activity: "Brewing", days: 5 } });
    // Rewrite the blob to the shape without `characterPageId`, as an upgraded database holds it.
    const database = new DatabaseSync(join(directory, "vtt.sqlite"));
    database.prepare("UPDATE codex_journal SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({ who: "Vex", activity: "Brewing", days: 5, applied: false }), entry.id);
    database.close();

    // The wire promises the key is always present; the defensive reader supplies it, so old payloads need no sweep.
    expect(downtimePayloadOf(store.getEntry(entry.id)!)).toEqual({ who: "Vex", activity: "Brewing", days: 5, applied: false, characterPageId: null });
  });

  it("nulls the link when the page is deleted, and keeps the record and its free-text `who`", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    const entry = store.createDowntime({ playerText: "A month at the forge.", downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    const untouched = store.createDowntime({ playerText: "Someone else.", downtime: { who: "Ismark", activity: "Drilling", days: 4 } });

    store.deletePage(character.id);

    // The record survives its page, and the link is nulled rather than left dangling.
    const after = downtimePayloadOf(store.getEntry(entry.id)!)!;
    expect(after.characterPageId).toBeNull();
    expect(after.who, "the free-text fallback is what the row shows now").toBe("Ireena");
    expect(after.days).toBe(30);
    expect(downtimePayloadOf(store.getEntry(untouched.id)!)).toEqual({ who: "Ismark", activity: "Drilling", days: 4, applied: false, characterPageId: null });
  });

  it("carries the link to a player only when that page is revealed, and never hides the row for it", () => {
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    const entry = store.createDowntime({ playerText: "A month at the forge.", revealedToPlayers: true, downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: character.id } });
    const record = { kind: "entry" as const, entry: store.getEntry(entry.id)! };
    const context = (revealed: readonly string[]) => ({ unrevealedSessionIds: new Set<string>(), revealedPageIds: new Set(revealed) });

    // Page hidden: the link is nulled and the row still travels. A `standing` record is hidden whole instead,
    // because it has no prose of its own.
    const gated = projectPlayerChronicleRecord(record, context([]))!;
    expect(gated.payload).toEqual({ who: "Ireena", activity: "Forging", days: 30, characterPageId: null });
    expect(gated.text).toBe("A month at the forge.");

    // Page revealed: the link travels, since the player can already open that page.
    const shown = projectPlayerChronicleRecord(record, context([character.id]))!;
    expect((shown.payload as { characterPageId: string | null }).characterPageId).toBe(character.id);
    // Absent context fails closed: a caller that forgets to resolve the set loses a link, never leaks one.
    expect((projectPlayerChronicleRecord(record, { unrevealedSessionIds: new Set<string>() })!.payload as { characterPageId: string | null }).characterPageId).toBeNull();
    expect(Object.keys(shown.payload!).sort()).toEqual(["activity", "characterPageId", "days", "who"]);
  });
});

/** Quest status changes write themselves onto the journal, so the timeline answers "what happened to that lead?". */
describe("CodexStore quest history (D11, R5)", () => {
  const questRecords = () => store.listTimeline().filter((entry) => entry.kind === "quest");

  it("records a quest's START on create, and every STATUS CHANGE after it — never a prose edit", () => {
    store.setCalendar({ ...store.getCalendar(), currentDate: { year: 1492, month: 1, day: 12 } });
    const session = store.createSession({ sessionNumber: 3 });
    store.setActiveSession(session.id);

    const quest = store.createQuest({ title: "Find the Sunsword" });
    expect(questRecords(), "R5: a quest ENTERING THE LOG is an event, and every quest enters at creation").toHaveLength(1);
    const start = questRecords()[0]!;
    // The status reached is the default `not-started`: writing a lead down is not the party taking it up.
    expect(questEventPayloadOf(start)).toEqual({ questId: quest.id, status: "not-started" });
    // Hidden, with empty player text, which is why the projection hides the whole row rather than a field.
    expect(start.revealedToPlayers).toBe(false);
    expect(start.playerText).toBe("");
    // Dated at the GM's clock and filed under the active session, as every auto-written record is.
    expect(start.inWorldDate).toEqual({ year: 1492, month: 1, day: 12 });
    expect(start.sessionId).toBe(session.id);

    // A prose edit writes nothing: it is not something that happened in the world.
    store.updateQuest(quest.id, { playerBody: "Search the crypt." }, undefined);
    store.updateQuest(quest.id, { title: "Find the Sunsword, urgently" }, undefined);
    expect(questRecords()).toHaveLength(1);

    // A status change writes exactly one, carrying the status reached.
    store.updateQuest(quest.id, { status: "completed" }, undefined);
    expect(questRecords()).toHaveLength(2);
    expect(questEventPayloadOf(questRecords()[1]!)).toEqual({ questId: quest.id, status: "completed" });
    // Re-stating the same status writes nothing.
    store.updateQuest(quest.id, { status: "completed", playerBody: "Done." }, undefined);
    expect(questRecords()).toHaveLength(2);
    // Re-activating records `active`; a reader words it "reopened" from the sequence.
    store.updateQuest(quest.id, { status: "active" }, undefined);
    expect(questEventPayloadOf(questRecords()[2]!)!.status).toBe("active");

    // History outlives the quest.
    store.deleteQuest(quest.id);
    expect(questRecords()).toHaveLength(3);
    expect(questEventPayloadOf(questRecords()[0]!)!.questId).toBe(quest.id);   // a name they cannot show
  });

  it("writes the record in the SAME transaction as the quest, so neither can exist without the other", () => {
    // A failure inside the composed write must roll both halves back; an oversized title makes the entry half
    // throw after the quest INSERT in the same `BEGIN IMMEDIATE`.
    const before = store.listQuests().length;
    const quest = store.createQuest({ title: "Free Ireena" });
    expect(store.listQuests()).toHaveLength(before + 1);
    expect(questRecords()).toHaveLength(1);

    // A partial UNIQUE index makes a second quest record impossible, so the history INSERT throws after the
    // quest UPDATE has run inside the same transaction.
    const database = new DatabaseSync(join(directory, "vtt.sqlite"));
    database.exec("CREATE UNIQUE INDEX probe_one_quest_record ON codex_journal (kind) WHERE kind = 'quest';");
    database.close();

    expect(() => store.updateQuest(quest.id, { status: "failed" }, undefined)).toThrow();
    expect(store.getQuest(quest.id)!.status, "the quest UPDATE rolled back with the entry INSERT").toBe("not-started");
    expect(questRecords(), "...and no second history record was left behind either").toHaveLength(1);
    // ...and a quest create rolls back the same way: no quest survives its own failed start record.
    const questCount = store.listQuests().length;
    expect(() => store.createQuest({ title: "Escape Barovia" })).toThrow();
    expect(store.listQuests()).toHaveLength(questCount);
  });

  it("hides a quest record WHOLE from a player until the quest itself is revealed", () => {
    const quest = store.createQuest({ title: "Find the Sunsword" });
    const record = questRecords()[0]!;
    // Even revealed, the record must not travel while the quest is secret: with no prose, it would announce a
    // quest the player has never heard of.
    store.setEntryRevealed(record.id, true);
    const context = (revealedQuestIds: readonly string[]) => ({ unrevealedSessionIds: new Set<string>(), revealedQuestIds: new Set(revealedQuestIds) });
    expect(projectPlayerJournalEntry(store.getEntry(record.id)!, context([]))).toBeNull();
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(record.id)! }, context([]))).toBeNull();
    expect(projectGmChronicleRecord({ kind: "entry", entry: store.getEntry(record.id)! }).payload).toEqual({ questId: quest.id, status: "not-started" });

    // Absent context fails closed: a caller that forgets to resolve the set hides history, never leaks it.
    expect(projectPlayerJournalEntry(store.getEntry(record.id)!, { unrevealedSessionIds: new Set<string>() })).toBeNull();

    // Reveal the quest and the row travels, carrying its status.
    store.setQuestRevealed(quest.id, true);
    const shown = projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(record.id)! }, context([quest.id]))!;
    expect(shown.kind).toBe("quest");
    expect(shown.payload).toEqual({ questId: quest.id, status: "not-started" });
    // ...and the entry's own reveal flag still gates it, so both must hold.
    store.setEntryRevealed(record.id, false);
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: store.getEntry(record.id)! }, context([quest.id]))).toBeNull();
  });

  it("keeps quest history out of a player's SEARCH and reveal audit by the same one gate", () => {
    const quest = store.createQuest({ title: "Find the Sunsword" });
    const record = store.setEntryRevealed(questRecords()[0]!.id, true);
    const context = (revealedQuestIds: readonly string[]) => ({ unrevealedSessionIds: new Set<string>(), revealedQuestIds: new Set(revealedQuestIds) });
    // The gate lives on `projectPlayerJournalEntry`, so search and the audit inherit it by construction.
    const auditRows = (sessionContext: ReturnType<typeof context>) =>
      projectRevealAudit([{ kind: "journal", entry: store.getEntry(record.id)!, sessionContext }]).sections.find((section) => section.kind === "journal")!.rows;
    expect(projectPlayerSearchHit({ kind: "journal", entry: record }, context([]))).toBeNull();
    expect(auditRows(context([]))).toEqual([]);
    store.setQuestRevealed(quest.id, true);
    expect(projectPlayerSearchHit({ kind: "journal", entry: store.getEntry(record.id)! }, context([quest.id]))).not.toBeNull();
    // A quest record has no prose, so `excerpt(text)` is "" and `AUDIT_JOURNAL_FALLBACK` names the kind instead.
    expect(auditRows(context([quest.id]))[0]).toMatchObject({ journalKind: "quest", title: "Quest updated" });
  });

  it("degrades a malformed stored payload to defaults rather than throwing", () => {
    const quest = store.createQuest({ title: "Find the Sunsword" });
    const record = questRecords()[0]!;
    const database = new DatabaseSync(join(directory, "vtt.sqlite"));
    database.prepare("UPDATE codex_journal SET payload_json = ? WHERE id = ?").run('{"questId": 7, "status": "exploded"}', record.id);
    database.close();
    // Fails closed on both fields: a non-string id becomes "" (matching no revealed quest) and an unknown
    // status reads as `active`.
    expect(questEventPayloadOf(store.getEntry(record.id)!)).toEqual({ questId: "", status: "active" });
    expect(projectPlayerJournalEntry(store.setEntryRevealed(record.id, true), { unrevealedSessionIds: new Set<string>(), revealedQuestIds: new Set([quest.id]) })).toBeNull();
  });
});

// Backup and restore: a round trip is lossless, a bad bundle leaves the codex exactly as it was, and a
// backup from before restore existed still restores.
describe("CodexStore import — replace, all-or-nothing (D16)", () => {
  /** A codex with one of everything, so a round trip has something to lose. */
  const populate = () => {
    store.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["First", "Second"], currentDate: { year: 1492, month: 1, day: 12 } });
    store.publishCampaignDate();
    const faction = store.createPage({ title: "The Harpers", entityType: "faction", playerBody: "Meddlers.", gmBody: "Compromised.", tags: ["faction"], folder: "Factions" });
    const place = store.createPage({ title: "Vallaki", entityType: "location", playerBody: "A walled town. See [[The Harpers]].", revealedToPlayers: true, inWorldDate: null });
    store.createConnection(place.id, { toPageId: faction.id, label: "watched by", layer: "gm" });
    store.setStanding(faction.id, -40, "Killed their envoy");
    const map = store.createMap({ assetId: crypto.randomUUID(), name: "Barovia", kind: "regional", tags: ["realm"] });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label: "Vallaki", pageIds: [place.id], tags: ["stop"] });
    store.setPartyMarker(marker.id);
    const session = store.createSession({ sessionNumber: 4, prepBody: "The ambush.", recapBody: "They crossed.", attendees: ["Ozy"], tags: ["arc-one"] });
    store.setActiveSession(session.id);
    store.createQuest({ title: "Find the Sunsword", playerBody: "Search the crypt.", gmBody: "It is a fake.", tags: ["main"] });
    store.createEntry({ playerText: "We arrived in [[Vallaki]].", gmText: "Strahd watched.", tags: ["travel"], revealedToPlayers: true });
    store.createDowntime({ playerText: "A month forging.", downtime: { who: "Ireena", activity: "Forging", days: 30, characterPageId: faction.id } });
    store.updatePage(place.id, { playerBody: "A walled town, and a wall." }, undefined, "gm");   // a revision to carry
    return { faction, place, map, marker, session };
  };

  it("round-trips a whole codex: export, wipe, import, and the bundle comes back the same", () => {
    populate();
    const before = store.exportBundle();
    const beforeJson = JSON.stringify(before);

    // Wipe by importing an explicitly empty bundle first, so the restore below provably does the work.
    // `{ pages: [] }` is an empty campaign; `{}` has no codex sections and is refused (see below).
    store.importBundle({ pages: [] });
    expect(store.listPages()).toEqual([]);
    expect(store.listSessions()).toEqual([]);

    const counts = store.importBundle(JSON.parse(beforeJson) as unknown);
    // 4 journal rows: the note, the downtime, `setStanding`'s record and `createQuest`'s start record.
    expect(counts).toEqual({ pages: 2, folders: 1, maps: 1, markers: 1, journal: 4, connections: 1, sessions: 1, quests: 1, standing: 1, revisions: expect.any(Number) });
    expect(counts.revisions).toBeGreaterThan(0);
    // The bundle is byte-identical on the way back out: every id, timestamp, rev, both bodies, the calendar
    // and both clocks.
    expect(JSON.stringify(store.exportBundle())).toBe(beforeJson);

    // ...and the codex works afterwards: revision restore resolves by the preserved integer ids, so a saved
    // `.../revisions/{id}/restore` URL survives a restore.
    const pageWithHistory = store.listPages().find((page) => page.title === "Vallaki")!;
    const revision = store.listRevisions(pageWithHistory.id).at(-1)!;
    expect(store.restoreRevision(pageWithHistory.id, revision.id, "gm").playerBody).toContain("A walled town");
    // Derived link rows were rebuilt, not restored from a stale copy.
    expect(store.listAllConnections().some((edge) => edge.origin === "mention")).toBe(true);
    // The search index was rebuilt too, and prep stays GM-only.
    expect(store.searchAll("gm", "ambush").hits.some((hit) => hit.kind === "session")).toBe(true);
    expect(store.searchAll("player", "ambush").hits).toEqual([]);
  });

  it("writes NOTHING when a bundle is bad — the codex is exactly as it was", () => {
    populate();
    const before = JSON.stringify(store.exportBundle());
    const revisionBefore = store.revision;

    const bundle = JSON.parse(before) as { pages: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>> };
    // A record that fails validation mid-bundle; without one transaction the pages before it would already
    // be inserted.
    const corrupt = { ...bundle, pages: [...bundle.pages, { ...bundle.pages[0], id: "not-a-uuid" }] };
    expect(() => store.importBundle(corrupt)).toThrow();
    expect(JSON.stringify(store.exportBundle()), "row for row, the codex is untouched").toBe(before);
    expect(store.revision, "...and nothing bumped the revision, so no client was told to refetch").toBe(revisionBefore);

    // The cross-record invariants are refused up front with copy a GM can act on, not as a mid-transaction
    // constraint failure.
    expect(() => store.importBundle({ ...bundle, sessions: [{ ...bundle.sessions[0], id: crypto.randomUUID() }, { ...bundle.sessions[0], id: crypto.randomUUID() }] })).toThrow(/same number/i);
    expect(JSON.stringify(store.exportBundle())).toBe(before);
  });

  // Import rolls back a failure after the wipe. Validation errors throw before `BEGIN`, so a probe constraint
  // (a UNIQUE index on `codex_pages(title)`) forces an INSERT failure inside the transaction.
  it("rolls back a failure that happens AFTER the wipe, not merely one that happens before it", () => {
    populate();
    const before = JSON.stringify(store.exportBundle());
    const revisionBefore = store.revision;
    const bundle = JSON.parse(before) as { pages: Array<Record<string, unknown>> };
    expect(bundle.pages.length, "the wipe must have something to destroy for this to mean anything").toBeGreaterThan(1);

    const probe = new DatabaseSync(join(directory, "vtt.sqlite"));
    probe.exec("CREATE UNIQUE INDEX probe_page_title ON codex_pages (title);");
    probe.close();

    // Valid to every validator and fatal to the probe index on the third page insert, after `DELETE FROM`
    // has emptied every table.
    const collide = { ...bundle, pages: [...bundle.pages, { ...bundle.pages[0], id: crypto.randomUUID() }] };
    expect(() => store.importBundle(collide)).toThrow(/UNIQUE constraint failed: codex_pages\.title/);

    expect(JSON.stringify(store.exportBundle()), "row for row, the codex survived a failure mid-restore").toBe(before);
    expect(store.revision, "...and nothing bumped the revision, so no client was told to refetch").toBe(revisionBefore);
  });

  // An empty campaign (`"pages": []`) restores; a file with no recognised keys is refused, since a restore
  // replaces the codex. Each refusal is checked to have written nothing.
  it("refuses a bundle with no recognised sections, and still restores a genuinely empty campaign", () => {
    populate();
    const before = JSON.stringify(store.exportBundle());
    const revisionBefore = store.revision;

    for (const bad of [{}, { notes: [] }, { Pages: [] }, { pagez: [{ id: crypto.randomUUID() }] }]) {
      expect(() => store.importBundle(bad), JSON.stringify(bad)).toThrow(/no codex sections|does not recognise/i);
      expect(JSON.stringify(store.exportBundle()), `${JSON.stringify(bad)} must write nothing`).toBe(before);
      expect(store.revision).toBe(revisionBefore);
    }
    // A mistyped section is named, so the GM can fix it.
    expect(() => store.importBundle({ pagez: [] })).toThrow(/"pagez"/);
    // A recognised section that is not a list is refused by name too, rather than counting as zero records.
    expect(() => store.importBundle({ pages: { id: "x" } })).toThrow(/"pages" section is not a list/);
    expect(JSON.stringify(store.exportBundle())).toBe(before);

    // ...and a genuinely empty campaign still restores.
    expect(store.importBundle({ pages: [] })).toMatchObject({ pages: 0, journal: 0, sessions: 0 });
    expect(store.listPages()).toEqual([]);
  });

  // Cross-record refusals name the section in plain language. Otherwise the insert loop would hit the
  // constraint after the wipe, with only the driver's text ("UNIQUE constraint failed: codex_pages.id").
  it("names the section and the value when a bundle breaks a database constraint", () => {
    populate();
    const before = JSON.stringify(store.exportBundle());
    const bundle = JSON.parse(before) as Record<string, Array<Record<string, unknown>>>;
    const cases: ReadonlyArray<readonly [Record<string, unknown>, RegExp]> = [
      [{ ...bundle, pages: [...bundle.pages, { ...bundle.pages[0] }] }, /two "pages" records with the same id/],
      [{ ...bundle, markers: [{ ...bundle.markers[0], mapId: crypto.randomUUID() }] }, /"markers" section names a map the file does not contain/],
      [{ ...bundle, relationships: [{ ...bundle.relationships[0], toPageId: crypto.randomUUID() }] }, /"relationships" section names a page the file does not contain/],
      [{ ...bundle, standing: [{ ...bundle.standing[0], factionPageId: crypto.randomUUID() }] }, /"standing" section names a faction page the file does not contain/],
      [{ ...bundle, revisions: [{ ...bundle.revisions[0], pageId: crypto.randomUUID() }] }, /"revisions" section names a page the file does not contain/],
      [{ ...bundle, pages: [{ ...bundle.pages[0], id: "not-a-uuid" }] }, /"pages" entry 1 is not valid: Codex id is malformed/]
    ];
    for (const [bad, message] of cases) {
      expect(() => store.importBundle(bad), message.source).toThrow(message);
      expect(JSON.stringify(store.exportBundle()), `${message.source} must write nothing`).toBe(before);
    }
    for (const [bad] of cases) {
      try { store.importBundle(bad); } catch (error) { expect((error as Error).message).not.toMatch(/constraint failed|codex_[a-z_]+\./i); }
    }
  });

  // `deleteSession` leaves a bare label (`{sessionId: null, sessionNumber: 4}`) on a revealed session's entries.
  // Import must not mint a hidden "Session 4" for it, or players would lose the label.
  it("keeps R2's bare session label through a round trip, and mints no phantom session for it", () => {
    const session = store.createSession({ sessionNumber: 4 });
    store.setSessionRevealed(session.id, true);
    const entry = store.createEntry({ playerText: "We crossed the bridge.", sessionId: session.id, revealedToPlayers: true });
    store.deleteSession(session.id);
    expect(store.getEntry(entry.id), "R2's stamp-back is the state under test").toMatchObject({ sessionId: null, sessionNumber: 4 });

    const before = store.exportBundle();
    store.importBundle(JSON.parse(JSON.stringify(before)) as unknown);

    expect(store.getEntry(entry.id), "the label came back as a label, not as a join").toMatchObject({ sessionId: null, sessionNumber: 4 });
    expect(store.listSessions(), "no phantom session was minted for the label").toEqual([]);
    // Those two sections compare byte for byte (not the whole bundle: an unset calendar's `currentDate` key
    // differs between first and second export).
    const after = store.exportBundle();
    expect(JSON.stringify(after.journal)).toBe(JSON.stringify(before.journal));
    expect(JSON.stringify(after.sessions)).toBe(JSON.stringify(before.sessions));
    // The label the party was already shown still reaches them.
    expect(projectPlayerJournalEntry(store.getEntry(entry.id)!, playerSessionNumbers())).toMatchObject({ sessionId: null, sessionNumber: 4 });
  });

  it("restores a PRE-VERSIONING bundle — the backups a GM already has (director ruling R1)", () => {
    // An older export shape: no `settings`, no `tags` on sessions or quests, no `layer` on a relationship, a
    // slug `type` rather than a label, and journal rows with a bare `sessionNumber` instead of a `sessionId`.
    const pageId = crypto.randomUUID(), otherId = crypto.randomUUID();
    const legacy = {
      pages: [
        { id: pageId, title: "Barovia", entityType: "location", fields: {}, gmFields: {}, folder: null, tags: [], playerBody: "A misty valley.", gmBody: "", revealedToPlayers: true, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: otherId, title: "Strahd", entityType: "character", fields: { race: "Vampire" }, gmFields: {}, folder: null, tags: [], playerBody: "", gmBody: "Rules [[Barovia]].", revealedToPlayers: false, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 1, createdAt: "", updatedAt: "" }
      ],
      maps: [], markers: [],
      journal: [
        { id: crypto.randomUUID(), playerText: "We arrived.", gmText: null, revealedToPlayers: true, attachMarkerId: null, attachPageId: null, kind: "note", sourceEncounterId: null, sessionNumber: 4, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, sortKey: 1, tags: [], payload: null, createdAt: "", updatedAt: "" },
        { id: crypto.randomUUID(), playerText: "And again.", gmText: null, revealedToPlayers: true, attachMarkerId: null, attachPageId: null, kind: "note", sourceEncounterId: null, sessionNumber: 9, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, sortKey: 2, tags: [], payload: null, createdAt: "", updatedAt: "" }
      ],
      relationships: [{ id: crypto.randomUUID(), fromPageId: otherId, toPageId: pageId, type: "located-in", createdAt: "" }],
      sessions: [{ id: crypto.randomUUID(), sessionNumber: 4, realDate: null, attendees: [], prepBody: "", recapBody: "We crossed.", revealedToPlayers: true, status: "played", rev: 1, createdAt: "", updatedAt: "" }],
      activeSessionId: null, quests: [], publishedDate: null, standing: [], partyMarkerId: null,
      calendar: { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: ["First"] }, folders: [], revisions: []
    };

    const counts = store.importBundle(legacy);
    // The orphan number 9 synthesized a session, the same rule the migration applies, rather than orphaning
    // the entry's number.
    expect(counts.sessions).toBe(2);
    const synthesized = store.listSessions().find((session) => session.sessionNumber === 9)!;
    expect(synthesized).toMatchObject({ status: "played", revealedToPlayers: false, prepBody: "", recapBody: "" });
    expect(store.listTimeline().map((entry) => entry.sessionNumber).sort()).toEqual([4, 9]);
    expect(store.listTimeline().every((entry) => entry.sessionId !== null), "every legacy number became a real join").toBe(true);

    // Missing keys defaulted: no tags, a `player` layer, and the settings untouched.
    expect(store.listSessions().every((session) => session.tags.length === 0)).toBe(true);
    expect(store.searchAll("gm", "Session 9").hits.map((hit) => hit.id)).toEqual([synthesized.id]);
    const edge = store.listAllConnections().find((row) => row.origin === "declared")!;
    expect(edge.layer).toBe("player");
    expect(edge.label).toBe("located in");
    expect(store.getSettings().autosave).toEqual({ enabled: true, intervalSeconds: 1 });
    // The mention in Strahd's GM body was re-extracted on the GM layer from text.
    expect(store.listAllConnections().find((row) => row.origin === "mention")).toMatchObject({ fromId: otherId, toPageId: pageId, layer: "gm" });
  });

  it("fabricates no history: an import writes no quest records and no revision snapshots", () => {
    const quest = store.createQuest({ title: "Find the Sunsword" });
    store.updateQuest(quest.id, { status: "completed" }, undefined);
    const bundle = JSON.parse(JSON.stringify(store.exportBundle())) as unknown;
    const historyBefore = store.listTimeline().filter((entry) => entry.kind === "quest").length;
    expect(historyBefore).toBe(2);

    store.importBundle(bundle);
    // Exactly the two records the bundle carried: a restore reproduces a past state, it does not replay
    // authoring events.
    expect(store.listTimeline().filter((entry) => entry.kind === "quest")).toHaveLength(2);
    expect(store.getSettings().revisionHistory.versionCount).toBe(0);
  });
});

// A codex created today has nothing to backfill, so it reports revision 0 before its first write. The
// revision is what every ETag and `codex:changed` ping derives from.
describe("a fresh codex does not run the D13 link backfill", () => {
  it("reports revision 0 before its first write, and still backfills a database that predates D13", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-fresh-"));
    const fresh = new CodexStore(join(directory, "vtt.sqlite"));
    await fresh.initialize();
    expect(fresh.revision, "nothing has happened yet").toBe(0);
    // Reopening does not sweep either: the flag is durable.
    fresh.close();
    const reopened = new CodexStore(join(directory, "vtt.sqlite"));
    await reopened.initialize();
    expect(reopened.revision).toBe(0);
    reopened.close();

    // A real pre-backfill codex (flag 0) does sweep, and finds wiki links in a session recap that no page
    // save ever extracted.
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-legacy-"));
    const seeded = new CodexStore(join(legacyDirectory, "vtt.sqlite"));
    await seeded.initialize();
    const page = seeded.createPage({ title: "Vallaki" });
    const session = seeded.createSession({ recapBody: "We reached [[Vallaki]]." });
    seeded.close();
    const raw = new DatabaseSync(join(legacyDirectory, "vtt.sqlite"));
    raw.exec("DELETE FROM codex_links; UPDATE codex_meta SET links_backfilled = 0;");
    raw.close();
    const migrated = new CodexStore(join(legacyDirectory, "vtt.sqlite"));
    await migrated.initialize();
    expect(migrated.listAllConnections().find((edge) => edge.fromId === session.id), "the sweep re-extracted the recap's link").toMatchObject({ toPageId: page.id, origin: "mention" });
    expect(migrated.revision, "...and it told every client to refetch").toBeGreaterThan(0);
    migrated.close();
    await rm(directory, { recursive: true, force: true });
    await rm(legacyDirectory, { recursive: true, force: true });
  });
});

describe("every codex write bumps the coarse revision (the ETag's one premise)", () => {
  // Every public method is a write or a read; each write must move `store.revision`, and an unclassified method
  // fails. These are the reads, plus bookkeeping methods that move nothing.
  const NOT_WRITES = new Set([
    "constructor", "initialize", "close", "recallCommand",
    // A receipt is bookkeeping about a response, not content; bumping here would invalidate every ETag a
    // second time for a write that already bumped.
    "recordCommand",
    "listFolders", "getPage", "listPages", "exportBundle", "listAllDeclaredConnections", "connectionsForPage",
    "listAllConnections", "getSettings", "listRevisions", "listAllRevisions", "searchAll", "searchPages",
    "getMap", "listMaps", "getMarker", "listMarkers", "markersForPage", "isAssetRevealedToPlayers",
    "isPageAssetVisibleToPlayers", "markerForScene", "partyMarker", "getCalendar", "getPublishedDate",
    "campaignInstant", "publishedInstant", "dateForInstant", "proposedDateFor", "getEntry", "listTimeline",
    "listDatedEventPages", "listChronicle", "listEntriesFor", "getSession", "listSessions",
    "unrevealedSessionIds", "getQuest", "listQuests", "listStanding", "getStanding", "revision",
    "activeSessionId", "downtimeCharacterPageIds"
  ]);

  /** One invocation per write, each on a store this function has just seeded for it. */
  const WRITES: Record<string, (from: CodexStore) => void> = {
    createPage: (s) => { s.createPage({ title: "New" }); },
    updatePage: (s) => { s.updatePage(s.createPage({ title: "A" }).id, { playerBody: "b" }, undefined, "gm"); },
    setPageRevealed: (s) => { s.setPageRevealed(s.createPage({ title: "A" }).id, true); },
    deletePage: (s) => { s.deletePage(s.createPage({ title: "A" }).id); },
    createFolder: (s) => { s.createFolder("Places"); },
    moveFolder: (s) => { s.createFolder("Places"); s.moveFolder("Places", "Realms"); },
    deleteFolder: (s) => { s.createFolder("Places"); s.deleteFolder("Places"); },
    importBundle: (s) => { s.importBundle({ pages: [] }); },
    createConnection: (s) => { s.createConnection(s.createPage({ title: "A" }).id, { toPageId: s.createPage({ title: "B" }).id }); },
    updateConnection: (s) => { s.updateConnection(s.createConnection(s.createPage({ title: "A" }).id, { toPageId: s.createPage({ title: "B" }).id }).id, { label: "ally of" }); },
    deleteConnection: (s) => { s.deleteConnection(s.createConnection(s.createPage({ title: "A" }).id, { toPageId: s.createPage({ title: "B" }).id }).id); },
    setSettings: (s) => { s.setSettings({ revisionHistory: { enabled: false, windowMinutes: 30 }, autosave: AUTOSAVE_DEFAULT }); },
    deleteRevisionsOlderThan: (s) => { s.deleteRevisionsOlderThan(0); },
    restoreRevision: (s) => {
      const page = s.createPage({ title: "A", playerBody: "one" });
      s.updatePage(page.id, { playerBody: "two" }, undefined, "gm");
      s.restoreRevision(page.id, s.listRevisions(page.id).at(-1)!.id, "gm");
    },
    createMap: (s) => { s.createMap({ assetId: ASSET, name: "M", kind: "world" }); },
    updateMap: (s) => { s.updateMap(s.createMap({ assetId: ASSET, name: "M", kind: "world" }).id, { name: "N" }); },
    setMapParent: (s) => { const parent = s.createMap({ assetId: ASSET, name: "P", kind: "world" }); s.setMapParent(s.createMap({ assetId: ASSET, name: "C", kind: "regional" }).id, parent.id); },
    setMapRevealed: (s) => { s.setMapRevealed(s.createMap({ assetId: ASSET, name: "M", kind: "world" }).id, true); },
    deleteMap: (s) => { s.deleteMap(s.createMap({ assetId: ASSET, name: "M", kind: "world" }).id); },
    createMarker: (s) => { s.createMarker(s.createMap({ assetId: ASSET, name: "M", kind: "world" }).id, MARKER); },
    updateMarker: (s) => { s.updateMarker(seedMarker(s).id, { label: "L" }); },
    moveMarker: (s) => { s.moveMarker(seedMarker(s).id, 0.25, 0.25); },
    setMarkerRevealed: (s) => { s.setMarkerRevealed(seedMarker(s).id, true); },
    deleteMarker: (s) => { s.deleteMarker(seedMarker(s).id); },
    setPartyMarker: (s) => { s.setPartyMarker(seedMarker(s).id); },
    setCalendar: (s) => { s.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: ["First"], currentDate: { year: 1492, month: 0, day: 1 } }); },
    publishCampaignDate: (s) => { s.publishCampaignDate(); },
    createEntry: (s) => { s.createEntry({ playerText: "We arrived." }); },
    appendCombatEntry: (s) => { s.appendCombatEntry({ playerText: "A battle.", gmText: null, sourceEncounterId: 1 }); },
    createDeadline: (s) => { s.createDeadline({ playerText: "Dawn.", inWorldDate: { year: 1492, month: 0, day: 2 } }); },
    createDowntime: (s) => { s.createDowntime({ playerText: "Forging.", downtime: { who: "Ireena", activity: "Forging", days: 3 } }); },
    createMilestone: (s) => { s.createMilestone({ playerText: "Level 5.", milestone: { level: 5, reason: "the crypt" } }); },
    applyDowntime: (s) => {
      s.setCalendar({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: ["First"], currentDate: { year: 1492, month: 0, day: 1 } });
      s.applyDowntime(s.createDowntime({ playerText: "Forging.", downtime: { who: "Ireena", activity: "Forging", days: 3 } }).id);
    },
    updateEntry: (s) => { s.updateEntry(s.createEntry({ playerText: "A" }).id, { playerText: "B" }); },
    setEntryRevealed: (s) => { s.setEntryRevealed(s.createEntry({ playerText: "A" }).id, true); },
    deleteEntry: (s) => { s.deleteEntry(s.createEntry({ playerText: "A" }).id); },
    createSession: (s) => { s.createSession({ sessionNumber: 1 }); },
    updateSession: (s) => { s.updateSession(s.createSession({ sessionNumber: 1 }).id, { prepBody: "plan" }, undefined, "gm"); },
    setSessionRevealed: (s) => { s.setSessionRevealed(s.createSession({ sessionNumber: 1 }).id, true); },
    deleteSession: (s) => { s.deleteSession(s.createSession({ sessionNumber: 1 }).id); },
    setActiveSession: (s) => { s.setActiveSession(s.createSession({ sessionNumber: 1 }).id); },
    createQuest: (s) => { s.createQuest({ title: "Q" }); },
    updateQuest: (s) => { s.updateQuest(s.createQuest({ title: "Q" }).id, { status: "completed" }, undefined); },
    setQuestRevealed: (s) => { s.setQuestRevealed(s.createQuest({ title: "Q" }).id, true); },
    deleteQuest: (s) => { s.deleteQuest(s.createQuest({ title: "Q" }).id); },
    setStanding: (s) => { s.setStanding(s.createPage({ title: "F", entityType: "faction" }).id, 10, "kind words"); },
    setStandingRevealed: (s) => { const page = s.createPage({ title: "F", entityType: "faction" }).id; s.setStanding(page, 10, "kind words"); s.setStandingRevealed(page, true); }
  };
  const MARKER = { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff8800" } as const;
  const seedMarker = (from: CodexStore) => from.createMarker(from.createMap({ assetId: ASSET, name: "M", kind: "world" }).id, MARKER);

  // Read from source because `private` is erased at runtime: members at two-space indent starting with
  // `identifier(`. The floor assertion catches a regex that stops matching.
  it("classifies every public method, so a write added tomorrow cannot slip past this", () => {
    const source = readFileSync(new URL("../src/codex-store.ts", import.meta.url), "utf8");
    const classBody = source.slice(source.indexOf("export class CodexStore {"));
    const surface = [...classBody.matchAll(/^ {2}(?:get |async )?([a-zA-Z][A-Za-z0-9_]*)\s*\(/gm)]
      .map((match) => match[1]!)
      .filter((name) => !["if", "for", "while", "switch", "catch", "return"].includes(name));
    expect(surface.length, "the source scan found nothing - the regex, not the store, is broken").toBeGreaterThan(50);

    const declared = new Set([...NOT_WRITES, ...Object.keys(WRITES)]);
    expect([...new Set(surface)].filter((name) => !declared.has(name)), "classify each of these as a read (NOT_WRITES) or a write (WRITES)").toEqual([]);
    expect([...declared].filter((name) => name !== "constructor" && !surface.includes(name)), "these are classified but no longer on CodexStore").toEqual([]);
  });

  it.each(Object.keys(WRITES))("%s moves store.revision", (name) => {
    const before = store.revision;
    WRITES[name]!(store);
    expect(store.revision, `${name} wrote without bumping the coarse revision - every ETag it invalidated stays valid`).toBeGreaterThan(before);
  });
});
