import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type CombatLogEntry } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * THE FAR END OF TYPED DAMAGE: the row the table actually reads (issue `4a`, gap 3).
 *
 * `answerSave` and both reaction paths folded `application.parts` into a bare `appliedDamage` and
 * dropped the rest, so a fire-resistant target's halved save damage reached the feed as a smaller
 * number with no reason attached - the client could not have rendered one if it wanted to. These
 * tests drive the real HTTP surface and assert on the STORED FEED TEXT, which is the only place that
 * claim can be settled: a unit test on the outcome object would pass with the narration still silent.
 */

const DRAGON = "10000000-0000-4000-8000-000000000001";
const BORIN = "10000000-0000-4000-8000-000000000002";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

const baseDefinition = {
  schemaVersion: 1, source: { name: "test", version: "1" }, size: "medium",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2, armorClass: 12, speedFeet: 30, extensions: {}
} as const;

/** A dragon whose breath is a DEX save for 3d6 fire, and a hero the fire barely touches. */
function initialState(resistances: string[] = ["fire"], uncannyDodge = true) {
  return GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [
      {
        id: "dragon-def",
        definition: {
          ...baseDefinition, schemaId: "vtt.actor-monster", name: "Dragon", hitPoints: { maximum: 100 },
          token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
          actions: [{
            id: "breath", name: "Fire Breath", activation: "action",
            description: "Dexterity Saving Throw: DC 15. Failure: 10 (3d6) Fire damage. Success: Half damage.",
            save: { ability: "dex", dc: 15 }, damage: [{ formula: "3d6", type: "fire" }]
          }, {
            id: "bite", name: "Searing Bite", activation: "action",
            description: "Melee Attack Roll: +20, reach 10 ft. Hit: 20 (4d6 + 6) Fire damage.",
            attack: { bonus: 20, reachFeet: 10 }, damage: [{ formula: "4d6 + 6", type: "fire" }]
          }]
        }
      },
      {
        id: "borin-def",
        definition: {
          ...baseDefinition, schemaId: "vtt.actor-character", name: "Borin", hitPoints: { maximum: 40 },
          token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
          damageResistances: resistances,
          actions: uncannyDodge ? [{
            id: "uncanny-dodge", name: "Uncanny Dodge", activation: "reaction",
            description: "*Reaction, when an attacker he can see hits him:* halve the attack's damage against him.",
            damage: [], reaction: { trigger: "hit-by-attack", response: "half-damage" }
          }] : []
        }
      }
    ],
    actors: [
      { id: DRAGON, name: "Dragon", kind: "monster", visibility: "public", hp: { current: 100, maximum: 100 }, definitionId: "dragon-def", initiative: 20 },
      { id: BORIN, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12, definitionId: "borin-def", initiative: 10 }
    ]
  });
}

async function boot(resistances?: string[], uncannyDodge = true) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-typed-damage-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState(resistances, uncannyDodge)
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
async function feed(base: string, token: string): Promise<readonly CombatLogEntry[]> {
  const response = await fetch(base + GAME_PATHS.log, { headers: bearer(token) });
  expect(response.status).toBe(200);
  return (await response.json()).data.entries as readonly CombatLogEntry[];
}
const hpOf = (server: Awaited<ReturnType<typeof boot>>["server"], actorId: string) =>
  server.store.snapshot.actors.find((actor) => actor.id === actorId)!.hp.current;

/** Start the fight and breathe fire on Borin, returning the save prompt that opened. */
async function breatheOnBorin(base: string, gmToken: string, mapAssetId: string) {
  const started = await post(base, GAME_PATHS.encounterStart, gmToken, { commandId: randomUUID(), mapAssetId, entries: [{ actorId: DRAGON }, { actorId: BORIN }] });
  expect(started.status).toBe(200);
  const resolved = await post(base, GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: DRAGON, actionId: "breath", targetIds: [BORIN] });
  expect(resolved.status).toBe(200);
  return (await resolved.json()).data.resolution as Record<string, unknown>;
}

