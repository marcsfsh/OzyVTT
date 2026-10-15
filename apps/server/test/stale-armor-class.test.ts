import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import { InventoryItemSchema } from "@vtt/schemas";
import { reconcileArmorClasses, storedDefinition } from "../src/actor-roster.js";
import type { EquipmentCatalog } from "../src/equipment-derivation.js";
import { createInitialGameState } from "../src/initial-game-state.js";
import { createServer } from "../src/server.js";
import { equipmentRecord } from "./catalog-records.js";

const RING = "Ward Ring";
const RING_ID = "hb-ward-ring";
const ringWith = (amount: number, id = RING_ID) => ({
  id,
  name: RING,
  category: "ring",
  slot: "ring",
  costGp: null,
  weightLb: null,
  description: null,
  modifiers: [{ type: "armor-class", amount }]
});
const catalogOf = (amount: number): EquipmentCatalog => {
  const record = equipmentRecord(ringWith(amount));
  return { equipmentRecord: (id: string) => (id === RING_ID ? record : undefined) } as EquipmentCatalog;
};

const worn = (id: string) => InventoryItemSchema.parse({ id, name: RING, equipped: true });

/** The seed table with Borin wearing the ring. */
function tableWithRing() {
  const state = createInitialGameState();
  const borin = state.actors.find((actor) => actor.name === "Borin Stoneguard")!;
  borin.inventory = [...borin.inventory, worn(RING_ID)];
  return { state, borinId: borin.id };
}

describe("re-deriving stored armor classes from current content", () => {
  it("moves an AC whose item rider changed, and reports nothing on a second pass", () => {
    const { state, borinId } = tableWithRing();
    const resolve = (definitionId: string) => storedDefinition(state, definitionId);
    reconcileArmorClasses(state, resolve, catalogOf(1));
    const atPlusOne = state.actors.find((actor) => actor.id === borinId)!.armorClass!;

    expect(reconcileArmorClasses(state, resolve, catalogOf(2))).toBe(true);
    expect(state.actors.find((actor) => actor.id === borinId)!.armorClass).toBe(atPlusOne + 1);
    expect(reconcileArmorClasses(state, resolve, catalogOf(2))).toBe(false);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("a homebrew republish reaches the AC attacks resolve against", () => {
  it("follows an equipped item's armor-class rider from +1 to +2 with no inventory write", async () => {
    const state = createInitialGameState();
    const borinId = state.actors.find((actor) => actor.name === "Borin Stoneguard")!.id;
    const directory = await mkdtemp(join(tmpdir(), "vtt-stale-ac-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: state
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("The server did not bind.");
    const base = `http://127.0.0.1:${address.port}`;
    const send = async (method: string, path: string, payload: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBeLessThan(300);
      return response.json() as Promise<{ data: { record: { id: string } } }>;
    };
    const publish = (id: string) => send("POST", HOMEBREW_PATHS.contentPublish.replace("{id}", id), {});
    const armorClass = () => server.store.snapshot.actors.find((actor) => actor.id === borinId)!.armorClass;
    const bare = armorClass()!;

    // The record's id is minted on create, so the ring goes on afterwards: written straight into the store,
    // as an older campaign's actor would hold it, with no inventory write to re-derive the AC.
    const created = await send("POST", HOMEBREW_PATHS.content, { record: { type: "equipment", ...ringWith(1) } });
    const ringId = created.data.record.id;
    await publish(ringId);
    await server.store.execute({ id: randomUUID(), type: "test.equip" }, (draft) => {
      const borin = draft.actors.find((actor) => actor.id === borinId)!;
      borin.inventory = [...borin.inventory, worn(ringId)];
    });
    expect(armorClass()).toBe(bare);

    await send("PATCH", HOMEBREW_PATHS.contentById.replace("{id}", ringId), {
      record: { ...ringWith(2, ringId), source: "homebrew" }
    });
    await publish(ringId);
    await expect.poll(armorClass).toBe(bare + 2);
  });
});
