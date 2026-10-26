import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { RulesBlockedError } from "../src/game-store.js";
import { createServer } from "../src/server.js";
import { catalogRow } from "./equipment-table.js";
import { png } from "./image-fixtures.js";
import { build, catalog, FOE, fight, HERO, wizardInput } from "./spell-casters.js";

// A spell cast outside a fight starts what it starts as it does in one (its grant, its Concentration, its saves), with
// no turn to spend. SRD Armor Training ("you can't cast spells") holds outside a fight too.

const wizard = build(wizardInput(["mage-armor", "hold-person", "magic-missile", "shield"]));
const HOLD_PERSON_DC = wizard.actions.find((action) => action.id === "spell-hold-person")!.save!.dc;
const slotsOf = (actor: GameState["actors"][number], level: number) =>
  actor.spellSlots?.find((slot) => slot.level === level)?.remaining;

describe("a spell cast outside a fight", () => {
  it("grants what it grants and spends its slot, with no action and no one-slot-a-turn limit", () => {
    const { state, hero, resolve } = fight(wizard, { combat: false });
    const before = slotsOf(hero, 1)!;
    const armor = resolve("spell-mage-armor", { targetIds: [HERO] });
    expect(armor.effectsApplied).toEqual([expect.objectContaining({ targetId: HERO, name: "Mage Armor" })]);
    expect(hero.effects.some((effect) => effect.name === "Mage Armor")).toBe(true);
    expect(slotsOf(hero, 1)).toBe(before - 1);
    expect(state.combat.turn.actionUsed).toBe(false);
    // A second slot right after: outside a fight there is no turn to hold it to one.
    resolve("spell-magic-missile", { targetIds: [FOE] }, [2, 2, 2]);
    expect(slotsOf(hero, 1)).toBe(before - 2);
    expect(state.combat.turn.spellSlotCasters ?? []).toEqual([]);
  });

  it("starts Concentration and asks for the save, as Hold Person does in a fight", () => {
    const { state, hero, resolve } = fight(wizard, { combat: false });
    resolve("spell-hold-person", { targetIds: [FOE] });
    expect(hero.effects.some((effect) => effect.concentration && effect.name.includes("Hold Person"))).toBe(true);
    expect(state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "wis", dc: HOLD_PERSON_DC })
    ]);
  });

  it("is refused in armor the caster isn't trained with", () => {
    const { hero, resolve } = fight(wizard, { combat: false });
    hero.inventory = [...hero.inventory, catalogRow("chain-mail")];
    expect(() => resolve("spell-mage-armor", { targetIds: [HERO] })).toThrow(RulesBlockedError);
    expect(() => resolve("spell-mage-armor", { targetIds: [HERO] })).toThrow(
      "Ansel can't cast spells while wearing Chain Mail without training in it."
    );
  });

  it("leaves anything but a cast to the loose route", () => {
    const { resolve } = fight(wizard, { combat: false });
    expect(() => resolve("item-arcane-focus-staff", { targetIds: [FOE] })).toThrow(
      "Start an encounter before resolving actions."
    );
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, wizard, HERO, "public", catalog);
  const directory = await mkdtemp(join(tmpdir(), "vtt-cast-"));
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
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken };
}

const post = (base: string, path: string, token: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });

describe("a sheet's cast outside a fight, over the API", () => {
  it("resolves through the fight's path and lands a help spell on its caster when no one is named", async () => {
    const { base, server, gmToken } = await boot();
    const response = await post(base, GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "spell-mage-armor"
    });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body.route).toBe("resolved");
    const hero = server.store.snapshot.actors.find((actor) => actor.id === HERO)!;
    expect(hero.effects.some((effect) => effect.name === "Mage Armor")).toBe(true);
    expect(server.store.snapshot.combat.active).toBe(false);

    // A cast that rolls against a creature and names none has no one to resolve against: its dice roll loose.
    const bolt = await post(base, GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "spell-fire-bolt",
      includeDamage: true
    });
    expect((await bolt.json()).data.route).toBe("loose");
  });
});
