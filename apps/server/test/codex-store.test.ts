import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectGmMarker, projectPlayerBacklinks, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageSummary } from "../src/codex-projections.js";

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

describe("CodexStore pages", () => {
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
});

describe("CodexStore map/marker viewer safety", () => {
  it("player map projection hides unrevealed maps", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    expect(projectPlayerMap(map)).toBeNull();
    expect(projectPlayerMap(store.setMapRevealed(map.id, true))).toMatchObject({ name: "World" });
  });

  it("player marker projection strips scene/actor links and hides links to unrevealed targets", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const secret = store.createPage({ title: "Secret lair" });
    const marker = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff", pageId: secret.id, sceneId: ASSET, actorId: ASSET, revealedToPlayers: true });
    expect(projectGmMarker(marker)).toMatchObject({ sceneId: ASSET, actorId: ASSET, pageId: secret.id });
    const stripped = projectPlayerMarker(marker, { pageRevealed: false, subMapRevealed: false })!;
    expect(stripped).not.toHaveProperty("sceneId");
    expect(stripped).not.toHaveProperty("actorId");
    expect(stripped.pageId).toBeNull();                            // secret page not revealed → link hidden
    expect(projectPlayerMarker(marker, { pageRevealed: true, subMapRevealed: false })!.pageId).toBe(secret.id);
  });

  it("an unrevealed marker is null for players regardless of link state", () => {
    const map = store.createMap({ assetId: ASSET, name: "World", kind: "world" });
    const marker = store.createMarker(map.id, { x: 1, y: 1, iconId: "town", iconColor: "#a45cff" });
    expect(projectPlayerMarker(marker, { pageRevealed: true, subMapRevealed: true })).toBeNull();
  });
});
