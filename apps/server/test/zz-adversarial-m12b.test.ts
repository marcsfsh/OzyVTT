import { createServer } from "node:http";
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
  const directory = await mkdtemp(join(tmpdir(), "vtt-adv2-"));
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize(); await assets.initialize();
  const app = express(); app.use(express.json()); app.use(createCodexRouter({
    store, assets,
    authorizeGm: (t) => t === "gm-token", authorizePlayer: (t) => t === "player-token",
    notifyChanged: () => {}, issuePreviewSession: () => "p"
  }));
  const server = createServer(app); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address(); if (!a || typeof a === "string") throw new Error("no bind");
  cleanups.push(async () => { await new Promise<void>((r) => server.close(() => r())); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${a.port}`, store };
}
const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
type J = Record<string, any>;
const get = (b: string, p: string, h: Record<string, string>) => fetch(`${b}${p}`, { headers: h });
const post = (b: string, p: string, h: Record<string, string>, x: unknown) => fetch(`${b}${p}`, { method: "POST", headers: h, body: JSON.stringify(x) });
const put = (b: string, p: string, h: Record<string, string>, x: unknown) => fetch(`${b}${p}`, { method: "PUT", headers: h, body: JSON.stringify(x) });
const patch = (b: string, p: string, h: Record<string, string>, x: unknown) => fetch(`${b}${p}`, { method: "PATCH", headers: h, body: JSON.stringify(x) });
async function j(r: Response) { return await r.json() as J; }

describe("ADVERSARIAL M12 part 2", () => {
  it("raw 400 for an over-long reason (the client Input has no maxLength)", async () => {
    const { base } = await fixture();
    const p = await j(await post(base, "/api/v1/codex/pages", GM, { title: "Harpers", entityType: "faction" }));
    const id = p.data.page.id;
    const r = await put(base, `/api/v1/codex/standing/${id}`, GM, { value: 10, reason: "x".repeat(121) });
    console.log("REASON>120 status:", r.status, "body:", JSON.stringify(await j(r)));
    const r2 = await put(base, `/api/v1/codex/standing/${id}`, GM, { value: 10, reason: "x".repeat(120) });
    console.log("REASON=120 status:", r2.status);
    expect(true).toBe(true);
  });

  it("a non-faction page produces a raw 400", async () => {
    const { base } = await fixture();
    const p = await j(await post(base, "/api/v1/codex/pages", GM, { title: "Strahd", entityType: "character" }));
    const r = await put(base, `/api/v1/codex/standing/${p.data.page.id}`, GM, { value: 10, reason: "x" });
    console.log("NON-FACTION status:", r.status, JSON.stringify(await j(r)));
    expect(true).toBe(true);
  });

  it("DESYNC: a standing survives its page's entityType changing away from faction", async () => {
    const { base } = await fixture();
    const p = await j(await post(base, "/api/v1/codex/pages", GM, { title: "Harpers", entityType: "faction" }));
    const id = p.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
    await put(base, `/api/v1/codex/standing/${id}`, GM, { value: -80, reason: "betrayed" });
    await post(base, `/api/v1/codex/standing/${id}/reveal`, GM, { revealed: true });

    const changed = await patch(base, `/api/v1/codex/pages/${id}`, GM, { entityType: "character" });
    console.log("PATCH entityType status:", changed.status, "-> entityType:", (await j(changed)).data?.page?.entityType);

    const gmStanding = (await j(await get(base, "/api/v1/codex/standing", GM))).data.standing as J[];
    const playerStanding = (await j(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as J[];
    console.log("GM standing rows still:", gmStanding.length, "| PLAYER standing rows still:", playerStanding.length);
    const pages = (await j(await get(base, "/api/v1/codex/pages", GM))).data.pages as J[];
    console.log("GM card faction rows:", pages.filter((pg) => pg.entityType === "faction").length);
    const reset = await put(base, `/api/v1/codex/standing/${id}`, GM, { value: 0, reason: "reset" });
    console.log("GM attempt to reset it:", reset.status, JSON.stringify(await j(reset)));
    const audit = (await j(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as J;
    console.log("audit standing section:", JSON.stringify(audit.sections.find((s: J) => s.kind === "standing")));
    expect(true).toBe(true);
  });

  it("a standing chronicle record's audit row is blank, and cannot be given prose", async () => {
    const { base, store } = await fixture();
    const p = await j(await post(base, "/api/v1/codex/pages", GM, { title: "Harpers", entityType: "faction" }));
    const id = p.data.page.id as string;
    await put(base, `/api/v1/codex/standing/${id}`, GM, { value: -80, reason: "GM-ONLY-SOUNDING REASON" });
    const rec = store.listTimeline().find((e) => e.kind === "standing")!;
    await post(base, `/api/v1/codex/journal/${rec.id}/reveal`, GM, { revealed: true });
    const audit = (await j(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as J;
    console.log("AUDIT journal rows:", JSON.stringify((audit.sections.find((s: J) => s.kind === "journal") as J).rows));
    const r = await patch(base, `/api/v1/codex/journal/${rec.id}`, GM, { playerText: "The Harpers turned on us." });
    console.log("PATCH standing record playerText status:", r.status);
    const audit2 = (await j(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as J;
    console.log("AUDIT journal rows after patch:", JSON.stringify((audit2.sections.find((s: J) => s.kind === "journal") as J).rows));
    expect(true).toBe(true);
  });
});
