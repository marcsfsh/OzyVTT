import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_PATHS, openApiDocument } from "@vtt/api-contract";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";

/**
 * The codex surface's CROSS-CUTTING contract, tested where the bytes leave the process: request-id echo,
 * the 401/403 split, integration-credential scopes, structured validation issues, `error.currentRevision`,
 * conditional reads, the sanitized 500 - and the Ajv cross-check that ties the published response schemas
 * to the projections that actually produce them.
 *
 * Kept in its own file rather than appended to `codex-http.test.ts`, which is already 1,800 lines of
 * per-feature viewer-safety cases. These claims are about the ROUTER, not about any one record type, and
 * a reader asking "what does a bad token get?" should not have to find the answer inside the quest suite.
 */

type Json = Record<string, unknown> & { [key: string]: any };

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
const READ_CREDENTIAL = { authorization: "Bearer int-codex:read", "content-type": "application/json" };
const WRITE_CREDENTIAL = { authorization: "Bearer int-codex:write", "content-type": "application/json" };
const ANONYMOUS = { "content-type": "application/json" };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()?.(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-conventions-"));
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-31T03:00:00.000Z"));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize(); await assets.initialize();
  const app = express(); app.use(express.json()); app.use(createCodexRouter({
    store, assets,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    // One credential per scope, so "holds codex:read" and "holds codex:write" are different tokens: a
    // verifier that ignored `scope` would make every scope assertion below vacuous.
    verifyIntegration: (token, scope) => (token === `int-${scope}` ? { id: "cred-1", name: "overlay" } : null),
    notifyChanged: () => {},
    issuePreviewSession: () => "preview-player-token"
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${port}`, store };
}

const send = (base: string, method: string, path: string, headers: Record<string, string>, payload?: unknown) =>
  fetch(`${base}${path}`, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
const get = (base: string, path: string, headers: Record<string, string>) => send(base, "GET", path, headers);
const post = (base: string, path: string, headers: Record<string, string>, payload: unknown) => send(base, "POST", path, headers, payload);
const patch = (base: string, path: string, headers: Record<string, string>, payload: unknown) => send(base, "PATCH", path, headers, payload);
const body = async (response: Response) => (await response.json()) as Json;

describe("codex request correlation (X-Request-Id)", () => {
  const CALLER_ID = "8f14e45f-ceea-4e78-b3d5-6f5a2f3f9d21";

  it("echoes a caller-supplied UUID on the header AND in the error body, so one id correlates both", async () => {
    const { base } = await fixture();
    const ok = await get(base, "/api/v1/codex/pages", { ...GM, "x-request-id": CALLER_ID });
    expect(ok.headers.get("x-request-id")).toBe(CALLER_ID);

    // The body half is the half that regressed: `failure()` used to re-read the response HEADER, which
    // only ever held the freshly minted id, so a caller who supplied one was answered with a different
    // one in the very payload they were correlating on.
    const failed = await post(base, "/api/v1/codex/pages", { ...GM, "x-request-id": CALLER_ID }, { title: "" });
    expect(failed.status).toBe(400);
    expect((await body(failed)).error.requestId).toBe(CALLER_ID);
  });

  it("replaces a value that is not a UUID v4 rather than echoing caller text into logs and error bodies", async () => {
    const { base } = await fixture();
    const response = await get(base, "/api/v1/codex/pages", { ...GM, "x-request-id": "../../etc/passwd" });
    const echoed = response.headers.get("x-request-id");
    expect(echoed).not.toBe("../../etc/passwd");
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("mints one when the caller sends none", async () => {
    const { base } = await fixture();
    const response = await get(base, "/api/v1/codex/pages", GM);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}-/i);
  });
});

/**
 * The rule, stated once: **401 is "no credential"; 403 is "you presented one and were refused".** Every
 * row below is one arm of it. The surface used to answer 401 to an authenticated player, which told a
 * caller who was already signed in to sign in - and a retrying client acts on that.
 */
describe("codex 401 vs 403", () => {
  it("answers 401 only for a missing or unparseable Authorization header", async () => {
    const { base } = await fixture();
    for (const headers of [ANONYMOUS, { ...ANONYMOUS, authorization: "Basic abc123" }, { ...ANONYMOUS, authorization: "gm-token" }]) {
      const response = await get(base, "/api/v1/codex/pages", headers);
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect((await body(response)).error.code).toBe("unauthenticated");
    }
  });

  it("answers 403 to every token that was presented and failed - player, junk, expired-looking, underscoped", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Keep" }));
    const pageId = created.data.page.id as string;
    for (const [label, headers, method, path, payload] of [
      ["player on a write", PLAYER, "POST", "/api/v1/codex/pages", { title: "Nope" }],
      ["player on a GM-grade read", PLAYER, "GET", "/api/v1/codex/settings", undefined],
      ["player on the reveal audit", PLAYER, "GET", "/api/v1/codex/reveal-audit", undefined],
      ["junk bearer on a role read", { ...ANONYMOUS, authorization: "Bearer nonsense" }, "GET", "/api/v1/codex/pages", undefined],
      ["codex:read on a write", READ_CREDENTIAL, "PATCH", `/api/v1/codex/pages/${pageId}`, { title: "Mine" }],
      ["codex:write on a read", WRITE_CREDENTIAL, "GET", "/api/v1/codex/pages", undefined]
    ] as const) {
      const response = await send(base, method, path, headers as Record<string, string>, payload);
      expect(response.status, label).toBe(403);
      expect((await body(response)).error.code, label).toBe("forbidden");
    }
    // ...and none of those refusals changed anything.
    expect((await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM))).data.page.title).toBe("Keep");
  });

  it("keeps 404-not-403 for a record a player may not see - a different axis, and it does not move", async () => {
    const { base } = await fixture();
    const secret = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Cult", gmBody: "Meets under the inn." }));
    const response = await get(base, `/api/v1/codex/pages/${secret.data.page.id}`, PLAYER);
    expect(response.status).toBe(404);
    expect((await body(response)).error.code).toBe("not_found");
  });
});

describe("codex integration credentials", () => {
  it("gives a codex:read credential the GM projection, not the player one", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, { title: "The Cult", playerBody: "A rumour.", gmBody: "Meets under the inn." });

    const asCredential = await body(await get(base, "/api/v1/codex/pages", READ_CREDENTIAL));
    const asGm = await body(await get(base, "/api/v1/codex/pages", GM));
    // Byte-identical to the GM's own read: an integration credential is the GM's automation, and the
    // whole point of the scope is that a tool no longer has to borrow the GM's session token to get this.
    expect(asCredential).toEqual(asGm);
    expect(asCredential.data.pages[0].revealedToPlayers).toBe(false);

    // An UNREVEALED page: a player would 404 here, the credential reads it whole, `gmBody` included.
    const pageId = asGm.data.pages[0].id as string;
    const document = await body(await get(base, `/api/v1/codex/pages/${pageId}`, READ_CREDENTIAL));
    expect(document.data.page.gmBody).toBe("Meets under the inn.");
    expect((await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER)).status).toBe(404);
  });

  it("lets a codex:write credential author, and refuses each credential the other's grade", async () => {
    const { base } = await fixture();
    const created = await post(base, "/api/v1/codex/pages", WRITE_CREDENTIAL, { title: "Written by a bot" });
    expect(created.status).toBe(201);
    expect((await body(created)).data.page.title).toBe("Written by a bot");
    // codex:write does not imply codex:read: scopes are independent everywhere else in this API, and a
    // write-only automation that could also read the GM's secrets would be a scope that means nothing.
    expect((await get(base, "/api/v1/codex/pages", WRITE_CREDENTIAL)).status).toBe(403);
    expect((await post(base, "/api/v1/codex/pages", READ_CREDENTIAL, { title: "no" })).status).toBe(403);
  });

  it("refuses a credential the one route that mints a player session, however it is scoped", async () => {
    const { base } = await fixture();
    for (const headers of [READ_CREDENTIAL, WRITE_CREDENTIAL]) {
      const response = await post(base, "/api/v1/codex/preview-session", headers, {});
      expect(response.status).toBe(403);
    }
    expect((await post(base, "/api/v1/codex/preview-session", GM, {})).status).toBe(201);
  });
});

describe("codex error envelopes", () => {
  it("reports EVERY validation issue with its path, not just the first", async () => {
    const { base } = await fixture();
    const response = await post(base, "/api/v1/codex/pages", GM, { title: "", folder: 7, notAField: true });
    expect(response.status).toBe(400);
    const failed = await body(response);
    expect(failed.error.code).toBe("validation_failed");
    // The human line stays the first issue; the machine list carries all of them.
    expect(typeof failed.error.message).toBe("string");
    const issues = failed.error.details.issues as Array<{ path: string[]; message: string }>;
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining(["title", "folder"]));
    // The unknown key is NAMED, which is what makes a `.strict()` body debuggable from a curl session.
    expect(JSON.stringify(issues)).toContain("notAField");
  });

  it("carries error.currentRevision on a stale expectedRev, and NOT on a state-machine 409", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Keep" }));
    const pageId = created.data.page.id as string;
    await patch(base, `/api/v1/codex/pages/${pageId}`, GM, { title: "Keep II" });
    const current = (await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM))).data.page.rev as number;

    const stale = await patch(base, `/api/v1/codex/pages/${pageId}`, GM, { title: "Keep III", expectedRev: 0 });
    expect(stale.status).toBe(409);
    // The number a client needs to rebase on, so recovering from a lost race takes no extra round-trip.
    expect((await body(stale)).error.currentRevision).toBe(current);

    // A refusal that is NOT a lost race carries none: there is no revision to rebase onto, and sending
    // one would invite a client to retry something that will never succeed.
    await send(base, "PUT", "/api/v1/codex/calendar", GM, { yearName: "AE", months: [{ name: "Rise", days: 30 }], weekdays: ["Sol"], currentDate: { year: 1492, month: 0, day: 1 } });
    const downtime = await body(await post(base, "/api/v1/codex/journal/downtime", GM, { downtime: { who: "Brannor", activity: "Forging", days: 8 } }));
    const entryId = downtime.data.entry.id as string;
    expect((await post(base, `/api/v1/codex/journal/${entryId}/apply-downtime`, GM, {})).status).toBe(200);
    const twice = await post(base, `/api/v1/codex/journal/${entryId}/apply-downtime`, GM, {});
    expect(twice.status).toBe(409);
    expect((await body(twice)).error).not.toHaveProperty("currentRevision");
  });

  it("does not forward an internal error's message - that text names tables, columns and file paths", async () => {
    const { base, store } = await fixture();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "SQLITE_CORRUPT: database disk image is malformed: /srv/vtt/data/vtt.sqlite";
    (store as unknown as { listFolders: () => never }).listFolders = () => { throw new Error(secret); };

    const response = await get(base, "/api/v1/codex/folders", GM);
    expect(response.status).toBe(500);
    const failed = await body(response);
    expect(failed.error.code).toBe("internal_error");
    expect(failed.error.message).toBe("The codex request failed.");
    expect(JSON.stringify(failed)).not.toContain("SQLITE_CORRUPT");
    expect(JSON.stringify(failed)).not.toContain("/srv/vtt/data");
    // Sanitized OUT, not swallowed: the real error still reaches the operator's log.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("codex conditional reads (weak ETag + 304)", () => {
  it("answers 304 to an unchanged conditional read and 200 with a new tag after a write", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, { title: "Keep" });

    const first = await get(base, "/api/v1/codex/pages", GM);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"codex-r\d+-gm"$/);

    const conditional = await get(base, "/api/v1/codex/pages", { ...GM, "if-none-match": etag as string });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");

    await post(base, "/api/v1/codex/pages", GM, { title: "Another" });
    const afterWrite = await get(base, "/api/v1/codex/pages", { ...GM, "if-none-match": etag as string });
    expect(afterWrite.status).toBe(200);
    expect(afterWrite.headers.get("etag")).not.toBe(etag);
  });

  it("bumps the tag on a REVEAL, which changes what a player sees without changing any record's rev", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Keep" }));
    const before = (await get(base, "/api/v1/codex/pages", PLAYER)).headers.get("etag");
    await post(base, `/api/v1/codex/pages/${created.data.page.id}/reveal`, GM, { revealed: true });
    const after = await get(base, "/api/v1/codex/pages", { ...PLAYER, "if-none-match": before as string });
    expect(after.status).toBe(200);
    expect((await body(after)).data.pages).toHaveLength(1);
  });

  it("tags GM and player reads differently, so one cached answer can never be served to the other role", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, { title: "Keep" });
    const gmTag = (await get(base, "/api/v1/codex/pages", GM)).headers.get("etag");
    const playerTag = (await get(base, "/api/v1/codex/pages", PLAYER)).headers.get("etag");
    expect(gmTag).not.toBe(playerTag);
    // Presenting the GM's tag as a player is a cache miss, not a 304 - the bodies genuinely differ.
    expect((await get(base, "/api/v1/codex/pages", { ...PLAYER, "if-none-match": gmTag as string })).status).toBe(200);
    // A credential reads at GM grade, so it shares the GM tag rather than minting a third one.
    expect((await get(base, "/api/v1/codex/pages", READ_CREDENTIAL)).headers.get("etag")).toBe(gmTag);
  });

  /**
   * The gate-before-tag rule, which is the viewer-safety half of this feature. A conditional request is
   * checked at SERIALIZATION, after authorization and existence - so a probe can never turn a 404 into a
   * 304 and thereby confirm that a record the caller may not see exists and has not changed.
   */
  it("still 404s a player's conditional probe of a hidden record, and 403s an unauthorized one", async () => {
    const { base } = await fixture();
    const secret = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Cult" }));
    const secretId = secret.data.page.id as string;
    const gmTag = (await get(base, `/api/v1/codex/pages/${secretId}`, GM)).headers.get("etag");

    expect((await get(base, `/api/v1/codex/pages/${secretId}`, { ...PLAYER, "if-none-match": gmTag as string })).status).toBe(404);
    expect((await get(base, "/api/v1/codex/settings", { ...PLAYER, "if-none-match": gmTag as string })).status).toBe(403);
    expect((await get(base, "/api/v1/codex/pages", { ...ANONYMOUS, "if-none-match": gmTag as string })).status).toBe(401);
  });
});

/**
 * The permanent guard on the role-projected schemas: Ajv-validate REAL serialized responses, for BOTH
 * roles, against the response components the served document publishes.
 *
 * Why this and not a schema-shape test. The contract's player components are hand-written mirrors of
 * `codex-projections.ts`; a mirror drifts the moment the projection gains or loses a key, and nothing
 * else in the suite would notice - the projection tests assert the projection, the contract tests assert
 * the document, and the gap between them is exactly where a documented lie lives. Because every codex
 * read component is `additionalProperties: false` with all keys required, a drift in EITHER direction
 * (a field the contract promises and the projection dropped, or a field the projection added and the
 * contract does not declare) fails here.
 */
describe("codex responses validate against the schemas the document publishes", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
  const validatorFor = (component: string) => ajv.compile({ $ref: `openapi#/components/schemas/${component}` });
  /** The 200 response component the document declares for this GET - read from the document, never restated. */
  const documentedResponse = (contractPath: string) => {
    const operation = (openApiDocument.paths as unknown as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>)[contractPath].get;
    const ref = operation.responses["200"].content?.["application/json"]?.schema?.$ref;
    if (!ref) throw new Error(`no documented 200 JSON schema for GET ${contractPath}`);
    return ref.replace("#/components/schemas/", "");
  };
  const check = (component: string, payload: unknown, label: string) => {
    const validate = validatorFor(component);
    expect(validate(payload), `${label} must match ${component}: ${ajv.errorsText(validate.errors, { separator: "; " })}`).toBe(true);
  };

  /** A codex with one of everything, revealed, so a PLAYER read is non-empty and actually gets validated. */
  async function populated() {
    const { base, store } = await fixture();
    const reveal = (path: string) => post(base, path, GM, { revealed: true });

    await post(base, "/api/v1/codex/calendar", GM, {}).catch(() => undefined);
    await send(base, "PUT", "/api/v1/codex/calendar", GM, {
      yearName: "AE",
      months: [{ name: "Rise", days: 30 }, { name: "Fall", days: 30 }],
      weekdays: ["Sol", "Lun"],
      currentDate: { year: 1492, month: 0, day: 10 }
    });
    await post(base, "/api/v1/codex/calendar/publish", GM, {});

    // The Harpers first: a `[[wiki link]]` to a title no page carries yields no edge, so a page written
    // before its target would leave the link feeds empty and make their validation below vacuous.
    const faction = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Harpers", entityType: "faction", playerBody: "Meddlers." }));
    const factionId = faction.data.page.id as string;
    await reveal(`/api/v1/codex/pages/${factionId}/reveal`);
    const shown = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Barovia", entityType: "location", playerBody: "A misty valley. See [[The Harpers]].", gmBody: "The mists are alive.", tags: ["valley"], fields: { ruler: "Strahd" }, gmFields: { secret: "yes" }, inWorldDate: { year: 1492, month: 0, day: 3 } }));
    const shownId = shown.data.page.id as string;
    await reveal(`/api/v1/codex/pages/${shownId}/reveal`);
    await post(base, "/api/v1/codex/pages", GM, { title: "The Cult", gmBody: "Meets under the inn." });
    await post(base, `/api/v1/codex/pages/${shownId}/relationships`, GM, { toPageId: factionId, type: "ally" });
    await post(base, "/api/v1/codex/folders", GM, { path: "Places" });

    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: crypto.randomUUID(), name: "Barovia", kind: "regional", tags: ["realm"] }));
    const mapId = map.data.map.id as string;
    await reveal(`/api/v1/codex/maps/${mapId}/reveal`);
    const marker = await body(await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label: "Village", pageIds: [shownId], tags: ["stop"] }));
    const markerId = marker.data.marker.id as string;
    await reveal(`/api/v1/codex/markers/${markerId}/reveal`);
    await send(base, "PUT", `/api/v1/codex/markers/${markerId}/party`, GM, { isParty: true });

    const session = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 4, realDate: "2026-07-30", recapBody: "They reached the gates.", prepBody: "Strahd watches.", attendees: ["Ana"], status: "played" }));
    const sessionId = session.data.session.id as string;
    await reveal(`/api/v1/codex/sessions/${sessionId}/reveal`);

    const quest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "Find the amulet", playerBody: "Search the crypt.", gmBody: "It is a fake.", objectives: [{ text: "Enter the crypt", done: false }], entityIds: [shownId] }));
    const questId = quest.data.quest.id as string;
    await reveal(`/api/v1/codex/quests/${questId}/reveal`);

    const note = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "The gates opened.", gmText: "Strahd allowed it.", tags: ["arrival"], attachPageId: shownId, inWorldDate: { year: 1492, month: 0, day: 4 } }));
    await reveal(`/api/v1/codex/journal/${note.data.entry.id}/reveal`);
    const downtime = await body(await post(base, "/api/v1/codex/journal/downtime", GM, { playerText: "A week of work.", downtime: { who: "Brannor", activity: "Forging", days: 7 } }));
    await reveal(`/api/v1/codex/journal/${downtime.data.entry.id}/reveal`);
    const milestone = await body(await post(base, "/api/v1/codex/journal/milestone", GM, { playerText: "Level up.", milestone: { level: 5, reason: "cleared the crypt" } }));
    await reveal(`/api/v1/codex/journal/${milestone.data.entry.id}/reveal`);
    await post(base, "/api/v1/codex/journal/deadline", GM, { playerText: "The moon turns.", revealedToPlayers: true, inWorldDate: { year: 1492, month: 1, day: 1 } });

    await send(base, "PUT", `/api/v1/codex/standing/${factionId}`, GM, { value: -40, reason: "Killed their envoy" });
    await reveal(`/api/v1/codex/standing/${factionId}/reveal`);
    // The `standing` CHRONICLE record is written hidden; reveal it so the player payload branch is exercised.
    const entries = (await body(await get(base, "/api/v1/codex/journal", GM))).data.entries as Json[];
    for (const entry of entries.filter((row) => row.kind === "standing")) await reveal(`/api/v1/codex/journal/${entry.id}/reveal`);

    return { base, store, shownId, mapId, markerId, sessionId, questId };
  }

  it("validates every role-projected read, for a GM and for a player, against its published schema", async () => {
    const { base, shownId, mapId, markerId, sessionId, questId } = await populated();
    // The third element names a list `data` key that must be NON-EMPTY for both roles. A schema check
    // over an empty array proves nothing, and "the player got nothing back" is precisely how a
    // role-projected read test passes while describing a projection it never exercised.
    const reads: ReadonlyArray<readonly [string, string, string?]> = [
      [CODEX_PATHS.pages, "/api/v1/codex/pages", "pages"],
      [CODEX_PATHS.pageById, `/api/v1/codex/pages/${shownId}`, "relationships"],
      [CODEX_PATHS.pageMarkers, `/api/v1/codex/pages/${shownId}/markers`, "markers"],
      [CODEX_PATHS.mapMarkers, `/api/v1/codex/maps/${mapId}/markers`, "markers"],
      [CODEX_PATHS.maps, "/api/v1/codex/maps", "maps"],
      [CODEX_PATHS.relationships, "/api/v1/codex/relationships", "relationships"],
      [CODEX_PATHS.links, "/api/v1/codex/links", "links"],
      [CODEX_PATHS.journal, "/api/v1/codex/journal", "entries"],
      [CODEX_PATHS.timeline, "/api/v1/codex/timeline", "records"],
      [CODEX_PATHS.sessions, "/api/v1/codex/sessions", "sessions"],
      [CODEX_PATHS.sessionById, `/api/v1/codex/sessions/${sessionId}`],
      [CODEX_PATHS.quests, "/api/v1/codex/quests", "quests"],
      [CODEX_PATHS.questById, `/api/v1/codex/quests/${questId}`],
      [CODEX_PATHS.standing, "/api/v1/codex/standing", "standing"],
      [CODEX_PATHS.calendar, "/api/v1/codex/calendar"],
      [CODEX_PATHS.search, "/api/v1/codex/search?q=barovia", "hits"],
      // D15's two new role-projected reads. Both are seeded in `populated()` above: the marker is
      // revealed on a revealed map, and it carries the party flag, so BOTH roles get a non-null body and
      // the player branch of each component is genuinely exercised rather than trivially satisfied.
      [CODEX_PATHS.markerById, `/api/v1/codex/markers/${markerId}`],
      [CODEX_PATHS.party, "/api/v1/codex/party"]
    ];
    for (const [contractPath, url, nonEmpty] of reads) {
      const component = documentedResponse(contractPath);
      for (const [role, headers] of [["gm", GM], ["player", PLAYER]] as const) {
        const response = await get(base, url, headers);
        expect(response.status, `${role} GET ${url}`).toBe(200);
        const payload = await body(response);
        check(component, payload, `${role} GET ${url}`);
        if (nonEmpty) expect((payload.data[nonEmpty] as unknown[]).length, `${role} GET ${url} -> data.${nonEmpty} must not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("validates every GM-grade read against its published schema", async () => {
    const { base, shownId } = await populated();
    for (const [contractPath, url] of [
      [CODEX_PATHS.folders, "/api/v1/codex/folders"],
      [CODEX_PATHS.pageRevisions, `/api/v1/codex/pages/${shownId}/revisions`],
      [CODEX_PATHS.revealAudit, "/api/v1/codex/reveal-audit"],
      [CODEX_PATHS.settings, "/api/v1/codex/settings"],
      [CODEX_PATHS.export, "/api/v1/codex/export"]
    ] as const) {
      const response = await get(base, url, GM);
      expect(response.status, `GET ${url}`).toBe(200);
      check(documentedResponse(contractPath), await body(response), `GET ${url}`);
    }
  });

  /**
   * `oneOf` guarantees "exactly one branch", so the test above already proves a body is not ambiguous.
   * This adds the claim that matters for viewer safety: the GM body matches the GM branch and is REJECTED
   * by the player branch. A player component that had quietly widened to accept a GM body would still
   * satisfy `oneOf` on the player's own response, and this is what catches it.
   */
  it("matches each role's body to its OWN branch, and the other branch rejects it", async () => {
    const { base, shownId } = await populated();
    for (const [wrapper, url, key] of [
      ["CodexPage", `/api/v1/codex/pages/${shownId}`, "page"],
      ["CodexCalendar", "/api/v1/codex/calendar", "calendar"]
    ] as const) {
      const gmRecord = (await body(await get(base, url, GM))).data[key];
      const playerRecord = (await body(await get(base, url, PLAYER))).data[key];
      const gmBranch = validatorFor(wrapper);
      const playerBranch = validatorFor(`${wrapper}Player`);
      expect(gmBranch(gmRecord), `${wrapper}: ${ajv.errorsText(gmBranch.errors)}`).toBe(true);
      expect(playerBranch(gmRecord), `${wrapper}Player must REJECT a GM body`).toBe(false);
      expect(playerBranch(playerRecord), `${wrapper}Player: ${ajv.errorsText(playerBranch.errors)}`).toBe(true);
      expect(gmBranch(playerRecord), `${wrapper} must REJECT a player body`).toBe(false);
    }
  });
});