describe("save.answer narrates the adjustment it used to swallow", () => {
  it("says WHY a fire-resistant target took less, in the feed row the table reads", async () => {
    const { base, server, gmToken, mapAssetId } = await boot();
    await breatheOnBorin(base, gmToken, mapAssetId);
    const save = server.store.snapshot.combat.pendingSaves[0];
    expect(save.targetActorId).toBe(BORIN);
    const proposed = save.proposedDamage;
    expect(proposed).toBeGreaterThan(0);

    const before = hpOf(server, BORIN);
    // A hand-entered 5 against DC 15 is a clean failure: the full proposal applies, then resistance.
    const answered = await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), gmToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true });
    expect(answered.status).toBe(200);
    const outcome = (await answered.json()).data.outcome as { appliedDamage: number; parts: Array<{ adjustment: string | null }> };

    // 1. The number really halved.
    expect(outcome.appliedDamage).toBe(Math.floor(proposed / 2));
    expect(before - hpOf(server, BORIN)).toBe(Math.floor(proposed / 2));
    // 2. The breakdown survived the call instead of collapsing into a bare total.
    expect(outcome.parts.some((part) => part.adjustment === "resistance")).toBe(true);
    // 3. And the FEED says why - the assertion no unit test can make.
    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "save" && entry.text.includes("Borin"));
    expect(row, "no save row reached the feed").toBeDefined();
    expect(row!.text).toContain("→");
    expect(row!.text).toContain("resistance");
    expect(row!.text).toContain(`${proposed} fire → ${Math.floor(proposed / 2)}`);
  });

  it("stays quiet when nothing adjusted the damage", async () => {
    // The same fight against the same dragon, but Borin's sheet lists no resistance at all.
    const { base, server, gmToken, mapAssetId } = await boot([]);
    await breatheOnBorin(base, gmToken, mapAssetId);
    const save = server.store.snapshot.combat.pendingSaves[0];
    await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), gmToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true });

    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "save" && entry.text.includes("Borin"))!;
    expect(row.text).not.toContain("→");
    expect(row.text).toContain(`${save.proposedDamage} damage`);
  });
});

