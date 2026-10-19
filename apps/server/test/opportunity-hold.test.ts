import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 Opportunity Attacks: "The attack occurs right before the creature leaves your reach." The mover waits at
// the edge of the reach it leaves while the prompt is open; it carries on once the prompt is answered, unless the
// attack left it unable to (here knocked Prone), when it stays and gets back the movement the rest would have cost.

const HERO = "10000000-0000-4000-8000-0000000000f1";
const ORC = "10000000-0000-4000-8000-0000000000f2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fight() {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
      { id: ORC, name: "Orc", kind: "monster", speedFeet: 30 }
    ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } }))
  });
  const table = await bootMovementServer(state, cleanups);
  await table.startFight([HERO, ORC], { [HERO]: cell(1, 1), [ORC]: cell(2, 1) });
  return table;
}

describe("a move that provokes an Opportunity Attack", () => {
  it("waits at the edge of reach while the prompt is open, and carries on once it is declined", async () => {
    const { server, gmToken, move, post } = await fight();
    const moved = await move(HERO, gmToken, { position: cell(1, 6) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const heroAt = () => server.store.snapshot.combat.tokens.find((token) => token.actorId === HERO)!.position;
    const prompt = server.store.snapshot.combat.pendingReactions.find((entry) => entry.kind === "leaves-reach")!;
    expect(prompt.actorId).toBe(ORC);
    // Still within 5 feet of the orc.
    expect(Math.max(Math.abs(heroAt()!.x - cell(2, 1).x), Math.abs(heroAt()!.y - cell(2, 1).y))).toBe(50);
    expect(server.store.snapshot.combat.heldMove?.to).toEqual(cell(1, 6));
    const declined = await post(GAME_PATHS.reactionDismiss.replace("{reactionId}", prompt.id), gmToken, {
      reactionId: prompt.id
    });
    expect(declined.status, await declined.clone().text()).toBe(200);
    expect(heroAt()).toEqual(cell(1, 6));
    expect(server.store.snapshot.combat.heldMove).toBeNull();
  });

  it("stays where it was struck when the attack knocks it Prone, and gets the rest of its movement back", async () => {
    const { server, gmToken, move, post } = await fight();
    await move(HERO, gmToken, { position: cell(1, 6) });
    const used = server.store.snapshot.combat.turn.movementUsedFeet;
    const prompt = server.store.snapshot.combat.pendingReactions.find((entry) => entry.kind === "leaves-reach")!;
    const held = server.store.snapshot.combat.tokens.find((token) => token.actorId === HERO)!.position;
    // The attack topples the hero, then the prompt closes.
    const toppled = await post(GAME_PATHS.actorConditions.replace("{actorId}", HERO), gmToken, {
      actorId: HERO,
      conditionId: "prone",
      active: true
    });
    expect(toppled.status, await toppled.clone().text()).toBe(200);
    await post(GAME_PATHS.reactionDismiss.replace("{reactionId}", prompt.id), gmToken, { reactionId: prompt.id });
    expect(server.store.snapshot.combat.tokens.find((token) => token.actorId === HERO)!.position).toEqual(held);
    expect(server.store.snapshot.combat.turn.movementUsedFeet).toBeLessThan(used);
  });
});
