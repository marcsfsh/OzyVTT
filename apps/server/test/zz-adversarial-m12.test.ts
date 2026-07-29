import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-adv-m12-"));
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize(); await assets.initialize();
  const app = express(); app.use(express.json()); app.use(createCodexRouter({
    store, assets,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    notifyChanged: () => {},
    issuePreviewSession: () => "preview"
  }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no bind");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, store };
}

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
type Json = Record<string, any>;
const get = (base: string, path: string, headers: Record<string, string>) => fetch(`${base}${path}`, { headers });
const post = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
const put = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(payload) });
const patch = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
async function json(r: Response) { return await r.json() as Json; }

describe("ADVERSARIAL M12", () => {
  it("audit vs real player endpoints, all seven kinds, nasty combinations", async () => {
    const { base, store } = await fixture();

    // ---- pages
    const mkPage = async (title: string, entityType: string, revealed: boolean) => {
      const p = await json(await post(base, "/api/v1/codex/pages", GM, { title, entityType }));
      const id = p.data.page.id as string;
      if (revealed) await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
      return id;
    };
    const openFaction = await mkPage("Harpers", "faction", true);
    const secretFaction = await mkPage("Zhentarim", "faction", false);
    const openPlace = await mkPage("Barovia town", "location", true);
    const secretPlace = await mkPage("Amber Temple", "location", false);

    // ---- maps: open root, secret root, revealed CHILD of a secret parent
    const mkMap = async (name: string, revealed: boolean, parent?: string) => {
      const m = await json(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name, kind: "regional" }));
      const id = m.data.map.id as string;
      if (parent) await post(base, `/api/v1/codex/maps/${id}/parent`, GM, { parentMapId: parent });
      if (revealed) await post(base, `/api/v1/codex/maps/${id}/reveal`, GM, { revealed: true });
      return id;
    };
    const openMap = await mkMap("Overworld", true);
    const secretMap = await mkMap("Underdark", false);
    const revealedChildOfSecret = await mkMap("Sunless Citadel", true, secretMap);

    // ---- markers
    const mkMarker = async (mapId: string, label: string, revealed: boolean, extra: Json = {}) => {
      const m = await json(await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label, revealedToPlayers: revealed, ...extra }));
      return m.data.marker.id as string;
    };
    const openPin = await mkMarker(openMap, "Camp", true, { pageIds: [openPlace, secretPlace] });
    const hiddenPin = await mkMarker(openMap, "Ambush", false);
    const revealedPinOnSecretMap = await mkMarker(secretMap, "Party HQ", true);
    const pinOnRevealedChild = await mkMarker(revealedChildOfSecret, "Well", true);
    // the party pin lives on the SECRET map first
    await put(base, `/api/v1/codex/markers/${revealedPinOnSecretMap}/party`, GM, { isParty: true });

    // ---- journal
    const mkEntry = async (text: string, revealed: boolean) => {
      const e = await json(await post(base, "/api/v1/codex/journal", GM, { playerText: text, gmText: "secret", revealedToPlayers: revealed }));
      return e.data.entry.id as string;
    };
    const openEntry = await mkEntry("We arrived", true);
    await mkEntry("The lich watches", false);
    const ms = await json(await post(base, "/api/v1/codex/journal/milestone", GM, { playerText: "Level up", milestone: { level: 4, reason: "cleared the crypt" } }));
    const milestoneId = ms.data.entry.id as string;
    await post(base, `/api/v1/codex/journal/${milestoneId}/reveal`, GM, { revealed: true });

    // ---- sessions
    const s1 = await json(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1, recapBody: "First night" }));
    const openSession = s1.data.session.id as string;
    await post(base, `/api/v1/codex/sessions/${openSession}/reveal`, GM, { revealed: true });
    await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 2, recapBody: "hidden" });

    // ---- quests
    const q1 = await json(await post(base, "/api/v1/codex/quests", GM, { title: "Find the sword", entityIds: [openPlace, secretPlace] }));
    const openQuest = q1.data.quest.id as string;
    await post(base, `/api/v1/codex/quests/${openQuest}/reveal`, GM, { revealed: true });
    await post(base, "/api/v1/codex/quests", GM, { title: "Secret quest" });

    // ---- standing: revealed standing on a REVEALED faction, revealed standing on a SECRET faction
    await put(base, `/api/v1/codex/standing/${openFaction}`, GM, { value: -40, reason: "killed their envoy" });
    await post(base, `/api/v1/codex/standing/${openFaction}/reveal`, GM, { revealed: true });
    await put(base, `/api/v1/codex/standing/${secretFaction}`, GM, { value: 70, reason: "paid the toll" });
    await post(base, `/api/v1/codex/standing/${secretFaction}/reveal`, GM, { revealed: true });

    // reveal the two auto-written standing chronicle records so a player sees them
    const gmTimeline = (await json(await get(base, "/api/v1/codex/timeline", GM))).data.records as Json[];
    const standingRecords = gmTimeline.filter((r) => r.kind === "standing");
    expect(standingRecords).toHaveLength(2);
    for (const r of standingRecords) await post(base, `/api/v1/codex/journal/${r.id}/reveal`, GM, { revealed: true });

    // ================= THE COMPARISON =================
    const audit = (await json(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as Json;
    const section = (k: string) => audit.sections.find((s: Json) => s.kind === k) as Json;
    const idsOf = (k: string) => (section(k).rows as Json[]).map((r) => r.id).sort();

    // pages
    const playerPages = (await json(await get(base, "/api/v1/codex/pages", PLAYER))).data.pages as Json[];
    expect(idsOf("page")).toEqual(playerPages.map((p) => p.id).sort());

    // maps
    const playerMaps = (await json(await get(base, "/api/v1/codex/maps", PLAYER))).data.maps as Json[];
    expect(idsOf("map")).toEqual(playerMaps.map((m) => m.id).sort());

    // markers: everything a player can actually reach, via every player route that yields markers
    const reachable = new Set<string>();
    for (const m of playerMaps) {
      const r = await get(base, `/api/v1/codex/maps/${m.id}/markers`, PLAYER);
      if (r.status === 200) for (const mk of (await json(r)).data.markers as Json[]) reachable.add(mk.id);
    }
    for (const p of playerPages) {
      const r = await get(base, `/api/v1/codex/pages/${p.id}/markers`, PLAYER);
      if (r.status === 200) for (const mk of (await json(r)).data.markers as Json[]) reachable.add(mk.id);
    }
    expect(idsOf("marker")).toEqual([...reachable].sort());
    expect(reachable.has(revealedPinOnSecretMap)).toBe(false);
    expect(reachable.has(hiddenPin)).toBe(false);
    expect(reachable.has(pinOnRevealedChild)).toBe(true);
    expect(reachable.has(openPin)).toBe(true);

    // journal
    const playerEntries = (await json(await get(base, "/api/v1/codex/journal", PLAYER))).data.entries as Json[];
    expect(idsOf("journal")).toEqual(playerEntries.map((e) => e.id).sort());
    // and against the chronicle route too
    const playerChronicle = (await json(await get(base, "/api/v1/codex/timeline", PLAYER))).data.records as Json[];
    const chronicleEntryIds = playerChronicle.filter((r) => r.kind !== "event").map((r) => r.id).sort();
    expect(idsOf("journal")).toEqual(chronicleEntryIds);

    // sessions
    const playerSessions = (await json(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions as Json[];
    expect(idsOf("session")).toEqual(playerSessions.map((s) => s.id).sort());

    // quests
    const playerQuests = (await json(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests as Json[];
    expect(idsOf("quest")).toEqual(playerQuests.map((q) => q.id).sort());

    // standing
    const playerStanding = (await json(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as Json[];
    expect(idsOf("standing")).toEqual(playerStanding.map((s) => s.factionPageId).sort());
    expect(playerStanding).toHaveLength(1);

    // ---- what does the audit CALL these rows? (blank titles are a real UX defect)
    const titles = Object.fromEntries(audit.sections.map((s: Json) => [s.kind, (s.rows as Json[]).map((r) => r.title)]));
    console.log("AUDIT TITLES", JSON.stringify(titles, null, 1));
    console.log("AUDIT TOTALS", JSON.stringify(audit.sections.map((s: Json) => [s.kind, s.revealed, s.total])));

    // ---- does an unrevealed faction's REASON reach a player through the chronicle payload?
    console.log("PLAYER CHRONICLE", JSON.stringify(playerChronicle, null, 1));
    const bodyText = JSON.stringify(playerChronicle);
    console.log("LEAK? secret faction reason reaches player:", bodyText.includes("paid the toll"), "| secret faction id present:", bodyText.includes(secretFaction));

    // ---- search: can a player find the secret map's revealed party pin?
    const hits = (await json(await get(base, "/api/v1/codex/search?q=Party", PLAYER))).data.hits as Json[];
    expect(hits.map((h) => h.id)).not.toContain(revealedPinOnSecretMap);

    void store; void openEntry; void openFaction;
  });
});