describe("both reaction paths narrate the adjustment they used to swallow", () => {
  /**
   * Bite Borin so his Uncanny Dodge parks the hit's damage on a prompt.
   *
   * SEEDED ATTACK DIE, and it is load-bearing. +20 vs AC 12 hits on every face except a natural 1,
   * which the resolver calls a FUMBLE - a miss, so no damage rolls, so no reaction prompt is minted
   * and `pendingReactions[0]` is `undefined`. That is the whole of the flake this file carried: one
   * bite in twenty erased the far end these two tests exist to assert, and with two bites per run the
   * file failed roughly one run in ten (captured: `TypeError: Cannot read properties of undefined
   * (reading 'proposedDamage')` at the DECLINED test).
   *
   * `attackNatural` is the public contract's own door for exactly this ("apply this exact d20 face
   * for the attack instead of rolling"), so nothing about the server moves to make the test stable -
   * the opportunity-attack test below already pins its d20 the same way. 18 hits and is below the
   * critical threshold (20, and no rider here widens it), so the swing lands as an ordinary hit.
   *
   * Only the ATTACK die is pinned. The `4d6 + 6` damage still rolls for real and every assertion
   * downstream derives its expectation from the number that came back, so the far-end proof stays a
   * real rolled number rather than a hard-coded one.
   */
  async function biteBorin(base: string, gmToken: string, mapAssetId: string): Promise<void> {
    expect((await post(base, GAME_PATHS.encounterStart, gmToken, { commandId: randomUUID(), mapAssetId, entries: [{ actorId: DRAGON }, { actorId: BORIN }] })).status).toBe(200);
    expect((await post(base, GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: DRAGON, actionId: "bite", targetIds: [BORIN], attackNatural: 18 })).status).toBe(200);
  }

  it("explains the halved reaction damage when the reaction is USED", async () => {
    const { base, server, gmToken, mapAssetId } = await boot();
    await biteBorin(base, gmToken, mapAssetId);
    const prompt = server.store.snapshot.combat.pendingReactions[0];
    expect(prompt, "the bite parked no reaction prompt").toBeDefined();
    const parked = prompt.proposedDamage;
    const before = hpOf(server, BORIN);

    const answered = await post(base, GAME_PATHS.reactionAnswer.replace("{reactionId}", prompt.id), gmToken, { commandId: randomUUID(), reactionId: prompt.id, use: true, commit: true });
    expect(answered.status).toBe(200);
    // Uncanny Dodge halves the parked total, THEN fire resistance halves what is left.
    const halved = Math.floor(parked / 2);
    expect(before - hpOf(server, BORIN)).toBe(Math.floor(halved / 2));

    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "reaction" && entry.text.includes("used Uncanny Dodge"))!;
    expect(row, "no reaction row reached the feed").toBeDefined();
    expect(row.text).toContain("→");
    expect(row.text).toContain("resistance");
    expect(row.text).toContain(`${halved} fire → ${Math.floor(halved / 2)}`);
  });

  it("explains the full reaction damage when the reaction is DECLINED", async () => {
    const { base, server, gmToken, mapAssetId } = await boot();
    await biteBorin(base, gmToken, mapAssetId);
    const prompt = server.store.snapshot.combat.pendingReactions[0];
    // Same guard as the USED test above: this line is where an unseeded fumble surfaced, and a named
    // failure beats `TypeError: Cannot read properties of undefined`.
    expect(prompt, "the bite parked no reaction prompt").toBeDefined();
    const parked = prompt.proposedDamage;
    const before = hpOf(server, BORIN);

    expect((await post(base, GAME_PATHS.reactionAnswer.replace("{reactionId}", prompt.id), gmToken, { commandId: randomUUID(), reactionId: prompt.id, use: false, commit: true })).status).toBe(200);
    expect(before - hpOf(server, BORIN)).toBe(Math.floor(parked / 2));

    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "damage" && entry.text.includes("declined"))!;
    expect(row, "no declined-reaction row reached the feed").toBeDefined();
    expect(row.text).toContain(`${parked} fire → ${Math.floor(parked / 2)}, resistance`);
  });
});

describe("the opportunity-attack path narrates it too", () => {
  it("explains the resisted damage of a swing taken as a reaction", async () => {
    // No Uncanny Dodge here: with it, the swing's damage parks on a SECOND prompt instead of landing.
    const { base, server, gmToken, mapAssetId } = await boot(["fire"], false);
    expect((await post(base, GAME_PATHS.encounterStart, gmToken, { commandId: randomUUID(), mapAssetId, entries: [{ actorId: DRAGON }, { actorId: BORIN }] })).status).toBe(200);
    // A leaves-reach prompt is minted by the movement rules; seeding it directly keeps this test
    // about the ANSWER (which is what discarded the breakdown), not about reach geometry.
    const promptId = randomUUID();
    await server.store.execute({ id: randomUUID(), type: "test.seed-reaction", payload: {}, principal: "gm" }, (state) => {
      state.combat = { ...state.combat, pendingReactions: [{
        id: promptId, kind: "leaves-reach", actorId: DRAGON, actionId: "bite", actionName: "Searing Bite",
        sourceActorId: BORIN, sourceName: "Borin", targetActorId: BORIN, triggerCommandId: randomUUID(),
        proposedDamage: 0, proposedDamageParts: [], critical: false, createdAt: 0
      }] };
    });

    const before = hpOf(server, BORIN);
    const answered = await post(base, GAME_PATHS.reactionAnswer.replace("{reactionId}", promptId), gmToken, { commandId: randomUUID(), reactionId: promptId, use: true, commit: true, attackNatural: 18 });
    expect(answered.status).toBe(200);
    const outcome = (await answered.json()).data.outcome as { appliedDamage: number; parts: Array<{ amount: number; adjusted: number; adjustment: string | null }> };
    const rolled = outcome.parts[0];
    expect(rolled.adjustment).toBe("resistance");
    expect(before - hpOf(server, BORIN)).toBe(outcome.appliedDamage);
    expect(outcome.appliedDamage).toBe(Math.floor(rolled.amount / 2));

    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "reaction" && entry.text.includes("opportunity attack"))!;
    expect(row, "no opportunity-attack row reached the feed").toBeDefined();
    expect(row.text).toContain(`${rolled.amount} fire → ${rolled.adjusted}, resistance`);
  });
});

