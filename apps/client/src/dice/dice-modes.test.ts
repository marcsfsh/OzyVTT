import { describe, expect, it, vi } from "vitest";
import type { GmView, PlayerView } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { entryFor, followTable, tableDiceLine, typedDie } from "./roll-preference";

// ADR-0043: a player's dice follow the table's d20 mode; the GM chooses, except for a character played at the table
// (ADR-0042), whose total the GM types as its player reports it.

const LYRA = "10000000-0000-4000-8000-000000000001";
const player = (d20: "total" | "die" | "app") => ({ playerDice: { d20, damage: "app" } }) as unknown as PlayerView;
const gm = (atTable: boolean) =>
  ({
    definitions: [],
    actors: [{ id: LYRA, playedAtTable: atTable }],
    combat: { active: false }
  }) as unknown as GmView;

describe("how a roll is entered", () => {
  it("follows the table's d20 mode for a player, with no choice of their own", () => {
    expect(entryFor(player("app"), "manual")).toEqual({
      rollInput: "digital",
      mayType: false,
      typeAs: "face",
      chooses: false
    });
    expect(entryFor(player("die"), "digital")).toMatchObject({ rollInput: "manual", typeAs: "face", chooses: false });
    expect(entryFor(player("total"), "digital")).toMatchObject({ rollInput: "manual", typeAs: "total" });
  });

  it("lets the GM choose, and asks the GM for the total of a character played at the table", () => {
    expect(entryFor(gm(false), "digital", LYRA)).toMatchObject({ rollInput: "digital", typeAs: "face", chooses: true });
    expect(entryFor(gm(true), "digital", LYRA)).toMatchObject({ rollInput: "manual", typeAs: "total", chooses: false });
    // An encounter's own choice for the character wins while it runs.
    const running = { ...gm(true), combat: { active: true, atTable: { [LYRA]: false } } } as unknown as GmView;
    expect(entryFor(running, "digital", LYRA)).toMatchObject({ typeAs: "face", chooses: true });
  });

  it("names the field a typed number goes in, and says the table's rule where a player would choose", () => {
    followTable(player("total"));
    expect(typedDie("face", 17)).toEqual({ rolledTotal: 17 });
    expect(typedDie("attackNatural", 19)).toEqual({ attackRolledTotal: 19 });
    followTable(player("die"));
    expect(typedDie("naturalRoll", 12)).toEqual({ naturalRoll: 12 });
    expect(tableDiceLine(entryFor(player("total"), "digital"))).toBe(
      "At this table you type the total you rolled, your bonus included. Only the GM can change that."
    );
  });
});
