import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOMEBREW_PATHS, HomebrewContentListResponseSchema, HomebrewContentResponseSchema,
  HomebrewDeletedResponseSchema, HomebrewPackExportResponseSchema, HomebrewPackImportResponseSchema,
  HomebrewUsagesResponseSchema, openApiDocument
} from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema } from "@vtt/domain";
import { buildCharacterDefinition } from "../src/character-build.js";
import { createServer as createAppServer } from "../src/server.js";
import { HomebrewStore } from "../src/homebrew-store.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH, type HomebrewValidator } from "../src/homebrew-http.js";
import { ContentLibrary } from "../src/content-library.js";
import { findCatalogRecord } from "../src/homebrew-srd-copy.js";
import { createHomebrewValidator } from "../src/homebrew-validate.js";
import { buildHomebrewUsageIndex } from "../src/homebrew-usages.js";

/**
 * HTTP-boundary tests for the homebrew router.
 *
 * The two that matter most are the authorization gate and the `expectedRev` conflict. This surface
 * is the ONLY way a draft or a published-but-not-visible record can be read, so "every route is
 * GM-only" is not a convention here - it is the whole visibility guarantee's second belt (the first
 * being that drafts are in no merged catalog at all). Every response is also validated against the
 * contract's own Zod schema, so the router cannot drift from the published OpenAPI document.
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function fixture(options: { validate?: HomebrewValidator; realValidation?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-http-"));
  const store = new HomebrewStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-27T03:00:00.000Z"));
  await store.initialize();
  const pings: number[] = [];
  // The SRD catalog behind `/duplicate`. Wired in every fixture because duplicating a bundled record
  // is a first-class entry point, not an extra - a 20-row class table is not typed into a form.
  const contentLibrary = new ContentLibrary(store);
  const app = express();
  // Mirrors server.ts: the pack parser runs FIRST, so its larger limit wins for that one route.
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  app.use(express.json({ limit: "512kb" }));
  app.use(createHomebrewRouter({
    store,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    notifyChanged: () => { pings.push(store.revision); },
    validate: options.validate ?? (options.realValidation
      ? createHomebrewValidator({
        forAudience: (audience) => contentLibrary.forAudience(audience),
        publishedSpellLists: () => store.publishedFor("gm").spellLists,
        authoredIndex: () => store.authoredIndex()
      })
      : undefined),
    usagesOf: (type, id) => buildHomebrewUsageIndex(GameStateSchema.parse({ schemaVersion: 1 })).of(type, id),
    catalogRecord: (id) => findCatalogRecord(contentLibrary.forAudience("gm"), id)
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Homebrew test server did not bind.");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, store, pings, contentLibrary };
}

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
const ANON = { "content-type": "application/json" };

type Json = Record<string, any>;
const body = (response: Response) => response.json() as Promise<Json>;
const get = (base: string, path: string, headers: Record<string, string>) => fetch(`${base}${path}`, { headers });
const send = (method: string) => (base: string, path: string, headers: Record<string, string>, payload?: unknown) =>
  fetch(`${base}${path}`, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
const post = send("POST");
const patch = send("PATCH");
const remove = send("DELETE");

const CONTENT = HOMEBREW_PATHS.content;
const byId = (id: string) => HOMEBREW_PATHS.contentById.replace("{id}", id);
const sub = (path: string, id: string) => path.replace("{id}", id);

const classBody = (name = "Blood Hunter") => ({ type: "class", name, hitDie: "d10" });

async function createRecord(base: string, record: Record<string, unknown> = classBody()) {
  const created = await body(await post(base, CONTENT, GM, { record }));
  return created.data.record as Json;
}

describe("homebrew HTTP authorization gate", () => {
  it("is GM-only on every declared operation: 401 unauthenticated, 403 for a player, never a leak", async () => {
    const { base, store } = await fixture();
    const draft = store.create({ type: "class", body: { name: "Secret Class" } });
    const published = store.create({ type: "monster", body: { name: "Secret Boss" } });
    store.setState(published.id, "published", undefined);

    // Every operation the contract declares, exercised with no token and with a player token.
    const calls: Array<[string, () => Promise<Response>]> = [
      ["GET content", () => get(base, CONTENT, ANON)],
      ["POST content", () => post(base, CONTENT, ANON, { record: classBody() })],
      ["GET contentById", () => get(base, byId(draft.id), ANON)],
      ["PATCH contentById", () => patch(base, byId(draft.id), ANON, { record: classBody() })],
      ["DELETE contentById", () => remove(base, byId(draft.id), ANON)],
      ["POST restore", () => post(base, sub(HOMEBREW_PATHS.contentRestore, draft.id), ANON, {})],
      ["POST duplicate", () => post(base, sub(HOMEBREW_PATHS.contentDuplicate, draft.id), ANON, {})],
      ["POST publish", () => post(base, sub(HOMEBREW_PATHS.contentPublish, draft.id), ANON, {})],
      ["POST unpublish", () => post(base, sub(HOMEBREW_PATHS.contentUnpublish, draft.id), ANON, {})],
      ["POST visibility", () => post(base, sub(HOMEBREW_PATHS.contentVisibility, draft.id), ANON, { visibleToPlayers: true })],
      ["GET usages", () => get(base, sub(HOMEBREW_PATHS.contentUsages, draft.id), ANON)],
      ["GET packsExport", () => get(base, HOMEBREW_PATHS.packsExport, ANON)],
      ["POST packsImport", () => post(base, HOMEBREW_PATHS.packsImport, ANON, { pack: { schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "P", attribution: null, exportedAt: new Date().toISOString(), records: [] } })]
    ];
    expect(calls).toHaveLength(13);   // the contract declares exactly 13 operations across 10 paths

    for (const [label, call] of calls) {
      const anonymous = await call();
      expect(anonymous.status, `${label} unauthenticated`).toBe(401);
      const text = await anonymous.text();
      // Nothing about the GM's library may appear in a denial - not a name, not an id.
      expect(text, `${label} leaked a record name`).not.toContain("Secret");
      expect(text, `${label} leaked a record id`).not.toContain(draft.id);
    }
    // An authenticated player is FORBIDDEN, not unauthenticated: telling them 401 would send them
    // to re-login for a surface that is never theirs.
    const playerCalls = [
      get(base, CONTENT, PLAYER),
      get(base, byId(draft.id), PLAYER),
      get(base, byId(published.id), PLAYER),
      post(base, CONTENT, PLAYER, { record: classBody() }),
      get(base, HOMEBREW_PATHS.packsExport, PLAYER)
    ];
    for (const response of await Promise.all(playerCalls)) {
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("Secret");
    }
    expect((await get(base, CONTENT, GM)).status).toBe(200);
  });

  it("declares the same ten paths the router mounts", async () => {
    // A path added to the contract without a route (or the reverse) is a documented endpoint that 404s.
    const { base } = await fixture();
    const declared = Object.values(HOMEBREW_PATHS);
    expect(declared).toHaveLength(10);
    expect(Object.keys(openApiDocument.paths).filter((path) => path.startsWith("/api/v1/homebrew")).sort()).toEqual([...declared].sort());
    // A request that falls THROUGH the router never gets the router's own headers, so their presence
    // is the proof the path is mounted rather than merely documented.
    for (const path of declared) {
      const probe = await get(base, path.replace("{id}", "hb-nothing-000000"), GM);
      expect(probe.headers.get("x-request-id"), `${path} is documented but not mounted`).toBeTruthy();
      expect(probe.headers.get("cache-control"), `${path} is documented but not mounted`).toBe("no-store");
    }
  });
});

describe("homebrew HTTP CRUD", () => {
  it("creates a draft, reads it back, and matches the contract's response schema", async () => {
    const { base, pings } = await fixture();
    const response = await post(base, CONTENT, GM, { record: classBody() });
    expect(response.status).toBe(201);
    const created = await body(response);
    expect(HomebrewContentResponseSchema.safeParse(created).success).toBe(true);
    const record = created.data.record;
    expect(record).toMatchObject({ type: "class", state: "draft", visibleToPlayers: false, deletedAt: null, rev: 1 });
    // `record` is self-describing on the wire (the pack format is a bare array of records) even
    // though `type` is stored on the row rather than inside the authored body.
    expect(record.record).toMatchObject({ id: record.id, type: "class", name: "Blood Hunter", hitDie: "d10" });
    expect(pings).toEqual([1]);   // one content-free ping per write

    const fetched = await body(await get(base, byId(record.id), GM));
    expect(HomebrewContentResponseSchema.safeParse(fetched).success).toBe(true);
    expect(fetched.data.record.id).toBe(record.id);
    expect((await get(base, byId("hb-missing-000000"), GM)).status).toBe(404);
  });

  it("rejects a record with no name or an unknown type as a 400 with machine-addressable issues", async () => {
    const { base } = await fixture();
    expect((await post(base, CONTENT, GM, { record: { type: "class" } })).status).toBe(409);
    const unknownType = await post(base, CONTENT, GM, { record: { type: "spaceship", name: "X" } });
    expect(unknownType.status).toBe(409);
    const strict = await post(base, CONTENT, GM, { record: classBody(), extra: true });
    expect(strict.status).toBe(400);
    const failure = await body(strict);
    expect(failure.error.details.issues[0]).toHaveProperty("path");
    expect(failure.error.details.issues[0]).toHaveProperty("recordId", null);
  });

  it("409s a stale expectedRev and hands back the row's current revision", async () => {
    const { base } = await fixture();
    const record = await createRecord(base);
    const first = await body(await patch(base, byId(record.id), GM, { record: classBody("Blood Hunter II"), expectedRev: 1 }));
    expect(first.data.record.rev).toBe(2);

    const stale = await patch(base, byId(record.id), GM, { record: classBody("Clobbered"), expectedRev: 1 });
    expect(stale.status).toBe(409);
    const conflict = await body(stale);
    expect(conflict.error.code).toBe("conflict");
    // The editor's single-flight autosave resynchronises from this number instead of clobbering.
    expect(conflict.error.currentRevision).toBe(2);
    const after = await body(await get(base, byId(record.id), GM));
    expect(after.data.record.record.name).toBe("Blood Hunter II");

    // Omitting expectedRev is a deliberate last-write-wins, still allowed.
    expect((await patch(base, byId(record.id), GM, { record: classBody("Deliberate") })).status).toBe(200);
  });

  it("soft-deletes idempotently and restores, matching the contract's deleted response", async () => {
    const { base } = await fixture();
    const record = await createRecord(base);
    const deleted = await remove(base, byId(record.id), GM);
    expect(deleted.status).toBe(200);
    const deletedBody = await body(deleted);
    expect(HomebrewDeletedResponseSchema.safeParse(deletedBody).success).toBe(true);
    expect(deletedBody.data).toMatchObject({ id: record.id, deleted: true });
    // Idempotent: a retried delete, and a delete of an id that never existed, are both 200.
    expect((await remove(base, byId(record.id), GM)).status).toBe(200);
    expect((await remove(base, byId("hb-never-000000"), GM)).status).toBe(200);
    // Gone from the default listing, present with includeDeleted, and restorable.
    expect((await body(await get(base, `${CONTENT}?includeDeleted=false`, GM))).data.total).toBe(0);
    expect((await body(await get(base, `${CONTENT}?includeDeleted=1`, GM))).data.total).toBe(1);
    const restored = await body(await post(base, sub(HOMEBREW_PATHS.contentRestore, record.id), GM, {}));
    expect(restored.data.record.deletedAt).toBeNull();
    expect((await post(base, sub(HOMEBREW_PATHS.contentRestore, "hb-never-000000"), GM, {})).status).toBe(404);
  });

  it("keeps publish and visibility separate, and refuses to make a draft player-visible", async () => {
    const { base } = await fixture();
    const record = await createRecord(base);
    // draft + visible is meaningless: a loud 409 rather than a silent no-op that makes the flag a lie.
    const early = await post(base, sub(HOMEBREW_PATHS.contentVisibility, record.id), GM, { visibleToPlayers: true });
    expect(early.status).toBe(409);

    const published = await body(await post(base, sub(HOMEBREW_PATHS.contentPublish, record.id), GM, {}));
    // Publishing does NOT show it to players - that is the point of the separate endpoint.
    expect(published.data.record).toMatchObject({ state: "published", visibleToPlayers: false });
    const visible = await body(await post(base, sub(HOMEBREW_PATHS.contentVisibility, record.id), GM, { visibleToPlayers: true, expectedRev: published.data.record.rev }));
    expect(visible.data.record.visibleToPlayers).toBe(true);
    const unpublished = await body(await post(base, sub(HOMEBREW_PATHS.contentUnpublish, record.id), GM, {}));
    expect(unpublished.data.record.state).toBe("draft");
  });

  it("refuses to publish an invalid draft with a 409 carrying every blocking issue", async () => {
    // The validation seam (`homebrew-validate.ts`, slice 2) plugs in here with no other change.
    const validate: HomebrewValidator = (_type, record) => record.hitDie === "d10"
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ path: ["hitDie"], message: "Choose a hit die.", recordId: null }] };
    const { base } = await fixture({ validate });
    const bad = await createRecord(base, { type: "class", name: "Half-Formed" });
    expect(bad.validity).toEqual({ valid: false, issues: [{ path: ["hitDie"], message: "Choose a hit die.", recordId: null }] });
    const refused = await post(base, sub(HOMEBREW_PATHS.contentPublish, bad.id), GM, {});
    // 409 not 400: the REQUEST is well-formed; it is the stored draft that refuses the transition.
    expect(refused.status).toBe(409);
    const failure = await body(refused);
    expect(failure.error.code).toBe("conflict");
    expect(failure.error.details.invalid.issues[0].path).toEqual(["hitDie"]);
    expect((await body(await get(base, byId(bad.id), GM))).data.record.state).toBe("draft");

    const good = await createRecord(base);
    expect((await post(base, sub(HOMEBREW_PATHS.contentPublish, good.id), GM, {})).status).toBe(200);
  });

  /**
   * PATCH used to be a hole straight through the publish gate.
   *
   * It never called `validate` and never touched `state`/`visibleToPlayers`, so a published,
   * player-visible record could be edited into anything at all - a nonexistent spell list, a bogus
   * `fromCatalog`, a ghost equipment id, or a body that no longer parses - and the library went on
   * saying "Published - shown to players" while `publishedFor` quietly dropped it behind a
   * `console.warn`. The editor AUTOSAVES: no button is pressed to earn any of that.
   */
  describe("editing a published record cannot leave it claiming to be live", () => {
    /** A published, player-visible spell list drawing one real spell. */
    const publishAndShare = async (base: string) => {
      const created = await createRecord(base, { type: "spell-list", name: "Blood Magic", add: ["fireball"] });
      const published = await body(await post(base, sub(HOMEBREW_PATHS.contentPublish, created.id), GM, {}));
      expect(published.data.record.state).toBe("published");
      const shared = await body(await post(base, sub(HOMEBREW_PATHS.contentVisibility, created.id), GM, { visibleToPlayers: true }));
      expect(shared.data.record.visibleToPlayers).toBe(true);
      return created.id as string;
    };

    it("demotes to an invisible draft when an autosave makes the body unpublishable, and says so in the response", async () => {
      const { base, store } = await fixture({ realValidation: true });
      const id = await publishAndShare(base);
      expect(store.publishedFor("player").spellLists).toHaveLength(1);

      // The autosave that empties the list - still a legal PATCH, and it still lands.
      const patched = await body(await patch(base, byId(id), GM, { record: { id, name: "Blood Magic", source: "homebrew", add: [] } }));
      expect(patched.data.record.record.add).toEqual([]);
      // ...but the record is no longer telling anyone it is live.
      expect(patched.data.record).toMatchObject({ state: "draft", visibleToPlayers: false });
      expect(patched.data.record.validity.valid).toBe(false);
      expect(store.publishedFor("player").spellLists).toHaveLength(0);
      expect(store.publishedFor("gm").spellLists).toHaveLength(0);
      // And the library agrees on the next read, rather than only in the PATCH response.
      expect((await body(await get(base, byId(id), GM))).data.record.state).toBe("draft");
    });

    it("demotes when the patch breaks the record's SCHEMA - the case that used to hide behind a console.warn", async () => {
      const { base, store } = await fixture({ realValidation: true });
      const id = await publishAndShare(base);
      // `add` must be an array of ids. This body saves, parses as JSON, and then fails its own Zod
      // schema - exactly the shape `publishedFor` drops in silence while the row still says published.
      const patched = await body(await patch(base, byId(id), GM, { record: { id, name: "Blood Magic", source: "homebrew", add: "fireball" } }));
      expect(patched.data.record).toMatchObject({ state: "draft", visibleToPlayers: false });
      // The invariant, stated directly: nothing published is ever missing from the merged catalog.
      const publishedRows = store.list({ state: "published" }).rows;
      expect(publishedRows).toHaveLength(0);
      expect(store.publishedFor("gm").spellLists).toHaveLength(0);
    });

    it("leaves a still-valid edit published, and never demotes a draft it had no business touching", async () => {
      const { base } = await fixture({ realValidation: true });
      const id = await publishAndShare(base);
      const fine = await body(await patch(base, byId(id), GM, { record: { id, name: "Blood Magic II", source: "homebrew", add: ["fireball", "fire-bolt"] } }));
      expect(fine.data.record).toMatchObject({ state: "published", visibleToPlayers: true });

      // A draft may be invalid - that is what drafts are for - so editing one into nonsense is fine.
      const draft = await createRecord(base, { type: "spell-list", name: "Scratch", add: ["fireball"] });
      const edited = await body(await patch(base, byId(draft.id), GM, { record: { id: draft.id, name: "Scratch", source: "homebrew", add: [] } }));
      expect(edited.data.record).toMatchObject({ state: "draft", visibleToPlayers: false });
      expect(edited.status).toBeUndefined();
    });
  });

  it("lists with composing filters, keyset paging and a contract-shaped envelope", async () => {
    const { base } = await fixture();
    for (const name of ["Alpha", "Bravo", "Charlie"]) await createRecord(base, { type: "class", name });
    await createRecord(base, { type: "monster", name: "Cinder Wraith" });
    const listed = await body(await get(base, `${CONTENT}?type=class&limit=2`, GM));
    expect(HomebrewContentListResponseSchema.safeParse(listed).success).toBe(true);
    expect(listed.data.records.map((row: Json) => row.name)).toEqual(["Alpha", "Bravo"]);
    expect(listed.data.total).toBe(3);
    expect(listed.data.records[0]).toMatchObject({ source: "homebrew", state: "draft", valid: true, usageCount: 0 });
    const next = await body(await get(base, `${CONTENT}?type=class&limit=2&cursor=${encodeURIComponent(listed.data.nextCursor)}`, GM));
    expect(next.data.records.map((row: Json) => row.name)).toEqual(["Charlie"]);
    expect(next.data.nextCursor).toBeNull();
    expect((await body(await get(base, `${CONTENT}?q=cinder`, GM))).data.total).toBe(1);
    expect((await get(base, `${CONTENT}?type=nonsense`, GM)).status).toBe(400);
  });

  it("duplicates a record as a new invisible draft", async () => {
    const { base } = await fixture();
    const record = await createRecord(base);
    await post(base, sub(HOMEBREW_PATHS.contentPublish, record.id), GM, {});
    const copy = await post(base, sub(HOMEBREW_PATHS.contentDuplicate, record.id), GM, {});
    expect(copy.status).toBe(201);
    const copied = (await body(copy)).data.record;
    expect(copied.id).not.toBe(record.id);
    expect(copied).toMatchObject({ state: "draft", visibleToPlayers: false });
    expect(copied.record).toMatchObject({ type: "class", name: "Blood Hunter (copy)", hitDie: "d10" });
  });

  it("duplicates an SRD record into an editable, publishable draft", async () => {
    // The headline authoring path: a `ClassReference` carries a mandatory 20-row level table plus its
    // full feature list, so "duplicate Wizard and edit" is what makes authoring a class possible.
    const { base } = await fixture({ realValidation: true });
    const response = await post(base, sub(HOMEBREW_PATHS.contentDuplicate, "wizard"), GM, {});
    expect(response.status).toBe(201);
    const copy = (await body(response)).data.record;
    expect(HomebrewContentResponseSchema.safeParse(await body(await get(base, byId(copy.id), GM))).success).toBe(true);
    expect(copy).toMatchObject({ type: "class", state: "draft", visibleToPlayers: false });
    expect(copy.id.startsWith("hb-")).toBe(true);
    expect(copy.record.name).toBe("Wizard (copy)");
    expect(copy.record.source).toBe("homebrew");
    expect(copy.record.levelTable).toHaveLength(20);
    // Self-referential slugs follow the copy; shared references stay pointed at the SRD ecosystem.
    const slugs = (copy.record.features as Json[]).map((feature) => feature.choice?.fromCatalog).filter(Boolean);
    expect(slugs).toContain(`${copy.id}-subclasses`);
    expect(slugs).toContain("wizard-spells");

    // The one thing a fresh copy legitimately cannot do yet - and it says so on the publish button.
    const refused = await post(base, sub(HOMEBREW_PATHS.contentPublish, copy.id), GM, {});
    expect(refused.status).toBe(409);
    expect((await body(refused)).error.details.invalid.issues[0].message).toContain("no subclass names");
  });

  /**
   * THE HEADLINE PATH, end to end, in the order a GM would actually do it.
   *
   * Publishing a homebrew class was impossible in EVERY order: the class refused until a subclass
   * was published, the subclass refused until the class was published, and the only escape was to
   * hand-edit a `fromCatalog` slug the GM has no reason to know exists. Duplicate, re-point, publish,
   * publish, play - with the numbers checked at the end, because "it published" is not the goal.
   */
  it("takes a GM from \"duplicate Fighter\" to a published, playable class - and the character is really built", async () => {
    const { base, contentLibrary } = await fixture({ realValidation: true });
    const duplicate = async (id: string) => (await body(await post(base, sub(HOMEBREW_PATHS.contentDuplicate, id), GM, {}))).data.record as Json;
    const publish = (id: string) => post(base, sub(HOMEBREW_PATHS.contentPublish, id), GM, {});

    // 1. Duplicate Fighter. 2. Duplicate Champion. Both land as invisible drafts.
    const heroClass = await duplicate("fighter");
    const subclass = await duplicate("champion");
    // 3. Point the copy at the new class - a dropdown in the editor, by NAME. No slug is typed here:
    //    the id came back in the duplicate response, the same way the editor's class picker gets it.
    const repointed = await patch(base, byId(subclass.id), GM, { record: { ...subclass.record, classId: heroClass.id } });
    expect(repointed.status).toBe(200);

    // 4. Publish, in the order the GM happens to click. THE CLASS FIRST, on a subclass that is still
    //    a draft - the direction that used to be a flat 409.
    const publishedClass = await publish(heroClass.id);
    expect(publishedClass.status, JSON.stringify((await body(await publish(heroClass.id))).error?.details ?? {})).toBe(200);
    expect((await publish(subclass.id)).status).toBe(200);

    // 5. Play. The class is in the GM's merged catalog with its own subclass under it.
    const gm = contentLibrary.forAudience("gm");
    expect(gm.classRecord(heroClass.id)?.name).toBe("Fighter (copy)");
    expect(gm.subclassSummaries().filter((row) => row.classId === heroClass.id).map((row) => row.name)).toEqual(["Champion (copy)"]);

    const built = buildCharacterDefinition({
      name: "Borin", speciesId: "human", backgroundId: "soldier",
      classId: heroClass.id, level: 5, subclassId: subclass.id,
      abilityMethod: "standard-array",
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
      hp: { mode: "entries", entries: [1, 10, 4, 6] },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: heroClass.id, kind: "skill", id: "athletics" },
        { level: 1, classId: heroClass.id, kind: "skill", id: "perception" },
        { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
        { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
        { level: 1, classId: heroClass.id, kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
        { level: 1, classId: heroClass.id, kind: "weapon-mastery", id: "greatsword" },
        { level: 1, classId: heroClass.id, kind: "weapon-mastery", id: "flail" },
        { level: 1, classId: heroClass.id, kind: "weapon-mastery", id: "longbow" },
        { level: 4, classId: heroClass.id, kind: "weapon-mastery", id: "rapier" },
        { level: 3, classId: heroClass.id, kind: "subclass", id: subclass.id },
        { level: 4, classId: heroClass.id, kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
        { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
        { level: 1, kind: "tool", id: "gaming-set-dice" },
        { level: 1, kind: "equipment", id: "fighter-a" },
        { level: 1, kind: "equipment", id: "soldier-a" }
      ]
    }, gm, BuilderPolicySchema.parse({}));

    // The numbers, not just the absence of a throw - and they are the SRD Fighter's own numbers,
    // because a duplicate that publishes but computes differently is the M2 bug all over again.
    // Level 1: 10+2 Con. Rolls 1/10/4/6 floored at the d10 average -> 6/10/6/6, +2 Con each = 48.
    expect(built.hitPoints.maximum).toBe(48);
    expect(built.proficiencyBonus).toBe(3);
    expect(built.abilityScores).toEqual({ str: 19, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    // Chain mail 16 from the copied starting-equipment option + the Defense style's +1.
    expect(built.armorClass).toBe(17);
    // The homebrew class and ITS subclass are what the sheet records - not the SRD originals.
    expect(built.character?.classes).toEqual([{
      id: heroClass.id, name: "Fighter (copy)", level: 5, hitDie: "d10",
      subclass: { id: subclass.id, name: "Champion (copy)" }
    }]);
    // The copied class's own features really came across, the level-3 SUBCLASS feature included -
    // which is the whole reason a class needs a subclass before it is worth publishing.
    expect(built.actions.map((action) => action.name)).toContain("Second Wind");
    const traits = (built.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name);
    expect(traits).toContain("Improved Critical");
    expect(traits).toContain("Extra Attack");
  });

  it("duplicates an SRD spell, which publishes with no further authoring", async () => {
    const { base } = await fixture({ realValidation: true });
    const copy = (await body(await post(base, sub(HOMEBREW_PATHS.contentDuplicate, "acid-arrow"), GM, {}))).data.record;
    expect(copy.type).toBe("spell");
    expect(copy.record.source).toBe("homebrew");
    expect((await post(base, sub(HOMEBREW_PATHS.contentPublish, copy.id), GM, {})).status).toBe(200);
  });

  it("still 404s an id that names nothing at all", async () => {
    const { base } = await fixture();
    expect((await post(base, sub(HOMEBREW_PATHS.contentDuplicate, "not-a-real-id"), GM, {})).status).toBe(404);
  });

  it("reports usages calmly and matches the contract's usages envelope", async () => {
    const { base } = await fixture();
    const record = await createRecord(base);
    const usages = await body(await get(base, sub(HOMEBREW_PATHS.contentUsages, record.id), GM));
    expect(HomebrewUsagesResponseSchema.safeParse(usages).success).toBe(true);
    // A built character carries a flattened, self-contained ActorDefinition, so deleting a homebrew
    // record never breaks one - the count is informational, and the answer is a calm yes.
    expect(usages.data).toEqual({ id: record.id, usages: [], safeToDelete: true });
    expect((await get(base, sub(HOMEBREW_PATHS.contentUsages, "hb-missing-000000"), GM)).status).toBe(404);
  });
});

describe("homebrew HTTP packs", () => {
  it("exports published records as authored bodies only, never the exporting table's row state", async () => {
    const { base } = await fixture();
    const published = await createRecord(base);
    await post(base, sub(HOMEBREW_PATHS.contentPublish, published.id), GM, {});
    await createRecord(base, { type: "class", name: "Still A Draft" });
    const exported = await body(await get(base, HOMEBREW_PATHS.packsExport, GM));
    expect(HomebrewPackExportResponseSchema.safeParse(exported).success).toBe(true);
    expect(exported.data.pack.records).toHaveLength(1);
    const record = exported.data.pack.records[0];
    expect(record).toMatchObject({ id: published.id, type: "class", name: "Blood Hunter" });
    // An importer must not inherit this table's visibility policy, so none of it travels.
    for (const key of ["state", "visibleToPlayers", "deletedAt", "rev"]) expect(record).not.toHaveProperty(key);
  });

  it("imports everything as an invisible draft, re-mints a colliding id, and dry-runs without writing", async () => {
    const { base, store } = await fixture();
    const existing = await createRecord(base);
    const pack = {
      schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Ozy's Homebrew", attribution: null,
      exportedAt: "2026-07-27T03:00:00.000Z",
      records: [
        { id: existing.id, type: "class", name: "Colliding Hunter" },
        { id: "hb-not-ours", type: "feat", name: "Foreign Id" },
        { id: "brand-new-feat", type: "feat", name: "Kept Id" }
      ]
    };
    const dry = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { pack, dryRun: true }));
    expect(HomebrewPackImportResponseSchema.safeParse(dry).success).toBe(true);
    expect(dry.data.dryRun).toBe(true);
    expect(store.list().total).toBe(1);   // the plan only; nothing written

    const applied = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { pack }));
    expect(applied.data.imported).toHaveLength(3);
    // Every id that is not one of OUR shapes is re-minted: the one colliding with an existing row,
    // the one in our reserved namespace that we did not mint, and the "clean" foreign id - which
    // used to be kept verbatim and produced a row that could never publish for as long as it existed.
    expect(applied.data.reminted.map((entry: Json) => entry.originalId).sort()).toEqual([existing.id, "brand-new-feat", "hb-not-ours"].sort());
    for (const entry of applied.data.imported) expect(entry.id).toMatch(/^hb-[a-z0-9-]+-[0-9a-f]{6}$/);
    // Everything lands as an invisible draft, which is what makes importing an invalid pack harmless.
    for (const row of store.list().rows) expect(row).toMatchObject({ state: "draft", visibleToPlayers: false });
    expect(store.list().total).toBe(4);
  });

  /**
   * S6/S7. Pack import used to land ids it could never publish and change live records in silence.
   */
  it("re-mints every id it could never publish, and says so instead of leaving a dead row behind", async () => {
    const { base, store } = await fixture({ realValidation: true });
    // Four ids the identity tier refuses outright: an SRD class id, an SRD spell id, an id ending in
    // a reserved catalog-choice suffix, and one past the 60-character persistence budget (which is
    // the id shape that BRICKS CAMPAIGN LOAD once it reaches a persisted ActorDefinition).
    const longId = "x".repeat(200);
    const pack = {
      schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Foreign", attribution: null,
      exportedAt: "2026-07-27T03:00:00.000Z",
      records: [
        { id: "wizard", type: "class", name: "Wizard", hitDie: "d6", statPriority: ["int", "con", "dex", "wis", "cha", "str"], primaryAbilities: ["int"], savingThrows: ["int", "wis"], skillChoices: { choose: 2, from: ["arcana", "history"] }, subclassLevel: 3, levelTable: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, proficiencyBonus: 2 + Math.floor(index / 4) })) },
        { id: "fire-bolt", type: "spell", name: "Fire Bolt", level: 0, school: "evocation", castingTime: "action", range: { text: "120 feet" }, duration: "instantaneous", description: "A mote of fire." },
        { id: "my-list-spells", type: "spell-list", name: "My List", add: ["fireball"] },
        { id: longId, type: "feat", name: "Overlong" }
      ]
    };
    const applied = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { pack }));
    expect(HomebrewPackImportResponseSchema.safeParse(applied).success).toBe(true);
    expect(applied.data.imported).toHaveLength(4);
    expect(applied.data.rejected).toEqual([]);
    // Reported, every one of them - and the 200-character id is rendered rather than emitted
    // verbatim, which would make the response fail the contract it is served under.
    expect(applied.data.reminted).toHaveLength(4);
    expect(applied.data.reminted.map((entry: Json) => entry.originalId).sort())
      .toEqual(["fire-bolt", "my-list-spells", "wizard", "x".repeat(60)].sort());
    // Nothing outside `hb-` is ours, so the reason names the namespace it came from.
    for (const entry of applied.data.reminted) expect(entry.reason).toBe("srd-collision");

    // THE POINT: the id is no longer what stops any of them. Every one of these rows used to carry a
    // permanent `["id"]` refusal that no amount of editing in the editor could clear - the id is not
    // an editable field - so the row was dead on arrival with `reminted` and `rejected` both empty.
    for (const row of store.list().rows) {
      const document = (await body(await get(base, byId(row.id), GM))).data.record;
      expect(document.validity.issues.filter((issue: Json) => issue.path[0] === "id"), row.name).toEqual([]);
      expect(row.id).toMatch(/^hb-[a-z0-9-]+-[0-9a-f]{6}$/);
    }
    // And the spell list, which needed nothing but a usable id, publishes outright.
    const list = store.list().rows.find((row) => row.type === "spell-list")!;
    expect((await post(base, sub(HOMEBREW_PATHS.contentPublish, list.id), GM, {})).status).toBe(200);
  });

  it("never changes a live record behind the GM's back on an overwrite - it refuses, and the dry run says the same", async () => {
    const { base, store } = await fixture({ realValidation: true });
    const live = await createRecord(base, { type: "spell-list", name: "Shared List", add: ["fireball"] });
    await post(base, sub(HOMEBREW_PATHS.contentPublish, live.id), GM, {});
    await post(base, sub(HOMEBREW_PATHS.contentVisibility, live.id), GM, { visibleToPlayers: true });
    const deleted = await createRecord(base, { type: "feat", name: "Deleted Feat" });
    await remove(base, byId(deleted.id), GM);
    const draft = await createRecord(base, { type: "feat", name: "Plain Draft" });

    const pack = {
      schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Update", attribution: null,
      exportedAt: "2026-07-27T03:00:00.000Z",
      records: [
        { id: live.id, type: "spell-list", name: "Clobbered", add: [] },
        { id: deleted.id, type: "feat", name: "Resurrected" },
        { id: draft.id, type: "feat", name: "Legitimately Updated" }
      ]
    };
    const request = { pack, onIdCollision: "overwrite" };
    const dry = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { ...request, dryRun: true }));
    const applied = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, request));
    // The contract promises the dry run is the same report; a check that lived only inside the write
    // would have made that promise false.
    expect(dry.data.rejected).toEqual(applied.data.rejected);
    expect(dry.data.overwritten).toEqual(applied.data.overwritten);
    expect(HomebrewPackImportResponseSchema.safeParse(dry).success).toBe(true);

    expect(applied.data.rejected.map((entry: Json) => entry.originalId).sort()).toEqual([live.id, deleted.id].sort());
    expect(applied.data.rejected.find((entry: Json) => entry.originalId === live.id).issues[0].message).toContain("shown to players");
    expect(applied.data.rejected.find((entry: Json) => entry.originalId === deleted.id).issues[0].message).toContain("Restore it");

    // The live record is EXACTLY as it was: same name, same body, still published, still shared.
    const untouched = (await body(await get(base, byId(live.id), GM))).data.record;
    expect(untouched).toMatchObject({ state: "published", visibleToPlayers: true });
    expect(untouched.record.name).toBe("Shared List");
    expect(store.publishedFor("player").spellLists).toHaveLength(1);
    // The deleted record stays deleted rather than walking back in.
    expect(store.get(deleted.id)!.deletedAt).not.toBeNull();
    // And the one row overwriting was ever meant for goes through.
    expect(applied.data.overwritten.map((entry: Json) => entry.id)).toEqual([draft.id]);
    expect(store.get(draft.id)!.name).toBe("Legitimately Updated");
  });

  it("gives a dry run and an apply the same answer about a nameless record, rather than 500ing the preview", async () => {
    // `imported[].name` is `min(1)` in the contract, so a nameless row used to make the DRY RUN's own
    // response fail the schema it is served under - a 500 on a preview of a pack the apply path would
    // have reported cleanly. A preview that cannot be trusted is worse than no preview.
    const { base } = await fixture();
    const pack = {
      schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Ragged", attribution: null,
      exportedAt: "2026-07-27T03:00:00.000Z",
      records: [{ id: "hb-nameless-a1b2c3", type: "feat" }, { type: "feat", name: "Fine" }]
    };
    const dry = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { pack, dryRun: true }));
    const applied = await body(await post(base, HOMEBREW_PATHS.packsImport, GM, { pack }));
    expect(HomebrewPackImportResponseSchema.safeParse(dry).success).toBe(true);
    expect(dry.data.rejected).toEqual(applied.data.rejected);
    expect(dry.data.rejected[0]).toMatchObject({ originalId: "hb-nameless-a1b2c3" });
    expect(dry.data.rejected[0].issues[0].message).toContain("Name this record");
    expect(dry.data.imported.map((entry: Json) => entry.name)).toEqual(["Fine"]);
  });

  it("caps a pack at 500 records with a 413", async () => {
    const { base } = await fixture();
    const records = Array.from({ length: 501 }, (_, index) => ({ type: "feat", name: `Feat ${index}` }));
    const response = await post(base, HOMEBREW_PATHS.packsImport, GM, {
      pack: { schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Huge", attribution: null, exportedAt: "2026-07-27T03:00:00.000Z", records }
    });
    expect(response.status).toBe(413);
  });
});

