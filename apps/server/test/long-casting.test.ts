import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import type { EffectNarration } from "../src/effects.js";
import { endConcentrationSustainedBy } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { castingMinutesOf } from "../src/resolution/long-casting.js";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";
import { build, catalog, fight, HERO, heroTurnAgain, view, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Longer Casting Times: "you must spend your action on each turn casting the spell, and you must maintain
// your Concentration while you do so. If your Concentration is broken, the spell fails, but you don't expend a spell
// slot." A Ritual "takes 10 minutes longer to cast than normal".

const wizard = build(wizardInput(["alarm", "find-familiar", "magic-missile", "shield"]));
const slotsOf = (actor: GameState["actors"][number], level: number) =>
  actor.spellSlots?.find((slot) => slot.level === level)?.remaining;
const casting = (actor: GameState["actors"][number]) => actor.effects.find((effect) => effect.longCast !== undefined);

describe("a casting time in minutes or hours", () => {
  it("counts the minutes, ten more as a Ritual, and an Action or 8 hours as its Action", () => {
    const spell = (id: string) => view.spellRecord(id)!;
    expect(castingMinutesOf(spell("alarm"), "spell-alarm")).toBe(1);
    expect(castingMinutesOf(spell("alarm"), "spell-alarm-ritual")).toBe(11);
    expect(castingMinutesOf(spell("detect-magic"), "spell-detect-magic-ritual")).toBe(10);
    expect(castingMinutesOf(spell("find-familiar"), "spell-find-familiar")).toBe(60);
    expect(castingMinutesOf(spell("plant-growth"), "spell-plant-growth")).toBe(0);
    expect(castingMinutesOf(spell("fireball"), "spell-fireball")).toBe(0);
  });
});

describe("a long cast in an encounter", () => {
  it("takes the action on each turn, holds Concentration, and spends its slot only when it completes", () => {
    const { state, hero, resolve } = fight(wizard);
    const before = slotsOf(hero, 1)!;
    const first = resolve("spell-alarm", { targetIds: [] });
    expect(first.tableNarration?.map((line) => line.text)).toContain(
      "Ansel begins casting Alarm. It takes the action on each of Ansel's next 9 turns, with Concentration held."
    );
    expect(casting(hero)).toMatchObject({ name: "Casting Alarm", concentration: true });
    expect(casting(hero)!.longCast).toMatchObject({ actionId: "spell-alarm", turnsLeft: 9, slotLevel: 1 });
    expect(state.combat.turn.actionUsed).toBe(true);
    expect(slotsOf(hero, 1)).toBe(before);
    // One action a turn keeps it going.
    expect(() => resolve("spell-alarm", { targetIds: [] })).toThrow(
      "Ansel has already spent this turn's action casting Alarm."
    );

    heroTurnAgain(state);
    const second = resolve("spell-alarm", { targetIds: [] });
    expect(second.tableNarration?.map((line) => line.text)).toContain("Ansel keeps casting Alarm: 8 more turns.");
    expect(casting(hero)!.longCast!.turnsLeft).toBe(8);
    expect(slotsOf(hero, 1)).toBe(before);

    // The last turn's action completes it, at the slot picked when it began.
    casting(hero)!.longCast = { ...casting(hero)!.longCast!, turnsLeft: 1 };
    heroTurnAgain(state);
    resolve("spell-alarm", { targetIds: [] });
    expect(casting(hero)).toBeUndefined();
    expect(slotsOf(hero, 1)).toBe(before - 1);
  });

  it("fails with no slot spent when Concentration breaks", () => {
    const { state, hero, resolve } = fight(wizard);
    const before = slotsOf(hero, 1)!;
    resolve("spell-alarm", { targetIds: [] });
    endConcentrationSustainedBy(state, HERO);
    expect(casting(hero)).toBeUndefined();
    heroTurnAgain(state);
    // Cast again, it starts over.
    resolve("spell-alarm", { targetIds: [] });
    expect(casting(hero)!.longCast!.turnsLeft).toBe(9);
    expect(slotsOf(hero, 1)).toBe(before);
  });

  it("lapses when a turn ends without the action that keeps it going", () => {
    const { state, hero, resolve } = fight(wizard);
    resolve("spell-alarm", { targetIds: [] });
    heroTurnAgain(state);
    const events: EffectNarration[] = [];
    nextInitiativeTurn(state, events);
    expect(casting(hero)).toBeUndefined();
    expect(events.map((event) => event.text)).toContain(
      "Ansel took no action to keep casting Alarm, so the spell fails. No spell slot is spent."
    );
  });

  it("takes ten minutes more as a Ritual, with no slot", () => {
    const { hero, resolve } = fight(wizard);
    resolve("spell-alarm-ritual", { targetIds: [] });
    expect(casting(hero)!.longCast).toMatchObject({ turnsLeft: 109, slotLevel: null });
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("a long cast outside an encounter", () => {
  it("completes at once and moves the game clock by its whole hours", async () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, wizard, HERO, "public", catalog);
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    // Find Familiar burns 10+ GP of incense, which a Component Pouch can't stand in for.
    hero.inventory = [
      ...hero.inventory,
      { id: "incense", name: "Incense", quantity: 1, equipped: false, attuned: false }
    ];
    const directory = await mkdtemp(join(tmpdir(), "vtt-long-cast-"));
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
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    await server.mapAssets.import(png(900, 600), "arena.png");
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const before = server.store.snapshot.rest.clockHours;
    const response = await fetch(`http://127.0.0.1:${address.port}${GAME_PATHS.actionUse}`, {
      method: "POST",
      headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: randomUUID(), actorId: HERO, actionId: "spell-find-familiar" })
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.route).toBe("resolved");
    const after = server.store.snapshot;
    expect(after.rest.clockHours).toBe(before + 1);
    expect(after.actors.find((actor) => actor.id === HERO)!.inventory.some((item) => item.id === "incense")).toBe(
      false
    );
    expect(after.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.longCast)).toBe(false);
  });
});
