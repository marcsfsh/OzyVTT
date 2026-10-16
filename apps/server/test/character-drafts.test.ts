import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { CharacterDraft } from "@vtt/domain";
import { CharacterDraftStore, draftOwnerOf } from "../src/character-drafts.js";
import { createServer } from "../src/server.js";

// The builder's parked drafts live on the server: one per player session and one for the GM, read back only by
// their owner, and never part of the game state the table receives.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "vtt-drafts-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** A wizard draft partway through: a Hill Dwarf Soldier Fighter with a name and two picks. */
const DRAFT: CharacterDraft = {
  version: 1,
  speciesId: "dwarf",
  backgroundId: "soldier",
  classId: "fighter",
  level: 3,
  subclassId: null,
  abilityMethod: "standard-array",
  abilityPool: [
    { id: "sa-0", value: 15 },
    { id: "sa-1", value: 14 }
  ],
  poolAssignment: { str: "sa-0", con: "sa-1" },
  spendScores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  backgroundBonus: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hpMode: "average",
  hpEntries: [],
  picks: { "class:fighter:skills": ["athletics", "perception"] },
  asiIncreases: {},
  name: "Brunhild"
};

describe("the draft store", () => {
  it("keeps one draft per owner, replaced on save and gone on discard", async () => {
    const store = new CharacterDraftStore(join(await directory(), "vtt.sqlite"));
    store.initialize();
    cleanups.push(async () => store.close());
    expect(store.get("gm")).toBeNull();
    store.save("gm", DRAFT, new Date("2026-10-16T10:00:00.000Z"));
    store.save("player:a", { ...DRAFT, name: "Ash" });
    expect(store.get("gm")).toEqual({ draft: DRAFT, updatedAt: "2026-10-16T10:00:00.000Z" });
    store.save("gm", { ...DRAFT, level: 4 }, new Date("2026-10-16T11:00:00.000Z"));
    expect(store.get("gm")).toEqual({ draft: { ...DRAFT, level: 4 }, updatedAt: "2026-10-16T11:00:00.000Z" });
    store.discard("gm");
    expect(store.get("gm")).toBeNull();
    expect(store.get("player:a")?.draft.name).toBe("Ash");
  });

  it("drops drafts untouched for 90 days at start-up, and reads one it can't parse as none", async () => {
    const path = join(await directory(), "vtt.sqlite");
    const first = new CharacterDraftStore(path);
    first.initialize();
    first.save("player:old", DRAFT, new Date("2026-01-01T00:00:00.000Z"));
    first.save("player:new", DRAFT, new Date("2026-10-01T00:00:00.000Z"));
    first.close();
    // An older wizard's shape, written straight into the table.
    const raw = new DatabaseSync(path);
    raw
      .prepare("INSERT INTO character_drafts (owner, draft_json, updated_at) VALUES (?, ?, ?)")
      .run("player:odd", JSON.stringify({ version: 1, race: "elf" }), "2026-10-01T00:00:00.000Z");
    raw.close();
    const second = new CharacterDraftStore(path);
    second.initialize(new Date("2026-10-16T00:00:00.000Z"));
    cleanups.push(async () => second.close());
    expect(second.get("player:old")).toBeNull();
    expect(second.get("player:new")).not.toBeNull();
    expect(second.get("player:odd")).toBeNull();
  });

  it("keys the GM's draft by the role, and a player's by the session", () => {
    expect(draftOwnerOf({ kind: "gm", sessionId: "s1" })).toBe("gm");
    expect(draftOwnerOf({ kind: "integration", credentialId: "c1", name: "Bot" })).toBe("gm");
    expect(draftOwnerOf({ kind: "player", sessionId: "s2" })).toBe("player:s2");
  });
});

describe("drafts over the API", () => {
  async function boot() {
    const path = await directory();
    const server = createServer({
      authPath: join(path, "auth.json"),
      databasePath: join(path, "vtt.sqlite"),
      integrationCredentialsPath: join(path, "integrations.sqlite"),
      mapAssetsPath: join(path, "map-assets"),
      webDist: join(path, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gm = (await server.auth.login("a sufficiently long GM password"))!;
    const playerA = server.auth.issuePlayerSession();
    const playerB = server.auth.issuePlayerSession();
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    cleanups.push(async () => server.close());
    const base = `http://127.0.0.1:${address.port}`;
    const call = async (token: string, method: "GET" | "POST", path: string, body?: object) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> } };
    };
    return { server, gm, playerA, playerB, call };
  }

  it("hands each owner back only their own draft, and never puts it in the game state", async () => {
    const { server, gm, playerA, playerB, call } = await boot();
    expect((await call(gm, "POST", GAME_PATHS.characterDraftSave, { draft: DRAFT })).status).toBe(200);
    expect(
      (await call(playerA, "POST", GAME_PATHS.characterDraftSave, { draft: { ...DRAFT, name: "Ash" } })).status
    ).toBe(200);

    expect((await call(gm, "GET", GAME_PATHS.characterDraft)).body.data).toMatchObject({ draft: { draft: DRAFT } });
    expect((await call(playerA, "GET", GAME_PATHS.characterDraft)).body.data).toMatchObject({
      draft: { draft: { name: "Ash" } }
    });
    expect((await call(playerB, "GET", GAME_PATHS.characterDraft)).body.data).toEqual({ draft: null });
    expect(JSON.stringify(server.store.snapshot)).not.toContain("Brunhild");

    expect((await call(playerA, "POST", GAME_PATHS.characterDraftDiscard, {})).status).toBe(200);
    expect((await call(playerA, "GET", GAME_PATHS.characterDraft)).body.data).toEqual({ draft: null });
    expect((await call(gm, "GET", GAME_PATHS.characterDraft)).body.data).toMatchObject({ draft: { draft: DRAFT } });
  });

  it("refuses a malformed draft, and a player's while the GM builds the characters", async () => {
    const { gm, playerA, call } = await boot();
    expect((await call(gm, "POST", GAME_PATHS.characterDraftSave, { draft: { ...DRAFT, level: 30 } })).status).toBe(
      400
    );
    await call(gm, "POST", GAME_PATHS.builderPolicy, {
      allowedAbilityMethods: ["standard-array"],
      customFormula: null,
      maxLevel: 20,
      playerBuilder: "gm-only"
    });
    expect((await call(playerA, "POST", GAME_PATHS.characterDraftSave, { draft: DRAFT })).status).toBe(403);
    expect((await call(gm, "POST", GAME_PATHS.characterDraftSave, { draft: DRAFT })).status).toBe(200);
  });
});
