import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 Mounted Combat: mounting a creature within 5 feet, at least one size larger, or dismounting costs half the
// rider's Speed; the rider shares the mount's space and goes where it goes.

const RIDER = "10000000-0000-4000-8000-0000000000a7";
const HORSE = "10000000-0000-4000-8000-0000000000a8";
const DOG = "10000000-0000-4000-8000-0000000000a9";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function table() {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: RIDER, name: "Borin", kind: "player-character", speedFeet: 30 },
      { id: HORSE, name: "Warhorse", kind: "npc", speedFeet: 60, size: "large" },
      { id: DOG, name: "Mastiff", kind: "npc", speedFeet: 40, size: "medium" }
    ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 20, maximum: 20 } }))
  });
  const booted = await bootMovementServer(state, cleanups);
  await booted.startFight([RIDER, HORSE, DOG], {
    [RIDER]: cell(1, 1),
    [HORSE]: { x: 150, y: 100 },
    [DOG]: cell(1, 2)
  });
  const mount = (mountId: string | null) =>
    booted.post(GAME_PATHS.actorMount.replace("{actorId}", RIDER), booted.gmToken, { actorId: RIDER, mountId });
  const at = (id: string) => booted.server.store.snapshot.combat.tokens.find((token) => token.actorId === id)!.position;
  return { ...booted, mount, at };
}

describe("riding a mount", () => {
  it("costs half the rider's Speed to climb on, shares the mount's space, and goes where it goes", async () => {
    const { server, mount, at, move, gmToken } = await table();
    const mounted = await mount(HORSE);
    expect(mounted.status, await mounted.clone().text()).toBe(200);
    expect(server.store.snapshot.combat.turn.movementUsedFeet).toBe(15);
    expect(server.store.snapshot.actors.find((actor) => actor.id === RIDER)!.effects.map((e) => e.name)).toEqual([
      "Riding Warhorse"
    ]);
    const ridden = await move(HORSE, gmToken, { position: { x: 400, y: 100 } });
    expect(ridden.status, await ridden.clone().text()).toBe(200);
    const horse = at(HORSE)!;
    expect(horse.x).toBeGreaterThan(300);
    expect(Math.hypot(at(RIDER)!.x - horse.x, at(RIDER)!.y - horse.y)).toBeLessThanOrEqual(36);
    // The rider moves only by its mount.
    const walked = await move(RIDER, gmToken, { position: cell(1, 5) });
    expect(walked.status).toBe(409);
    expect(await walked.text()).toContain("Borin is riding Warhorse. Move Warhorse, or dismount first.");
  });

  it("refuses a mount no larger than its rider, and stands a dismounted rider in an open space beside it", async () => {
    const { mount, at } = await table();
    const tooSmall = await mount(DOG);
    expect(tooSmall.status).toBe(409);
    expect(await tooSmall.text()).toContain("Mastiff must be at least one size larger than Borin.");
    expect((await mount(HORSE)).status).toBe(200);
    const off = await mount(null);
    expect(off.status, await off.clone().text()).toBe(200);
    const horse = at(HORSE)!;
    const rider = at(RIDER)!;
    expect(Math.hypot(rider.x - horse.x, rider.y - horse.y)).toBeGreaterThan(40);
  });
});
