import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HomebrewContentTypeSchema } from "@vtt/api-contract";
import { CharacterIdentitySchema } from "@vtt/schemas";
import {
  loadBackgrounds, loadClasses, loadConditions, loadEquipment, loadFeats, loadMonsterDefinitions,
  loadNames, loadSkills, loadSpecies, loadSpells, loadSubclasses
} from "@vtt/content-srd-5.2.1";
import { ContentLibrary } from "../src/content-library.js";
import { HOMEBREW_ID_MAX_LENGTH, assertMintable, isMintedHomebrewId, mintHomebrewId, slugify } from "../src/homebrew-ids.js";
import { HomebrewNotFoundError, HomebrewRevisionConflictError, HomebrewStateError, HomebrewStore, MIGRATIONS, type HomebrewRevalidator } from "../src/homebrew-store.js";

/**
 * Store + id-minting unit tests. The load-bearing ones are the id budget (a >60-character id passes
 * creation and then BRICKS CAMPAIGN LOAD on the next boot via `GameStateSchema.parse`) and the
 * `expectedRev` conflict path (the editor's autosave depends on it).
 */

let directory: string;
let store: HomebrewStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-"));
  store = new HomebrewStore(join(directory, "vtt.sqlite"));
  await store.initialize();
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

const bodyFor = (name: string) => ({ name, description: "Authored by the GM." });

describe("homebrew id minting", () => {
  it("keeps every minted id inside the 60-character budget, slug-legal, and out of the reserved families", () => {
    // 90 characters of name: the slug must be cut at a hyphen boundary, not merely truncated.
    const long = "The Extremely Overlong Homebrew Class Of Considerable And Frankly Excessive Verbosity Name";
    for (const type of HomebrewContentTypeSchema.options) {
      const id = mintHomebrewId(type, long, () => false);
      expect(id.length, `${type} id "${id}"`).toBeLessThanOrEqual(HOMEBREW_ID_MAX_LENGTH);
      // Anchored to the SCHEMA, not to our own constant: `CharacterIdentitySchema` is what a persisted
      // definition is parsed through on the next boot, and it caps ids at 60 where `ContentIdSchema`
      // allows 80. Raising HOMEBREW_ID_MAX_LENGTH to 80 must fail here, not in a GM's campaign.
      expect(CharacterIdentitySchema.safeParse({
        classes: [{ id, name: "X", level: 1, subclass: { id, name: "X" } }],
        race: { id, name: "X", subrace: { id, name: "X" } },
        background: { id, name: "X" },
        feats: [{ id, name: "X" }]
      }).success, `${type} id "${id}" (${id.length} chars) does not fit a persisted ActorDefinition`).toBe(true);
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(id.startsWith("hb-")).toBe(true);
      // The reserved catalog-choice families `resolveCatalogChoice` dispatches on are unreachable
      // because every id ends in `-<hex>`; assert it so nobody "simplifies" the suffix away.
      for (const family of ["-spells", "-subclasses", "-feats", "-lineages"]) expect(id.endsWith(family)).toBe(false);
      expect(["skills", "weapons"]).not.toContain(id);
      expect(isMintedHomebrewId(id, type)).toBe(true);
    }
  });

  it("keeps a monster id opaque: no part of the creature's name appears in it", () => {
    // `Actor.definitionId` is NOT in PlayerActor's Omit, so it reaches every player for every public
    // token - a name-derived id would spell out a hidden boss before the GM reveals it.
    const id = mintHomebrewId("monster", "Strahd von Zarovich", () => false);
    expect(id).toMatch(/^hb-m-[0-9a-f]{12}$/);
    for (const word of ["strahd", "von", "zarovich"]) expect(id).not.toContain(word);
  });

  it("widens the suffix on repeated collisions and STILL respects the 60-character budget", () => {
    const long = "a".repeat(80);
    let calls = 0;
    // Collide on the first six candidates so minting falls through to the widened 8-hex suffix.
    const id = mintHomebrewId("class", long, () => (calls += 1) <= 6);
    expect(id.length).toBeLessThanOrEqual(HOMEBREW_ID_MAX_LENGTH);
    expect(id).toMatch(/-[0-9a-f]{8}$/);
  });

  it("throws rather than logs when an id would exceed the budget", () => {
    expect(() => assertMintable(`hb-${"a".repeat(70)}`, "class")).toThrow(/60/);
    expect(() => assertMintable("hb-Blood-Hunter", "class")).toThrow(/match/);
    expect(() => assertMintable("blood-hunter-a1b2c3", "class")).toThrow(/hb-/);
    expect(() => assertMintable("hb-wizard-spells", "spell-list")).toThrow(/reserved/);
  });

  it("slugifies to a hyphen boundary and falls back when nothing survives", () => {
    expect(slugify("Blood Hunter!", 50)).toBe("blood-hunter");
    expect(slugify("Order of the Mutant Blade", 12)).toBe("order-of-the");
    expect(slugify("!!!", 50)).toBe("");
  });

  it("reserves the `hb-` prefix: no SRD bundle id may shadow a minted one", () => {
    // The whole SRD-collision check is unnecessary BECAUSE of this property, so it is asserted rather
    // than assumed. A future SRD printing that broke it would silently let homebrew shadow bundled content.
    const srdIds = [
      ...loadClasses().map((record) => record.id), ...loadSubclasses().map((record) => record.id),
      ...loadSpecies().map((record) => record.id), ...loadBackgrounds().map((record) => record.id),
      ...loadFeats().map((record) => record.id), ...loadSpells().map((record) => record.id),
      ...loadEquipment().map((record) => record.id), ...loadSkills().map((record) => record.id),
      ...loadConditions().map((record) => record.id), ...loadNames().map((record) => record.speciesId),
      ...loadMonsterDefinitions().map((definition) => definition.source.externalId ?? "")
    ];
    expect(srdIds.length).toBeGreaterThan(500);
    expect(srdIds.filter((id) => id.startsWith("hb-"))).toEqual([]);
  });
});

