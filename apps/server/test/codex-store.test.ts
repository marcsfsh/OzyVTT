import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, MIGRATIONS, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmLinkEdges, projectGmMarker, projectGmRelationships, projectPlayerBacklinks, projectPlayerJournalEntry, projectPlayerLinkEdges, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerRelationships } from "../src/codex-projections.js";

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
    expect(store.setEntryRevealed(first.id, true).revealedToPlayers).toBe(true);
    store.deleteEntry(combat.id);
    expect(store.listTimeline()).toHaveLength(2);
  });

  it("player journal projection hides unrevealed entries and strips gmText", () => {
    const secret = store.createEntry({ playerText: "The gate stood open.", gmText: "It was a trap set by the cult." });
    expect(projectPlayerJournalEntry(secret)).toBeNull();
    const shown = store.setEntryRevealed(secret.id, true);
    const projected = projectPlayerJournalEntry(shown)!;
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