/**
 * `4b` - THE SAVE'S DAMAGE BECOMES ENTERABLE.
 *
 * The damage rolled the instant the action resolved and froze into `pendingSaves[].proposedDamage`;
 * `answerSave` applied it with no door at all - not for the GM, and not for a table rolling physical
 * dice. These drive the real command and read the hit points and the feed row afterwards.
 */
describe("save.answer takes a hand-entered damage total", () => {
  it("applies the amended number, keeps its type, and says so in the feed", async () => {
    const { base, server, gmToken, mapAssetId } = await boot([]); // no resistance: the number is the number
    await breatheOnBorin(base, gmToken, mapAssetId);
    const save = server.store.snapshot.combat.pendingSaves[0];
    // Force the plan's exact case: a proposal of 17, amended to 3.
    await server.store.execute({ id: randomUUID(), type: "test.seed-proposal", payload: {}, principal: "gm" }, (state) => {
      state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.map((entry) => entry.id === save.id
        ? { ...entry, proposedDamage: 17, proposedDamageParts: [{ amount: 17, type: "fire" }], halfOnSuccess: false }
        : entry) };
    });

    const before = hpOf(server, BORIN);
    const answered = await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), gmToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true, damageOverride: 3 });
    expect(answered.status).toBe(200);
    expect((await answered.json()).data.outcome.appliedDamage).toBe(3);
    expect(before - hpOf(server, BORIN)).toBe(3);

    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "save" && entry.text.includes("Borin"))!;
    expect(row.text).toContain("3 damage");
    expect(row.text).not.toContain("17");
  });

  it("still meets the target's resistance - the amend does not go untyped", async () => {
    const { base, server, gmToken, mapAssetId } = await boot(); // fire-resistant Borin
    await breatheOnBorin(base, gmToken, mapAssetId);
    const save = server.store.snapshot.combat.pendingSaves[0];
    await server.store.execute({ id: randomUUID(), type: "test.seed-proposal", payload: {}, principal: "gm" }, (state) => {
      state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.map((entry) => entry.id === save.id
        ? { ...entry, proposedDamage: 17, proposedDamageParts: [{ amount: 17, type: "fire" }], halfOnSuccess: false }
        : entry) };
    });

    const before = hpOf(server, BORIN);
    await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), gmToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true, damageOverride: 12 });
    expect(before - hpOf(server, BORIN)).toBe(6);
    const row = (await feed(base, gmToken)).find((entry) => entry.kind === "save" && entry.text.includes("Borin"))!;
    expect(row.text).toContain("12 fire → 6, resistance");
  });

  it("refuses a player amending somebody else's save", async () => {
    const { base, server, gmToken, mapAssetId } = await boot([]);
    await breatheOnBorin(base, gmToken, mapAssetId);
    const save = server.store.snapshot.combat.pendingSaves[0];
    const playerToken = server.auth.issuePlayerSession();

    // A player who has claimed nothing may not answer - much less amend - Borin's save.
    const refused = await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), playerToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true, damageOverride: 3 });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(hpOf(server, BORIN)).toBe(40);

    // Claim Borin and the same amend goes through: the boundary is ownership, not the field.
    expect((await post(base, GAME_PATHS.claims, playerToken, { commandId: randomUUID(), actorId: BORIN })).status).toBe(200);
    const allowed = await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", save.id), playerToken, { commandId: randomUUID(), saveId: save.id, method: "manual", total: 5, commit: true, damageOverride: 3 });
    expect(allowed.status).toBe(200);
    expect(hpOf(server, BORIN)).toBe(37);
  });
});