describe("homebrew HTTP envelope conventions", () => {
  it("honours a client v4 request id, mints one otherwise, and never caches", async () => {
    const { base } = await fixture();
    const supplied = "8f1c2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
    const response = await get(base, CONTENT, { ...GM, "x-request-id": supplied });
    expect(response.headers.get("x-request-id")).toBe(supplied);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // A non-UUID is not trusted into the log/correlation path.
    const minted = await get(base, CONTENT, { ...GM, "x-request-id": "../../etc/passwd" });
    expect(minted.headers.get("x-request-id")).not.toBe("../../etc/passwd");
    expect(minted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const failure = await body(await get(base, byId("hb-missing-000000"), { ...GM, "x-request-id": supplied }));
    expect(failure.error.requestId).toBe(supplied);
  });

  it("pings clients on every write and never on a read or a refused write", async () => {
    const { base, pings } = await fixture();
    const record = await createRecord(base);
    expect(pings).toHaveLength(1);
    await get(base, CONTENT, GM);
    await get(base, byId(record.id), GM);
    expect(pings).toHaveLength(1);
    await patch(base, byId(record.id), GM, { record: classBody("Stale"), expectedRev: 99 });
    // A refused write must not ping: every client would refetch an unchanged catalog.
    expect(pings).toHaveLength(1);
    await patch(base, byId(record.id), GM, { record: classBody("Real"), expectedRev: 1 });
    expect(pings).toEqual([1, 2]);
  });
});

describe("homebrew wiring in the real server", () => {
  it("mounts the router, initialises the store, and accepts a pack larger than the global 512kb body limit", async () => {
    // The isolated fixture above proves the router; this proves server.ts actually wires it - the
    // store's initialize(), the mount, and the pack parser sitting ABOVE the global express.json.
    const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-boot-"));
    const server = createAppServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const token = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    const base = `http://127.0.0.1:${address.port}`;
    cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const created = await post(base, CONTENT, auth, { record: classBody() });
    expect(created.status).toBe(201);
    const record = (await body(created)).data.record;
    expect((await body(await get(base, CONTENT, auth))).data.total).toBe(1);
    expect((await get(base, CONTENT, ANON)).status).toBe(401);

    // ~900kb of pack: past the global 512kb limit, inside the route-scoped 4mb one. Without the
    // ordering in server.ts this is a 413 and pack import is unusable for a real library.
    const filler = "x".repeat(3000);
    const records = Array.from({ length: 300 }, (_, index) => ({ type: "feat", name: `Feat ${index}`, description: filler }));
    const imported = await post(base, HOMEBREW_PATHS.packsImport, auth, {
      pack: { schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Big", attribution: null, exportedAt: "2026-07-27T03:00:00.000Z", records }
    });
    expect(imported.status).toBe(200);
    expect((await body(imported)).data.imported).toHaveLength(300);
    expect(record.id).toMatch(/^hb-blood-hunter-[0-9a-f]{6}$/);
  });
});
