import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { dawnsBetween } from "../src/clock-pools.js";
import { applyRest, passTime } from "../src/rests.js";
import { spendUses } from "../src/use-pools.js";
import { bootServer } from "./boot-server.js";
import { catalog, catalogRow, fight, IDS, resolveAt, tableOf, wizardInput, write } from "./equipment-table.js";

// SRD 5.2.1 Wings of Flying: "When the wings disappear, you can't use them again for 1d12 hours." Horn of Valhalla:
// "Once you use the horn, it can't be used again until 7 days have passed." Wand of Magic Missiles: "regains 1d6 + 1
// expended charges daily at dawn". With no dawn hour on the clock, a Long Rest stands in for the day.

const spent = (table: ReturnType<typeof tableOf>, key: string) => table.actor(IDS.wizard).actionUses[key] ?? 0;
const depsOf = (table: ReturnType<typeof tableOf>, face: number) => ({
  resolveDefinition: table.resolve,
  catalog,
  random: () => face
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("a pool that comes back after a time", () => {
  it("brings Wings of Flying back once the rolled hours pass, and not at a Long Rest", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wings-of-flying", { attuned: true }));
    fight(table, IDS.wizard);
    // 1d12 + 1 with a 5: six hours from the use.
    const result = resolveAt(table, IDS.wizard, "item-wings-of-flying-wings", [5], { targetIds: [] });
    expect(result.warnings?.join(" ")).toMatch(/Wings of Flying can be used again in 6 hours/);
    expect(spent(table, "item-wings-of-flying-wings")).toBe(1);
    table.state.combat.active = false;

    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 6, lines: [] });
    expect(spent(table, "item-wings-of-flying-wings")).toBe(1);

    passTime(table.state, 5, 59, depsOf(table, 1));
    expect(spent(table, "item-wings-of-flying-wings")).toBe(1);
    const back = passTime(table.state, 0, 1, depsOf(table, 1));
    expect(spent(table, "item-wings-of-flying-wings")).toBe(0);
    expect(table.actor(IDS.wizard).readyAt).toEqual({});
    expect(back.map((event) => event.text).join(" ")).toMatch(/'s Wings of Flying can be used again\./);
  });

  it("starts a Horn of Valhalla's 7 days when it is spent from the sheet", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("horn-of-valhalla"));
    const { line } = spendUses(
      table.state,
      IDS.wizard,
      "item-horn-of-valhalla-blow",
      1,
      { role: "gm" },
      { resolveDefinition: table.resolve, catalog, random: () => 1 }
    );
    expect(line).toBe("Blow the Horn can be used again in 7 days.");
    passTime(table.state, 167, 0, depsOf(table, 1));
    expect(spent(table, "item-horn-of-valhalla-blow")).toBe(1);
    passTime(table.state, 1, 0, depsOf(table, 1));
    expect(spent(table, "item-horn-of-valhalla-blow")).toBe(0);
  });
});

describe("charges that come back at dawn", () => {
  it("counts the dawns the clock passes", () => {
    expect(dawnsBetween(0, 48 * 60, 6)).toBe(2);
    expect(dawnsBetween(6 * 60, 7 * 60, 6)).toBe(0);
    expect(dawnsBetween(6 * 60 - 1, 6 * 60, 6)).toBe(1);
  });

  it("gives a wand its dawn charges when the clock passes dawn, and leaves them to the dawn at a Long Rest", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("wand-of-magic-missiles"));
    table.state.rest = { ...table.state.rest, dawnHour: 6 };
    table.actor(IDS.wizard).actionUses = { "wand-of-magic-missiles-charges": 6 };

    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 6, lines: [] });
    expect(spent(table, "wand-of-magic-missiles-charges")).toBe(6);

    passTime(table.state, 5, 0, depsOf(table, 3));
    expect(spent(table, "wand-of-magic-missiles-charges")).toBe(6);
    // 1d6 + 1 with a 3: four back.
    const events = passTime(table.state, 2, 0, depsOf(table, 3));
    expect(spent(table, "wand-of-magic-missiles-charges")).toBe(2);
    expect(events.map((event) => event.text)).toContain(
      "Dawn: Wand of Magic Missiles regains 4 expended charges (1d6 + 1)."
    );
  });

  it("lets a Long Rest stand in for the dawn when the clock keeps no dawn hour", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("wand-of-magic-missiles"));
    table.actor(IDS.wizard).actionUses = { "wand-of-magic-missiles-charges": 6 };
    passTime(table.state, 30, 0, depsOf(table, 3));
    expect(spent(table, "wand-of-magic-missiles-charges")).toBe(6);
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 3, lines: [] });
    expect(spent(table, "wand-of-magic-missiles-charges")).toBe(2);
  });

  it("lets only the GM set the dawn hour", async () => {
    const { server, gmToken, post, close } = await bootServer(GameStateSchema.parse({ schemaVersion: 1 }));
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    const refused = await post(GAME_PATHS.timeSetDawn, player, { commandId: randomUUID(), hour: 6 });
    expect(refused.ok).toBe(false);
    const set = await post(GAME_PATHS.timeSetDawn, gmToken, { commandId: randomUUID(), hour: 6 });
    expect(set.status).toBe(200);
    expect(server.store.snapshot.rest.dawnHour).toBe(6);
    const cleared = await post(GAME_PATHS.timeSetDawn, gmToken, { commandId: randomUUID(), hour: null });
    expect(cleared.status).toBe(200);
    expect(server.store.snapshot.rest.dawnHour).toBeNull();
  });
});
