import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRevisionConflictError, CodexStore, parseWikiLinks, pageLinkKey } from "../src/codex-store.js";
import { projectPlayerBacklinks, projectPlayerPage, projectPlayerPageSummary } from "../src/codex-projections.js";

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