describe("HomebrewStore", () => {
  it("keeps its migration type list in lockstep with the contract's nine types", () => {
    // Migration SQL is frozen, so the CHECK list cannot be derived from the schema at import time.
    // This is what makes a contract change fail loudly instead of drifting on fresh databases only.
    const declared = MIGRATIONS[0].sql.match(/type TEXT NOT NULL CHECK \(type IN \(([^)]+)\)\)/)?.[1] ?? "";
    expect(declared.split(",").map((value) => value.trim().replace(/'/g, ""))).toEqual([...HomebrewContentTypeSchema.options]);
  });

  it("creates as an invisible draft, mints a legal id, and denormalises the name", () => {
    const row = store.create({ type: "class", body: bodyFor("Blood Hunter") });
    expect(row).toMatchObject({ type: "class", name: "Blood Hunter", state: "draft", visibleToPlayers: false, deletedAt: null, rev: 1 });
    expect(row.id).toMatch(/^hb-blood-hunter-[0-9a-f]{6}$/);
    // The body carries the row's id and NEVER the routing discriminator - `EquipmentReferenceSchema`
    // is `.strict()` and would reject its own record at publish time if `type` rode along.
    expect(row.body.id).toBe(row.id);
    expect(row.body).not.toHaveProperty("type");
  });

  it("forces the stored body's id to the row id, ignoring whatever the client sent", () => {
    const row = store.create({ type: "spell", body: { ...bodyFor("Cinder Bolt"), id: "fireball" } });
    expect(row.body.id).toBe(row.id);
    const updated = store.update(row.id, { ...bodyFor("Cinder Bolt"), id: "magic-missile" }, row.rev, "gm");
    expect(updated.body.id).toBe(row.id);
  });

  it("rejects a body that is not an object or has no usable name", () => {
    expect(() => store.create({ type: "class", body: {} })).toThrow(HomebrewStateError);
    expect(() => store.create({ type: "class", body: { name: "   " } })).toThrow(/Name this record/);
    expect(() => store.create({ type: "class", body: { name: "x".repeat(121) } })).toThrow(/120/);
  });

  it("enforces expectedRev on update, publish and visibility, and reports the current revision", () => {
    const row = store.create({ type: "feat", body: bodyFor("Blood Maledict") });
    const updated = store.update(row.id, bodyFor("Blood Maledict II"), row.rev, "gm");
    expect(updated.rev).toBe(2);
    // The stale write is refused and carries the row's real revision, which is what lets the
    // editor's single-flight autosave resynchronise instead of clobbering.
    let conflict: unknown;
    try { store.update(row.id, bodyFor("Stale"), row.rev, "gm"); } catch (error) { conflict = error; }
    expect(conflict).toBeInstanceOf(HomebrewRevisionConflictError);
    expect((conflict as HomebrewRevisionConflictError).currentRev).toBe(2);
    expect(store.get(row.id)!.name).toBe("Blood Maledict II");
    expect(() => store.setState(row.id, "published", 1)).toThrow(HomebrewRevisionConflictError);
    expect(() => store.setVisibility(row.id, true, 1)).toThrow(HomebrewRevisionConflictError);
    // An expectedRev on a MISSING row is a not-found, never a conflict.
    expect(() => store.update("hb-gone-abcdef", bodyFor("x"), 1, "gm")).toThrow(HomebrewNotFoundError);
  });

  it("treats state and visibility as orthogonal, and refuses the one meaningless combination", () => {
    const row = store.create({ type: "species", body: bodyFor("Ashborn") });
    // draft + visible is meaningless: a loud refusal, never a silent no-op that makes the flag a lie.
    expect(() => store.setVisibility(row.id, true, undefined)).toThrow(HomebrewStateError);
    const published = store.setState(row.id, "published", undefined);
    expect(published).toMatchObject({ state: "published", visibleToPlayers: false });
    const visible = store.setVisibility(row.id, true, undefined);
    expect(visible.visibleToPlayers).toBe(true);
    // Unpublishing keeps the GM's visibility intent; the merged player catalog requires BOTH.
    expect(store.setState(row.id, "draft", undefined)).toMatchObject({ state: "draft", visibleToPlayers: true });
  });

  it("soft-deletes idempotently, hides the row from the default listing, and restores its prior state", () => {
    const row = store.create({ type: "equipment", body: bodyFor("Ring of Cinders") });
    store.setState(row.id, "published", undefined);
    store.setVisibility(row.id, true, undefined);
    const deleted = store.softDelete(row.id)!;
    expect(deleted.deletedAt).toBeTruthy();
    expect(store.softDelete(row.id)!.deletedAt).toBe(deleted.deletedAt);  // idempotent: the stamp does not move
    expect(store.list().rows.map((r) => r.id)).not.toContain(row.id);
    expect(store.list({ includeDeleted: true }).rows.map((r) => r.id)).toContain(row.id);
    // Data is retained; restore is the explicit inverse and keeps state/visibility.
    expect(store.restore(row.id)).toMatchObject({ deletedAt: null, state: "published", visibleToPlayers: true });
    expect(store.softDelete("hb-never-existed")).toBeNull();
  });

  it("never re-mints into a soft-deleted id", () => {
    const row = store.create({ type: "background", body: bodyFor("Cinder Warden") });
    store.softDelete(row.id);
    // A resurrected identity would silently re-point any actor still naming the dead record.
    for (let index = 0; index < 40; index += 1) {
      expect(store.create({ type: "background", body: bodyFor("Cinder Warden") }).id).not.toBe(row.id);
    }
  });

  it("pages by keyset in a stable name order that publishing cannot disturb", () => {
    for (const name of ["Delta", "alpha", "Charlie", "bravo", "echo"]) store.create({ type: "feat", body: bodyFor(name) });
    const first = store.list({ limit: 2 });
    expect(first.rows.map((row) => row.name)).toEqual(["alpha", "bravo"]);
    expect(first.total).toBe(5);
    expect(first.nextCursor).toBeTruthy();
    const second = store.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.rows.map((row) => row.name)).toEqual(["Charlie", "Delta"]);
    // Publishing mid-scroll moves `updated_at` but not the name, so the third page still lands right.
    store.setState(first.rows[0].id, "published", undefined);
    const third = store.list({ limit: 2, cursor: second.nextCursor! });
    expect(third.rows.map((row) => row.name)).toEqual(["echo"]);
    expect(third.nextCursor).toBeNull();
    // An opaque cursor a client mangled restarts from the top rather than 500ing.
    expect(store.list({ limit: 2, cursor: "not-a-cursor" }).rows.map((row) => row.name)).toEqual(["alpha", "bravo"]);
  });

  it("keeps the cursor inside the contract's 200-character cap even at the longest legal name", () => {
    // The token carries the row id only; encoding the sort key alongside it would run to ~250 chars
    // for a 120-character name and silently break `HomebrewContentList.nextCursor`.
    for (let index = 0; index < 3; index += 1) store.create({ type: "class", body: bodyFor(`${"N".repeat(118)}-${index}`) });
    const page = store.list({ limit: 1 });
    expect(page.nextCursor!.length).toBeLessThanOrEqual(200);
    expect(page.rows).toHaveLength(1);
    expect(store.list({ limit: 1, cursor: page.nextCursor! }).rows[0].id).not.toBe(page.rows[0].id);
  });

  it("filters by type, state, visibility and a name substring with LIKE wildcards escaped", () => {
    const wand = store.create({ type: "equipment", body: bodyFor("Wand_of Sparks") });
    store.create({ type: "equipment", body: bodyFor("Wand of Fire") });
    store.create({ type: "class", body: bodyFor("Wandering Blade") });
    store.setState(wand.id, "published", undefined);
    expect(store.list({ type: "equipment" }).total).toBe(2);
    expect(store.list({ state: "published" }).rows.map((row) => row.id)).toEqual([wand.id]);
    expect(store.list({ visibleToPlayers: true }).total).toBe(0);
    expect(store.list({ q: "wand" }).total).toBe(3);
    // `_` is a LIKE wildcard: a GM searching for the literal character must not match "Wand of Fire".
    expect(store.list({ q: "Wand_of" }).rows.map((row) => row.name)).toEqual(["Wand_of Sparks"]);
  });

  it("duplicates a record as a fresh invisible draft under a new id", () => {
    const row = store.create({ type: "class", body: { ...bodyFor("Blood Hunter"), hitDie: "d10" } });
    store.setState(row.id, "published", undefined);
    const copy = store.duplicate(row.id);
    expect(copy.id).not.toBe(row.id);
    expect(copy).toMatchObject({ name: "Blood Hunter (copy)", state: "draft", visibleToPlayers: false, rev: 1 });
    expect(copy.body.hitDie).toBe("d10");
    expect(copy.body.id).toBe(copy.id);
    expect(store.duplicate(row.id, "Crimson Hunter").name).toBe("Crimson Hunter (copy)");
    expect(() => store.duplicate("hb-missing-000000")).toThrow(HomebrewNotFoundError);
  });

  it("keeps a per-row revision log for every body change", () => {
    const row = store.create({ type: "spell", body: bodyFor("Cinder Bolt") });
    store.update(row.id, bodyFor("Cinder Bolt II"), row.rev, "gm");
    const revisions = store.listRevisions(row.id);
    expect(revisions.map((revision) => [revision.rev, revision.name])).toEqual([[2, "Cinder Bolt II"], [1, "Cinder Bolt"]]);
    expect(revisions[0].authorTag).toBe("gm");
  });
});

describe("HomebrewStore revision counter", () => {
  it("reports -1 before initialize, moves on every write, and never moves on a rolled-back one", async () => {
    const cold = new HomebrewStore(join(directory, "cold.sqlite"));
    // -1 is what lets ContentLibrary be constructed synchronously against an async-initialising store.
    expect(cold.revision).toBe(-1);
    await cold.initialize();
    expect(cold.revision).toBe(0);
    const row = cold.create({ type: "feat", body: bodyFor("Cinder Step") });
    expect(cold.revision).toBe(1);
    cold.setState(row.id, "published", undefined);
    expect(cold.revision).toBe(2);
    // A refused write must not move the counter, or every client refetches for nothing.
    expect(() => cold.update(row.id, bodyFor("Stale"), 99, "gm")).toThrow(HomebrewRevisionConflictError);
    expect(cold.revision).toBe(2);
    cold.close();
    expect(cold.revision).toBe(-1);
  });

  it("survives a restart with its counter and rows intact, and uses its OWN migration table", async () => {
    const path = join(directory, "restart.sqlite");
    const first = new HomebrewStore(path);
    await first.initialize();
    const row = first.create({ type: "monster", body: bodyFor("Cinder Wraith") });
    const revision = first.revision;
    first.close();

    const second = new HomebrewStore(path);
    await second.initialize();
    expect(second.revision).toBe(revision);
    expect(second.get(row.id)!.name).toBe("Cinder Wraith");
    second.close();

    // Own migration table, distinct from `codex_schema_migrations` and the game store's `schema_migrations`.
    const database = new DatabaseSync(path);
    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain("homebrew_schema_migrations");
    expect(tables).toContain("homebrew_records");
    expect(tables).toContain("homebrew_record_revisions");
    // STRICT tables: the SQL declares them, and a wrong-typed write is refused rather than coerced.
    expect(() => database.prepare("INSERT INTO homebrew_records (id, type, name, state, visible_to_players, body_json, rev, created_at, updated_at) VALUES ('hb-x-000000', 'nonsense', 'X', 'draft', 0, '{}', 1, '', '')").run())
      .toThrow(/CHECK constraint/i);
    database.close();
  });
});

describe("HomebrewStore as a ContentLibrary source", () => {
  it("keeps a DRAFT out of every merged catalog, so both audiences still share one SRD-only view", () => {
    // Belt 1 of the visibility guarantee, at the store: `publishedFor` asks for `state='published'`,
    // so there is no draft downstream to filter and no filter downstream to forget. A table with only
    // drafts therefore costs exactly what it did before homebrew existed.
    const library = new ContentLibrary(store);
    store.create({ type: "class", body: bodyFor("Blood Hunter") });
    const gm = library.forAudience("gm");
    const player = library.forAudience("player");
    // Same underlying catalog objects for both audiences - not merely equal contents. That identity
    // is the proof the no-published-homebrew path costs exactly what it did before.
    expect(gm.classSummaries()).toBe(player.classSummaries());
    expect(gm.monsterSummaries()).toBe(player.monsterSummaries());
    expect(gm.classSummaries().some((summary) => summary.name === "Blood Hunter")).toBe(false);
    // The revision gate still moves, which is what proves the seam is live rather than dead code.
    expect(store.revision).toBe(1);
  });

  /**
   * The authorship index is the third source the publish gate reads, and the ONLY one that can see a
   * draft. It exists because two of the gate's rules ask "does this record exist" rather than "is it
   * playable", and answering those from the published catalog deadlocked publishing entirely.
   */
  it("sees drafts, keys subclasses by the class they name, and forgets a deleted row", () => {
    const klass = store.create({ type: "class", body: bodyFor("Blood Hunter") });
    const subclass = store.create({ type: "subclass", body: { name: "Mutant", classId: klass.id } });
    const index = store.authoredIndex();
    expect(index.has("class", klass.id)).toBe(true);
    expect([...index.subclassIdsFor(klass.id)]).toEqual([subclass.id]);
    // A type is part of the identity: an id is only "authored" as the thing it actually is.
    expect(index.has("subclass", klass.id)).toBe(false);
    expect(index.has("class", "hb-nothing-000000")).toBe(false);

    // A draft that does not PARSE still counts as naming its class - a draft may be invalid, and
    // requiring a parse here would put half the deadlock straight back.
    const halfTyped = store.create({ type: "subclass", body: { name: "Half Typed", classId: klass.id, features: "not an array" } });
    expect([...store.authoredIndex().subclassIdsFor(klass.id)].sort()).toEqual([subclass.id, halfTyped.id].sort());

    // Deleting is how a GM takes a record back, so a soft-deleted subclass must stop propping up its
    // class - otherwise deleting the only subclass would leave the class standing on nothing.
    store.softDelete(halfTyped.id);
    store.softDelete(subclass.id);
    expect([...store.authoredIndex().subclassIdsFor(klass.id)]).toEqual([]);
    store.softDelete(klass.id);
    expect(store.authoredIndex().has("class", klass.id)).toBe(false);
  });

  it("re-reads the index after a write rather than serving a cached answer", () => {
    const klass = store.create({ type: "class", body: bodyFor("Blood Hunter") });
    expect([...store.authoredIndex().subclassIdsFor(klass.id)]).toEqual([]);
    const subclass = store.create({ type: "subclass", body: { name: "Mutant", classId: klass.id } });
    expect([...store.authoredIndex().subclassIdsFor(klass.id)]).toEqual([subclass.id]);
    // Re-pointing a subclass at a different class moves it, which is the exact edit the deadlock fix
    // depends on ("duplicate Champion, pick the new class").
    const other = store.create({ type: "class", body: bodyFor("Other") });
    store.update(subclass.id, { name: "Mutant", classId: other.id }, undefined, "gm");
    expect([...store.authoredIndex().subclassIdsFor(klass.id)]).toEqual([]);
    expect([...store.authoredIndex().subclassIdsFor(other.id)]).toEqual([subclass.id]);
  });

  it("refuses to overwrite-import a published or deleted row, and never resurrects a deleted one", () => {
    // Overwrite used to reach through every lifecycle column in silence: a published, player-visible
    // record became an invisible draft with no message anywhere, and a deleted one came back with
    // `deleted_at` cleared. An imported body is unvalidated, so it must not stay published - which
    // makes refusing the only loud answer, and the refusal rides `rejected[].issues`.
    const published = store.create({ type: "feat", body: bodyFor("Live Feat") });
    store.setState(published.id, "published", undefined);
    store.setVisibility(published.id, true, undefined);
    expect(() => store.importRecord(published.id, "feat", bodyFor("Clobbered"), true)).toThrow(HomebrewStateError);
    expect(store.get(published.id)).toMatchObject({ state: "published", visibleToPlayers: true, name: "Live Feat" });

    const deleted = store.create({ type: "feat", body: bodyFor("Dead Feat") });
    store.softDelete(deleted.id);
    expect(() => store.importRecord(deleted.id, "feat", bodyFor("Resurrected"), true)).toThrow(/Restore it/);
    expect(store.get(deleted.id)!.deletedAt).not.toBeNull();

    // A plain draft is what overwrite was always for, and it still works.
    const draft = store.create({ type: "feat", body: bodyFor("Draft Feat") });
    expect(store.importRecord(draft.id, "feat", bodyFor("Updated"), true).name).toBe("Updated");
  });

  it("demotes a published record whose patched body would no longer publish, and leaves a valid one alone", () => {
    const record = store.create({ type: "feat", body: bodyFor("Alert") });
    store.setState(record.id, "published", undefined);
    store.setVisibility(record.id, true, undefined);
    // The seam is injected, so the store stays free of the validator - but when it IS supplied, a
    // patch can no longer leave the library saying "Published - shown to players" about a record the
    // merged catalog has quietly dropped.
    const refusesBroken: HomebrewRevalidator = (_type, body) => body.name !== "Broken";
    const kept = store.update(record.id, bodyFor("Alert II"), undefined, "gm", refusesBroken);
    expect(kept).toMatchObject({ state: "published", visibleToPlayers: true });

    const demoted = store.update(record.id, bodyFor("Broken"), undefined, "gm", refusesBroken);
    expect(demoted).toMatchObject({ state: "draft", visibleToPlayers: false, name: "Broken" });
    // The demotion is in the audit trail, not only in the row.
    expect(store.listRevisions(record.id)[0]).toMatchObject({ state: "draft", authorTag: "gm:demoted" });
    // With no validator supplied nothing is re-checked - the store never validates on its own.
    store.setState(record.id, "published", undefined);
    expect(store.update(record.id, bodyFor("Broken Again"), undefined, "gm").state).toBe("published");
  });

  it("returns the empty slice before initialize, so a synchronous ContentLibrary is safe to construct", async () => {
    // `ContentLibrary` is built at `server.ts` module scope against a store that initialises inside an
    // async `initialize()`. A pre-initialize read must be an SRD-only view, never a throw.
    const uninitialised = new HomebrewStore(join(directory, "second.sqlite"));
    expect(uninitialised.revision).toBe(-1);
    expect(uninitialised.publishedFor("gm").classes).toEqual([]);
    expect(uninitialised.monsterForInstance("hb-m-4f19c8b02de7")).toBeUndefined();
    expect(new ContentLibrary(uninitialised).forAudience("player").classSummaries().length).toBeGreaterThan(0);
    await uninitialised.initialize();
    uninitialised.close();
  });
});
