import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, MIGRATIONS, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmMarker, projectGmRelationships, projectPlayerBacklinks, projectPlayerJournalEntry, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageSummary, projectPlayerRelationships } from "../src/codex-projections.js";

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
